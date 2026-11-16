//! 路径中的软链接（符号链接、目录联接）解析。
//!
//! 数据目录、快照目录、导出与导入的位置都可能是软链接。读写前先解析到实际位置，
//! 比较、迁移与清理都按实际目录进行：例如把数据目录迁到一个指向原目录的链接时能认出是同一个目录，
//! 删除旧目录时不会顺着链接删掉实际的数据。

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 解析路径中的软链接，返回实际位置。
///
/// 末尾尚不存在的部分（如还没创建的目录或文件）原样接在解析后的上级目录后面；
/// 整条路径都无法解析时原样返回。Windows 上用 dunce 去掉 `\\?\` 前缀，返回常规写法。
/// 相对路径（包括 `E:目录` 这种只带盘符的写法）原样返回：按当前目录补全会把无效的输入变成程序目录下的路径，
/// 由调用方按「不是完整路径」拒绝。
pub fn resolve(path: &Path) -> PathBuf {
    if !path.is_absolute() {
        return path.to_path_buf();
    }
    let mut existing = path.to_path_buf();
    let mut rest: Vec<OsString> = Vec::new();
    loop {
        if let Ok(real) = dunce::canonicalize(&existing) {
            let mut resolved = real;
            for part in rest.iter().rev() {
                resolved.push(part);
            }
            return resolved;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
                rest.push(name.to_os_string());
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// 两个路径解析软链接之后是否指向同一个位置。
pub fn same_location(a: &Path, b: &Path) -> bool {
    let (a, b) = (resolve(a), resolve(b));
    #[cfg(windows)]
    {
        // Windows 的路径不区分大小写。
        a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// `path` 解析软链接之后是否在 `root` 之内（含 `root` 本身）。
pub fn is_within(path: &Path, root: &Path) -> bool {
    let (path, root) = (resolve(path), resolve(root));
    #[cfg(windows)]
    {
        let lower = |p: &Path| PathBuf::from(p.as_os_str().to_string_lossy().to_lowercase());
        lower(&path).starts_with(lower(&root))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(&root)
    }
}

/// 测试用：创建指向目录的软链接；Windows 上没有创建符号链接的权限时退回目录联接（mklink /J，不需要权限）。
/// 都失败时返回 false，调用方跳过需要链接的断言。
#[cfg(test)]
pub(crate) fn link_dir(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sidenotes-paths-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dunce::canonicalize(&dir).unwrap()
    }

    #[test]
    fn resolves_links_and_keeps_missing_tail() {
        let root = temp_dir("resolve");
        let real = root.join("real");
        fs::create_dir_all(&real).unwrap();
        let link = root.join("link");
        if !link_dir(&real, &link) {
            eprintln!("无法创建软链接或目录联接，跳过");
            return;
        }
        // 链接本身、链接下尚不存在的子目录都落到实际目录。
        assert_eq!(resolve(&link), real);
        assert_eq!(resolve(&link.join("data").join("sidenotes.db")), real.join("data").join("sidenotes.db"));
        assert!(same_location(&link, &real));
        assert!(is_within(&link.join("attachments"), &real));
        assert!(!is_within(&root.join("other"), &real));
        let _ = fs::remove_dir(&link);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn relative_paths_stay_relative() {
        // 不能按当前目录补成完整路径，否则无效的输入会被当成程序目录下的一个位置。
        assert_eq!(resolve(Path::new("相对目录")), PathBuf::from("相对目录"));
        #[cfg(windows)]
        assert_eq!(resolve(Path::new("E:SystemTemp")), PathBuf::from("E:SystemTemp"));
    }

    #[test]
    fn plain_paths_are_unchanged() {
        let root = temp_dir("plain");
        assert_eq!(resolve(&root.join("missing").join("file.txt")), root.join("missing").join("file.txt"));
        assert!(same_location(&root, &root.join(".")));
        let _ = fs::remove_dir_all(&root);
    }
}
