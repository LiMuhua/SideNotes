//! 记录窗口（T83，交互原型 note-window.js；技术决策第 41 条）。
//!
//! 原型的记录窗口是页面里的浮层；桌面端的侧栏只是屏幕边上的一条窗口，记录窗口要能放在桌面任何地方，
//! 所以每个记录窗口是一个独立的 Tauri 窗口（标签 note-1、note-2…），页面只画自己的窗口。
//! 跨窗口的事情集中在这里：
//! - 登记表：每个窗口的标签页、当前页、是否置顶、打开方式与标题栏的位置。用来查找已经打开的记录、
//!   判断指针落在哪个窗口上、关闭全部窗口；每条记录只在一个窗口中打开。
//! - 拖动：卡片拖出侧栏、拖动窗口标题栏与标签页，都由页面按住指针，每一步调用这里；这里读取指针的屏幕位置，
//!   移动窗口、找出指针下的窗口并通知它标出插入位置，松开时合并、拆分或新开窗口。
//! - 动画层：一个盖住当前屏幕工作区、点击穿透的透明窗口（overlay），画跨窗口的拖影、标签栏里的插入线，
//!   以及打开与关闭时的形变动画。一个窗口画不到自己的范围之外，原型里从卡片展开、缩回卡片的动画只能在这一层画。
//! - 备用窗口：新建一个 WebView 要几百毫秒，提前建好一个隐藏的记录窗口，打开时直接用，用掉后再补一个。
//! - 全文浮窗（T100）：「展开全文」打开的窗口先附着在卡片旁，不进任务栏与 Alt+Tab，一直置顶，点到别处就收回；
//!   动画层画一条连到卡片的线。拖动标题栏（或有别的记录并进来、双击放大）后才成为独立的记录窗口。
//!
//! 坐标一律是屏幕的物理像素。页面给出的矩形是页面像素，乘以页面像素比换算；页面像素比是屏幕缩放、
//! Windows 的文本缩放与界面缩放（字号）三者之积，只有页面知道，所以尺寸都由页面换算好再交过来。
//! 命令也定义在这里，都是本模块的薄封装。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::error::{AppError, AppResult};
use crate::windows::{self, SIDEBAR_LABEL};

/// 记录窗口标签的前缀。
pub const NOTE_PREFIX: &str = "note-";
/// 动画层窗口的标签。
pub const OVERLAY_LABEL: &str = "overlay";
/// 一个窗口最多放几条记录（原型 openFromDrag 的上限）。
const MAX_TABS: usize = 12;
/// 窗口离开工作区边缘、侧栏与其它窗口的距离（原型的 MARGIN，按 13px 字号计）。
const MARGIN: f64 = 12.0;
/// 手动缩放的下限（原型的 MIN_WIDTH、MIN_HEIGHT，按 13px 字号计）。
const MIN_SIZE: (f64, f64) = (320.0, 140.0);
/// 动画层没有回应时，多久之后直接显示窗口或收起动画层。
const ANIMATION_TIMEOUT: Duration = Duration::from_millis(2500);
/// 新窗口显示之后，动画层上的副本再留多久：等窗口画出第一帧，交接时不闪。
const HANDOFF_DELAY: Duration = Duration::from_millis(160);
/// 连接带在全文浮窗一端让开上下的圆角（按 13px 字号计）。
const CONNECTOR_INSET: f64 = 16.0;
/// 连接带在卡片一端让开上下的圆角（按 13px 字号计）。
const CONNECTOR_CARD_INSET: f64 = 6.0;

/// 后端发给页面的事件。
pub mod events {
    /// 备用窗口收到要打开的记录，载荷见 OpenPayload。
    pub const OPEN: &str = "sidenotes://note-window/open";
    /// 把记录放进窗口的标签页，载荷 { ids, x, y }，x、y 是相对窗口内容区的物理像素。
    pub const ADD: &str = "sidenotes://note-window/add";
    /// 记录移到了别的窗口，从这里拿走，载荷 { ids }。
    pub const REMOVE: &str = "sidenotes://note-window/remove";
    /// 已经打开的记录再次展开：切到它的标签页并轻轻放大一下，载荷 { id }。
    pub const ACTIVATE: &str = "sidenotes://note-window/activate";
    /// 拖动经过这个窗口：标出合并的位置，载荷 { x, y } 或 null（离开）。
    pub const HINT: &str = "sidenotes://note-window/hint";
    /// 关闭窗口（Alt+F4、关闭全部记录窗口），按页面的关闭流程先保存、再播放关闭动画。
    pub const CLOSE: &str = "sidenotes://note-window/close";
    /// 动画层：拖影，载荷见 GhostPayload。
    pub const GHOST: &str = "sidenotes://overlay/ghost";
    /// 动画层：标签栏里的插入线，载荷为矩形与方向，或 null。
    pub const INDICATOR: &str = "sidenotes://overlay/indicator";
    /// 动画层：打开或关闭的形变动画，载荷见 MorphPayload。
    pub const MORPH: &str = "sidenotes://overlay/morph";
    /// 动画层：去掉已经交接给窗口的副本，载荷为动画标识。
    pub const CLEAR: &str = "sidenotes://overlay/clear";
    /// 侧栏：窗口缩回了这张卡片，卡片轻轻一顿，载荷为记录标识。
    pub const LAND: &str = "sidenotes://card-land";
    /// 侧栏：附着在卡片旁的全文浮窗开着的记录（T100），载荷为记录标识或 null；卡片的按钮据此显示「收起全文」。
    pub const PEEK: &str = "sidenotes://peek";
    /// 全文浮窗成为独立的记录窗口（拖动标题栏、有别的记录并进来、双击放大），载荷为空。
    pub const DETACH: &str = "sidenotes://note-window/detach";
    /// 动画层：全文浮窗与卡片之间的连接带，载荷见 ConnectorPayload，null 时收起。
    pub const CONNECTOR: &str = "sidenotes://overlay/connector";
    /// 动画层：按住 Ctrl 拖动时被挡住的记录窗口，载荷为矩形列表（相对动画层内容区的物理像素），空列表时收起（T105）。
    pub const REVEAL: &str = "sidenotes://overlay/reveal";
    /// 记录窗口：要提到最前了，页面先整页透明，好了调用 note_window_surface_ready（浮现的第一步，T119）。
    pub const SURFACE: &str = "sidenotes://note-window/surface";
    /// 记录窗口：已经提到最前，页面淡入、轻轻上浮（浮现的第二步）。
    pub const SURFACED: &str = "sidenotes://note-window/surfaced";
    /// 记录窗口：用户开始（true）或结束（false）拖边框改大小（系统的拉伸，页面收不到指针事件，T123，见 watch_sizing）。
    pub const SIZING: &str = "sidenotes://note-window/sizing";
}

/// 矩形：屏幕或窗口内的物理像素，或页面像素（由用途决定）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.right() && y >= self.y && y <= self.bottom()
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    /// 页面像素换算到物理像素：乘以页面像素比，再加上内容区左上角。
    fn to_screen(self, origin: (f64, f64), dpr: f64) -> Rect {
        Rect { x: origin.0 + self.x * dpr, y: origin.1 + self.y * dpr, width: self.width * dpr, height: self.height * dpr }
    }

    fn relative_to(self, origin: (f64, f64)) -> Rect {
        Rect { x: self.x - origin.0, y: self.y - origin.1, ..self }
    }
}

/// 页面像素比的合理范围，避免异常值把坐标放大到屏幕之外。
fn sane_dpr(dpr: f64) -> f64 {
    if dpr.is_finite() { dpr.clamp(0.25, 8.0) } else { 1.0 }
}

/// 发给备用窗口的打开请求。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPayload {
    pub tabs: Vec<String>,
    pub active: String,
    pub pinned: bool,
    /// drag：拖出的（关闭时倾斜着缩回卡片）；expand：展开全文的（原路滑回）。
    pub origin: String,
    /// expand、drop 或 detach，决定出场动画。
    pub kind: String,
    /// 目标屏幕的工作区（物理像素），页面除以页面像素比，限制按内容定的尺寸。
    pub area: Rect,
    /// 附着在卡片旁的全文浮窗（T100）：点到别处收回，不显示置顶按钮。
    pub attached: bool,
}

/// 窗口的生命阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// 隐藏的备用窗口。
    Spare,
    /// 收到了要打开的记录，等页面量好尺寸。
    Opening,
    Open,
    /// 正在播放关闭动画，不再参与命中与合并。
    Closing,
}

/// 新窗口的摆放依据（原型 position）。
#[derive(Debug, Clone)]
struct Placement {
    /// 松开处：标题栏落在这里。
    point: Option<(f64, f64)>,
    /// 出场动画的起点：展开全文时是卡片，拖出时是拖影。
    from: Option<Rect>,
    /// 目标屏幕的工作区。
    area: Rect,
}

#[derive(Debug, Clone)]
struct Entry {
    phase: Phase,
    /// 页面已经启动并取过初始化数据：之后的打开请求用事件送达。
    ready: bool,
    tabs: Vec<String>,
    active: String,
    pinned: bool,
    origin: String,
    /// 附着在卡片旁的全文浮窗（T100）。同一时间最多一个。
    attached: bool,
    /// 标题栏与竖排标签栏，相对内容区左上角的物理像素；标签页与窗口拖到这里时合并。
    bands: Vec<Rect>,
    /// 最近获得焦点的次序，近似窗口的前后关系（置顶的窗口总在前面）。
    order: u64,
    pending: Option<OpenPayload>,
    placement: Option<Placement>,
    /// 双击标题栏放大之前的内容区矩形。
    restore: Option<Rect>,
}

impl Entry {
    fn spare() -> Self {
        Entry {
            phase: Phase::Spare,
            ready: false,
            tabs: Vec::new(),
            active: String::new(),
            pinned: false,
            origin: String::new(),
            attached: false,
            bands: Vec::new(),
            order: 0,
            pending: None,
            placement: None,
            restore: None,
        }
    }
}

fn registry() -> &'static Mutex<HashMap<String, Entry>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_registry<T>(action: impl FnOnce(&mut HashMap<String, Entry>) -> T) -> T {
    let mut guard = registry().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

static SEQUENCE: AtomicU32 = AtomicU32::new(0);
static ORDER: AtomicU64 = AtomicU64::new(0);
static ANIMATION: AtomicU64 = AtomicU64::new(0);

/// 全文浮窗所附着的卡片：卡片在屏幕上的矩形（物理像素，卡片看不见时为空）与侧栏的页面像素比。
#[derive(Debug, Clone, Copy)]
struct PeekAnchor {
    card: Option<Rect>,
    unit: f64,
}

static PEEK_ANCHOR: Mutex<Option<PeekAnchor>> = Mutex::new(None);
/// 连线正画在动画层上：这时动画层不收起。
static CONNECTOR_SHOWN: AtomicBool = AtomicBool::new(false);

/// 标签是否属于记录窗口。
pub fn is_note(label: &str) -> bool {
    label.starts_with(NOTE_PREFIX)
}

/* ==================== 几何 ==================== */

/// 内容区在屏幕上的矩形。
fn client_rect(window: &WebviewWindow) -> Option<Rect> {
    let position = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Rect { x: f64::from(position.x), y: f64::from(position.y), width: f64::from(size.width), height: f64::from(size.height) })
}

/// 按内容区摆放窗口。Tauri 的位置是外框，带阴影的无边框窗口外框比内容区大一圈看不见的边框，要补上。
///
/// Windows 上用一次 SetWindowPos 同时改位置与大小，放大、还原时不会先挪再变；挪到缩放比例不同的屏幕时，
/// 系统按新屏幕的比例改一次大小，所以量一下，不对再摆一次（这时已经在新屏幕上）。
fn place_client(window: &WebviewWindow, rect: Rect) -> AppResult<()> {
    for _ in 0..2 {
        let (inner_position, outer_position, inner_size, outer_size) =
            (window.inner_position()?, window.outer_position()?, window.inner_size()?, window.outer_size()?);
        let inset = (inner_position.x - outer_position.x, inner_position.y - outer_position.y);
        let extra = (outer_size.width as i32 - inner_size.width as i32, outer_size.height as i32 - inner_size.height as i32);
        let (x, y) = (rect.x.round() as i32 - inset.0, rect.y.round() as i32 - inset.1);
        let (width, height) = (rect.width.round().max(1.0) as i32, rect.height.round().max(1.0) as i32);
        #[cfg(windows)]
        {
            use ::windows::Win32::Foundation::RECT;
            use ::windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER};
            let hwnd = window.hwnd()?;
            // 宽（或高）与现在差不到 2 像素时，外框的宽（或高）照现在的不动：按内容区加边框换算出的外框会差一两个像素，
            // 编辑时每打一个字都按内容重新定一次大小（T123），每次多出一点，窗口越来越宽。
            let mut frame = RECT::default();
            // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，只读外框。
            let framed = unsafe { GetWindowRect(hwnd, &mut frame) }.is_ok();
            let keep_width = framed && (width - inner_size.width as i32).abs() <= 2;
            let keep_height = framed && (height - inner_size.height as i32).abs() <= 2;
            let outer_width = if keep_width { frame.right - frame.left } else { width + extra.0 };
            let outer_height = if keep_height { frame.bottom - frame.top } else { height + extra.1 };
            // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，其余参数都是按值传入的整数。
            unsafe { SetWindowPos(hwnd, None, x, y, outer_width, outer_height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER) }
                .map_err(|error| AppError::Other(format!("窗口操作失败：{error}")))?;
        }
        #[cfg(not(windows))]
        {
            let _ = extra;
            window.set_position(PhysicalPosition::new(x, y))?;
            window.set_size(PhysicalSize::new(width as u32, height as u32))?;
        }
        let now = window.inner_size()?;
        if (now.width as i32 - width).abs() <= 2 && (now.height as i32 - height).abs() <= 2 {
            break;
        }
    }
    Ok(())
}

fn work_rect(monitor: &Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        width: f64::from(area.size.width),
        height: f64::from(area.size.height),
    }
}

/// 点所在的屏幕；不在任何屏幕上时用主屏。
fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<Monitor> {
    app.monitor_from_point(x, y).ok().flatten().or_else(|| app.primary_monitor().ok().flatten())
}

/// 显示中的侧栏的内容区。
fn sidebar_rect(app: &AppHandle) -> Option<Rect> {
    let sidebar = app.get_webview_window(SIDEBAR_LABEL)?;
    if !sidebar.is_visible().unwrap_or(false) {
        return None;
    }
    client_rect(&sidebar)
}

fn cursor(app: &AppHandle) -> (f64, f64) {
    app.cursor_position().map(|point| (point.x, point.y)).unwrap_or((0.0, 0.0))
}

/// 全文浮窗的纵向位置（T114，2026-11-19 用户要求）：优先与卡片顶边对齐；顶边对齐会被工作区底边推上去超过
/// 两倍留白（卡片靠下或浮窗很高）时，对齐已经看不出来，改为与卡片垂直居中；居中也放不下时贴着工作区的边。
/// 推上去不多时仍算对齐，不换成居中。`margin` 为离工作区边缘的留白（物理像素）。
fn peek_top(card: Rect, height: f64, area: Rect, margin: f64) -> f64 {
    let low = area.y + margin;
    let high = (area.bottom() - margin - height).max(low);
    let aligned = card.y.clamp(low, high);
    if (aligned - card.y).abs() <= margin * 2.0 {
        return aligned;
    }
    (card.y + card.height / 2.0 - height / 2.0).clamp(low, high)
}

/// 新窗口的位置（原型 position）：拖出时标题栏在松开处；展开全文时放在侧栏旁边，纵向见 peek_top。
/// 尽量不压住侧栏，与已开的窗口左上角太近时错开，最后限制在工作区内。`unit` 为页面像素换算到物理像素的比例。
fn position(placement: &Placement, size: (f64, f64), unit: f64, sidebar: Option<Rect>, right_edge: bool, others: &[Rect]) -> Rect {
    let (width, height) = size;
    let area = placement.area;
    let margin = MARGIN * unit;
    let (mut x, mut y) = match placement.point {
        Some((px, py)) => (px - width / 2.0, py - 20.0 * unit),
        None => {
            let y = match placement.from {
                Some(card) => peek_top(card, height, area, margin),
                None => area.y + area.height / 4.0,
            };
            let x = match sidebar {
                Some(bar) if right_edge => bar.x - width - margin * 2.0,
                Some(bar) => bar.right() + margin * 2.0,
                None => area.x + (area.width - width) / 2.0,
            };
            (x, y)
        }
    };
    if let Some(bar) = sidebar {
        if right_edge && x + width > bar.x - margin {
            x = (bar.x - margin - width).max(area.x + margin);
        }
        if !right_edge && x < bar.right() + margin {
            x = (bar.right() + margin).min(area.right() - width - margin);
        }
    }
    for _ in 0..8 {
        let near = others.iter().any(|other| (other.x - x).abs() < 16.0 * unit && (other.y - y).abs() < 16.0 * unit);
        if !near {
            break;
        }
        x += 24.0 * unit;
        y += 24.0 * unit;
    }
    Rect {
        x: x.clamp(area.x + margin, (area.right() - width - margin).max(area.x + margin)),
        y: y.clamp(area.y + margin, (area.bottom() - height - margin).max(area.y + margin)),
        width,
        height,
    }
}

/// 双击标题栏放大后的矩形（原型 maximize）：工作区里侧栏之外的部分，四周留白。
fn maximized(area: Rect, sidebar: Option<Rect>, right_edge: bool, unit: f64) -> Rect {
    let margin = MARGIN * unit;
    let left = match sidebar {
        Some(bar) if !right_edge => bar.right() + margin,
        _ => area.x + margin,
    };
    let right = match sidebar {
        Some(bar) if right_edge => bar.x - margin,
        _ => area.right() - margin,
    };
    Rect {
        x: left,
        y: area.y + margin,
        width: (right - left).max(MIN_SIZE.0 * unit),
        height: (area.height - margin * 2.0).max(MIN_SIZE.1 * unit),
    }
}

/* ==================== 窗口的创建与显示 ==================== */

/// 新建一个隐藏的记录窗口。建窗口要回到主线程，调用方在别的线程上调用。
///
/// 记录窗口没置顶时是普通窗口：有任务栏按钮、出现在 Alt+Tab 中，被别的窗口盖住后从这里找回来；
/// 置顶（或附着在卡片旁）时是面板，不进任务栏与 Alt+Tab，显示桌面时不动（见 apply_topmost、panels）。
fn build(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    let builder =WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("SideNotes 记录")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .skip_taskbar(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .focused(false)
        .inner_size(420.0, 320.0)
        .disable_drag_drop_handler();
    let window = builder.build()?;
    // 出入由页面与动画层负责，不要系统的淡入淡出：交接给窗口时会叠出一层半透明。
    windows::disable_transitions(&window);
    crate::app_icon::apply_current(&window);
    watch_sizing(&window);
    Ok(window)
}

/// 用户拖边框改大小时告诉页面（T123）：带阴影的无边框窗口拉伸用的是阴影里看不见的一圈边框，由系统处理，
/// 页面收不到指针事件，分不出这是手动改的大小。挂一个子类：系统的拉伸第一次改大小（WM_SIZING）时发 true，
/// 拉伸结束（WM_EXITSIZEMOVE）时发 false，页面结束时记下手动的大小。子类要在窗口所在的主线程上挂。
fn watch_sizing(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let value = hwnd.0 as isize;
        sizing::remember(window.app_handle(), value, window.label());
        let _ = window.run_on_main_thread(move || sizing::attach(value));
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
mod sizing {
    use std::sync::{Mutex, OnceLock};

    use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use ::windows::Win32::UI::WindowsAndMessaging::{WM_EXITSIZEMOVE, WM_SIZING};
    use tauri::{AppHandle, Emitter};

    /// 子类的标识（与 tao、面板的子类区分开）。
    const ID: usize = 0x534E_535A;
    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// 记录窗口的句柄与标签（窗口一直留着当备用，标签不变）。
    static LABELS: Mutex<Vec<(isize, String)>> = Mutex::new(Vec::new());
    /// 正在被系统拉伸的窗口。
    static ACTIVE: Mutex<Vec<isize>> = Mutex::new(Vec::new());

    pub fn remember(app: &AppHandle, hwnd: isize, label: &str) {
        APP.get_or_init(|| app.clone());
        if let Ok(mut list) = LABELS.lock() {
            list.retain(|(item, _)| *item != hwnd);
            list.push((hwnd, label.to_string()));
        }
    }

    pub fn attach(hwnd: isize) {
        // SAFETY：hwnd 是本应用在主线程上创建的窗口，子类过程是本模块里的函数，在窗口所在的线程上挂。
        let attached = unsafe { SetWindowSubclass(HWND(hwnd as *mut core::ffi::c_void), Some(procedure), ID, 0) }.as_bool();
        if !attached {
            crate::diag::log("记录窗口的子类挂接失败，拖边框改的大小不会记作手动的大小");
        }
    }

    unsafe extern "system" fn procedure(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        let value = window.0 as isize;
        if message == WM_SIZING {
            let started = ACTIVE.lock().is_ok_and(|mut list| {
                let fresh = !list.contains(&value);
                if fresh {
                    list.push(value);
                }
                fresh
            });
            if started {
                notify(value, true);
            }
        } else if message == WM_EXITSIZEMOVE {
            let ended = ACTIVE.lock().is_ok_and(|mut list| {
                let had = list.contains(&value);
                list.retain(|item| *item != value);
                had
            });
            if ended {
                notify(value, false);
            }
        }
        // SAFETY：照常交给下一层窗口过程。
        unsafe { DefSubclassProc(window, message, wparam, lparam) }
    }

    fn notify(hwnd: isize, active: bool) {
        let label = LABELS.lock().ok().and_then(|list| list.iter().find(|(item, _)| *item == hwnd).map(|(_, label)| label.clone()));
        if let (Some(app), Some(label)) = (APP.get(), label) {
            let _ = app.emit_to(label.as_str(), super::events::SIZING, active);
        }
    }
}

/// 补一个备用窗口（已经有了就不补）。
pub fn ensure_spare(app: &AppHandle) {
    let label = with_registry(|map| {
        if map.values().any(|entry| entry.phase == Phase::Spare) {
            return None;
        }
        let label = format!("{NOTE_PREFIX}{}", SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1);
        map.insert(label.clone(), Entry::spare());
        Some(label)
    });
    let Some(label) = label else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = build(&app, &label) {
            eprintln!("记录窗口创建失败：{error}");
            with_registry(|map| map.remove(&label));
        }
    });
}

/// 正在等着补备用窗口（只留一个等待的线程）。
static SPARE_PENDING: AtomicBool = AtomicBool::new(false);

/// 前台窗口是否属于本应用。
fn app_in_foreground() -> bool {
    #[cfg(windows)]
    {
        use ::windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        // SAFETY：只读取前台窗口与它所属的进程，参数都是本函数内的值。
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return false;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            pid == std::process::id()
        }
    }
    #[cfg(not(windows))]
    false
}

/// 稍后补一个备用窗口，不和启动或正在打开的窗口抢资源。
///
/// 新建的 WebView 加载时会让本应用当前的窗口失去焦点（窗口本身并不显示）：全文浮窗因此收回，
/// 正在记录窗口或侧栏里输入的内容也会被打断。所以等本应用的窗口都不在前台时再建（T100）；
/// 一直在用时不建，下次打开记录窗口时现建，慢一点。
pub fn ensure_spare_later(app: &AppHandle, delay: Duration) {
    if SPARE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        while app_in_foreground() {
            std::thread::sleep(Duration::from_secs(1));
        }
        SPARE_PENDING.store(false, Ordering::SeqCst);
        ensure_spare(&app);
    });
}

/// 显示窗口并聚焦。被 Win+D 最小化了（没置顶的窗口）先还原。
fn show_note(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        crate::topmost::restore_if_minimized(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 应当置顶的记录窗口：置顶的与附着在卡片旁的全文浮窗（置顶守护与 Win+D 防护用，见 topmost）。
pub fn topmost_windows() -> Vec<String> {
    with_registry(|map| {
        map.iter()
            .filter(|(_, entry)| entry.phase == Phase::Open && (entry.pinned || entry.attached))
            .map(|(label, _)| label.clone())
            .collect()
    })
}

/// 记录窗口的置顶（T120）：置顶（或附着在卡片旁）时是面板，不进任务栏与 Alt+Tab，显示桌面时不动（见 panels），
/// 不可最小化；取消置顶后是普通窗口，可以最小化，显示桌面时与别的窗口一起收起。置顶直接设到窗口上
/// （tao 记着的标志可能与实际不一致）。面板先设好，之后 tao 按标志重写样式时经过面板的子类。
fn apply_topmost(window: &WebviewWindow, on: bool) {
    let was = crate::panels::set(window, on);
    crate::topmost::set_topmost(window, on);
    let _ = window.set_minimizable(!on);
    if was != on {
        // 任务栏按钮跟着增删（显示着的窗口改样式后任务栏不会自己更新）。
        let _ = window.set_skip_taskbar(on);
    }
    #[cfg(windows)]
    if on {
        // 工具窗口不一定有系统圆角，请系统画圆角。
        if let Ok(hwnd) = window.hwnd() {
            use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DWM_WINDOW_CORNER_PREFERENCE};
            let corner: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
            // SAFETY：hwnd 来自仍然存在的 Tauri 窗口；指针指向本函数内的值，大小与之匹配。
            let _ = unsafe {
                DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, (&corner as *const DWM_WINDOW_CORNER_PREFERENCE).cast(), std::mem::size_of_val(&corner) as u32)
            };
        }
    }
}

/// 每条记录只在一个窗口中打开：从其它窗口拿走这些记录（不含 `except`）。
fn remove_from_others(app: &AppHandle, ids: &[String], except: Option<&str>) {
    let owners: Vec<(String, Vec<String>)> = with_registry(|map| {
        map.iter()
            .filter(|(label, entry)| Some(label.as_str()) != except && matches!(entry.phase, Phase::Open | Phase::Opening))
            .filter_map(|(label, entry)| {
                let taken: Vec<String> = entry.tabs.iter().filter(|id| ids.contains(id)).cloned().collect();
                (!taken.is_empty()).then(|| (label.clone(), taken))
            })
            .collect()
    });
    for (label, taken) in owners {
        with_registry(|map| {
            if let Some(entry) = map.get_mut(&label) {
                entry.tabs.retain(|id| !taken.contains(id));
            }
        });
        let _ = app.emit_to(label.as_str(), events::REMOVE, serde_json::json!({ "ids": taken }));
    }
}

/// 打开记录窗口（原型 open 与 openFromDrag）。`kind` 为 expand、drop 或 detach；
/// `point` 为松开处，`from` 为出场动画的起点（卡片或拖影），都是屏幕物理像素。
fn open(app: &AppHandle, ids: Vec<String>, kind: &str, pinned: bool, point: Option<(f64, f64)>, from: Option<Rect>, peek_unit: f64) -> AppResult<()> {
    let tabs = unique(ids);
    let Some(first) = tabs.first().cloned() else { return Ok(()) };

    // 展开全文时，记录已经在某个窗口里：切到它的标签页并提到最前。
    if kind == "expand" {
        let owner = with_registry(|map| {
            map.iter()
                .find(|(_, entry)| entry.phase == Phase::Open && entry.tabs.contains(&first))
                .map(|(label, _)| label.clone())
        });
        if let Some(label) = owner {
            let _ = app.emit_to(label.as_str(), events::ACTIVATE, serde_json::json!({ "id": first }));
            show_note(app, &label);
            return Ok(());
        }
    }
    remove_from_others(app, &tabs, None);
    let attached = kind == "expand";
    if attached {
        // 同一时间只有一个全文浮窗：旧的先不算附着（它关闭时不会清掉新浮窗的状态），再请它收回。
        let previous: Vec<String> = with_registry(|map| {
            map.iter_mut()
                .filter(|(_, entry)| entry.attached)
                .map(|(label, entry)| {
                    entry.attached = false;
                    label.clone()
                })
                .collect()
        });
        for label in previous {
            let _ = app.emit_to(label.as_str(), events::CLOSE, ());
        }
    }

    let anchor = point.or_else(|| from.map(|rect| rect.center())).unwrap_or_else(|| cursor(app));
    let monitor = monitor_at(app, anchor.0, anchor.1).ok_or_else(|| AppError::Other("未能获取显示器信息".into()))?;
    let area = work_rect(&monitor);
    let origin = if kind == "expand" { "expand" } else { "drag" };
    let payload = OpenPayload { tabs: tabs.clone(), active: first.clone(), pinned, origin: origin.into(), kind: kind.into(), area, attached };
    let placement = Placement { point, from, area };

    // 取备用窗口；没有时现建一个（第一次打开或连续打开时）。备用窗口还在建或页面还没启动时，
    // 打开请求先记在登记表里，页面启动后自己来取（note_window_init）。
    let (label, fresh) = with_registry(|map| {
        match map.iter().find(|(_, entry)| entry.phase == Phase::Spare).map(|(label, _)| label.clone()) {
            Some(label) => (label, false),
            None => {
                let label = format!("{NOTE_PREFIX}{}", SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1);
                map.insert(label.clone(), Entry::spare());
                (label, true)
            }
        }
    });
    let deliver = with_registry(|map| {
        let entry = map.get_mut(&label)?;
        entry.phase = Phase::Opening;
        entry.tabs = payload.tabs.clone();
        entry.active = payload.active.clone();
        entry.pinned = pinned;
        entry.origin = origin.into();
        entry.attached = attached;
        entry.placement = Some(placement);
        entry.restore = None;
        if entry.ready {
            Some(payload.clone())
        } else {
            entry.pending = Some(payload.clone());
            None
        }
    });
    // 隐藏的窗口先挪到目标屏幕上，页面量尺寸时的屏幕缩放与显示时一致。
    let park = PhysicalPosition::new((area.x + 40.0) as i32, (area.y + 40.0) as i32);
    if fresh {
        let app = app.clone();
        let building = label.clone();
        std::thread::spawn(move || match build(&app, &building) {
            Ok(window) => {
                let _ = window.set_position(park);
            }
            Err(error) => {
                eprintln!("记录窗口创建失败：{error}");
                with_registry(|map| map.remove(&building));
            }
        });
    } else if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_position(park);
        if let Some(payload) = deliver {
            let _ = app.emit_to(label.as_str(), events::OPEN, payload);
        }
    }
    if attached {
        if let Ok(mut slot) = PEEK_ANCHOR.lock() {
            *slot = Some(PeekAnchor { card: from, unit: peek_unit });
        }
        let _ = app.emit_to(SIDEBAR_LABEL, events::PEEK, Some(first));
    }
    ensure_spare_later(app, Duration::from_millis(1200));
    Ok(())
}

/// 去掉空的与重复的记录标识，最多 MAX_TABS 条。
fn unique(ids: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for id in ids {
        if !id.is_empty() && !result.contains(&id) {
            result.push(id);
        }
    }
    result.truncate(MAX_TABS);
    result
}

/* ==================== 动画层 ==================== */

/// 动画层正在做的事：打开动画结束后显示窗口，关闭动画开始后销毁窗口、结束后让卡片一顿。
#[derive(Debug, Clone)]
enum Animation {
    Open { label: String },
    /// `note` 为缩回的卡片对应的记录；原地淡出时为空，侧栏没有卡片要一顿。
    Close { label: String, note: Option<String> },
}

fn animations() -> &'static Mutex<HashMap<u64, Animation>> {
    static ANIMATIONS: OnceLock<Mutex<HashMap<u64, Animation>>> = OnceLock::new();
    ANIMATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_animations<T>(action: impl FnOnce(&mut HashMap<u64, Animation>) -> T) -> T {
    let mut guard = animations().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// 动画层当前盖住的屏幕工作区（物理像素）。
static OVERLAY_AREA: Mutex<Option<Rect>> = Mutex::new(None);

fn overlay_area() -> Option<Rect> {
    OVERLAY_AREA.lock().ok().and_then(|slot| *slot)
}

/// 动画层盖住点所在屏幕的工作区并显示（不抢焦点、点击穿透），返回它的内容区左上角。
fn overlay_cover(app: &AppHandle, x: f64, y: f64) -> Option<(f64, f64)> {
    let overlay = app.get_webview_window(OVERLAY_LABEL)?;
    let area = work_rect(&monitor_at(app, x, y)?);
    if overlay_area() != Some(area) {
        let _ = overlay.set_position(PhysicalPosition::new(area.x as i32, area.y as i32));
        let _ = overlay.set_size(PhysicalSize::new(area.width as u32, area.height as u32));
        if let Ok(mut slot) = OVERLAY_AREA.lock() {
            *slot = Some(area);
        }
    }
    show_without_focus(&overlay);
    client_rect(&overlay).map(|rect| (rect.x, rect.y)).or(Some((area.x, area.y)))
}

/// 动画层空闲时（没有拖动、动画与连线）收起。
fn overlay_release(app: &AppHandle) {
    if drag_active() || with_animations(|map| !map.is_empty()) || CONNECTOR_SHOWN.load(Ordering::SeqCst) {
        return;
    }
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        hide_window(&overlay);
    }
}

/// 不激活地显示窗口并放到置顶层的最前面。Tauri 的 show 会激活窗口，动画层不能抢走焦点。
fn show_without_focus(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        };
        // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，其余参数都是按值传入的常量。
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW) };
        return;
    }
    let _ = window.show();
}

fn hide_window(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        // SAFETY：同上。
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
        return;
    }
    let _ = window.hide();
}

/// 形变动画的载荷：矩形相对动画层的内容区（物理像素）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MorphPayload {
    id: u64,
    html: String,
    from: Rect,
    /// 关闭时卡片看不见为空：原地提起淡出。
    to: Option<Rect>,
    /// open-drag、open-expand、close-drag 或 close-expand。
    mode: String,
}

/// 在动画层上播放打开动画：窗口的副本从 `from` 变到窗口的位置，结束后显示真正的窗口。
fn play_open(app: &AppHandle, label: &str, html: String, from: Rect, to: Rect, mode: &str) {
    let (cx, cy) = to.center();
    let Some(origin) = overlay_cover(app, cx, cy) else {
        show_note(app, label);
        return;
    };
    let id = ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    with_animations(|map| map.insert(id, Animation::Open { label: label.into() }));
    let payload = MorphPayload { id, html, from: from.relative_to(origin), to: Some(to.relative_to(origin)), mode: mode.into() };
    let _ = app.emit_to(OVERLAY_LABEL, events::MORPH, payload);
    watchdog(app, id);
}

/// 动画层没有回应（页面卡住或还没加载好）时，按动画已经结束处理。
fn watchdog(app: &AppHandle, id: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ANIMATION_TIMEOUT);
        if with_animations(|map| map.contains_key(&id)) {
            finish_animation(&app, id);
        }
    });
}

fn finish_animation(app: &AppHandle, id: u64) {
    let Some(animation) = with_animations(|map| map.remove(&id)) else { return };
    match animation {
        Animation::Open { label } => {
            show_note(app, &label);
            update_connector(app);
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(HANDOFF_DELAY);
                let _ = app.emit_to(OVERLAY_LABEL, events::CLEAR, id);
                overlay_release(&app);
            });
        }
        Animation::Close { label, note } => {
            destroy(app, &label);
            if let Some(note) = note {
                let _ = app.emit_to(SIDEBAR_LABEL, events::LAND, note);
            }
            let _ = app.emit_to(OVERLAY_LABEL, events::CLEAR, id);
            overlay_release(app);
        }
    }
}

fn destroy(app: &AppHandle, label: &str) {
    let entry = with_registry(|map| map.remove(label));
    if entry.is_some_and(|entry| entry.attached) {
        release_peek(app);
    }
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

/// 窗口销毁后从登记表中去掉（页面崩溃、开发时整页重载之外的正常关闭已经先去掉了）。
pub fn forget(app: &AppHandle, label: &str) {
    let entry = with_registry(|map| map.remove(label));
    if entry.is_some_and(|entry| entry.attached) {
        release_peek(app);
    }
}

/* ==================== 全文浮窗（T100） ==================== */

/// 卡片与浮窗之间的连接带（T114，2026-11-19 用户要求换掉单调的虚线）：卡片朝向浮窗的一边与浮窗朝向侧栏的一边
/// 围成的一块梯形，像把卡片投影放大成浮窗。各取一条竖边：横坐标、上端、下端，上下各让开圆角（卡片 `card_inset`，
/// 浮窗 `panel_inset`，不超过边长的四分之一）。`right_edge` 为侧栏贴右边（浮窗在侧栏左边）。
fn connector_beam(card: Rect, panel: Rect, right_edge: bool, card_inset: f64, panel_inset: f64) -> ConnectorPayload {
    let side = |rect: Rect, x: f64, inset: f64| {
        let inset = inset.min(rect.height / 4.0);
        (x, rect.y + inset, rect.bottom() - inset)
    };
    ConnectorPayload {
        card: side(card, if right_edge { card.x } else { card.right() }, card_inset),
        panel: side(panel, if right_edge { panel.right() } else { panel.x }, panel_inset),
    }
}

/// 连接带的载荷：卡片一端与浮窗一端的竖边（横坐标、上端、下端），相对动画层内容区的物理像素。
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
struct ConnectorPayload {
    card: (f64, f64, f64),
    panel: (f64, f64, f64),
}

impl ConnectorPayload {
    fn relative_to(self, origin: (f64, f64)) -> Self {
        let shift = |(x, top, bottom): (f64, f64, f64)| (x - origin.0, top - origin.1, bottom - origin.1);
        ConnectorPayload { card: shift(self.card), panel: shift(self.panel) }
    }
}

/// 按全文浮窗与卡片现在的位置画连线，动画层提到最前（它不接收指针，盖在上面不碍事）；
/// 没有附着的浮窗、浮窗还没显示、侧栏收起或卡片看不见时收起连线。
fn update_connector(app: &AppHandle) {
    let anchor = PEEK_ANCHOR.lock().ok().and_then(|slot| *slot).filter(|_| sidebar_rect(app).is_some());
    let label = with_registry(|map| {
        map.iter().find(|(_, entry)| entry.attached && entry.phase == Phase::Open).map(|(label, _)| label.clone())
    });
    let ends = match (anchor, label) {
        (Some(PeekAnchor { card: Some(card), unit }), Some(label)) => app
            .get_webview_window(&label)
            .filter(|window| window.is_visible().unwrap_or(false))
            .and_then(|window| client_rect(&window))
            .map(|panel| {
                let right_edge = windows::last_layout().edge != "left";
                connector_beam(card, panel, right_edge, CONNECTOR_CARD_INSET * unit, CONNECTOR_INSET * unit)
            }),
        _ => None,
    };
    if let Some(beam) = ends {
        let middle = ((beam.card.0 + beam.panel.0) / 2.0, (beam.card.1 + beam.card.2) / 2.0);
        if let Some(origin) = overlay_cover(app, middle.0, middle.1) {
            CONNECTOR_SHOWN.store(true, Ordering::SeqCst);
            let _ = app.emit_to(OVERLAY_LABEL, events::CONNECTOR, beam.relative_to(origin));
            return;
        }
    }
    if CONNECTOR_SHOWN.swap(false, Ordering::SeqCst) {
        let _ = app.emit_to(OVERLAY_LABEL, events::CONNECTOR, serde_json::Value::Null);
        overlay_release(app);
    }
}

/// 全文浮窗不再附着（收回或成为独立窗口）：侧栏的按钮换回「展开全文」，收起连线。
fn release_peek(app: &AppHandle) {
    if let Ok(mut slot) = PEEK_ANCHOR.lock() {
        *slot = None;
    }
    let _ = app.emit_to(SIDEBAR_LABEL, events::PEEK, None::<String>);
    update_connector(app);
}

/// 全文浮窗成为独立的记录窗口：置顶按窗口自己的设置（默认不置顶，进任务栏与 Alt+Tab），去掉连线。
fn detach(app: &AppHandle, label: &str) {
    let pinned = with_registry(|map| {
        let entry = map.get_mut(label)?;
        if !entry.attached {
            return None;
        }
        entry.attached = false;
        Some(entry.pinned)
    });
    let Some(pinned) = pinned else { return };
    if let Some(window) = app.get_webview_window(label) {
        apply_topmost(&window, pinned);
    }
    let _ = app.emit_to(label, events::DETACH, ());
    release_peek(app);
}

/// 收回附着在卡片旁的全文浮窗（侧栏收起时）：交给页面按关闭流程处理，先保存编辑再缩回卡片。
pub fn close_attached(app: &AppHandle) {
    let labels: Vec<String> = with_registry(|map| {
        map.iter()
            .filter(|(_, entry)| entry.attached && matches!(entry.phase, Phase::Opening | Phase::Open))
            .map(|(label, _)| label.clone())
            .collect()
    });
    for label in labels {
        let _ = app.emit_to(label.as_str(), events::CLOSE, ());
    }
}

/// 记录窗口获得焦点或改了大小：是全文浮窗时重画连线（获得焦点的窗口会盖住动画层，把它提回最前），
/// 并补上工具窗口的样式。
pub fn refresh_connector(app: &AppHandle, label: &str) {
    if with_registry(|map| map.get(label).is_some_and(|entry| entry.attached && entry.phase == Phase::Open)) {
        update_connector(app);
    }
}

/// 侧栏报告全文浮窗所附着的卡片在侧栏中的矩形（页面像素，卡片看不见时为空），连线跟着卡片走。
#[tauri::command]
pub fn peek_card(app: AppHandle, window: WebviewWindow, rect: Option<Rect>, dpr: f64) -> AppResult<()> {
    let unit = sane_dpr(dpr);
    let origin = client_rect(&window).map(|client| (client.x, client.y)).unwrap_or((0.0, 0.0));
    let changed = {
        let mut slot = PEEK_ANCHOR.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match slot.as_mut() {
            Some(anchor) => {
                anchor.card = rect.map(|rect| rect.to_screen(origin, unit));
                anchor.unit = unit;
                true
            }
            None => false,
        }
    };
    if changed {
        update_connector(&app);
    }
    Ok(())
}

/// 侧栏上点「收起全文」：收回这条记录的全文浮窗。
#[tauri::command]
pub fn collapse_peek(app: AppHandle, id: String) -> AppResult<()> {
    let label = with_registry(|map| {
        map.iter()
            .find(|(_, entry)| entry.attached && matches!(entry.phase, Phase::Opening | Phase::Open) && entry.tabs.contains(&id))
            .map(|(label, _)| label.clone())
    });
    if let Some(label) = label {
        let _ = app.emit_to(label.as_str(), events::CLOSE, ());
    }
    Ok(())
}

/// 窗口获得焦点：记下前后次序。
pub fn touch(label: &str) {
    with_registry(|map| {
        if let Some(entry) = map.get_mut(label) {
            entry.order = ORDER.fetch_add(1, Ordering::SeqCst) + 1;
        }
    });
}

/* ==================== 命中 ==================== */

/// 指针下可以合并的记录窗口（排除 `except`），返回标签与指针相对它内容区的位置。
/// `bands_only` 时只认标题栏与竖排的标签栏（标签页与窗口的合并），否则整个窗口（卡片拖进来）。
///
/// 只认看得见的窗口（T105）：从最前面往后找第一个盖住指针的窗口，是候选的记录窗口才算；被别的程序挡住的记录窗口
/// 不响应（原来按登记表找，压在别的程序下面的窗口也会标出插入线）。`reveal`（按住 Ctrl）时越过别的程序的窗口，
/// 找到下面的记录窗口就把它提到最前（不抢焦点），之后照常合并；本应用的其它窗口（侧栏、弹窗）挡住时一律不算。
/// `moving` 为正在拖动的窗口（跟着指针走，不算遮挡）。
fn window_at(app: &AppHandle, point: (f64, f64), except: Option<&str>, bands_only: bool, reveal: bool, moving: Option<&str>) -> Option<(String, f64, f64)> {
    let candidates: Vec<(String, Vec<Rect>)> = with_registry(|map| {
        map.iter()
            .filter(|(label, entry)| entry.phase == Phase::Open && Some(label.as_str()) != except)
            .map(|(label, entry)| (label.clone(), entry.bands.clone()))
            .collect()
    });
    let hit = |window: &WebviewWindow, bands: &[Rect]| -> Option<(f64, f64)> {
        let rect = client_rect(window)?;
        let (x, y) = (point.0 - rect.x, point.1 - rect.y);
        let inside = if bands_only { bands.iter().any(|band| band.contains(x, y)) } else { rect.contains(point.0, point.1) };
        inside.then_some((x, y))
    };
    #[cfg(windows)]
    {
        let windows: Vec<(isize, String, Vec<Rect>, WebviewWindow)> = candidates
            .into_iter()
            .filter_map(|(label, bands)| {
                let window = app.get_webview_window(&label)?;
                let hwnd = window.hwnd().ok()?.0 as isize;
                Some((hwnd, label, bands, window))
            })
            .collect();
        let skip = skip_handles(app, moving);
        let mut covered = false;
        for layer in zorder::layers() {
            if skip.contains(&layer.hwnd) || !layer.contains(point) {
                continue;
            }
            if let Some((_, label, bands, window)) = windows.iter().find(|(hwnd, ..)| *hwnd == layer.hwnd) {
                // 虚线框整块都算：指针一进框就把窗口提到最前（T105），带浮现动画（T119）；合并照旧只认标题栏与标签栏。
                if covered {
                    surface_windows(app, vec![window.clone()]);
                }
                let (x, y) = hit(window, bands)?;
                return Some((label.clone(), x, y));
            }
            if !reveal || layer.own {
                return None;
            }
            covered = true;
        }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = (reveal, moving);
        candidates.into_iter().find_map(|(label, bands)| {
            let window = app.get_webview_window(&label)?;
            if !window.is_visible().unwrap_or(false) {
                return None;
            }
            hit(&window, &bands).map(|(x, y)| (label, x, y))
        })
    }
}

/// 遮挡判断里跳过的窗口：动画层（点击穿透、盖住整块屏幕）与正在拖动的窗口。
#[cfg(windows)]
fn skip_handles(app: &AppHandle, moving: Option<&str>) -> Vec<isize> {
    [Some(OVERLAY_LABEL), moving]
        .into_iter()
        .flatten()
        .filter_map(|label| app.get_webview_window(label).and_then(|window| window.hwnd().ok()).map(|hwnd| hwnd.0 as isize))
        .collect()
}

/// 不激活地把窗口提到最前（置顶的窗口提到置顶一层的最前），动画层仍在它上面（拖影与插入线要盖住窗口）。
/// 被 Win+D 收走的窗口先还原。
fn raise_window(app: &AppHandle, window: &WebviewWindow) {
    crate::topmost::restore_if_minimized(window);
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        };
        // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，其余参数都是按值传入的常量。
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER) };
    }
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        if overlay.is_visible().unwrap_or(false) {
            show_without_focus(&overlay);
        }
    }
}

/// 卡片第一次拖出侧栏：被别的程序盖住、被 Win+D 收走的记录窗口全部提到最前，不抢焦点，拖动不断，
/// 方便拖进去合并（T104）；带浮现动画（T119）。按现在的前后次序从后往前提，提完之后它们之间的次序不变。
fn raise_note_windows(app: &AppHandle) {
    #[allow(unused_mut)]
    let mut windows: Vec<WebviewWindow> = with_registry(|map| {
        map.iter().filter(|(_, entry)| entry.phase == Phase::Open).map(|(label, _)| label.clone()).collect::<Vec<_>>()
    })
    .iter()
    .filter_map(|label| app.get_webview_window(label))
    .collect();
    #[cfg(windows)]
    {
        let order: Vec<isize> = zorder::layers().iter().map(|layer| layer.hwnd).collect();
        let rank = |window: &WebviewWindow| {
            window.hwnd().ok().and_then(|hwnd| order.iter().position(|item| *item == hwnd.0 as isize)).unwrap_or(usize::MAX)
        };
        windows.sort_by_key(|window| std::cmp::Reverse(rank(window)));
        // 只提被别的程序挡住（或被收起）的：露在最前的窗口不动，免得它也淡出再淡入。
        let skip = skip_handles(app, None);
        windows.retain(|window| {
            window.is_minimized().unwrap_or(false) || window.hwnd().is_ok_and(|hwnd| zorder::covered(hwnd.0 as isize, &skip))
        });
    }
    surface_windows(app, windows);
}

/// 等页面准备好浮现（整页透明）最多这么久（T119）：到时还没回话（页面忙）也照样提到最前。
const SURFACE_WAIT: Duration = Duration::from_millis(150);

/// 正在浮现的窗口：标签与页面是否已经整页透明。
static SURFACING: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());

/// 不激活地把这些窗口按给出的先后提到最前，带浮现动画（T119，2026-11-19 用户要求，不再突然闪现）：
/// 先让各窗口的页面整页透明（它们这时被别的程序挡着，看不出来），都好了（或等满 SURFACE_WAIT）再一起提到最前，
/// 然后页面淡入、轻轻上浮。已经在浮现的窗口跳过（拖动中每一步都可能要求提起同一个窗口）。
fn surface_windows(app: &AppHandle, windows: Vec<WebviewWindow>) {
    let labels: Vec<String> = {
        let Ok(mut pending) = SURFACING.lock() else { return };
        let fresh: Vec<String> = windows
            .iter()
            .map(|window| window.label().to_string())
            .filter(|label| !pending.iter().any(|(item, _)| item == label))
            .collect();
        pending.extend(fresh.iter().map(|label| (label.clone(), false)));
        fresh
    };
    if labels.is_empty() {
        return;
    }
    for label in &labels {
        let _ = app.emit_to(label.as_str(), events::SURFACE, ());
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + SURFACE_WAIT;
        while Instant::now() < deadline {
            let ready = SURFACING
                .lock()
                .map(|pending| labels.iter().all(|label| pending.iter().any(|(item, ok)| item == label && *ok)))
                .unwrap_or(true);
            if ready {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            for label in &labels {
                if let Some(window) = handle.get_webview_window(label) {
                    raise_window(&handle, &window);
                }
            }
            if let Ok(mut pending) = SURFACING.lock() {
                pending.retain(|(item, _)| !labels.contains(item));
            }
            for label in &labels {
                let _ = handle.emit_to(label.as_str(), events::SURFACED, ());
            }
        });
    });
}

/// 页面已经整页透明，可以提到最前了（浮现的第一步，见 surface_windows）。
#[tauri::command]
pub fn note_window_surface_ready(window: WebviewWindow) {
    if let Ok(mut pending) = SURFACING.lock() {
        if let Some(item) = pending.iter_mut().find(|(label, _)| label == window.label()) {
            item.1 = true;
        }
    }
}

/// 按住 Ctrl 拖动时更新动画层上的虚线框：被别的程序挡住的记录窗口（不含 `except`）各画一个（T105）。
/// 指针移到框上时 window_at 把那个窗口提到最前，它不再被挡住，框随之消失、换成真正的窗口。
fn update_reveal(app: &AppHandle, session: &mut DragSession, active: bool, point: (f64, f64), except: Option<&str>) {
    #[cfg(windows)]
    if active {
        let skip = skip_handles(app, None);
        let hidden: Vec<Rect> = with_registry(|map| {
            map.iter()
                .filter(|(label, entry)| entry.phase == Phase::Open && Some(label.as_str()) != except)
                .map(|(label, _)| label.clone())
                .collect::<Vec<_>>()
        })
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter(|window| window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false))
        .filter(|window| window.hwnd().is_ok_and(|hwnd| zorder::covered(hwnd.0 as isize, &skip)))
        .filter_map(|window| client_rect(&window))
        .collect();
        if let Some(origin) = overlay_cover(app, point.0, point.1) {
            let rects: Vec<Rect> = hidden.into_iter().map(|rect| rect.relative_to(origin)).collect();
            session.revealed = !rects.is_empty();
            let _ = app.emit_to(OVERLAY_LABEL, events::REVEAL, rects);
        }
        return;
    }
    let _ = (point, except);
    if std::mem::take(&mut session.revealed) {
        let _ = app.emit_to(OVERLAY_LABEL, events::REVEAL, Vec::<Rect>::new());
    }
}

/// 屏幕上窗口的前后次序（Windows）：遮挡判断用。
#[cfg(windows)]
mod zorder {
    use ::windows::Win32::Foundation::{HWND, RECT};
    use ::windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        GetTopWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        GWL_EXSTYLE, GW_HWNDNEXT, WS_EX_TRANSPARENT,
    };

    /// 一个挡得住别的窗口的顶层窗口。
    pub struct Layer {
        pub hwnd: isize,
        /// 看得见的矩形（物理像素）：可调大小的窗口四周系统留的不可见边框不算。
        pub rect: RECT,
        /// 属于本应用。
        pub own: bool,
    }

    impl Layer {
        pub fn contains(&self, point: (f64, f64)) -> bool {
            point.0 >= f64::from(self.rect.left)
                && point.0 < f64::from(self.rect.right)
                && point.1 >= f64::from(self.rect.top)
                && point.1 < f64::from(self.rect.bottom)
        }

        fn intersects(&self, other: &RECT) -> bool {
            self.rect.left < other.right && self.rect.right > other.left && self.rect.top < other.bottom && self.rect.bottom > other.top
        }
    }

    /// 窗口是否挡得住别的窗口：显示着、没有最小化、没有被系统隐去（别的虚拟桌面上的窗口等），也不点击穿透。
    fn blocks(hwnd: HWND) -> bool {
        // SAFETY：只读查询；DWM 属性写进本函数内大小匹配的变量。
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return false;
            }
            if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT.0 as isize != 0 {
                return false;
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
            cloaked == 0
        }
    }

    fn frame(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        // SAFETY：矩形写进本函数内的变量，大小与之匹配。
        let extended = unsafe {
            DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, (&mut rect as *mut RECT).cast(), std::mem::size_of::<RECT>() as u32)
        };
        if extended.is_err() {
            // SAFETY：同上。
            unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        }
        (rect.right > rect.left && rect.bottom > rect.top).then_some(rect)
    }

    /// 从最前面往后，依次给出挡得住别的窗口的顶层窗口。
    pub fn layers() -> Vec<Layer> {
        let pid = std::process::id();
        let mut list = Vec::new();
        // SAFETY：只读地按前后次序遍历顶层窗口；窗口可能在遍历中消失，取不到下一个时结束。
        let mut next = unsafe { GetTopWindow(None) }.ok();
        for _ in 0..8192 {
            let Some(hwnd) = next else { break };
            if blocks(hwnd) {
                if let Some(rect) = frame(hwnd) {
                    let mut owner = 0u32;
                    // SAFETY：只读查询窗口所属的进程。
                    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
                    list.push(Layer { hwnd: hwnd.0 as isize, rect, own: owner == pid });
                }
            }
            // SAFETY：同上。
            next = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
        }
        list
    }

    /// 窗口是否被别的程序的窗口挡住了一部分（跳过 `skip`）。
    pub fn covered(hwnd: isize, skip: &[isize]) -> bool {
        let list = layers();
        let Some(index) = list.iter().position(|layer| layer.hwnd == hwnd) else { return false };
        let target = list[index].rect;
        list[..index].iter().any(|layer| !layer.own && !skip.contains(&layer.hwnd) && layer.intersects(&target))
    }
}

/* ==================== 拖动 ==================== */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DragKind {
    /// 卡片拖出侧栏。
    Cards,
    /// 标签页拖出窗口。
    Tab,
    /// 拖动窗口的标题栏。
    Move,
}

/// 开始拖动的请求。矩形与抓点是来源窗口的页面像素。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragBegin {
    pub kind: DragKind,
    pub ids: Vec<String>,
    /// 拖影的 HTML（卡片或标签页的副本），画在动画层上。
    #[serde(default)]
    pub html: Option<String>,
    /// 拖影的大小与抓点（指针相对拖影左上角）。
    #[serde(default)]
    pub ghost: Option<Rect>,
    #[serde(default)]
    pub grab: (f64, f64),
    pub dpr: f64,
}

#[derive(Debug, Clone)]
struct DragSession {
    kind: DragKind,
    source: String,
    ids: Vec<String>,
    /// 拖影的大小与抓点（物理像素）。
    ghost: Option<(f64, f64)>,
    grab: (f64, f64),
    /// 拖动窗口：指针相对外框左上角的偏移。
    offset: (f64, f64),
    unit: f64,
    /// 正在标出合并位置的窗口。
    hint: Option<String>,
    /// 拖影显示在动画层上（指针离开了来源窗口）。
    ghost_shown: bool,
    /// 最近一步的指针位置：松开时按它判断落点，松开之后指针再动也不影响。
    last: Option<(f64, f64)>,
    /// 卡片拖出侧栏时已经把记录窗口提到了最前（每次拖动只提一次，T104）。
    raised: bool,
    /// 动画层上正画着被挡住窗口的虚线框（T105）。
    revealed: bool,
}

static DRAG: Mutex<Option<DragSession>> = Mutex::new(None);

fn drag_active() -> bool {
    DRAG.lock().map(|slot| slot.is_some()).unwrap_or(false)
}

/// 拖影的载荷：位置是指针相对动画层内容区的物理像素，页面减去抓点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GhostPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
    grab: (f64, f64),
    x: f64,
    y: f64,
    visible: bool,
    /// 卡片拖出了侧栏（拖影放大一点）或标签页拖到了窗口外（拆成新窗口）。
    outside: bool,
}

/// 切换正在标出合并位置的窗口：通知新的窗口，旧的收起标记，动画层上的插入线跟着清掉。
fn set_hint(app: &AppHandle, session: &mut DragSession, target: Option<&(String, f64, f64)>) {
    let next = target.map(|(label, _, _)| label.clone());
    if session.hint != next {
        if let Some(previous) = session.hint.take() {
            let _ = app.emit_to(previous.as_str(), events::HINT, serde_json::Value::Null);
            let _ = app.emit_to(OVERLAY_LABEL, events::INDICATOR, serde_json::Value::Null);
        }
        session.hint = next;
    }
    if let Some((label, x, y)) = target {
        let _ = app.emit_to(label.as_str(), events::HINT, serde_json::json!({ "x": x, "y": y }));
    }
}

/// 开始拖动：记下拖动的记录与拖影，动画层盖住指针所在的屏幕备用。
#[tauri::command]
pub fn drag_begin(app: AppHandle, window: WebviewWindow, request: DragBegin) -> AppResult<()> {
    let dpr = sane_dpr(request.dpr);
    // 拖动全文浮窗的标题栏：手动拖出来，成为独立的记录窗口（T100）。
    if request.kind == DragKind::Move {
        detach(&app, window.label());
    }
    let point = cursor(&app);
    let offset = match window.outer_position() {
        Ok(position) => (point.0 - f64::from(position.x), point.1 - f64::from(position.y)),
        Err(_) => (0.0, 0.0),
    };
    let session = DragSession {
        kind: request.kind,
        source: window.label().to_string(),
        ids: request.ids,
        ghost: request.ghost.map(|ghost| (ghost.width * dpr, ghost.height * dpr)),
        grab: (request.grab.0 * dpr, request.grab.1 * dpr),
        offset,
        unit: dpr,
        hint: None,
        ghost_shown: false,
        last: Some(point),
        raised: false,
        revealed: false,
    };
    if let Some(origin) = overlay_cover(&app, point.0, point.1) {
        let payload = GhostPayload {
            html: request.html,
            grab: (request.grab.0, request.grab.1),
            x: point.0 - origin.0,
            y: point.1 - origin.1,
            visible: false,
            outside: false,
        };
        let _ = app.emit_to(OVERLAY_LABEL, events::GHOST, payload);
    }
    if let Ok(mut slot) = DRAG.lock() {
        *slot = Some(session);
    }
    Ok(())
}

/// 拖动的一步：`outside` 为指针是否离开了来源（卡片离开侧栏、标签页离开窗口），此时拖影画在动画层上。
/// 拖动窗口时把窗口移到指针处。返回指针下可以合并的窗口。`ctrl` 为按住了 Ctrl：显示并可以拖进被挡住的记录窗口（T105）。
/// `float` 为卡片还在侧栏里、拖影却超出了侧栏窗口：拖影同样画在动画层上，免得被窗口的边截掉（T117）。
#[tauri::command]
pub fn drag_update(app: AppHandle, window: WebviewWindow, outside: bool, ctrl: Option<bool>, float: Option<bool>) -> AppResult<Option<String>> {
    let Some(mut session) = DRAG.lock().ok().and_then(|slot| slot.clone()) else { return Ok(None) };
    let point = cursor(&app);
    session.last = Some(point);
    if session.kind == DragKind::Move {
        // 标题栏始终留在工作区内：左右至少露出 80，上边不出工作区，下边至少露出 40（原型 moveGesture）。
        let size = window.outer_size().map(|size| (f64::from(size.width), f64::from(size.height))).unwrap_or((0.0, 0.0));
        let mut x = point.0 - session.offset.0;
        let mut y = point.1 - session.offset.1;
        if let Some(monitor) = monitor_at(&app, point.0, point.1) {
            let area = work_rect(&monitor);
            let keep = 80.0 * session.unit;
            x = x.clamp(area.x + keep - size.0, area.right() - keep);
            y = y.clamp(area.y, area.bottom() - 40.0 * session.unit);
        }
        let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
        with_registry(|map| {
            if let Some(entry) = map.get_mut(window.label()) {
                entry.restore = None;
            }
        });
    }
    let reveal = ctrl.unwrap_or(false);
    // 卡片第一次拖出侧栏：已经打开的记录窗口全部提到最前，不抢焦点（T104）。
    if session.kind == DragKind::Cards && outside && !session.raised {
        session.raised = true;
        raise_note_windows(&app);
    }
    let target = drop_target(&app, &session, point, outside, reveal);
    set_hint(&app, &mut session, target.as_ref());
    let except = (session.kind != DragKind::Cards).then(|| session.source.clone());
    let reveal_now = reveal && (session.kind != DragKind::Cards || outside);
    update_reveal(&app, &mut session, reveal_now, point, except.as_deref());
    // 拖影：卡片在侧栏外、标签页在窗口外时画在动画层上，卡片拖影超出侧栏时也是；动画层跟着指针换屏幕。
    let show_ghost = session.kind != DragKind::Move && (outside || float.unwrap_or(false));
    if show_ghost || session.ghost_shown {
        if let Some(origin) = overlay_cover(&app, point.0, point.1) {
            let payload = GhostPayload { html: None, grab: (0.0, 0.0), x: point.0 - origin.0, y: point.1 - origin.1, visible: show_ghost, outside };
            let _ = app.emit_to(OVERLAY_LABEL, events::GHOST, payload);
        }
        session.ghost_shown = show_ghost;
    }
    let result = session.hint.clone();
    if let Ok(mut slot) = DRAG.lock() {
        if slot.is_some() {
            *slot = Some(session);
        }
    }
    Ok(result)
}

/// 松开时的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropResult {
    /// 合并到的窗口。
    pub target: Option<String>,
    /// 新开了窗口。
    pub opened: bool,
}

/// 指针下可以合并的窗口：卡片在侧栏外时整个窗口都算，标签页与窗口只认标题栏与竖排的标签栏。
fn drop_target(app: &AppHandle, session: &DragSession, point: (f64, f64), outside: bool, reveal: bool) -> Option<(String, f64, f64)> {
    match session.kind {
        DragKind::Cards if outside => window_at(app, point, None, false, reveal, None),
        DragKind::Cards => None,
        DragKind::Tab => window_at(app, point, Some(&session.source), true, reveal, None),
        DragKind::Move => window_at(app, point, Some(&session.source), true, reveal, Some(&session.source)),
    }
}

/// 结束拖动。`drop` 为假时取消。卡片与标签页落在别的窗口上时合并进去；
/// 卡片在侧栏外、标签页在窗口外（`detach`：窗口不止一个标签页）松开时新开一个窗口，从拖影展开，默认置顶。
/// 拖动窗口落在别的窗口的标题栏上时，整个窗口并进去。
#[tauri::command]
pub fn drag_end(app: AppHandle, window: WebviewWindow, drop: bool, outside: bool, detach: Option<bool>, ctrl: Option<bool>) -> AppResult<DropResult> {
    let Some(mut session) = DRAG.lock().ok().and_then(|mut slot| slot.take()) else {
        return Ok(DropResult { target: None, opened: false });
    };
    let point = session.last.unwrap_or_else(|| cursor(&app));
    let target = if drop { drop_target(&app, &session, point, outside, ctrl.unwrap_or(false)) } else { None };
    set_hint(&app, &mut session, None);
    update_reveal(&app, &mut session, false, point, None);
    let _ = app.emit_to(OVERLAY_LABEL, events::INDICATOR, serde_json::Value::Null);
    let ids = match session.kind {
        DragKind::Move => with_registry(|map| map.get(window.label()).map(|entry| entry.tabs.clone()).unwrap_or_default()),
        _ => session.ids.clone(),
    };
    let mut result = DropResult { target: None, opened: false };
    if let Some((label, x, y)) = target {
        transfer(&app, &label, ids, x, y);
        result.target = Some(label);
    } else if drop && outside && (session.kind == DragKind::Cards || (session.kind == DragKind::Tab && detach.unwrap_or(false))) {
        let ghost = session.ghost.map(|(width, height)| Rect { x: point.0 - session.grab.0, y: point.1 - session.grab.1, width, height });
        let kind = if session.kind == DragKind::Cards { "drop" } else { "detach" };
        open(&app, ids, kind, true, Some(point), ghost, session.unit)?;
        result.opened = true;
    }
    // 新开窗口时拖影留在松开处，直到窗口的打开动画接手（动画层收到形变动画时去掉拖影）。
    if !result.opened {
        let payload = GhostPayload { html: None, grab: (0.0, 0.0), x: 0.0, y: 0.0, visible: false, outside: false };
        let _ = app.emit_to(OVERLAY_LABEL, events::GHOST, payload);
        overlay_release(&app);
    } else {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(ANIMATION_TIMEOUT);
            if with_animations(|map| map.is_empty()) && !drag_active() {
                let payload = GhostPayload { html: None, grab: (0.0, 0.0), x: 0.0, y: 0.0, visible: false, outside: false };
                let _ = app.emit_to(OVERLAY_LABEL, events::GHOST, payload);
                overlay_release(&app);
            }
        });
    }
    Ok(result)
}

/// 把记录放进 `target` 窗口：先从别的窗口拿走（来源窗口因此可能空掉而关闭），再交给目标窗口按落点插入。
/// 目标窗口收下之后改回置顶（`pin`，T105：合并进来的窗口正要用，不该再被别的程序盖住）。
fn transfer(app: &AppHandle, target: &str, ids: Vec<String>, x: f64, y: f64) {
    let ids = unique(ids);
    if ids.is_empty() {
        return;
    }
    remove_from_others(app, &ids, Some(target));
    // 有别的记录并进全文浮窗：它成了放几条记录的窗口，不再附着在卡片旁。
    detach(app, target);
    let _ = app.emit_to(target, events::ADD, serde_json::json!({ "ids": ids, "x": x, "y": y, "pin": true }));
    show_note(app, target);
}

/// 目标窗口算出的插入线（页面像素），画到动画层上：插入线要叠在拖影与正在拖动的窗口之上。
#[tauri::command]
pub fn drag_indicator(app: AppHandle, window: WebviewWindow, rect: Option<Rect>, horizontal: bool, dpr: f64) -> AppResult<()> {
    let payload = match (rect, client_rect(&window), overlay_area()) {
        (Some(rect), Some(client), Some(_)) => {
            let screen = rect.to_screen((client.x, client.y), sane_dpr(dpr));
            let origin = app
                .get_webview_window(OVERLAY_LABEL)
                .and_then(|overlay| client_rect(&overlay))
                .map(|rect| (rect.x, rect.y))
                .unwrap_or((0.0, 0.0));
            serde_json::json!({ "rect": screen.relative_to(origin), "horizontal": horizontal })
        }
        _ => serde_json::Value::Null,
    };
    let _ = app.emit_to(OVERLAY_LABEL, events::INDICATOR, payload);
    Ok(())
}

/* ==================== 命令：窗口 ==================== */

/// 页面启动时调用：返回等着它的打开请求；开发时整页重载的窗口返回自己原来的标签页。
#[tauri::command]
pub fn note_window_init(window: WebviewWindow) -> Option<OpenPayload> {
    let label = window.label().to_string();
    with_registry(|map| {
        let entry = map.entry(label).or_insert_with(Entry::spare);
        entry.ready = true;
        if let Some(payload) = entry.pending.take() {
            return Some(payload);
        }
        (entry.phase == Phase::Open && !entry.tabs.is_empty()).then(|| OpenPayload {
            tabs: entry.tabs.clone(),
            active: entry.active.clone(),
            pinned: entry.pinned,
            origin: entry.origin.clone(),
            kind: "restore".into(),
            area: Rect::default(),
            attached: entry.attached,
        })
    })
}

/// 展开全文（侧栏调用）：`from` 为卡片在侧栏中的矩形（页面像素）。
#[tauri::command]
pub async fn open_note_window(app: AppHandle, window: WebviewWindow, ids: Vec<String>, from: Option<Rect>, dpr: f64) -> AppResult<()> {
    let origin = client_rect(&window).map(|rect| (rect.x, rect.y)).unwrap_or((0.0, 0.0));
    let from = from.map(|rect| rect.to_screen(origin, sane_dpr(dpr)));
    open(&app, ids, "expand", false, None, from, sane_dpr(dpr))
}

/// 页面量好了尺寸（物理像素）：摆好位置，播放打开动画后显示。`dpr` 为页面像素比，换算原型中按页面像素给的留白；
/// `snapshot` 为窗口的副本，没有时不播放动画。
#[tauri::command]
pub fn note_window_present(app: AppHandle, window: WebviewWindow, width: f64, height: f64, dpr: f64, snapshot: Option<String>) -> AppResult<()> {
    let label = window.label().to_string();
    let (placement, pinned, kind_drag, attached) = with_registry(|map| {
        let entry = map.get_mut(&label)?;
        entry.phase = Phase::Open;
        entry.order = ORDER.fetch_add(1, Ordering::SeqCst) + 1;
        Some((entry.placement.take(), entry.pinned, entry.origin == "drag", entry.attached))
    })
    .ok_or_else(|| AppError::Other("记录窗口不存在".into()))?;
    let unit = sane_dpr(dpr);
    window.set_min_size(Some(PhysicalSize::new(MIN_SIZE.0 * unit, MIN_SIZE.1 * unit)))?;
    // 全文浮窗附着在卡片旁，像侧栏的一部分：一直置顶，是不进任务栏与 Alt+Tab 的面板（T100，见 apply_topmost）。
    apply_topmost(&window, pinned || attached);
    let Some(placement) = placement else {
        show_note(&app, &label);
        update_connector(&app);
        return Ok(());
    };
    let size = (width, height);
    let others: Vec<Rect> = with_registry(|map| {
        map.iter()
            .filter(|(other, entry)| **other != label && entry.phase == Phase::Open)
            .map(|(other, _)| other.clone())
            .collect::<Vec<_>>()
    })
    .iter()
    .filter_map(|other| app.get_webview_window(other).and_then(|window| client_rect(&window)))
    .collect();
    let right_edge = windows::last_layout().edge != "left";
    let rect = position(&placement, size, unit, sidebar_rect(&app), right_edge, &others);
    place_client(&window, rect)?;
    match (snapshot, placement.from) {
        (Some(html), Some(from)) => play_open(&app, &label, html, from, rect, if kind_drag { "open-drag" } else { "open-expand" }),
        _ => {
            show_note(&app, &label);
            update_connector(&app);
        }
    }
    Ok(())
}

/// 页面的标签页、当前页、置顶与标题栏位置变化后同步到登记表。`bands` 为页面像素。
#[tauri::command]
pub fn note_window_sync(window: WebviewWindow, tabs: Vec<String>, active: String, pinned: bool, bands: Vec<Rect>, dpr: f64) -> AppResult<()> {
    let dpr = sane_dpr(dpr);
    let changed_pin = with_registry(|map| {
        let entry = map.get_mut(window.label())?;
        let changed = entry.pinned != pinned;
        entry.tabs = tabs;
        entry.active = active;
        entry.pinned = pinned;
        entry.bands = bands.into_iter().map(|band| band.to_screen((0.0, 0.0), dpr)).collect();
        Some(changed)
    });
    if changed_pin == Some(true) {
        let attached = with_registry(|map| map.get(window.label()).is_some_and(|entry| entry.attached));
        apply_topmost(&window, pinned || attached);
    }
    Ok(())
}

/// 关闭窗口。有 `snapshot` 时在动画层上播放关闭动画：`to`（卡片在屏幕上的矩形）有时缩回卡片，
/// 没有时原地提起淡出；没有副本时直接关闭（减少动态效果，或窗口还没显示）。
#[tauri::command]
pub fn note_window_close(app: AppHandle, window: WebviewWindow, snapshot: Option<String>, to: Option<Rect>) -> AppResult<()> {
    let label = window.label().to_string();
    let mut was_attached = false;
    let info = with_registry(|map| {
        let entry = map.get_mut(&label)?;
        entry.phase = Phase::Closing;
        was_attached = std::mem::take(&mut entry.attached);
        Some((entry.active.clone(), entry.origin == "drag"))
    });
    // 全文浮窗开始收回：侧栏的按钮换回「展开全文」，连线先收起。
    if was_attached {
        release_peek(&app);
    }
    let (Some((note, dragged)), Some(html), Some(from)) = (info, snapshot, client_rect(&window)) else {
        destroy(&app, &label);
        return Ok(());
    };
    let (cx, cy) = from.center();
    let Some(origin) = overlay_cover(&app, cx, cy) else {
        destroy(&app, &label);
        return Ok(());
    };
    let id = ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    with_animations(|map| map.insert(id, Animation::Close { label: label.clone(), note: to.map(|_| note) }));
    let payload = MorphPayload {
        id,
        html,
        from: from.relative_to(origin),
        to: to.map(|rect| rect.relative_to(origin)),
        mode: if dragged { "close-drag".into() } else { "close-expand".into() },
    };
    let _ = app.emit_to(OVERLAY_LABEL, events::MORPH, payload);
    watchdog(&app, id);
    Ok(())
}

/// 窗口自己关闭（不播放动画层上的动画，或标签页都移到了别的窗口）。
#[tauri::command]
pub fn note_window_destroy(app: AppHandle, window: WebviewWindow) {
    destroy(&app, window.label());
}

/// 双击标题栏：放大到工作区里侧栏之外的部分，再双击还原。
#[tauri::command]
pub fn note_window_maximize(app: AppHandle, window: WebviewWindow, dpr: f64) -> AppResult<()> {
    let label = window.label().to_string();
    // 双击全文浮窗的标题栏放大：成为独立的记录窗口（T100）。
    detach(&app, &label);
    let Some(current) = client_rect(&window) else { return Ok(()) };
    let restore = with_registry(|map| map.get_mut(&label).and_then(|entry| entry.restore.take()));
    if let Some(restore) = restore {
        return place_client(&window, restore);
    }
    let (cx, cy) = current.center();
    let Some(monitor) = monitor_at(&app, cx, cy) else { return Ok(()) };
    let right_edge = windows::last_layout().edge != "left";
    let target = maximized(work_rect(&monitor), sidebar_rect(&app), right_edge, sane_dpr(dpr));
    with_registry(|map| {
        if let Some(entry) = map.get_mut(&label) {
            entry.restore = Some(current);
        }
    });
    place_client(&window, target)
}

/// 标签页换到左侧或顶部后，窗口加宽或减掉标签栏的宽度（页面像素），正文宽度不变；仍留在工作区内，
/// 加宽后压到侧栏上时往外挪开（侧栏置顶，会盖住窗口的按钮）。
#[tauri::command]
pub fn note_window_widen(app: AppHandle, window: WebviewWindow, delta: f64, dpr: f64) -> AppResult<()> {
    let Some(rect) = client_rect(&window) else { return Ok(()) };
    let Some(monitor) = monitor_at(&app, rect.center().0, rect.center().1) else { return Ok(()) };
    let area = work_rect(&monitor);
    let unit = sane_dpr(dpr);
    let margin = MARGIN * unit;
    let width = (rect.width + delta * unit).clamp((MIN_SIZE.0 * unit).min(area.width - margin * 2.0), area.width - margin * 2.0);
    let mut x = rect.x;
    if let Some(bar) = sidebar_rect(&app) {
        if windows::last_layout().edge != "left" && x + width > bar.x - margin && rect.x < bar.x {
            x = bar.x - margin - width;
        } else if windows::last_layout().edge == "left" && x < bar.right() + margin && rect.right() > bar.right() {
            x = bar.right() + margin;
        }
    }
    let x = x.clamp(area.x + margin, (area.right() - width - margin).max(area.x + margin));
    with_registry(|map| {
        if let Some(entry) = map.get_mut(window.label()) {
            entry.restore = None;
        }
    });
    place_client(&window, Rect { x, width, ..rect })
}

/// 按内容重新定大小（合并、切换或关掉标签页之后，T110）：`width`、`height` 为物理像素。左上角尽量不动，
/// 超出工作区时挪回来（放不下时缩到工作区之内）；变宽后压到侧栏上时挪开（侧栏置顶，会盖住窗口）。
#[tauri::command]
pub fn note_window_fit(app: AppHandle, window: WebviewWindow, width: f64, height: f64, dpr: f64) -> AppResult<()> {
    let Some(rect) = client_rect(&window) else { return Ok(()) };
    if (rect.width - width).abs() <= 2.0 && (rect.height - height).abs() <= 2.0 {
        return Ok(());
    }
    let Some(monitor) = monitor_at(&app, rect.center().0, rect.center().1) else { return Ok(()) };
    let area = work_rect(&monitor);
    let margin = MARGIN * sane_dpr(dpr);
    let target = refit(rect, (width, height), area, margin, sidebar_rect(&app), windows::last_layout().edge != "left");
    with_registry(|map| {
        if let Some(entry) = map.get_mut(window.label()) {
            entry.restore = None;
        }
    });
    place_client(&window, target)
}

/// 重新定大小后的矩形：左上角不动；超出工作区的一边挪回来（留 `margin`），比工作区还大时缩小；
/// 变宽后压到侧栏上（原来在侧栏外）时挪到侧栏外侧。
fn refit(rect: Rect, size: (f64, f64), area: Rect, margin: f64, sidebar: Option<Rect>, right_edge: bool) -> Rect {
    let width = size.0.min(area.width - margin * 2.0).max(1.0);
    let height = size.1.min(area.height - margin * 2.0).max(1.0);
    let mut x = rect.x;
    if let Some(bar) = sidebar {
        if right_edge && x + width > bar.x - margin && rect.x < bar.x {
            x = bar.x - margin - width;
        } else if !right_edge && x < bar.right() + margin && rect.right() > bar.right() {
            x = bar.right() + margin;
        }
    }
    if x + width > area.right() {
        x = area.right() - margin - width;
    }
    let mut y = rect.y;
    if y + height > area.bottom() {
        y = area.bottom() - margin - height;
    }
    Rect { x: x.max(area.x), y: y.max(area.y), width, height }
}

/// 关闭全部记录窗口（快捷键「关闭全部记录窗口」），返回是否有窗口。各窗口按自己的关闭流程先保存。
#[tauri::command]
pub fn close_all_note_windows(app: AppHandle) -> bool {
    let labels: Vec<String> = with_registry(|map| {
        map.iter().filter(|(_, entry)| entry.phase == Phase::Open).map(|(label, _)| label.clone()).collect()
    });
    for label in &labels {
        let _ = app.emit_to(label.as_str(), events::CLOSE, ());
    }
    !labels.is_empty()
}

/// 动画层：关闭动画的第一帧已经画出，可以销毁窗口了（之后动画层上的副本代替窗口）。
#[tauri::command]
pub fn overlay_ready(app: AppHandle, id: u64) {
    let label = with_animations(|map| match map.get(&id) {
        Some(Animation::Close { label, .. }) => Some(label.clone()),
        _ => None,
    });
    if let Some(label) = label {
        if let Some(window) = app.get_webview_window(&label) {
            hide_window(&window);
        }
    }
}

/// 动画层：动画播放完毕。
#[tauri::command]
pub fn overlay_done(app: AppHandle, id: u64) {
    finish_animation(&app, id);
}

/// 获得焦点的窗口边框带一点强调色（原型 .note-window:focus-within）。系统画边框的窗口（亚克力与不透明）
/// 由页面算好颜色交给这里，写到 DWM 的边框颜色上；`None` 恢复系统默认。只有 Windows 11 支持，失败时忽略。
#[tauri::command]
pub fn set_window_border_color(window: WebviewWindow, color: Option<String>) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
        // COLORREF 为 0x00BBGGRR；DWMWA_COLOR_DEFAULT（0xFFFFFFFF）恢复默认。
        let value: u32 = color
            .as_deref()
            .and_then(|text| u32::from_str_radix(text.trim_start_matches('#'), 16).ok())
            .map(|rgb| ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF))
            .unwrap_or(0xFFFF_FFFF);
        // SAFETY：传入的指针指向本函数内的 u32，大小与之匹配。
        let _ = unsafe { DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, (&value as *const u32).cast(), std::mem::size_of::<u32>() as u32) };
    }
    #[cfg(not(windows))]
    let _ = (window, color);
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 0.0, y: 0.0, width: 2560.0, height: 1400.0 };
    const SIDEBAR: Rect = Rect { x: 2160.0, y: 0.0, width: 400.0, height: 1400.0 };

    fn placement(point: Option<(f64, f64)>, from: Option<Rect>) -> Placement {
        Placement { point, from, area: AREA }
    }

    #[test]
    fn dropped_window_puts_its_header_under_the_pointer() {
        let rect = position(&placement(Some((1000.0, 500.0)), None), (400.0, 300.0), 1.0, Some(SIDEBAR), true, &[]);
        assert_eq!((rect.x, rect.y), (800.0, 480.0));
    }

    #[test]
    fn dropped_window_stays_clear_of_the_sidebar_and_inside_the_work_area() {
        // 松开处离侧栏太近：窗口左移到侧栏左边 12 处。
        let rect = position(&placement(Some((2100.0, 20.0)), None), (400.0, 300.0), 1.0, Some(SIDEBAR), true, &[]);
        assert_eq!(rect.x, 2160.0 - 12.0 - 400.0);
        assert_eq!(rect.y, 12.0);
    }

    #[test]
    fn expanded_window_opens_beside_the_sidebar_level_with_the_card() {
        let card = Rect { x: 2170.0, y: 600.0, width: 380.0, height: 120.0 };
        let rect = position(&placement(None, Some(card)), (500.0, 400.0), 1.0, Some(SIDEBAR), true, &[]);
        assert_eq!(rect.x, 2160.0 - 500.0 - 24.0);
        assert_eq!(rect.y, 600.0);
        // 贴左边的侧栏：窗口放在侧栏右边。
        let left = Rect { x: 0.0, ..SIDEBAR };
        let rect = position(&placement(None, Some(Rect { x: 10.0, ..card })), (500.0, 400.0), 1.0, Some(left), false, &[]);
        assert_eq!(rect.x, 400.0 + 24.0);
    }

    #[test]
    fn windows_opened_at_the_same_place_cascade() {
        let first = Rect { x: 800.0, y: 480.0, width: 400.0, height: 300.0 };
        let rect = position(&placement(Some((1000.0, 500.0)), None), (400.0, 300.0), 1.0, None, true, &[first]);
        assert_eq!((rect.x, rect.y), (824.0, 504.0));
    }

    #[test]
    fn beam_spans_the_card_edge_and_the_facing_edge_of_the_peek() {
        let card = Rect { x: 2170.0, y: 600.0, width: 380.0, height: 120.0 };
        let panel = Rect { x: 1600.0, y: 600.0, width: 500.0, height: 400.0 };
        // 侧栏贴右边：卡片的左边连到浮窗的右边，两边各让开圆角。
        let beam = connector_beam(card, panel, true, 6.0, 16.0);
        assert_eq!(beam, ConnectorPayload { card: (2170.0, 606.0, 714.0), panel: (2100.0, 616.0, 984.0) });
        // 贴左边：卡片右边连到浮窗的左边。
        let beam = connector_beam(Rect { x: 10.0, ..card }, Rect { x: 450.0, ..panel }, false, 6.0, 16.0);
        assert_eq!((beam.card.0, beam.panel.0), (390.0, 450.0));
        // 很矮的卡片（只露出一点）：让开的圆角不超过边长的四分之一。
        let sliver = Rect { height: 8.0, ..card };
        assert_eq!(connector_beam(sliver, panel, true, 6.0, 16.0).card, (2170.0, 602.0, 606.0));
    }

    #[test]
    fn peek_prefers_the_card_top_and_centres_when_pushed_far() {
        let area = Rect { x: 0.0, y: 0.0, width: 2560.0, height: 1400.0 };
        let card = Rect { x: 2170.0, y: 300.0, width: 380.0, height: 200.0 };
        // 放得下：顶边对齐。
        assert_eq!(peek_top(card, 600.0, area, 12.0), 300.0);
        // 卡片靠下，顶边对齐要被推上去很多：与卡片垂直居中（中心 1100，浮窗高 500）。
        let low = Rect { y: 1000.0, ..card };
        assert_eq!(peek_top(low, 500.0, area, 12.0), 850.0);
        // 只推上去一点（不超过两倍留白）：仍按顶边对齐，贴住工作区底边。
        let near = Rect { y: 900.0, ..card };
        assert_eq!(peek_top(near, 500.0, area, 12.0), 1400.0 - 12.0 - 500.0);
        // 居中也放不下：贴着工作区的边。
        assert_eq!(peek_top(low, 1300.0, area, 12.0), 1400.0 - 12.0 - 1300.0);
    }

    #[test]
    fn refit_keeps_the_top_left_and_stays_inside_the_work_area() {
        let rect = Rect { x: 400.0, y: 300.0, width: 400.0, height: 300.0 };
        // 放得下：左上角不动，只改大小。
        assert_eq!(refit(rect, (560.0, 500.0), AREA, 12.0, Some(SIDEBAR), true), Rect { width: 560.0, height: 500.0, ..rect });
        // 下面放不下：往上挪到离底边 12 处。
        let low = Rect { y: 1200.0, ..rect };
        assert_eq!(refit(low, (400.0, 600.0), AREA, 12.0, None, true).y, 1400.0 - 12.0 - 600.0);
        // 变宽后压到侧栏上：挪到侧栏左边 12 处。
        let near = Rect { x: 1700.0, ..rect };
        assert_eq!(refit(near, (560.0, 300.0), AREA, 12.0, Some(SIDEBAR), true).x, 2160.0 - 12.0 - 560.0);
        // 比工作区还高：缩到工作区之内。
        assert_eq!(refit(rect, (400.0, 2000.0), AREA, 12.0, None, true).height, 1400.0 - 24.0);
    }

    #[test]
    fn maximized_window_leaves_the_sidebar_visible() {
        let rect = maximized(AREA, Some(SIDEBAR), true, 1.0);
        assert_eq!(rect, Rect { x: 12.0, y: 12.0, width: 2160.0 - 12.0 - 12.0, height: 1400.0 - 24.0 });
        let rect = maximized(AREA, None, true, 1.5);
        assert_eq!(rect.x, 18.0);
        assert_eq!(rect.width, 2560.0 - 36.0);
    }
}
