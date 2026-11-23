//! 别的程序从本应用的窗口里唤出的小窗（第十三轮反馈 1，技术决策第 72 条）：在侧栏里输入时按 Ctrl+` 唤不出 Ditto 的剪贴板历史。
//!
//! 有两处挡着：
//! - 侧栏、速记浮窗、置顶的记录窗口都置顶；Ditto 这类小窗不置顶，系统把它排在所有置顶窗口下面，唤出来也被侧栏盖住；
//! - 侧栏、记录窗口失去焦点时保存编辑、回到预览，侧栏过一会儿还会收起（T36），Ditto 选完内容把焦点交回来粘贴时，已经不在编辑了。
//!
//! 所以在后台线程上盯着前台窗口的变化（SetWinEventHook）。本应用的窗口在前台时，别的程序刚显示出来（一秒内）的顶层窗口抢到了前台，
//! 就当作从这里唤出的小窗：
//! - 小窗不置顶时，与它重叠的本应用置顶窗口排到它下面（暂时失去置顶），置顶守护不补回（topmost::yield_to）；
//! - 告诉原来在前台的窗口（[`POPUP_EVENT`]，载荷 true），它不保存编辑、不收起；页面失焦时也可以用 `external_popup_open` 问一次，
//!   免得事件晚到。
//!
//! 小窗隐藏、关掉，或前台换到了别的窗口时，补回置顶，再告诉那个窗口（载荷 false），页面看焦点回没回来，没回来就照常保存、收起。
//! 点到早就开着的别的窗口不算：它不是刚显示出来的，置顶的侧栏照旧在它上面。

// 认小窗的规则与系统无关，各平台都编译（单元测试），只有 Windows 上用到。
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// 小窗开着、关掉时发给唤出它的窗口的事件，载荷是小窗还开着没有。
pub const POPUP_EVENT: &str = "sidenotes://external-popup";

/// 显示出来与抢到前台相隔多久之内算小窗（两件事谁先谁后都有）。
const FRESH: Duration = Duration::from_secs(1);

/// 开着的小窗与唤出它的本应用窗口（标签）。
#[derive(Debug, Clone, PartialEq)]
struct Popup {
    hwnd: isize,
    owner: String,
}

/// 前台窗口的变化：只在钩子线程上改，命令只读。
#[derive(Debug, Default)]
struct Watch {
    /// 现在的前台窗口、它是不是本应用的，以及成为前台的时刻。
    foreground: isize,
    ours: bool,
    since: Option<Instant>,
    /// 前台换到别的程序之前在前台的本应用窗口（标签）；前台是本应用的窗口时为空。
    came_from: Option<String>,
    /// 最近显示出来的别的程序的顶层窗口与时刻。
    shown: Option<(isize, Instant)>,
    popup: Option<Popup>,
}

impl Watch {
    const fn new() -> Self {
        Watch { foreground: 0, ours: false, since: None, came_from: None, shown: None, popup: None }
    }

    /// 换之前在前台的本应用窗口（句柄）：调用方查出它的标签，交给 `foreground`。
    fn previous_ours(&self) -> Option<isize> {
        self.ours.then_some(self.foreground)
    }

    /// 前台换成了 `hwnd`（`ours`：是不是本应用的窗口；`came_from`：换之前在前台的本应用窗口的标签）。
    /// 返回因此关掉的小窗，与认出的新小窗的主人。
    fn foreground(&mut self, hwnd: isize, ours: bool, came_from: Option<String>, now: Instant) -> (Option<Popup>, Option<String>) {
        let ended = if self.popup.as_ref().is_some_and(|popup| popup.hwnd != hwnd) { self.popup.take() } else { None };
        self.foreground = hwnd;
        self.ours = ours;
        self.since = Some(now);
        self.came_from = if ours { None } else { came_from };
        let fresh = self.shown.is_some_and(|(shown, at)| shown == hwnd && now.duration_since(at) <= FRESH);
        (ended, self.begin(hwnd, fresh))
    }

    /// 别的程序显示了一个顶层窗口；它刚从本应用的窗口那里抢到前台时，返回小窗的主人。
    fn shown(&mut self, hwnd: isize, now: Instant) -> Option<String> {
        self.shown = Some((hwnd, now));
        let fresh = !self.ours && self.foreground == hwnd && self.since.is_some_and(|since| now.duration_since(since) <= FRESH);
        self.begin(hwnd, fresh)
    }

    /// 别的程序的窗口隐藏或销毁了：是开着的小窗就当它关了。
    fn gone(&mut self, hwnd: isize) -> Option<Popup> {
        if self.popup.as_ref().is_some_and(|popup| popup.hwnd == hwnd) { self.popup.take() } else { None }
    }

    fn begin(&mut self, hwnd: isize, fresh: bool) -> Option<String> {
        let owner = self.came_from.clone().filter(|_| fresh && self.popup.is_none())?;
        self.popup = Some(Popup { hwnd, owner: owner.clone() });
        Some(owner)
    }

    fn open_over(&self, label: &str) -> bool {
        self.popup.as_ref().is_some_and(|popup| popup.owner == label)
    }
}

static WATCH: Mutex<Watch> = Mutex::new(Watch::new());

fn watch() -> MutexGuard<'static, Watch> {
    WATCH.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 开始盯着前台窗口的变化（只在 Windows 上）。
pub fn install(app: &AppHandle) {
    #[cfg(windows)]
    native::install(app);
    #[cfg(not(windows))]
    let _ = app;
}

/// 页面失焦时问一次：是不是别的程序从这个窗口唤出了小窗、还开着。
#[tauri::command]
pub fn external_popup_open(window: tauri::WebviewWindow) -> bool {
    watch().open_over(window.label())
}

#[cfg(windows)]
mod native {
    use std::sync::OnceLock;
    use std::time::Instant;

    use tauri::{AppHandle, Emitter, Manager};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
    use windows::Win32::UI::WindowsAndMessaging::{
        CHILDID_SELF, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND, GA_ROOT, GetAncestor, GetMessageW,
        GetWindowThreadProcessId, MSG, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    use super::{POPUP_EVENT, Popup, watch};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn install(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        let spawned = std::thread::Builder::new().name("external-popups".into()).spawn(|| {
            // SAFETY：回调是本模块的函数；两个钩子都在这个线程上收事件（不注入别的进程），线程一直运行到应用退出。
            unsafe {
                let foreground = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT);
                // 别的程序的窗口销毁、显示与隐藏（DESTROY、SHOW、HIDE 的编号相连）；本应用自己的不用看。
                let objects =
                    SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
                if foreground.is_invalid() || objects.is_invalid() {
                    crate::diag::log("没能盯住前台窗口的变化：别的程序从这里唤出的小窗可能被置顶的窗口挡住");
                    return;
                }
                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).0 > 0 {}
            }
        });
        if spawned.is_err() {
            crate::diag::log("没能盯住前台窗口的变化：线程没有启动");
        }
    }

    unsafe extern "system" fn on_event(_hook: HWINEVENTHOOK, event: u32, hwnd: HWND, object: i32, child: i32, _thread: u32, _time: u32) {
        let Some(app) = APP.get() else {
            return;
        };
        if hwnd.is_invalid() {
            return;
        }
        let handle = hwnd.0 as isize;
        // 回调里不能让 panic 穿出去：一次出错只跳过这一次。
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match event {
            EVENT_SYSTEM_FOREGROUND => foreground(app, handle),
            // 只看窗口本身，不看光标、插入符与窗口里的控件。
            _ if object != OBJID_WINDOW.0 || child != CHILDID_SELF as i32 => {}
            EVENT_OBJECT_SHOW => shown(app, handle),
            _ => {
                let ended = watch().gone(handle);
                if let Some(popup) = ended {
                    finish(app, popup);
                }
            }
        }));
    }

    /// 前台换了窗口。换之前在前台的本应用窗口的标签在锁外查（要问 Tauri 的窗口表）。
    fn foreground(app: &AppHandle, hwnd: isize) {
        let previous = watch().previous_ours();
        let came_from = previous.and_then(|previous| label_of(app, previous));
        let (ended, owner) = watch().foreground(hwnd, is_own(hwnd), came_from, Instant::now());
        if let Some(popup) = ended {
            finish(app, popup);
        }
        if let Some(owner) = owner {
            begin(app, hwnd, &owner);
        }
    }

    /// 别的程序显示了一个窗口：只看顶层窗口。
    fn shown(app: &AppHandle, hwnd: isize) {
        // SAFETY：只读窗口的父子关系；窗口已经没了时返回空句柄，不等于它自己。
        if unsafe { GetAncestor(HWND(hwnd as *mut core::ffi::c_void), GA_ROOT) }.0 as isize != hwnd {
            return;
        }
        let owner = watch().shown(hwnd, Instant::now());
        if let Some(owner) = owner {
            begin(app, hwnd, &owner);
        }
    }

    fn begin(app: &AppHandle, hwnd: isize, owner: &str) {
        crate::topmost::yield_to(app, hwnd);
        let _ = app.emit_to(owner, POPUP_EVENT, true);
    }

    fn finish(app: &AppHandle, popup: Popup) {
        crate::topmost::restore_yielded(app);
        let _ = app.emit_to(popup.owner.as_str(), POPUP_EVENT, false);
    }

    /// 窗口是不是本进程的。
    fn is_own(hwnd: isize) -> bool {
        let mut process = 0u32;
        // SAFETY：只读窗口所属的进程号；窗口已经没了时进程号为 0。
        unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut core::ffi::c_void), Some(&mut process)) };
        process == std::process::id()
    }

    /// 本应用窗口的标签。
    fn label_of(app: &AppHandle, hwnd: isize) -> Option<String> {
        app.webview_windows().into_iter().find(|(_, window)| window.hwnd().is_ok_and(|own| own.0 as isize == hwnd)).map(|(label, _)| label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIDEBAR: isize = 1;
    const DITTO: isize = 2;
    const BROWSER: isize = 3;

    /// 侧栏在前台。
    fn typing_in_sidebar(now: Instant) -> Watch {
        let mut watch = Watch::new();
        watch.foreground(SIDEBAR, true, None, now);
        watch
    }

    #[test]
    fn a_window_that_pops_up_from_the_sidebar_is_a_popup_either_order() {
        let now = Instant::now();
        // 先显示、再抢前台。
        let mut watch = typing_in_sidebar(now);
        assert_eq!(watch.shown(DITTO, now), None);
        assert_eq!(watch.foreground(DITTO, false, Some("main".into()), now + Duration::from_millis(30)), (None, Some("main".into())));
        assert!(watch.open_over("main") && !watch.open_over("capture"));
        // 先抢前台、再显示。
        let mut watch = typing_in_sidebar(now);
        assert_eq!(watch.foreground(DITTO, false, Some("main".into()), now), (None, None));
        assert_eq!(watch.shown(DITTO, now + Duration::from_millis(30)), Some("main".into()));
    }

    #[test]
    fn the_popup_ends_when_it_hides_or_the_foreground_moves_on() {
        let now = Instant::now();
        let mut watch = typing_in_sidebar(now);
        watch.shown(DITTO, now);
        watch.foreground(DITTO, false, Some("main".into()), now);
        let popup = Popup { hwnd: DITTO, owner: "main".into() };
        assert_eq!(watch.gone(BROWSER), None);
        assert_eq!(watch.gone(DITTO), Some(popup.clone()));
        assert!(!watch.open_over("main"));
        // 小窗开着时点到了别的程序：小窗关了，那个程序不是从侧栏唤出的。
        let mut watch = typing_in_sidebar(now);
        watch.shown(DITTO, now);
        watch.foreground(DITTO, false, Some("main".into()), now);
        assert_eq!(watch.foreground(BROWSER, false, None, now + Duration::from_secs(5)), (Some(popup), None));
    }

    #[test]
    fn clicking_a_window_that_was_already_open_is_not_a_popup() {
        let now = Instant::now();
        let mut watch = Watch::new();
        watch.shown(BROWSER, now);
        watch.foreground(SIDEBAR, true, None, now + Duration::from_secs(1));
        assert_eq!(watch.foreground(BROWSER, false, Some("main".into()), now + Duration::from_secs(60)), (None, None));
        // 从别的程序那里唤出的窗口也不算（不是从本应用唤出的）。
        assert_eq!(watch.shown(DITTO, now + Duration::from_secs(61)), None);
        assert_eq!(watch.foreground(DITTO, false, None, now + Duration::from_secs(61)), (None, None));
    }
}
