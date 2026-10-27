//! 侧栏、速记浮窗与设置窗口的窗口控制。
//!
//! 原型在网页内用 CSS transform 模拟侧栏滑入；桌面端改为真实窗口：
//! - 侧栏窗口贴附屏幕边缘，按设置的宽度与边缘定位，出入时平移真实窗口，隐藏后完全消失。
//! - 速记浮窗居中显示，与侧栏共享同一数据库中的草稿。
//! - 设置窗口即原型的设置对话框，按原型尺寸在鼠标所在屏幕居中。
//! - 显示前重新读取显示器工作区，适配多屏与 DPI 变化。

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, WebviewWindow};

use crate::error::{AppError, AppResult};

/// 侧栏窗口标签。
pub const SIDEBAR_LABEL: &str = "main";
/// 速记浮窗标签。
pub const CAPTURE_LABEL: &str = "capture";
/// 设置窗口标签。
pub const SETTINGS_LABEL: &str = "settings";

/// 设置窗口的设计尺寸，与原型桌面端设置对话框一致。
const SETTINGS_SIZE: (f64, f64) = (880.0, 720.0);
/// 屏幕较小时保留的外边距，对应原型的 calc(100vw - 36px) 与 calc(100dvh - 48px)。
const SETTINGS_MARGIN: (f64, f64) = (36.0, 48.0);

/// 侧栏动画代次：每次显示或隐藏都会递增，旧的动画线程据此提前结束，
/// 避免快速移入移出时两段动画互相拉扯。
static SIDEBAR_ANIMATION: AtomicU64 = AtomicU64::new(0);

/// 侧栏几何配置，由前端设置驱动。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarLayout {
    /// 贴附边缘：left 或 right。
    pub edge: String,
    /// 逻辑宽度，前端限制 360–720。
    pub width: f64,
    /// 出入动画时长（毫秒）；0 表示不做动画。
    #[serde(default)]
    pub anim_duration: f64,
}

impl SidebarLayout {
    /// 动画时长收敛到合理区间，避免前端传入异常值导致长时间阻塞。
    fn duration(&self) -> u64 {
        self.anim_duration.clamp(0.0, 800.0) as u64
    }
}

/// 侧栏在某块屏幕上的目标几何（逻辑坐标）。
#[derive(Debug, Clone, Copy)]
struct SidebarGeometry {
    /// 贴边展开时的横坐标。
    final_x: f64,
    /// 完全移出屏幕时的横坐标，作为滑入起点与滑出终点。
    offscreen_x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 取得窗口；窗口缺失说明配置与运行状态不一致。
fn window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::Other(format!("窗口 {label} 不存在")))
}

/// 选择显示器：`prefer_cursor` 为真时优先鼠标所在屏幕，否则优先窗口当前所在屏幕。
fn pick_monitor(window: &WebviewWindow, prefer_cursor: bool) -> AppResult<Monitor> {
    let by_cursor = || {
        window
            .cursor_position()
            .ok()
            .and_then(|cursor| window.monitor_from_point(cursor.x, cursor.y).ok().flatten())
    };
    let current = || window.current_monitor().ok().flatten();
    let found = if prefer_cursor {
        by_cursor().or_else(current)
    } else {
        current().or_else(by_cursor)
    };
    found
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::Other("未能获取显示器信息".into()))
}

/// 显示器工作区的逻辑坐标 (x, y, 宽, 高)。使用工作区而非整屏，避免覆盖任务栏。
fn work_area(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    (
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    )
}

/// 计算侧栏的贴边位置、尺寸与屏幕外位置。
fn sidebar_geometry(sidebar: &WebviewWindow, layout: &SidebarLayout, prefer_cursor: bool) -> AppResult<SidebarGeometry> {
    let monitor = pick_monitor(sidebar, prefer_cursor)?;
    let (area_x, area_y, area_width, area_height) = work_area(&monitor);
    let width = layout.width.clamp(360.0, area_width.max(360.0));
    let (final_x, offscreen_x) = if layout.edge == "left" {
        (area_x, area_x - width)
    } else {
        (area_x + area_width - width, area_x + area_width)
    };
    Ok(SidebarGeometry {
        final_x,
        offscreen_x,
        y: area_y,
        width,
        height: area_height,
    })
}

/// 窗口当前的逻辑横坐标，用于从中途位置继续动画。
fn current_x(window: &WebviewWindow) -> Option<f64> {
    let position = window.outer_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(position.x as f64 / scale)
}

/// 让窗口沿水平方向平滑移动，返回动画是否完整结束。
///
/// Tauri 没有内置窗口动画，这里按帧插值位置。若期间出现新的显示或隐藏请求
/// （代次变化），立即停止并交给新动画接管。
fn animate_x(sidebar: &WebviewWindow, from: f64, to: f64, y: f64, duration: u64, generation: u64) -> bool {
    // 约 60fps 的分片，最少 8 步以免低时长时出现跳变。
    let steps = (duration / 16).max(8);
    let frame = std::time::Duration::from_millis(duration / steps);
    for step in 1..=steps {
        if SIDEBAR_ANIMATION.load(Ordering::SeqCst) != generation {
            return false;
        }
        let t = step as f64 / steps as f64;
        // easeOutCubic，起步快、收尾稳。
        let eased = 1.0 - (1.0 - t).powi(3);
        if sidebar
            .set_position(LogicalPosition::new(from + (to - from) * eased, y))
            .is_err()
        {
            return false;
        }
        std::thread::sleep(frame);
    }
    SIDEBAR_ANIMATION.load(Ordering::SeqCst) == generation
}

/// 按设置重新对齐侧栏（不做动画，用于宽度或边缘变更）。
pub fn align_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    // 可见时跟随侧栏所在屏幕；隐藏时按鼠标所在屏幕预先摆好。
    let visible = sidebar.is_visible().unwrap_or(false);
    let geometry = sidebar_geometry(&sidebar, layout, !visible)?;
    sidebar.set_size(LogicalSize::new(geometry.width, geometry.height))?;
    sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
    Ok(())
}

/// 显示侧栏：从屏幕外平滑滑入；若正在收起，则从当前位置滑回。
pub fn show_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    let generation = SIDEBAR_ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    let visible = sidebar.is_visible().unwrap_or(false);
    let geometry = sidebar_geometry(&sidebar, layout, !visible)?;
    let start_x = if visible {
        current_x(&sidebar).unwrap_or(geometry.final_x)
    } else {
        geometry.offscreen_x
    };

    sidebar.set_size(LogicalSize::new(geometry.width, geometry.height))?;
    if !visible {
        // 先摆到屏幕外再显示，避免出现一帧停在最终位置再跳回去。
        sidebar.set_position(LogicalPosition::new(start_x, geometry.y))?;
        sidebar.show()?;
    }
    sidebar.set_focus()?;

    let duration = layout.duration();
    if duration == 0 || (start_x - geometry.final_x).abs() < 0.5 {
        sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
        return Ok(());
    }
    // 动画放到后台线程，避免阻塞命令调用与主线程事件循环。
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        animate_x(&handle, start_x, geometry.final_x, geometry.y, duration, generation);
    });
    Ok(())
}

/// 隐藏侧栏：先平滑滑出屏幕，再真正隐藏窗口。
pub fn hide_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if !sidebar.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let generation = SIDEBAR_ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    // 收起时以侧栏当前所在屏幕为准，鼠标可能已经移到别的屏幕。
    let geometry = sidebar_geometry(&sidebar, layout, false)?;

    let duration = layout.duration();
    if duration == 0 {
        sidebar.hide()?;
        sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
        return Ok(());
    }
    let start_x = current_x(&sidebar).unwrap_or(geometry.final_x);
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        // 被新的显示请求打断时保持可见，由新动画处理位置。
        if animate_x(&handle, start_x, geometry.offscreen_x, geometry.y, duration, generation) {
            let _ = handle.hide();
            // 收起后复位到贴边位置，避免下次对齐时从错误坐标开始。
            let _ = handle.set_position(LogicalPosition::new(geometry.final_x, geometry.y));
        }
    });
    Ok(())
}

/// 切换侧栏可见性，返回切换后的状态。
pub fn toggle_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<bool> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if sidebar.is_visible().unwrap_or(false) {
        hide_sidebar(app, layout)?;
        Ok(false)
    } else {
        show_sidebar(app, layout)?;
        Ok(true)
    }
}

/// 显示速记浮窗，居中并立即可输入。
pub fn show_capture(app: &AppHandle) -> AppResult<()> {
    let capture = window(app, CAPTURE_LABEL)?;
    capture.center()?;
    capture.show()?;
    capture.set_focus()?;
    Ok(())
}

/// 隐藏速记浮窗；草稿由前端在隐藏前持久化。
pub fn hide_capture(app: &AppHandle) -> AppResult<()> {
    let capture = window(app, CAPTURE_LABEL)?;
    capture.hide()?;
    Ok(())
}

/// 切换速记浮窗，返回切换后的状态。
pub fn toggle_capture(app: &AppHandle) -> AppResult<bool> {
    let capture = window(app, CAPTURE_LABEL)?;
    if capture.is_visible().unwrap_or(false) {
        capture.hide()?;
        Ok(false)
    } else {
        show_capture(app)?;
        Ok(true)
    }
}

/// 显示设置窗口。
///
/// 首次打开时按原型尺寸在鼠标所在屏幕居中，屏幕较小时按原型的留边规则收缩；
/// 已打开时只还原并聚焦，保留用户拖动后的位置。
pub fn show_settings(app: &AppHandle) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    if !settings.is_visible().unwrap_or(false) {
        let monitor = pick_monitor(&settings, true)?;
        let (area_x, area_y, area_width, area_height) = work_area(&monitor);
        let width = SETTINGS_SIZE.0.min(area_width - SETTINGS_MARGIN.0).max(320.0);
        let height = SETTINGS_SIZE.1.min(area_height - SETTINGS_MARGIN.1).max(320.0);
        settings.set_size(LogicalSize::new(width, height))?;
        settings.set_position(LogicalPosition::new(
            area_x + (area_width - width) / 2.0,
            area_y + (area_height - height) / 2.0,
        ))?;
    }
    if settings.is_minimized().unwrap_or(false) {
        settings.unminimize()?;
    }
    settings.show()?;
    settings.set_focus()?;
    Ok(())
}

/// 隐藏设置窗口。
pub fn hide_settings(app: &AppHandle) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    settings.hide()?;
    Ok(())
}
