//! OneDrive：Microsoft Graph 的 drive 接口，按路径访问「我的文件」（`/me/drive/root:/路径:`）。
//!
//! 权限：Files.ReadWrite（读写用户的文件，远程文件夹可以选在任何位置）、User.Read（显示登录的账户）、offline_access（刷新令牌）。
//! 4 MB 以内的文件一次 PUT 上传，更大的建上传会话分块上传（每块 320 KB 的整数倍）。

use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::Method;
use reqwest::blocking::{Body, Client, RequestBuilder, Response};
use serde::Deserialize;

use super::oauth::{self, Provider, Tokens};
use super::remote::{Entry, Remote, RemoteError, RemoteResult, encode_path, http_error, network_text};

const GRAPH: &str = "https://graph.microsoft.com/v1.0";
/// 一次 PUT 上传的上限。
const SIMPLE_LIMIT: u64 = 4 * 1024 * 1024;
/// 分块上传每块的大小：320 KiB 的 16 倍。
const CHUNK: u64 = 320 * 1024 * 16;

/// 构建时写进程序的客户端编号；空的表示没有，要用设置页里填的。
pub const BUILTIN_CLIENT: &str = match option_env!("SIDENOTES_ONEDRIVE_CLIENT_ID") {
    Some(value) => value,
    None => "",
};

/// OneDrive 登录的端点与客户端。
pub fn provider(client_id: &str) -> Provider {
    let tenant = option_env!("SIDENOTES_ONEDRIVE_TENANT").filter(|value| !value.is_empty()).unwrap_or("common");
    Provider {
        name: "OneDrive",
        authorize_url: format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"),
        token_url: format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"),
        client_id: client_id.trim().to_string(),
        client_secret: None,
        scope: "Files.ReadWrite User.Read offline_access",
        redirect_host: "localhost",
        extra: &[("prompt", "select_account")],
    }
}

/// OneDrive 的连接：刷新令牌换来的访问令牌放在内存里，过期前重新换。
pub struct OneDrive {
    client: Client,
    provider: Provider,
    refresh_token: Mutex<String>,
    access: Mutex<Option<(String, Instant)>>,
    /// 刷新时换了新的刷新令牌，调用方要存下来。
    rotated: Mutex<Option<String>>,
}

#[derive(Deserialize)]
struct Children {
    value: Vec<Item>,
    #[serde(rename = "@odata.nextLink")]
    next: Option<String>,
}

#[derive(Deserialize)]
struct Item {
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    folder: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Me {
    #[serde(rename = "userPrincipalName", default)]
    principal: Option<String>,
    #[serde(default)]
    mail: Option<String>,
    #[serde(rename = "displayName", default)]
    display: Option<String>,
}

#[derive(Deserialize)]
struct Session {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
}

/// Graph 里按路径定位的写法：根目录是 `/me/drive/root`，其余是 `/me/drive/root:/a/b:`。
fn item(path: &str) -> String {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() { format!("{GRAPH}/me/drive/root") } else { format!("{GRAPH}/me/drive/root:{}:", encode_path(&format!("/{trimmed}"))) }
}

impl OneDrive {
    pub fn new(client: Client, provider: Provider, refresh_token: String) -> Self {
        OneDrive { client, provider, refresh_token: Mutex::new(refresh_token), access: Mutex::new(None), rotated: Mutex::new(None) }
    }

    /// 登录后拿到的第一组令牌直接用上，省一次刷新。
    pub fn with_tokens(client: Client, provider: Provider, tokens: &Tokens) -> Self {
        let drive = OneDrive::new(client, provider, tokens.refresh.clone().unwrap_or_default());
        *drive.access.lock().expect("令牌") = Some((tokens.access.clone(), tokens.expires_at));
        drive
    }

    /// 刷新时换来的新刷新令牌（只取一次）。
    pub fn take_rotated(&self) -> Option<String> {
        self.rotated.lock().ok()?.take()
    }

    fn token(&self) -> RemoteResult<String> {
        let mut access = self.access.lock().map_err(|_| RemoteError::Config("登录状态异常".into()))?;
        if let Some((token, expires)) = access.as_ref() {
            if Instant::now() < *expires {
                return Ok(token.clone());
            }
        }
        let refresh = self.refresh_token.lock().map_err(|_| RemoteError::Config("登录状态异常".into()))?.clone();
        let tokens = oauth::refresh(&self.client, &self.provider, &refresh)?;
        if let Some(rotated) = tokens.refresh.clone() {
            *self.refresh_token.lock().map_err(|_| RemoteError::Config("登录状态异常".into()))? = rotated.clone();
            *self.rotated.lock().map_err(|_| RemoteError::Config("登录状态异常".into()))? = Some(rotated);
        }
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
        if status.as_u16() == 507 || text.contains("quotaLimitReached") {
            return Err(RemoteError::Server("OneDrive 的空间不够了".into()));
        }
        Err(http_error(status.as_u16(), &text, action))
    }

    fn create_folder(&self, parent: &str, name: &str) -> RemoteResult<()> {
        let body = serde_json::json!({ "name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail" });
        let request = self.request(Method::POST, &format!("{}/children", item(parent)))?.json(&body);
        match self.send(request, "建立文件夹") {
            Ok(_) => Ok(()),
            // 409：已经有同名的。
            Err(RemoteError::Server(message)) if message.contains("409") => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn upload_session(&self, path: &str, mut reader: Box<dyn Read + Send>, size: u64) -> RemoteResult<()> {
        let body = serde_json::json!({ "item": { "@microsoft.graph.conflictBehavior": "replace" } });
        let request = self.request(Method::POST, &format!("{}/createUploadSession", item(path)))?.json(&body);
        let session: Session = self.send(request, "上传")?.json().map_err(|_| RemoteError::Server("OneDrive 的上传会话看不懂".into()))?;
        let mut offset = 0u64;
        let mut buffer = vec![0u8; CHUNK as usize];
        while offset < size {
            let length = CHUNK.min(size - offset) as usize;
            reader.read_exact(&mut buffer[..length]).map_err(|error| RemoteError::Config(format!("读本地文件失败：{error}")))?;
            // 上传地址自带授权，不能再加 Authorization。
            let request = self
                .client
                .put(&session.upload_url)
                .header("Content-Range", format!("bytes {}-{}/{size}", offset, offset + length as u64 - 1))
                .timeout(Duration::from_secs(300))
                .body(buffer[..length].to_vec());
            self.send(request, "上传")?;
            offset += length as u64;
        }
        Ok(())
    }
}

impl Remote for OneDrive {

    fn account(&self) -> RemoteResult<String> {
        let request = self.request(Method::GET, &format!("{GRAPH}/me?$select=userPrincipalName,mail,displayName"))?;
        let me: Me = self.send(request, "读取账户")?.json().map_err(|_| RemoteError::Server("OneDrive 的账户信息看不懂".into()))?;
        Ok(me.mail.or(me.principal).or(me.display).unwrap_or_else(|| "OneDrive 账户".into()))
    }

    fn list(&self, path: &str) -> RemoteResult<Vec<Entry>> {
        let mut url = format!("{}/children?$select=name,size,folder&$top=200", item(path));
        let mut entries = Vec::new();
        loop {
            let page: Children = self.send(self.request(Method::GET, &url)?, "读取目录")?.json().map_err(|_| RemoteError::Server("OneDrive 的目录看不懂".into()))?;
            entries.extend(page.value.into_iter().map(|item| Entry { name: item.name, is_dir: item.folder.is_some(), size: item.size }));
            match page.next {
                Some(next) => url = next,
                None => return Ok(entries),
            }
        }
    }

    fn ensure_dir(&self, path: &str) -> RemoteResult<()> {
        let mut parent = String::from("/");
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            self.create_folder(&parent, segment)?;
            parent = super::remote::join(&parent, segment);
        }
        Ok(())
    }

    fn upload(&self, path: &str, reader: Box<dyn Read + Send>, size: u64) -> RemoteResult<()> {
        if size > SIMPLE_LIMIT {
            return self.upload_session(path, reader, size);
        }
        let request = self.request(Method::PUT, &format!("{}/content", item(path)))?.body(Body::sized(reader, size));
        self.send(request, "上传")?;
        Ok(())
    }

    fn download(&self, path: &str, target: &mut dyn std::io::Write) -> RemoteResult<u64> {
        let mut response = self.send(self.request(Method::GET, &format!("{}/content", item(path)))?, "下载")?;
        response.copy_to(target).map_err(|error| RemoteError::Network(error.to_string()))
    }

    fn delete(&self, path: &str) -> RemoteResult<()> {
        match self.send(self.request(Method::DELETE, &item(path))?, "删除") {
            Ok(_) | Err(RemoteError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_items_by_path() {
        assert_eq!(item("/"), format!("{GRAPH}/me/drive/root"));
        assert_eq!(item("/Test/database/1.db"), format!("{GRAPH}/me/drive/root:/Test/database/1.db:"));
        assert_eq!(item("/备份 1"), format!("{GRAPH}/me/drive/root:/%E5%A4%87%E4%BB%BD%201:"));
        assert_eq!(CHUNK % (320 * 1024), 0);
    }
}
