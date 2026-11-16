//! 屏幕边缘唤出侧栏。
//!
//! Windows 下没有"整个桌面的鼠标移入"事件，这里以轻量轮询实现：
//! 后台线程按固定间隔读取指针位置，仅在越过边缘热区且侧栏隐藏时唤出。
//! 轮询间隔 120 ms，远低于单次 CPU 可感知负载，又足够跟上正常移动速度。
//!
//! 只有整个桌面的外沿算边缘：两块屏幕相接的一边，指针跨屏时必然经过，不唤出（见 windows::is_outer_edge）。
//! 唤出直接在这里完成，用前端最近一次给出的布局，不经过侧栏页面的脚本。

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

/// 启动后台轮询线程。线程随应用退出自然结束，无需显式停止句柄。
pub fn spawn(app: AppHandle, watcher: Arc<EdgeWatcher>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);

        if !watcher.is_enabled() {
            continue;
        }
        let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) else {
            continue;
        };
        // 侧栏已显示时不再触发，交由前端的移出收起逻辑处理。
        if sidebar.is_visible().unwrap_or(false) {
            continue;
        }
        let Ok(cursor) = sidebar.cursor_position() else {
            continue;
        };
        let Ok(Some(monitor)) = sidebar.monitor_from_point(cursor.x, cursor.y) else {
            continue;
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
        if !hit || !within_vertical || !crate::windows::is_outer_edge(&sidebar, &monitor, on_left) {
            continue;
        }

        let now = now_ms();
        if now - watcher.last_trigger.load(Ordering::Relaxed) < TRIGGER_COOLDOWN_MS {
            continue;
        }
        watcher.last_trigger.store(now, Ordering::Relaxed);
        let _ = crate::windows::show_sidebar(&app, &crate::windows::last_layout());
    });
}
