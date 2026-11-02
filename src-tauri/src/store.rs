//! 本地 SQLite 存储。
//!
//! 设计要点：
//! - 一个连接由 `Mutex` 保护；桌面端单用户写入，无需连接池。
//! - 写入使用事务，保证"原子写入成功后再替换前端状态"的原型约定。
//! - 图片以独立表存储并按记录级联删除，避免正文行过大影响列表查询。
//! - `schema_version` 记录迁移进度，升级只追加迁移步骤。
//! - 更换数据存储位置时，复制完成后经 [`Store::relocate`] 改用新位置的数据库，应用无需重启。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{Draft, Note, NoteImage, Snapshot, StorageInfo, TagUsage};

/// 当前数据库结构版本。
const SCHEMA_VERSION: i64 = 1;

/// 数据库封装。
pub struct Store {
    connection: Mutex<Connection>,
    path: Mutex<PathBuf>,
}

/// 打开或创建数据库文件，设置连接参数并完成结构迁移。
fn open_connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    // WAL 提升并发读与崩溃恢复能力；NORMAL 在桌面场景兼顾安全与速度。
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&connection)?;
    Ok(connection)
}

impl Store {
    /// 打开或创建数据库，并完成结构迁移。
    pub fn open(path: &Path) -> AppResult<Self> {
        Ok(Self {
            connection: Mutex::new(open_connection(path)?),
            path: Mutex::new(path.to_path_buf()),
        })
    }

    /// 改用另一个位置的数据库（更换数据存储位置后）。新数据库打开失败时保持原连接不变。
    pub fn relocate(&self, path: &Path) -> AppResult<()> {
        let connection = open_connection(path)?;
        let mut current = self.connection()?;
        *current = connection;
        *self.path.lock().map_err(|_| AppError::Other("数据库路径状态异常，请重启应用".into()))? = path.to_path_buf();
        Ok(())
    }

    /// 取得受保护的连接。锁中毒说明此前写入线程已 panic，直接报错而非继续使用。
    fn connection(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| AppError::Other("数据库连接状态异常，请重启应用".into()))
    }

    /// 当前数据库文件的路径。
    pub fn path(&self) -> PathBuf {
        self.path.lock().map(|path| path.clone()).unwrap_or_default()
    }

    /// 把当前数据库完整复制到 `target`（含尚未合并进主文件的 WAL 内容），复制的是同一时刻的一致快照。
    pub fn copy_to(&self, target: &Path) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute("VACUUM INTO ?1", params![target.display().to_string()])?;
        Ok(())
    }
}

/// 建表并按版本号执行迁移。
fn migrate(connection: &Connection) -> AppResult<()> {
    {
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS notes (
                id              TEXT PRIMARY KEY,
                text            TEXT NOT NULL,
                emoji           TEXT NOT NULL DEFAULT '',
                pinned          INTEGER NOT NULL DEFAULT 0,
                collapsed       INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'active',
                previous_status TEXT NOT NULL DEFAULT 'active',
                sort_order      INTEGER,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                deleted_at      INTEGER
            );

            CREATE TABLE IF NOT EXISTS note_images (
                id       TEXT PRIMARY KEY,
                note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                name     TEXT NOT NULL,
                mime     TEXT NOT NULL,
                data     TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS drafts (
                slot       TEXT PRIMARY KEY,
                text       TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS draft_images (
                id         TEXT PRIMARY KEY,
                slot       TEXT NOT NULL REFERENCES drafts(slot) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                mime       TEXT NOT NULL,
                data       TEXT NOT NULL,
                position   INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tag_usage (
                tag        TEXT PRIMARY KEY,
                use_count  INTEGER NOT NULL DEFAULT 0,
                last_used  INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_notes_status  ON notes(status);
            CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_images_note   ON note_images(note_id, position);
            CREATE INDEX IF NOT EXISTS idx_draft_images  ON draft_images(slot, position);
            "#,
        )?;
        connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    Ok(())
}

impl Store {
    /// 读取完整快照。
    pub fn load(&self) -> AppResult<Snapshot> {
        let connection = self.connection()?;
        let notes = read_notes(&connection)?;
        let draft = read_draft(&connection)?;
        let settings = read_settings(&connection)?;
        let tag_usage = read_tag_usage(&connection)?;
        Ok(Snapshot {
            notes,
            draft,
            settings,
            tag_usage,
        })
    }

    /// 在单个事务中整体替换记录、草稿与设置。
    ///
    /// 与原型的 `persistSnapshot` 对应：要么全部成功，要么数据库保持原状，
    /// 前端据返回值决定是否替换权威状态。
    pub fn save(
        &self,
        notes: &[Note],
        draft: &Draft,
        settings: &serde_json::Value,
        tag_usage: &HashMap<String, TagUsage>,
    ) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;

        transaction.execute("DELETE FROM note_images", [])?;
        transaction.execute("DELETE FROM notes", [])?;
        {
            let mut insert_note = transaction.prepare(
                "INSERT INTO notes (id, text, emoji, pinned, collapsed, status, previous_status,
                                    sort_order, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            let mut insert_image = transaction.prepare(
                "INSERT INTO note_images (id, note_id, name, mime, data, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for note in notes {
                insert_note.execute(params![
                    note.id,
                    note.text,
                    note.emoji,
                    note.pinned as i64,
                    note.collapsed as i64,
                    note.status,
                    note.previous_status,
                    note.order,
                    note.created_at,
                    note.updated_at,
                    note.deleted_at,
                ])?;
                for (position, image) in note.images.iter().enumerate() {
                    insert_image.execute(params![
                        image.id,
                        note.id,
                        image.name,
                        image.mime,
                        image.data,
                        position as i64,
                    ])?;
                }
            }
        }

        transaction.execute("DELETE FROM draft_images", [])?;
        transaction.execute("DELETE FROM drafts", [])?;
        transaction.execute(
            "INSERT INTO drafts (slot, text, updated_at) VALUES ('shared', ?1, ?2)",
            params![draft.text, draft.updated_at],
        )?;
        {
            let mut insert_draft_image = transaction.prepare(
                "INSERT INTO draft_images (id, slot, name, mime, data, position)
                 VALUES (?1, 'shared', ?2, ?3, ?4, ?5)",
            )?;
            for (position, image) in draft.images.iter().enumerate() {
                insert_draft_image.execute(params![
                    image.id,
                    image.name,
                    image.mime,
                    image.data,
                    position as i64,
                ])?;
            }
        }

        transaction.execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(settings)?],
        )?;

        transaction.execute("DELETE FROM tag_usage", [])?;
        {
            let mut insert_tag = transaction.prepare(
                "INSERT INTO tag_usage (tag, use_count, last_used) VALUES (?1, ?2, ?3)",
            )?;
            for (tag, usage) in tag_usage {
                insert_tag.execute(params![tag, usage.count, usage.last])?;
            }
        }

        transaction.commit()?;
        Ok(())
    }

    /// 仅保存设置，用于外观等高频小改动。
    pub fn save_settings(&self, settings: &serde_json::Value) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(settings)?],
        )?;
        Ok(())
    }

    /// 清理超过保留天数的回收站记录，返回删除条数。
    pub fn purge_expired(&self, retain_days: i64, now: i64) -> AppResult<usize> {
        let connection = self.connection()?;
        let cutoff = now - retain_days.max(1) * 86_400_000;
        let removed = connection.execute(
            "DELETE FROM notes WHERE status = 'trash' AND deleted_at IS NOT NULL AND deleted_at < ?1",
            params![cutoff],
        )?;
        Ok(removed)
    }

    /// 回收未使用空间，导出或大量删除后调用。
    pub fn compact(&self) -> AppResult<()> {
        let connection = self.connection()?;
        connection.execute_batch("VACUUM")?;
        Ok(())
    }

    /// 数据库所在的数据目录，附件文件夹也在其中。
    pub fn directory(&self) -> PathBuf {
        self.path().parent().map(Path::to_path_buf).unwrap_or_default()
    }

    /// 全部记录（含回收站）与草稿的原文，供附件清理判断哪些副本仍被引用。
    pub fn reference_texts(&self) -> AppResult<Vec<String>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT text FROM notes UNION ALL SELECT text FROM drafts")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut texts = Vec::new();
        for row in rows {
            texts.push(row?);
        }
        Ok(texts)
    }

    /// 读取数据目录与数据库规模；默认目录等与位置相关的字段由调用方补上。
    pub fn info(&self) -> AppResult<StorageInfo> {
        let connection = self.connection()?;
        let note_count: i64 = connection.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
        let path = self.path();
        let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        let directory = self.directory();
        let attachments = crate::attachments::usage(&directory);
        Ok(StorageInfo {
            directory: directory.display().to_string(),
            database: path.display().to_string(),
            size,
            note_count,
            attachment_count: attachments.count,
            attachment_size: attachments.size,
            ..StorageInfo::default()
        })
    }
}

/// 读取全部记录及其图片。
fn read_notes(connection: &Connection) -> AppResult<Vec<Note>> {
    let mut images: HashMap<String, Vec<NoteImage>> = HashMap::new();
    {
        let mut statement = connection
            .prepare("SELECT note_id, id, name, mime, data FROM note_images ORDER BY note_id, position")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                NoteImage {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    mime: row.get(3)?,
                    data: row.get(4)?,
                },
            ))
        })?;
        for row in rows {
            let (note_id, image) = row?;
            images.entry(note_id).or_default().push(image);
        }
    }

    let mut statement = connection.prepare(
        "SELECT id, text, emoji, pinned, collapsed, status, previous_status,
                sort_order, created_at, updated_at, deleted_at
         FROM notes
         ORDER BY created_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        let id: String = row.get(0)?;
        Ok(Note {
            text: row.get(1)?,
            emoji: row.get(2)?,
            pinned: row.get::<_, i64>(3)? != 0,
            collapsed: row.get::<_, i64>(4)? != 0,
            status: row.get(5)?,
            previous_status: row.get(6)?,
            order: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            deleted_at: row.get(10)?,
            images: Vec::new(),
            id,
        })
    })?;

    let mut notes = Vec::new();
    for row in rows {
        let mut note = row?;
        note.images = images.remove(&note.id).unwrap_or_default();
        notes.push(note);
    }
    Ok(notes)
}

/// 读取共享草稿。
fn read_draft(connection: &Connection) -> AppResult<Draft> {
    let base: Option<(String, i64)> = connection
        .query_row(
            "SELECT text, updated_at FROM drafts WHERE slot = 'shared'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (text, updated_at) = base.unwrap_or_default();
    let mut statement = connection
        .prepare("SELECT id, name, mime, data FROM draft_images WHERE slot = 'shared' ORDER BY position")?;
    let rows = statement.query_map([], |row| {
        Ok(NoteImage {
            id: row.get(0)?,
            name: row.get(1)?,
            mime: row.get(2)?,
            data: row.get(3)?,
        })
    })?;
    let mut draft_images = Vec::new();
    for row in rows {
        draft_images.push(row?);
    }
    Ok(Draft {
        text,
        images: draft_images,
        updated_at,
    })
}

/// 读取设置 JSON；缺失时返回空对象由前端补默认值。
fn read_settings(connection: &Connection) -> AppResult<serde_json::Value> {
    let raw: Option<String> = connection
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| row.get(0))
        .optional()?;
    match raw {
        Some(value) => Ok(serde_json::from_str(&value).unwrap_or_else(|_| serde_json::json!({}))),
        None => Ok(serde_json::json!({})),
    }
}

/// 读取标签访问统计。
fn read_tag_usage(connection: &Connection) -> AppResult<HashMap<String, TagUsage>> {
    let mut statement = connection.prepare("SELECT tag, use_count, last_used FROM tag_usage")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            TagUsage {
                count: row.get(1)?,
                last: row.get(2)?,
            },
        ))
    })?;
    let mut usage = HashMap::new();
    for row in rows {
        let (tag, value) = row?;
        usage.insert(tag, value);
    }
    Ok(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建立临时数据库，避免测试写入真实应用目录。
    fn temp_store() -> (Store, PathBuf) {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).expect("打开临时数据库");
        (store, path)
    }

    fn sample_note(id: &str) -> Note {
        Note {
            id: id.to_string(),
            text: "测试记录\n\n#测试".into(),
            emoji: "📝".into(),
            images: vec![NoteImage {
                id: format!("{id}-image"),
                name: "图.png".into(),
                mime: "image/png".into(),
                data: "data:image/png;base64,AA".into(),
            }],
            pinned: true,
            collapsed: false,
            status: "active".into(),
            previous_status: "active".into(),
            order: Some(3),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_001_000,
            deleted_at: None,
        }
    }

    #[test]
    fn saves_and_reads_snapshot() {
        let (store, path) = temp_store();
        let notes = vec![sample_note("note-1")];
        let draft = Draft {
            text: "草稿".into(),
            images: vec![],
            updated_at: 42,
        };
        let settings = serde_json::json!({ "theme": "dark", "width": 480 });
        let mut usage = HashMap::new();
        usage.insert("测试".to_string(), TagUsage { count: 2, last: 99 });

        store.save(&notes, &draft, &settings, &usage).expect("写入快照");
        let snapshot = store.load().expect("读取快照");

        assert_eq!(snapshot.notes.len(), 1);
        assert_eq!(snapshot.notes[0].id, "note-1");
        assert_eq!(snapshot.notes[0].images.len(), 1);
        assert!(snapshot.notes[0].pinned);
        assert_eq!(snapshot.notes[0].order, Some(3));
        assert_eq!(snapshot.draft.text, "草稿");
        assert_eq!(snapshot.settings["theme"], "dark");
        assert_eq!(snapshot.tag_usage["测试"].count, 2);

        // Windows 不能删除仍被打开的文件，先关闭数据库连接再删除，否则临时文件会留在系统临时目录。
        drop(store);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn purges_only_expired_trash() {
        let mut path = std::env::temp_dir();
        path.push(format!("sidenotes-purge-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let store = Store::open(&path).expect("打开临时数据库");

        let now = 1_800_000_000_000_i64;
        let mut recent = sample_note("recent");
        recent.status = "trash".into();
        recent.deleted_at = Some(now - 86_400_000); // 一天前删除
        let mut stale = sample_note("stale");
        stale.status = "trash".into();
        stale.deleted_at = Some(now - 40 * 86_400_000); // 四十天前删除
        let keep = sample_note("active");

        store
            .save(
                &[recent, stale, keep],
                &Draft::default(),
                &serde_json::json!({}),
                &HashMap::new(),
            )
            .expect("写入快照");

        let removed = store.purge_expired(30, now).expect("清理到期记录");
        assert_eq!(removed, 1);
        let remaining = store.load().expect("读取快照");
        assert_eq!(remaining.notes.len(), 2);
        assert!(remaining.notes.iter().all(|note| note.id != "stale"));

        drop(store);
        let _ = std::fs::remove_file(&path);
    }
}
