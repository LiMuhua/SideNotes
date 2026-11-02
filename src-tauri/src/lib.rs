//! SideNotes 桌面端入口。

mod attachments;
mod commands;
mod edge;
mod error;
mod fonts;
mod location;
mod migration;
mod models;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shortcuts;
mod store;
mod tray;
mod windows;

use std::sync::{Arc, Mutex};

use tauri::{Manager, WebviewWindowBuilder, WindowEvent};

use commands::AppState;
use edge::EdgeWatcher;
use store::Store;

/// 启动应用。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // 数据默认落在系统应用数据目录；在设置中更换过存储位置时，按其中记下的目录打开（见 location）。
            let default_dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&default_dir)?;
            let resolved = location::resolve(&default_dir);
            let data_dir = resolved.directory.clone();
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join(location::DATABASE_FILE))?;

            // 附件文件夹在这里建好，再按实际路径开放给本地文件协议。配置中的范围在窗口创建前解析，
            // 那时文件夹可能还不存在；用户目录经过链接或被虚拟化时，按配置换算出的路径与文件的
            // 实际路径对不上，图片会被拒绝加载。
            let attachments_dir = data_dir.join(attachments::ATTACHMENTS_DIR);
            std::fs::create_dir_all(&attachments_dir)?;
            app.asset_protocol_scope().allow_directory(&attachments_dir, true)?;

            let watcher = Arc::new(EdgeWatcher::new());

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let conflicts = {
                handle.plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                shortcuts::register_all(&handle)
            };
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let conflicts: Vec<String> = Vec::new();

            app.manage(AppState {
                store,
                edge: watcher.clone(),
                shortcut_conflicts: conflicts,
                default_dir,
                unavailable_dir: Mutex::new(resolved.unavailable),
            });

            // 窗口在状态就绪后才创建。配置中的窗口默认先于 setup 创建，页面会在
            // manage 之前调用 load_snapshot 而失败，以空列表启动；此后的整体写入
            // 会覆盖数据库中的其它记录。配置里三个窗口均设为 create: false，统一在此创建。
            for config in handle.config().app.windows.iter().filter(|config| !config.create) {
                WebviewWindowBuilder::from_config(&handle, config)?.build()?;
            }
            windows::disable_sidebar_transitions(&handle);

            #[cfg(desktop)]
            tray::setup(&handle)?;

            edge::spawn(handle.clone(), watcher);
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // 关闭按钮只隐藏窗口；退出统一走托盘菜单，避免误关导致后台驻留消失。
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    if window.label() == windows::SETTINGS_LABEL {
                        windows::notify_settings_visibility(window.app_handle());
                    }
                }
                // 最小化与还原都会改变窗口尺寸（最小化时为 0），据此通知设置窗口的显示状态。
                WindowEvent::Resized(_) if window.label() == windows::SETTINGS_LABEL => {
                    windows::notify_settings_visibility(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_snapshot,
            commands::save_snapshot,
            commands::save_settings,
            commands::purge_expired,
            commands::compact_database,
            commands::storage_info,
            commands::shortcut_conflicts,
            commands::show_sidebar,
            commands::hide_sidebar,
            commands::toggle_sidebar,
            commands::apply_sidebar_layout,
            commands::show_capture,
            commands::hide_capture,
            commands::toggle_capture,
            commands::show_settings,
            commands::hide_settings,
            commands::set_ui_zoom,
            commands::open_devtools,
            commands::system_fonts,
            commands::inspect_file,
            commands::import_attachment,
            commands::import_files,
            commands::open_attachment,
            commands::cleanup_attachments,
            commands::migrate_storage,
            commands::copy_file_paths,
            commands::set_sidebar_pinned,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("SideNotes 启动失败");
}
