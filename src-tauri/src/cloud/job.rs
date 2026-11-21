//! 云端同步的备份与恢复：与本机快照同样的结构，放在远程文件夹里。
//!
//! ```text
//! <远程文件夹>/
//!   index.json                 全部备份的说明（最新的在前），恢复与清理按它
//!   database/<编号>.db         数据库的一致副本（VACUUM INTO）
//!   database/<编号>.json       这一份的说明（index.json 丢了时据此重建）
//!   attachments/<子文件夹>/…   附件：每个子文件夹只上传一次，所有备份共用
//! ```
//!
//! 上传顺序是附件、数据库、说明、index.json：中途断了，已有的备份不受影响，下次把缺的补上。
//! 保留规则与本机快照相同（snapshots::retained）；过期的备份删掉后，不再被任何留下的备份引用的附件也删掉。

use std::collections::BTreeSet;
use std::fs::File;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::remote::{Remote, RemoteError, RemoteResult, join};
use crate::attachments::ATTACHMENTS_DIR;
use crate::snapshots::{self, RestoreReport, SnapshotInfo};
use crate::store::Store;

const INDEX: &str = "index.json";
const DATABASE_DIR: &str = "database";

/// 一份云端备份：快照的说明加上数据库的大小。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackup {
    #[serde(flatten)]
    pub info: SnapshotInfo,
    #[serde(default)]
    pub size: u64,
}

fn local(error: impl std::fmt::Display) -> RemoteError {
    RemoteError::Config(format!("本机文件操作失败：{error}"))
}

/// 附件子文件夹名只含数字与连字符（见 attachments::import_bytes）。
fn is_attachment_folder(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|character| character.is_ascii_digit() || character == '-')
}

/// 云端的名字能不能直接当本机的文件名：不含路径分隔，不是 . 或 ..。
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}

fn download_to_vec(remote: &dyn Remote, path: &str) -> RemoteResult<Vec<u8>> {
    let mut bytes = Vec::new();
    remote.download(path, &mut bytes)?;
    Ok(bytes)
}

fn upload_bytes(remote: &dyn Remote, path: &str, bytes: Vec<u8>) -> RemoteResult<()> {
    let size = bytes.len() as u64;
    remote.upload(path, Box::new(std::io::Cursor::new(bytes)), size)
}

fn upload_file(remote: &dyn Remote, path: &str, file: &Path) -> RemoteResult<()> {
    let size = std::fs::metadata(file).map_err(local)?.len();
    remote.upload(path, Box::new(File::open(file).map_err(local)?), size)
}

/// 读远程的 index.json；没有时按 database/*.json 重建，再没有就是空的。
pub fn read_index(remote: &dyn Remote, folder: &str) -> RemoteResult<Vec<CloudBackup>> {
    match download_to_vec(remote, &join(folder, INDEX)) {
        Ok(bytes) => {
            if let Ok(mut backups) = serde_json::from_slice::<Vec<CloudBackup>>(&bytes) {
                backups.sort_by(|left, right| right.info.created_at.cmp(&left.info.created_at));
                return Ok(backups);
            }
        }
        Err(RemoteError::NotFound) => {}
        Err(error) => return Err(error),
    }
    let entries = match remote.list(&join(folder, DATABASE_DIR)) {
        Ok(entries) => entries,
        Err(RemoteError::NotFound) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let names: BTreeSet<String> = entries.iter().map(|entry| entry.name.clone()).collect();
    let mut backups = Vec::new();
    for entry in &entries {
        let Some(id) = entry.name.strip_suffix(".json") else {
            continue;
        };
        if !names.contains(&format!("{id}.db")) {
            continue;
        }
        if let Ok(bytes) = download_to_vec(remote, &join(folder, &format!("{DATABASE_DIR}/{}", entry.name))) {
            if let Ok(backup) = serde_json::from_slice::<CloudBackup>(&bytes) {
                backups.push(backup);
            }
        }
    }
    backups.sort_by(|left, right| right.info.created_at.cmp(&left.info.created_at));
    Ok(backups)
}

fn write_index(remote: &dyn Remote, folder: &str, backups: &[CloudBackup]) -> RemoteResult<()> {
    upload_bytes(remote, &join(folder, INDEX), serde_json::to_vec_pretty(backups).map_err(local)?)
}

/// 把本机的一个附件子文件夹上传到云端（含子文件夹里的文件夹）。
fn upload_dir(remote: &dyn Remote, local_dir: &Path, remote_dir: &str) -> RemoteResult<()> {
    remote.ensure_dir(remote_dir)?;
    for entry in std::fs::read_dir(local_dir).map_err(local)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if path.is_dir() {
            upload_dir(remote, &path, &join(remote_dir, &name))?;
        } else {
            upload_file(remote, &join(remote_dir, &name), &path)?;
        }
    }
    Ok(())
}

/// 把云端的一个文件夹下载到本机。
fn download_dir(remote: &dyn Remote, remote_dir: &str, local_dir: &Path) -> RemoteResult<()> {
    std::fs::create_dir_all(local_dir).map_err(local)?;
    for entry in remote.list(remote_dir)? {
        if !safe_name(&entry.name) {
            continue;
        }
        let target = local_dir.join(&entry.name);
        if entry.is_dir {
            download_dir(remote, &join(remote_dir, &entry.name), &target)?;
        } else {
            let mut file = File::create(&target).map_err(local)?;
            remote.download(&join(remote_dir, &entry.name), &mut file)?;
        }
    }
    Ok(())
}

/// 备份一次：本机数据库的一致副本连同引用的附件上传到远程文件夹 `folder`，再按保留规则清理。`temp_dir` 放临时的数据库副本。
pub fn backup(remote: &dyn Remote, store: &Store, folder: &str, temp_dir: &Path, reason: &str, now: i64) -> RemoteResult<CloudBackup> {
    std::fs::create_dir_all(temp_dir).map_err(local)?;
    let copy = temp_dir.join(format!("backup-{now}.db"));
    let _ = std::fs::remove_file(&copy);
    store.copy_to(&copy).map_err(local)?;
    let result = upload_backup(remote, store, folder, &copy, reason, now);
    let _ = std::fs::remove_file(&copy);
    result
}

fn upload_backup(remote: &dyn Remote, store: &Store, folder: &str, copy: &Path, reason: &str, now: i64) -> RemoteResult<CloudBackup> {
    let (texts, note_count) = snapshots::read_database(copy).map_err(local)?;
    let folders = snapshots::referenced_folders(&texts);
    let attachments_dir = join(folder, ATTACHMENTS_DIR);
    remote.ensure_dir(&join(folder, DATABASE_DIR))?;
    remote.ensure_dir(&attachments_dir)?;
    let mut index = read_index(remote, folder)?;

    // 已经完整上传过的附件：写进了某份备份的说明、又确实还在云端的。
    let present: BTreeSet<String> = remote.list(&attachments_dir)?.into_iter().filter(|entry| entry.is_dir).map(|entry| entry.name).collect();
    let complete: BTreeSet<&str> = index
        .iter()
        .flat_map(|backup| backup.info.attachments.iter().filter(|name| !backup.info.missing.contains(name)).map(String::as_str))
        .filter(|name| present.contains(*name))
        .collect();
    let source = store.directory().join(ATTACHMENTS_DIR);
    let mut missing = Vec::new();
    for name in &folders {
        if complete.contains(name.as_str()) {
            continue;
        }
        if !source.join(name).is_dir() {
            missing.push(name.clone());
            continue;
        }
        upload_dir(remote, &source.join(name), &join(&attachments_dir, name))?;
    }

    // 编号取备份时间，与已有的重了就顺延。
    let mut stamp = now;
    while index.iter().any(|backup| backup.info.id == stamp.to_string()) {
        stamp += 1;
    }
    let id = stamp.to_string();
    let size = std::fs::metadata(copy).map_err(local)?.len();
    upload_file(remote, &join(folder, &format!("{DATABASE_DIR}/{id}.db")), copy)?;
    let backup = CloudBackup {
        info: SnapshotInfo {
            id: id.clone(),
            created_at: now,
            reason: reason.into(),
            data_directory: store.directory().display().to_string(),
            note_count,
            attachments: folders.into_iter().collect(),
            missing,
        },
        size,
    };
    upload_bytes(remote, &join(folder, &format!("{DATABASE_DIR}/{id}.json")), serde_json::to_vec_pretty(&backup).map_err(local)?)?;
    index.insert(0, backup.clone());
    index.sort_by(|left, right| right.info.created_at.cmp(&left.info.created_at));
    let kept = prune(remote, folder, index, now, &present);
    write_index(remote, folder, &kept)?;
    Ok(backup)
}

/// 按保留规则删掉过期的备份与没人引用的附件，返回留下的。删除失败不算备份失败，下次再删。
fn prune(remote: &dyn Remote, folder: &str, index: Vec<CloudBackup>, now: i64, present: &BTreeSet<String>) -> Vec<CloudBackup> {
    let infos: Vec<SnapshotInfo> = index.iter().map(|backup| backup.info.clone()).collect();
    let keep = snapshots::retained(&infos, now);
    let (kept, expired): (Vec<CloudBackup>, Vec<CloudBackup>) = index.into_iter().partition(|backup| keep.contains(&backup.info.id));
    for backup in &expired {
        for extension in ["db", "json"] {
            let _ = remote.delete(&join(folder, &format!("{DATABASE_DIR}/{}.{extension}", backup.info.id)));
        }
    }
    let referenced: BTreeSet<&str> = kept.iter().flat_map(|backup| backup.info.attachments.iter().map(String::as_str)).collect();
    for name in present {
        if is_attachment_folder(name) && !referenced.contains(name.as_str()) {
            let _ = remote.delete(&join(&join(folder, ATTACHMENTS_DIR), name));
        }
    }
    kept
}

/// 从一份云端备份恢复：数据库与本机没有的附件先下载到 `temp_dir`，再照快照恢复（恢复前在本机快照目录 `snapshot_root` 建一份快照）。
pub fn restore(remote: &dyn Remote, store: &Store, folder: &str, id: &str, snapshot_root: &Path, temp_dir: &Path, now: i64) -> RemoteResult<RestoreReport> {
    if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err(RemoteError::Config("备份编号无效".into()));
    }
    let backup = read_index(remote, folder)?
        .into_iter()
        .find(|backup| backup.info.id == id)
        .ok_or_else(|| RemoteError::Config("云端找不到这份备份，可能已被清理".into()))?;
    let work = temp_dir.join(format!("restore-{now}"));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(local)?;
    let result = (|| -> RemoteResult<RestoreReport> {
        let database = work.join(format!("{id}.db"));
        let mut file = File::create(&database).map_err(local)?;
        remote.download(&join(folder, &format!("{DATABASE_DIR}/{id}.db")), &mut file)?;
        drop(file);
        // 本机已经有的附件不下载。
        let attachments = work.join(ATTACHMENTS_DIR);
        let existing = store.directory().join(ATTACHMENTS_DIR);
        for name in &backup.info.attachments {
            if !is_attachment_folder(name) || existing.join(name).is_dir() {
                continue;
            }
            match download_dir(remote, &join(&join(folder, ATTACHMENTS_DIR), name), &attachments.join(name)) {
                Ok(()) | Err(RemoteError::NotFound) => {}
                Err(error) => return Err(error),
            }
        }
        snapshots::restore_external(store, snapshot_root, &database, &backup.info, &attachments, now).map_err(|error| RemoteError::Config(error.to_string()))
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

/// 删掉临时目录里上次中断留下的文件。
pub fn clean_temp(temp_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path: PathBuf = entry.path();
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(&path);
            } else {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// 测试用的云端：本机的一个文件夹。
#[cfg(test)]
pub mod fake {
    use super::*;
    use std::sync::Mutex;

    pub struct LocalRemote {
        pub root: PathBuf,
        /// 记下每个请求，测试检查有没有重复上传。
        pub log: Mutex<Vec<String>>,
    }

    impl LocalRemote {
        pub fn new(root: PathBuf) -> Self {
            std::fs::create_dir_all(&root).unwrap();
            LocalRemote { root, log: Mutex::new(Vec::new()) }
        }

        fn path(&self, path: &str) -> PathBuf {
            self.root.join(path.trim_start_matches('/'))
        }

        pub fn uploads(&self) -> Vec<String> {
            self.log.lock().unwrap().iter().filter_map(|line| line.strip_prefix("PUT ").map(str::to_string)).collect()
        }
    }

    impl Remote for LocalRemote {
        fn account(&self) -> RemoteResult<String> {
            Ok("tester".into())
        }
        fn list(&self, path: &str) -> RemoteResult<Vec<super::super::remote::Entry>> {
            let entries = std::fs::read_dir(self.path(path)).map_err(|_| RemoteError::NotFound)?;
            Ok(entries
                .flatten()
                .map(|entry| super::super::remote::Entry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    is_dir: entry.path().is_dir(),
                    size: entry.metadata().map(|meta| meta.len()).unwrap_or(0),
                })
                .collect())
        }
        fn ensure_dir(&self, path: &str) -> RemoteResult<()> {
            std::fs::create_dir_all(self.path(path)).map_err(local)
        }
        fn upload(&self, path: &str, mut reader: Box<dyn std::io::Read + Send>, _size: u64) -> RemoteResult<()> {
            self.log.lock().unwrap().push(format!("PUT {path}"));
            let mut file = File::create(self.path(path)).map_err(|_| RemoteError::NotFound)?;
            std::io::copy(&mut reader, &mut file).map_err(local)?;
            Ok(())
        }
        fn download(&self, path: &str, target: &mut dyn std::io::Write) -> RemoteResult<u64> {
            let mut file = File::open(self.path(path)).map_err(|_| RemoteError::NotFound)?;
            std::io::copy(&mut file, target).map_err(local)
        }
        fn delete(&self, path: &str) -> RemoteResult<()> {
            self.log.lock().unwrap().push(format!("DELETE {path}"));
            let target = self.path(path);
            if target.is_dir() {
                let _ = std::fs::remove_dir_all(target);
            } else {
                let _ = std::fs::remove_file(target);
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::LocalRemote;
    use super::*;
    use crate::attachments::import_bytes;
    use crate::location::DATABASE_FILE;
    use crate::models::{Draft, Note};
    use std::collections::HashMap;

    const T0: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sidenotes-cloud-{name}-{}", std::process::id()));
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

    fn save(store: &Store, notes: &[Note]) {
        let draft = Draft { text: String::new(), images: vec![], updated_at: 1 };
        store.save(notes, &draft, &serde_json::json!({}), &HashMap::new()).unwrap();
    }

    #[test]
    fn backs_up_uploads_each_attachment_once_and_restores() {
        let root = temp_root("roundtrip");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).unwrap();
        let picture = import_bytes(&data, "图.png", b"png-bytes").unwrap();
        save(&store, &[note("a", format!("![图]({})", picture.path)), note("b", "第二条".into())]);
        let remote = LocalRemote::new(root.join("remote"));
        let temp = root.join("temp");

        let first = backup(&remote, &store, "/Test", &temp, "manual", T0).unwrap();
        assert_eq!(first.info.note_count, 2);
        assert_eq!(first.info.attachments.len(), 1);
        assert!(first.size > 0);
        let folder_name = &first.info.attachments[0];
        assert!(remote.root.join("Test/attachments").join(folder_name).join("图.png").is_file());
        assert!(remote.root.join(format!("Test/database/{}.db", first.info.id)).is_file());
        assert!(remote.root.join("Test/index.json").is_file());
        assert!(!temp.join(format!("backup-{T0}.db")).exists(), "临时副本删掉");

        // 第二次备份：附件已经在云端，不再上传。
        remote.log.lock().unwrap().clear();
        let second = backup(&remote, &store, "/Test", &temp, "auto", T0 + 60_000).unwrap();
        assert!(remote.uploads().iter().all(|path| !path.contains("/attachments/")), "{:?}", remote.uploads());
        let index = read_index(&remote, "/Test").unwrap();
        assert_eq!(index.iter().map(|backup| backup.info.id.clone()).collect::<Vec<_>>(), vec![second.info.id.clone(), first.info.id.clone()]);

        // 改动记录、删掉本机的附件，再从第一份恢复：记录回来，附件从云端下载回来，恢复前在本机快照目录建了一份。
        save(&store, &[note("c", "后来写的".into())]);
        std::fs::remove_dir_all(data.join(ATTACHMENTS_DIR).join(folder_name)).unwrap();
        let snapshots_dir = data.join(crate::snapshots::SNAPSHOTS_DIR);
        let report = restore(&remote, &store, "/Test", &first.info.id, &snapshots_dir, &temp, T0 + 120_000).unwrap();
        assert_eq!(report.notes, 2);
        assert_eq!(report.restored_attachments, 1);
        assert_eq!(std::fs::read(data.join(ATTACHMENTS_DIR).join(folder_name).join("图.png")).unwrap(), b"png-bytes");
        let texts: Vec<String> = store.load().unwrap().notes.iter().map(|note| note.text.clone()).collect();
        assert!(texts.iter().any(|text| text == "第二条"));
        assert!(snapshots_dir.join("database").join(format!("{}.db", report.backup)).is_file());
        assert!(!temp.join(format!("restore-{}", T0 + 120_000)).exists(), "临时目录删掉");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn re_uploads_an_attachment_that_disappeared_from_the_cloud() {
        let root = temp_root("reupload");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).unwrap();
        let file = import_bytes(&data, "表.txt", b"x").unwrap();
        save(&store, &[note("a", format!("[表]({})", file.path))]);
        let remote = LocalRemote::new(root.join("remote"));
        let first = backup(&remote, &store, "/", &root.join("temp"), "manual", T0).unwrap();
        std::fs::remove_dir_all(remote.root.join("attachments").join(&first.info.attachments[0])).unwrap();
        backup(&remote, &store, "/", &root.join("temp"), "manual", T0 + 1000).unwrap();
        assert!(remote.root.join("attachments").join(&first.info.attachments[0]).join("表.txt").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn prunes_old_backups_and_unreferenced_attachments() {
        let root = temp_root("prune");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).unwrap();
        let old = import_bytes(&data, "旧.txt", b"old").unwrap();
        save(&store, &[note("a", format!("[旧]({})", old.path))]);
        let remote = LocalRemote::new(root.join("remote"));
        let temp = root.join("temp");
        let first = backup(&remote, &store, "/Test", &temp, "auto", T0).unwrap();
        // 之后的记录不再引用旧附件；过了 40 天、又备份了 3 次以上，第一份过期，旧附件随之删掉。
        save(&store, &[note("b", "新的".into())]);
        for day in 40..44 {
            backup(&remote, &store, "/Test", &temp, "auto", T0 + day * DAY).unwrap();
        }
        let index = read_index(&remote, "/Test").unwrap();
        assert!(index.iter().all(|backup| backup.info.id != first.info.id));
        assert!(!remote.root.join(format!("Test/database/{}.db", first.info.id)).exists());
        assert!(!remote.root.join("Test/attachments").join(&first.info.attachments[0]).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rebuilds_the_index_from_the_per_backup_files() {
        let root = temp_root("rebuild");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).unwrap();
        save(&store, &[note("a", "一".into())]);
        let remote = LocalRemote::new(root.join("remote"));
        let first = backup(&remote, &store, "/Test", &root.join("temp"), "manual", T0).unwrap();
        std::fs::remove_file(remote.root.join("Test/index.json")).unwrap();
        let index = read_index(&remote, "/Test").unwrap();
        assert_eq!(index, vec![first]);
        assert!(read_index(&remote, "/Empty").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_bad_backup_ids_and_unsafe_names() {
        let root = temp_root("ids");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).unwrap();
        let remote = LocalRemote::new(root.join("remote"));
        assert!(restore(&remote, &store, "/", "../x", &data.join("s"), &root.join("t"), T0).is_err());
        assert!(!safe_name(".."));
        assert!(!safe_name("a/b"));
        assert!(safe_name("图.png"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
