//! 系统托盘：隐藏侧栏后应用仍可取用的唯一入口。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::AppResult;
use crate::windows::{CAPTURE_LABEL, SIDEBAR_LABEL};

/// 构建托盘图标与菜单。左键单击显示侧栏，右键展开菜单。
///
/// 显示侧栏与速记浮窗直接在这里完成（侧栏用前端最近一次给出的布局），不经过侧栏页面的脚本：
/// 页面卡住或崩溃时，托盘仍能把窗口叫出来。设置与退出要用到前端的状态，仍发给前端处理。
pub fn setup(app: &AppHandle) -> AppResult<()> {
    let open_sidebar = MenuItem::with_id(app, "tray-sidebar", "显示侧栏", true, None::<&str>)?;
    let open_capture = MenuItem::with_id(app, "tray-capture", "快捷速记", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray-settings", "设置…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 SideNotes", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open_sidebar, &open_capture, &separator, &settings, &separator, &quit],
    )?;

    TrayIconBuilder::with_id("sidenotes-tray")
        .tooltip("SideNotes · 侧栏速记")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            crate::error::AppError::Other("缺少应用图标，无法创建托盘".into())
        })?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-sidebar" => {
                let _ = crate::windows::show_sidebar(app, &crate::windows::last_layout());
            }
            "tray-capture" => {
                let _ = crate::windows::show_capture(app);
            }
            "tray-settings" => {
                let _ = app.emit("sidenotes://tray-settings", ());
            }
            "tray-quit" => {
                // 退出前通知前端提交草稿，由前端回调 quit 命令完成退出。
                let _ = app.emit("sidenotes://tray-quit", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = crate::windows::show_sidebar(tray.app_handle(), &crate::windows::last_layout());
            }
        })
        .build(app)?;
    Ok(())
}

/// 退出前隐藏所有窗口，避免关闭动画期间出现残留。
pub fn hide_all<R: Runtime>(app: &AppHandle<R>) {
    for label in [SIDEBAR_LABEL, CAPTURE_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}
