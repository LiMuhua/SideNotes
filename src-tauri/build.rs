//! 构建脚本：Tauri 的代码生成，以及把 OneDrive、Google Drive 登录用的 OAuth 客户端编进程序。
//!
//! 客户端编号按以下顺序取：构建时的环境变量 `SIDENOTES_ONEDRIVE_CLIENT_ID`、`SIDENOTES_ONEDRIVE_TENANT`、
//! `SIDENOTES_GOOGLE_CLIENT_ID`、`SIDENOTES_GOOGLE_CLIENT_SECRET`；没有时读 `oauth-clients.json`（不进仓库，
//! 格式见 `oauth-clients.example.json`）。都没有时这一项为空，设置页的「登录」提示这个版本没有配置。
//! 桌面应用的客户端编号与 Google 的「客户端密钥」会随程序分发，算不上机密，但仍不放进仓库。

use std::collections::HashMap;

const FILE: &str = "oauth-clients.json";

const KEYS: [(&str, &str, &str); 4] = [
    ("SIDENOTES_ONEDRIVE_CLIENT_ID", "onedrive", "clientId"),
    ("SIDENOTES_ONEDRIVE_TENANT", "onedrive", "tenant"),
    ("SIDENOTES_GOOGLE_CLIENT_ID", "google", "clientId"),
    ("SIDENOTES_GOOGLE_CLIENT_SECRET", "google", "clientSecret"),
];

/// 读 `oauth-clients.json`，取出 `{ "onedrive": { "clientId": … }, … }` 中的字符串。
fn read_file() -> HashMap<(String, String), String> {
    let Ok(text) = std::fs::read_to_string(FILE) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        println!("cargo:warning={FILE} 不是有效的 JSON，已忽略");
        return HashMap::new();
    };
    let mut found = HashMap::new();
    for (_, section, field) in KEYS {
        if let Some(text) = value.get(section).and_then(|item| item.get(field)).and_then(|item| item.as_str()) {
            found.insert((section.to_string(), field.to_string()), text.trim().to_string());
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
