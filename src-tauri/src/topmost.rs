//! 置顶状态的守护（T106、T113，技术决策第 47 条）。
//!
//! - 置顶可能被别处取消：系统的文件对话框、别的程序、「显示桌面」之后的还原，都可能把置顶的窗口插到普通窗口后面
//!   （侧栏等原来交给同一个隐藏的所有者，一个取消置顶还会连带其它窗口；T120 起它们是面板，不再交给所有者）。
//!   tao 记着自己设过的置顶标志，标志没变时 `set_always_on_top(true)` 什么也不做，丢了的置顶补不回来，
//!   侧栏的置顶按钮亮着，切到别的程序却被盖住。所以这里直接调用 SetWindowPos，
//!   并由一个后台线程每隔 GUARD_INTERVAL 检查一次应当置顶的窗口，丢了就补回，写进诊断日志。
//! - Win+D（显示桌面）不碰固定的侧栏与置顶的窗口：它们是面板，见 panels。之前「按过 Win+D 侧栏唤不出」是侧栏被系统
//!   藏起或丢了置顶，tao 仍以为它显示着，快捷键与贴边都不做事；上面的守护与下面的显示补救让它不再发生。
//! - tao 记着自己的显示状态，窗口被系统藏起或最小化时它不知道，`show()` 什么也不做：显示与隐藏这几个窗口走这里的
//!   `show`、`hide`，tao 没有真的显示（或隐藏）时直接补上；显示之前先还原被最小化的窗口（restore_if_minimized）。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::windows::{CAPTURE_LABEL, SETTINGS_LABEL, SIDEBAR_LABEL};

/// 后台检查置顶的间隔：丢了置顶最多这么久之后补回。只读一次窗口样式，开销可以忽略。
const GUARD_INTERVAL: Duration = Duration::from_millis(300);
/// 同一个窗口反复丢置顶时，日志最多这么久写一行。
const LOG_INTERVAL: Duration = Duration::from_secs(30);

/// 应当一直置顶的窗口，按检查的先后排列：动画层最后，补回置顶后它仍在最前面（它要盖住侧栏与记录窗口）。
fn desired(app: &AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = vec![SIDEBAR_LABEL.into(), CAPTURE_LABEL.into(), SETTINGS_LABEL.into(), crate::dialogs::DIALOG_LABEL.into()];
    labels.extend(crate::note_windows::topmost_windows());
    labels.push(crate::note_windows::OVERLAY_LABEL.into());
    labels.retain(|label| app.get_webview_window(label).is_some());
    labels
}

/// 启动守护：另起线程定时检查置顶。
pub fn install(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut logged: HashMap<String, Instant> = HashMap::new();
            loop {
                std::thread::sleep(GUARD_INTERVAL);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, &mut logged)));
                if result.is_err() {
                    crate::diag::log("置顶检查出错，已跳过这一次");
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// 一次检查：显示着却丢了置顶的窗口补回置顶。
#[cfg(windows)]
fn check(app: &AppHandle, logged: &mut HashMap<String, Instant>) {
    for label in desired(app) {
        let Some(window) = app.get_webview_window(&label) else { continue };
        if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) || is_topmost(&window) {
            continue;
        }
        raise(&window, true);
        let due = logged.get(&label).map_or(true, |last| last.elapsed() >= LOG_INTERVAL);
        if due {
            logged.insert(label.clone(), Instant::now());
            crate::diag::log(format!("窗口 {label} 丢了置顶，已补回（前台窗口：{}）", foreground()));
        }
    }
}

/// 显示窗口：交给 tao 显示；tao 记着「显示着」而窗口其实被系统藏了时，它的 `show()` 什么也不做，
/// 排在它后面（主线程上按顺序）补一次不激活的显示。
pub fn show(window: &WebviewWindow) {
    let _ = window.show();
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let value = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || {
            use ::windows::Win32::Foundation::HWND;
            use ::windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_SHOWNA};
            let hwnd = HWND(value as *mut core::ffi::c_void);
            // SAFETY：只对仍然存在的窗口操作（IsWindowVisible 对已销毁的句柄返回 false）。
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_SHOWNA);
                }
            }
        });
    }
}

/// 隐藏窗口：交给 tao 隐藏；tao 以为它本来就隐藏着时补一次。
pub fn hide(window: &WebviewWindow) {
    let _ = window.hide();
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let value = hwnd.0 as isize;
        let _ = window.run_on_main_thread(move || {
            use ::windows::Win32::Foundation::HWND;
            use ::windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE};
            let hwnd = HWND(value as *mut core::ffi::c_void);
            // SAFETY：同上。
            unsafe {
                if IsWindowVisible(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
            }
        });
    }
}

/// 窗口现在是否置顶（读扩展样式，与 tao 记的标志无关）。
pub fn is_topmost(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOPMOST};
        // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，只读样式。
        return unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0;
    }
    #[cfg(not(windows))]
    let _ = window;
    false
}

/// 直接让窗口置顶或取消置顶，不激活、不移动。异步执行，不等窗口所在的线程处理完（后台线程上调用时不会卡住）。
fn raise(window: &WebviewWindow, on: bool) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let after = if on { HWND_TOPMOST } else { HWND_NOTOPMOST };
        // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，其余参数都是按值传入的常量。
        let _ = unsafe { SetWindowPos(hwnd, Some(after), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_ASYNCWINDOWPOS) };
    }
    #[cfg(not(windows))]
    let _ = window.set_always_on_top(on);
}

/// 确保窗口置顶：tao 记着置顶时 `set_always_on_top(true)` 不做事，这里直接补上。
pub fn ensure_topmost(window: &WebviewWindow) {
    if !is_topmost(window) {
        raise(window, true);
    }
}

/// 设置窗口的置顶：同时更新 tao 记的标志（它在显示、隐藏时按标志重写样式），再直接设一次，
/// 标志与实际不一致（被系统连带取消过）时也能生效。
pub fn set_topmost(window: &WebviewWindow, on: bool) {
    let _ = window.set_always_on_top(on);
    if is_topmost(window) != on {
        raise(window, on);
    }
}

/// 窗口被最小化了就不激活地还原，返回是否还原过。
/// 还原后窗口是显示着的；调用方要按需要同步 tao 记的显示状态。
pub fn restore_if_minimized(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{IsIconic, ShowWindow, SW_SHOWNOACTIVATE};
        // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，其余参数都是按值传入的常量。
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                crate::diag::log(format!("窗口 {} 处于最小化，已还原", window.label()));
                return true;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window;
    false
}

/// 前台窗口的类名与进程号，写日志用。
#[cfg(windows)]
fn foreground() -> String {
    use ::windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY：只读查询，缓冲区在栈上并给出了正确的大小。
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return "无".into();
        }
        let mut buffer = [0u16; 128];
        let length = GetClassNameW(hwnd, &mut buffer).max(0) as usize;
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let own = if pid == std::process::id() { "，本应用" } else { "" };
        format!("{}，进程 {pid}{own}", String::from_utf16_lossy(&buffer[..length]))
    }
}
