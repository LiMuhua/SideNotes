//! 统一错误类型：Rust 侧失败通过字符串回传前端，前端据此提示并保留输入。

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库操作失败：{0}")]
    Database(#[from] rusqlite::Error),

    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),

    #[error("数据格式不正确：{0}")]
    Serialization(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        AppError::Other(format!("窗口操作失败：{error}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
