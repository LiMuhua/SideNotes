//! 磨砂玻璃主题的侧栏背景（T101，技术决策第 46 条）。
//!
//! 原型的磨砂玻璃是各块（标题区、新建卡片、记录卡片、底栏）各自模糊背后的桌面，块与块之间透出桌面。
//! 系统的亚克力只能加在整个窗口上，侧栏会变成一整块磨砂的底板；页面里的 backdrop-filter 又看不到窗口背后的桌面。
//! 所以磨砂玻璃的侧栏窗口改为全透明，由这里截下侧栏背后的那块屏幕，缩小、模糊、加一点饱和度后交给页面，
//! 各块把它当作背景（按窗口位置对齐，window.css 的 --glass-backdrop），块与块之间仍透出真实的桌面。
//!
//! 截图是静止的：侧栏显示前截一次（窗口还没出来）；显示期间换了主题或改了宽度，停下来之后再截一次，这时只在截图的
//! 一瞬间把侧栏排除在截图之外（WDA_EXCLUDEFROMCAPTURE），排除失败时不截，免得把侧栏自己截进去。
//!
//! 显示期间不再定时重截（第七轮反馈：磨砂玻璃的侧栏一直在闪）：改窗口的截图排除会让系统重画这个窗口，
//! 原来每隔一两秒排除一次，侧栏就跟着闪一下。Glance 的做法相同，背后的桌面在面板还藏着的时候截。
//!
//! Windows 11 上改用系统合成的实时模糊（glass_live.rs，T118），这里只在它用不了时（Windows 10 等）退而求其次。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::windows::{self, SIDEBAR_LABEL};

/// 发给侧栏页面：模糊后的背景图（data URL）。
pub const BACKDROP_EVENT: &str = "sidenotes://glass-backdrop";
/// 发给侧栏页面：侧栏背后那块屏幕的明暗，载荷见 Tone（T131）。
pub const TONE_EVENT: &str = "sidenotes://glass-tone";
/// 实时模糊显示期间多久量一次块与块之间露出的桌面。
const TONE_INTERVAL: Duration = Duration::from_millis(1500);
/// 显示期间换了主题或改了宽度：停下来这么久之后重截（拖动调宽时每一帧都会改，不必每帧都截）。
pub const SETTLE_DELAY: Duration = Duration::from_millis(300);
/// 截图先缩小这么多倍再模糊：模糊后的图没有细节，页面放大后看不出差别，处理与传给页面都快。
const DOWNSCALE: usize = 8;
/// 量块与块之间的桌面时，各块向外让开这么多物理像素：块的边、圆角的抗锯齿与投影不算桌面。
const GAP_MARGIN: f32 = 4.0;
/// 块与块之间露出的像素少于整块区域的这一份时不量（各块几乎铺满，量出来不可信）。
const GAP_MIN_SHARE: f32 = 0.01;

/// 模糊与饱和度，取自磨砂玻璃的令牌（--sn-panel-blur、--sn-panel-saturate），由页面读出后随侧栏布局传来。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Backdrop {
    /// 模糊半径（物理像素，令牌的页面像素乘以页面像素比）。
    pub blur: f64,
    pub saturate: f64,
}

static REFRESH: AtomicU64 = AtomicU64::new(0);
static TONE_LOOP: AtomicU64 = AtomicU64::new(0);
/// 侧栏出来之前量到的背后明暗（窗口藏着，截图里没有它，最准）。显示期间只量块与块之间露出的桌面，与它合并。
static BASE_TONE: Mutex<Option<Tone>> = Mutex::new(None);
/// 最近一次交给页面的明暗（变了才发）。
static SENT_TONE: Mutex<Option<Tone>> = Mutex::new(None);

/// 侧栏背后那块屏幕在玻璃里看到的明暗（T131，参考 Glance 按背后的明暗与杂乱程度调磨砂的做法）：按令牌的模糊
/// 模糊之后，相对亮度（0–1）的第 5 与第 95 百分位。页面据此算出文字仍够清楚时块的着色能淡到多少。
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Tone {
    pub low: f32,
    pub high: f32,
}

impl Tone {
    /// 合并两次测量：取更暗的暗端、更亮的亮端。范围只会变宽，页面算出的着色只会更浓，文字只会更清楚。
    fn widen(self, other: Tone) -> Tone {
        Tone { low: self.low.min(other.low), high: self.high.max(other.high) }
    }
}

/* ==================== 图像处理 ==================== */

/// 把 BGRA 像素（自上而下）按 `factor` 倍缩小，每个像素取所覆盖那一块的平均值，结果为 RGB 浮点。
fn downscale(bgra: &[u8], width: usize, height: usize, factor: usize) -> (Vec<[f32; 3]>, usize, usize) {
    let factor = factor.max(1);
    let (out_width, out_height) = (width.div_ceil(factor).max(1), height.div_ceil(factor).max(1));
    let mut out = vec![[0.0f32; 3]; out_width * out_height];
    for oy in 0..out_height {
        for ox in 0..out_width {
            let (x0, y0) = (ox * factor, oy * factor);
            let (x1, y1) = ((x0 + factor).min(width), (y0 + factor).min(height));
            let mut sum = [0.0f32; 3];
            let mut count = 0.0f32;
            for y in y0..y1 {
                for x in x0..x1 {
                    let index = (y * width + x) * 4;
                    sum[0] += f32::from(bgra[index + 2]);
                    sum[1] += f32::from(bgra[index + 1]);
                    sum[2] += f32::from(bgra[index]);
                    count += 1.0;
                }
            }
            if count > 0.0 {
                out[oy * out_width + ox] = [sum[0] / count, sum[1] / count, sum[2] / count];
            }
        }
    }
    (out, out_width, out_height)
}

/// 一维的方框模糊（半径 `radius`，边缘按最近的像素延伸），作用在从 `start` 起、间隔 `stride` 的 `count` 个像素上。
fn box_line(pixels: &mut [[f32; 3]], start: usize, stride: usize, count: usize, radius: usize, scratch: &mut Vec<[f32; 3]>) {
    if radius == 0 || count == 0 {
        return;
    }
    scratch.clear();
    scratch.extend((0..count).map(|index| pixels[start + index * stride]));
    let window = (radius * 2 + 1) as f32;
    let at = |index: isize| scratch[index.clamp(0, count as isize - 1) as usize];
    let mut sum = [0.0f32; 3];
    for offset in -(radius as isize)..=(radius as isize) {
        let pixel = at(offset);
        for channel in 0..3 {
            sum[channel] += pixel[channel];
        }
    }
    for index in 0..count {
        pixels[start + index * stride] = [sum[0] / window, sum[1] / window, sum[2] / window];
        let (enter, leave) = (at(index as isize + radius as isize + 1), at(index as isize - radius as isize));
        for channel in 0..3 {
            sum[channel] += enter[channel] - leave[channel];
        }
    }
}

/// 近似高斯模糊：横竖各做三遍方框模糊。`sigma` 为标准差（缩小后的像素）。
fn blur(pixels: &mut [[f32; 3]], width: usize, height: usize, sigma: f64) {
    // 三遍半径为 r 的方框模糊约等于标准差 sqrt(((2r+1)^2 - 1) / 4) 的高斯模糊。
    let radius = (((4.0 * sigma * sigma + 1.0).sqrt() - 1.0) / 2.0).round().max(0.0) as usize;
    if radius == 0 {
        return;
    }
    let mut scratch = Vec::with_capacity(width.max(height));
    for _ in 0..3 {
        for y in 0..height {
            box_line(pixels, y * width, 1, width, radius, &mut scratch);
        }
        for x in 0..width {
            box_line(pixels, x, width, height, radius, &mut scratch);
        }
    }
}

/// 调整饱和度（与 CSS 的 saturate() 相同的亮度权重）。
fn saturate(pixels: &mut [[f32; 3]], amount: f64) {
    let amount = amount as f32;
    for pixel in pixels {
        let luma = 0.213 * pixel[0] + 0.715 * pixel[1] + 0.072 * pixel[2];
        for channel in pixel.iter_mut() {
            *channel = (luma + (*channel - luma) * amount).clamp(0.0, 255.0);
        }
    }
}

/// 编码成 24 位的 BMP（自下而上，每行补齐到 4 字节）。
fn encode_bmp(pixels: &[[f32; 3]], width: usize, height: usize) -> Vec<u8> {
    let row = (width * 3).div_ceil(4) * 4;
    let size = 54 + row * height;
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 24]);
    for y in (0..height).rev() {
        let start = out.len();
        for x in 0..width {
            let [r, g, b] = pixels[y * width + x];
            out.extend_from_slice(&[b.round() as u8, g.round() as u8, r.round() as u8]);
        }
        out.resize(start + row, 0);
    }
    out
}

/// 标准 Base64（带补齐）。
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(TABLE[(value >> 18) as usize & 63] as char);
        out.push(TABLE[(value >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(value >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[value as usize & 63] as char } else { '=' });
    }
    out
}

/// sRGB 的一个分量（0–255）换成线性值。
fn linear(channel: f32) -> f32 {
    let value = channel / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// 截下的像素在玻璃里看到的明暗（见 Tone）：缩小、按令牌的模糊模糊（系统的宿主背景另有模糊，这里不算，
/// 估出的明暗只会更极端，着色偏浓、文字偏清楚），取相对亮度的百分位。
fn tone_of(bgra: &[u8], width: usize, height: usize, blur_radius: f64) -> Option<Tone> {
    let (mut pixels, small_width, small_height) = downscale(bgra, width, height, DOWNSCALE);
    blur(&mut pixels, small_width, small_height, blur_radius / DOWNSCALE as f64);
    let mut light: Vec<f32> =
        pixels.iter().map(|[r, g, b]| 0.2126 * linear(*r) + 0.7152 * linear(*g) + 0.0722 * linear(*b)).filter(|value| value.is_finite()).collect();
    if light.is_empty() {
        return None;
    }
    light.sort_by(f32::total_cmp);
    let pick = |share: f32| light[((light.len() - 1) as f32 * share).round() as usize];
    Some(Tone { low: pick(0.05), high: pick(0.95) })
}

/// 块与块之间露出的桌面的明暗（第七轮反馈：显示期间不再把侧栏排除在截图之外）：`bgra` 是侧栏内容区连同侧栏一起截下的
/// 像素，`blocks` 是各块的矩形（内容区的物理像素，x、y、宽、高），各块向外让开 `margin` 后剩下的像素就是透过来的桌面。
/// 不模糊，直接取相对亮度的第 5 与第 95 百分位：比玻璃里模糊过的更极端，着色只会偏浓。露出的太少时为空。
fn gap_tone(bgra: &[u8], width: usize, height: usize, blocks: &[(f32, f32, f32, f32)], margin: f32) -> Option<Tone> {
    if width == 0 || height == 0 || bgra.len() < width * height * 4 {
        return None;
    }
    let mut covered = vec![false; width * height];
    for &(x, y, w, h) in blocks {
        let left = ((x - margin).floor().max(0.0) as usize).min(width);
        let top = ((y - margin).floor().max(0.0) as usize).min(height);
        let right = ((x + w + margin).ceil().max(0.0) as usize).min(width);
        let bottom = ((y + h + margin).ceil().max(0.0) as usize).min(height);
        for row in top..bottom {
            covered[row * width + left..row * width + right].fill(true);
        }
    }
    // 隔一个像素取一个：几十万个像素足够，量一次只要几毫秒。
    let mut light = Vec::new();
    for row in (0..height).step_by(2) {
        for column in (0..width).step_by(2) {
            let index = row * width + column;
            if covered[index] {
                continue;
            }
            let pixel = &bgra[index * 4..index * 4 + 3];
            light.push(0.2126 * linear(f32::from(pixel[2])) + 0.7152 * linear(f32::from(pixel[1])) + 0.0722 * linear(f32::from(pixel[0])));
        }
    }
    let total = width.div_ceil(2) * height.div_ceil(2);
    if (light.len() as f32) < total as f32 * GAP_MIN_SHARE || light.is_empty() {
        return None;
    }
    light.sort_by(f32::total_cmp);
    let pick = |share: f32| light[((light.len() - 1) as f32 * share).round() as usize];
    Some(Tone { low: pick(0.05), high: pick(0.95) })
}

/// 实时模糊的各块（内容区的物理像素）：列表外的块，加上列表里的卡片裁到列表的可见范围之内；列表右边一条（滚动条）
/// 也算作块，不当桌面量。
fn glass_rects(layout: &crate::glass_live::GlassLayout) -> Vec<(f32, f32, f32, f32)> {
    let mut rects: Vec<(f32, f32, f32, f32)> = layout.blocks.iter().map(|block| (block.x, block.y, block.width, block.height)).collect();
    if let Some(view) = layout.viewport {
        let (top, bottom) = (view.y, view.y + view.height);
        for card in &layout.cards {
            let (y0, y1) = (card.y.max(top), (card.y + card.height).min(bottom));
            if y1 > y0 {
                rects.push((card.x, y0, card.width, y1 - y0));
            }
        }
        let rail = 16.0_f32.min(view.width);
        rects.push((view.x + view.width - rail, view.y, rail, view.height));
    }
    rects
}

/// 显示期间量一次块与块之间露出的桌面：连同侧栏一起截，不改窗口的截图排除。截到屏幕之外的部分去掉（那里是黑的）。
fn sample_gaps(sidebar: &WebviewWindow) -> Option<Tone> {
    let layout = crate::glass_live::last_layout()?;
    let (x, y, width, height) = client_rect(sidebar)?;
    let (left, top, right, bottom) = monitor_bounds(sidebar)?;
    let (x0, y0) = (x.max(left), y.max(top));
    let (x1, y1) = ((x + width).min(right), (y + height).min(bottom));
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let pixels = grab(x0, y0, x1 - x0, y1 - y0)?;
    let rects: Vec<(f32, f32, f32, f32)> = glass_rects(&layout).into_iter().map(|(rx, ry, rw, rh)| (rx - (x0 - x) as f32, ry - (y0 - y) as f32, rw, rh)).collect();
    gap_tone(&pixels, (x1 - x0) as usize, (y1 - y0) as usize, &rects, GAP_MARGIN)
}

/// 侧栏所在屏幕的范围（物理像素：左、上、右、下）。
fn monitor_bounds(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let (position, size) = (monitor.position(), monitor.size());
    Some((position.x, position.y, position.x + size.width as i32, position.y + size.height as i32))
}

/// 把明暗交给页面（与上次相同时不发）。
fn send_tone(app: &AppHandle, tone: Tone) {
    let Ok(mut sent) = SENT_TONE.lock() else { return };
    if sent.is_some_and(|last| (last.low - tone.low).abs() <= 0.01 && (last.high - tone.high).abs() <= 0.01) {
        return;
    }
    *sent = Some(tone);
    let _ = app.emit_to(SIDEBAR_LABEL, TONE_EVENT, tone);
}

/// 实时模糊打开期间（`live`），侧栏显示着时每隔 TONE_INTERVAL 量一次块与块之间露出的桌面，与侧栏出来之前量到的
/// 明暗合并后交给页面（T131）：背后换成更亮、更杂的画面时着色跟着变浓，文字一直清楚；背后又柔和下来时着色变回去，
/// 但不比侧栏出来时量到的更淡（块与块之间只是一部分桌面）。关掉实时模糊、换走磨砂玻璃时停下；再次调用时换成新的一轮。
pub fn watch_tone(app: &AppHandle, live: bool) {
    let generation = TONE_LOOP.fetch_add(1, Ordering::SeqCst) + 1;
    if !live {
        return;
    }
    // 新的一轮（页面刚打开实时模糊）：页面那边还没有明暗，下一次量到的照发。
    if let Ok(mut sent) = SENT_TONE.lock() {
        *sent = None;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        if TONE_LOOP.load(Ordering::SeqCst) != generation || !crate::glass_live::active() {
            return;
        }
        let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) else { return };
        if sidebar.is_visible().unwrap_or(false) {
            if let Some(seen) = sample_gaps(&sidebar) {
                let base = BASE_TONE.lock().ok().and_then(|slot| *slot);
                send_tone(&app, base.map_or(seen, |base| base.widen(seen)));
            }
        }
        std::thread::sleep(TONE_INTERVAL);
    });
}

/// 停下明暗的测量（退出前，见 glass_live::shutdown）。
pub fn watch_tone_stop() {
    TONE_LOOP.fetch_add(1, Ordering::SeqCst);
}

/// 截下的像素处理成页面用的背景图。
fn process(bgra: &[u8], width: usize, height: usize, backdrop: Backdrop) -> String {
    let (mut pixels, small_width, small_height) = downscale(bgra, width, height, DOWNSCALE);
    blur(&mut pixels, small_width, small_height, backdrop.blur / DOWNSCALE as f64);
    if (backdrop.saturate - 1.0).abs() > f64::EPSILON {
        saturate(&mut pixels, backdrop.saturate);
    }
    format!("data:image/bmp;base64,{}", base64(&encode_bmp(&pixels, small_width, small_height)))
}

/* ==================== 截图 ==================== */

/// 截下屏幕上的一块（物理像素），返回 BGRA 像素（自上而下）。只用 SRCCOPY（与 Glance 相同）：加上 CAPTUREBLT 时
/// 系统每截一次都要把指针藏一下，显示期间定时量明暗，指针停在侧栏上就跟着闪。
#[cfg(windows)]
fn grab(x: i32, y: i32, width: i32, height: i32) -> Option<Vec<u8>> {
    use ::windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    if width <= 0 || height <= 0 {
        return None;
    }
    // SAFETY：设备上下文与位图都在本函数内创建并释放；像素指针在位图释放前读完。
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let memory = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let pixels = match CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => {
                let previous = SelectObject(memory, bitmap.into());
                let copied = BitBlt(memory, 0, 0, width, height, Some(screen), x, y, SRCCOPY).is_ok();
                let pixels = (copied && !bits.is_null())
                    .then(|| std::slice::from_raw_parts(bits.cast::<u8>(), width as usize * height as usize * 4).to_vec());
                SelectObject(memory, previous);
                let _ = DeleteObject(bitmap.into());
                pixels
            }
            Err(_) => None,
        };
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        pixels
    }
}

#[cfg(not(windows))]
fn grab(_x: i32, _y: i32, _width: i32, _height: i32) -> Option<Vec<u8>> {
    None
}

/// 截图期间把侧栏排除在截图之外；返回是否设置成功。
#[cfg(windows)]
fn exclude_from_capture(window: &WebviewWindow, exclude: bool) -> bool {
    use ::windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let Ok(hwnd) = window.hwnd() else { return false };
    // SAFETY：hwnd 来自仍然存在的 Tauri 窗口。
    unsafe { SetWindowDisplayAffinity(hwnd, if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }).is_ok() }
}

#[cfg(not(windows))]
fn exclude_from_capture(_window: &WebviewWindow, _exclude: bool) -> bool {
    false
}

/// 截下 `rect`（物理像素）处理成背景图。`visible` 时侧栏正显示着，截图的一瞬间把它排除在外；排除不了就不截。
fn capture(sidebar: &WebviewWindow, rect: (i32, i32, i32, i32), backdrop: Backdrop, visible: bool) -> Option<String> {
    if visible && !exclude_from_capture(sidebar, true) {
        return None;
    }
    let pixels = grab(rect.0, rect.1, rect.2, rect.3);
    if visible {
        exclude_from_capture(sidebar, false);
    }
    pixels.map(|pixels| process(&pixels, rect.2 as usize, rect.3 as usize, backdrop))
}

/// 侧栏内容区现在在屏幕上的矩形（物理像素）。
fn client_rect(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let position = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    Some((position.x, position.y, size.width as i32, size.height as i32))
}

fn deliver(app: &AppHandle, url: Option<String>) {
    if let Some(url) = url {
        let _ = app.emit_to(SIDEBAR_LABEL, BACKDROP_EVENT, url);
    }
}

/// 侧栏显示之前（窗口还没出来）：按它将要停的位置截一次背景。窗口藏着，截图里没有它，不必排除。
/// `x`、`y` 为外框将要停的位置，`width`、`height` 为内容区尺寸（逻辑像素，与 windows.rs 的几何相同）。
pub fn before_show(app: &AppHandle, sidebar: &WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let Some(backdrop) = windows::last_layout().backdrop else { return };
    if crate::glass_live::active() {
        // 实时模糊：窗口出来之前先按将要停的位置量一次明暗（T131），块一出现就是合适的着色；显示期间以它为底，
        // 只合并块与块之间量到的桌面（见 watch_tone）。截到屏幕之外的部分去掉（那里是黑的，会把着色算浓）。
        if !sidebar.is_visible().unwrap_or(false) {
            if let (Ok(scale), Ok(inner), Ok(outer)) = (sidebar.scale_factor(), sidebar.inner_position(), sidebar.outer_position()) {
                let (left, top) = ((x * scale).round() as i32 + inner.x - outer.x, (y * scale).round() as i32 + inner.y - outer.y);
                let (wide, tall) = ((width * scale).round() as i32, (height * scale).round() as i32);
                let bounds = app
                    .monitor_from_point(f64::from(left + wide / 2), f64::from(top + tall / 2))
                    .ok()
                    .flatten()
                    .map(|monitor| (monitor.position().x, monitor.position().y, monitor.position().x + monitor.size().width as i32, monitor.position().y + monitor.size().height as i32));
                let (x0, y0, x1, y1) = match bounds {
                    Some((l, t, r, b)) => (left.max(l), top.max(t), (left + wide).min(r), (top + tall).min(b)),
                    None => (left, top, left + wide, top + tall),
                };
                if let Some(tone) = grab(x0, y0, x1 - x0, y1 - y0).and_then(|pixels| tone_of(&pixels, (x1 - x0) as usize, (y1 - y0) as usize, backdrop.blur)) {
                    if let Ok(mut base) = BASE_TONE.lock() {
                        *base = Some(tone);
                    }
                    send_tone(app, tone);
                }
            }
        }
        return;
    }
    if let (Ok(scale), Ok(inner), Ok(outer)) = (sidebar.scale_factor(), sidebar.inner_position(), sidebar.outer_position()) {
        let rect = (
            (x * scale).round() as i32 + inner.x - outer.x,
            (y * scale).round() as i32 + inner.y - outer.y,
            (width * scale).round() as i32,
            (height * scale).round() as i32,
        );
        let visible = sidebar.is_visible().unwrap_or(false);
        deliver(app, capture(sidebar, rect, backdrop, visible));
    }
}

/// 侧栏显示期间换了主题或改了宽度：等 `delay` 之后重截一次背景（截的一瞬间把侧栏排除在截图之外）。再次调用时换成
/// 新的一次（拖动调宽时连续调用，只在停下来之后截）。不再定时重截，见模块说明。
pub fn recapture_later(app: &AppHandle, delay: Duration) {
    if windows::last_layout().backdrop.is_none() || crate::glass_live::active() {
        return;
    }
    let generation = REFRESH.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if REFRESH.load(Ordering::SeqCst) != generation || crate::glass_live::active() {
            return;
        }
        let Some(backdrop) = windows::last_layout().backdrop else { return };
        let Some(sidebar) = app.get_webview_window(SIDEBAR_LABEL) else { return };
        if !sidebar.is_visible().unwrap_or(false) {
            return;
        }
        if let Some(rect) = client_rect(&sidebar) {
            deliver(&app, capture(&sidebar, rect, backdrop, true));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: usize, height: usize, bgra: [u8; 4]) -> Vec<u8> {
        bgra.repeat(width * height)
    }

    #[test]
    fn downscale_averages_each_block_and_keeps_partial_edges() {
        // 3 × 2 的图按 2 倍缩小成 2 × 1：左边一块是红与蓝的平均，右边只有半块（红）。
        let mut pixels = solid(3, 2, [0, 0, 255, 255]);
        pixels[4..8].copy_from_slice(&[255, 0, 0, 255]);
        pixels[16..20].copy_from_slice(&[255, 0, 0, 255]);
        let (out, width, height) = downscale(&pixels, 3, 2, 2);
        assert_eq!((width, height), (2, 1));
        assert_eq!(out[0], [127.5, 0.0, 127.5]);
        assert_eq!(out[1], [255.0, 0.0, 0.0]);
    }

    #[test]
    fn blur_keeps_a_uniform_image_unchanged_and_spreads_an_edge() {
        let mut flat = vec![[90.0f32, 120.0, 200.0]; 40 * 10];
        blur(&mut flat, 40, 10, 4.0);
        assert!(flat.iter().all(|pixel| (pixel[0] - 90.0).abs() < 0.01 && (pixel[2] - 200.0).abs() < 0.01));
        // 左黑右白：模糊后中间过渡，两端仍接近原色。
        let mut edge: Vec<[f32; 3]> = (0..40).map(|x| if x < 20 { [0.0; 3] } else { [255.0; 3] }).collect();
        blur(&mut edge, 40, 1, 3.0);
        assert!(edge[0][0] < 5.0 && edge[39][0] > 250.0);
        assert!(edge[19][0] > 60.0 && edge[20][0] < 195.0);
    }

    #[test]
    fn saturate_keeps_grays_and_pushes_colors_apart() {
        let mut pixels = vec![[128.0f32, 128.0, 128.0], [200.0, 100.0, 100.0]];
        saturate(&mut pixels, 1.1);
        assert!((pixels[0][0] - 128.0).abs() < 0.01 && (pixels[0][2] - 128.0).abs() < 0.01);
        assert!(pixels[1][0] > 200.0 && pixels[1][1] < 100.0);
    }

    #[test]
    fn bmp_has_a_valid_header_and_padded_rows() {
        let bmp = encode_bmp(&[[255.0, 0.0, 0.0]; 2], 1, 2);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()) as usize, bmp.len());
        // 每行 3 字节补到 4 字节，两行共 8 字节；像素按蓝、绿、红存放。
        assert_eq!(bmp.len(), 54 + 8);
        assert_eq!(&bmp[54..58], &[0, 0, 255, 0]);
    }

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
    }

    #[test]
    fn gap_tone_reads_only_the_desktop_between_blocks() {
        // 40 × 40：左边 20 列是白色的块，右边是黑色的桌面。块（连同让开的边）里的白色不算，量出来全是桌面的黑。
        let mut pixels = solid(40, 40, [0, 0, 0, 255]);
        for row in 0..40 {
            for column in 0..20 {
                pixels[(row * 40 + column) * 4..(row * 40 + column) * 4 + 3].copy_from_slice(&[255, 255, 255]);
            }
        }
        let tone = gap_tone(&pixels, 40, 40, &[(0.0, 0.0, 20.0, 40.0)], 2.0).expect("露出的桌面够多");
        assert_eq!((tone.low, tone.high), (0.0, 0.0));
        // 各块铺满时不量。
        assert!(gap_tone(&pixels, 40, 40, &[(0.0, 0.0, 40.0, 40.0)], 0.0).is_none());
    }

    #[test]
    fn gap_tone_takes_the_5th_and_95th_percentile_of_relative_luminance() {
        // 桌面一半纯黑、一半纯白：暗端 0、亮端 1。
        let mut pixels = solid(20, 20, [0, 0, 0, 255]);
        for index in 0..200 {
            pixels[index * 4..index * 4 + 3].copy_from_slice(&[255, 255, 255]);
        }
        let tone = gap_tone(&pixels, 20, 20, &[], 0.0).expect("没有块时全是桌面");
        assert!(tone.low.abs() < 1e-6 && (tone.high - 1.0).abs() < 1e-4);
    }

    #[test]
    fn widened_tone_keeps_the_darker_and_the_lighter_end() {
        let shown = Tone { low: 0.1, high: 0.4 };
        assert_eq!(shown.widen(Tone { low: 0.2, high: 0.9 }), Tone { low: 0.1, high: 0.9 });
        assert_eq!(shown.widen(Tone { low: 0.05, high: 0.3 }), Tone { low: 0.05, high: 0.4 });
    }

    #[test]
    fn glass_rects_clip_cards_to_the_list_and_cover_its_scrollbar() {
        use crate::glass_live::{Block, GlassLayout};
        let block = |x: f32, y: f32, width: f32, height: f32| Block { x, y, width, height, radius: 0.0 };
        let layout = GlassLayout {
            blocks: vec![block(0.0, 0.0, 100.0, 40.0)],
            cards: vec![block(0.0, 30.0, 90.0, 60.0), block(0.0, 300.0, 90.0, 60.0)],
            viewport: Some(block(0.0, 50.0, 100.0, 200.0)),
        };
        let rects = glass_rects(&layout);
        // 列表外的块原样；第一张卡片裁到列表顶边；滚出列表的第二张不算；列表右边 16 像素算作块。
        assert_eq!(rects, vec![(0.0, 0.0, 100.0, 40.0), (0.0, 50.0, 90.0, 40.0), (84.0, 50.0, 16.0, 200.0)]);
    }
}
