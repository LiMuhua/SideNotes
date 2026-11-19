//! 面板窗口（T120，技术决策第 47 条）：显示桌面（Win+D、任务栏角上的「显示桌面」）时一动不动的窗口。
//!
//! 2026-11-19 用诊断版实测（记下系统发给各窗口的消息，逐项改窗口样式对照）：显示桌面会收起带任务栏按钮的窗口，
//! 也会收起带标题栏或系统菜单样式（WS_CAPTION、WS_SYSMENU）的窗口，置顶、去掉最小化按钮都没用；本应用有窗口被收起时，
//! 交给隐藏所有者的窗口（原来的侧栏等）也被一起藏起来。不交给所有者、没有任务栏按钮、没有标题栏与系统菜单样式的
//! 置顶工具窗口，显示桌面完全不碰，再按一次照常恢复别的窗口；Glance 的面板就是这样的窗口。
//!
//! 所以侧栏、速记浮窗、弹窗、动画层，以及置顶（或附着在卡片旁）的记录窗口都做成这样的面板：工具窗口
//! （WS_EX_TOOLWINDOW：没有任务栏按钮，不进 Alt+Tab 与 Win+Tab），去掉标题栏、系统菜单与最小化、最大化按钮的样式。
//! 本应用的窗口都没有系统的边框，去掉这些样式外观不变。tao 每次改窗口的标志都按自己的标志重写样式（总是加上
//! WS_CAPTION、WS_SYSMENU，没有所有者时加上 WS_EX_APPWINDOW），所以给面板挂一个子类，在 WM_STYLECHANGING 里改掉。
//! 没置顶的记录窗口与设置窗口仍是普通窗口：有任务栏按钮、在 Alt+Tab 里，显示桌面时与别的窗口一起收起。

use tauri::WebviewWindow;

/// 把窗口设为面板（`on`）或改回普通窗口。样式在窗口所在的主线程上改：在主线程上调用时立即生效，否则交给主线程。
/// 返回之前是不是面板。
pub fn set(window: &WebviewWindow, on: bool) -> bool {
    #[cfg(windows)]
    {
        let Ok(hwnd) = window.hwnd() else { return false };
        let value = hwnd.0 as isize;
        let was = imp::mark(value, on);
        if imp::on_window_thread(value) {
            imp::restyle(value, on);
        } else {
            let _ = window.run_on_main_thread(move || imp::restyle(value, on));
        }
        was
    }
    #[cfg(not(windows))]
    {
        let _ = (window, on);
        false
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;

    use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::Threading::GetCurrentThreadId;
    use ::windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, STYLESTRUCT,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WM_STYLECHANGING, WS_CAPTION,
        WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
    };

    /// 子类的标识（同一个窗口上与 tao 的子类区分开）。
    const ID: usize = 0x534E_5041;
    /// 面板去掉的样式：标题栏、系统菜单与最小化、最大化按钮。
    const DROPPED: u32 = WS_CAPTION.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0;

    /// 现在是面板的窗口（HWND 的数值）。子类过程在主线程上读。
    static PANELS: Mutex<Vec<isize>> = Mutex::new(Vec::new());
    /// 已经挂上子类的窗口。
    static ATTACHED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

    fn hwnd(value: isize) -> HWND {
        HWND(value as *mut core::ffi::c_void)
    }

    fn is_panel(value: isize) -> bool {
        PANELS.lock().map(|list| list.contains(&value)).unwrap_or(false)
    }

    /// 记下窗口是不是面板，返回之前是不是。
    pub fn mark(value: isize, on: bool) -> bool {
        let Ok(mut list) = PANELS.lock() else { return false };
        let was = list.contains(&value);
        list.retain(|item| *item != value);
        if on {
            list.push(value);
        }
        was
    }

    pub fn on_window_thread(value: isize) -> bool {
        // SAFETY：只读查询，句柄失效时返回 0。
        unsafe { GetWindowThreadProcessId(hwnd(value), None) == GetCurrentThreadId() }
    }

    unsafe extern "system" fn procedure(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if message == WM_STYLECHANGING && lparam.0 != 0 && is_panel(window.0 as isize) {
            // SAFETY：WM_STYLECHANGING 的 lParam 指向系统给的 STYLESTRUCT，允许修改其中的新样式。
            let change = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
            if wparam.0 as i32 == GWL_STYLE.0 {
                change.styleNew &= !DROPPED;
            } else if wparam.0 as i32 == GWL_EXSTYLE.0 {
                change.styleNew = (change.styleNew | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
            }
        }
        // SAFETY：照常交给下一层窗口过程。
        unsafe { DefSubclassProc(window, message, wparam, lparam) }
    }

    /// 按是不是面板重写一次样式（在窗口所在的线程上调用）。面板的样式经过子类改掉；改回普通窗口时补回标题栏、
    /// 系统菜单与任务栏按钮的样式，最小化按钮之后由 tao 按自己的标志补上。
    pub fn restyle(value: isize, on: bool) {
        let window = hwnd(value);
        // SAFETY：句柄失效时 IsWindow 返回 false，不再操作；子类过程是本模块里的函数，挂在窗口所在的线程上；
        // 其余是对本应用窗口样式的读写。
        unsafe {
            if !IsWindow(Some(window)).as_bool() {
                return;
            }
            if on && !ATTACHED.lock().map(|list| list.contains(&value)).unwrap_or(true) {
                if SetWindowSubclass(window, Some(procedure), ID, 0).as_bool() {
                    if let Ok(mut list) = ATTACHED.lock() {
                        list.push(value);
                    }
                } else {
                    crate::diag::log("面板窗口的子类挂接失败，显示桌面时它可能被一起收起");
                }
            }
            let style = GetWindowLongPtrW(window, GWL_STYLE);
            let ex = GetWindowLongPtrW(window, GWL_EXSTYLE);
            let (style, ex) = if on {
                (style & !(DROPPED as isize), (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize))
            } else {
                (style | (WS_CAPTION.0 | WS_SYSMENU.0) as isize, (ex & !(WS_EX_TOOLWINDOW.0 as isize)) | WS_EX_APPWINDOW.0 as isize)
            };
            SetWindowLongPtrW(window, GWL_STYLE, style);
            SetWindowLongPtrW(window, GWL_EXSTYLE, ex);
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED;
            let _ = SetWindowPos(window, None, 0, 0, 0, 0, flags);
        }
    }
}
