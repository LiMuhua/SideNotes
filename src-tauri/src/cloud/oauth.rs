//! OneDrive 与 Google Drive 的登录：OAuth 2.0 授权码流程加 PKCE，回调地址是本机的回环地址（RFC 8252）。
//!
//! 同 VS Code 等桌面应用登录 GitHub 的做法：「登录」时应用在本机回环地址的随机端口上临时开一个回调服务，在默认浏览器里打开
//! 服务的登录页；用户登录、同意之后浏览器跳回这个端口，应用拿到授权码自动换取令牌，用户不用复制粘贴。浏览器没能跳回来时
//! （端口被拦），可以把地址栏里的回调网址或授权码粘贴回设置页。只保存刷新令牌（加密存在本机，见 secrets），访问令牌用时再换、
//! 只放在内存里。客户端编号只用构建时写进程序的（见 build.rs），用户不用注册。

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::remote::{RemoteError, RemoteResult, network_text};

/// 一个 OAuth 服务的端点与客户端。
#[derive(Debug, Clone)]
pub struct Provider {
    /// 给用户看的名字。
    pub name: &'static str,
    pub authorize_url: String,
    pub token_url: String,
    pub client_id: String,
    /// 客户端密钥，有就在换令牌与刷新时带上。Google 的客户端必须带（「Web 应用」与「桌面应用」类型都是，不带报
    /// client_secret is missing.，文档写的「可选」不成立；密钥随程序分发，Google 认为桌面应用的密钥不算机密）。
    /// Microsoft 的公共客户端没有密钥。
    pub client_secret: Option<String>,
    pub scope: &'static str,
    /// 刷新令牌时要不要再写一遍范围（微软要，Google 不用）。
    pub refresh_scope: bool,
    /// 授权页额外的参数。
    pub extra: &'static [(&'static str, &'static str)],
}

/// 令牌接口的回复。
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

/// 换到的令牌。
#[derive(Debug, Clone)]
pub struct Tokens {
    pub access: String,
    /// 新的刷新令牌（Microsoft 每次刷新可能换一个）；没给时沿用原来的。
    pub refresh: Option<String>,
    pub expires_at: Instant,
}

/// 等回调或粘贴的最长时间。
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);

/// 回调地址的主机名，两家都用 localhost：Microsoft 的公共客户端登记的是 `http://localhost`；Google 的客户端是「Web 应用」类型，
/// 只认登记过的 `http://localhost`（端口不限），`127.0.0.1` 报 redirect_uri_mismatch（「桌面应用」类型两种都认）。
/// 监听同时绑了 IPv4 与 IPv6，浏览器把 localhost 解析成哪个都收得到。
const REDIRECT_HOST: &str = "localhost";

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("系统随机数");
    bytes
}

/// base64url，不带填充（PKCE 与 state 用）。
pub fn base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        let count = chunk.len() + 1;
        for index in 0..count {
            text.push(TABLE[((value >> (18 - 6 * index)) & 63) as usize] as char);
        }
    }
    text
}

/// PKCE：随机的校验码与它的 S256 摘要。
pub fn pkce() -> (String, String) {
    let verifier = base64url(&random_bytes::<32>());
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// 从回调请求的第一行（`GET /?code=…&state=… HTTP/1.1`）取出查询参数。
fn callback_query(request_line: &str) -> Vec<(String, String)> {
    let target = request_line.split_whitespace().nth(1).unwrap_or_default();
    let query = target.split_once('?').map(|(_, query)| query).unwrap_or_default();
    url::form_urlencoded::parse(query.as_bytes()).into_owned().collect()
}

/// 回给浏览器的页面。
fn reply(stream: &mut TcpStream, ok: bool, message: &str) {
    let title = if ok { "已登录" } else { "登录没有完成" };
    let color = if ok { "#28a745" } else { "#c62828" };
    let body = format!(
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>SideNotes {title}</title></head>\
         <body style=\"font-family:'Segoe UI',sans-serif;background:#f4f6f8;padding:40px\">\
         <div style=\"max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;border-top:4px solid {color}\">\
         <h2 style=\"margin-top:0;color:#333\">SideNotes {title}</h2><p style=\"color:#555;line-height:1.6\">{}</p></div></body></html>",
        html_escape(message)
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// 监听回环地址：先绑 IPv4 的随机端口，再在 IPv6 上绑同一个端口（浏览器把 localhost 解析成 ::1 时也能收到），后者失败不要紧。
fn listen() -> RemoteResult<(Vec<TcpListener>, u16)> {
    let v4 = TcpListener::bind("127.0.0.1:0").map_err(|error| RemoteError::Config(format!("没能在本机开端口等登录回调：{error}")))?;
    let port = v4.local_addr().map_err(|error| RemoteError::Config(error.to_string()))?.port();
    let mut listeners = vec![v4];
    if let Ok(v6) = TcpListener::bind(("::1", port)) {
        listeners.push(v6);
    }
    for listener in &listeners {
        listener.set_nonblocking(true).map_err(|error| RemoteError::Config(error.to_string()))?;
    }
    Ok((listeners, port))
}

/// 从用户粘贴的文字里取授权码：可以是整个回调网址（带 code 与 state），也可以只是授权码本身。
/// 网址里的 state 与这次登录的对不上时拒绝。
pub fn pasted_code(text: &str, state: &str) -> RemoteResult<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(RemoteError::Config("请粘贴授权码或浏览器地址栏里的网址".into()));
    }
    if text.contains("code=") || text.contains("error=") {
        let query = text.split_once('?').map(|(_, query)| query).unwrap_or(text);
        let query = query.split('#').next().unwrap_or(query);
        let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        let get = |key: &str| pairs.iter().find(|(name, _)| name == key).map(|(_, value)| value.clone());
        if let Some(error) = get("error") {
            return Err(RemoteError::Auth(format!("登录没有完成：{}", get("error_description").unwrap_or(error))));
        }
        if get("state").is_some_and(|returned| returned != state) {
            return Err(RemoteError::Config("这是另一次登录的网址，请用这次打开的登录页".into()));
        }
        return get("code").filter(|code| !code.is_empty()).ok_or_else(|| RemoteError::Config("网址里没有授权码".into()));
    }
    if text.chars().any(char::is_whitespace) {
        return Err(RemoteError::Config("授权码里不该有空格，请重新复制".into()));
    }
    Ok(text.to_string())
}

/// 等一次带 state 的回调或用户粘贴的授权码，返回授权码。被取消、超时或服务返回错误时返回错误。
fn wait_for_code(listeners: &[TcpListener], state: &str, cancel: &AtomicBool, pasted: &Mutex<Option<String>>) -> RemoteResult<String> {
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        if cancel.load(Ordering::SeqCst) {
            return Err(RemoteError::Config("已取消登录".into()));
        }
        if let Some(text) = pasted.lock().ok().and_then(|mut slot| slot.take()) {
            return pasted_code(&text, state);
        }
        for listener in listeners {
            let Ok((mut stream, _)) = listener.accept() else {
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut line = String::new();
            if BufReader::new(&stream).read_line(&mut line).is_err() {
                continue;
            }
            let query = callback_query(&line);
            let get = |key: &str| query.iter().find(|(name, _)| name == key).map(|(_, value)| value.clone());
            // 浏览器顺带请求的 favicon 之类，没有 state 的不理会。
            let Some(returned_state) = get("state") else {
                reply(&mut stream, false, "这不是 SideNotes 的登录回调。");
                continue;
            };
            if returned_state != state {
                reply(&mut stream, false, "登录回调对不上，请回到 SideNotes 重新点「登录」。");
                continue;
            }
            if let Some(error) = get("error") {
                let detail = get("error_description").unwrap_or(error);
                reply(&mut stream, false, &format!("登录被拒绝或取消：{detail}"));
                return Err(RemoteError::Auth(format!("登录没有完成：{detail}")));
            }
            let Some(code) = get("code") else {
                reply(&mut stream, false, "回调里没有授权码。");
                return Err(RemoteError::Auth("登录回调里没有授权码".into()));
            };
            reply(&mut stream, true, "可以关掉这个页面，回到 SideNotes。");
            return Ok(code);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(RemoteError::Config("等了 10 分钟没有完成登录，请重新点「登录」".into()))
}

fn token_request(client: &Client, provider: &Provider, form: &[(&str, &str)]) -> RemoteResult<Tokens> {
    let mut form: Vec<(&str, &str)> = form.to_vec();
    form.push(("client_id", &provider.client_id));
    if let Some(secret) = &provider.client_secret {
        form.push(("client_secret", secret));
    }
    let response = client
        .post(&provider.token_url)
        .form(&form)
        .send()
        .map_err(|error| RemoteError::Network(network_text(&error)))?;
    let status = response.status();
    let text = response.text().unwrap_or_default();
    if !status.is_success() {
        // invalid_grant：刷新令牌过期或被撤销，要重新登录。
        let reason = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|value| value.get("error").and_then(|error| error.as_str()).map(str::to_string))
            .unwrap_or_default();
        return Err(if reason == "invalid_grant" || status.as_u16() == 400 || status.as_u16() == 401 {
            RemoteError::Auth(format!("{} 的登录已失效，请重新登录", provider.name))
        } else {
            super::remote::http_error(status.as_u16(), &text, "换取登录令牌")
        });
    }
    let token: TokenResponse = serde_json::from_str(&text).map_err(|_| RemoteError::Server("登录服务的回复看不懂".into()))?;
    Ok(Tokens {
        access: token.access_token,
        refresh: token.refresh_token.filter(|value| !value.is_empty()),
        // 提前一分钟当作过期。
        expires_at: Instant::now() + Duration::from_secs(token.expires_in.unwrap_or(3600).saturating_sub(60)),
    })
}

/// 走一遍登录：打开浏览器（由 `open` 打开网址），等回调或粘贴的授权码，换令牌。返回的令牌里必须有刷新令牌。
pub fn login(
    client: &Client,
    provider: &Provider,
    cancel: &AtomicBool,
    pasted: &Mutex<Option<String>>,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> RemoteResult<Tokens> {
    if provider.client_id.is_empty() {
        return Err(RemoteError::Config(format!("这个版本还不能登录 {}：构建时没有带上客户端编号", provider.name)));
    }
    let (listeners, port) = listen()?;
    let redirect = format!("http://{REDIRECT_HOST}:{port}");
    let (verifier, challenge) = pkce();
    let state = base64url(&random_bytes::<16>());
    let mut url = url::Url::parse(&provider.authorize_url).map_err(|error| RemoteError::Config(error.to_string()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &provider.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect)
            .append_pair("scope", provider.scope)
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        for (key, value) in provider.extra {
            query.append_pair(key, value);
        }
    }
    open(url.as_str()).map_err(|error| RemoteError::Config(format!("打不开浏览器：{error}")))?;
    let code = wait_for_code(&listeners, &state, cancel, pasted)?;
    let tokens = token_request(
        client,
        provider,
        &[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier)],
    )?;
    if tokens.refresh.is_none() {
        return Err(RemoteError::Auth(format!("{} 没有给出长期的登录凭据，请重新登录", provider.name)));
    }
    Ok(tokens)
}

/// 用刷新令牌换新的访问令牌。
pub fn refresh(client: &Client, provider: &Provider, refresh_token: &str) -> RemoteResult<Tokens> {
    if provider.client_id.is_empty() {
        return Err(RemoteError::Config(format!("这个版本没有带上 {} 的客户端编号，登录不了", provider.name)));
    }
    let mut form = vec![("grant_type", "refresh_token"), ("refresh_token", refresh_token)];
    if provider.refresh_scope {
        form.push(("scope", provider.scope));
    }
    token_request(client, provider, &form)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc4648_without_padding() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn pkce_challenge_is_the_s256_of_the_verifier() {
        // RFC 7636 附录 B 的例子。
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(base64url(&Sha256::digest(verifier.as_bytes())), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let (verifier, challenge) = pkce();
        assert_eq!(verifier.len(), 43);
        assert_eq!(challenge, base64url(&Sha256::digest(verifier.as_bytes())));
    }

    #[test]
    fn reads_the_callback_query() {
        let query = callback_query("GET /?code=abc%2F1&state=xyz HTTP/1.1\r\n");
        assert_eq!(query, vec![("code".to_string(), "abc/1".to_string()), ("state".to_string(), "xyz".to_string())]);
        assert!(callback_query("GET /favicon.ico HTTP/1.1").is_empty());
    }

    #[test]
    fn the_listener_hands_back_the_code_and_rejects_a_wrong_state() {
        let (listeners, port) = listen().unwrap();
        let cancel = AtomicBool::new(false);
        let worker = std::thread::spawn(move || {
            let send = |path: &str| {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
                let mut page = String::new();
                let _ = std::io::Read::read_to_string(&mut stream, &mut page);
                page
            };
            let wrong = send("/?code=1&state=other");
            let right = send("/?code=the-code&state=expected");
            (wrong, right)
        });
        let code = wait_for_code(&listeners, "expected", &cancel, &Mutex::new(None)).unwrap();
        let (wrong, right) = worker.join().unwrap();
        assert_eq!(code, "the-code");
        assert!(wrong.contains("对不上"));
        assert!(right.contains("可以关掉这个页面"));
    }

    #[test]
    fn cancelling_stops_waiting() {
        let (listeners, _) = listen().unwrap();
        let cancel = AtomicBool::new(true);
        assert_eq!(wait_for_code(&listeners, "s", &cancel, &Mutex::new(None)), Err(RemoteError::Config("已取消登录".into())));
    }

    #[test]
    fn a_pasted_url_or_code_finishes_the_wait() {
        let (listeners, _) = listen().unwrap();
        let cancel = AtomicBool::new(false);
        let pasted = Mutex::new(Some("http://127.0.0.1:5000/?code=M.C123&state=s1".to_string()));
        assert_eq!(wait_for_code(&listeners, "s1", &cancel, &pasted).unwrap(), "M.C123");
        assert_eq!(pasted_code("  4/0AbCd-Ef  ", "s1").unwrap(), "4/0AbCd-Ef");
        assert!(pasted_code("http://127.0.0.1/?code=x&state=other", "s1").is_err());
        assert!(pasted_code("http://127.0.0.1/?error=access_denied&state=s1", "s1").is_err());
        assert!(pasted_code("two words", "s1").is_err());
        assert!(pasted_code("", "s1").is_err());
    }
}
