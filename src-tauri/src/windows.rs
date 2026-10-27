//! 侧栏与速记浮窗的窗口控制。
//!
//! 原型在网页内用 CSS transform 模拟侧栏滑入；桌面端改为真实窗口：
//! - 侧栏窗口贴附屏幕边缘，按设置的宽度与边缘定位，隐藏后完全消失。
//! - 速记浮窗居中显示，与侧栏共享同一前端实例的草稿逻辑。
//! - 显示前重新读取显示器工作区，适配多屏与 DPI 变化。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::error::{AppError, AppResult};

/// 侧栏窗口标签。
pub const SIDEBAR_LABEL: &str = "main";
/// 速记浮窗标签。
pub const CAPTURE_LABEL: &str = "capture";
/// 设置窗口标签。
pub const SETTINGS_LABEL: &str = "settings";

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

/// 取得窗口；窗口缺失说明配置与运行状态不一致。
fn window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::Other(format!("窗口 {label} 不存在")))
}

/// 计算侧栏目标几何：贴边位置、尺寸与屏幕外起始位置。
///
/// 返回 (最终 x, 动画起始 x, y, 宽度, 高度)。
fn sidebar_geometry(app: &AppHandle, layout: &SidebarLayout) -> AppResult<(f64, f64, f64, f64, f64)> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    let monitor = sidebar
        .cursor_position()
        .ok()
        .and_then(|cursor| sidebar.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| sidebar.current_monitor().ok().flatten())
        .or_else(|| sidebar.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::Other("未能获取显示器信息".into()))?;

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let area_x = work_area.position.x as f64 / scale;
    let area_y = work_area.position.y as f64 / scale;
    let area_width = work_area.size.width as f64 / scale;
    let area_height = work_area.size.height as f64 / scale;

    let width = layout.width.clamp(360.0, area_width.max(360.0));
    let (final_x, offscreen_x) = if layout.edge == "left" {
        // 左侧贴边：收起时整块窗口滑到屏幕左侧之外。
        (area_x, area_x - width)
    } else {
        // 右侧贴边：收起时整块窗口滑到屏幕右侧之外。
        (area_x + area_width - width, area_x + area_width)
    };
    Ok((final_x, offscreen_x, area_y, width, area_height))
}

/// 让窗口沿水平方向平滑移动。
///
/// Tauri 没有内置窗口动画，这里按帧插值位置；缓动曲线与前端 CSS 保持一致，
/// 使窗口边缘和内部内容的位移看起来是同一个动作。
fn animate_x(sidebar: &WebviewWindow, from: f64, to: f64, y: f64, duration: u64) {
    if duration == 0 || (from - to).abs() < 0.5 {
        let _ = sidebar.set_position(LogicalPosition::new(to, y));
        return;
    }
    // 60fps 左右的分片，最少 8 步以免低时长时出现跳变。
    let steps = ((duration / 16).max(8)) as u32;
    for step in 1..=steps {
        let t = step as f64 / steps as f64;
        // easeOutCubic，起步快、收尾稳，观感接近原型。
        let eased = 1.0 - (1.0 - t).powi(3);
        let x = from + (to - from) * eased;
        if sidebar.set_position(LogicalPosition::new(x, y)).is_err() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(duration / steps as u64));
    }
}

/// 按当前鼠标所在显示器的工作区对齐侧栏（不做动画，用于拖拽调宽）。
pub fn align_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    let (final_x, _, y, width, height) = sidebar_geometry(app, layout)?;
    sidebar.set_size(LogicalSize::new(width, height))?;
    sidebar.set_position(LogicalPosition::new(final_x, y))?;
    Ok(())
}

/// 显示侧栏：从屏幕外侧平滑滑入，并在结束后交出焦点。
pub fn show_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    let (final_x, offscreen_x, y, width, height) = sidebar_geometry(app, layout)?;

    sidebar.set_size(LogicalSize::new(width, height))?;
    // 先摆到屏幕外再显示，避免出现一帧停在最终位置再跳回去。
    sidebar.set_position(LogicalPosition::new(offscreen_x, y))?;
    sidebar.show()?;
    sidebar.set_focus()?;

    let duration = layout.duration();
    if duration == 0 {
        sidebar.set_position(LogicalPosition::new(final_x, y))?;
        return Ok(());
    }
    // 动画放到后台线程，避免阻塞调用方与主线程事件循环。
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        animate_x(&handle, offscreen_x, final_x, y, duration);
    });
    Ok(())
}

/// 隐藏侧栏：先平滑滑出屏幕，再真正隐藏窗口。
pub fn hide_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if !sidebar.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let (final_x, offscreen_x, y, _, _) = sidebar_geometry(app, layout)?;

    let duration = layout.duration();
    if duration == 0 {
        sidebar.hide()?;
        return Ok(());
    }
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        animate_x(&handle, final_x, offscreen_x, y, duration);
        let _ = handle.hide();
        // 收起后复位到贴边位置，避免下次淡入时从错误坐标开始。
        let _ = handle.set_position(LogicalPosition::new(final_x, y));
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

/// 显示设置窗口：居中并交出焦点。
pub fn show_settings(app: &AppHandle) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    settings.center()?;
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
