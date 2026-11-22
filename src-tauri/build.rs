//! 构建脚本：Tauri 的代码生成，以及把 OneDrive、Google Drive 登录用的 OAuth 客户端编进程序。
//!
//! 同 VS Code、rclone：客户端由开发者注册一次、编进程序，用户只管登录（技术决策第 66 条）。
//! - 客户端编号写在 `oauth-clients.json`，进仓库：编号会编进安装包，谁都能从程序里读出来，算不上机密。
//! - Google 桌面应用的「客户端密钥」写在 `oauth-clients.local.json`，不进仓库（格式见 `oauth-clients.local.example.json`，
//!   只写要覆盖的项）：仓库是公开的，`GOCSPX-…` 推上去会被 GitHub 的密钥扫描拦下或报警。
//! - 构建时的环境变量 `SIDENOTES_ONEDRIVE_CLIENT_ID`、`SIDENOTES_ONEDRIVE_TENANT`、`SIDENOTES_GOOGLE_CLIENT_ID`、
//!   `SIDENOTES_GOOGLE_CLIENT_SECRET` 优先，其次是本机文件，最后是仓库里的文件。都没有时这一项为空，登录时提示这个版本还不能登录。

use std::collections::HashMap;

/// 后面的覆盖前面的。
const FILES: [&str; 2] = ["oauth-clients.json", "oauth-clients.local.json"];

const KEYS: [(&str, &str, &str); 4] = [
    ("SIDENOTES_ONEDRIVE_CLIENT_ID", "onedrive", "clientId"),
    ("SIDENOTES_ONEDRIVE_TENANT", "onedrive", "tenant"),
    ("SIDENOTES_GOOGLE_CLIENT_ID", "google", "clientId"),
    ("SIDENOTES_GOOGLE_CLIENT_SECRET", "google", "clientSecret"),
];

/// 依次读两个文件，取出 `{ "onedrive": { "clientId": … }, … }` 中不为空的字符串。
fn read_files() -> HashMap<(String, String), String> {
    let mut found = HashMap::new();
    for file in FILES {
        let Ok(text) = std::fs::read_to_string(file) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            println!("cargo:warning={file} 不是有效的 JSON，已忽略");
            continue;
        };
        for (_, section, field) in KEYS {
            let text = value.get(section).and_then(|item| item.get(field)).and_then(|item| item.as_str()).map(str::trim).unwrap_or_default();
            if !text.is_empty() {
                found.insert((section.to_string(), field.to_string()), text.to_string());
            }
        }
    }
    found
}

fn main() {
    for file in FILES {
        println!("cargo:rerun-if-changed={file}");
    }
    let files = read_files();
    for (env, section, field) in KEYS {
        println!("cargo:rerun-if-env-changed={env}");
        let value = std::env::var(env)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| files.get(&(section.to_string(), field.to_string())).cloned())
            .unwrap_or_default();
        println!("cargo:rustc-env={env}={}", value.trim());
    }
    tauri_build::build()
}
