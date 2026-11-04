//! 录入快捷键：设置页更换快捷键时，临时接管键盘，把按下的组合原样交给设置页。
//!
//! 被其他程序注册为全局热键的组合，按下时系统直接交给那个程序，设置窗口收不到按键，
//! 只靠网页的按键事件既录不进来，也就无从提示冲突。录入期间在 Windows 上安装低级键盘钩子：
//! 它先于系统的热键处理看到按键，录下组合后吞掉，其他程序与 SideNotes 自己的全局快捷键都不会被触发；
//! 录到的全局快捷键再由 shortcuts::apply 实际注册一次，被占用时设置页提示。
//!
//! 钩子装在辅助进程里：本应用的窗口在前台时，系统不会调用本进程装下的低级键盘钩子
//! （实测如此，同样的钩子装在另一个进程里就能收到按键）。辅助进程就是应用自身，以
//! `--record-shortcut <设置窗口句柄>` 启动，钩子装好后写一行 ready，之后把按键状态逐行写成 JSON；
//! 设置窗口转到后台、超过一分钟，或应用结束录入、关闭了它的标准输入（包括应用退出）时，卸载钩子并退出。
//! 其他平台不支持，设置页改用网页的按键事件录入。

// 其他平台只保留接口，按键的整理与状态只在 Windows 的钩子中使用。
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::AppResult;

/// 录入期间的按键事件，载荷为 RecordedKeys，只发给设置窗口。
pub const RECORDED_EVENT: &str = "sidenotes://shortcut-recorded";

/// 辅助进程的启动参数，后面跟设置窗口的句柄。
pub const HELPER_ARG: &str = "--record-shortcut";

/// 辅助进程装好钩子后写出的第一行。
const READY: &str = "ready";

/// 录入期间的按键：按住的修饰键与按下的完整组合，写法与前端 core/shortcuts 一致（如 Ctrl+Shift+K）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedKeys {
    /// 正按住的修饰键，如 Ctrl+Shift；没有按住时为空。
    pub modifiers: String,
    /// 按下的完整组合；只按修饰键时为空。
    pub combo: Option<String>,
    /// 录入已经结束（设置窗口转到后台或超时），设置页据此退出录入状态。
    pub ended: bool,
}

const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const WIN: u8 = 8;

/// 修饰键的虚拟键码对应的标记；钩子收到的是区分左右的键码，模拟输入也可能给出不分左右的。
fn modifier_of(vk: u32) -> Option<u8> {
    match vk {
        0x11 | 0xA2 | 0xA3 => Some(CTRL),
        0x12 | 0xA4 | 0xA5 => Some(ALT),
        0x10 | 0xA0 | 0xA1 => Some(SHIFT),
        0x5B | 0x5C => Some(WIN),
        _ => None,
    }
}

/// 按住的修饰键，按 Ctrl、Alt、Shift、Win 的顺序写出。
fn modifiers_text(bits: u8) -> String {
    [(CTRL, "Ctrl"), (ALT, "Alt"), (SHIFT, "Shift"), (WIN, "Win")]
        .iter()
        .filter(|(bit, _)| bits & bit != 0)
        .map(|(_, name)| *name)
        .collect::<Vec<_>>()
        .join("+")
}

/// 虚拟键码对应的键名，与前端按物理按键取的键名一致；不支持的按键（小键盘数字、媒体键等）返回 None。
/// 符号键按美式键盘的位置命名，与全局快捷键插件把键名换算为键码的方式相同。
fn key_name(vk: u32) -> Option<String> {
    let name = match vk {
        0x30..=0x39 | 0x41..=0x5A => return char::from_u32(vk).map(String::from),
        0x70..=0x87 => return Some(format!("F{}", vk - 0x6F)),
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0D => "Enter",
        0x1B => "Escape",
        0x20 => "Space",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "Left",
        0x26 => "Up",
        0x27 => "Right",
        0x28 => "Down",
        0x2D => "Insert",
        0x2E => "Delete",
        0xBA => ";",
        0xBB => "=",
        0xBC => ",",
        0xBD => "-",
        0xBE => ".",
        0xBF => "/",
        0xC0 => "`",
        0xDB => "[",
        0xDC => "\\",
        0xDD => "]",
        0xDE => "'",
        _ => return None,
    };
    Some(name.to_string())
}

/// 修饰键加上按键写成完整的组合。
fn combo_text(bits: u8, key: &str) -> String {
    let modifiers = modifiers_text(bits);
    if modifiers.is_empty() {
        key.to_string()
    } else {
        format!("{modifiers}+{key}")
    }
}

/// 录入中的按键状态：按住了哪些修饰键、哪个普通键还没松开。与系统交互的部分无关，便于单独测试。
#[derive(Debug, Default)]
struct KeyState {
    modifiers: u8,
    /// 还没松开的普通键；按住不放时的自动重复不再重复录入。
    held: Option<u32>,
}

/// 一次按键的处理结果。
#[derive(Debug, Default, PartialEq)]
struct Outcome {
    /// 吞掉这次按键，不交给系统与其他程序。
    swallow: bool,
    /// 发给设置页的按键状态。
    report: Option<RecordedKeys>,
}

impl KeyState {
    /// 只吞掉认识的按键的按下。不认识的按键（小键盘数字、媒体键等）交还系统，录入期间仍可调节音量；
    /// 松开一律交还：按下发生在录入之前的键（例如点击时按住的 Ctrl），松开若被吞掉，系统会一直当它按着。
    fn handle(&mut self, vk: u32, down: bool) -> Outcome {
        if let Some(bit) = modifier_of(vk) {
            let before = self.modifiers;
            if down {
                self.modifiers |= bit;
            } else {
                self.modifiers &= !bit;
            }
            // 修饰键按住不放时的自动重复不再通知。
            let report = (self.modifiers != before)
                .then(|| RecordedKeys { modifiers: modifiers_text(self.modifiers), ..RecordedKeys::default() });
            return Outcome { swallow: down, report };
        }
        let Some(key) = key_name(vk) else {
            return Outcome::default();
        };
        if !down {
            if self.held == Some(vk) {
                self.held = None;
            }
            return Outcome::default();
        }
        if self.held == Some(vk) {
            return Outcome { swallow: true, report: None };
        }
        self.held = Some(vk);
        let report = RecordedKeys {
            modifiers: modifiers_text(self.modifiers),
            combo: Some(combo_text(self.modifiers, &key)),
            ended: false,
        };
        Outcome { swallow: true, report: Some(report) }
    }
}

#[cfg(windows)]
mod native {
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, ChildStdout, Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex, MutexGuard};
    use std::time::Duration;

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetForegroundWindow, GetMessageW, KillTimer, PeekMessageW, PostQuitMessage, PostThreadMessageW,
        SetTimer, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN, WM_TIMER, WM_USER,
    };

    use super::{KeyState, RecordedKeys, HELPER_ARG, READY, RECORDED_EVENT};
    use crate::error::{AppError, AppResult};
    use crate::windows::SETTINGS_LABEL;

    /* ==================== 应用一侧：启动辅助进程，转发按键 ==================== */

    /// 正在进行的录入：编号与辅助进程。设置页按编号结束录入，快速切换时上一次的结束不会停掉这一次。
    struct Recording {
        session: u64,
        helper: Child,
    }

    static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);
    static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
    /// 开始录入依次进行：两次开始交错时，后一次会覆盖前一次刚启动的辅助进程，留下没人结束的钩子。
    static STARTING: Mutex<()> = Mutex::new(());

    fn recording() -> MutexGuard<'static, Option<Recording>> {
        RECORDING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn other(message: impl Into<String>) -> AppError {
        AppError::Other(message.into())
    }

    fn report(app: &AppHandle, keys: RecordedKeys) {
        let _ = app.emit_to(SETTINGS_LABEL, RECORDED_EVENT, keys);
    }

    pub fn start(app: &AppHandle) -> AppResult<u64> {
        let _starting = STARTING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let window = app.get_webview_window(SETTINGS_LABEL).ok_or_else(|| other("设置窗口不存在"))?;
        let window = window.hwnd()?.0 as isize;
        // 同一时间只有一次录入。
        let previous = recording().take();
        if let Some(previous) = previous {
            finish(previous);
        }
        // 辅助进程不需要控制台窗口：调试版是控制台程序，不加这个标志会弹出一个。
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut helper = Command::new(std::env::current_exe()?)
            .args([HELPER_ARG, &window.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        let output = helper.stdout.take().ok_or_else(|| other("无法录入按键"))?;
        let session = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
        *recording() = Some(Recording { session, helper });
        let (ready, wait) = mpsc::channel();
        let handle = app.clone();
        // 线程没能启动时发送端随之丢弃，下面的等待立即失败。
        let _ = std::thread::Builder::new()
            .name("shortcut-recorder".into())
            .spawn(move || forward(handle, session, output, ready));
        // 等钩子装好再返回：在此之前按下的键，设置页仍用网页的按键事件录入。
        if wait.recv_timeout(Duration::from_secs(3)).is_err() {
            stop(session);
            return Err(other("无法录入按键"));
        }
        Ok(session)
    }

    pub fn stop(session: u64) {
        let mut current = recording();
        if current.as_ref().is_some_and(|item| item.session == session) {
            if let Some(item) = current.take() {
                drop(current);
                finish(item);
            }
        }
    }

    /// 结束辅助进程，钩子随进程退出卸载。
    fn finish(mut item: Recording) {
        let _ = item.helper.kill();
        let _ = item.helper.wait();
    }

    /// 转发辅助进程写出的按键。辅助进程自己退出时（设置窗口转到后台、超时或出错），通知设置页结束录入。
    fn forward(app: AppHandle, session: u64, output: ChildStdout, ready: mpsc::Sender<()>) {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else {
                break;
            };
            if line == READY {
                let _ = ready.send(());
            } else if let Ok(keys) = serde_json::from_str::<RecordedKeys>(&line) {
                report(&app, keys);
            }
        }
        let mut current = recording();
        if current.as_ref().is_some_and(|item| item.session == session) {
            if let Some(item) = current.take() {
                drop(current);
                finish(item);
                report(&app, RecordedKeys { ended: true, ..RecordedKeys::default() });
            }
        }
    }

    /* ==================== 辅助进程：装钩子，写出按键 ==================== */

    /// 录入最长持续的时间，超时自动结束，以免钩子一直留着。
    const LIMIT_MS: u32 = 60_000;

    /// 辅助进程中的录入状态：设置窗口的句柄（只在它位于前台时接管按键）与按键状态。
    struct Helper {
        window: isize,
        keys: KeyState,
    }

    static HELPER: Mutex<Option<Helper>> = Mutex::new(None);

    fn helper_state() -> MutexGuard<'static, Option<Helper>> {
        HELPER.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 写一行交给应用。应用已经退出时写入失败，它的标准输入随之关闭，辅助进程自行退出。
    fn send(line: &str) {
        let mut output = std::io::stdout().lock();
        let _ = writeln!(output, "{line}");
        let _ = output.flush();
    }

    pub fn helper(window: isize) {
        *helper_state() = Some(Helper { window, keys: KeyState::default() });
        let mut message = MSG::default();
        // SAFETY：只建立本线程的消息队列并读取线程编号；有了消息队列，PostThreadMessageW 才能送达。
        let thread = unsafe {
            let _ = PeekMessageW(&mut message, None, WM_USER, WM_USER, PM_NOREMOVE);
            GetCurrentThreadId()
        };
        // 应用结束录入或退出时，标准输入随之关闭。
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
            // SAFETY：只向本进程装钩子的线程投递一条不带参数的退出消息。
            let _ = unsafe { PostThreadMessageW(thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
        });
        // SAFETY：钩子回调是本模块的函数；其余调用只涉及本线程的消息队列与本函数内的局部变量。
        unsafe {
            let module = GetModuleHandleW(None).ok().map(HINSTANCE::from);
            let Ok(hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0) else {
                return;
            };
            send(READY);
            let timer = SetTimer(None, 0, LIMIT_MS, None);
            // GetMessageW 收到 WM_QUIT 时返回 0，出错时返回 -1。线程没有窗口，消息无需分发。
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                if message.message == WM_TIMER {
                    break;
                }
            }
            let _ = KillTimer(None, timer);
            let _ = UnhookWindowsHookEx(hook);
        }
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // SAFETY：HC_ACTION 时 lparam 指向系统传入的 KBDLLHOOKSTRUCT，回调期间有效。
            let vk = unsafe { (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode };
            let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            if handle(vk, down) {
                return LRESULT(1);
            }
        }
        // SAFETY：把按键原样交给下一个钩子。
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// 处理一次按键，返回是否吞掉。
    fn handle(vk: u32, down: bool) -> bool {
        let mut state = helper_state();
        let Some(item) = state.as_mut() else {
            return false;
        };
        // 设置窗口不在前台（点到了别处、锁屏或切换了桌面）：交还键盘并退出，应用随后通知设置页结束录入。
        // SAFETY：GetForegroundWindow 没有参数，只读取当前前台窗口。
        if unsafe { GetForegroundWindow() }.0 as isize != item.window {
            *state = None;
            // SAFETY：回调运行在装钩子的线程上，PostQuitMessage 让它的消息循环结束并卸载钩子。
            unsafe { PostQuitMessage(0) };
            return false;
        }
        let outcome = item.keys.handle(vk, down);
        if let Some(line) = outcome.report.and_then(|keys| serde_json::to_string(&keys).ok()) {
            send(&line);
        }
        outcome.swallow
    }
}

/// 开始录入：启动辅助进程接管键盘，按下的组合经 RECORDED_EVENT 发给设置窗口，返回录入编号。
/// 当前平台不支持时返回错误。
pub fn start(app: &AppHandle) -> AppResult<u64> {
    #[cfg(windows)]
    return native::start(app);
    #[cfg(not(windows))]
    {
        let _ = app;
        Err(crate::error::AppError::Other("当前平台不支持由后端录入按键".into()))
    }
}

/// 结束编号为 `session` 的录入，辅助进程退出时钩子随之卸载；已经结束或换成了新一次录入时什么也不做。
pub fn stop(session: u64) {
    #[cfg(windows)]
    native::stop(session);
    #[cfg(not(windows))]
    let _ = session;
}

/// 以辅助进程身份启动时（命令行为 `--record-shortcut <设置窗口句柄>`）录入按键，结束后返回 true；
/// 不是辅助进程时返回 false，照常启动应用。
pub fn run_helper() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(HELPER_ARG) {
        return false;
    }
    #[cfg(windows)]
    if let Some(window) = args.next().and_then(|value| value.parse::<isize>().ok()) {
        native::helper(window);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_keys_between_processes_as_json_lines() {
        let keys = RecordedKeys { modifiers: "Ctrl+Shift".into(), combo: Some("Ctrl+Shift+K".into()), ended: false };
        let line = serde_json::to_string(&keys).unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(line, r#"{"modifiers":"Ctrl+Shift","combo":"Ctrl+Shift+K","ended":false}"#);
        assert_eq!(serde_json::from_str::<RecordedKeys>(&line).unwrap(), keys);
        assert!(serde_json::from_str::<RecordedKeys>(READY).is_err());
    }

    fn combo(outcome: Outcome) -> Option<String> {
        assert!(outcome.swallow, "录到组合的按下应被吞掉");
        outcome.report.and_then(|keys| keys.combo)
    }

    fn held(modifiers: &str, swallow: bool) -> Outcome {
        let report = RecordedKeys { modifiers: modifiers.into(), ..RecordedKeys::default() };
        Outcome { swallow, report: Some(report) }
    }

    #[test]
    fn names_keys_like_the_frontend() {
        assert_eq!(key_name(0x4B).as_deref(), Some("K"));
        assert_eq!(key_name(0x35).as_deref(), Some("5"));
        assert_eq!(key_name(0x7B).as_deref(), Some("F12"));
        assert_eq!(key_name(0x87).as_deref(), Some("F24"));
        assert_eq!(key_name(0xDB).as_deref(), Some("["));
        assert_eq!(key_name(0xC0).as_deref(), Some("`"));
        assert_eq!(key_name(0x20).as_deref(), Some("Space"));
        // 小键盘数字与音量键不支持。
        assert_eq!(key_name(0x61), None);
        assert_eq!(key_name(0xAF), None);
        assert_eq!(combo_text(CTRL | SHIFT | WIN | ALT, "S"), "Ctrl+Alt+Shift+Win+S");
        assert_eq!(combo_text(0, "F5"), "F5");
    }

    #[test]
    fn records_modifiers_and_the_combo_once() {
        let mut state = KeyState::default();
        // 按住右 Ctrl 与左 Shift，界面上显示正按住的修饰键。
        assert_eq!(state.handle(0xA3, true), held("Ctrl", true));
        assert_eq!(state.handle(0xA0, true), held("Ctrl+Shift", true));
        // 修饰键自动重复时状态不变，不再通知。
        assert_eq!(state.handle(0xA0, true), Outcome { swallow: true, report: None });
        assert_eq!(combo(state.handle(0x4B, true)).as_deref(), Some("Ctrl+Shift+K"));
        // 按住不放的自动重复只录一次；松开交还系统，之后再按又能录入。
        assert_eq!(state.handle(0x4B, true), Outcome { swallow: true, report: None });
        assert_eq!(state.handle(0x4B, false), Outcome::default());
        assert_eq!(combo(state.handle(0x4B, true)).as_deref(), Some("Ctrl+Shift+K"));
        // 松开修饰键同样交还系统，只通知设置页。
        assert_eq!(state.handle(0xA0, false), held("Ctrl", false));
        assert_eq!(combo(state.handle(0x4A, true)).as_deref(), Some("Ctrl+J"));
        // 不认识的按键交还系统。
        assert_eq!(state.handle(0xAF, true), Outcome::default());
    }
}
