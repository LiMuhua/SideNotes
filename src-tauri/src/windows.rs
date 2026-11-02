//! 侧栏、速记浮窗与设置窗口的窗口控制。
//!
//! 原型在网页内用 CSS transform 模拟侧栏滑入；桌面端改为真实窗口：
//! - 侧栏窗口贴附屏幕边缘，按设置的宽度与边缘定位，出入时平移真实窗口，隐藏后完全消失。
//! - 速记浮窗居中显示，与侧栏共享同一数据库中的草稿。
//! - 设置窗口即原型的设置对话框，按原型尺寸在鼠标所在屏幕居中，可调整大小，始终置顶；
//!   显示状态变化时通知各窗口，侧栏据此在固定按钮上提示「设置打开期间保持展开」。
//! - 字号设置是全局的界面缩放：各窗口的 WebView 整页缩放，设置窗口同时按比例调整尺寸。
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

/// 设置窗口的设计尺寸（网页像素），与原型桌面端设置对话框一致。
const SETTINGS_SIZE: (f64, f64) = (880.0, 720.0);
/// 设置窗口的最小尺寸（网页像素）：再小时部分设置项会被挤压或截断。
const SETTINGS_MIN_SIZE: (f64, f64) = (720.0, 560.0);
/// 屏幕较小时保留的外边距，对应原型的 calc(100vw - 36px) 与 calc(100dvh - 48px)。
const SETTINGS_MARGIN: (f64, f64) = (36.0, 48.0);
/// 速记浮窗的设计尺寸（逻辑像素），与 tauri.conf.json 一致；界面缩放时按比例放大。
const CAPTURE_SIZE: (f64, f64) = (560.0, 420.0);
/// 设置窗口是否已按默认尺寸摆放过；此后再打开保留用户调整后的大小。
static SETTINGS_PLACED: AtomicBool = AtomicBool::new(false);
/// 设置窗口最近一次设定的最小尺寸（内容区的逻辑像素），界面缩放变化时按比例调整。
static SETTINGS_MIN: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
/// 设置窗口当前的界面缩放（f64 的位表示），初始为 1。
static SETTINGS_ZOOM: AtomicU64 = AtomicU64::new(0x3FF0_0000_0000_0000);
/// 最近一次通知出去的设置窗口显示状态，只在变化时再通知。
static SETTINGS_SHOWING: AtomicBool = AtomicBool::new(false);
/// 设置窗口显示状态变化的事件，载荷为是否正在显示（可见且未最小化）。
pub const SETTINGS_VISIBILITY_EVENT: &str = "sidenotes://settings-visibility";

/// 侧栏动画代次：每次显示或隐藏都会递增，旧的动画线程据此提前结束，
/// 避免快速移入移出时两段动画互相拉扯。
static SIDEBAR_ANIMATION: AtomicU64 = AtomicU64::new(0);

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
    let monitor = pick_monitor(sidebar, prefer_cursor)?;
    Ok(place_sidebar(
        work_area(&monitor),
        layout.width,
        layout.edge == "left",
        frame_inset(sidebar),
    ))
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
/// 返回的坐标已换算为外框位置。
fn place_sidebar(area: (f64, f64, f64, f64), width: f64, left_edge: bool, inset: (f64, f64)) -> SidebarGeometry {
    let (area_x, area_y, area_width, area_height) = area;
    // 字号小于 13px 时窗口会比设置中的宽度窄，下限放宽到 300。
    let width = width.clamp(300.0, area_width.max(300.0));
    let (content_x, offscreen_content_x) = if left_edge {
        (area_x, area_x - width)
    } else {
        (area_x + area_width - width, area_x + area_width)
    };
    SidebarGeometry {
        final_x: content_x - inset.0,
        offscreen_x: offscreen_content_x - inset.0,
        y: area_y - inset.1,
        width,
        height: area_height,
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
    #[cfg(windows)]
    if let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) {
        use ::windows::core::BOOL;
        use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};

        if let Ok(hwnd) = sidebar.hwnd() {
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
    let _ = app;
}

/// 显示侧栏：从屏幕外平滑滑入；若正在收起，则从当前位置滑回。
pub fn show_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
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
    if !visible {
        // 先摆到屏幕外再显示，避免出现一帧停在最终位置再跳回去。
        sidebar.set_position(LogicalPosition::new(start_x, geometry.y))?;
        sidebar.show()?;
    }
    sidebar.set_focus()?;

    let duration = layout.duration();
    if duration == 0 || (start_x - geometry.final_x).abs() < 0.5 {
        sidebar.set_position(LogicalPosition::new(geometry.final_x, geometry.y))?;
        return Ok(());
    }
    // 动画放到后台线程，避免阻塞命令调用与主线程事件循环。
    let handle = sidebar.clone();
    std::thread::spawn(move || {
        animate_x(&handle, start_x, geometry.final_x, geometry.y, duration, generation);
    });
    Ok(())
}

/// 隐藏侧栏：先平滑滑出屏幕，再真正隐藏窗口。
pub fn hide_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<()> {
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
            // 收起后复位到贴边位置，避免下次对齐时从错误坐标开始。
            let _ = handle.set_position(LogicalPosition::new(geometry.final_x, geometry.y));
        }
    });
    Ok(())
}

/// 切换侧栏可见性，返回切换后的状态。
pub fn toggle_sidebar(app: &AppHandle, layout: &SidebarLayout) -> AppResult<bool> {
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
    min_width: f64,
    min_height: f64,
}

/// 计算设置窗口的尺寸、最小尺寸与居中位置。
///
/// 设计尺寸与最小尺寸按网页像素给出。Windows 的文本缩放会让网页内容整体放大，
/// 同样大小的窗口能容纳的网页像素随之变少，所以都乘以文本缩放比例 `zoom` 换算为窗口逻辑尺寸；
/// 否则 125% 文本缩放下，880×720 的窗口在网页里只有 704×576，设置项会被挤压截断。
/// `current` 为用户调整过的尺寸，存在时沿用；任何尺寸都不超过屏幕工作区减去原型的留边。
fn place_settings(area: (f64, f64, f64, f64), zoom: f64, current: Option<(f64, f64)>) -> SettingsGeometry {
    let (area_x, area_y, area_width, area_height) = area;
    let zoom = if zoom.is_finite() { zoom.clamp(1.0, 3.0) } else { 1.0 };
    let max_width = (area_width - SETTINGS_MARGIN.0).max(320.0);
    let max_height = (area_height - SETTINGS_MARGIN.1).max(320.0);
    let min_width = (SETTINGS_MIN_SIZE.0 * zoom).min(max_width);
    let min_height = (SETTINGS_MIN_SIZE.1 * zoom).min(max_height);
    let (width, height) = current.unwrap_or((SETTINGS_SIZE.0 * zoom, SETTINGS_SIZE.1 * zoom));
    let width = width.clamp(min_width, max_width);
    let height = height.clamp(min_height, max_height);
    SettingsGeometry {
        x: area_x + (area_width - width) / 2.0,
        y: area_y + (area_height - height) / 2.0,
        width,
        height,
        min_width,
        min_height,
    }
}

/// 显示设置窗口。
///
/// 打开时在鼠标所在屏幕居中：首次按原型尺寸，之后沿用用户调整后的大小；
/// 已打开时只还原并聚焦，保留用户拖动后的位置。`text_scale` 为页面像素比与窗口缩放比例之比，
/// 即系统的文本缩放比例，由前端测得。
pub fn show_settings(app: &AppHandle, text_scale: f64) -> AppResult<()> {
    let settings = window(app, SETTINGS_LABEL)?;
    if !settings.is_visible().unwrap_or(false) {
        let monitor = pick_monitor(&settings, true)?;
        let current = match (settings.inner_size(), settings.scale_factor()) {
            (Ok(size), Ok(scale)) if scale > 0.0 => Some((f64::from(size.width) / scale, f64::from(size.height) / scale)),
            _ => None,
        };
        let placed = SETTINGS_PLACED.swap(true, Ordering::SeqCst);
        let geometry = place_settings(work_area(&monitor), text_scale, if placed { current } else { None });
        apply_settings_geometry(&settings, &geometry)?;
    }
    if settings.is_minimized().unwrap_or(false) {
        settings.unminimize()?;
    }
    settings.show()?;
    settings.set_focus()?;
    notify_settings_visibility(app);
    Ok(())
}

/// 按计算好的几何摆放设置窗口，并记下最小尺寸供界面缩放变化时调整。
///
/// Windows 上带阴影的无边框窗口保留了不可见的边框，系统按整个窗口限制最小尺寸；
/// 加上边框与内容区的尺寸差，内容区才不小于设定的最小尺寸。先设最小尺寸再改大小，缩小时不被旧的下限挡住。
fn apply_settings_geometry(settings: &WebviewWindow, geometry: &SettingsGeometry) -> AppResult<()> {
    let frame = match (settings.outer_size(), settings.inner_size(), settings.scale_factor()) {
        (Ok(outer), Ok(inner), Ok(scale)) if scale > 0.0 => (
            f64::from(outer.width.saturating_sub(inner.width)) / scale,
            f64::from(outer.height.saturating_sub(inner.height)) / scale,
        ),
        _ => (0.0, 0.0),
    };
    *SETTINGS_MIN.lock().unwrap_or_else(|error| error.into_inner()) = (geometry.min_width, geometry.min_height);
    settings.set_min_size(Some(LogicalSize::new(
        geometry.min_width + frame.0,
        geometry.min_height + frame.1,
    )))?;
    settings.set_size(LogicalSize::new(geometry.width, geometry.height))?;
    settings.set_position(LogicalPosition::new(geometry.x, geometry.y))?;
    Ok(())
}

/// 界面缩放变化后设置窗口的新摆放：内容区与最小尺寸都乘以 `ratio`，保持原来的中心，再限制在工作区之内。
///
/// `current` 为窗口当前的位置与内容区尺寸 (x, y, 宽, 高)，`min` 为当前的最小尺寸。
/// 这样缩放前后内容所占的网页尺寸不变，放大字号时设置项不会被挤压，缩小时也不会留出大片空白。
fn rescale_settings(
    area: (f64, f64, f64, f64),
    current: (f64, f64, f64, f64),
    min: (f64, f64),
    ratio: f64,
) -> SettingsGeometry {
    let (area_x, area_y, area_width, area_height) = area;
    let (x, y, width, height) = current;
    let max_width = (area_width - SETTINGS_MARGIN.0).max(320.0);
    let max_height = (area_height - SETTINGS_MARGIN.1).max(320.0);
    let min_width = (min.0 * ratio).min(max_width);
    let min_height = (min.1 * ratio).min(max_height);
    let new_width = (width * ratio).clamp(min_width, max_width);
    let new_height = (height * ratio).clamp(min_height, max_height);
    let max_x = (area_x + area_width - new_width).max(area_x);
    let max_y = (area_y + area_height - new_height).max(area_y);
    SettingsGeometry {
        x: (x + (width - new_width) / 2.0).clamp(area_x, max_x),
        y: (y + (height - new_height) / 2.0).clamp(area_y, max_y),
        width: new_width,
        height: new_height,
        min_width,
        min_height,
    }
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
/// 侧栏的宽度由用户设置，不随缩放改变。
/// 设置窗口正在显示时，窗口与最小尺寸同时按缩放比例调整（见 rescale_settings）；
/// 隐藏时只记下缩放，下次打开时由前端传入包含缩放的文本缩放比例重新摆放。
pub fn set_ui_zoom(window: &WebviewWindow, zoom: f64) -> AppResult<()> {
    let zoom = if zoom.is_finite() { zoom.clamp(0.5, 3.0) } else { 1.0 };
    window.set_zoom(zoom)?;
    if window.label() == CAPTURE_LABEL {
        return resize_capture(window, zoom);
    }
    if window.label() != SETTINGS_LABEL {
        return Ok(());
    }
    let previous = f64::from_bits(SETTINGS_ZOOM.swap(zoom.to_bits(), Ordering::SeqCst));
    let showing = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    let min = *SETTINGS_MIN.lock().unwrap_or_else(|error| error.into_inner());
    if (zoom - previous).abs() < 1e-6 || !showing || min.0 <= 0.0 {
        return Ok(());
    }
    let scale = window.scale_factor()?;
    let position = window.outer_position()?;
    let size = window.inner_size()?;
    let current = (
        f64::from(position.x) / scale,
        f64::from(position.y) / scale,
        f64::from(size.width) / scale,
        f64::from(size.height) / scale,
    );
    let monitor = pick_monitor(window, false)?;
    let geometry = rescale_settings(work_area(&monitor), current, min, zoom / previous);
    apply_settings_geometry(window, &geometry)
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
        let geometry = place_sidebar(AREA, 452.0, false, INSET);
        // 内容区左边 = 外框横坐标 + 偏移；右边再加上宽度，应正好落在工作区右边缘。
        assert!(close(geometry.final_x + INSET.0 + geometry.width, 2560.0));
        assert!(close(geometry.y + INSET.1, 0.0));
        assert!(close(geometry.height, 1440.0));
        // 收起时内容区整块位于工作区右边缘之外。
        assert!(close(geometry.offscreen_x + INSET.0, 2560.0));
    }

    #[test]
    fn left_edge_content_touches_work_area() {
        let geometry = place_sidebar(AREA, 452.0, true, INSET);
        assert!(close(geometry.final_x + INSET.0, 0.0));
        assert!(close(geometry.offscreen_x + INSET.0 + geometry.width, 0.0));
    }

    #[test]
    fn width_is_clamped_to_work_area() {
        assert!(close(place_sidebar((0.0, 0.0, 1000.0, 800.0), 9999.0, false, (0.0, 0.0)).width, 1000.0));
        assert!(close(place_sidebar(AREA, 100.0, false, (0.0, 0.0)).width, 300.0));
    }

    #[test]
    fn settings_size_follows_text_scale() {
        let geometry = place_settings(AREA, 1.25, None);
        assert!(close(geometry.width, 1100.0));
        assert!(close(geometry.height, 900.0));
        assert!(close(geometry.min_width, 900.0));
        assert!(close(geometry.min_height, 700.0));
        // 在工作区内居中。
        assert!(close(geometry.x, (2560.0 - 1100.0) / 2.0));
        assert!(close(geometry.y, (1440.0 - 900.0) / 2.0));
    }

    #[test]
    fn settings_keep_user_size_within_limits() {
        let resized = place_settings(AREA, 1.0, Some((1200.0, 800.0)));
        assert!(close(resized.width, 1200.0) && close(resized.height, 800.0));
        // 小于最小尺寸时放大到最小尺寸，大于工作区时收回到留边之内。
        let small = place_settings(AREA, 1.0, Some((300.0, 200.0)));
        assert!(close(small.width, 720.0) && close(small.height, 560.0));
        let large = place_settings((0.0, 0.0, 1280.0, 680.0), 1.25, None);
        assert!(close(large.width, 1100.0) && close(large.height, 632.0));
        assert!(close(large.min_width, 900.0) && close(large.min_height, 632.0));
    }

    #[test]
    fn settings_rescale_keeps_center_and_scales_limits() {
        // 1100×900 的窗口居中摆放，字号从 13 调到 16：尺寸与最小尺寸乘以 16/13，中心不变。
        let ratio = 16.0 / 13.0;
        let geometry = rescale_settings(AREA, (730.0, 270.0, 1100.0, 900.0), (900.0, 700.0), ratio);
        assert!(close(geometry.width, 1100.0 * ratio));
        assert!(close(geometry.height, 900.0 * ratio));
        assert!(close(geometry.min_width, 900.0 * ratio));
        assert!(close(geometry.x + geometry.width / 2.0, 730.0 + 550.0));
        // 超出工作区时收回到留边之内，并保持在屏幕内。
        let large = rescale_settings((0.0, 0.0, 1280.0, 680.0), (100.0, 20.0, 1100.0, 632.0), (900.0, 632.0), 1.5);
        assert!(close(large.width, 1244.0) && close(large.height, 632.0));
        assert!(large.x >= 0.0 && large.x + large.width <= 1280.0);
        // 缩小字号时尺寸随之缩小，但不小于新的最小尺寸。
        let small = rescale_settings(AREA, (730.0, 270.0, 900.0, 700.0), (900.0, 700.0), 13.0 / 16.0);
        assert!(close(small.width, 900.0 * 13.0 / 16.0) && close(small.min_width, small.width));
    }

    #[test]
    fn without_frame_inset_positions_are_unchanged() {
        let geometry = place_sidebar(AREA, 416.0, false, (0.0, 0.0));
        assert!(close(geometry.final_x, 2144.0));
        assert!(close(geometry.offscreen_x, 2560.0));
        assert!(close(geometry.y, 0.0));
    }
}
