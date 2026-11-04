// 发布版隐藏控制台窗口，避免启动时闪现终端。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 录入快捷键时应用以 --record-shortcut 再启动自己一次作为辅助进程（见 recorder），不打开界面。
    if sidenotes_lib::run_shortcut_helper() {
        return;
    }
    sidenotes_lib::run()
}
