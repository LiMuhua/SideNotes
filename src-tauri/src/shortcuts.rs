//! 全局快捷键：呼出速记与呼出侧栏注册为系统级热键，SideNotes 在其他程序获得焦点时也能唤出。
//!
//! 按键可在设置中更换，保存在设置的 `shortcuts` 中，写法与前端 core/shortcuts 一致（如 Ctrl+Shift+Space），
//! 启动时按设置注册。注册失败（多半被其他程序占用）不阻断启动，记下失败的编号由设置页提示；
//! 在设置中更换时实际注册一次新的按键，被占用时恢复原样并返回原因。
//!
//! 按下时直接在这里切换窗口，不经过前端页面：页面卡住或崩溃时快捷键照样有效；以前由页面订阅事件再切换，
//! 开发模式下同一事件订阅了两次，按一次切换两次，窗口显示后立刻又被收起。

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::commands::HotkeyState;
use crate::error::{AppError, AppResult};

/// 可以设置的全局快捷键：编号与默认按键。capture 切换速记浮窗，sidebar 切换侧栏。
const BINDINGS: [(&str, &str); 2] = [("capture", "Ctrl+Shift+Space"), ("sidebar", "Alt+Shift+S")];

fn other(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

/// 设置中的写法换成插件认识的写法：修饰键小写，键名取 W3C 的物理按键名（KeyS、Digit1、Backquote……）。
/// 无法识别时返回 None。
pub fn accelerator(combo: &str) -> Option<String> {
    let mut parts: Vec<&str> = combo.split('+').collect();
    let key = parts.pop()?;
    let mut tokens = Vec::with_capacity(parts.len() + 1);
    for modifier in parts {
        tokens.push(match modifier {
            "Ctrl" => "ctrl",
            "Alt" => "alt",
            "Shift" => "shift",
            "Win" => "super",
            _ => return None,
        });
    }
    let named = match key {
        "Up" => "ArrowUp",
        "Down" => "ArrowDown",
        "Left" => "ArrowLeft",
        "Right" => "ArrowRight",
        "`" => "Backquote",
        "-" => "Minus",
        "=" => "Equal",
        "[" => "BracketLeft",
        "]" => "BracketRight",
        "\\" => "Backslash",
        ";" => "Semicolon",
        "'" => "Quote",
        "," => "Comma",
        "." => "Period",
        "/" => "Slash",
        "Space" | "Enter" | "Tab" | "Backspace" | "Delete" | "Insert" | "Home" | "End" | "PageUp" | "PageDown" | "Escape" => key,
        _ => "",
    };
    let code = if !named.is_empty() {
        named.to_string()
    } else if key.len() == 1 && key.chars().all(|character| character.is_ascii_uppercase()) {
        format!("Key{key}")
    } else if key.len() == 1 && key.chars().all(|character| character.is_ascii_digit()) {
        format!("Digit{key}")
    } else if key.strip_prefix('F').and_then(|number| number.parse::<u8>().ok()).is_some_and(|number| (1..=24).contains(&number)) {
        key.to_string()
    } else {
        return None;
    };
    let mut accelerator = tokens.join("+");
    if !accelerator.is_empty() {
        accelerator.push('+');
    }
    accelerator.push_str(&code);
    Some(accelerator)
}

fn parse(combo: &str) -> AppResult<Shortcut> {
    accelerator(combo)
        .and_then(|value| value.parse::<Shortcut>().ok())
        .ok_or_else(|| other("无法识别的快捷键"))
}

/// 设置中保存的全局快捷键：编号与按键；没有保存或写法无效时用默认按键。
fn configured(settings: &serde_json::Value) -> Vec<(&'static str, String)> {
    BINDINGS
        .iter()
        .map(|(id, default)| {
            let combo = settings
                .get("shortcuts")
                .and_then(|shortcuts| shortcuts.get(*id))
                .and_then(serde_json::Value::as_str)
                .filter(|combo| accelerator(combo).is_some())
                .unwrap_or(default);
            (*id, combo.to_string())
        })
        .collect()
}

/// 按下全局快捷键：切换速记浮窗或侧栏（侧栏用前端最近一次给出的布局）。
fn trigger(app: &AppHandle, id: &str) {
    let result = match id {
        "capture" => crate::windows::toggle_capture(app),
        _ => crate::windows::toggle_sidebar(app, &crate::windows::last_layout()),
    };
    match result {
        Ok(shown) => crate::diag::log(format!("快捷键 {id}：{}", if shown { "显示" } else { "收起" })),
        Err(error) => crate::diag::log(format!("快捷键 {id} 失败：{error}")),
    }
}

/// 注册编号为 `id` 的全局快捷键。
fn register(app: &AppHandle, id: &'static str, combo: &str) -> AppResult<()> {
    let shortcut = parse(combo)?;
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, state| {
            // 只响应按下，避免松开时重复切换。
            if state.state() == ShortcutState::Pressed {
                trigger(app, id);
            }
        })
        .map_err(|_| other("已被其他程序占用，请换一个"))
}

fn unregister(app: &AppHandle, combo: &str) {
    if let Ok(shortcut) = parse(combo) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

/// 启动时按设置注册全部全局快捷键；注册失败的记入 `failed`，按键仍记作当前设置。
pub fn register_all(app: &AppHandle, settings: &serde_json::Value) -> HotkeyState {
    let mut state = HotkeyState::default();
    for (id, combo) in configured(settings) {
        if register(app, id, &combo).is_err() {
            state.failed.push(id.to_string());
        }
        state.bound.insert(id.to_string(), combo);
    }
    state
}

/// 更换全局快捷键（编号 → 按键，没有给出的保持不变）。
///
/// 先注销要更换的按键，再注册新的；有一个注册失败就恢复原样并返回原因。一次更换多个时按键可以互换，
/// 例如两个全局快捷键对调过，恢复默认时各自要用对方正占着的按键。给出的按键与当前相同、
/// 但启动时没能注册的，再注册一次；没有给出的即使注册失败也不重试，以免连累这次更换。
pub fn apply(app: &AppHandle, hotkeys: &Mutex<HotkeyState>, wanted: &HashMap<String, String>) -> AppResult<()> {
    let mut state = hotkeys.lock().map_err(|_| other("快捷键状态异常，请重启应用"))?;
    let mut next = state.bound.clone();
    for (id, combo) in wanted {
        if !BINDINGS.iter().any(|(key, _)| key == id) {
            return Err(other("未知的全局快捷键"));
        }
        parse(combo)?;
        next.insert(id.clone(), combo.clone());
    }
    let mut seen = HashSet::new();
    if !next.values().all(|combo| seen.insert(combo)) {
        return Err(other("两个全局快捷键不能相同"));
    }

    // 要重新注册的：给出的按键与正在生效的不同，或者原来就没有注册成功。
    let changes: Vec<(&'static str, Option<String>, String)> = BINDINGS
        .iter()
        .filter_map(|(id, _)| {
            let combo = wanted.get(*id)?.clone();
            let active = state.bound.get(*id).filter(|_| !state.failed.iter().any(|failed| failed == id)).cloned();
            (active.as_deref() != Some(combo.as_str())).then_some((*id, active, combo))
        })
        .collect();
    for (_, active, _) in &changes {
        if let Some(previous) = active {
            unregister(app, previous);
        }
    }
    let mut registered: Vec<&str> = Vec::new();
    for (id, _, combo) in &changes {
        if let Err(error) = register(app, *id, combo) {
            for combo in registered {
                unregister(app, combo);
            }
            for (id, active, _) in &changes {
                if let Some(previous) = active {
                    if register(app, *id, previous).is_err() && !state.failed.iter().any(|failed| failed == id) {
                        state.failed.push((*id).to_string());
                    }
                }
            }
            return Err(error);
        }
        registered.push(combo);
    }
    state.failed.retain(|failed| !changes.iter().any(|(id, _, _)| id == failed));
    state.bound = next;
    Ok(())
}

/// 注销全部热键，退出时调用。
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_combos_into_accelerators_the_plugin_accepts() {
        assert_eq!(accelerator("Ctrl+Shift+Space").as_deref(), Some("ctrl+shift+Space"));
        assert_eq!(accelerator("Alt+Shift+S").as_deref(), Some("alt+shift+KeyS"));
        assert_eq!(accelerator("Ctrl+Win+[").as_deref(), Some("ctrl+super+BracketLeft"));
        assert_eq!(accelerator("Ctrl+Alt+F12").as_deref(), Some("ctrl+alt+F12"));
        assert_eq!(accelerator("Ctrl+Hyper+A"), None);
        assert_eq!(accelerator("Ctrl+F25"), None);
        let keys = ["A", "Z", "0", "9", "F1", "F24", "Space", "Enter", "Up", "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/"];
        for key in keys {
            let combo = format!("Ctrl+Alt+{key}");
            assert!(parse(&combo).is_ok(), "{combo} 应能被插件识别");
        }
    }

    #[test]
    fn reads_configured_bindings_with_defaults() {
        let settings = serde_json::json!({ "shortcuts": { "capture": "Ctrl+Alt+N", "sidebar": "Hyper+X" } });
        let combos: Vec<String> = configured(&settings).into_iter().map(|(_, combo)| combo).collect();
        assert_eq!(combos, vec!["Ctrl+Alt+N".to_string(), "Alt+Shift+S".to_string()]);
        let defaults: Vec<String> = configured(&serde_json::Value::Null).into_iter().map(|(_, combo)| combo).collect();
        assert_eq!(defaults, vec!["Ctrl+Shift+Space".to_string(), "Alt+Shift+S".to_string()]);
    }
}
