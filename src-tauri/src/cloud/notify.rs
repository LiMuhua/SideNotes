//! 备份失败的通知：系统通知，以及通过 Resend 发邮件（照搬 Mail 脚本 `mail_resend.py` 与 `notify/deploy.py` 的做法）。
//!
//! - 邮件用内置的 HTML 模板（`templates/`），字段先做 HTML 转义再填进去；正文里的凭据先屏蔽掉。
//! - 发送带幂等键（正文的 SHA-256），遇到 429、502、503、504 与网络错误最多重试 2 次，间隔 1、2 秒。
//! - 同样的原因只通知一次，备份成功后清掉，下次再出错重新通知（调用方按 Status 的 notified 判断）。

use std::time::Duration;

use reqwest::blocking::Client;
use sha2::{Digest, Sha256};

use super::oauth::html_escape;

const RESEND_URL: &str = "https://api.resend.com/emails";
/// 没填发件地址时用 Resend 的测试地址：只能发给 Resend 账户自己的邮箱。
pub const DEFAULT_FROM: &str = "onboarding@resend.dev";
const FROM_NAME: &str = "SideNotes";
const FAILURE_TEMPLATE: &str = include_str!("../../templates/backup-failure.html");
const TEST_TEMPLATE: &str = include_str!("../../templates/test-mail.html");

/// 屏蔽文本中的常见凭据（同 deploy.py 的 RedactSecrets）：`Bearer xxx`、`api_key=xxx`、`token: xxx`、`password=xxx`、Resend 的 `re_` 密钥。
pub fn redact(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let markers = ["bearer ", "api_key", "api-key", "apikey", "access_token", "refresh_token", "token", "password", "secret"];
    let mut index = 0;
    while index < bytes.len() {
        let rest = &lower[index..];
        let marker = markers.iter().find(|marker| rest.starts_with(**marker));
        if let Some(marker) = marker {
            // 标记之后跳过分隔（空白、=、:、引号），屏蔽接下来的一段。除了 Bearer，标记后面要有 = 或 :（同 deploy.py）。
            let mut end = index + marker.len();
            let mut separated = *marker == "bearer ";
            output.push_str(&text[index..end]);
            while end < bytes.len() && matches!(bytes[end], b' ' | b'=' | b':' | b'"' | b'\'') {
                separated |= matches!(bytes[end], b'=' | b':');
                output.push(bytes[end] as char);
                end += 1;
            }
            let start = end;
            if separated {
                while end < bytes.len() && !matches!(bytes[end], b' ' | b'"' | b'\'' | b',' | b'&' | b'}' | b'\n' | b'\r' | b'<') {
                    end += 1;
                }
            }
            if end > start {
                output.push_str("[REDACTED]");
            }
            index = end;
            continue;
        }
        if rest.starts_with("re_") && (index == 0 || !bytes[index - 1].is_ascii_alphanumeric()) {
            let mut end = index + 3;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            if end - index >= 15 {
                output.push_str("[REDACTED]");
                index = end;
                continue;
            }
        }
        let character = text[index..].chars().next().unwrap_or_default();
        output.push(character);
        index += character.len_utf8().max(1);
    }
    output
}

/// 电脑名，写进邮件里，分得清是哪台电脑。
pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "这台电脑".into())
}

/// 备份失败邮件的内容。
pub struct FailureMail<'a> {
    pub provider: &'a str,
    pub account: &'a str,
    pub folder: &'a str,
    pub reason: &'a str,
    pub failure_time: &'a str,
    pub last_success: &'a str,
    pub trigger: &'a str,
}

/// 把模板里的 `{{名字}}` 换成转义后的值；`raw` 里列出的名字不转义（已经是拼好的 HTML）。
fn fill(template: &str, values: &[(&str, String)], raw: &[&str]) -> String {
    let mut content = template.to_string();
    for (key, value) in values {
        let value = if raw.contains(key) { value.clone() } else { html_escape(value) };
        content = content.replace(&format!("{{{{{key}}}}}"), &value);
    }
    content
}

/// 渲染备份失败的邮件，返回（主题, HTML）。
pub fn failure_mail(mail: &FailureMail) -> (String, String) {
    let reason = redact(mail.reason);
    let rows: String = [("服务", mail.provider), ("账户", mail.account), ("远程文件夹", mail.folder), ("触发", mail.trigger)]
        .iter()
        .map(|(key, value)| {
            format!(
                "<tr><th style=\"text-align:left;vertical-align:top;padding:6px;border-bottom:1px solid #ddd\">{}</th>\
                 <td style=\"padding:6px;border-bottom:1px solid #ddd;overflow-wrap:anywhere\">{}</td></tr>",
                html_escape(key),
                html_escape(value)
            )
        })
        .collect();
    let content = fill(
        FAILURE_TEMPLATE,
        &[
            ("computer", computer_name()),
            ("provider", mail.provider.to_string()),
            ("reason", reason.clone()),
            ("failure_time", mail.failure_time.to_string()),
            ("last_success", mail.last_success.to_string()),
            ("detail_rows", rows),
        ],
        &["detail_rows"],
    );
    let short: String = reason.chars().take(60).collect();
    (format!("[备份失败] SideNotes → {}：{short}", mail.provider), content)
}

/// 渲染测试邮件。
pub fn test_mail(from: &str, send_time: &str) -> (String, String) {
    let content = fill(TEST_TEMPLATE, &[("computer", computer_name()), ("send_time", send_time.to_string()), ("from", from.to_string())], &[]);
    ("[测试] SideNotes 备份失败通知".into(), content)
}

/// 粗查邮箱的写法（同 app.py 的 EMAIL_PATTERN：`^[^@\s]+@[^@\s]+\.[^@\s]+$`）。
pub fn valid_email(address: &str) -> bool {
    let Some((name, domain)) = address.split_once('@') else {
        return false;
    };
    !name.is_empty()
        && !domain.contains('@')
        && !address.chars().any(char::is_whitespace)
        && domain.split_once('.').is_some_and(|(left, right)| !left.is_empty() && !right.is_empty())
}

/// 通过 Resend 发一封邮件；成功时返回邮件编号（有的话）。
pub fn send_mail(client: &Client, api_key: &str, from: &str, to: &str, subject: &str, html: &str) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有填写 Resend 的 API 密钥".into());
    }
    if !valid_email(to) {
        return Err(format!("收件邮箱「{to}」的写法不对"));
    }
    let from = if from.trim().is_empty() { DEFAULT_FROM } else { from.trim() };
    if !valid_email(from) {
        return Err(format!("发件地址「{from}」的写法不对"));
    }
    let payload = serde_json::json!({
        "from": format!("{FROM_NAME} <{from}>"),
        "to": [to],
        "subject": subject,
        "html": html,
    });
    // 同一封通知的重试用同样的幂等键，连接中断后不会重复投递。
    let key = format!("sidenotes-{}", &format!("{:x}", Sha256::digest(html.as_bytes()))[..32]);
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_secs(attempt));
        }
        let result = client
            .post(RESEND_URL)
            .bearer_auth(api_key.trim())
            .header("Idempotency-Key", &key)
            .json(&payload)
            .timeout(Duration::from_secs(30))
            .send();
        match result {
            Ok(response) => {
                let status = response.status().as_u16();
                let text = response.text().unwrap_or_default();
                if status == 200 || status == 201 {
                    let id = serde_json::from_str::<serde_json::Value>(&text)
                        .ok()
                        .and_then(|value| value.get("id").and_then(|id| id.as_str()).map(str::to_string))
                        .unwrap_or_default();
                    return Ok(id);
                }
                let message = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|value| value.get("message").and_then(|message| message.as_str()).map(str::to_string))
                    .unwrap_or_else(|| text.chars().take(200).collect());
                last_error = match status {
                    401 | 403 => format!("Resend 拒绝了这个密钥或发件地址：{}", redact(&message)),
                    422 => format!("Resend 不接受这封邮件：{}", redact(&message)),
                    _ => format!("Resend 返回 {status}：{}", redact(&message)),
                };
                if ![429, 502, 503, 504].contains(&status) {
                    break;
                }
            }
            Err(error) => last_error = format!("连不上 Resend：{}", super::remote::network_text(&error)),
        }
    }
    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secrets() {
        assert_eq!(redact("Authorization: Bearer abc.def"), "Authorization: Bearer [REDACTED]");
        assert_eq!(redact("api_key=12345 next"), "api_key=[REDACTED] next");
        assert_eq!(redact("{\"refresh_token\":\"xyz\"}"), "{\"refresh_token\":\"[REDACTED]\"}");
        assert_eq!(redact("key re_ABCDEFGHIJKLmnop done"), "key [REDACTED] done");
        assert_eq!(redact("备份失败：连不上服务器"), "备份失败：连不上服务器");
        assert_eq!(redact("password"), "password");
        assert_eq!(redact("invalid token in request"), "invalid token in request");
    }

    #[test]
    fn checks_email_addresses() {
        assert!(valid_email("li@example.com"));
        assert!(valid_email("notify@sub.example.cn"));
        assert!(!valid_email("li@example"));
        assert!(!valid_email("li example@x.com"));
        assert!(!valid_email("@x.com"));
        assert!(!valid_email("a@b@c.com"));
    }

    #[test]
    fn failure_mail_escapes_fields_and_hides_secrets() {
        let (subject, html) = failure_mail(&FailureMail {
            provider: "群晖 NAS",
            account: "li <admin>",
            folder: "/Test",
            reason: "HTTP 500：token=abc123 <script>",
            failure_time: "2026-11-21 18:00",
            last_success: "从未成功",
            trigger: "自动",
        });
        assert!(subject.starts_with("[备份失败] SideNotes → 群晖 NAS："));
        assert!(html.contains("li &lt;admin&gt;"));
        assert!(html.contains("token=[REDACTED] &lt;script&gt;"));
        assert!(!html.contains("abc123"));
        assert!(!html.contains("{{"), "模板里的字段都要填上");
    }

    #[test]
    fn test_mail_fills_every_field() {
        let (_, html) = test_mail("notify@example.com", "2026-11-21 18:00");
        assert!(html.contains("notify@example.com"));
        assert!(!html.contains("{{"));
    }
}
