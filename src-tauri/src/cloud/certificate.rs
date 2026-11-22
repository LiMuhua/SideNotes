//! 连不上 WebDAV 服务时查看它的证书：不带任何凭据握一次手，取出证书上的名字与指纹，
//! 判断是不是「证书受信任，只是名字与地址对不上」（NAS 用 IP 访问、证书是给域名的）。是的话前端问用户
//! 要不要按证书上的名字验证（webdav::build_client）；自签名之类系统不信任的证书照常报错。

use std::time::Duration;

use reqwest::blocking::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::remote::{RemoteError, RemoteResult};

/// 证书上的名字与地址对不上时给前端的信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameMismatch {
    /// 证书上的名字（SAN 里的 DNS 名；没有 SAN 时用主题的 CN）。
    pub names: Vec<String>,
    /// 按哪个名字验证：证书上第一个不带通配符的名字；只有通配符时把 * 换成 nas。
    pub suggested: String,
    /// 证书的 SHA-256 指纹，给用户核对。
    pub fingerprint: String,
}

/// 读一段 DER 的标签与内容，返回（标签, 内容, 剩下的）。
fn der(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = input.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (first as usize, rest)
    } else {
        let count = (first & 0x7f) as usize;
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let length = rest[..count].iter().fold(0usize, |value, byte| (value << 8) | *byte as usize);
        (length, &rest[count..])
    };
    if rest.len() < length {
        return None;
    }
    Some((tag, &rest[..length], &rest[length..]))
}

const SAN_OID: &[u8] = &[0x55, 0x1d, 0x11];
const CN_OID: &[u8] = &[0x55, 0x04, 0x03];

/// 证书上的名字：SAN 扩展里的 dNSName；没有时取主题的 CN。只做这一件事的最小 DER 读法。
pub fn certificate_names(certificate: &[u8]) -> Vec<String> {
    let parse = || -> Option<Vec<String>> {
        let (_, cert, _) = der(certificate)?;
        let (_, tbs, _) = der(cert)?;
        let mut fields = Vec::new();
        let mut rest = tbs;
        while !rest.is_empty() {
            let (tag, content, next) = der(rest)?;
            fields.push((tag, content));
            rest = next;
        }
        // 版本 [0] 可有可无；之后依次是序列号、签名算法、颁发者、有效期、主题、公钥。
        let offset = usize::from(fields.first()?.0 == 0xa0);
        let subject = fields.get(offset + 4)?.1;
        let mut names = Vec::new();
        if let Some((_, extensions)) = fields.iter().find(|(tag, _)| *tag == 0xa3) {
            let (_, mut list, _) = der(extensions)?;
            while !list.is_empty() {
                let (_, extension, next) = der(list)?;
                list = next;
                let (_, oid, mut inner) = der(extension)?;
                if oid != SAN_OID {
                    continue;
                }
                let (mut tag, mut value, mut after) = der(inner)?;
                if tag == 0x01 {
                    inner = after;
                    (tag, value, after) = der(inner)?;
                }
                let _ = after;
                if tag != 0x04 {
                    continue;
                }
                let (_, mut general, _) = der(value)?;
                while !general.is_empty() {
                    let (tag, name, next) = der(general)?;
                    general = next;
                    if tag == 0x82 {
                        names.push(String::from_utf8_lossy(name).to_ascii_lowercase());
                    }
                }
            }
        }
        if names.is_empty() {
            // 主题：SET 里的 SEQUENCE { OID, 字符串 }。
            let mut rdns = subject;
            while !rdns.is_empty() {
                let (_, set, next) = der(rdns)?;
                rdns = next;
                let (_, attribute, _) = der(set)?;
                let (_, oid, value) = der(attribute)?;
                if oid == CN_OID {
                    let (_, text, _) = der(value)?;
                    names.push(String::from_utf8_lossy(text).to_ascii_lowercase());
                }
            }
        }
        Some(names)
    };
    parse().unwrap_or_default()
}

/// 名字能不能用来验证主机 `host`：完全相同，或通配符 `*.a.b` 对上 `x.a.b`（只替换最左边一段）。
pub fn name_matches(name: &str, host: &str) -> bool {
    let (name, host) = (name.to_ascii_lowercase(), host.to_ascii_lowercase());
    match name.strip_prefix("*.") {
        Some(base) => host.split_once('.').is_some_and(|(label, rest)| !label.is_empty() && rest == base),
        None => name == host,
    }
}

/// 建议按哪个名字验证。
pub fn suggested_name(names: &[String]) -> Option<String> {
    names
        .iter()
        .find(|name| !name.starts_with('*'))
        .cloned()
        .or_else(|| names.iter().find_map(|name| name.strip_prefix("*.").map(|base| format!("nas.{base}"))))
}

fn fingerprint(certificate: &[u8]) -> String {
    Sha256::digest(certificate).iter().map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(":")
}

/// 不验证证书、不带凭据握一次手，取出服务的证书（DER）。
fn fetch_certificate(endpoint: &str) -> RemoteResult<Vec<u8>> {
    // 同 WebDAV 的连接，直连 NAS、不走系统代理。
    let client = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .user_agent(super::USER_AGENT)
        .tls_danger_accept_invalid_certs(true)
        .tls_info(true)
        .build()
        .map_err(|error| RemoteError::Network(error.to_string()))?;
    let response = client
        .request(reqwest::Method::OPTIONS, endpoint)
        .send()
        .map_err(|error| RemoteError::Network(super::remote::network_text(&error)))?;
    response
        .extensions()
        .get::<reqwest::tls::TlsInfo>()
        .and_then(|info| info.peer_certificate())
        .map(<[u8]>::to_vec)
        .ok_or_else(|| RemoteError::Network("没有拿到服务的证书".into()))
}

/// 按地址连不上时看一眼证书：名字与地址对不上、而按证书上的名字验证能通过时返回 Some；
/// 不是这种情况（证书本身不受信任、根本连不上）时返回说明原因的错误。
pub fn diagnose(endpoint: &str) -> RemoteResult<NameMismatch> {
    let url = url::Url::parse(endpoint).map_err(|error| RemoteError::Config(error.to_string()))?;
    if url.scheme() != "https" {
        return Err(RemoteError::Network("连不上服务器，检查地址与网络".into()));
    }
    let host = url.host_str().unwrap_or_default().to_string();
    let certificate = fetch_certificate(endpoint)?;
    let names = certificate_names(&certificate);
    let fingerprint = fingerprint(&certificate);
    if names.iter().any(|name| name_matches(name, &host)) {
        return Err(RemoteError::Network("NAS 的证书不受系统信任（多半是自签名的）：在群晖上换成受信任的证书（例如 Let's Encrypt），或把它的证书装进 Windows 的受信任根证书".into()));
    }
    let suggested = suggested_name(&names).ok_or_else(|| RemoteError::Network("NAS 的证书上没有名字，系统不信任它".into()))?;
    // 按建议的名字照常验证一次（不带凭据）：证书链不受信任时，换名字也没用。
    let (client, base) = super::webdav::build_client(endpoint, &suggested)?;
    match client.request(reqwest::Method::OPTIONS, &base).send() {
        Ok(_) => Ok(NameMismatch { names, suggested, fingerprint }),
        Err(_) => Err(RemoteError::Network(format!(
            "NAS 的证书是给 {} 的，与地址 {host} 对不上，而且不受系统信任：在群晖上换成受信任的证书，或改用证书上的域名访问",
            names.join("、")
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拼一段 DER。
    fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
        let mut out = vec![tag];
        if content.len() < 0x80 {
            out.push(content.len() as u8);
        } else {
            out.push(0x82);
            out.push((content.len() >> 8) as u8);
            out.push(content.len() as u8);
        }
        out.extend_from_slice(content);
        out
    }

    fn name(cn: &str) -> Vec<u8> {
        let attribute = [tlv(0x06, CN_OID), tlv(0x0c, cn.as_bytes())].concat();
        tlv(0x30, &tlv(0x31, &tlv(0x30, &attribute)))
    }

    /// 只有证书结构的骨架：版本、序列号、算法、颁发者、有效期、主题、公钥与（可选的）SAN 扩展。
    fn certificate(subject: &str, sans: &[&str]) -> Vec<u8> {
        let mut tbs = vec![tlv(0xa0, &tlv(0x02, &[2])), tlv(0x02, &[1]), tlv(0x30, &tlv(0x06, &[0x2a])), name("Issuer CA"), tlv(0x30, &[]), name(subject), tlv(0x30, &[])];
        if !sans.is_empty() {
            let general: Vec<u8> = sans.iter().flat_map(|san| tlv(0x82, san.as_bytes())).collect();
            let extension = [tlv(0x06, SAN_OID), tlv(0x04, &tlv(0x30, &general))].concat();
            tbs.push(tlv(0xa3, &tlv(0x30, &tlv(0x30, &extension))));
        }
        tlv(0x30, &[tlv(0x30, &tbs.concat()), tlv(0x30, &tlv(0x06, &[0x2a])), tlv(0x03, &[0])].concat())
    }

    #[test]
    fn reads_san_names_and_falls_back_to_the_subject_cn() {
        assert_eq!(certificate_names(&certificate("*.muhua.life", &["*.muhua.life", "muhua.life"])), vec!["*.muhua.life", "muhua.life"]);
        assert_eq!(certificate_names(&certificate("NAS.Example.com", &[])), vec!["nas.example.com"]);
        assert!(certificate_names(b"\x30\x05broken").is_empty());
    }

    #[test]
    fn matches_names_like_tls_does() {
        assert!(name_matches("*.muhua.life", "nas.muhua.life"));
        assert!(!name_matches("*.muhua.life", "muhua.life"));
        assert!(!name_matches("*.muhua.life", "a.b.muhua.life"));
        assert!(name_matches("muhua.life", "MUHUA.life"));
        assert!(!name_matches("muhua.life", "192.168.31.5"));
    }

    /// 对着真的服务查一次（不带凭据）：设置环境变量 SIDENOTES_TEST_WEBDAV 为 NAS 的 https 地址时才跑。
    #[test]
    fn diagnoses_a_real_server_when_configured() {
        let Ok(endpoint) = std::env::var("SIDENOTES_TEST_WEBDAV") else {
            return;
        };
        println!("{:?}", diagnose(endpoint.trim_end_matches('/')));
    }

    #[test]
    fn suggests_a_plain_name_first() {
        assert_eq!(suggested_name(&["*.muhua.life".into(), "muhua.life".into()]).as_deref(), Some("muhua.life"));
        assert_eq!(suggested_name(&["*.example.com".into()]).as_deref(), Some("nas.example.com"));
        assert_eq!(suggested_name(&[]), None);
    }
}
