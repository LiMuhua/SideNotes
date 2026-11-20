//! 面板窗口（T120，技术决策第 47 条）：显示桌面（Win+D、任务栏角上的「显示桌面」）时一动不动的窗口。
//!
//! 2026-11-19 用诊断版实测（记下系统发给各窗口的消息，逐项改窗口样式对照）：显示桌面会收起带任务栏按钮的窗口，
//! 也会收起带标题栏或系统菜单样式（WS_CAPTION、WS_SYSMENU）的窗口，置顶、去掉最小化按钮都没用；本应用有窗口被收起时，
//! 交给隐藏所有者的窗口（原来的侧栏等）也被一起藏起来。不交给所有者、没有任务栏按钮、没有标题栏与系统菜单样式的
//! 置顶工具窗口，显示桌面完全不碰，再按一次照常恢复别的窗口；Glance 的面板就是这样的窗口。只留标题栏样式的一半
//! （WS_BORDER 或 WS_DLGFRAME）也会被收起（第六轮实测）。
//!
//! 所以侧栏、速记浮窗、弹窗、动画层，以及置顶（或附着在卡片旁）的记录窗口都做成这样的面板：工具窗口
//! （WS_EX_TOOLWINDOW：没有任务栏按钮，不进 Alt+Tab 与 Win+Tab），去掉标题栏、系统菜单与最小化、最大化按钮的样式。
//! tao 每次改窗口的标志都按自己的标志重写样式（总是加上 WS_CAPTION、WS_SYSMENU，没有所有者时加上 WS_EX_APPWINDOW），
//! 所以给面板挂一个子类，在 WM_STYLECHANGING 里改掉。没置顶的记录窗口与设置窗口仍是普通窗口：有任务栏按钮、
//! 在 Alt+Tab 里，显示桌面时与别的窗口一起收起。
//!
//! 面板的外框（T125，第六轮反馈：各主题的侧栏、记录窗口、全文浮窗一边露出原生标题栏与白边）：tao 的「无边框投影」
//! 在窗口四周留一圈非客户区（左右下各一个拉伸边框宽，顶边一两个像素），靠标题栏样式让系统把它画成看不见的拉伸边框，
//! 再在外面画投影与细边框。面板没有标题栏样式，系统不再这样画，这一圈由老式的窗口过程画成白边，顶上还留着标题栏的
//! 残影（透明主题里整条露出来）。所以面板关掉 tao 的投影标志，不留这一圈；投影、圆角与细边框改请 DWM 直接画（见
//! [`Frame`]）。实测显示桌面照样不碰这样的面板。
//! 没有这一圈之后，可以拉伸的面板（置顶的记录窗口）改由 Tauri 在窗口里沿四边放的一条拉伸区（一个系统边框宽）拉伸。
//!
//! 激活与失活（第七轮反馈 P1：去掉那一圈之后各主题仍偶尔在顶上露出一条原生标题栏）：窗口激活、失活时系统发
//! WM_NCACTIVATE，默认处理会在窗口顶上画一条小标题栏（工具窗口的高度，写着窗口标题），哪怕窗口已经没有标题栏样式；
//! 画在窗口自己的表面上，透明的地方一直露着，直到窗口重新显示。2026-11-20 实测：给侧栏发一次 WM_NCACTIVATE
//! 就画出来，lParam 为 -1 时默认处理不重画非客户区，什么也不画。面板的子类把这条消息的 lParam 改成 -1 再往下交，
//! tao 照常收到，激活与焦点的事件不变。

use tauri::WebviewWindow;

/// 面板外框由谁画、画成什么样（普通窗口不看这里的圆角，仍由系统按标题栏样式画）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Frame {
    /// 不画：页面自己画面板、圆角与投影的透明窗口（杂志、磨砂玻璃的块、动画层）。
    Bare,
    /// 直角、带系统投影：贴着屏幕边缘的侧栏（终端、记录纸），面板圆角为 0。
    Square,
    /// 圆角、细边框与系统投影，与 Windows 11 的普通窗口一样：浮动的面板与记录窗口。
    Round,
}

/// 把窗口设为面板（`on`）或改回普通窗口。样式在窗口所在的主线程上改：在主线程上调用时立即生效，否则交给主线程。
/// 返回之前是不是面板。
pub fn set(window: &WebviewWindow, on: bool) -> bool {
    #[cfg(windows)]
    {
        let Ok(hwnd) = window.hwnd() else { return false };
        let value = hwnd.0 as isize;
        let was = imp::mark(value, on);
        apply(window, value);
        was
    }
    #[cfg(not(windows))]
    {
        let _ = (window, on);
        false
    }
}

/// 设定窗口的外框（按主题的窗口材质，见 windows::set_window_material）：面板照这里请 DWM 画；普通窗口只看要不要
/// 投影（[`Frame::Bare`] 不要）。没设过的窗口按 [`Frame::Round`]。
pub fn set_frame(window: &WebviewWindow, frame: Frame) {
    #[cfg(windows)]
    {
        let Ok(hwnd) = window.hwnd() else { return };
        let value = hwnd.0 as isize;
        imp::remember(value, frame);
        apply(window, value);
    }
    #[cfg(not(windows))]
    {
        let _ = window.set_shadow(frame != Frame::Bare);
    }
}

/// 按记下的状态改样式与外框。普通窗口照旧用 tao 的投影（标题栏样式还在，系统把那一圈画成看不见的拉伸边框）；
/// 面板不要那一圈。
///
/// 有没有那一圈，窗口的外框不变、内容区却会大一圈或小一圈（取消置顶时记录窗口的内容缩进去十来个像素）。
/// 所以先记下内容区在屏幕上的位置，tao 改完投影标志之后把窗口挪回：内容区的位置与大小保持不变。
/// tao 的改动交给主线程依次执行，挪回的一步也交给主线程，排在它后面。
#[cfg(windows)]
fn apply(window: &WebviewWindow, value: isize) {
    let (panel, frame) = imp::state(value);
    let before = imp::client_screen(value);
    let _ = window.set_shadow(!panel && frame != Frame::Bare);
    if imp::on_window_thread(value) {
        imp::restyle(value, panel, frame);
    } else {
        let _ = window.run_on_main_thread(move || imp::restyle(value, panel, frame));
    }
    if let Some(before) = before {
        let _ = window.run_on_main_thread(move || imp::keep_client(value, before));
    }
}

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::Frame;
    use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use ::windows::Win32::Graphics::Dwm::{
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMNCRENDERINGPOLICY, DWMNCRP_ENABLED, DWMNCRP_USEWINDOWSTYLE,
        DWMWA_NCRENDERING_POLICY, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT, DWMWCP_DONOTROUND, DWMWCP_ROUND,
        DWM_WINDOW_CORNER_PREFERENCE,
    };
    use ::windows::Win32::Graphics::Gdi::{ClientToScreen, RedrawWindow, RDW_ALLCHILDREN, RDW_ERASE, RDW_FRAME, RDW_INVALIDATE};
    use ::windows::Win32::System::Threading::GetCurrentThreadId;
    use ::windows::Win32::UI::Controls::MARGINS;
    use ::windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, GWL_STYLE, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
        WM_NCACTIVATE, WM_STYLECHANGING, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
    };

    /// 子类的标识（同一个窗口上与 tao 的子类区分开）。
    const ID: usize = 0x534E_5041;
    /// 面板去掉的样式：标题栏、系统菜单与最小化、最大化按钮。
    const DROPPED: u32 = WS_CAPTION.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0;

    /// 现在是面板的窗口（HWND 的数值）。子类过程在主线程上读。
    static PANELS: Mutex<Vec<isize>> = Mutex::new(Vec::new());
    /// 已经挂上子类的窗口。
    static ATTACHED: Mutex<Vec<isize>> = Mutex::new(Vec::new());
    /// 各窗口设定的外框。
    static FRAMES: Mutex<Option<HashMap<isize, Frame>>> = Mutex::new(None);

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

    /// 记下窗口的外框。
    pub fn remember(value: isize, frame: Frame) {
        if let Ok(mut frames) = FRAMES.lock() {
            frames.get_or_insert_with(HashMap::new).insert(value, frame);
        }
    }

    /// 窗口现在是不是面板、设定的外框。
    pub fn state(value: isize) -> (bool, Frame) {
        let frame = FRAMES.lock().ok().and_then(|frames| frames.as_ref().and_then(|map| map.get(&value).copied())).unwrap_or(Frame::Round);
        (is_panel(value), frame)
    }

    /// 内容区在屏幕上的矩形（物理像素）；窗口不在、最小化或还没有大小时为 None。
    pub fn client_screen(value: isize) -> Option<RECT> {
        let window = hwnd(value);
        let mut rect = RECT::default();
        // SAFETY：只读查询；句柄失效时各调用失败，返回 None。
        unsafe {
            if !IsWindow(Some(window)).as_bool() || IsIconic(window).as_bool() || GetClientRect(window, &mut rect).is_err() {
                return None;
            }
            let mut origin = POINT { x: 0, y: 0 };
            if !ClientToScreen(window, &mut origin).as_bool() {
                return None;
            }
            (rect.right > 0 && rect.bottom > 0).then(|| RECT {
                left: origin.x,
                top: origin.y,
                right: origin.x + rect.right,
                bottom: origin.y + rect.bottom,
            })
        }
    }

    /// 把窗口挪回，让内容区回到 `before`（见 apply）。内容区没变时不动。
    pub fn keep_client(value: isize, before: RECT) {
        let Some(after) = client_screen(value) else { return };
        if after == before {
            return;
        }
        let window = hwnd(value);
        let mut outer = RECT::default();
        // SAFETY：读写本应用窗口的位置；句柄失效时调用失败，不做事。
        unsafe {
            if GetWindowRect(window, &mut outer).is_err() {
                return;
            }
            let left = outer.left + before.left - after.left;
            let top = outer.top + before.top - after.top;
            let right = outer.right + before.right - after.right;
            let bottom = outer.bottom + before.bottom - after.bottom;
            let _ = SetWindowPos(window, None, left, top, right - left, bottom - top, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        }
    }

    pub fn on_window_thread(value: isize) -> bool {
        // SAFETY：只读查询，句柄失效时返回 0。
        unsafe { GetWindowThreadProcessId(hwnd(value), None) == GetCurrentThreadId() }
    }

    unsafe extern "system" fn procedure(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if message == WM_NCACTIVATE && is_panel(window.0 as isize) {
            // 面板没有非客户区，默认处理却会在顶上画一条小标题栏（见模块说明）：lParam 为 -1 时不重画非客户区。
            // SAFETY：照常交给下一层窗口过程，只换掉文档允许的 lParam。
            return unsafe { DefSubclassProc(window, message, wparam, LPARAM(-1)) };
        }
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

    /// 按是不是面板重写一次样式与外框（在窗口所在的线程上调用）。面板的样式经过子类改掉；改回普通窗口时补回标题栏、
    /// 系统菜单与任务栏按钮的样式，最小化按钮之后由 tao 按自己的标志补上。
    ///
    /// 面板的外框（2026-11-19 实测）：没有标题栏样式的窗口，DWM 默认不画投影与边框；请它画圆角时，连细边框与投影
    /// 一起画（[`Frame::Round`]）；直角要投影时，打开非客户区绘制、把框架伸进客户区一像素（[`Frame::Square`]，
    /// 被页面盖住，看不出来）。普通窗口恢复默认，由系统按标题栏样式画。
    pub fn restyle(value: isize, on: bool, frame: Frame) {
        let window = hwnd(value);
        // SAFETY：句柄失效时 IsWindow 返回 false，不再操作；子类过程是本模块里的函数，挂在窗口所在的线程上；
        // 其余是对本应用窗口样式与 DWM 属性的读写，传入的指针指向本函数内的值，大小与之匹配。
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

            let (policy, margin, corner): (DWMNCRENDERINGPOLICY, i32, DWM_WINDOW_CORNER_PREFERENCE) = match (on, frame) {
                (true, Frame::Square) => (DWMNCRP_ENABLED, 1, DWMWCP_DONOTROUND),
                (true, Frame::Round) => (DWMNCRP_USEWINDOWSTYLE, 0, DWMWCP_ROUND),
                _ => (DWMNCRP_USEWINDOWSTYLE, 0, DWMWCP_DEFAULT),
            };
            let _ = DwmSetWindowAttribute(window, DWMWA_NCRENDERING_POLICY, (&policy as *const DWMNCRENDERINGPOLICY).cast(), std::mem::size_of_val(&policy) as u32);
            let _ = DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, (&corner as *const DWM_WINDOW_CORNER_PREFERENCE).cast(), std::mem::size_of_val(&corner) as u32);
            let margins = MARGINS { cxLeftWidth: margin, cxRightWidth: margin, cyTopHeight: margin, cyBottomHeight: margin };
            let _ = DwmExtendFrameIntoClientArea(window, &margins);

            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED;
            let _ = SetWindowPos(window, None, 0, 0, 0, 0, flags);
            // 去掉样式之前系统画在窗口上的标题栏与边框（透明的地方会一直露着），整窗重画一次。
            let _ = RedrawWindow(Some(window), None, None, RDW_FRAME | RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
        }
    }
}
