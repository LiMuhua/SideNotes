//! 全局快捷键注册。
//!
//! 原型的三个呼出快捷键在网页内只能作为页面级事件；桌面端注册为系统级热键，
//! 使 SideNotes 在其他应用获得焦点时也能唤出。注册失败（例如被其他软件占用）
//! 不阻断启动，改为回传失败列表由设置页提示。

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 需要注册的热键及其事件名。
const BINDINGS: &[(&str, &str)] = &[
    // 呼出速记浮窗。
    ("ctrl+shift+space", "sidenotes://hotkey-capture"),
    // 呼出侧栏并聚焦新建输入。
    ("alt+shift+s", "sidenotes://hotkey-sidebar"),
];

/// 注册全部热键，返回注册失败的组合。
pub fn register_all(app: &AppHandle) -> Vec<String> {
    let mut failed = Vec::new();
    let manager = app.global_shortcut();

    for (combination, event) in BINDINGS {
        let Ok(shortcut) = combination.parse::<Shortcut>() else {
            failed.push((*combination).to_string());
            continue;
        };
        let handle = app.clone();
        let event_name = (*event).to_string();
        let result = manager.on_shortcut(shortcut, move |_app, _shortcut, state| {
            // 只响应按下，避免松开时重复切换。
            if state.state() == ShortcutState::Pressed {
                let _ = handle.emit(event_name.as_str(), ());
            }
        });
        if result.is_err() {
            failed.push((*combination).to_string());
        }
    }
    failed
}

/// 注销全部热键，供设置变更或退出时调用。
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}
