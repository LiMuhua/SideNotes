//! 附件文件。
//!
//! 粘贴的截图与引用的文件都复制一份到应用数据目录的 attachments 文件夹中维护，
//! 记录只引用这份副本：原始文件移动、改名或删除后，引用仍然有效。
//! 每次导入放在独立的子文件夹里，文件保留原名，同名文件互不覆盖。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// 应用数据目录下存放附件副本的文件夹。
pub const ATTACHMENTS_DIR: &str = "attachments";
/// 单个附件的大小上限：附件随数据目录一起备份与迁移，过大的文件应保留在原处。
const MAX_ATTACHMENT_BYTES: u64 = 100 * 1024 * 1024;

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
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => folder_size(&entry.path()),
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
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .fold(AttachmentUsage::default(), |total, entry| AttachmentUsage {
            count: total.count + 1,
            size: total.size + folder_size(&entry.path()),
        })
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
    fn decodes_uri_components() {
        assert_eq!(percent_decode("%E6%88%AA%E5%9B%BE%201.png"), "截图 1.png");
        assert_eq!(percent_decode("plain.txt"), "plain.txt");
        assert_eq!(percent_decode("bad%zz%"), "bad%zz%");
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
