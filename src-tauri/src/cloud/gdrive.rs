//! Google Drive：Drive v3 接口。Drive 按编号而不是路径访问，这里逐段按名字查出编号（同一次备份里记住查过的）。
//!
//! 权限只要 drive.file：应用只能看到、改动自己建的文件与文件夹，碰不到网盘里别的东西。所以远程文件夹里只列得出
//! SideNotes 建过的文件夹；网盘里原有的同名文件夹 SideNotes 看不到，会另建一个。
//! 上传一律用可续传的会话，整个文件一次 PUT。

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::Method;
use reqwest::blocking::{Body, Client, RequestBuilder, Response};
use serde::Deserialize;

use super::oauth::{self, Provider, Tokens};
use super::remote::{Entry, Remote, RemoteError, RemoteResult, http_error, network_text};

const DRIVE: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";
const FOLDER: &str = "application/vnd.google-apps.folder";

/// 构建时写进程序的客户端编号与密钥（build.rs）。编号空的表示这个版本登录不了 Google Drive；
/// 密钥可以空：「桌面应用」类型的客户端换令牌时不用密钥（见 oauth::Provider::client_secret）。
pub const BUILTIN_CLIENT: &str = match option_env!("SIDENOTES_GOOGLE_CLIENT_ID") {
    Some(value) => value,
    None => "",
};
pub const BUILTIN_SECRET: &str = match option_env!("SIDENOTES_GOOGLE_CLIENT_SECRET") {
    Some(value) => value,
    None => "",
};

/// Google 登录的端点与客户端。
pub fn provider(client_id: &str, client_secret: &str) -> Provider {
    Provider {
        name: "Google Drive",
        authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
        token_url: "https://oauth2.googleapis.com/token".into(),
        client_id: client_id.trim().to_string(),
        client_secret: Some(client_secret.trim().to_string()).filter(|value| !value.is_empty()),
        scope: "https://www.googleapis.com/auth/drive.file",
        refresh_scope: false,
        // 要刷新令牌：access_type=offline；每次都给：prompt=consent。
        extra: &[("access_type", "offline"), ("prompt", "consent select_account")],
    }
}

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<File>,
    #[serde(rename = "nextPageToken")]
    next: Option<String>,
}

#[derive(Deserialize)]
struct File {
    id: String,
    name: String,
    #[serde(rename = "mimeType")]
    mime: String,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Deserialize)]
struct About {
    user: AboutUser,
}

#[derive(Deserialize)]
struct AboutUser {
    #[serde(rename = "emailAddress", default)]
    email: Option<String>,
    #[serde(rename = "displayName", default)]
    display: Option<String>,
}

/// Google Drive 的连接。
pub struct GoogleDrive {
    client: Client,
    provider: Provider,
    refresh_token: String,
    access: Mutex<Option<(String, Instant)>>,
    /// 路径到编号：查过的、建过的都记下。
    ids: Mutex<HashMap<String, String>>,
}

/// 查询里的名字：反斜杠与单引号要转义。
fn quote(name: &str) -> String {
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

impl GoogleDrive {
    pub fn new(client: Client, provider: Provider, refresh_token: String) -> Self {
        let mut ids = HashMap::new();
        ids.insert("/".to_string(), "root".to_string());
        GoogleDrive { client, provider, refresh_token, access: Mutex::new(None), ids: Mutex::new(ids) }
    }

    pub fn with_tokens(client: Client, provider: Provider, tokens: &Tokens) -> Self {
        let drive = GoogleDrive::new(client, provider, tokens.refresh.clone().unwrap_or_default());
        *drive.access.lock().expect("令牌") = Some((tokens.access.clone(), tokens.expires_at));
        drive
    }

    fn token(&self) -> RemoteResult<String> {
        let mut access = self.access.lock().map_err(|_| RemoteError::Config("登录状态异常".into()))?;
        if let Some((token, expires)) = access.as_ref() {
            if Instant::now() < *expires {
                return Ok(token.clone());
            }
        }
        let tokens = oauth::refresh(&self.client, &self.provider, &self.refresh_token)?;
        *access = Some((tokens.access.clone(), tokens.expires_at));
        Ok(tokens.access)
    }

    fn request(&self, method: Method, url: &str) -> RemoteResult<RequestBuilder> {
        Ok(self.client.request(method, url).bearer_auth(self.token()?))
    }

    fn send(&self, request: RequestBuilder, action: &str) -> RemoteResult<Response> {
        let response = request.send().map_err(|error| RemoteError::Network(network_text(&error)))?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let text = response.text().unwrap_or_default();
        if text.contains("storageQuotaExceeded") {
            return Err(RemoteError::Server("Google Drive 的空间不够了".into()));
        }
        if status.as_u16() == 403 && text.contains("accessNotConfigured") {
            return Err(RemoteError::Config("这个客户端所在的 Google Cloud 项目没有启用 Google Drive API".into()));
        }
        Err(http_error(status.as_u16(), &text, action))
    }

    /// 列出某个编号下的子项（不含回收站里的）。
    fn children(&self, parent: &str, query: Option<&str>) -> RemoteResult<Vec<File>> {
        let mut q = format!("{} in parents and trashed = false", quote(parent));
        if let Some(extra) = query {
            q.push_str(" and ");
            q.push_str(extra);
        }
        let mut files = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut params = vec![("q", q.clone()), ("fields", "nextPageToken, files(id, name, mimeType, size)".to_string()), ("pageSize", "1000".to_string()), ("spaces", "drive".to_string())];
            if let Some(token) = &page_token {
                params.push(("pageToken", token.clone()));
            }
            let request = self.request(Method::GET, &format!("{DRIVE}/files"))?.query(&params);
            let list: FileList = self.send(request, "读取目录")?.json().map_err(|_| RemoteError::Server("Google Drive 的目录看不懂".into()))?;
            files.extend(list.files);
            match list.next {
                Some(next) => page_token = Some(next),
                None => return Ok(files),
            }
        }
    }

    /// 按路径查编号；`create` 时缺的文件夹逐级建出来。找不到且不建时返回 NotFound。
    fn resolve(&self, path: &str, create: bool) -> RemoteResult<String> {
        let normalized = format!("/{}", path.trim_matches('/'));
        if let Some(id) = self.ids.lock().ok().and_then(|ids| ids.get(&normalized).cloned()) {
            return Ok(id);
        }
        let mut current = String::from("/");
        let mut id = "root".to_string();
        for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
            let next = super::remote::join(&current, segment);
            if let Some(known) = self.ids.lock().ok().and_then(|ids| ids.get(&next).cloned()) {
                id = known;
                current = next;
                continue;
            }
            let found = self.children(&id, Some(&format!("name = {}", quote(segment))))?.into_iter().next();
            id = match found {
                Some(file) => file.id,
                None if create => {
                    let body = serde_json::json!({ "name": segment, "mimeType": FOLDER, "parents": [id] });
                    let request = self.request(Method::POST, &format!("{DRIVE}/files?fields=id"))?.json(&body);
                    let created: serde_json::Value = self.send(request, "建立文件夹")?.json().map_err(|_| RemoteError::Server("Google Drive 的回复看不懂".into()))?;
                    created.get("id").and_then(|value| value.as_str()).ok_or_else(|| RemoteError::Server("Google Drive 没有给出新文件夹的编号".into()))?.to_string()
                }
                None => return Err(RemoteError::NotFound),
            };
            if let Ok(mut ids) = self.ids.lock() {
                ids.insert(next.clone(), id.clone());
            }
            current = next;
        }
        Ok(id)
    }

    fn forget(&self, path: &str) {
        let normalized = format!("/{}", path.trim_matches('/'));
        if let Ok(mut ids) = self.ids.lock() {
            ids.retain(|key, _| key != &normalized && !key.starts_with(&format!("{normalized}/")));
        }
    }

    fn split(path: &str) -> (String, String) {
        let trimmed = path.trim_matches('/');
        match trimmed.rsplit_once('/') {
            Some((parent, name)) => (format!("/{parent}"), name.to_string()),
            None => ("/".to_string(), trimmed.to_string()),
        }
    }
}

impl Remote for GoogleDrive {

    fn account(&self) -> RemoteResult<String> {
        let request = self.request(Method::GET, &format!("{DRIVE}/about?fields=user(displayName,emailAddress)"))?;
        let about: About = self.send(request, "读取账户")?.json().map_err(|_| RemoteError::Server("Google Drive 的账户信息看不懂".into()))?;
        Ok(about.user.email.or(about.user.display).unwrap_or_else(|| "Google 账户".into()))
    }

    fn list(&self, path: &str) -> RemoteResult<Vec<Entry>> {
        let id = self.resolve(path, false)?;
        Ok(self
            .children(&id, None)?
            .into_iter()
            .map(|file| Entry { is_dir: file.mime == FOLDER, size: file.size.and_then(|size| size.parse().ok()).unwrap_or(0), name: file.name })
            .collect())
    }

    fn ensure_dir(&self, path: &str) -> RemoteResult<()> {
        self.resolve(path, true).map(|_| ())
    }

    fn upload(&self, path: &str, reader: Box<dyn Read + Send>, size: u64) -> RemoteResult<()> {
        let (parent, name) = Self::split(path);
        let parent_id = self.resolve(&parent, true)?;
        let existing = self.children(&parent_id, Some(&format!("name = {}", quote(&name))))?.into_iter().find(|file| file.mime != FOLDER);
        // 先开一个可续传的会话，再把整个文件 PUT 上去。
        let start = match &existing {
            Some(file) => self.request(Method::PATCH, &format!("{UPLOAD}/files/{}?uploadType=resumable", file.id))?.json(&serde_json::json!({})),
            None => self.request(Method::POST, &format!("{UPLOAD}/files?uploadType=resumable"))?.json(&serde_json::json!({ "name": name, "parents": [parent_id] })),
        };
        let response = self.send(start.header("X-Upload-Content-Length", size.to_string()), "上传")?;
        let location = response
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| RemoteError::Server("Google Drive 没有给出上传地址".into()))?
            .to_string();
        let request = self.client.put(location).timeout(Duration::from_secs(600)).body(Body::sized(reader, size));
        self.send(request, "上传")?;
        Ok(())
    }

    fn download(&self, path: &str, target: &mut dyn std::io::Write) -> RemoteResult<u64> {
        let id = self.resolve(path, false)?;
        let mut response = self.send(self.request(Method::GET, &format!("{DRIVE}/files/{id}?alt=media"))?, "下载")?;
        response.copy_to(target).map_err(|error| RemoteError::Network(error.to_string()))
    }

    fn delete(&self, path: &str) -> RemoteResult<()> {
        let id = match self.resolve(path, false) {
            Ok(id) => id,
            Err(RemoteError::NotFound) => return Ok(()),
            Err(error) => return Err(error),
        };
        let result = match self.send(self.request(Method::DELETE, &format!("{DRIVE}/files/{id}"))?, "删除") {
            Ok(_) | Err(RemoteError::NotFound) => Ok(()),
            Err(error) => Err(error),
        };
        self.forget(path);
        result
    }
}

/// 退出登录时撤销刷新令牌（尽力而为，失败不影响退出）。
pub fn revoke(client: &Client, refresh_token: &str) {
    let _ = client.post("https://oauth2.googleapis.com/revoke").form(&[("token", refresh_token)]).timeout(Duration::from_secs(10)).send();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_names_for_queries() {
        assert_eq!(quote("Test"), "'Test'");
        assert_eq!(quote("it's a\\b"), "'it\\'s a\\\\b'");
    }

    #[test]
    fn splits_paths_into_parent_and_name() {
        assert_eq!(GoogleDrive::split("/Test/database/1.db"), ("/Test/database".to_string(), "1.db".to_string()));
        assert_eq!(GoogleDrive::split("/index.json"), ("/".to_string(), "index.json".to_string()));
    }
}
