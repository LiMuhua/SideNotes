//! 更换数据存储位置：把数据库与附件复制到新目录，改写记录中的附件路径，再改用新位置的数据库。
//!
//! 原目录保持不动，作为备份；新目录里已有 SideNotes 数据库时先改名保留，不覆盖。
//! 复制或改写途中出错时仍使用原来的数据库，新目录中已复制的内容留给用户处理。

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::attachments::ATTACHMENTS_DIR;
use crate::error::{AppError, AppResult};
use crate::location::DATABASE_FILE;
use crate::store::Store;

/// 迁移结果。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    /// 新的数据目录。
    pub directory: String,
    /// 复制的附件（子文件夹）数。
    pub attachments: usize,
    /// 改写了附件路径的记录与草稿数。
    pub rewritten: usize,
    /// 新目录中原有的数据库改名后的路径；没有时为空。
    pub backup: String,
}

fn other(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

/// 递归复制文件夹，目标中已经存在的文件不覆盖。
fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if !target.exists() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 复制附件文件夹，返回新复制的子文件夹数；新目录中同名的子文件夹（导入时间相同）保留原样。
fn copy_attachments(from: &Path, to: &Path) -> AppResult<usize> {
    let entries = match std::fs::read_dir(from) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    std::fs::create_dir_all(to)?;
    let mut copied = 0;
    for entry in entries {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            if !target.exists() {
                copied += 1;
            }
            copy_dir(&entry.path(), &target)?;
        } else if !target.exists() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(copied)
}

/// 数据目录中附件文件夹的路径前缀（带结尾的分隔符），反斜杠与斜杠两种写法各一份。
fn prefixes(directory: &Path) -> [String; 2] {
    let base = directory.join(ATTACHMENTS_DIR).display().to_string();
    [format!("{}\\", base.replace('/', "\\")), format!("{}/", base.replace('\\', "/"))]
}

/// 把新数据库中指向原附件文件夹的路径改成新附件文件夹，返回改动的记录与草稿数。
///
/// 导入附件时写入的是「数据目录\attachments\子文件夹\文件名」的完整路径，前缀与当前数据目录逐字相同，
/// 按前缀替换即可；用户手工改写过大小写或斜杠方向的路径不改写，原目录保留，这些引用仍能找到文件。
fn rewrite_paths(database: &Path, from: &Path, to: &Path) -> AppResult<usize> {
    let connection = Connection::open(database)?;
    let mut changed = 0;
    for (old, new) in prefixes(from).iter().zip(prefixes(to).iter()) {
        for table in ["notes", "drafts"] {
            changed += connection.execute(
                &format!("UPDATE {table} SET text = REPLACE(text, ?1, ?2) WHERE instr(text, ?1) > 0"),
                params![old, new],
            )?;
        }
    }
    Ok(changed)
}

/// 新目录中已有数据库时改名保留（连同 WAL 文件），返回改名后的路径。
fn keep_existing(target: &Path) -> AppResult<Option<PathBuf>> {
    let database = target.join(DATABASE_FILE);
    if !database.exists() {
        return Ok(None);
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let renamed = target.join(format!("{DATABASE_FILE}.bak-{stamp}"));
    std::fs::rename(&database, &renamed)?;
    for suffix in ["-wal", "-shm"] {
        let side = target.join(format!("{DATABASE_FILE}{suffix}"));
        if side.exists() {
            std::fs::rename(&side, target.join(format!("{DATABASE_FILE}.bak-{stamp}{suffix}")))?;
        }
    }
    Ok(Some(renamed))
}

/// 两个目录相同或一个位于另一个之内时给出原因。
fn overlap(source: &Path, target: &Path) -> Option<AppError> {
    if source == target {
        Some(other("数据已经保存在这个目录"))
    } else if target.starts_with(source) || source.starts_with(target) {
        Some(other("目标目录不能位于当前数据目录之内，也不能包含它"))
    } else {
        None
    }
}

/// 把数据迁移到 `target` 并改用那里的数据库。
pub fn migrate(store: &Store, target: &Path) -> AppResult<MigrationReport> {
    if target.as_os_str().is_empty() || !target.is_absolute() {
        return Err(other("请选择一个完整的目标目录"));
    }
    let source = store.directory();
    // 先按字面判断，避免为无效的目标建出空目录；建好后再按实际路径判断一次（目录可能经过链接）。
    if let Some(error) = overlap(&source, target) {
        return Err(error);
    }
    std::fs::create_dir_all(target)?;
    if let Some(error) = overlap(&std::fs::canonicalize(&source)?, &std::fs::canonicalize(target)?) {
        return Err(error);
    }
    // 先确认可以写入，避免复制到一半才失败。
    let probe = target.join(".sidenotes-write-test");
    std::fs::write(&probe, b"ok").map_err(|error| other(format!("目标目录无法写入：{error}")))?;
    let _ = std::fs::remove_file(&probe);

    let backup = keep_existing(target)?;
    let database = target.join(DATABASE_FILE);
    store.copy_to(&database)?;
    let attachments = copy_attachments(&source.join(ATTACHMENTS_DIR), &target.join(ATTACHMENTS_DIR))?;
    let rewritten = rewrite_paths(&database, &source, target)?;
    store.relocate(&database)?;
    Ok(MigrationReport {
        directory: target.display().to_string(),
        attachments,
        rewritten,
        backup: backup.map(|path| path.display().to_string()).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Draft, Note};
    use std::collections::HashMap;

    fn temp_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-migration-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn note(id: &str, text: String) -> Note {
        Note {
            id: id.into(),
            text,
            emoji: "📝".into(),
            images: vec![],
            pinned: false,
            collapsed: false,
            status: "active".into(),
            previous_status: "active".into(),
            order: None,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
        }
    }

    #[test]
    fn copies_data_rewrites_paths_and_switches_to_the_new_directory() {
        let root = temp_root("move");
        let source = root.join("旧目录");
        let target = root.join("新 目录");
        let store = Store::open(&source.join(DATABASE_FILE)).expect("打开数据库");

        // 附件副本与引用它的记录、草稿。
        let file = source.join(ATTACHMENTS_DIR).join("1-0").join("图.png");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"png").unwrap();
        let reference = format!("![图]({})", file.display());
        let draft = Draft { text: format!("草稿 [图]({})", file.display()), images: vec![], updated_at: 1 };
        store
            .save(&[note("a", reference.clone()), note("b", "无附件".into())], &draft, &serde_json::json!({}), &HashMap::new())
            .expect("写入");
        // 新目录里已有一个数据库：改名保留。
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join(DATABASE_FILE), b"old").unwrap();

        let report = migrate(&store, &target).expect("迁移");
        assert_eq!(report.attachments, 1);
        assert_eq!(report.rewritten, 2);
        assert!(report.backup.contains(".bak-"));
        assert_eq!(std::fs::read(&report.backup).unwrap(), b"old");

        // 之后的读写都在新目录。
        assert_eq!(store.path(), target.join(DATABASE_FILE));
        let moved = target.join(ATTACHMENTS_DIR).join("1-0").join("图.png");
        let snapshot = store.load().expect("读取");
        let text = &snapshot.notes.iter().find(|item| item.id == "a").unwrap().text;
        assert_eq!(text, &format!("![图]({})", moved.display()));
        assert!(snapshot.draft.text.contains(&moved.display().to_string()));
        assert_eq!(std::fs::read(&moved).unwrap(), b"png");
        store
            .save(&snapshot.notes, &snapshot.draft, &serde_json::json!({ "theme": "dark" }), &HashMap::new())
            .expect("写入新目录");

        // 原目录保持不动，作为备份。
        assert!(file.exists());
        let old = Store::open(&source.join(DATABASE_FILE)).expect("打开原数据库");
        assert_eq!(old.load().unwrap().notes.iter().find(|item| item.id == "a").unwrap().text, reference);
        drop(old);
        drop(store);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_the_same_or_nested_directories() {
        let root = temp_root("refuse");
        let source = root.join("data");
        let store = Store::open(&source.join(DATABASE_FILE)).expect("打开数据库");
        assert!(migrate(&store, &source).is_err());
        assert!(migrate(&store, &source.join("子目录")).is_err());
        assert!(!source.join("子目录").exists());
        assert!(migrate(&store, &root).is_err());
        assert!(migrate(&store, Path::new("相对路径")).is_err());
        assert_eq!(store.path(), source.join(DATABASE_FILE));
        drop(store);
        let _ = std::fs::remove_dir_all(&root);
    }
}
