//! 群晖 NAS 等 WebDAV 服务：用户名与密码走基本认证（只允许 https，http 只给本机与局域网地址）。
//!
//! 用到的请求：PROPFIND（列目录、测连接）、MKCOL（建目录）、PUT（上传）、GET（下载）、DELETE（删除）。
//! 群晖的 WebDAV Server 默认在 5006 端口提供 https。

use std::io::Read;
use std::net::{SocketAddr, ToSocketAddrs};
use std::time::Duration;

use quick_xml::Reader;
use quick_xml::events::Event;
use reqwest::Method;
use reqwest::blocking::{Body, Client, RequestBuilder, Response};

use super::remote::{Entry, Remote, RemoteError, RemoteResult, encode_path, http_error};

/// WebDAV 服务的连接。
pub struct WebDav {
    client: Client,
    /// 去掉末尾斜杠的服务地址，例如 `https://nas.example.com:5006`。按证书上的名字验证时，主机名换成那个名字（见 build_client）。
    base: String,
    username: String,
    password: String,
}

/// 地址是不是本机或局域网（这些地址允许用 http）。
fn is_local_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") || host.ends_with(".lan") {
        return true;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        Err(_) => false,
    }
}

/// 检查并规范服务地址：要有 https（局域网可以 http）与主机名，去掉末尾的斜杠。
pub fn normalize_endpoint(endpoint: &str) -> Result<String, String> {
    let endpoint = endpoint.trim();
    let url = url::Url::parse(endpoint).map_err(|_| "请填写完整的地址，例如 https://nas.example.com:5006".to_string())?;
    let host = url.host_str().ok_or("地址里没有主机名")?.to_string();
    match url.scheme() {
        "https" => {}
        "http" if is_local_host(&host) => {}
        "http" => return Err("外网地址请用 https，密码不能明文传过去".into()),
        _ => return Err("地址要以 https:// 开头".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("用户名与密码请分开填写，不要写进地址".into());
    }
    Ok(endpoint.trim_end_matches('/').to_string())
}

/// 群晖 NAS 直连，不走系统代理：NAS 多在局域网里，代理连不到；按证书上的名字验证时靠覆盖 DNS 解析把连接发往原来的地址，
/// 经过代理就不灵了。
fn builder() -> reqwest::blocking::ClientBuilder {
    Client::builder().no_proxy().connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(300)).user_agent(super::USER_AGENT)
}

/// 地址的主机与端口解析出的套接字地址（IP 直接用）。
fn socket_of(url: &url::Url) -> Result<SocketAddr, RemoteError> {
    let host = url.host_str().ok_or_else(|| RemoteError::Config("地址里没有主机名".into()))?;
    let port = url.port_or_known_default().unwrap_or(443);
    (host.trim_start_matches('[').trim_end_matches(']'), port)
        .to_socket_addrs()
        .map_err(|error| RemoteError::Network(format!("找不到 {host}：{error}")))?
        .next()
        .ok_or_else(|| RemoteError::Network(format!("找不到 {host}")))
}

/// 建连接用的客户端与服务地址。`tls_name` 不为空时，按证书上的这个名字验证证书：网址的主机换成这个名字，
/// 连接仍然发往原来的地址（DNS 解析被覆盖），系统照常检查证书链与名字。NAS 用 IP 访问、证书是给域名的（例如
/// Let's Encrypt 的 *.example.com）时用得上；证书续期后照样有效，而别的证书（哪怕也受信任）对不上这个名字就连不上。
pub(super) fn build_client(endpoint: &str, tls_name: &str) -> Result<(Client, String), RemoteError> {
    let base = normalize_endpoint(endpoint).map_err(RemoteError::Config)?;
    let tls_name = tls_name.trim();
    if tls_name.is_empty() {
        let client = builder().build().map_err(|error| RemoteError::Network(error.to_string()))?;
        return Ok((client, base));
    }
    let mut url = url::Url::parse(&base).map_err(|error| RemoteError::Config(error.to_string()))?;
    if url.scheme() != "https" {
        return Err(RemoteError::Config("只有 https 的地址才按证书上的名字验证".into()));
    }
    let address = socket_of(&url)?;
    url.set_host(Some(tls_name)).map_err(|_| RemoteError::Config(format!("「{tls_name}」不是有效的名字")))?;
    let client = builder().resolve(tls_name, address).build().map_err(|error| RemoteError::Network(error.to_string()))?;
    Ok((client, url.as_str().trim_end_matches('/').to_string()))
}

impl WebDav {
    /// `tls_name` 为空时照常按地址里的主机名验证证书，见 build_client。
    pub fn new(endpoint: &str, username: &str, password: &str, tls_name: &str) -> Result<Self, RemoteError> {
        if username.trim().is_empty() || password.is_empty() {
            return Err(RemoteError::Config(String::from("请填写用户名与密码")));
        }
        let (client, base) = build_client(endpoint, tls_name)?;
        Ok(WebDav { client, base, username: username.trim().to_string(), password: password.to_string() })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, encode_path(path))
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.client.request(method, self.url(path)).basic_auth(&self.username, Some(&self.password))
    }

    fn send(&self, request: RequestBuilder, action: &str) -> RemoteResult<Response> {
        let response = request.send().map_err(|error| RemoteError::Network(super::remote::network_text(&error)))?;
        let status = response.status();
        if status.is_success() || status.as_u16() == 207 {
            return Ok(response);
        }
        Err(match status.as_u16() {
            401 => RemoteError::Auth("用户名或密码不对".into()),
            403 => RemoteError::Auth(format!("没有权限{action}（检查这个账户对共享文件夹的读写权限）")),
            404 => RemoteError::NotFound,
            507 => RemoteError::Server("NAS 的空间不够了".into()),
            _ => http_error(status.as_u16(), &response.text().unwrap_or_default(), action),
        })
    }

    /// PROPFIND Depth: 1，返回目录下的直接子项（不含目录自己）。
    fn propfind(&self, path: &str) -> RemoteResult<Vec<Entry>> {
        let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"#;
        let request = self
            .request(Method::from_bytes(b"PROPFIND").expect("PROPFIND"), path)
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(body);
        let text = self.send(request, "读取目录")?.text().map_err(|error| RemoteError::Network(error.to_string()))?;
        let own = url::Url::parse(&self.url(path)).map(|url| url.path().trim_end_matches('/').to_string()).unwrap_or_default();
        Ok(parse_multistatus(&text).into_iter().filter(|entry| entry.0.trim_end_matches('/') != own).map(|entry| entry.1).collect())
    }
}

/// 解析 PROPFIND 的回复，返回（href 的路径部分, 子项）。只认 DAV: 命名空间里的 response、href、collection、getcontentlength，
/// 前缀写成什么都可以（群晖是 D:，有的服务是 d: 或不带前缀）。
fn parse_multistatus(text: &str) -> Vec<(String, Entry)> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut entries = Vec::new();
    let mut href = String::new();
    let mut is_dir = false;
    let mut size = 0u64;
    let mut field: Option<&'static str> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                let name = start.local_name();
                match name.as_ref() {
                    "response" => {
                        href.clear();
                        is_dir = false;
                        size = 0;
                    }
                    "href" => field = Some("href"),
                    "getcontentlength" => field = Some("length"),
                    "collection" => is_dir = true,
                    _ => {}
                }
            }
            Ok(Event::Empty(empty)) if empty.local_name().as_ref() == "collection" => is_dir = true,
            Ok(Event::Text(text)) => {
                let value = text.xml10_content().into_owned();
                match field {
                    Some("href") => href.push_str(&value),
                    Some("length") => size = value.trim().parse().unwrap_or(0),
                    _ => {}
                }
            }
            Ok(Event::GeneralRef(reference)) if field == Some("href") => {
                // &amp; 之类的实体引用。
                href.push_str(match &*reference {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    "apos" => "'",
                    _ => "",
                });
            }
            Ok(Event::End(end)) => {
                let name = end.local_name();
                match name.as_ref() {
                    "href" | "getcontentlength" => field = None,
                    "response" => {
                        let path = url::Url::parse(&href).map(|url| url.path().to_string()).unwrap_or_else(|_| href.clone());
                        let decoded = percent_encoding::percent_decode_str(&path).decode_utf8_lossy().into_owned();
                        let trimmed = decoded.trim_end_matches('/');
                        let name = trimmed.rsplit('/').next().unwrap_or_default().to_string();
                        entries.push((path.clone(), Entry { name, is_dir, size }));
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    entries
}

impl Remote for WebDav {

    fn account(&self) -> RemoteResult<String> {
        // 能列出根目录就说明地址、用户名与密码都对。
        self.propfind("/")?;
        Ok(self.username.clone())
    }

    fn list(&self, path: &str) -> RemoteResult<Vec<Entry>> {
        self.propfind(path)
    }

    fn ensure_dir(&self, path: &str) -> RemoteResult<()> {
        let mut current = String::new();
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            current.push('/');
            current.push_str(segment);
            match self.send(self.request(Method::from_bytes(b"MKCOL").expect("MKCOL"), &format!("{current}/")), "建立文件夹") {
                Ok(_) => {}
                // 已经有了：405 Method Not Allowed；有的服务回 301 或 409。
                Err(RemoteError::Server(message)) if message.contains("405") || message.contains("301") => {}
                Err(error) => {
                    // 再确认一下是不是已经存在。
                    if self.propfind(&format!("{current}/")).is_err() {
                        return Err(error);
                    }
                }
            }
        }
        Ok(())
    }

    fn upload(&self, path: &str, reader: Box<dyn Read + Send>, size: u64) -> RemoteResult<()> {
        let request = self.request(Method::PUT, path).header("Content-Type", "application/octet-stream").body(Body::sized(reader, size));
        self.send(request, "上传")?;
        Ok(())
    }

    fn download(&self, path: &str, target: &mut dyn std::io::Write) -> RemoteResult<u64> {
        let mut response = self.send(self.request(Method::GET, path), "下载")?;
        response.copy_to(target).map_err(|error| RemoteError::Network(error.to_string()))
    }

    fn delete(&self, path: &str) -> RemoteResult<()> {
        match self.send(self.request(Method::DELETE, path), "删除") {
            Ok(_) | Err(RemoteError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_requires_https_outside_the_local_network() {
        assert_eq!(normalize_endpoint("https://nas.example.com:5006/").unwrap(), "https://nas.example.com:5006");
        assert!(normalize_endpoint("http://nas.example.com:5005").is_err());
        assert!(normalize_endpoint("http://192.168.1.20:5005").is_ok());
        assert!(normalize_endpoint("http://localhost:8080/dav").is_ok());
        assert!(normalize_endpoint("http://diskstation.local:5005").is_ok());
        assert!(normalize_endpoint("ftp://nas").is_err());
        assert!(normalize_endpoint("nas.example.com").is_err());
        assert!(normalize_endpoint("https://user:pw@nas.example.com").is_err());
    }

    #[test]
    fn parses_synology_style_multistatus() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/home/Test/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/home/Test/database/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/home/Test/%E5%A4%87%E4%BB%BD%20a&amp;b.json</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>42</D:getcontentlength></D:prop></D:propstat></D:response>
</D:multistatus>"#;
        let entries = parse_multistatus(xml);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[1].1, Entry { name: "database".into(), is_dir: true, size: 0 });
        assert_eq!(entries[2].1, Entry { name: "备份 a&b.json".into(), is_dir: false, size: 42 });
    }

    #[test]
    fn parses_unprefixed_and_absolute_hrefs() {
        let xml = r#"<multistatus xmlns="DAV:"><response><href>https://nas:5006/Test/a.db</href><propstat><prop><resourcetype></resourcetype><getcontentlength>7</getcontentlength></prop></propstat></response></multistatus>"#;
        let entries = parse_multistatus(xml);
        assert_eq!(entries, vec![("/Test/a.db".to_string(), Entry { name: "a.db".into(), is_dir: false, size: 7 })]);
    }
}
