//! 屏幕边缘唤出侧栏。
//!
//! Windows 下没有"整个桌面的鼠标移入"事件，这里以轻量轮询实现：
//! 后台线程按固定间隔读取指针位置，仅在越过边缘热区且侧栏隐藏时唤出。
//! 轮询间隔 120 ms，远低于单次 CPU 可感知负载，又足够跟上正常移动速度。
//!
//! 只有整个桌面的外沿算边缘：两块屏幕相接的一边，指针跨屏时必然经过，不唤出（见 windows::is_outer_edge）。
//! 全屏程序（游戏、视频、演示）在前台时，这块屏幕的边缘不唤出（见 fullscreen::blocks_edge），快捷键与托盘照常。
//! 唤出直接在这里完成，用前端最近一次给出的布局，不经过侧栏页面的脚本。
//!
//! 侧栏偶尔彻底唤不出（T86）的几种可能在这里兜住，并写进诊断日志（见 diag）：
//! - 一次轮询出错（panic）只跳过这一次，线程不退出（正式版 panic 会结束进程，日志里留下原因）；
//! - 侧栏「显示着」却整个停在屏幕外（滑入中途出错），这里一直认为它在显示、不再唤出：停够一段时间就把它藏起来；
//! - 指针到了边缘却没有唤出时，记下是被什么挡住（全屏程序、相接的边），只在原因变化时写一行。

use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::windows::{SidebarLayout, SIDEBAR_LABEL};

/// 边缘热区宽度（物理像素）。原型使用 3 px，桌面端放宽到 4 px 以适应高速移动。
const EDGE_THICKNESS: f64 = 4.0;
/// 轮询间隔。
const POLL_INTERVAL: Duration = Duration::from_millis(120);
/// 两次唤出之间的最短间隔，避免指针贴边时反复触发。
const TRIGGER_COOLDOWN_MS: i64 = 400;
/// 侧栏显示着却停在屏幕外、又没有新的动画，连续这么多次轮询（约 1.2 秒）后把它藏起来。
const STUCK_POLLS: u32 = 10;

/// 边缘监视状态，可由设置实时调整。
pub struct EdgeWatcher {
    /// 是否启用边缘唤出。
    enabled: AtomicBool,
    /// 贴附边缘：true 表示左边缘。
    left_edge: AtomicBool,
    /// 上次触发时间，用于冷却。
    last_trigger: AtomicI64,
}

impl EdgeWatcher {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            left_edge: AtomicBool::new(false),
            // 启动后的第一次唤出不受冷却限制。
            last_trigger: AtomicI64::new(-TRIGGER_COOLDOWN_MS),
        }
    }

    /// 按设置更新监视参数。
    pub fn configure(&self, layout: &SidebarLayout, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        self.left_edge.store(layout.edge == "left", Ordering::Relaxed);
    }

    /// 当前是否启用。
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }
}

impl Default for EdgeWatcher {
    fn default() -> Self {
        Self::new()
    }
}

/// 自启动以来的毫秒数，用于冷却。用单调时钟：系统时间往回调时，按墙上时间算的冷却会一直挡住唤出。
fn now_ms() -> i64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as i64
}

/// 轮询之间要记住的状态：只在变化时写日志，统计侧栏停在屏幕外的次数。
#[derive(Default)]
struct PollState {
    /// 上一次指针在边缘却没有唤出的原因；唤出或指针离开边缘后清空。
    blocked: Option<String>,
    /// 侧栏显示着却停在屏幕外的连续轮询次数。
    offscreen_polls: u32,
    /// 开始统计时的动画代次：期间有新的显示或收起就重新统计。
    offscreen_generation: u64,
}

impl PollState {
    /// 记下没有唤出的原因，和上一次不同才写日志。
    fn block(&mut self, reason: impl Into<String>) {
        let reason = reason.into();
        if self.blocked.as_deref() != Some(reason.as_str()) {
            crate::diag::log(format!("指针在边缘，未唤出：{reason}"));
            self.blocked = Some(reason);
        }
    }
}

/// 启动后台轮询线程。线程随应用退出自然结束，无需显式停止句柄。
pub fn spawn(app: AppHandle, watcher: Arc<EdgeWatcher>) {
    std::thread::spawn(move || {
        let mut state = PollState::default();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            // 一次轮询出错只丢掉这一次；线程退出的话，贴边唤出要到重启才恢复。
            if std::panic::catch_unwind(AssertUnwindSafe(|| poll(&app, &watcher, &mut state))).is_err() {
                crate::diag::log("贴边轮询出错，已跳过这一次");
            }
        }
    });
}

/// 一次轮询：指针越过边缘热区且侧栏隐藏时唤出。
fn poll(app: &AppHandle, watcher: &EdgeWatcher, state: &mut PollState) {
    if !watcher.is_enabled() {
        return;
    }
    let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) else {
        return;
    };
    // 侧栏已显示时不再触发，交由前端的移出收起逻辑处理；整个停在屏幕外的不算显示。
    if sidebar.is_visible().unwrap_or(false) {
        recover_offscreen(&sidebar, state);
        return;
    }
    state.offscreen_polls = 0;
    {
        let Ok(cursor) = sidebar.cursor_position() else {
            return;
        };
        let Ok(Some(monitor)) = sidebar.monitor_from_point(cursor.x, cursor.y) else {
            return;
        };

        let area = monitor.work_area();
        let left = area.position.x as f64;
        let right = left + area.size.width as f64;
        let on_left = watcher.left_edge.load(Ordering::Relaxed);
        let hit = if on_left {
            cursor.x <= left + EDGE_THICKNESS
        } else {
            cursor.x >= right - EDGE_THICKNESS
        };
        // 仅在纵向处于工作区内时响应，避免贴着屏幕角落误触。
        let within_vertical = cursor.y >= area.position.y as f64
            && cursor.y <= (area.position.y as f64 + area.size.height as f64);
        if !hit || !within_vertical {
            state.blocked = None;
            return;
        }
        if !crate::windows::is_outer_edge(&sidebar, &monitor, on_left) {
            state.block("这一边挨着另一块屏幕");
            return;
        }
        if let Some(reason) = crate::fullscreen::edge_blocker(cursor.x, cursor.y) {
            state.block(reason);
            return;
        }

        let now = now_ms();
        if now - watcher.last_trigger.load(Ordering::Relaxed) < TRIGGER_COOLDOWN_MS {
            return;
        }
        watcher.last_trigger.store(now, Ordering::Relaxed);
        if state.blocked.take().is_some() {
            crate::diag::log("指针在边缘，恢复唤出");
        }
        if let Err(error) = crate::windows::show_sidebar(app, &crate::windows::last_layout()) {
            crate::diag::log(format!("贴边唤出失败：{error}"));
        }
    }
}

/// 侧栏显示着却整个停在屏幕外、也没有新的动画时，把它藏起来，下次指针到边缘照常唤出。
/// 被最小化的窗口停在屏幕外（-32000）：先不激活地还原再藏起来，否则藏起来的仍是最小化的窗口，
/// 之后显示出来还是在屏幕外（Win+D 之后侧栏唤不出，T106）。
fn recover_offscreen(sidebar: &tauri::WebviewWindow, state: &mut PollState) {
    if sidebar.is_minimized().unwrap_or(false) {
        state.offscreen_polls = 0;
        crate::topmost::restore_if_minimized(sidebar);
        crate::topmost::hide(sidebar);
        return;
    }
    let generation = crate::windows::animation_generation();
    if !crate::windows::is_offscreen(sidebar) || generation != state.offscreen_generation {
        state.offscreen_polls = 0;
        state.offscreen_generation = generation;
        return;
    }
    state.offscreen_polls += 1;
    if state.offscreen_polls >= STUCK_POLLS {
        state.offscreen_polls = 0;
        crate::diag::log("侧栏显示着却停在屏幕外，已隐藏");
        crate::topmost::hide(sidebar);
    }
}
