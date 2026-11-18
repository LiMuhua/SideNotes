//! 诊断日志：记下唤出、收起侧栏的经过与出错，以及程序崩溃（panic）。
//!
//! 侧栏偶尔彻底唤不出、只能重启（T86），事后无从判断卡在哪一步，所以把这些经过写进文件：
//! 贴边被什么挡住、快捷键与托盘有没有收到、窗口操作返回了什么错误、侧栏是否停在屏幕外。
//! 只在状态变化或出错时写一行，平时几乎不写。
//!
//! 文件在应用日志目录（Windows 为 `%LOCALAPPDATA%\<应用标识>\logs\sidenotes.log`），
//! 启动时超过 1 MB 就改名为 `sidenotes.old.log` 重新开始，最多占 2 MB。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

/// 打开的日志文件；初始化之前或打不开时为空，写日志什么也不做。
static FILE: Mutex<Option<File>> = Mutex::new(None);
/// 超过这个大小在启动时换一个新文件。
const MAX_SIZE: u64 = 1024 * 1024;
const FILE_NAME: &str = "sidenotes.log";
const OLD_FILE_NAME: &str = "sidenotes.old.log";

/// 打开日志文件并接管 panic：先写一行再交给默认处理（正式版 panic 直接结束进程，这一行是唯一的线索）。
pub fn init(dir: &Path) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = dir.join(FILE_NAME);
    if std::fs::metadata(&path).map(|meta| meta.len() > MAX_SIZE).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join(OLD_FILE_NAME));
    }
    let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    if let Ok(mut slot) = FILE.lock() {
        *slot = Some(file);
    }
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log(format!("程序出错（panic）：{info}"));
        default_hook(info);
    }));
    log(format!("启动 {}", env!("CARGO_PKG_VERSION")));
}

/// 写一行日志，前面带本地时间。写不进去时放弃，不影响程序运行。
pub fn log(message: impl AsRef<str>) {
    let line = format!("{} {}\n", timestamp(), message.as_ref());
    if let Ok(mut slot) = FILE.lock() {
        if let Some(file) = slot.as_mut() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

/// 本地时间，精确到毫秒，例如 `2026-11-18 14:05:09.123`。
#[cfg(windows)]
fn timestamp() -> String {
    // SAFETY：GetLocalTime 只写入传出的结构体。
    let time = unsafe { ::windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, time.wMilliseconds
    )
}

/// 其它平台写 Unix 时间（秒），够用来排列先后。
#[cfg(not(windows))]
fn timestamp() -> String {
    let elapsed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}.{:03}", elapsed.as_secs(), elapsed.subsec_millis())
}
