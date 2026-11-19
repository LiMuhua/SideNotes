//! 置顶状态的守护与 Win+D 防护（T106、T113，技术决策第 47 条）。
//!
//! 三个问题：
//! - 置顶会被系统连带取消：一个窗口取消置顶时，系统把它的所有者与所有者名下的其它窗口一起取消
//!   （侧栏、速记浮窗、弹窗与动画层同属一个隐藏的所有者，见 windows::create_owner_window）；
//!   系统的文件对话框、别的程序、「显示桌面」之后的还原，也可能把置顶的窗口插到普通窗口后面。
//!   tao 记着自己设过的置顶标志，标志没变时 `set_always_on_top(true)` 什么也不做，丢了的置顶补不回来，
//!   侧栏的置顶按钮亮着，切到别的程序却被盖住。所以这里直接调用 SetWindowPos，
//!   并由一个后台线程每隔 GUARD_INTERVAL 检查一次应当置顶的窗口，丢了就补回，写进诊断日志。
//! - Win+D（显示桌面）收走窗口：有任务栏按钮的窗口被最小化，交给隐藏所有者的窗口（侧栏、速记浮窗、弹窗、动画层）
//!   被直接藏起来。tao 不知道窗口被系统藏了，还记着「显示着」，`show()` 什么也不做：侧栏用快捷键、贴边都唤不出来，
//!   要再按一次 Win+D 等系统自己放出来（实测复现）。所以：
//!   - 显示与隐藏这几个窗口一律走这里的 `show`、`hide`：记下想让它显示还是隐藏，tao 没有真的显示（或隐藏）时直接补上；
//!   - 给它们挂一个窗口子类：想让它显示着的时候，别人要藏它（WM_WINDOWPOSCHANGING 带 SWP_HIDEWINDOW）就去掉这一项；
//!   - 主线程上装一个 WH_CBT 钩子，系统要最小化受保护的窗口时拒绝：上面这几个窗口一律保护，
//!     记录窗口在置顶（或附着在卡片旁）时保护。没有保护的窗口照常最小化；显示之前先还原（restore_if_minimized）。
//! - 留在桌面上的窗口会让第二次 Win+D 不再恢复别的窗口：系统按下 Win+D 时看到还有窗口显示着，就当桌面没有显示出来，
//!   又「显示桌面」一次（实测：置顶的记录窗口留着时，再按 Win+D 别的窗口回不来；按之前把它藏起来就能照常恢复）。
//!   所以用一个低级键盘钩子认出 Win+D，在系统处理之前把留在桌面上的窗口（显示着的受保护窗口）暂时藏起来，
//!   STEP_ASIDE 之后再放回原处（不激活、不改前后次序）。两次 Win+D 都是如此，系统照常显示桌面、照常恢复，
//!   置顶的窗口闪一下又回来。点任务栏角上的「显示桌面」没有按键可认，这时第二次点击不恢复别的窗口（已知问题）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::windows::{CAPTURE_LABEL, SETTINGS_LABEL, SIDEBAR_LABEL};

/// 后台检查置顶的间隔：丢了置顶最多这么久之后补回。只读一次窗口样式，开销可以忽略。
const GUARD_INTERVAL: Duration = Duration::from_millis(300);
/// 同一个窗口反复丢置顶时，日志最多这么久写一行。
const LOG_INTERVAL: Duration = Duration::from_secs(30);
/// 按 Win+D 时留在桌面上的窗口让开多久：系统收走（或放回）别的窗口之后再回来。
const STEP_ASIDE: Duration = Duration::from_millis(350);

/// 受保护、不让最小化的窗口句柄（HWND 的数值）。钩子在主线程上读，后台线程每次检查时更新。
static PROTECTED: Mutex<Vec<isize>> = Mutex::new(Vec::new());
/// 想让它显示着的窗口（只对挂了子类的窗口起作用）：别人要藏它时不让。
static KEEP: Mutex<Vec<isize>> = Mutex::new(Vec::new());
/// 正在按 Win+D 让开：这时自己藏窗口，子类不拦。
static BYPASS: AtomicBool = AtomicBool::new(false);

/// 应当一直置顶的窗口，按检查的先后排列：动画层最后，补回置顶后它仍在最前面（它要盖住侧栏与记录窗口）。
/// 第二项为是否不让最小化：设置窗口有最小化按钮、在 Alt+Tab 里，按 Win+D 照常收走。
fn desired(app: &AppHandle) -> Vec<(String, bool)> {
    let mut labels: Vec<(String, bool)> = vec![
        (SIDEBAR_LABEL.into(), true),
        (CAPTURE_LABEL.into(), true),
        (SETTINGS_LABEL.into(), false),
        (crate::dialogs::DIALOG_LABEL.into(), true),
    ];
    labels.extend(crate::note_windows::topmost_windows().into_iter().map(|label| (label, true)));
    labels.push((crate::note_windows::OVERLAY_LABEL.into(), true));
    labels.retain(|(label, _)| app.get_webview_window(label).is_some());
    labels
}

/// 启动守护：主线程上装 Win+D 的最小化钩子、给交给隐藏所有者的窗口挂子类，另起线程认 Win+D、检查置顶。
pub fn install(app: &AppHandle) {
    #[cfg(windows)]
    {
        let owned: Vec<isize> = [SIDEBAR_LABEL, CAPTURE_LABEL, crate::dialogs::DIALOG_LABEL, crate::note_windows::OVERLAY_LABEL]
            .iter()
            .filter_map(|label| app.get_webview_window(label))
            .filter_map(|window| window.hwnd().ok().map(|hwnd| hwnd.0 as isize))
            .collect();
        let _ = app.run_on_main_thread(move || {
            if !hook::install() {
                crate::diag::log("Win+D 防护钩子安装失败，置顶的窗口按 Win+D 后会被收走");
            }
            for hwnd in owned {
                subclass::attach(hwnd);
            }
        });
        keyboard::spawn();
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

/// 一次检查：更新受保护的窗口，显示着却丢了置顶的窗口补回置顶。
#[cfg(windows)]
fn check(app: &AppHandle, logged: &mut HashMap<String, Instant>) {
    let mut protected = Vec::new();
    for (label, keep) in desired(app) {
        let Some(window) = app.get_webview_window(&label) else { continue };
        let Ok(hwnd) = window.hwnd() else { continue };
        if keep {
            protected.push(hwnd.0 as isize);
        }
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
    if let Ok(mut slot) = PROTECTED.lock() {
        *slot = protected;
    }
}

/// 受保护的窗口（钩子里调用，只读一个列表，不碰 Tauri 的状态）。
#[cfg(windows)]
fn is_protected(hwnd: isize) -> bool {
    PROTECTED.lock().map(|slot| slot.contains(&hwnd)).unwrap_or(false)
}

/// 想让它显示着的窗口（子类里调用）。
#[cfg(windows)]
fn is_kept(hwnd: isize) -> bool {
    !BYPASS.load(Ordering::SeqCst) && KEEP.lock().map(|slot| slot.contains(&hwnd)).unwrap_or(false)
}

fn handle(window: &WebviewWindow) -> Option<isize> {
    #[cfg(windows)]
    return window.hwnd().ok().map(|hwnd| hwnd.0 as isize);
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

/// 记下想让窗口显示着（`true`）还是隐藏（`false`）。要隐藏时先记下，子类才放行自己的隐藏。
pub fn keep(window: &WebviewWindow, visible: bool) {
    let Some(value) = handle(window) else { return };
    if let Ok(mut slot) = KEEP.lock() {
        slot.retain(|item| *item != value);
        if visible {
            slot.push(value);
        }
    }
}

/// 显示窗口：记下想让它显示，交给 tao 显示；tao 记着「显示着」而窗口其实被系统藏了时（Win+D），
/// 它的 `show()` 什么也不做，排在它后面（主线程上按顺序）补一次不激活的显示。
pub fn show(window: &WebviewWindow) {
    keep(window, true);
    let _ = window.show();
    #[cfg(windows)]
    if let Some(value) = handle(window) {
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

/// 隐藏窗口：先记下想让它隐藏（子类放行），交给 tao 隐藏；tao 以为它本来就隐藏着时补一次。
pub fn hide(window: &WebviewWindow) {
    keep(window, false);
    let _ = window.hide();
    #[cfg(windows)]
    if let Some(value) = handle(window) {
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

/// 马上把记录窗口加进或移出受保护的列表（置顶切换时；后台检查也会更新，这里免得等一个间隔）。
pub fn protect(window: &WebviewWindow, keep: bool) {
    #[cfg(windows)]
    if let (Ok(hwnd), Ok(mut slot)) = (window.hwnd(), PROTECTED.lock()) {
        let value = hwnd.0 as isize;
        slot.retain(|item| *item != value);
        if keep {
            slot.push(value);
        }
    }
    #[cfg(not(windows))]
    let _ = (window, keep);
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

/// 窗口被最小化了（Win+D、钩子没拦住）就不激活地还原，返回是否还原过。
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

/// Win+D 防护：主线程上的 WH_CBT 钩子。系统最小化窗口（ShowWindow、显示桌面、Win+M）时先问钩子，
/// 返回非零就不最小化。钩子只装在主线程上，只管本应用的窗口（Tauri 的窗口都在主线程上创建）。
#[cfg(windows)]
mod hook {
    use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::Threading::GetCurrentThreadId;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, HCBT_MINMAX, SW_FORCEMINIMIZE, SW_MINIMIZE, SW_SHOWMINIMIZED, SW_SHOWMINNOACTIVE,
        WH_CBT,
    };

    unsafe extern "system" fn procedure(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HCBT_MINMAX as i32 {
            // 低 16 位是 SW_ 开头的显示方式；wParam 是要最小化的窗口。
            let command = (lparam.0 & 0xFFFF) as i32;
            let minimizing = [SW_MINIMIZE.0, SW_SHOWMINIMIZED.0, SW_SHOWMINNOACTIVE.0, SW_FORCEMINIMIZE.0].contains(&command);
            if minimizing && super::is_protected(wparam.0 as isize) {
                return LRESULT(1);
            }
        }
        // SAFETY：按钩子的约定把其余消息交给下一个钩子。
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// 在当前线程（主线程）上装钩子，随进程退出卸载。
    pub fn install() -> bool {
        // SAFETY：钩子过程是本模块里的函数，只装在当前线程上，不需要模块句柄。
        unsafe { SetWindowsHookExW(WH_CBT, Some(procedure), None, GetCurrentThreadId()).is_ok() }
    }
}

/// 不让别人藏起想显示着的窗口：交给隐藏所有者的窗口挂一个子类（与 tao 自己的子类并存），
/// 系统要藏它（显示桌面）时去掉 SWP_HIDEWINDOW。自己隐藏之前先由 `hide` 记下，不拦。
#[cfg(windows)]
mod subclass {
    use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use ::windows::Win32::UI::WindowsAndMessaging::{SWP_HIDEWINDOW, WINDOWPOS, WM_WINDOWPOSCHANGING};

    /// 子类的标识（同一个窗口上与 tao 的子类区分开）。
    const ID: usize = 0x534E_4B50;

    unsafe extern "system" fn procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if message == WM_WINDOWPOSCHANGING && lparam.0 != 0 && super::is_kept(hwnd.0 as isize) {
            // SAFETY：WM_WINDOWPOSCHANGING 的 lParam 指向系统给的 WINDOWPOS，允许修改其中的标志。
            let position = unsafe { &mut *(lparam.0 as *mut WINDOWPOS) };
            if position.flags.contains(SWP_HIDEWINDOW) {
                position.flags &= !SWP_HIDEWINDOW;
            }
        }
        // SAFETY：其余照常交给下一层窗口过程。
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    /// 给窗口挂上子类；必须在窗口所在的线程（主线程）上调用。
    pub fn attach(hwnd: isize) {
        // SAFETY：hwnd 是本应用在主线程上创建的窗口，子类过程是本模块里的函数。
        let attached = unsafe { SetWindowSubclass(HWND(hwnd as *mut core::ffi::c_void), Some(procedure), ID, 0) }.as_bool();
        if !attached {
            crate::diag::log("窗口子类挂接失败，显示桌面时可能把侧栏藏起来");
        }
    }
}

/// 认出 Win+D：另起一个线程装低级键盘钩子（WH_KEYBOARD_LL），只看 Win 加 D（不带 Ctrl、Shift、Alt），
/// 在系统处理之前把留在桌面上的窗口暂时藏起来，STEP_ASIDE 之后放回来（见本模块开头）。
#[cfg(windows)]
mod keyboard {
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::time::{Duration, Instant};

    use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, IsIconic, IsWindow, IsWindowVisible, SetWindowPos, SetWindowsHookExW, HC_ACTION,
        KBDLLHOOKSTRUCT, MSG, SWP_ASYNCWINDOWPOS, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        SWP_NOZORDER, SWP_SHOWWINDOW, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    /// 按着的修饰键：1 Win，2 Ctrl，4 Shift，8 Alt。
    static MODIFIERS: AtomicU8 = AtomicU8::new(0);
    /// 正在让开（窗口藏着、还没放回来）。
    static STEPPING: AtomicBool = AtomicBool::new(false);
    const VK_D: u32 = 0x44;

    fn modifier(vk: u32) -> u8 {
        match vk {
            0x5B | 0x5C => 1,
            0x11 | 0xA2 | 0xA3 => 2,
            0x10 | 0xA0 | 0xA1 => 4,
            0x12 | 0xA4 | 0xA5 => 8,
            _ => 0,
        }
    }

    unsafe extern "system" fn procedure(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lparam.0 != 0 {
            // SAFETY：低级键盘钩子的 lParam 指向系统给的 KBDLLHOOKSTRUCT。
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let message = wparam.0 as u32;
            let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let up = message == WM_KEYUP || message == WM_SYSKEYUP;
            let bit = modifier(info.vkCode);
            if bit != 0 {
                if down {
                    MODIFIERS.fetch_or(bit, Ordering::SeqCst);
                } else if up {
                    MODIFIERS.fetch_and(!bit, Ordering::SeqCst);
                }
            } else if down && info.vkCode == VK_D && MODIFIERS.load(Ordering::SeqCst) == 1 {
                step_aside();
            }
        }
        // SAFETY：按钩子的约定交给下一个钩子，按键照常送出。
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// 把显示着的受保护窗口藏起来（等它们真的藏好，最多 100 毫秒），STEP_ASIDE 之后放回来。
    fn step_aside() {
        if STEPPING.swap(true, Ordering::SeqCst) {
            return;
        }
        let survivors: Vec<isize> = super::PROTECTED
            .lock()
            .map(|slot| slot.clone())
            .unwrap_or_default()
            .into_iter()
            .filter(|value| {
                let hwnd = HWND(*value as *mut core::ffi::c_void);
                // SAFETY：只读查询，句柄失效时返回 false。
                unsafe { IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() }
            })
            .collect();
        if survivors.is_empty() {
            STEPPING.store(false, Ordering::SeqCst);
            return;
        }
        let flags = SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS;
        super::BYPASS.store(true, Ordering::SeqCst);
        for value in &survivors {
            // SAFETY：异步请求窗口所在的线程隐藏它，不在钩子里等主线程。
            let _ = unsafe { SetWindowPos(HWND(*value as *mut core::ffi::c_void), None, 0, 0, 0, 0, flags | SWP_HIDEWINDOW) };
        }
        // 钩子返回之后系统才处理 Win+D：等窗口真的藏好（主线程很快就会处理），免得系统还看得见它们。
        let deadline = Instant::now() + Duration::from_millis(100);
        while Instant::now() < deadline
            // SAFETY：只读查询。
            && survivors.iter().any(|value| unsafe { IsWindowVisible(HWND(*value as *mut core::ffi::c_void)).as_bool() })
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        super::BYPASS.store(false, Ordering::SeqCst);
        std::thread::spawn(move || {
            std::thread::sleep(super::STEP_ASIDE);
            for value in survivors {
                let hwnd = HWND(value as *mut core::ffi::c_void);
                // 期间被关掉、取消置顶或自己收起（侧栏没固定时）的窗口不放回来。
                let still = super::is_protected(value) && (super::KEEP.lock().map(|slot| slot.contains(&value)).unwrap_or(false) || !is_owned(hwnd));
                // SAFETY：句柄失效时 IsWindow 返回 false，不再操作。
                if still && unsafe { IsWindow(Some(hwnd)).as_bool() } {
                    let _ = unsafe { SetWindowPos(hwnd, None, 0, 0, 0, 0, flags | SWP_SHOWWINDOW) };
                }
            }
            STEPPING.store(false, Ordering::SeqCst);
        });
    }

    /// 交给隐藏所有者的窗口（侧栏等）：是否放回来按 KEEP 判断；记录窗口没有所有者，按是否还受保护判断。
    fn is_owned(hwnd: HWND) -> bool {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_OWNER};
        // SAFETY：只读查询。
        unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|owner| !owner.is_invalid())
    }

    /// 另起线程装钩子并跑消息循环（低级钩子要求装它的线程有消息循环）。
    pub fn spawn() {
        std::thread::spawn(|| {
            // SAFETY：钩子过程是本模块里的函数；低级钩子不注入别的进程，模块句柄取本程序。
            let installed = unsafe {
                let module = GetModuleHandleW(None).ok();
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(procedure), module.map(|module| module.into()), 0)
            };
            if installed.is_err() {
                crate::diag::log("Win+D 键盘钩子安装失败，置顶窗口留在桌面上时再按 Win+D 不会恢复别的窗口");
                return;
            }
            let mut message = MSG::default();
            // SAFETY：本线程的消息循环，钩子在这里被调用。
            while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {}
        });
    }
}
