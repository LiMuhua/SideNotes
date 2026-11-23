//! 构建脚本：Tauri 的代码生成，以及把 OneDrive、Google Drive 登录用的 OAuth 客户端编进程序。
//!
//! 同 VS Code、rclone：客户端由开发者注册一次、编进程序，用户只管登录（技术决策第 66 条）。
//! 客户端编号写在进仓库的 `oauth-clients.json`：它们都会编进安装包，谁都能从程序里读出来，藏不住。
//! Google 的 `clientSecret` 可以不写：「桌面应用」类型的客户端换令牌时密钥可选；「Web 应用」类型的必须带上（不带时报
//! client_secret is missing），写进仓库会被 GitHub 等的密钥扫描报警（第十三轮反馈 3）。
//! 构建时的环境变量 `SIDENOTES_ONEDRIVE_CLIENT_ID`、`SIDENOTES_ONEDRIVE_TENANT`、`SIDENOTES_GOOGLE_CLIENT_ID`、
//! `SIDENOTES_GOOGLE_CLIENT_SECRET` 优先于文件（例如换成自己注册的客户端）。都没有时这一项为空，登录时提示这个版本还不能登录。

use std::collections::HashMap;

const FILE: &str = "oauth-clients.json";

const KEYS: [(&str, &str, &str); 4] = [
    ("SIDENOTES_ONEDRIVE_CLIENT_ID", "onedrive", "clientId"),
    ("SIDENOTES_ONEDRIVE_TENANT", "onedrive", "tenant"),
    ("SIDENOTES_GOOGLE_CLIENT_ID", "google", "clientId"),
    ("SIDENOTES_GOOGLE_CLIENT_SECRET", "google", "clientSecret"),
];

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
            found.insert((section.to_string(), field.to_string()), text.to_string());
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
