//! 云端存储的统一接口：WebDAV、OneDrive、Google Drive 都按路径读写，备份与恢复的逻辑只写一份（见 job）。
//!
//! 路径一律以 `/` 开头、以 `/` 分隔，相对于各服务的根（WebDAV 是服务地址，OneDrive 与 Google Drive 是「我的文件」）。

use std::io::{Read, Write};

/// 目录中的一项。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 云端操作的错误：分成几类，状态点与通知按类别写原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteError {
    /// 配置不完整或不对（地址、用户名、没登录）。
    Config(String),
    /// 认证失败：密码不对、登录过期、没有权限。
    Auth(String),
    /// 网络不通、超时、证书不对。
    Network(String),
    /// 服务返回了错误。
    Server(String),
    /// 文件或文件夹不存在。
    NotFound,
}

impl std::fmt::Display for RemoteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteError::Config(message) | RemoteError::Auth(message) | RemoteError::Server(message) => formatter.write_str(message),
            RemoteError::Network(message) => write!(formatter, "网络不通：{message}"),
            RemoteError::NotFound => formatter.write_str("云端找不到这个文件或文件夹"),
        }
    }
}

pub type RemoteResult<T> = Result<T, RemoteError>;

/// 一个云端存储。
pub trait Remote: Send + Sync {
    /// 测试连接，返回账户名（WebDAV 是用户名，OneDrive 与 Google Drive 是登录的邮箱）。
    fn account(&self) -> RemoteResult<String>;
    /// 列出目录下的直接子项；目录不存在时返回 NotFound。
    fn list(&self, path: &str) -> RemoteResult<Vec<Entry>>;
    /// 逐级建好目录，已有的不动。
    fn ensure_dir(&self, path: &str) -> RemoteResult<()>;
    /// 上传一个文件，已有同名的覆盖。
    fn upload(&self, path: &str, reader: Box<dyn Read + Send>, size: u64) -> RemoteResult<()>;
    /// 下载一个文件写进 `target`，返回字节数。
    fn download(&self, path: &str, target: &mut dyn Write) -> RemoteResult<u64>;
    /// 删除一个文件或文件夹，不存在时也算成功。
    fn delete(&self, path: &str) -> RemoteResult<()>;
}

/// 规范云端文件夹的写法：以 `/` 开头，去掉多余与末尾的斜杠，反斜杠当作斜杠；不允许 `.` 与 `..`。空的是根目录 `/`。
pub fn normalize_folder(folder: &str) -> Result<String, String> {
    let mut segments = Vec::new();
    for segment in folder.split(['/', '\\']).filter(|segment| !segment.trim().is_empty()) {
        let segment = segment.trim();
        if segment == "." || segment == ".." {
            return Err("远程文件夹里不能有 . 或 ..".into());
        }
        if segment.chars().any(|character| character.is_control() || "<>:\"|?*".contains(character)) {
            return Err(format!("「{segment}」里有不能用在文件夹名里的字符"));
        }
        segments.push(segment);
    }
    Ok(format!("/{}", segments.join("/")))
}

/// 把 `folder` 与 `name` 接成路径。
pub fn join(folder: &str, name: &str) -> String {
    let folder = folder.trim_end_matches('/');
    let name = name.trim_start_matches('/');
    format!("{folder}/{name}")
}

/// 路径逐段做网址编码，斜杠保留。
pub fn encode_path(path: &str) -> String {
    use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
    // 路径一段里要编码的字符：空格、引号、#、%、?、以及非 ASCII。
    const SEGMENT: &AsciiSet = &CONTROLS.add(b' ').add(b'"').add(b'#').add(b'%').add(b'<').add(b'>').add(b'?').add(b'`').add(b'{').add(b'}').add(b'[').add(b']').add(b'^').add(b'|').add(b'\\');
    path.split('/').map(|segment| utf8_percent_encode(segment, SEGMENT).to_string()).collect::<Vec<_>>().join("/")
}

/// 网络错误的说明：超时、连不上、证书不对分开写。
pub fn network_text(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "连接超时".into()
    } else if error.is_connect() {
        let detail = std::error::Error::source(error).map(ToString::to_string).unwrap_or_default();
        if detail.to_ascii_lowercase().contains("certificate") || detail.contains("证书") {
            "证书不受信任（自签名证书要先装进系统的受信任根证书）".into()
        } else {
            "连不上服务器，检查地址与网络".into()
        }
    } else {
        error.to_string()
    }
}

/// 把非成功的回复变成错误：带上状态码与回复的开头一段（去掉可能的凭据）。
pub fn http_error(status: u16, body: &str, action: &str) -> RemoteError {
    let snippet: String = super::notify::redact(body).chars().take(200).collect();
    let snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
    match status {
        401 => RemoteError::Auth("登录已失效，请重新登录".into()),
        403 => RemoteError::Auth(format!("没有权限{action}")),
        404 => RemoteError::NotFound,
        429 => RemoteError::Server("请求太频繁，服务暂时拒绝了，稍后会再试".into()),
        _ if snippet.is_empty() => RemoteError::Server(format!("{action}失败（HTTP {status}）")),
        _ => RemoteError::Server(format!("{action}失败（HTTP {status}）：{snippet}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_remote_folders() {
        assert_eq!(normalize_folder("").unwrap(), "/");
        assert_eq!(normalize_folder("SideNotes").unwrap(), "/SideNotes");
        assert_eq!(normalize_folder("/Test/").unwrap(), "/Test");
        assert_eq!(normalize_folder("\\备份\\\\SideNotes\\").unwrap(), "/备份/SideNotes");
        assert!(normalize_folder("/a/../b").is_err());
        assert!(normalize_folder("/a:b").is_err());
    }

    #[test]
    fn joins_and_encodes_paths() {
        assert_eq!(join("/", "a.db"), "/a.db");
        assert_eq!(join("/Test", "/database/1.db"), "/Test/database/1.db");
        assert_eq!(encode_path("/备份 文件/a#1.json"), "/%E5%A4%87%E4%BB%BD%20%E6%96%87%E4%BB%B6/a%231.json");
    }
}
