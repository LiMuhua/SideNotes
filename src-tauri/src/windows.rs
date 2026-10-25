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
}

/// 取得窗口；窗口缺失说明配置与运行状态不一致。
fn window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::Other(format!("窗口 {label} 不存在")))
}

/// 按当前鼠标所在显示器的工作区对齐侧栏。
///
/// 使用工作区而非完整屏幕尺寸，避免覆盖任务栏；按缩放因子换算为逻辑坐标，
/// 保证高 DPI 下宽度与前端设置一致。
pub fn align_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
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
    let x = if layout.edge == "left" {
        area_x
    } else {
        area_x + area_width - width
    };

    sidebar.set_size(LogicalSize::new(width, area_height))?;
    sidebar.set_position(LogicalPosition::new(x, area_y))?;
    Ok(())
}

/// 显示侧栏并交出焦点，必要时先重新对齐。
pub fn show_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    align_sidebar(app, layout)?;
    let sidebar = window(app, SIDEBAR_LABEL)?;
    sidebar.show()?;
    sidebar.set_focus()?;
    Ok(())
}

/// 隐藏侧栏，界面完全消失并把焦点交回原应用。
pub fn hide_sidebar(app: &AppHandle) -> AppResult<()> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    sidebar.hide()?;
    Ok(())
}

/// 切换侧栏可见性，返回切换后的状态。
pub fn toggle_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<bool> {
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if sidebar.is_visible().unwrap_or(false) {
        sidebar.hide()?;
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

/// 切换设置窗口可见性，返回切换后的状态。
pub fn toggle_settings(app: &AppHandle) -> AppResult<bool> {
    let settings = window(app, SETTINGS_LABEL)?;
    if settings.is_visible().unwrap_or(false) {
        settings.hide()?;
        Ok(false)
    } else {
        show_settings(app)?;
        Ok(true)
    }
}
