//! 数据目录的位置。
//!
//! 设置中的「存储位置」保存在数据库里，而打开数据库之前就得知道它在哪里，
//! 所以另在系统应用数据目录写一个 location.json 记下当前的数据目录；没有这个文件时使用系统应用数据目录。
//! 记下的目录不可用（移动硬盘未接入、目录被删除）时暂时改用系统应用数据目录，并告知设置页，
//! 不会在那里新建一个空数据库。目录是软链接（符号链接、目录联接）时按实际位置记下与使用（见 paths）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// 记录数据目录的文件，固定放在系统应用数据目录中。
const LOCATION_FILE: &str = "location.json";
/// 数据库文件名。
pub const DATABASE_FILE: &str = "sidenotes.db";
/// 便携模式下数据目录的名称：放在程序所在的文件夹中。
const PORTABLE_DIR: &str = "SideNotesData";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationConfig {
    data_dir: String,
}

/// 启动时选定的数据目录。
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    /// 实际使用的数据目录。
    pub directory: PathBuf,
    /// 记下的目录不可用、暂时改用默认目录时，为原来记下的目录。
    pub unavailable: Option<PathBuf>,
}

/// 读取记下的数据目录。没有记录时使用 `default_dir`；记下的目录里没有数据库时同样使用 `default_dir`，
/// 并在 `unavailable` 中给出原来的目录。
pub fn resolve(default_dir: &Path) -> Resolved {
    let fallback = |unavailable: Option<PathBuf>| Resolved { directory: default_dir.to_path_buf(), unavailable };
    let Ok(raw) = std::fs::read_to_string(default_dir.join(LOCATION_FILE)) else {
        return fallback(None);
    };
    let Ok(config) = serde_json::from_str::<LocationConfig>(&raw) else {
        return fallback(None);
    };
    if config.data_dir.trim().is_empty() {
        return fallback(None);
    }
    let directory = crate::paths::resolve(Path::new(&config.data_dir));
    if crate::paths::same_location(&directory, default_dir) {
        return fallback(None);
    }
    if directory.join(DATABASE_FILE).is_file() {
        Resolved { directory, unavailable: None }
    } else {
        fallback(Some(directory))
    }
}

/// location.json 中记下的原始写法（未解析软链接）；没有记录时为 None。
pub fn recorded(default_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(default_dir.join(LOCATION_FILE)).ok()?;
    let config = serde_json::from_str::<LocationConfig>(&raw).ok()?;
    (!config.data_dir.trim().is_empty()).then(|| PathBuf::from(config.data_dir))
}

/// 记下新的数据目录；改回系统应用数据目录时删除记录文件。
pub fn remember(default_dir: &Path, data_dir: &Path) -> AppResult<()> {
    let file = default_dir.join(LOCATION_FILE);
    let data_dir = crate::paths::resolve(data_dir);
    if crate::paths::same_location(&data_dir, default_dir) {
        match std::fs::remove_file(&file) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => return Ok(()),
        }
    }
    std::fs::create_dir_all(default_dir)?;
    let config = LocationConfig {
        data_dir: data_dir.display().to_string(),
    };
    std::fs::write(file, serde_json::to_string_pretty(&config)?)?;
    Ok(())
}

/// 便携模式的数据目录：程序所在文件夹下的 SideNotesData。
pub fn portable_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|folder| folder.join(PORTABLE_DIR)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-location-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn remembers_and_resolves_the_data_directory() {
        let root = temp_root("resolve");
        let default_dir = root.join("default");
        let custom = root.join("自定义 目录");
        std::fs::create_dir_all(&custom).unwrap();

        // 没有记录时使用默认目录。
        assert_eq!(resolve(&default_dir), Resolved { directory: default_dir.clone(), unavailable: None });

        // 记下的目录里有数据库时使用它。
        remember(&default_dir, &custom).unwrap();
        std::fs::write(custom.join(DATABASE_FILE), b"db").unwrap();
        assert_eq!(resolve(&default_dir), Resolved { directory: custom.clone(), unavailable: None });

        // 数据库不在了：暂时改用默认目录，并给出原来的目录。
        std::fs::remove_file(custom.join(DATABASE_FILE)).unwrap();
        assert_eq!(
            resolve(&default_dir),
            Resolved { directory: default_dir.clone(), unavailable: Some(custom.clone()) }
        );

        // 改回默认目录时删除记录文件。
        remember(&default_dir, &default_dir).unwrap();
        assert!(!default_dir.join(LOCATION_FILE).exists());
        assert_eq!(resolve(&default_dir).unavailable, None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
