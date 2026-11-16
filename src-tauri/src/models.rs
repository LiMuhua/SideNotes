//! 记录、草稿与设置的数据模型。
//!
//! 字段与前端 TypeScript 类型一一对应，序列化使用 camelCase，
//! 保证迁移自原型的前端逻辑无需改写字段名。

use serde::{Deserialize, Serialize};

/// 图片附件。原型将图片以 data URL 内嵌保存，桌面端沿用同一表示，
/// 便于导入旧备份；超大附件由前端在写入前限制为 2 MB。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImage {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub mime: String,
    pub data: String,
}

/// 一条记录。`status` 取 active / trash；`order` 为手动排序后的序号。
///
/// 0.7.3 及更早版本还有 archived（归档）。去掉归档之后，旧值仍按字符串原样读写，
/// 由前端在读库、导入备份时统一迁移为带 #归档 的普通记录（`src/core/notes.ts` 的 `migrateArchivedNote`），
/// 下一次整体保存时写回数据库；标签的写法只在前端实现一处，这里不重复。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub images: Vec<NoteImage>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_status")]
    pub previous_status: String,
    #[serde(default)]
    pub order: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

fn default_status() -> String {
    "active".to_string()
}

/// 两个入口共享的草稿。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub images: Vec<NoteImage>,
    #[serde(default)]
    pub updated_at: i64,
}

/// 标签访问统计，用于标签菜单的评分排序。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagUsage {
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub last: i64,
}

/// 应用快照：一次读取即可恢复完整界面状态。
/// 设置以 JSON 原样透传，由前端统一校验，避免两侧重复定义默认值。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub notes: Vec<Note>,
    pub draft: Draft,
    pub settings: serde_json::Value,
    pub tag_usage: std::collections::HashMap<String, TagUsage>,
}

/// 数据目录信息，供设置页显示实际路径。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    /// 当前数据库所在目录。
    pub directory: String,
    /// 数据库文件完整路径。
    pub database: String,
    /// 数据库文件字节数。
    pub size: u64,
    /// 记录条数（含回收站）。
    pub note_count: i64,
    /// 附件副本数（每次导入一个子文件夹）。
    pub attachment_count: usize,
    /// 附件副本的总字节数。
    pub attachment_size: u64,
    /// 系统应用数据目录（「应用数据目录」选项的位置）。
    pub default_directory: String,
    /// 便携模式的数据目录（程序所在文件夹下的 SideNotesData）。
    pub portable_directory: String,
    /// 启动时记下的数据目录不可用、暂时改用默认目录时，为原来的目录；否则为空。
    pub unavailable_directory: String,
}
