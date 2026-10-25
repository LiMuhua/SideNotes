// 发布版隐藏控制台窗口，避免启动时闪现终端。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sidenotes_lib::run()
}
