//! 托盘菜单的图标（第九轮反馈 7）：朴素的线条图形，按菜单的明暗在内存里画成 16 × 16 像素。
//!
//! muda 在 Windows 上把菜单图标画进 16 × 16 像素的位图（与屏幕缩放无关），这里就按这个尺寸画，免得再被缩放糊掉。
//! 图形只有线段与圆弧：每个采样点算到最近线条的距离，落在半个线宽之内算画上，每个像素 4 × 4 个采样点抗锯齿，
//! 不为几个小图标另加绘图库。图形照侧栏的图标集（Icon.tsx 的 24 × 24 线条）按 16 像素重画。

use tauri::image::Image;

/// 图标的边长（像素）。
const SIZE: u32 = 16;
/// 线宽（像素）：16 像素里接近侧栏图标的粗细。
const STROKE: f32 = 1.3;
/// 每个像素横竖各取几个采样点。
const SAMPLES: u32 = 4;

/// 托盘菜单里的图标。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Glyph {
    /// 显示侧栏：窗口右边隔出一栏。
    Sidebar,
    /// 快捷速记：铅笔。
    Capture,
    /// 设置：齿轮。
    Settings,
    /// 退出：电源。
    Quit,
}

/// 一段线条：线段，或圆弧（角度为度，y 轴朝下，从 `from` 顺时针扫到 `to`）。
enum Stroke {
    Line((f32, f32), (f32, f32)),
    Arc { center: (f32, f32), radius: f32, from: f32, to: f32 },
}

/// 闭合折线的各边。
fn polygon(points: &[(f32, f32)]) -> Vec<Stroke> {
    (0..points.len()).map(|index| Stroke::Line(points[index], points[(index + 1) % points.len()])).collect()
}

/// 圆角矩形的四边与四个角。
fn rounded_rect(left: f32, top: f32, right: f32, bottom: f32, radius: f32) -> Vec<Stroke> {
    let corner = |x: f32, y: f32, from: f32| Stroke::Arc { center: (x, y), radius, from, to: from + 90.0 };
    vec![
        Stroke::Line((left + radius, top), (right - radius, top)),
        Stroke::Line((right, top + radius), (right, bottom - radius)),
        Stroke::Line((right - radius, bottom), (left + radius, bottom)),
        Stroke::Line((left, bottom - radius), (left, top + radius)),
        corner(right - radius, top + radius, 270.0),
        corner(right - radius, bottom - radius, 0.0),
        corner(left + radius, bottom - radius, 90.0),
        corner(left + radius, top + radius, 180.0),
    ]
}

/// 侧栏图标集是 24 × 24 的坐标，按 16 像素缩小。
fn scaled(points: &[(f32, f32)]) -> Vec<(f32, f32)> {
    points.iter().map(|&(x, y)| (x * 2.0 / 3.0, y * 2.0 / 3.0)).collect()
}

fn strokes(glyph: Glyph) -> Vec<Stroke> {
    match glyph {
        Glyph::Sidebar => {
            let mut list = rounded_rect(1.75, 2.75, 14.25, 13.25, 2.25);
            list.push(Stroke::Line((10.0, 2.75), (10.0, 13.25)));
            list
        }
        // Icon.tsx 的 edit：笔身与笔尖一笔，再一道笔箍。
        Glyph::Capture => {
            let mut list = polygon(&scaled(&[(16.0, 3.0), (21.0, 8.0), (9.0, 20.0), (4.0, 20.0), (4.0, 15.0)]));
            let band = scaled(&[(13.0, 6.0), (18.0, 11.0)]);
            list.push(Stroke::Line(band[0], band[1]));
            list
        }
        // Icon.tsx 的 settings：外圈 24 个点的齿轮，中间一个圆。
        Glyph::Settings => {
            let mut list = polygon(&scaled(&[
                (9.5, 3.0), (8.8, 6.0), (6.1, 7.0), (3.5, 6.0), (2.0, 9.0), (4.0, 11.0), (4.0, 14.0), (2.0, 16.0),
                (3.5, 19.0), (6.1, 18.0), (8.8, 19.0), (9.5, 22.0), (14.5, 22.0), (15.2, 19.0), (17.9, 18.0), (20.5, 19.0),
                (22.0, 16.0), (20.0, 14.0), (20.0, 11.0), (22.0, 9.0), (20.5, 6.0), (17.9, 7.0), (15.2, 6.0), (14.5, 3.0),
            ]));
            list.push(Stroke::Arc { center: (8.0, 8.0), radius: 2.0, from: 0.0, to: 360.0 });
            list
        }
        // 电源：顶上留口的圆弧与一道竖线。
        Glyph::Quit => vec![
            Stroke::Arc { center: (8.0, 8.75), radius: 5.5, from: -50.0, to: 230.0 },
            Stroke::Line((8.0, 1.75), (8.0, 7.75)),
        ],
    }
}

/// 点到线段的距离。
fn line_distance(point: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length = dx * dx + dy * dy;
    let t = if length > 0.0 { (((point.0 - a.0) * dx + (point.1 - a.1) * dy) / length).clamp(0.0, 1.0) } else { 0.0 };
    ((point.0 - a.0 - t * dx).powi(2) + (point.1 - a.1 - t * dy).powi(2)).sqrt()
}

/// 点到圆弧的距离：在圆弧扫过的角度里是到圆周的距离，否则是到较近一端的距离。
fn arc_distance(point: (f32, f32), center: (f32, f32), radius: f32, from: f32, to: f32) -> f32 {
    let (dx, dy) = (point.0 - center.0, point.1 - center.1);
    let sweep = (to - from).rem_euclid(360.0);
    let sweep = if sweep == 0.0 { 360.0 } else { sweep };
    let angle = dy.atan2(dx).to_degrees();
    if (angle - from).rem_euclid(360.0) <= sweep {
        return ((dx * dx + dy * dy).sqrt() - radius).abs();
    }
    let end = |degrees: f32| {
        let radians = degrees.to_radians();
        (center.0 + radius * radians.cos(), center.1 + radius * radians.sin())
    };
    let distance = |(x, y): (f32, f32)| ((point.0 - x).powi(2) + (point.1 - y).powi(2)).sqrt();
    distance(end(from)).min(distance(end(to)))
}

/// 画出图标的覆盖率（0–1），按行排列。
fn coverage(glyph: Glyph) -> Vec<f32> {
    let list = strokes(glyph);
    let half = STROKE / 2.0;
    let step = 1.0 / SAMPLES as f32;
    let mut out = Vec::with_capacity((SIZE * SIZE) as usize);
    for row in 0..SIZE {
        for column in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let point = (column as f32 + (sx as f32 + 0.5) * step, row as f32 + (sy as f32 + 0.5) * step);
                    let near = list.iter().any(|stroke| {
                        let distance = match *stroke {
                            Stroke::Line(a, b) => line_distance(point, a, b),
                            Stroke::Arc { center, radius, from, to } => arc_distance(point, center, radius, from, to),
                        };
                        distance <= half
                    });
                    hits += u32::from(near);
                }
            }
            out.push(hits as f32 / (SAMPLES * SAMPLES) as f32);
        }
    }
    out
}

/// 图标的 RGBA 像素（不预乘）：深色菜单上是浅色的线条，浅色菜单上是深色的线条，与菜单文字同色、略淡一点。
fn pixels(glyph: Glyph, dark: bool) -> Vec<u8> {
    let (color, alpha) = if dark { (255u8, 0.9f32) } else { (0u8, 0.82f32) };
    coverage(glyph).into_iter().flat_map(|value| [color, color, color, (value * alpha * 255.0).round() as u8]).collect()
}

/// 托盘菜单用的图标。`dark` 为菜单是深色（跟随系统的应用明暗，见 system_dark）。
pub fn image(glyph: Glyph, dark: bool) -> Image<'static> {
    Image::new_owned(pixels(glyph, dark), SIZE, SIZE)
}

/// 系统的应用是不是深色（「设置 → 个性化 → 颜色」的应用模式）。托盘菜单（muda）按它画深色或浅色的菜单。
#[cfg(windows)]
pub fn system_dark() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let mut value = 1u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY：输出指针指向本函数内的 u32，大小写在 size 里。
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    read.is_ok() && value == 0
}

#[cfg(not(windows))]
pub fn system_dark() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Glyph; 4] = [Glyph::Sidebar, Glyph::Capture, Glyph::Settings, Glyph::Quit];

    #[test]
    fn every_glyph_is_drawn_inside_a_clear_margin() {
        for glyph in ALL {
            let cover = coverage(glyph);
            let inked = cover.iter().filter(|value| **value > 0.0).count();
            assert!(inked > 20 && inked < 160, "{glyph:?} 画了 {inked} 个像素");
            // 四个角的像素是空的：图形不顶到边。
            for index in [0, (SIZE - 1) as usize, (SIZE * (SIZE - 1)) as usize, (SIZE * SIZE - 1) as usize] {
                assert_eq!(cover[index], 0.0, "{glyph:?} 的角上有颜色");
            }
        }
    }

    #[test]
    fn the_power_symbol_is_symmetric_and_open_at_the_top() {
        let cover = coverage(Glyph::Quit);
        for row in 0..SIZE as usize {
            for column in 0..8usize {
                let (left, right) = (cover[row * 16 + column], cover[row * 16 + 15 - column]);
                assert!((left - right).abs() < 0.13, "第 {row} 行第 {column} 列左右不对称：{left} / {right}");
            }
        }
        // 竖线两边、圆弧的缺口处是空的。
        assert_eq!(cover[3 * 16 + 5], 0.0);
        assert_eq!(cover[3 * 16 + 10], 0.0);
    }

    #[test]
    fn the_color_follows_the_menu_theme() {
        let dark = pixels(Glyph::Settings, true);
        let light = pixels(Glyph::Settings, false);
        let ink = |data: &[u8]| data.chunks(4).find(|pixel| pixel[3] > 200).map(|pixel| pixel[0]);
        assert_eq!(ink(&dark), Some(255));
        assert_eq!(ink(&light), Some(0));
        assert_eq!(dark.len(), (SIZE * SIZE * 4) as usize);
    }
}
