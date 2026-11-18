//! 侧栏、速记浮窗与设置窗口的窗口控制。
//!
//! 原型在网页内用 CSS transform 模拟侧栏滑入；桌面端改为真实窗口：
//! - 侧栏窗口贴附屏幕边缘，按设置的宽度与边缘定位，出入时平移真实窗口，隐藏后完全消失。
//! - 速记浮窗居中显示，与侧栏共享同一数据库中的草稿。
//! - 设置窗口即原型的设置对话框，在鼠标所在屏幕居中，大小随字号变化（有上下限），始终置顶；
//!   显示状态变化时通知各窗口，侧栏据此在固定按钮上提示「设置打开期间保持展开」。
//! - 字号设置是全局的界面缩放：各窗口的 WebView 整页缩放，设置窗口与速记浮窗同时按比例调整尺寸。
//! - 显示前重新读取显示器工作区，适配多屏与 DPI 变化。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewWindow};

use crate::error::{AppError, AppResult};

/// 侧栏窗口标签。
pub const SIDEBAR_LABEL: &str = "main";
/// 速记浮窗标签。
pub const CAPTURE_LABEL: &str = "capture";
/// 设置窗口标签。
pub const SETTINGS_LABEL: &str = "settings";

/// 默认字号（12px）下设置窗口的尺寸（网页像素）：比原型第二版的 880 × 560 高 80（2026-11-18 用户要求加高）。
/// 字号变了窗口按同样的比例缩放，里面的排版不变，见 place_settings。
const SETTINGS_SIZE: (f64, f64) = (880.0, 640.0);
/// 设置窗口的下限（网页像素）：字号调得很小时窗口跟着变小，但不小于它；上限是屏幕工作区减去留边。
const SETTINGS_MIN: (f64, f64) = (720.0, 520.0);
/// 默认字号 12px 对应的界面缩放（按 13px 计为 1，与前端 uiZoom 相同）。
const DEFAULT_ZOOM: f64 = 12.0 / 13.0;
/// 最近一次打开设置窗口时的系统文本缩放与界面缩放：设置窗口打开期间改字号时据此重新算尺寸。
static SETTINGS_SCALE: Mutex<(f64, f64)> = Mutex::new((1.0, DEFAULT_ZOOM));
/// 屏幕较小时保留的外边距，对应原型的 calc(100vw - 36px) 与 calc(100dvh - 48px)。
const SETTINGS_MARGIN: (f64, f64) = (36.0, 48.0);
/// 速记浮窗的设计尺寸（逻辑像素），与 tauri.conf.json 一致；界面缩放时按比例放大。
const CAPTURE_SIZE: (f64, f64) = (560.0, 420.0);
/// 最近一次通知出去的设置窗口显示状态，只在变化时再通知。
static SETTINGS_SHOWING: AtomicBool = AtomicBool::new(false);
/// 设置窗口显示状态变化的事件，载荷为是否正在显示（可见且未最小化）。
pub const SETTINGS_VISIBILITY_EVENT: &str = "sidenotes://settings-visibility";

/// 侧栏动画代次：每次显示或隐藏都会递增，旧的动画线程据此提前结束，
/// 避免快速移入移出时两段动画互相拉扯。
static SIDEBAR_ANIMATION: AtomicU64 = AtomicU64::new(0);

/// 当前的动画代次：贴边轮询据此判断侧栏停在屏幕外期间有没有新的显示或收起。
pub fn animation_generation() -> u64 {
    SIDEBAR_ANIMATION.load(Ordering::SeqCst)
}

/// 窗口是否整个在所有屏幕之外（显示着却看不见）。
pub fn is_offscreen(window: &WebviewWindow) -> bool {
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    let rect: Rect = (position.x, position.y, position.x + size.width as i32, position.y + size.height as i32);
    let monitors = window.available_monitors().unwrap_or_default();
    !monitors.is_empty()
        && !monitors
            .iter()
            .map(bounds)
            .any(|(left, top, right, bottom)| rect.0 < right && rect.2 > left && rect.1 < bottom && rect.3 > top)
}

/// 最近一次由前端给出的侧栏布局（显示、收起、切换与按设置对齐时都会带上）。
///
/// 贴边、托盘与全局快捷键直接在这里显示或切换侧栏，不再绕经侧栏页面的脚本：页面卡住、崩溃，
/// 或开发模式下同一事件订阅了两次时，侧栏照样能唤出与收起。
static SIDEBAR_LAYOUT: Mutex<Option<SidebarLayout>> = Mutex::new(None);

fn remember_layout(layout: &SidebarLayout) {
    if let Ok(mut slot) = SIDEBAR_LAYOUT.lock() {
        *slot = Some(layout.clone());
    }
}

/// 最近一次的侧栏布局；前端还没给出时用默认设置（贴右边、宽 400、动画 260 毫秒）。
pub fn last_layout() -> SidebarLayout {
    SIDEBAR_LAYOUT
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_else(|| SidebarLayout { edge: "right".into(), width: 400.0, anim_duration: 260.0, gap: 0.0 })
}

/// 侧栏几何配置，由前端设置驱动。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarLayout {
    /// 贴附边缘：left 或 right。
    pub edge: String,
    /// 窗口的逻辑宽度：设置中的宽度（360–720，按 13px 字号计）乘以界面缩放。
    pub width: f64,
    /// 出入动画时长（毫秒）；0 表示不做动画。
    #[serde(default)]
    pub anim_duration: f64,
    /// 面板与屏幕边缘之间的留白（逻辑像素，已乘界面缩放）。Windows 11 与磨砂玻璃的窗口本身就是面板：
    /// 窗口离开屏幕边缘与上下边这段距离，由系统给窗口画圆角、投影与亚克力材质（T84，技术决策第 40 条）。
    /// `width` 仍是包括留白在内的宽度，面板在屏幕上占的位置与贴边时相同。其余主题为 0。
    #[serde(default)]
    pub gap: f64,
}

impl SidebarLayout {
    /// 动画时长收敛到合理区间，避免前端传入异常值导致长时间阻塞。
    fn duration(&self) -> u64 {
        self.anim_duration.clamp(0.0, 800.0) as u64
    }
}

/// 侧栏在某块屏幕上的目标几何（逻辑坐标）。
///
/// 横纵坐标是窗口外框的位置，宽高是内容区的尺寸，与 Tauri 的 set_position、set_size 一致。
#[derive(Debug, Clone, Copy)]
struct SidebarGeometry {
    /// 贴边展开时外框的横坐标。
    final_x: f64,
    /// 内容区完全移出屏幕时外框的横坐标，作为滑入起点与滑出终点。
    offscreen_x: f64,
    /// 外框的纵坐标。
    y: f64,
    width: f64,
    height: f64,
}

/// 取得窗口；窗口缺失说明配置与运行状态不一致。
fn window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::Other(format!("窗口 {label} 不存在")))
}

/// 选择显示器：`prefer_cursor` 为真时优先鼠标所在屏幕，否则优先窗口当前所在屏幕。
fn pick_monitor(window: &WebviewWindow, prefer_cursor: bool) -> AppResult<Monitor> {
    let by_cursor = || {
        window
            .cursor_position()
            .ok()
            .and_then(|cursor| window.monitor_from_point(cursor.x, cursor.y).ok().flatten())
    };
    let current = || window.current_monitor().ok().flatten();
    let found = if prefer_cursor {
        by_cursor().or_else(current)
    } else {
        current().or_else(by_cursor)
    };
    found
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::Other("未能获取显示器信息".into()))
}

/// 显示器工作区的逻辑坐标 (x, y, 宽, 高)。使用工作区而非整屏，避免覆盖任务栏。
fn work_area(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    (
        area.position.x as f64 / scale,
        area.position.y as f64 / scale,
        area.size.width as f64 / scale,
        area.size.height as f64 / scale,
    )
}

/// 计算侧栏的贴边位置、尺寸与屏幕外位置。
fn sidebar_geometry(sidebar: &WebviewWindow, layout: &SidebarLayout, prefer_cursor: bool) -> AppResult<SidebarGeometry> {
    let left_edge = layout.edge == "left";
    let monitor = pick_monitor(sidebar, prefer_cursor)?;
    let monitors = sidebar.available_monitors().unwrap_or_default();
    let monitor = dock_monitor(monitor, &monitors, left_edge);
    Ok(place_sidebar(work_area(&monitor), layout.width, left_edge, frame_inset(sidebar), layout.gap))
}

/// 屏幕的整屏矩形（物理像素）：左、上、右、下。
type Rect = (i32, i32, i32, i32);

fn bounds(monitor: &Monitor) -> Rect {
    let position = monitor.position();
    let size = monitor.size();
    (position.x, position.y, position.x + size.width as i32, position.y + size.height as i32)
}

/// `other` 是否挨着 `rect` 的左边或右边（纵向有重叠）。屏幕的坐标是整数，相接时边线重合，留 1 像素的误差。
fn touches(rect: Rect, other: Rect, left_edge: bool) -> bool {
    let (left, top, right, bottom) = rect;
    let (other_left, other_top, other_right, other_bottom) = other;
    let adjacent = if left_edge { (other_right - left).abs() <= 1 } else { (other_left - right).abs() <= 1 };
    adjacent && other_top < bottom && other_bottom > top
}

/// 屏幕的这一边是否在整个桌面的外沿：没有别的屏幕挨着它。
///
/// 两块屏幕相接的一边不算边缘：指针从一块屏幕划到另一块时会经过这里，在这里唤出的侧栏停在两块屏幕之间，
/// 收起时又滑进旁边那块屏幕，看起来整个侧栏从一块屏幕移到了另一块。
fn edge_is_outer(rect: Rect, others: &[Rect], left_edge: bool) -> bool {
    !others.iter().any(|&other| other != rect && touches(rect, other, left_edge))
}

/// 停靠侧栏的屏幕在 `rects` 中的位置：从 `start` 开始，这一边挨着别的屏幕时换到挨着的那一块
/// （纵向重叠最多的），直到外沿。
fn dock_index(rects: &[Rect], start: usize, left_edge: bool) -> usize {
    let mut current = start;
    for _ in 0..rects.len() {
        let rect = rects[current];
        let next = rects
            .iter()
            .enumerate()
            .filter(|&(index, &other)| index != current && other != rect && touches(rect, other, left_edge))
            .max_by_key(|&(_, &(_, top, _, bottom))| bottom.min(rect.3) - top.max(rect.1))
            .map(|(index, _)| index);
        match next {
            Some(index) => current = index,
            None => break,
        }
    }
    current
}

/// 停靠侧栏的屏幕：选中的屏幕这一边挨着别的屏幕时，换到外沿所在的那一块。
fn dock_monitor(monitor: Monitor, monitors: &[Monitor], left_edge: bool) -> Monitor {
    let rects: Vec<Rect> = monitors.iter().map(bounds).collect();
    let Some(start) = rects.iter().position(|&rect| rect == bounds(&monitor)) else {
        return monitor;
    };
    monitors[dock_index(&rects, start, left_edge)].clone()
}

/// 指针所在的这块屏幕，侧栏所贴的一边是否在整个桌面的外沿（贴边唤出只在外沿触发）。
pub fn is_outer_edge(window: &WebviewWindow, monitor: &Monitor, left_edge: bool) -> bool {
    let others: Vec<Rect> = window.available_monitors().unwrap_or_default().iter().map(bounds).collect();
    edge_is_outer(bounds(monitor), &others, left_edge)
}

/// 窗口外框左上角到内容区左上角的偏移（逻辑像素）。
///
/// Windows 上带阴影的无边框窗口保留了不可见的边框（150% 缩放下左右各 11、顶部 2 个物理像素），
/// 外框比内容区大。按外框贴边时内容区会超出屏幕边缘，所以贴边要按内容区计算再换算回外框。
fn frame_inset(window: &WebviewWindow) -> (f64, f64) {
    match (window.inner_position(), window.outer_position(), window.scale_factor()) {
        (Ok(inner), Ok(outer), Ok(scale)) if scale > 0.0 => (
            f64::from(inner.x - outer.x) / scale,
            f64::from(inner.y - outer.y) / scale,
        ),
        _ => (0.0, 0.0),
    }
}

/// 让内容区贴住工作区的左或右边缘，收起时整块内容区移到工作区之外。
///
/// `area` 为工作区的逻辑坐标 (x, y, 宽, 高)，`inset` 为外框到内容区的偏移；
/// `gap` 为面板离开屏幕边缘与上下边的留白：窗口宽度少这一段、上下各让出这一段，面板的内侧边位置不变。
/// 返回的坐标已换算为外框位置。
fn place_sidebar(area: (f64, f64, f64, f64), width: f64, left_edge: bool, inset: (f64, f64), gap: f64) -> SidebarGeometry {
    let (area_x, area_y, area_width, area_height) = area;
    // 留白取自令牌（8–12px 乘界面缩放），限制在合理范围内，避免异常值把窗口挤没。
    let gap = gap.clamp(0.0, (area_height / 4.0).min(64.0));
    // 字号小于 13px 时窗口会比设置中的宽度窄，下限放宽到 300。
    let total = width.clamp(300.0, area_width.max(300.0));
    let width = (total - gap).max(240.0);
    let (content_x, offscreen_content_x) = if left_edge {
        (area_x + gap, area_x - width)
    } else {
        (area_x + area_width - gap - width, area_x + area_width)
    };
    SidebarGeometry {
        final_x: content_x - inset.0,
        offscreen_x: offscreen_content_x - inset.0,
        y: area_y + gap - inset.1,
        width,
        height: area_height - gap * 2.0,
    }
}

/// 窗口当前的逻辑横坐标，用于从中途位置继续动画。
fn current_x(window: &WebviewWindow) -> Option<f64> {
    let position = window.outer_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(position.x as f64 / scale)
}

/// 让窗口沿水平方向平滑移动，返回动画是否完整结束。
///
/// Tauri 没有内置窗口动画，这里按帧插值位置。若期间出现新的显示或隐藏请求
/// （代次变化），立即停止并交给新动画接管。
fn animate_x(sidebar: &WebviewWindow, from: f64, to: f64, y: f64, duration: u64, generation: u64) -> bool {
    // 约 60fps 的分片，最少 8 步以免低时长时出现跳变。
    let steps = (duration / 16).max(8);
    let frame = std::time::Duration::from_millis(duration / steps);
    for step in 1..=steps {
        if SIDEBAR_ANIMATION.load(Ordering::SeqCst) != generation {
            return false;
        }
        let t = step as f64 / steps as f64;
        // easeOutCubic，起步快、收尾稳。
        let eased = 1.0 - (1.0 - t).powi(3);
        if sidebar
            .set_position(LogicalPosition::new(from + (to - from) * eased, y))
            .is_err()
        {
            return false;
        }
        std::thread::sleep(frame);
    }
    SIDEBAR_ANIMATION.load(Ordering::SeqCst) == generation
}

/// 按设置重新对齐侧栏（不做动画，用于宽度或边缘变更）。
pub fn align_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    remember_layout(layout);
    let sidebar = window(app, SIDEBAR_LABEL)?;
    // 可见时跟随侧栏所在屏幕；隐藏时按鼠标所在屏幕预先摆好。
    let visible = sidebar.is_visible().unwrap_or(false);
    let geometry = sidebar_geometry(&sidebar, layout, !visible)?;
    set_bounds(&sidebar, geometry.final_x, geometry.y, geometry.width, geometry.height)
}

/// 同时设置窗口位置与内容区尺寸。
///
/// 分别调用 set_size 与 set_position 时，窗口会先在原位置改变宽度再移动，
/// 拖动调整宽度的每一帧都会出现一次贴边一侧的跳动。Windows 上改用一次
/// SetWindowPos 同时完成；其它平台或调用失败时退回分步设置。
fn set_bounds(window: &WebviewWindow, x: f64, y: f64, width: f64, height: f64) -> AppResult<()> {
    #[cfg(windows)]
    if set_bounds_native(window, x, y, width, height).is_some() {
        return Ok(());
    }
    window.set_size(LogicalSize::new(width, height))?;
    window.set_position(LogicalPosition::new(x, y))?;
    Ok(())
}

/// 用一次 SetWindowPos 设置窗口矩形。坐标与 Tauri 一致：位置为窗口外框，尺寸为内容区。
#[cfg(windows)]
fn set_bounds_native(window: &WebviewWindow, x: f64, y: f64, width: f64, height: f64) -> Option<()> {
    use ::windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER};

    let hwnd = window.hwnd().ok()?;
    let scale = window.scale_factor().ok()?;
    // SetWindowPos 设置的是整个窗口矩形，需要补上外框与内容区的尺寸差。
    let outer = window.outer_size().ok()?;
    let inner = window.inner_size().ok()?;
    let frame_width = outer.width as i32 - inner.width as i32;
    let frame_height = outer.height as i32 - inner.height as i32;
    // SAFETY：hwnd 来自仍然存在的 Tauri 窗口，参数均为按值传入的整数。
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            (x * scale).round() as i32,
            (y * scale).round() as i32,
            (width * scale).round() as i32 + frame_width,
            (height * scale).round() as i32 + frame_height,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
        .ok()
    }
}

/// 关闭侧栏窗口的系统显示与隐藏动画。
///
/// 侧栏收起时先平移到屏幕外、隐藏，再把窗口挪回贴边位置备用。Windows 默认会为隐藏播放
/// 一次淡出动画，而这段动画出现在挪回后的位置：平移结束约 90 毫秒后，侧栏会在原处闪现
/// 并淡出。出入效果已由平移完成，系统动画是多余的。
pub fn disable_sidebar_transitions(app: &AppHandle) {
    if let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) {
        disable_transitions(&sidebar);
    }
}

/// 关闭窗口的系统显示与隐藏动画（侧栏、记录窗口与动画层：出入都由应用自己的动画完成）。
pub fn disable_transitions(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use ::windows::core::BOOL;
        use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};

        if let Ok(hwnd) = window.hwnd() {
            let disabled = BOOL::from(true);
            // SAFETY：传入的指针指向本函数内的 BOOL，大小与之匹配。失败只会保留系统动画。
            let _ = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_TRANSITIONS_FORCEDISABLED,
                    (&disabled as *const BOOL).cast(),
                    std::mem::size_of::<BOOL>() as u32,
                )
            };
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// 侧栏与速记浮窗的所有者：一个从不显示的隐藏窗口。
///
/// 没有所有者的窗口，tao 会加上 WS_EX_APPWINDOW；`skipTaskbar` 只去掉任务栏按钮，窗口仍出现在
/// Alt+Tab 与 Win+Tab 中。tao 每次显示、隐藏还会按自己的标志重写扩展样式，事后加的 WS_EX_TOOLWINDOW 留不住。
/// 被拥有的窗口不出现在任务栏、Alt+Tab 与 Win+Tab 中；所有者从不显示、也不会最小化，被拥有的窗口照常显示。
/// 在主线程上创建，随进程退出销毁。
///
/// 交给它的窗口必须一直置顶：系统把「取消置顶」连带到所有者及其所有被拥有的窗口，
/// 其中一个取消置顶，侧栏也跟着不再置顶（固定侧栏后会被别的窗口盖住）。
#[cfg(windows)]
pub fn create_owner_window() -> Option<::windows::Win32::Foundation::HWND> {
    use ::windows::core::w;
    use ::windows::Win32::Foundation::HINSTANCE;
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WS_EX_TOOLWINDOW, WS_POPUP};

    // SAFETY：系统预定义的 STATIC 窗口类不需要注册，其余参数都是按值传入的常量；创建失败时返回 None。
    unsafe {
        let module = GetModuleHandleW(None).ok()?;
        CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("STATIC"),
            w!(""),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(HINSTANCE(module.0)),
            None,
        )
        .ok()
    }
}

/// 显示侧栏：从屏幕外平滑滑入；若正在收起，则从当前位置滑回。
pub fn show_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    remember_layout(layout);
    let sidebar = window(app, SIDEBAR_LABEL)?;
    let generation = SIDEBAR_ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    let visible = sidebar.is_visible().unwrap_or(false);
    let geometry = sidebar_geometry(&sidebar, layout, !visible)?;
    let start_x = if visible {
        current_x(&sidebar).unwrap_or(geometry.final_x)
    } else {
        geometry.offscreen_x
    };

    sidebar.set_size(LogicalSize::new(geometry.width, geometry.height))?;
    // 侧栏始终置顶；万一被别处连带取消（见 create_owner_window），显示时补回来。
    let _ = sidebar.set_always_on_top(true);
    if !visible {
        // 先摆到屏幕外再显示，避免出现一帧停在最终位置再跳回去。
        sidebar.set_position(LogicalPosition::new(start_x, geometry.y))?;
        sidebar.show()?;
    }
    // 拿不到焦点（系统不让后台程序抢前台）不影响滑入；在这里返回错误的话，窗口会显示着停在屏幕外。
    if let Err(error) = sidebar.set_focus() {
        crate::diag::log(format!("侧栏获取焦点失败：{error}"));
    }

    let duration = layout.duration();
    if duration == 0 || (start_x - geometry.final_x).abs() < 0.5 {
        sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
        return Ok(());
    }
    // 动画放到后台线程，避免阻塞命令调用与主线程事件循环。
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        // 上一次收起的线程可能在这次显示之前刚过了代次检查，随后才把窗口藏起来（见 hide_sidebar）；
        // 滑入结束时仍是这一次的请求而窗口不可见，就再显示一次。
        if animate_x(&handle, start_x, geometry.final_x, geometry.y, duration, generation)
            && !handle.is_visible().unwrap_or(true)
        {
            let _ = handle.show();
        }
    });
    Ok(())
}

/// 隐藏侧栏：先平滑滑出屏幕，再真正隐藏窗口。
pub fn hide_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
    remember_layout(layout);
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if !sidebar.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let generation = SIDEBAR_ANIMATION.fetch_add(1, Ordering::SeqCst) + 1;
    // 收起时以侧栏当前所在屏幕为准，鼠标可能已经移到别的屏幕。
    let geometry = sidebar_geometry(&sidebar, layout, false)?;

    let duration = layout.duration();
    if duration == 0 {
        sidebar.hide()?;
        sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
        return Ok(());
    }
    let start_x = current_x(&sidebar).unwrap_or(geometry.final_x);
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        // 被新的显示请求打断时保持可见，由新动画处理位置。
        if animate_x(&handle, start_x, geometry.offscreen_x, geometry.y, duration, generation) {
            let _ = handle.hide();
            // 收起后复位到贴边位置，避免下次对齐时从错误坐标开始；隐藏的同时来了新的显示请求时不动，交给它摆放。
            if SIDEBAR_ANIMATION.load(Ordering::SeqCst) == generation {
                let _ = handle.set_position(LogicalPosition::new(geometry.final_x, geometry.y));
            }
        }
    });
    Ok(())
}

/// 切换侧栏可见性，返回切换后的状态。
pub fn toggle_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<bool> {
    remember_layout(layout);
    let sidebar = window(app, SIDEBAR_LABEL)?;
    if sidebar.is_visible().unwrap_or(false) {
        hide_sidebar(app, layout)?;
        Ok(false)
    } else {
        show_sidebar(app, layout)?;
        Ok(true)
    }
}

/// 显示速记浮窗，居中并立即可输入。
pub fn show_capture(app: &AppHandle) -> AppResult<()> {
    let capture = window(app, CAPTURE_LABEL)?;
    capture.center()?;
    let _ = capture.set_always_on_top(true);
    capture.show()?;
    capture.set_focus()?;
    Ok(())
}

/// 隐藏速记浮窗；草稿由前端在隐藏前持久化。
pub fn hide_capture(app: &AppHandle) -> AppResult<()> {
    let capture = window(app, CAPTURE_LABEL)?;
    capture.hide()?;
    Ok(())
}

/// 切换速记浮窗，返回切换后的状态。
pub fn toggle_capture(app: &AppHandle) -> AppResult<bool> {
    let capture = window(app, CAPTURE_LABEL)?;
    if capture.is_visible().unwrap_or(false) {
        capture.hide()?;
        Ok(false)
    } else {
        show_capture(app)?;
        Ok(true)
    }
}

/// 设置窗口在某块屏幕上的摆放（逻辑坐标）。
#[derive(Debug, Clone, Copy, PartialEq)]
struct SettingsGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 计算设置窗口的尺寸与居中位置。
///
/// 尺寸按网页像素给出：默认字号下 880 × 640，字号变了按界面缩放与默认值之比 `zoom / DEFAULT_ZOOM` 缩放，
/// 窗口与内容一起变大变小，排版不变；不小于 720 × 520。Windows 的文本缩放会让网页内容整体放大，
/// 同样大小的窗口能容纳的网页像素随之变少，所以再乘以文本缩放比例 `text_scale` 换算为窗口逻辑尺寸。
/// 不超过屏幕工作区减去原型的留边。
fn place_settings(area: (f64, f64, f64, f64), text_scale: f64, zoom: f64) -> SettingsGeometry {
    let (area_x, area_y, area_width, area_height) = area;
    let scale = if text_scale.is_finite() { text_scale.clamp(1.0, 3.0) } else { 1.0 };
    let factor = if zoom.is_finite() && zoom > 0.0 { (zoom / DEFAULT_ZOOM).clamp(0.5, 3.0) } else { 1.0 };
    let width = ((SETTINGS_SIZE.0 * factor).max(SETTINGS_MIN.0) * scale).min((area_width - SETTINGS_MARGIN.0).max(320.0));
    let height = ((SETTINGS_SIZE.1 * factor).max(SETTINGS_MIN.1) * scale).min((area_height - SETTINGS_MARGIN.1).max(320.0));
    SettingsGeometry {
        x: area_x + (area_width - width) / 2.0,
        y: area_y + (area_height - height) / 2.0,
        width,
        height,
    }
}

/// 设置窗口打开期间改了字号：按新的界面缩放重算尺寸，中心不动，仍限制在工作区之内。
fn resize_settings(settings: &WebviewWindow, zoom: f64) -> AppResult<()> {
    let text_scale = {
        let mut slot = SETTINGS_SCALE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        slot.1 = zoom;
        slot.0
    };
    if !settings.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let monitor = pick_monitor(settings, false)?;
    let area = work_area(&monitor);
    let geometry = place_settings(area, text_scale, zoom);
    let scale = settings.scale_factor()?;
    let position = settings.outer_position()?.to_logical::<f64>(scale);
    let size = settings.outer_size()?.to_logical::<f64>(scale);
    let (center_x, center_y) = (position.x + size.width / 2.0, position.y + size.height / 2.0);
    let (area_x, area_y, area_width, area_height) = area;
    let x = (center_x - geometry.width / 2.0).clamp(area_x, (area_x + area_width - geometry.width).max(area_x));
    let y = (center_y - geometry.height / 2.0).clamp(area_y, (area_y + area_height - geometry.height).max(area_y));
    set_bounds(settings, x, y, geometry.width, geometry.height)
}

/// 显示设置窗口。
///
/// 打开时在鼠标所在屏幕居中，大小随字号（见 place_settings）；已打开时只还原并聚焦，保留用户拖动后的位置。
/// `text_scale` 为系统的文本缩放比例，由前端测得（页面像素比与窗口缩放比例之比，除去字号的界面缩放）；
/// `zoom` 为字号对应的界面缩放。
pub fn show_settings(app: &AppHandle, text_scale: f64, zoom: f64) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    if let Ok(mut slot) = SETTINGS_SCALE.lock() {
        *slot = (text_scale, zoom);
    }
    if !settings.is_visible().unwrap_or(false) {
        let monitor = pick_monitor(&settings, true)?;
        let geometry = place_settings(work_area(&monitor), text_scale, zoom);
        settings.set_size(LogicalSize::new(geometry.width, geometry.height))?;
        settings.set_position(LogicalPosition::new(geometry.x, geometry.y))?;
    }
    if settings.is_minimized().unwrap_or(false) {
        settings.unminimize()?;
    }
    settings.show()?;
    settings.set_focus()?;
    notify_settings_visibility(app);
    Ok(())
}

/// 速记浮窗按设计尺寸乘以界面缩放，再限制在工作区之内；显示中时重新居中。
fn resize_capture(capture: &WebviewWindow, zoom: f64) -> AppResult<()> {
    let monitor = pick_monitor(capture, false)?;
    let (_, _, area_width, area_height) = work_area(&monitor);
    let width = (CAPTURE_SIZE.0 * zoom).min((area_width - SETTINGS_MARGIN.0).max(320.0));
    let height = (CAPTURE_SIZE.1 * zoom).min((area_height - SETTINGS_MARGIN.1).max(240.0));
    capture.set_size(LogicalSize::new(width, height))?;
    if capture.is_visible().unwrap_or(false) {
        capture.center()?;
    }
    Ok(())
}

/// 应用界面缩放（字号设置）：当前窗口的 WebView 整页缩放到 `zoom` 倍。
///
/// 速记浮窗与设置窗口是尺寸固定的对话式窗口，同时按缩放比例调整尺寸，内容所占的网页尺寸不变；
/// 窗口材质（T84，adaptation.md 第三、四节，技术决策第 40 条），作用于调用方窗口：
/// - `acrylic`：透明窗口加亚克力，Windows 11 与磨砂玻璃。窗口本身就是面板，系统画圆角、细边框与投影。
/// - `clear`：透明、不加材质，杂志的浮动面板。留白在窗口内、透出桌面，面板的圆角与投影由页面画，
///   不要系统投影：它画在整个窗口外，会在留白外圈多出一道边框。
/// - 其余（`opaque`）：不加材质，页面铺满不透明的底色，保留系统投影。
///
/// 透明只能在建窗口时指定，侧栏与速记浮窗都建成透明窗口（tauri.conf.json），切换主题时只换材质。
/// Linux 不支持材质，失败时忽略，页面仍按不透明的颜色显示。
pub fn set_window_material(window: &WebviewWindow, material: &str) -> AppResult<()> {
    use tauri::window::{Effect, EffectsBuilder};
    let effects = if material == "acrylic" {
        Some(EffectsBuilder::new().effect(Effect::Acrylic).build())
    } else {
        None
    };
    let _ = window.set_effects(effects);
    window.set_shadow(material != "clear")?;
    Ok(())
}

/// 指针是否在侧栏上，或在侧栏与所贴的屏幕边缘之间（T84）。
///
/// Windows 11 与磨砂玻璃的侧栏窗口离开屏幕边缘一段留白，这段留白不属于窗口，指针停在里面时页面收到 mouseleave。
/// 页面到点收起前查询这里：留白仍算侧栏，不收起（adaptation.md 第四节）。范围是窗口所在屏幕的工作区里，
/// 从窗口的内侧边到屏幕边缘、从工作区顶边到底边的整条。
pub fn sidebar_holds_cursor(app: &AppHandle) -> bool {
    let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) else {
        return false;
    };
    if !sidebar.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(cursor), Ok(position), Ok(size), Ok(Some(monitor))) =
        (sidebar.cursor_position(), sidebar.outer_position(), sidebar.outer_size(), sidebar.current_monitor())
    else {
        return false;
    };
    let area = monitor.work_area();
    let (area_left, area_top) = (f64::from(area.position.x), f64::from(area.position.y));
    let (area_right, area_bottom) = (area_left + f64::from(area.size.width), area_top + f64::from(area.size.height));
    let (window_left, window_right) = (f64::from(position.x), f64::from(position.x) + f64::from(size.width));
    let (left, right) = if last_layout().edge == "left" { (area_left, window_right) } else { (window_left, area_right) };
    cursor.x >= left && cursor.x <= right && cursor.y >= area_top && cursor.y <= area_bottom
}

/// 侧栏的宽度由用户设置，不随缩放改变；设置窗口随字号按比例缩放（有上下限，见 place_settings）。
pub fn set_ui_zoom(window: &WebviewWindow, zoom: f64) -> AppResult<()> {
    let zoom = if zoom.is_finite() { zoom.clamp(0.5, 3.0) } else { 1.0 };
    window.set_zoom(zoom)?;
    if window.label() == CAPTURE_LABEL {
        return resize_capture(window, zoom);
    }
    if window.label() == SETTINGS_LABEL {
        return resize_settings(window, zoom);
    }
    Ok(())
}

/// 隐藏设置窗口。
pub fn hide_settings(app: &AppHandle) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    settings.hide()?;
    notify_settings_visibility(app);
    Ok(())
}

/// 设置窗口是否正在显示：可见且未最小化。
fn settings_showing(app: &AppHandle) -> bool {
    app.get_webview_window(SETTINGS_LABEL)
        .map(|settings| settings.is_visible().unwrap_or(false) && !settings.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// 设置窗口打开、关闭、最小化或还原后通知各窗口。
///
/// 设置窗口显示期间侧栏保持展开；侧栏据此把固定按钮显示为按下，提示这是随设置窗口的临时固定，
/// 避免切到别的窗口时侧栏看起来像卡住不收。拖动调整大小会连续触发尺寸变化，只在状态改变时通知。
pub fn notify_settings_visibility(app: &AppHandle) {
    let showing = settings_showing(app);
    if SETTINGS_SHOWING.swap(showing, Ordering::SeqCst) != showing {
        let _ = app.emit(SETTINGS_VISIBILITY_EVENT, showing);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2560×1440 的逻辑工作区（4K 屏 150% 缩放）。
    const AREA: (f64, f64, f64, f64) = (0.0, 0.0, 2560.0, 1440.0);
    /// 150% 缩放下实测的外框偏移：左 11、上 2 个物理像素。
    const INSET: (f64, f64) = (11.0 / 1.5, 2.0 / 1.5);

    fn close(left: f64, right: f64) -> bool {
        (left - right).abs() < 1e-9
    }

    #[test]
    fn right_edge_content_touches_work_area() {
        let geometry = place_sidebar(AREA, 452.0, false, INSET, 0.0);
        // 内容区左边 = 外框横坐标 + 偏移；右边再加上宽度，应正好落在工作区右边缘。
        assert!(close(geometry.final_x + INSET.0 + geometry.width, 2560.0));
        assert!(close(geometry.y + INSET.1, 0.0));
        assert!(close(geometry.height, 1440.0));
        // 收起时内容区整块位于工作区右边缘之外。
        assert!(close(geometry.offscreen_x + INSET.0, 2560.0));
    }

    #[test]
    fn left_edge_content_touches_work_area() {
        let geometry = place_sidebar(AREA, 452.0, true, INSET, 0.0);
        assert!(close(geometry.final_x + INSET.0, 0.0));
        assert!(close(geometry.offscreen_x + INSET.0 + geometry.width, 0.0));
    }

    #[test]
    fn width_is_clamped_to_work_area() {
        assert!(close(place_sidebar((0.0, 0.0, 1000.0, 800.0), 9999.0, false, (0.0, 0.0), 0.0).width, 1000.0));
        assert!(close(place_sidebar(AREA, 100.0, false, (0.0, 0.0), 0.0).width, 300.0));
    }

    #[test]
    fn settings_size_follows_text_scale_and_font_size() {
        // 默认字号：880 × 640 乘 1.25 的文本缩放。
        let geometry = place_settings(AREA, 1.25, DEFAULT_ZOOM);
        assert!(close(geometry.width, 1100.0));
        assert!(close(geometry.height, 800.0));
        // 在工作区内居中。
        assert!(close(geometry.x, (2560.0 - 1100.0) / 2.0));
        assert!(close(geometry.y, (1440.0 - 800.0) / 2.0));
        // 字号 15px：按 15 / 12 放大。
        let larger = place_settings(AREA, 1.0, 15.0 / 13.0);
        assert!(close(larger.width, 1100.0) && close(larger.height, 800.0));
        // 字号很小时不小于 720 × 520。
        let smaller = place_settings(AREA, 1.0, 8.0 / 13.0);
        assert!(close(smaller.width, 720.0) && close(smaller.height, 520.0));
        // 小屏幕上不超过工作区减去留边。
        let small = place_settings((0.0, 0.0, 1280.0, 680.0), 1.25, DEFAULT_ZOOM);
        assert!(close(small.width, 1100.0) && close(small.height, 632.0));
    }

    #[test]
    fn without_frame_inset_positions_are_unchanged() {
        let geometry = place_sidebar(AREA, 416.0, false, (0.0, 0.0), 0.0);
        assert!(close(geometry.final_x, 2144.0));
        assert!(close(geometry.offscreen_x, 2560.0));
        assert!(close(geometry.y, 0.0));
    }

    #[test]
    fn floating_panel_leaves_a_gap_to_the_screen_edges() {
        // Windows 11 主题：12px 留白乘 1.25 的界面缩放。内侧边与贴边时相同，窗口窄一段，上下各让出留白。
        let gap = 15.0;
        let right = place_sidebar(AREA, 452.0, false, INSET, gap);
        assert!(close(right.final_x + INSET.0, 2560.0 - 452.0));
        assert!(close(right.final_x + INSET.0 + right.width, 2560.0 - gap));
        assert!(close(right.y + INSET.1, gap));
        assert!(close(right.height, 1440.0 - gap * 2.0));
        assert!(close(right.offscreen_x + INSET.0, 2560.0));
        let left = place_sidebar(AREA, 452.0, true, INSET, gap);
        assert!(close(left.final_x + INSET.0, gap));
        assert!(close(left.final_x + INSET.0 + left.width, 452.0));
        assert!(close(left.offscreen_x + INSET.0 + left.width, 0.0));
    }


    /// 用户的两块屏幕：4K 主屏在右，竖放的 1600×2560 副屏在左（物理像素）。
    const PRIMARY: Rect = (0, 0, 3840, 2160);
    const SECONDARY: Rect = (-1600, 0, 0, 2560);

    #[test]
    fn edges_shared_by_two_monitors_are_not_outer() {
        let all = [PRIMARY, SECONDARY];
        // 贴右边：主屏的右边是外沿，副屏的右边与主屏相接，不算（指针跨屏时不唤出）。
        assert!(edge_is_outer(PRIMARY, &all, false));
        assert!(!edge_is_outer(SECONDARY, &all, false));
        // 贴左边：反过来。
        assert!(edge_is_outer(SECONDARY, &all, true));
        assert!(!edge_is_outer(PRIMARY, &all, true));
        // 只有一块屏幕时两边都是外沿；上下错开、没有纵向重叠的屏幕不算相接。
        assert!(edge_is_outer(PRIMARY, &[PRIMARY], false));
        assert!(edge_is_outer(PRIMARY, &[PRIMARY, (3840, 2160, 5760, 3240)], false));
    }

    #[test]
    fn sidebar_docks_on_the_outer_edge() {
        let all = [PRIMARY, SECONDARY];
        // 指针在副屏上按快捷键：贴右边的侧栏停到主屏右边，贴左边的停在副屏左边。
        assert_eq!(dock_index(&all, 1, false), 0);
        assert_eq!(dock_index(&all, 1, true), 1);
        assert_eq!(dock_index(&all, 0, true), 1);
        assert_eq!(dock_index(&all, 0, false), 0);
        // 三块屏幕排成一行：从最左边一路换到最右边。
        let row = [(0, 0, 1920, 1080), (1920, 0, 3840, 1080), (3840, 0, 5760, 1080)];
        assert_eq!(dock_index(&row, 0, false), 2);
    }
}
