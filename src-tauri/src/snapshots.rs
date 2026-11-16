//! 数据快照：定期把数据库复制一份，附件只增量备份一次，所有快照共用。
//!
//! 快照目录默认是数据目录下的 snapshots 文件夹，可以在设置中改到别处（建议放在另一块硬盘上）：
//! - `database/<编号>.db`：用 `VACUUM INTO` 生成的一致副本；同名的 `.json` 记下创建时间、原因、
//!   当时的数据目录、记录条数，以及这份快照引用的附件子文件夹。
//! - `attachments/<子文件夹>/`：附件副本。附件导入后不再修改，每个子文件夹只复制一次，
//!   已有的不再复制，也从不覆盖：数据目录中的文件损坏或被删除，不会波及备份。
//!
//! 保留规则见 [`retained`]；删除过期的快照后，不再被任何保留下来的快照引用的附件副本随之删除。
//! 数据目录中的附件清理（见 `attachments::cleanup`）只看当前记录：快照引用的附件在备份中另有一份，
//! 恢复快照时拷回数据目录。

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::attachments::ATTACHMENTS_DIR;
use crate::error::{AppError, AppResult};
use crate::location::DATABASE_FILE;
use crate::migration::{copy_dir, rewrite_paths};
use crate::store::Store;

/// 默认的快照目录名，位于数据目录之下。
pub const SNAPSHOTS_DIR: &str = "snapshots";
/// 快照目录中存放数据库快照的文件夹。
const DATABASE_DIR: &str = "database";
const DAY_MS: i64 = 86_400_000;
/// 不论多久没有使用，最新的这几份快照总是保留。
const KEEP_LATEST: usize = 3;
/// 创建快照时可以写明的原因；自动快照与恢复前的快照由后端自己写入。
const REASONS: [&str; 4] = ["manual", "import", "delete", "migrate"];

/// 侧栏的定时检查、设置页的手动操作与导入前的快照可能同时进行，复制附件与清理过期快照逐个执行。
static LOCK: Mutex<()> = Mutex::new(());

/// 一份快照的说明，与数据库快照同名保存为 `.json`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    /// 编号，取创建时的毫秒时间戳，同时是文件名。
    pub id: String,
    pub created_at: i64,
    /// 创建原因：auto（每天自动）、manual、import、delete、migrate、restore（恢复前）。
    pub reason: String,
    /// 创建时的数据目录，恢复时据此改写记录中的附件路径。
    pub data_directory: String,
    /// 记录条数（含回收站）。
    pub note_count: i64,
    /// 引用的附件子文件夹名。
    pub attachments: Vec<String>,
    /// 引用了、但数据目录与备份中都找不到的附件子文件夹。
    #[serde(default)]
    pub missing: Vec<String>,
}

/// 设置页列表中的一份快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    #[serde(flatten)]
    pub info: SnapshotInfo,
    /// 数据库快照文件的字节数。
    pub size: u64,
}

/// 快照目录的概况。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotOverview {
    pub directory: String,
    /// 按创建时间从新到旧排列。
    pub snapshots: Vec<SnapshotEntry>,
    /// 备份的附件子文件夹数与总字节数。
    pub attachment_count: usize,
    pub attachment_size: u64,
}

/// 恢复结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    /// 恢复前为当前数据创建的快照编号。
    pub backup: String,
    /// 恢复后的记录条数（含回收站）。
    pub notes: i64,
    /// 从备份中拷回数据目录的附件数。
    pub restored_attachments: usize,
    /// 快照引用了、但备份中也找不到的附件数。
    pub missing_attachments: usize,
}

fn other(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

/// 当前的毫秒时间戳。
pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// 原文中引用的附件子文件夹：路径里紧跟在 attachments 文件夹之后、由数字与连字符组成的一段
/// （导入时按毫秒时间戳加序号命名）。斜杠方向、大小写与 file 网址的写法都能识别。
pub fn referenced_folders(texts: &[String]) -> BTreeSet<String> {
    let is_separator = |character: char| character == '\\' || character == '/';
    let mut folders = BTreeSet::new();
    for text in texts {
        // 子文件夹名只含 ASCII 数字与连字符，转成小写不影响取出的内容。
        let lower = text.to_lowercase();
        let mut rest = lower.as_str();
        while let Some(at) = rest.find(ATTACHMENTS_DIR) {
            rest = &rest[at + ATTACHMENTS_DIR.len()..];
            let Some(after) = rest.strip_prefix(is_separator) else {
                continue;
            };
            let name: String = after.chars().take_while(|character| character.is_ascii_digit() || *character == '-').collect();
            if name.chars().any(|character| character.is_ascii_digit()) && after[name.len()..].starts_with(is_separator) {
                folders.insert(name);
            }
        }
    }
    folders
}

/// 读取数据库文件中全部记录与草稿的原文，以及记录条数。
fn read_database(path: &Path) -> AppResult<(Vec<String>, i64)> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut statement = connection.prepare("SELECT text FROM notes UNION ALL SELECT text FROM drafts")?;
    let texts = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let count = connection.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
    Ok((texts, count))
}

/// 快照目录按字面检查：不能是数据目录本身，也不能位于数据目录的附件文件夹之内，
/// 否则备份的 attachments 文件夹会与数据目录的附件文件夹重叠，清理时互相删除。
fn check_literal(root: &Path, data_dir: &Path) -> AppResult<()> {
    if root.as_os_str().is_empty() || !root.is_absolute() {
        return Err(other("请选择一个完整的快照目录"));
    }
    if root == data_dir || root.starts_with(data_dir.join(ATTACHMENTS_DIR)) {
        return Err(other("快照目录不能是数据目录本身，也不能放在附件文件夹里"));
    }
    Ok(())
}

/// 建好快照目录，再按实际路径检查一次（目录可能经过链接）。先按字面检查，避免为无效的目录建出空文件夹。
fn prepare_root(root: &Path, data_dir: &Path) -> AppResult<()> {
    check_literal(root, data_dir)?;
    std::fs::create_dir_all(root.join(DATABASE_DIR))?;
    std::fs::create_dir_all(root.join(ATTACHMENTS_DIR))?;
    check_literal(&std::fs::canonicalize(root)?, &std::fs::canonicalize(data_dir)?)
}

/// 读取快照目录中的全部快照（说明文件与数据库快照都在的），按创建时间从新到旧排列。
fn list(root: &Path) -> Vec<SnapshotInfo> {
    let Ok(entries) = std::fs::read_dir(root.join(DATABASE_DIR)) else {
        return Vec::new();
    };
    let mut infos: Vec<SnapshotInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? != "json" {
                return None;
            }
            let info: SnapshotInfo = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
            path.with_extension("db").is_file().then_some(info)
        })
        .collect();
    infos.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    infos
}

/// 要保留的快照编号（`infos` 按创建时间从新到旧排列）：最近 24 小时内的全部保留；1 至 7 天前每天保留
/// 最新的一份；7 至 35 天前每周保留最新的一份；不论多久没有使用，最新的 3 份总是保留。
fn retained(infos: &[SnapshotInfo], now: i64) -> BTreeSet<String> {
    let mut days = BTreeSet::new();
    let mut weeks = BTreeSet::new();
    let mut keep = BTreeSet::new();
    for (index, info) in infos.iter().enumerate() {
        let age = (now - info.created_at).max(0);
        let day = (DAY_MS..7 * DAY_MS).contains(&age) && days.insert(age / DAY_MS);
        let week = (7 * DAY_MS..35 * DAY_MS).contains(&age) && weeks.insert(age / (7 * DAY_MS));
        if index < KEEP_LATEST || age < DAY_MS || day || week {
            keep.insert(info.id.clone());
        }
    }
    keep
}

/// 删除数据库文件及其 WAL 文件，失败时忽略。
fn remove_database_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let mut side = path.as_os_str().to_owned();
        side.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(side));
    }
}

/// 复制一个附件子文件夹：先复制到临时名称，完成后再改名，中途失败不留下不完整的副本。
fn copy_folder(from: &Path, to: &Path) -> AppResult<()> {
    let partial = to.with_extension("part");
    let _ = std::fs::remove_dir_all(&partial);
    let result = copy_dir(from, &partial).and_then(|()| std::fs::rename(&partial, to).map_err(AppError::from));
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&partial);
    }
    result
}

/// 写入快照说明：先写临时文件再改名，说明文件要么完整、要么不存在。
fn write_info(database_dir: &Path, info: &SnapshotInfo) -> AppResult<()> {
    let partial = database_dir.join(format!("{}.json.part", info.id));
    std::fs::write(&partial, serde_json::to_vec_pretty(info)?)?;
    std::fs::rename(&partial, database_dir.join(format!("{}.json", info.id)))?;
    Ok(())
}

/// 创建一份快照，并把它引用、备份中还没有的附件子文件夹复制过去；不清理过期的快照。
fn create_unpruned(store: &Store, root: &Path, reason: &str, now: i64) -> AppResult<SnapshotInfo> {
    let database_dir = root.join(DATABASE_DIR);
    let backup_dir = root.join(ATTACHMENTS_DIR);
    // 编号取创建时间；同一毫秒已有快照时顺延。
    let mut stamp = now;
    while database_dir.join(format!("{stamp}.db")).exists() || database_dir.join(format!("{stamp}.json")).exists() {
        stamp += 1;
    }
    let id = stamp.to_string();
    let database = database_dir.join(format!("{id}.db"));
    let partial = database_dir.join(format!("{id}.db.part"));
    remove_database_files(&partial);
    store.copy_to(&partial)?;
    std::fs::rename(&partial, &database)?;

    let (texts, note_count) = read_database(&database)?;
    let data_dir = store.directory();
    let source = data_dir.join(ATTACHMENTS_DIR);
    let folders = referenced_folders(&texts);
    let mut missing = Vec::new();
    for folder in &folders {
        if backup_dir.join(folder).is_dir() {
            continue;
        }
        if !source.join(folder).is_dir() || copy_folder(&source.join(folder), &backup_dir.join(folder)).is_err() {
            missing.push(folder.clone());
        }
    }
    let info = SnapshotInfo {
        id,
        created_at: now,
        reason: reason.into(),
        data_directory: data_dir.display().to_string(),
        note_count,
        attachments: folders.into_iter().collect(),
        missing,
    };
    write_info(&database_dir, &info)?;
    Ok(info)
}

/// 按保留规则删除过期的快照，再删除不再被任何保留下来的快照引用的附件副本与中断留下的临时文件。
fn prune(root: &Path, now: i64) {
    let infos = list(root);
    let keep = retained(&infos, now);
    let database_dir = root.join(DATABASE_DIR);
    for info in infos.iter().filter(|info| !keep.contains(&info.id)) {
        remove_database_files(&database_dir.join(format!("{}.db", info.id)));
        let _ = std::fs::remove_file(database_dir.join(format!("{}.json", info.id)));
    }
    if let Ok(entries) = std::fs::read_dir(&database_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|extension| extension == "part") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let referenced: BTreeSet<&str> = infos
        .iter()
        .filter(|info| keep.contains(&info.id))
        .flat_map(|info| info.attachments.iter().map(String::as_str))
        .collect();
    if let Ok(entries) = std::fs::read_dir(root.join(ATTACHMENTS_DIR)) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) && !referenced.contains(name.as_str()) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// 快照目录的概况；目录还不存在时列表为空。
pub fn overview(root: &Path, data_dir: &Path) -> AppResult<SnapshotOverview> {
    check_literal(root, data_dir)?;
    let database_dir = root.join(DATABASE_DIR);
    let snapshots = list(root)
        .into_iter()
        .map(|info| {
            let size = std::fs::metadata(database_dir.join(format!("{}.db", info.id))).map_or(0, |meta| meta.len());
            SnapshotEntry { info, size }
        })
        .collect();
    let usage = crate::attachments::usage(root);
    Ok(SnapshotOverview {
        directory: root.display().to_string(),
        snapshots,
        attachment_count: usage.count,
        attachment_size: usage.size,
    })
}

/// 立即创建一份快照，再清理过期的快照。原因不在约定之内时记为 manual。
pub fn create(store: &Store, root: &Path, reason: &str, now: i64) -> AppResult<SnapshotInfo> {
    let _guard = LOCK.lock().map_err(|_| other("快照状态异常，请重启应用"))?;
    prepare_root(root, &store.directory())?;
    let reason = if REASONS.contains(&reason) { reason } else { "manual" };
    let info = create_unpruned(store, root, reason, now)?;
    prune(root, now);
    Ok(info)
}

/// 距最新一份快照超过一天时创建新的一份（原因记为 auto），否则返回 None。
pub fn auto(store: &Store, root: &Path, now: i64) -> AppResult<Option<SnapshotInfo>> {
    let _guard = LOCK.lock().map_err(|_| other("快照状态异常，请重启应用"))?;
    if list(root).first().is_some_and(|latest| now - latest.created_at < DAY_MS) {
        return Ok(None);
    }
    prepare_root(root, &store.directory())?;
    let info = create_unpruned(store, root, "auto", now)?;
    prune(root, now);
    Ok(Some(info))
}

/// 从快照恢复：先为当前数据创建一份快照（恢复后可以换回），再用快照中的记录（含回收站、图片与标签
/// 使用记录）替换当前记录，设置与草稿保持不变；记录中的附件路径改写到当前数据目录，数据目录中已经
/// 没有的附件从备份拷回。
pub fn restore(store: &Store, root: &Path, id: &str, now: i64) -> AppResult<RestoreReport> {
    if id.is_empty() || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err(other("快照编号无效"));
    }
    let _guard = LOCK.lock().map_err(|_| other("快照状态异常，请重启应用"))?;
    let data_dir = store.directory();
    prepare_root(root, &data_dir)?;
    let info = list(root)
        .into_iter()
        .find(|info| info.id == id)
        .ok_or_else(|| other("找不到这份快照，可能已被清理"))?;
    // 恢复前的快照先不清理旧快照，以免把要恢复的这一份清掉。
    let backup = create_unpruned(store, root, "restore", now)?;

    let temp = data_dir.join(format!("{DATABASE_FILE}.restore-{now}"));
    std::fs::copy(root.join(DATABASE_DIR).join(format!("{id}.db")), &temp)?;
    let replaced = (|| -> AppResult<i64> {
        // 打开一次以按当前版本补齐结构迁移。
        drop(Store::open(&temp)?);
        let from = PathBuf::from(&info.data_directory);
        if !info.data_directory.is_empty() && from != data_dir {
            rewrite_paths(&temp, &[from], &data_dir)?;
        }
        store.replace_records(&temp)
    })();
    remove_database_files(&temp);
    let notes = replaced?;

    // 记录已经替换；之后拷回附件出错时不再返回错误，拷不回的计入「找不到」。
    let source = root.join(ATTACHMENTS_DIR);
    let target = data_dir.join(ATTACHMENTS_DIR);
    let (mut restored_attachments, mut missing_attachments) = (0, 0);
    for folder in referenced_folders(&store.reference_texts().unwrap_or_default()) {
        if target.join(&folder).is_dir() {
            continue;
        }
        let _ = std::fs::create_dir_all(&target);
        if source.join(&folder).is_dir() && copy_folder(&source.join(&folder), &target.join(&folder)).is_ok() {
            restored_attachments += 1;
        } else {
            missing_attachments += 1;
        }
    }
    prune(root, now);
    Ok(RestoreReport {
        backup: backup.id,
        notes,
        restored_attachments,
        missing_attachments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::import_bytes;
    use crate::models::{Draft, Note};
    use std::collections::HashMap;

    const T0: i64 = 1_800_000_000_000;

    fn temp_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-snapshots-{name}-{}", std::process::id()));
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

    fn save(store: &Store, notes: &[Note], settings: serde_json::Value) {
        store.save(notes, &Draft::default(), &settings, &HashMap::new()).expect("写入记录");
    }

    fn folder_of(path: &str) -> String {
        Path::new(path).parent().unwrap().file_name().unwrap().to_string_lossy().into_owned()
    }

    fn info(id: i64) -> SnapshotInfo {
        SnapshotInfo {
            id: id.to_string(),
            created_at: id,
            reason: "auto".into(),
            data_directory: String::new(),
            note_count: 0,
            attachments: vec![],
            missing: vec![],
        }
    }

    #[test]
    fn finds_referenced_attachment_folders() {
        let texts = vec![
            r"![图](C:\Data\attachments\1730000000000-0\a.png)".to_string(),
            "[表](file:///C:/Data/Attachments/1730000000001-2/b.xlsx)".to_string(),
            r"无关 attachments\说明\x 与 C:\attachments\abc\y".to_string(),
        ];
        let found: Vec<String> = referenced_folders(&texts).into_iter().collect();
        assert_eq!(found, vec!["1730000000000-0".to_string(), "1730000000001-2".to_string()]);
    }

    #[test]
    fn keeps_recent_daily_weekly_and_latest_snapshots() {
        let hour = 3_600_000;
        let ages = [0, 5 * hour, 30 * hour, 40 * hour, 50 * hour, 8 * DAY_MS, 9 * DAY_MS, 40 * DAY_MS];
        let infos: Vec<SnapshotInfo> = ages.iter().map(|age| info(T0 - age)).collect();
        let keep = retained(&infos, T0);
        let kept: Vec<i64> = ages.iter().copied().filter(|age| keep.contains(&(T0 - age).to_string())).collect();
        // 24 小时内全保留；30 与 40 小时同在「1 天前」只留较新的；8、9 天同在第二周只留较新的；40 天前删除。
        assert_eq!(kept, vec![0, 5 * hour, 30 * hour, 50 * hour, 8 * DAY_MS]);
        // 很久没有使用时，最新的 3 份仍然保留。
        let old: Vec<SnapshotInfo> = [100, 101, 102, 103].iter().map(|days| info(T0 - days * DAY_MS)).collect();
        assert_eq!(retained(&old, T0).len(), 3);
    }

    #[test]
    fn backs_up_each_attachment_folder_once_and_never_overwrites() {
        let root = temp_root("create");
        let data = root.join("数据");
        let snapshots = root.join("快照");
        let store = Store::open(&data.join(DATABASE_FILE)).expect("打开数据库");
        let image = import_bytes(&data, "图.png", b"png").expect("写入附件");
        save(&store, &[note("a", format!("![图]({})", image.path))], serde_json::json!({}));

        let first = create(&store, &snapshots, "manual", T0).expect("创建快照");
        let folder = folder_of(&image.path);
        assert_eq!(first.attachments, vec![folder.clone()]);
        assert_eq!(first.note_count, 1);
        let backup = snapshots.join(ATTACHMENTS_DIR).join(&folder).join("图.png");
        assert_eq!(std::fs::read(&backup).unwrap(), b"png");

        // 数据目录中的文件被改写、随后整个子文件夹被删除：备份保持第一次复制的内容，也不算缺失。
        std::fs::write(&image.path, b"changed").unwrap();
        create(&store, &snapshots, "manual", T0 + 1000).expect("创建快照");
        assert_eq!(std::fs::read(&backup).unwrap(), b"png");
        std::fs::remove_dir_all(Path::new(&image.path).parent().unwrap()).unwrap();
        let third = create(&store, &snapshots, "unknown", T0 + 2000).expect("创建快照");
        assert!(third.missing.is_empty());
        assert_eq!(third.reason, "manual");
        assert_eq!(list(&snapshots).len(), 3);
        // 一天之内不再自动创建。
        assert!(auto(&store, &snapshots, T0 + 3000).expect("检查自动快照").is_none());
        assert!(auto(&store, &snapshots, T0 + DAY_MS + 3000).expect("检查自动快照").is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn prunes_old_snapshots_and_their_unreferenced_attachments() {
        let root = temp_root("prune");
        let data = root.join("data");
        let snapshots = root.join("snapshots");
        let store = Store::open(&data.join(DATABASE_FILE)).expect("打开数据库");
        let old = import_bytes(&data, "old.txt", b"old").expect("写入附件");
        save(&store, &[note("a", format!("[旧]({})", old.path))], serde_json::json!({}));
        create(&store, &snapshots, "manual", T0).expect("创建快照");

        let new = import_bytes(&data, "new.txt", b"new").expect("写入附件");
        save(&store, &[note("a", format!("[新]({})", new.path))], serde_json::json!({}));
        for day in [40, 41, 42] {
            create(&store, &snapshots, "manual", T0 + day * DAY_MS).expect("创建快照");
        }
        // 42 天前的那一份已过期且不在最新 3 份之内：删除，只被它引用的附件副本随之删除。
        assert_eq!(list(&snapshots).len(), 3);
        assert!(!snapshots.join(ATTACHMENTS_DIR).join(folder_of(&old.path)).exists());
        assert!(snapshots.join(ATTACHMENTS_DIR).join(folder_of(&new.path)).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn restores_records_and_brings_back_attachments_keeping_settings() {
        let root = temp_root("restore");
        let data = root.join("data");
        let snapshots = root.join("snapshots");
        let store = Store::open(&data.join(DATABASE_FILE)).expect("打开数据库");
        let image = import_bytes(&data, "图.png", b"png").expect("写入附件");
        let text = format!("![图]({})", image.path);
        save(&store, &[note("a", text.clone()), note("b", "第二条".into())], serde_json::json!({ "theme": "light" }));
        let snapshot = create(&store, &snapshots, "manual", T0).expect("创建快照");

        // 之后删除了记录，附件也被清理，设置改了。
        save(&store, &[note("c", "新记录".into())], serde_json::json!({ "theme": "dark" }));
        std::fs::remove_dir_all(Path::new(&image.path).parent().unwrap()).unwrap();

        let report = restore(&store, &snapshots, &snapshot.id, T0 + 1000).expect("恢复快照");
        assert_eq!(report.notes, 2);
        assert_eq!(report.restored_attachments, 1);
        assert_eq!(report.missing_attachments, 0);
        let loaded = store.load().expect("读取");
        let mut ids: Vec<&str> = loaded.notes.iter().map(|item| item.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["a", "b"]);
        assert_eq!(loaded.notes.iter().find(|item| item.id == "a").unwrap().text, text);
        assert_eq!(loaded.settings["theme"], "dark");
        assert_eq!(std::fs::read(&image.path).unwrap(), b"png");
        // 恢复前的数据另存了一份快照，可以换回。
        let backup = list(&snapshots).into_iter().find(|item| item.id == report.backup).expect("恢复前的快照");
        assert_eq!(backup.reason, "restore");
        assert_eq!(backup.note_count, 1);
        assert!(restore(&store, &snapshots, "../x", T0 + 2000).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_rewrites_paths_after_the_data_directory_moved() {
        let root = temp_root("moved");
        let snapshots = root.join("snapshots");
        let store = Store::open(&root.join("a").join(DATABASE_FILE)).expect("打开数据库");
        let image = import_bytes(&root.join("a"), "图.png", b"png").expect("写入附件");
        save(&store, &[note("a", format!("![图]({})", image.path))], serde_json::json!({}));
        let snapshot = create(&store, &snapshots, "manual", T0).expect("创建快照");
        crate::migration::migrate(&store, &root.join("b"), &[]).expect("迁移");

        restore(&store, &snapshots, &snapshot.id, T0 + 1000).expect("恢复快照");
        let text = store.load().expect("读取").notes[0].text.clone();
        let moved = root.join("b").join(ATTACHMENTS_DIR).join(folder_of(&image.path)).join("图.png");
        assert_eq!(text, format!("![图]({})", moved.display()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_directories_overlapping_the_data_directory() {
        let root = temp_root("refuse");
        let data = root.join("data");
        let store = Store::open(&data.join(DATABASE_FILE)).expect("打开数据库");
        assert!(create(&store, &data, "manual", T0).is_err());
        assert!(create(&store, &data.join(ATTACHMENTS_DIR).join("x"), "manual", T0).is_err());
        assert!(create(&store, Path::new("相对路径"), "manual", T0).is_err());
        assert!(!data.join(ATTACHMENTS_DIR).join("x").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
