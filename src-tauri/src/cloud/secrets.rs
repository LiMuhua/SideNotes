//! 云端同步的凭据：群晖 NAS 的密码、OneDrive 与 Google Drive 的登录令牌、Resend 的密钥。
//!
//! 凭据不写进设置（设置存在数据库里，会随本地备份导出、随数据目录迁移），而是合成一个 JSON 对象，在 Windows 上用
//! DPAPI（`CryptProtectData`，只有同一台电脑上的同一个 Windows 用户能解开）加密后存进本机的应用数据目录
//! `cloud-secrets.dat`。其它系统暂时以只有自己可读的普通文件保存（见 known-issues）。
//! 文件坏了或解不开（例如换了电脑）时当作没有凭据，需要重新连接或登录。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

/// 各项凭据的名字。
pub const WEBDAV_PASSWORD: &str = "synology.password";
pub const ONEDRIVE_TOKEN: &str = "onedrive.refreshToken";
pub const GOOGLE_TOKEN: &str = "google.refreshToken";
pub const RESEND_KEY: &str = "resend.apiKey";
/// 构建时没有写进客户端编号时，设置页里填的 OneDrive、Google 客户端（Google 的桌面应用还有一个密钥）。
pub const ONEDRIVE_CLIENT: &str = "onedrive.clientId";
pub const GOOGLE_CLIENT: &str = "google.clientId";
pub const GOOGLE_CLIENT_SECRET: &str = "google.clientSecret";

const FILE: &str = "cloud-secrets.dat";

/// 读写同一个文件的操作逐个进行。
static LOCK: Mutex<()> = Mutex::new(());

/// 凭据文件。
#[derive(Debug, Clone)]
pub struct Secrets {
    path: PathBuf,
}

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData};
    use windows::core::PCWSTR;

    /// 附加的熵：别的程序用 DPAPI 解这个文件时还要知道这一段。
    const ENTROPY: &[u8] = b"SideNotes cloud secrets";

    fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
    }

    /// 取出系统分配的输出并释放。
    unsafe fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe { LocalFree(Some(HLOCAL(output.pbData.cast()))) };
        bytes
    }

    pub fn protect(plain: &[u8]) -> Option<Vec<u8>> {
        let input = blob(plain);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe { CryptProtectData(&input, PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.ok()?;
        Some(unsafe { take(output) })
    }

    pub fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
        let input = blob(sealed);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe { CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.ok()?;
        Some(unsafe { take(output) })
    }
}

#[cfg(windows)]
fn seal(plain: &[u8]) -> AppResult<Vec<u8>> {
    dpapi::protect(plain).ok_or_else(|| AppError::Other("系统没能加密凭据，未保存".into()))
}

#[cfg(windows)]
fn open(sealed: &[u8]) -> Option<Vec<u8>> {
    dpapi::unprotect(sealed)
}

#[cfg(not(windows))]
fn seal(plain: &[u8]) -> AppResult<Vec<u8>> {
    Ok(plain.to_vec())
}

#[cfg(not(windows))]
fn open(sealed: &[u8]) -> Option<Vec<u8>> {
    Some(sealed.to_vec())
}

impl Secrets {
    /// `directory` 是本机的应用数据目录（不随数据目录迁移）。
    pub fn new(directory: &Path) -> Self {
        Secrets { path: directory.join(FILE) }
    }

    fn read_all(&self) -> BTreeMap<String, String> {
        std::fs::read(&self.path)
            .ok()
            .and_then(|sealed| open(&sealed))
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .unwrap_or_default()
    }

    fn write_all(&self, values: &BTreeMap<String, String>) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if values.is_empty() {
            let _ = std::fs::remove_file(&self.path);
            return Ok(());
        }
        let sealed = seal(&serde_json::to_vec(values)?)?;
        // 先写临时文件再改名：写到一半断电，原来的凭据还在。
        let partial = self.path.with_extension("part");
        std::fs::write(&partial, sealed)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&partial, &self.path)?;
        Ok(())
    }

    /// 读一项凭据；没有时返回 None。
    pub fn get(&self, key: &str) -> Option<String> {
        let _guard = LOCK.lock().ok()?;
        self.read_all().remove(key).filter(|value| !value.is_empty())
    }

    /// 保存一项凭据；`value` 为 None 或空字符串时删除这一项。
    pub fn set(&self, key: &str, value: Option<&str>) -> AppResult<()> {
        let _guard = LOCK.lock().map_err(|_| AppError::Other("凭据状态异常，请重启应用".into()))?;
        let mut values = self.read_all();
        match value.filter(|value| !value.is_empty()) {
            Some(value) => values.insert(key.to_string(), value.to_string()),
            None => values.remove(key),
        };
        self.write_all(&values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sidenotes-secrets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn stores_reads_and_removes_values() {
        let dir = temp_dir("roundtrip");
        let secrets = Secrets::new(&dir);
        assert_eq!(secrets.get(RESEND_KEY), None);
        secrets.set(RESEND_KEY, Some("re_test_123")).unwrap();
        secrets.set(WEBDAV_PASSWORD, Some("fake pass 中文 123")).unwrap();
        assert_eq!(secrets.get(RESEND_KEY).as_deref(), Some("re_test_123"));
        assert_eq!(Secrets::new(&dir).get(WEBDAV_PASSWORD).as_deref(), Some("fake pass 中文 123"));
        // 文件里不是明文（Windows 上用 DPAPI 加密）。
        #[cfg(windows)]
        {
            let raw = std::fs::read(dir.join(FILE)).unwrap();
            assert!(!String::from_utf8_lossy(&raw).contains("re_test_123"));
        }
        secrets.set(RESEND_KEY, None).unwrap();
        assert_eq!(secrets.get(RESEND_KEY), None);
        assert_eq!(secrets.get(WEBDAV_PASSWORD).as_deref(), Some("fake pass 中文 123"));
        secrets.set(WEBDAV_PASSWORD, Some("")).unwrap();
        assert!(!dir.join(FILE).exists(), "没有凭据时删掉文件");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_file_reads_as_empty() {
        let dir = temp_dir("damaged");
        std::fs::write(dir.join(FILE), b"not sealed").unwrap();
        let secrets = Secrets::new(&dir);
        assert_eq!(secrets.get(RESEND_KEY), None);
        secrets.set(RESEND_KEY, Some("re_new")).unwrap();
        assert_eq!(secrets.get(RESEND_KEY).as_deref(), Some("re_new"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
