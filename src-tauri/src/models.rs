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

/// 一条记录。`status` 取 active / archived / trash；`order` 为手动排序后的序号。
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
#[derive(Debug, Clone, Serialize)]
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
}
