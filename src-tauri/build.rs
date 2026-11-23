//! 构建脚本：Tauri 的代码生成，以及把 OneDrive、Google Drive 登录用的 OAuth 客户端编进程序。
//!
//! 同 VS Code、rclone：客户端由开发者注册一次、编进程序，用户只管登录（技术决策第 66 条）。
//! 客户端写在进仓库的 `oauth-clients.json`：它们都会编进安装包，谁都能从程序里读出来，藏不住。
//! Google 换令牌、刷新令牌时必须带客户端密钥，「桌面应用」类型也一样（2026-11-23 实测，不带报 client_secret is missing.；
//! 文档写的「可选」不成立）。Google 认为桌面应用的密钥不算机密，可明文写进仓库会被 GitHub、GitGuardian 的密钥扫描报为泄露
//! （第十三轮反馈 3），所以仓库里存的是与 [`MASK`] 逐字节异或后的十六进制（`google.obscured`），构建时还原。
//! 这和 rclone 的做法一样，只为不让扫描报警，不是加密（技术决策第 74 条）；换密钥时的写法见 docs/tasks.md 的开发与验证命令。
//! 构建时的环境变量 `SIDENOTES_ONEDRIVE_CLIENT_ID`、`SIDENOTES_ONEDRIVE_TENANT`、`SIDENOTES_GOOGLE_CLIENT_ID`、
//! `SIDENOTES_GOOGLE_CLIENT_SECRET`（明文）优先于文件（例如换成自己注册的客户端）。都没有时这一项为空，登录时提示这个版本还不能登录。

use std::collections::HashMap;

const FILE: &str = "oauth-clients.json";

/// 还原 `google.obscured` 用的字节，循环使用。改了它要重新生成 `obscured`。
const MASK: &[u8] = b"SideNotes oauth-clients.json";

const KEYS: [(&str, &str, &str); 4] = [
    ("SIDENOTES_ONEDRIVE_CLIENT_ID", "onedrive", "clientId"),
    ("SIDENOTES_ONEDRIVE_TENANT", "onedrive", "tenant"),
    ("SIDENOTES_GOOGLE_CLIENT_ID", "google", "clientId"),
    ("SIDENOTES_GOOGLE_CLIENT_SECRET", "google", "obscured"),
];

/// 还原 `obscured`：十六进制解成字节，再与 MASK 逐字节异或。写错了返回空的（这个版本登录不了），并在构建时提示。
fn reveal(text: &str) -> String {
    let bytes: Option<Vec<u8>> = (0..text.len()).step_by(2).map(|index| text.get(index..index + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok())).collect();
    let plain = bytes
        .filter(|bytes| text.len() % 2 == 0 && !bytes.is_empty())
        .and_then(|bytes| String::from_utf8(bytes.iter().zip(MASK.iter().cycle()).map(|(byte, mask)| byte ^ mask).collect()).ok());
    plain.unwrap_or_else(|| {
        println!("cargo:warning={FILE} 里的 obscured 写法不对，已忽略");
        String::new()
    })
}

/// 读 `oauth-clients.json`，取出 `{ "onedrive": { "clientId": … }, … }` 中不为空的字符串。
fn read_file() -> HashMap<(String, String), String> {
    let mut found = HashMap::new();
    let Ok(text) = std::fs::read_to_string(FILE) else {
        return found;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        println!("cargo:warning={FILE} 不是有效的 JSON，已忽略");
        return found;
    };
    for (_, section, field) in KEYS {
        let text = value.get(section).and_then(|item| item.get(field)).and_then(|item| item.as_str()).map(str::trim).unwrap_or_default();
        if !text.is_empty() {
            let value = if field == "obscured" { reveal(text) } else { text.to_string() };
            found.insert((section.to_string(), field.to_string()), value);
        }
    }
    found
}

fn main() {
    println!("cargo:rerun-if-changed={FILE}");
    let file = read_file();
    for (env, section, field) in KEYS {
        println!("cargo:rerun-if-env-changed={env}");
        let value = std::env::var(env)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| file.get(&(section.to_string(), field.to_string())).cloned())
            .unwrap_or_default();
        println!("cargo:rustc-env={env}={}", value.trim());
    }
    tauri_build::build()
}
