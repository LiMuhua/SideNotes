//! 大图的显示副本（T115，技术决策第 48 条）。
//!
//! 卡片、全文浮窗、记录窗口与附件弹窗原来直接显示附件文件夹里的原图：一张 6000 × 4000 的照片，
//! 即使只显示成 150 像素高，WebView 也要把整张图解码出来（约 96 MB），图多时第一次滚到很慢、很占内存。
//! 这里按显示的需要缩小一份副本，各处显示副本，原图不动（导出、打开文件、备份仍用原图）：
//! - 两档：卡片里最长边 CARD_EDGE，窗口与弹窗里最长边 WINDOW_EDGE（按 2.5 倍的屏幕缩放也够清晰）；
//!   原图本来就不比这一档大时直接用原图，不生成副本。
//! - 副本放在系统缓存目录的 thumbnails/ 里，不进数据目录，不随备份、导出与迁移走；按原图的路径、大小、修改时间
//!   与档位取名，原图换了就是另一份。缺了随时重新生成；启动时删掉 PRUNE_AFTER 没用过的副本。
//! - 只处理附件文件夹里的 PNG 与 JPEG；动图（GIF）、WebP 等原样显示。生成一次一张（串行），
//!   解码大图的那点内存只占一会儿。
//!
//! 页面拿到副本的路径与尺寸（尺寸用来先占好位置），滚出视野闲置一段时间的图片由页面释放（core/images.ts）。

use std::hash::Hasher;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// 卡片里的副本最长边（物理像素）：卡片最宽约 400 页面像素，2.5 倍屏幕缩放下约 1000 像素。
pub const CARD_EDGE: u32 = 1024;
/// 全文浮窗、记录窗口与附件弹窗里的副本最长边。
pub const WINDOW_EDGE: u32 = 2048;
/// 副本所在的子文件夹（系统缓存目录下）。
pub const THUMBNAILS_DIR: &str = "thumbnails";
/// 多久没用过的副本在启动时删掉（显示时会重新生成）。
const PRUNE_AFTER: Duration = Duration::from_secs(60 * 24 * 3600);
/// JPEG 副本的质量。
const JPEG_QUALITY: u8 = 86;

/// 一次只生成一张副本：解码大图要几十 MB 内存，同时生成几张会叠起来。
static GENERATING: Mutex<()> = Mutex::new(());

/// 显示用的图片：路径（副本或原图）与它的像素尺寸。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DisplayImage {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// 档位对应的最长边：`window` 为窗口与弹窗，其余为卡片。
pub fn edge_for(tier: &str) -> u32 {
    if tier == "window" { WINDOW_EDGE } else { CARD_EDGE }
}

/// 缩到最长边不超过 `edge` 的尺寸（保持比例，至少 1 像素）；本来就不大时原样返回。
pub fn fit(width: u32, height: u32, edge: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= edge || longest == 0 {
        return (width, height);
    }
    let scale = f64::from(edge) / f64::from(longest);
    (((f64::from(width) * scale).round() as u32).max(1), ((f64::from(height) * scale).round() as u32).max(1))
}

/// FNV-1a：副本的名字要在不同版本的程序之间保持一样（标准库的哈希不保证）。
struct Fnv(u64);

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }
}

/// 副本的文件名：原图的路径、大小、修改时间与档位决定，原图换了就是另一份；有透明的存 PNG，其余 JPEG。
pub fn thumbnail_name(path: &Path, size: u64, modified: u64, edge: u32, alpha: bool) -> String {
    let mut hasher = Fnv(0xcbf2_9ce4_8422_2325);
    hasher.write(path.to_string_lossy().as_bytes());
    hasher.write(&size.to_le_bytes());
    hasher.write(&modified.to_le_bytes());
    format!("{:016x}-{edge}.{}", hasher.finish(), if alpha { "png" } else { "jpg" })
}

/// 只给 PNG 与 JPEG 生成副本（按扩展名）；PNG 可能有透明，副本也存 PNG。
fn kind(path: &Path) -> Option<bool> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some(true),
        "jpg" | "jpeg" => Some(false),
        _ => None,
    }
}

/// 显示 `path`（附件文件夹 `root` 里的图片）用的图片：原图不比这一档大时就是原图，否则是缩小的副本（没有就生成）。
/// 不是附件文件夹里的 PNG、JPEG，或读不出尺寸时返回 None，页面照原样显示。
pub fn display_image(root: &Path, cache: &Path, path: &Path, edge: u32) -> AppResult<Option<DisplayImage>> {
    if !crate::attachments::is_inside(root, path) {
        return Ok(None);
    }
    let Some(alpha) = kind(path) else { return Ok(None) };
    let Ok((width, height)) = image::image_dimensions(path) else { return Ok(None) };
    let original = DisplayImage { path: path.to_string_lossy().into_owned(), width, height };
    let (small_width, small_height) = fit(width, height, edge);
    if (small_width, small_height) == (width, height) {
        return Ok(Some(original));
    }
    let meta = std::fs::metadata(path)?;
    let modified = meta.modified().ok().and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok()).map_or(0, |time| time.as_secs());
    let target = cache.join(thumbnail_name(path, meta.len(), modified, edge, alpha));
    let small = DisplayImage { path: target.to_string_lossy().into_owned(), width: small_width, height: small_height };
    if target.is_file() {
        touch(&target);
        return Ok(Some(small));
    }
    let _guard = GENERATING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // 排队期间别的请求可能已经生成了同一张。
    if target.is_file() {
        return Ok(Some(small));
    }
    match generate(path, &target, edge, alpha) {
        Ok(()) => Ok(Some(small)),
        Err(error) => {
            crate::diag::log(format!("图片副本生成失败，显示原图：{error}"));
            Ok(Some(original))
        }
    }
}

/// 解码原图、缩小、写到 `target`（先写临时文件再改名，写到一半的文件不会被当成副本）。
fn generate(source: &Path, target: &Path, edge: u32, alpha: bool) -> AppResult<()> {
    let picture = image::open(source).map_err(|error| AppError::Other(format!("读不出图片：{error}")))?;
    let small = picture.thumbnail(edge, edge);
    if let Some(folder) = target.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let partial = target.with_extension("part");
    let result = if alpha {
        small.save_with_format(&partial, image::ImageFormat::Png)
    } else {
        let file = std::fs::File::create(&partial)?;
        let mut writer = std::io::BufWriter::new(file);
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
        small.to_rgb8().write_with_encoder(encoder)
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(AppError::Other(format!("写不出副本：{error}")));
    }
    std::fs::rename(&partial, target)?;
    Ok(())
}

/// 用过的副本改一下修改时间，清理时按它判断多久没用。
fn touch(path: &Path) {
    if let Ok(file) = std::fs::File::options().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

/// 删掉很久没用过的副本（启动后在后台做一次）。
pub fn prune(cache: &Path, now: SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(cache) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        let stale = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > PRUNE_AFTER);
        if stale && path.is_file() && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_keeps_the_aspect_ratio_and_small_images() {
        assert_eq!(fit(6000, 4000, 1024), (1024, 683));
        assert_eq!(fit(1000, 3000, 1024), (341, 1024));
        // 本来就不大：原样。
        assert_eq!(fit(800, 600, 1024), (800, 600));
        assert_eq!(fit(1024, 10, 1024), (1024, 10));
        // 极窄的长图：至少 1 像素。
        assert_eq!(fit(20000, 2, 1024), (1024, 1));
    }

    #[test]
    fn thumbnail_names_change_with_the_source_and_tier() {
        let path = Path::new("C:/data/attachments/a/photo.jpg");
        let name = thumbnail_name(path, 100, 5, 1024, false);
        assert!(name.ends_with("-1024.jpg"));
        assert_eq!(name, thumbnail_name(path, 100, 5, 1024, false));
        assert_ne!(name, thumbnail_name(path, 101, 5, 1024, false));
        assert_ne!(name, thumbnail_name(path, 100, 6, 1024, false));
        assert!(thumbnail_name(path, 100, 5, 2048, true).ends_with("-2048.png"));
    }

    #[test]
    fn large_images_get_a_small_copy_and_small_ones_stay() {
        let root = std::env::temp_dir().join(format!("sn-thumbs-{}", std::process::id()));
        let folder = root.join(crate::attachments::ATTACHMENTS_DIR).join("one");
        let cache = root.join("cache");
        std::fs::create_dir_all(&folder).unwrap();
        let big = folder.join("big.png");
        image::RgbaImage::from_pixel(1500, 300, image::Rgba([10, 20, 30, 128])).save(&big).unwrap();
        let small = folder.join("small.jpg");
        image::RgbImage::from_pixel(300, 200, image::Rgb([200, 100, 50])).save(&small).unwrap();
        let attachments = root.join(crate::attachments::ATTACHMENTS_DIR);

        let shown = display_image(&attachments, &cache, &big, 1024).unwrap().unwrap();
        assert_eq!((shown.width, shown.height), (1024, 205));
        assert!(shown.path.ends_with(".png") && Path::new(&shown.path).starts_with(&cache));
        assert_eq!(image::image_dimensions(&shown.path).unwrap(), (1024, 205));
        // 第二次直接用已有的副本。
        assert_eq!(display_image(&attachments, &cache, &big, 1024).unwrap().unwrap(), shown);
        // 小图用原图。
        let original = display_image(&attachments, &cache, &small, 1024).unwrap().unwrap();
        assert_eq!(original.path, small.to_string_lossy());
        // 附件文件夹之外的文件不处理。
        let outside = root.join("outside.png");
        image::RgbaImage::new(2000, 2000).save(&outside).unwrap();
        assert_eq!(display_image(&attachments, &cache, &outside, 1024).unwrap(), None);

        assert_eq!(prune(&cache, SystemTime::now()), 0);
        assert_eq!(prune(&cache, SystemTime::now() + PRUNE_AFTER + Duration::from_secs(60)), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
