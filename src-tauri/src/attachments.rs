//! 附件文件。
//!
//! 粘贴的截图与引用的文件都复制一份到应用数据目录的 attachments 文件夹中维护，
//! 记录只引用这份副本：原始文件移动、改名或删除后，引用仍然有效。
//! 每次导入放在独立的子文件夹里，文件保留原名，同名文件互不覆盖。
//!
//! 记录不再引用的副本由 [`cleanup`] 清理：删除记录、清空回收站或更换附件后，
//! 旧副本不再被任何记录引用，按子文件夹整体删除，避免数据目录无谓膨胀。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// 应用数据目录下存放附件副本的文件夹。
pub const ATTACHMENTS_DIR: &str = "attachments";
/// 单个附件的大小上限：附件随数据目录一起备份与迁移，过大的文件应保留在原处。
const MAX_ATTACHMENT_BYTES: u64 = 100 * 1024 * 1024;
/// 新导入的附件在这段时间内不清理：粘贴后尚未保存的编辑、速记浮窗里尚未保存的草稿都可能引用它们，
/// 而这些内容只在各窗口的内存中，数据库里还查不到。
pub const CLEANUP_GRACE: Duration = Duration::from_secs(24 * 60 * 60);

/// 导入后的附件：显示名称与副本的完整路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub name: String,
    pub path: String,
}

/// 文件名去掉路径分隔符、Windows 不允许的字符与控制字符，限制长度并保留扩展名；为空时用「附件」。
pub fn sanitize_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if cleaned.is_empty() {
        return "附件".to_string();
    }
    if cleaned.chars().count() <= 120 {
        return cleaned;
    }
    // 超长时截短主名，保留扩展名。
    let (stem, extension) = match cleaned.rfind('.') {
        Some(dot) if dot > 0 && cleaned.len() - dot <= 16 => (&cleaned[..dot], &cleaned[dot..]),
        _ => (cleaned.as_str(), ""),
    };
    let keep = 120usize.saturating_sub(extension.chars().count());
    format!("{}{}", stem.chars().take(keep).collect::<String>(), extension)
}

/// 在附件文件夹下为本次导入新建一个子文件夹（毫秒时间戳加序号）。
fn new_folder(root: &Path) -> AppResult<PathBuf> {
    let base = root.join(ATTACHMENTS_DIR);
    std::fs::create_dir_all(&base)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    for index in 0..1000 {
        let folder = base.join(format!("{stamp}-{index}"));
        match std::fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(AppError::Other("无法创建附件文件夹".into()))
}

/// 把一段内容（粘贴的截图或文件）写成附件副本。`root` 为应用数据目录。
pub fn import_bytes(root: &Path, name: &str, bytes: &[u8]) -> AppResult<ImportedFile> {
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(AppError::Other("附件超过 100 MB，请保留在原处".into()));
    }
    let name = sanitize_name(name);
    let path = new_folder(root)?.join(&name);
    std::fs::write(&path, bytes)?;
    Ok(ImportedFile {
        name,
        path: path.display().to_string(),
    })
}

/// 把用户选择的文件复制为附件副本，按选择顺序返回；任一文件无法复制时整体失败并删除已复制的副本。
pub fn import_paths(root: &Path, paths: &[String]) -> AppResult<Vec<ImportedFile>> {
    let mut imported: Vec<ImportedFile> = Vec::new();
    let result = (|| -> AppResult<()> {
        for source in paths {
            let source = Path::new(source);
            let meta = std::fs::metadata(source)?;
            if !meta.is_file() {
                return Err(AppError::Other(format!("{} 不是文件", source.display())));
            }
            if meta.len() > MAX_ATTACHMENT_BYTES {
                return Err(AppError::Other(format!("{} 超过 100 MB，请保留在原处", source.display())));
            }
            let name = sanitize_name(&source.file_name().map(|value| value.to_string_lossy().into_owned()).unwrap_or_default());
            let path = new_folder(root)?.join(&name);
            std::fs::copy(source, &path)?;
            imported.push(ImportedFile {
                name,
                path: path.display().to_string(),
            });
        }
        Ok(())
    })();
    if let Err(error) = result {
        for file in &imported {
            if let Some(folder) = Path::new(&file.path).parent() {
                let _ = std::fs::remove_dir_all(folder);
            }
        }
        return Err(error);
    }
    Ok(imported)
}

/// 路径是否位于附件文件夹之内。按实际路径比较（解析链接与 `..`），文件或文件夹不存在时视为不在其中。
pub fn is_inside(root: &Path, path: &Path) -> bool {
    match (std::fs::canonicalize(root), std::fs::canonicalize(path)) {
        (Ok(root), Ok(path)) => path.starts_with(&root) && path != root,
        _ => false,
    }
}

/// 清理结果。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    /// 删除的附件（子文件夹）数。
    pub removed: usize,
    /// 释放的字节数。
    pub freed: u64,
    /// 没有被引用、但仍在保护期内而暂未删除的附件数。
    pub pending: usize,
}

/// 附件文件夹的规模，供设置页显示。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentUsage {
    /// 附件（子文件夹）数。
    pub count: usize,
    /// 全部附件的字节数。
    pub size: u64,
}

/// 文件夹内全部文件的字节数（递归）。
fn folder_size(path: &Path) -> u64 {
    folder_size_within(path, 0)
}

/// 统计时跟随软链接（`fs::metadata` 跟随，`DirEntry::metadata` 在 Windows 上不跟随）；
/// 限制层数，链接指回上级目录时不会无限递归。
fn folder_size_within(path: &Path, depth: usize) -> u64 {
    const MAX_DEPTH: usize = 32;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match std::fs::metadata(entry.path()) {
            Ok(meta) if meta.is_dir() => {
                if depth < MAX_DEPTH {
                    folder_size_within(&entry.path(), depth + 1)
                } else {
                    0
                }
            }
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

/// 统计附件文件夹的规模。`root` 为数据目录。
pub fn usage(root: &Path) -> AttachmentUsage {
    let Ok(entries) = std::fs::read_dir(root.join(ATTACHMENTS_DIR)) else {
        return AttachmentUsage::default();
    };
    entries
        .flatten()
        // is_dir 跟随软链接：指向别处的附件子文件夹也计入。
        .filter(|entry| entry.path().is_dir())
        .fold(AttachmentUsage::default(), |total, entry| AttachmentUsage {
            count: total.count + 1,
            size: total.size + folder_size(&entry.path()),
        })
}

/// 记录原文中是否引用了某个附件子文件夹。
///
/// 导入时每个附件独占一个以毫秒时间戳加序号命名的子文件夹（见 `new_folder`），名称足够独特，
/// 只要原文中出现「分隔符 + 子文件夹名 + 分隔符」即视为引用；不要求整条路径逐字相同，
/// 用户改写过路径的大小写或斜杠方向、写成 file 网址时仍然识别，宁可多留也不误删。
fn referenced(texts: &str, folder: &str) -> bool {
    let folder = folder.to_lowercase();
    ["\\", "/"]
        .iter()
        .any(|separator| texts.contains(&format!("{separator}{folder}{separator}")))
}

/// 删除没有被任何记录引用的附件子文件夹，返回删除数量与释放的空间。
///
/// `root` 为数据目录；`texts` 为全部记录（含回收站，回收站中的记录还能恢复）与草稿的原文，
/// 以及调用方窗口中尚未保存的编辑内容。修改时间距 `now` 不足 `grace` 的子文件夹即使没有引用也保留，
/// 见 [`CLEANUP_GRACE`]。附件文件夹之外的文件一律不动。
pub fn cleanup(root: &Path, texts: &[String], grace: Duration, now: SystemTime) -> AppResult<CleanupReport> {
    let base = root.join(ATTACHMENTS_DIR);
    let entries = match std::fs::read_dir(&base) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(CleanupReport::default()),
        Err(error) => return Err(error.into()),
    };
    let haystack = texts.join("\n").to_lowercase();
    let mut report = CleanupReport::default();
    for entry in entries.flatten() {
        // 只清理真实的子文件夹：file_type 不跟随软链接，链接一律跳过，不会顺着链接删掉别处的文件。
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if referenced(&haystack, &name) {
            continue;
        }
        // 取创建与修改时间中较晚的一个；读不到时间时按刚导入处理，留给下一次。
        let meta = entry.metadata()?;
        let stamp = [meta.created().ok(), meta.modified().ok()].into_iter().flatten().max();
        let fresh = stamp.map_or(true, |time| now.duration_since(time).map(|age| age < grace).unwrap_or(true));
        if fresh {
            report.pending += 1;
            continue;
        }
        let path = entry.path();
        let size = folder_size(&path);
        if std::fs::remove_dir_all(&path).is_ok() {
            report.removed += 1;
            report.freed += size;
        }
    }
    Ok(report)
}

/// 解码标准 base64（忽略空白与结尾的 =），内容无效时返回 None。
///
/// 网页与后端的通道偶尔会回落到 postMessage，这时请求体只能是 JSON，附件内容改以 base64 传入。
pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn value(character: u8) -> Option<u32> {
        match character {
            b'A'..=b'Z' => Some(u32::from(character - b'A')),
            b'a'..=b'z' => Some(u32::from(character - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(character - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let digits: Vec<u8> = input.bytes().filter(|character| !character.is_ascii_whitespace()).collect();
    let digits = digits.strip_suffix(b"==").or_else(|| digits.strip_suffix(b"=")).unwrap_or(&digits);
    let mut out = Vec::with_capacity(digits.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &character in digits {
        buffer = (buffer << 6) | value(character)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// 解码 `encodeURIComponent` 编码的文字（附件名经请求头传入，请求头只能是 ASCII）。
pub fn percent_decode(value: &str) -> String {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-attachments-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_name("报告:2026?.pdf"), "报告_2026_.pdf");
        assert_eq!(sanitize_name("C:\\a\\b\\截图.png"), "截图.png");
        assert_eq!(sanitize_name("  .. "), "附件");
        let long = format!("{}.txt", "长".repeat(200));
        let cleaned = sanitize_name(&long);
        assert_eq!(cleaned.chars().count(), 120);
        assert!(cleaned.ends_with(".txt"));
    }

    #[test]
    fn only_paths_inside_the_folder_are_attachments() {
        let root = temp_root("inside");
        let imported = import_bytes(&root, "a.txt", b"a").expect("写入附件");
        let folder = root.join(ATTACHMENTS_DIR);
        assert!(is_inside(&folder, Path::new(&imported.path)));
        // 借助 .. 跳出附件文件夹、文件夹本身与不存在的文件都不算附件。
        std::fs::write(root.join("outside.txt"), b"x").unwrap();
        assert!(!is_inside(&folder, &folder.join("..").join("outside.txt")));
        assert!(!is_inside(&folder, &folder));
        assert!(!is_inside(&folder, &folder.join("missing.txt")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_removes_only_unreferenced_folders_past_grace() {
        let root = temp_root("cleanup");
        let kept = import_bytes(&root, "kept.png", b"keep").expect("写入附件");
        let upper = import_bytes(&root, "upper.png", b"upper").expect("写入附件");
        let orphan = import_bytes(&root, "orphan.txt", b"orphan-data").expect("写入附件");
        let unsaved = import_bytes(&root, "unsaved.txt", b"new").expect("写入附件");
        // 附件文件夹里的零散文件与数据目录中的其它文件不受影响。
        std::fs::write(root.join(ATTACHMENTS_DIR).join("stray.txt"), b"x").unwrap();
        std::fs::write(root.join("sidenotes.db"), b"db").unwrap();
        let texts = vec![
            format!("![图]({})", kept.path),
            // 用户改写过斜杠方向与大小写的引用也算引用。
            format!("[文件]({})", upper.path.replace('\\', "/").to_uppercase()),
            "无关的记录".to_string(),
        ];
        let day = Duration::from_secs(86_400);

        // 都在保护期内：一个也不删，未引用的两个记为待清理。
        let report = cleanup(&root, &texts, day, SystemTime::now()).expect("清理");
        assert_eq!(report, CleanupReport { removed: 0, freed: 0, pending: 2 });

        // 两天之后：未引用的两个删除，引用中的保留。
        let later = SystemTime::now() + 2 * day;
        let report = cleanup(&root, &texts, day, later).expect("清理");
        assert_eq!(report, CleanupReport { removed: 2, freed: 14, pending: 0 });
        assert!(Path::new(&kept.path).exists());
        assert!(Path::new(&upper.path).exists());
        assert!(!Path::new(&orphan.path).exists());
        assert!(!Path::new(&unsaved.path).exists());
        assert!(root.join(ATTACHMENTS_DIR).join("stray.txt").exists());
        assert!(root.join("sidenotes.db").exists());
        assert_eq!(usage(&root), AttachmentUsage { count: 2, size: 9 });

        // 没有附件文件夹时直接返回。
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(cleanup(&root, &texts, day, later).expect("清理"), CleanupReport::default());
    }

    #[test]
    fn decodes_uri_components() {
        assert_eq!(percent_decode("%E6%88%AA%E5%9B%BE%201.png"), "截图 1.png");
        assert_eq!(percent_decode("plain.txt"), "plain.txt");
        assert_eq!(percent_decode("bad%zz%"), "bad%zz%");
    }

    #[test]
    fn decodes_base64() {
        assert_eq!(base64_decode("aGk=").unwrap(), b"hi");
        assert_eq!(base64_decode("aGVsbG8gd29ybGQ=").unwrap(), b"hello world");
        assert_eq!(base64_decode("AAEC/w==").unwrap(), vec![0, 1, 2, 255]);
        assert_eq!(base64_decode(" aG\nk= ").unwrap(), b"hi");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert!(base64_decode("a*b").is_none());
    }

    #[test]
    fn imports_copies_into_separate_folders() {
        let root = temp_root("import");
        let first = import_bytes(&root, "截图.png", b"one").expect("写入第一份");
        let second = import_bytes(&root, "截图.png", b"two").expect("写入第二份");
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"one");
        assert!(first.path.contains(ATTACHMENTS_DIR));

        let source = root.join("原始.txt");
        std::fs::write(&source, b"content").unwrap();
        let copied = import_paths(&root, &[source.display().to_string()]).expect("复制文件");
        assert_eq!(copied[0].name, "原始.txt");
        // 删除原始文件后副本仍在。
        std::fs::remove_file(&source).unwrap();
        assert_eq!(std::fs::read(&copied[0].path).unwrap(), b"content");

        // 任一文件复制失败时不留下已复制的副本。
        let missing = root.join("不存在.txt").display().to_string();
        let ok = root.join("在.txt");
        std::fs::write(&ok, b"x").unwrap();
        assert!(import_paths(&root, &[ok.display().to_string(), missing]).is_err());
        let folders = std::fs::read_dir(root.join(ATTACHMENTS_DIR)).unwrap().count();
        assert_eq!(folders, 3);
        let _ = std::fs::remove_dir_all(&root);
    }
}
