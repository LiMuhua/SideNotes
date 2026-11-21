//! 系统托盘：隐藏侧栏后应用仍可取用的唯一入口。

use std::sync::Mutex;

use tauri::menu::{IconMenuItem, Menu, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

use crate::error::AppResult;
use crate::menu_icons::{self, Glyph};
use crate::windows::{CAPTURE_LABEL, SIDEBAR_LABEL};

/// 托盘菜单里带图标的各项，与画图标时系统的明暗：系统换了明暗时重画（见 refresh_icons）。
struct TrayIcons {
    items: Vec<(IconMenuItem<Wry>, Glyph)>,
    dark: Mutex<bool>,
}

/// 构建托盘图标与菜单。左键单击显示侧栏，右键展开菜单。
///
/// 显示侧栏与速记浮窗直接在这里完成（侧栏用前端最近一次给出的布局），不经过侧栏页面的脚本：
/// 页面卡住或崩溃时，托盘仍能把窗口叫出来。设置与退出要用到前端的状态，仍发给前端处理。
/// 菜单每项前面一个朴素的线条图标（第九轮反馈 7，参照 Wallpaper Engine 的托盘菜单），文字不带省略号。
pub fn setup(app: &AppHandle) -> AppResult<()> {
    let dark = menu_icons::system_dark();
    let item = |id: &str, text: &str, glyph: Glyph| {
        IconMenuItem::with_id(app, id, text, true, Some(menu_icons::image(glyph, dark)), None::<&str>)
    };
    let open_sidebar = item("tray-sidebar", "显示侧栏", Glyph::Sidebar)?;
    let open_capture = item("tray-capture", "快捷速记", Glyph::Capture)?;
    let settings = item("tray-settings", "设置", Glyph::Settings)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = item("tray-quit", "退出", Glyph::Quit)?;
    let menu = Menu::with_items(
        app,
        &[&open_sidebar, &open_capture, &separator, &settings, &separator, &quit],
    )?;
    app.manage(TrayIcons {
        items: vec![(open_sidebar, Glyph::Sidebar), (open_capture, Glyph::Capture), (settings, Glyph::Settings), (quit, Glyph::Quit)],
        dark: Mutex::new(dark),
    });

    TrayIconBuilder::with_id("sidenotes-tray")
        .tooltip("SideNotes · 侧栏速记")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            crate::error::AppError::Other("缺少应用图标，无法创建托盘".into())
        })?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-sidebar" => {
                if let Err(error) = crate::windows::show_sidebar(app, &crate::windows::last_layout()) {
                    crate::diag::log(format!("托盘菜单显示侧栏失败：{error}"));
                }
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
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                if let Err(error) = crate::windows::show_sidebar(tray.app_handle(), &crate::windows::last_layout()) {
                    crate::diag::log(format!("单击托盘显示侧栏失败：{error}"));
                }
            }
            // 菜单在右键松开时弹出，按下时先按系统现在的明暗把图标画好。
            TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Down, .. } => {
                refresh_icons(tray.app_handle());
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// 系统换了明暗（托盘菜单跟着系统的应用明暗画深色或浅色）：按新的明暗重画各项的图标。
fn refresh_icons(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayIcons>() else { return };
    let dark = menu_icons::system_dark();
    let Ok(mut current) = state.dark.lock() else { return };
    if *current == dark {
        return;
    }
    *current = dark;
    for (item, glyph) in &state.items {
        let _ = item.set_icon(Some(menu_icons::image(*glyph, dark)));
    }
}

/// 退出前隐藏所有窗口，避免关闭动画期间出现残留。
pub fn hide_all<R: Runtime>(app: &AppHandle<R>) {
    for label in [SIDEBAR_LABEL, CAPTURE_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}
