//! 合并与附件的弹窗窗口（T99）。
//!
//! 原型里这两个弹窗和设置一样盖在整个页面上；桌面端原来画在侧栏（或速记浮窗）的窗口里，窄而局促。
//! 改为一个独立的弹窗窗口，过程是：
//! 1. 打开者（侧栏或速记浮窗）把弹窗的种类与内容交给后端（`open_dialog`），后端记下并转给弹窗窗口；
//! 2. 弹窗窗口画好内容、量出尺寸后请后端显示（`present_dialog`）：在打开者所在屏幕居中，获得焦点；
//!    内容变高变矮时再请后端调整尺寸，中心不动；
//! 3. 用户的操作（合并、应用修改、更换、删除）由弹窗窗口以事件发回打开者，打开者写入后回复结果；
//! 4. 关闭（`close_dialog`）时隐藏窗口，通知打开者与弹窗窗口（Alt+F4 由后端关闭，弹窗页面据此清空），
//!    焦点回到打开者。
//!
//! 弹窗窗口是面板（见 panels），不进任务栏与 Alt+Tab，一直置顶；侧栏在它打开期间保持展开，
//! 固定按钮显示为随弹窗临时固定（与设置窗口相同）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::error::{AppError, AppResult};

/// 弹窗窗口的标签。
pub const DIALOG_LABEL: &str = "dialog";
/// 发给弹窗窗口的打开请求。
const OPEN_EVENT: &str = "sidenotes://dialog-open";
/// 发给打开者与弹窗窗口：弹窗已关闭，载荷为请求的编号。
const CLOSED_EVENT: &str = "sidenotes://dialog-closed";
/// 弹窗与屏幕工作区边缘至少留这么多（物理像素按缩放换算前的逻辑像素）。
const MARGIN: f64 = 24.0;

/// 一次打开请求：编号、打开者的窗口标签、种类（merge、attachment）与内容。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogRequest {
    pub id: u64,
    pub opener: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

/// 物理像素的矩形。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 弹窗在工作区里的位置与尺寸：尺寸不超过工作区减去四周的留边；`keep` 给出时以它为中心，
/// 否则在工作区居中；再推回留边以内。结果取整。
fn place(area: Rect, margin: f64, width: f64, height: f64, keep: Option<(f64, f64)>) -> Rect {
    let max_width = (area.width - margin * 2.0).max(200.0);
    let max_height = (area.height - margin * 2.0).max(160.0);
    let width = width.clamp(200.0, max_width).round();
    let height = height.clamp(120.0, max_height).round();
    let (right, bottom) = (area.x + area.width, area.y + area.height);
    let (center_x, center_y) = keep.unwrap_or((area.x + area.width / 2.0, area.y + area.height / 2.0));
    let x = (center_x - width / 2.0).clamp(area.x + margin, (right - margin - width).max(area.x + margin));
    let y = (center_y - height / 2.0).clamp(area.y + margin, (bottom - margin - height).max(area.y + margin));
    Rect { x: x.round(), y: y.round(), width, height }
}

static REQUEST: Mutex<Option<DialogRequest>> = Mutex::new(None);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn dialog_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(DIALOG_LABEL)
        .ok_or_else(|| AppError::Other(format!("窗口 {DIALOG_LABEL} 不存在")))
}

fn current() -> Option<DialogRequest> {
    REQUEST.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
}

/// 打开弹窗：记下请求并转给弹窗窗口，返回请求的编号。已有弹窗时由新的替换，旧的打开者收到关闭通知。
#[tauri::command]
pub fn open_dialog(app: AppHandle, window: WebviewWindow, kind: String, payload: serde_json::Value) -> AppResult<u64> {
    let id = SEQUENCE.fetch_add(1, Ordering::SeqCst) + 1;
    let request = DialogRequest { id, opener: window.label().to_string(), kind, payload };
    let previous = REQUEST.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).replace(request.clone());
    if let Some(previous) = previous {
        let _ = app.emit_to(previous.opener.as_str(), CLOSED_EVENT, previous.id);
    }
    app.emit_to(DIALOG_LABEL, OPEN_EVENT, &request)?;
    Ok(id)
}

/// 弹窗窗口启动时取等着它的请求（页面晚于事件加载时用）。
#[tauri::command]
pub fn dialog_init() -> Option<DialogRequest> {
    current()
}

/// 按内容的尺寸（物理像素）显示弹窗。`center` 为真时在打开者所在屏幕的工作区居中（刚打开），
/// 否则保持当前的中心（内容变高变矮）。尺寸不超过工作区减去留边，超出的部分在弹窗里滚动。
/// `id` 不是当前的请求时不做任何事：弹窗已经关闭（或被新的替换）后，旧内容的尺寸变化不会让窗口重新出现。
#[tauri::command]
pub fn present_dialog(app: AppHandle, id: u64, width: f64, height: f64, center: bool) -> AppResult<()> {
    if current().map(|request| request.id) != Some(id) {
        return Ok(());
    }
    let dialog = dialog_window(&app)?;
    let opener = current().and_then(|request| app.get_webview_window(&request.opener));
    let monitor = opener
        .as_ref()
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| dialog.current_monitor().ok().flatten())
        .or_else(|| dialog.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::Other("未能获取显示器信息".into()))?;
    let area = monitor.work_area();
    let area = Rect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        width: f64::from(area.size.width),
        height: f64::from(area.size.height),
    };
    // 刚打开（或窗口还没显示）时在工作区居中，否则保持当前内容区的中心。
    let keep = if center || !dialog.is_visible().unwrap_or(false) {
        None
    } else {
        let position = dialog.inner_position()?;
        let size = dialog.inner_size()?;
        Some((f64::from(position.x) + f64::from(size.width) / 2.0, f64::from(position.y) + f64::from(size.height) / 2.0))
    };
    let placed = place(area, MARGIN * monitor.scale_factor(), width, height, keep);
    dialog.set_size(PhysicalSize::new(placed.width, placed.height))?;
    // set_position 设的是窗口外框（含系统留的不可见缩放边），内容区相对外框的偏移要补上：
    // 否则弹窗偏右下，每次保持中心调整尺寸还会再挪一点。
    let outer = dialog.outer_position()?;
    let inner = dialog.inner_position()?;
    dialog.set_position(PhysicalPosition::new(
        placed.x - f64::from(inner.x - outer.x),
        placed.y - f64::from(inner.y - outer.y),
    ))?;
    crate::topmost::restore_if_minimized(&dialog);
    crate::topmost::ensure_topmost(&dialog);
    if !dialog.is_visible().unwrap_or(false) {
        crate::topmost::show(&dialog);
        dialog.set_focus()?;
    }
    Ok(())
}

/// 关闭弹窗：隐藏窗口，通知打开者与弹窗窗口，焦点回到打开者。
/// 给出 `id` 时只在当前的弹窗还是这一个时关闭：打开者撤回自己的请求时，不会误关别人刚打开的弹窗。
#[tauri::command]
pub fn close_dialog(app: AppHandle, id: Option<u64>) -> AppResult<()> {
    let request = {
        let mut slot = REQUEST.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if id.is_some() && slot.as_ref().map(|request| request.id) != id {
            return Ok(());
        }
        slot.take()
    };
    let dialog = dialog_window(&app)?;
    crate::note_windows::hide_keeping_order(&dialog);
    if let Some(request) = request {
        let _ = app.emit_to(request.opener.as_str(), CLOSED_EVENT, request.id);
        let _ = app.emit_to(DIALOG_LABEL, CLOSED_EVENT, request.id);
        if let Some(opener) = app.get_webview_window(&request.opener) {
            if opener.is_visible().unwrap_or(false) {
                let _ = opener.set_focus();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 0.0, y: 0.0, width: 3840.0, height: 2100.0 };

    #[test]
    fn dialog_is_centered_in_the_work_area() {
        let placed = place(AREA, 36.0, 946.0, 1370.0, None);
        assert_eq!(placed, Rect { x: 1447.0, y: 365.0, width: 946.0, height: 1370.0 });
    }

    #[test]
    fn dialog_never_exceeds_the_work_area_minus_margins() {
        let placed = place(AREA, 36.0, 5000.0, 3000.0, None);
        assert_eq!(placed, Rect { x: 36.0, y: 36.0, width: 3768.0, height: 2028.0 });
    }

    #[test]
    fn resized_dialog_keeps_its_center_but_stays_inside() {
        // 中心不动，变高后上下各长一半。
        let placed = place(AREA, 36.0, 946.0, 800.0, Some((1920.0, 1000.0)));
        assert_eq!(placed, Rect { x: 1447.0, y: 600.0, width: 946.0, height: 800.0 });
        // 靠近工作区底边时整体推回留边以内。
        let placed = place(AREA, 36.0, 946.0, 800.0, Some((1920.0, 2000.0)));
        assert_eq!(placed.y, 2100.0 - 36.0 - 800.0);
    }

    #[test]
    fn dialog_on_a_secondary_monitor_uses_that_work_area() {
        let area = Rect { x: -1920.0, y: 120.0, width: 1920.0, height: 1040.0 };
        let placed = place(area, 24.0, 600.0, 400.0, None);
        assert_eq!(placed, Rect { x: -1260.0, y: 440.0, width: 600.0, height: 400.0 });
    }
}
