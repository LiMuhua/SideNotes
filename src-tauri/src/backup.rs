//! 导出备份：把记录写成 JSON，连同被引用的附件一起导出到用户选择的位置，便于全量导出后自行处理。
//!
//! 导出的文件夹结构：`<名称>/<名称>.json` 与 `<名称>/attachments/<子文件夹>/…`，附件子文件夹与数据目录中的
//! 同名，记录里的路径仍指向原数据目录（JSON 中另记 `dataDirectory`）。导入时把 JSON 旁边 attachments 中的
//! 子文件夹拷回当前数据目录，记录中的路径由前端改写到当前数据目录。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::attachments::{sanitize_name, ATTACHMENTS_DIR};
use crate::error::{AppError, AppResult};
use crate::migration::copy_dir;
use crate::snapshots::referenced_folders;
use crate::store::Store;

/// 导出结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// 导出的文件夹。
    pub directory: String,
    /// 其中的 JSON 文件。
    pub file: String,
    /// 一并导出的附件（子文件夹）数。
    pub attachments: usize,
    /// 记录引用了、但数据目录中已经找不到的附件数。
    pub missing: usize,
}

fn other(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

/// 附件子文件夹名：导入时按毫秒时间戳加序号命名，只含数字与连字符。
fn is_attachment_folder(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|character| character.is_ascii_digit() || character == '-')
}

/// 在 `parent` 下建一个不与已有内容重名的文件夹：重名时依次加上 (2)、(3)……
fn unique_dir(parent: &Path, name: &str) -> AppResult<PathBuf> {
    std::fs::create_dir_all(parent)?;
    for index in 1..1000 {
        let candidate = if index == 1 { parent.join(name) } else { parent.join(format!("{name} ({index})")) };
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(other("导出位置中同名的文件夹太多，请换一个位置"))
}

/// 导出到 `parent` 下名为 `name` 的新文件夹：写入 JSON 内容，复制全部记录（含回收站）与草稿引用的附件。
pub fn export(store: &Store, parent: &Path, name: &str, contents: &str) -> AppResult<ExportReport> {
    if parent.as_os_str().is_empty() || !parent.is_absolute() {
        return Err(other("请选择一个完整的导出位置"));
    }
    let data_dir = store.directory();
    let source = data_dir.join(ATTACHMENTS_DIR);
    // 导出到附件文件夹里会被当作没有引用的附件清理掉。按实际位置判断：经过软链接也不能导出到那里。
    if crate::paths::is_within(parent, &source) {
        return Err(other("不能导出到附件文件夹里，请换一个位置"));
    }
    let name = sanitize_name(name);
    let folder = unique_dir(parent, &name)?;
    let file = folder.join(format!("{name}.json"));
    std::fs::write(&file, contents)?;
    let target = folder.join(ATTACHMENTS_DIR);
    let (mut attachments, mut missing) = (0, 0);
    for attachment in referenced_folders(&store.reference_texts()?) {
        if source.join(&attachment).is_dir() {
            copy_dir(&source.join(&attachment), &target.join(&attachment))?;
            attachments += 1;
        } else {
            missing += 1;
        }
    }
    Ok(ExportReport {
        directory: folder.display().to_string(),
        file: file.display().to_string(),
        attachments,
        missing,
    })
}

/// 导入备份时拷回附件：把 JSON 文件旁边 `folder` 文件夹中的附件子文件夹复制到数据目录，已有的保留不动；
/// 返回新复制的数量。没有这个文件夹（旧版只导出 JSON）时返回 0。
pub fn import_attachments(data_dir: &Path, file: &Path, folder: &str) -> AppResult<usize> {
    if folder.is_empty() || folder.contains(['/', '\\']) || folder == "." || folder == ".." {
        return Err(other("备份中的附件文件夹名称无效"));
    }
    let Some(source) = file.parent().map(|parent| parent.join(folder)) else {
        return Ok(0);
    };
    let Ok(entries) = std::fs::read_dir(&source) else {
        return Ok(0);
    };
    let target = data_dir.join(ATTACHMENTS_DIR);
    let mut copied = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // is_dir 跟随软链接：备份里指向目录的链接也按附件文件夹拷回。
        if !is_attachment_folder(&name) || !entry.path().is_dir() {
            continue;
        }
        if target.join(&name).exists() {
            continue;
        }
        copy_dir(&entry.path(), &target.join(&name))?;
        copied += 1;
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::import_bytes;
    use crate::location::DATABASE_FILE;
    use crate::models::{Draft, Note};
    use std::collections::HashMap;

    fn temp_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-backup-{name}-{}", std::process::id()));
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
    fn exports_json_with_referenced_attachments_into_a_new_folder() {
        let root = temp_root("export");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).expect("打开数据库");
        let kept = import_bytes(&data, "图.png", b"png").expect("写入附件");
        let unused = import_bytes(&data, "没用.txt", b"x").expect("写入附件");
        let draft = Draft { text: "草稿".into(), images: vec![], updated_at: 1 };
        let notes = [note("a", format!("![图]({})", kept.path)), note("b", "[丢失](C:\\Data\\attachments\\1-0\\x.txt)".into())];
        store.save(&notes, &draft, &serde_json::json!({}), &HashMap::new()).expect("写入");
        let parent = root.join("导出");

        let report = export(&store, &parent, "SideNotes-备份-2026-11-03", "{\"notes\":[]}").expect("导出");
        let folder = PathBuf::from(&report.directory);
        assert_eq!(folder, parent.join("SideNotes-备份-2026-11-03"));
        assert_eq!(std::fs::read_to_string(&report.file).unwrap(), "{\"notes\":[]}");
        assert_eq!((report.attachments, report.missing), (1, 1));
        let kept_folder = Path::new(&kept.path).parent().unwrap().file_name().unwrap().to_owned();
        assert_eq!(std::fs::read(folder.join(ATTACHMENTS_DIR).join(&kept_folder).join("图.png")).unwrap(), b"png");
        let unused_folder = Path::new(&unused.path).parent().unwrap().file_name().unwrap().to_owned();
        assert!(!folder.join(ATTACHMENTS_DIR).join(unused_folder).exists());

        // 同一天再导出一次：建一个新文件夹，不覆盖之前的。
        let again = export(&store, &parent, "SideNotes-备份-2026-11-03", "{}").expect("再次导出");
        assert_eq!(PathBuf::from(&again.directory), parent.join("SideNotes-备份-2026-11-03 (2)"));
        // 不能导出到相对路径或附件文件夹里。
        assert!(export(&store, Path::new("相对"), "x", "{}").is_err());
        assert!(export(&store, &data.join(ATTACHMENTS_DIR), "x", "{}").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn imports_attachment_folders_next_to_the_json() {
        let root = temp_root("import");
        let backup = root.join("备份");
        let attachments = backup.join(ATTACHMENTS_DIR);
        std::fs::create_dir_all(attachments.join("1730000000000-0")).unwrap();
        std::fs::write(attachments.join("1730000000000-0").join("图.png"), b"new").unwrap();
        std::fs::create_dir_all(attachments.join("1730000000001-0")).unwrap();
        std::fs::write(attachments.join("1730000000001-0").join("表.txt"), b"backup").unwrap();
        std::fs::create_dir_all(attachments.join("杂项")).unwrap();
        let file = backup.join("SideNotes-备份.json");
        std::fs::write(&file, "{}").unwrap();
        // 数据目录中已有同名子文件夹的保留原样。
        let data = root.join("data");
        std::fs::create_dir_all(data.join(ATTACHMENTS_DIR).join("1730000000001-0")).unwrap();
        std::fs::write(data.join(ATTACHMENTS_DIR).join("1730000000001-0").join("表.txt"), b"local").unwrap();

        assert_eq!(import_attachments(&data, &file, ATTACHMENTS_DIR).expect("拷回附件"), 1);
        assert_eq!(std::fs::read(data.join(ATTACHMENTS_DIR).join("1730000000000-0").join("图.png")).unwrap(), b"new");
        assert_eq!(std::fs::read(data.join(ATTACHMENTS_DIR).join("1730000000001-0").join("表.txt")).unwrap(), b"local");
        assert!(!data.join(ATTACHMENTS_DIR).join("杂项").exists());
        // 旧版备份旁边没有附件文件夹；文件夹名带路径时拒绝。
        assert_eq!(import_attachments(&data, &root.join("旧.json"), ATTACHMENTS_DIR).expect("没有附件"), 0);
        assert!(import_attachments(&data, &file, "..\\x").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
