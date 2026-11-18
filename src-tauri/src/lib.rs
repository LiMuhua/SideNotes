//! SideNotes 桌面端入口。

mod app_icon;
mod attachments;
mod backup;
mod commands;
mod diag;
mod dialogs;
mod edge;
mod error;
mod fonts;
mod fullscreen;
mod location;
mod migration;
mod models;
mod note_windows;
mod paths;
mod recorder;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod shortcuts;
mod snapshots;
mod store;
mod tray;
mod windows;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager, WebviewWindowBuilder, WindowEvent};

use commands::AppState;
use edge::EdgeWatcher;
use store::Store;

/// 作为录入快捷键的辅助进程启动时录入按键并返回 true，否则返回 false（见 recorder）。
pub fn run_shortcut_helper() -> bool {
    recorder::run_helper()
}

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
            if let Ok(dir) = handle.path().app_log_dir() {
                diag::init(&dir);
            }

            // 数据默认落在系统应用数据目录；在设置中更换过存储位置时，按其中记下的目录打开（见 location）。
            // 目录是软链接时一律用实际位置（见 paths），比较、迁移与清理都按实际目录进行。
            let literal_default = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&literal_default)?;
            let default_dir = paths::resolve(&literal_default);
            let resolved = location::resolve(&default_dir);
            let data_dir = resolved.directory.clone();
            // 解析之前的写法：较早的记录按它引用附件，迁移时一并改写。
            let data_aliases: Vec<std::path::PathBuf> = [Some(literal_default), location::recorded(&default_dir)]
                .into_iter()
                .flatten()
                .filter(|alias| *alias != data_dir && paths::same_location(alias, &data_dir))
                .collect();
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join(location::DATABASE_FILE))?;

            // 附件文件夹在这里建好，再按实际路径开放给本地文件协议。配置中的范围在窗口创建前解析，
            // 那时文件夹可能还不存在；用户目录经过链接或被虚拟化时，按配置换算出的路径与文件的
            // 实际路径对不上，图片会被拒绝加载。
            let attachments_dir = data_dir.join(attachments::ATTACHMENTS_DIR);
            std::fs::create_dir_all(&attachments_dir)?;
            app.asset_protocol_scope().allow_directory(&attachments_dir, true)?;
            // 上传的应用图标在系统应用数据目录的 app-icon/（不随数据目录迁移），同样开放给本地文件协议显示。
            let icon_dir = app_icon::custom_dir(&default_dir);
            std::fs::create_dir_all(&icon_dir)?;
            app.asset_protocol_scope().allow_directory(&icon_dir, false)?;

            let watcher = Arc::new(EdgeWatcher::new());

            // 全局快捷键按设置中保存的按键注册；设置读不出时用默认按键。
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let hotkeys = {
                handle.plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                shortcuts::register_all(&handle, &store.settings().unwrap_or_default())
            };
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let hotkeys = commands::HotkeyState::default();

            app.manage(AppState {
                store,
                edge: watcher.clone(),
                hotkeys: Mutex::new(hotkeys),
                default_dir,
                unavailable_dir: Mutex::new(resolved.unavailable),
                data_aliases: Mutex::new(data_aliases),
            });

            // 窗口在状态就绪后才创建。配置中的窗口默认先于 setup 创建，页面会在
            // manage 之前调用 load_snapshot 而失败，以空列表启动；此后的整体写入
            // 会覆盖数据库中的其它记录。配置里的窗口均设为 create: false，统一在此创建。
            // 侧栏、速记浮窗与动画层交给一个隐藏的所有者窗口，不出现在任务栏、Alt+Tab 与 Win+Tab 中
            // （见 windows::create_owner_window）；记录窗口是独立的普通窗口，不交给它（见 note_windows::build）。
            #[cfg(windows)]
            let owner = windows::create_owner_window();
            for config in handle.config().app.windows.iter().filter(|config| !config.create) {
                let builder = WebviewWindowBuilder::from_config(&handle, config)?;
                #[cfg(windows)]
                let builder = match owner {
                    Some(owner) if config.label != windows::SETTINGS_LABEL => builder.owner_raw(owner),
                    _ => builder,
                };
                let window = builder.build()?;
                if config.label == note_windows::OVERLAY_LABEL {
                    // 动画层点击穿透，指针始终落在下面的窗口上（拖动中的来源窗口仍按住指针）。
                    window.set_ignore_cursor_events(true)?;
                    windows::disable_transitions(&window);
                }
            }
            windows::disable_sidebar_transitions(&handle);
            // 启动稳定后建好一个备用的记录窗口，打开记录窗口时不用等 WebView 创建。
            note_windows::ensure_spare_later(&handle, std::time::Duration::from_secs(3));

            #[cfg(desktop)]
            tray::setup(&handle)?;

            edge::spawn(handle.clone(), watcher);
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // 记录窗口的 Alt+F4：交给页面按关闭流程处理（先保存编辑，再播放关闭动画）。
                WindowEvent::CloseRequested { api, .. } if note_windows::is_note(window.label()) => {
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), note_windows::events::CLOSE, ());
                }
                WindowEvent::Destroyed if note_windows::is_note(window.label()) => {
                    note_windows::forget(window.label());
                }
                WindowEvent::Focused(true) if note_windows::is_note(window.label()) => {
                    note_windows::touch(window.label());
                }
                // 弹窗窗口的 Alt+F4：按关闭弹窗处理，通知打开者（T99）。
                WindowEvent::CloseRequested { api, .. } if window.label() == dialogs::DIALOG_LABEL => {
                    api.prevent_close();
                    let _ = dialogs::close_dialog(window.app_handle().clone(), None);
                }
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
            commands::set_global_shortcuts,
            commands::start_shortcut_recording,
            commands::stop_shortcut_recording,
            commands::show_sidebar,
            commands::hide_sidebar,
            commands::apply_sidebar_layout,
            commands::hide_capture,
            commands::show_settings,
            commands::hide_settings,
            dialogs::open_dialog,
            dialogs::dialog_init,
            dialogs::present_dialog,
            dialogs::close_dialog,
            commands::set_ui_zoom,
            commands::set_window_material,
            commands::sidebar_holds_cursor,
            commands::open_devtools,
            commands::system_fonts,
            commands::inspect_file,
            commands::import_attachment,
            commands::import_files,
            commands::open_attachment,
            commands::export_attachment,
            commands::cleanup_attachments,
            commands::migrate_storage,
            commands::export_backup,
            commands::import_backup_attachments,
            commands::list_snapshots,
            commands::create_snapshot,
            commands::auto_snapshot,
            commands::restore_snapshot,
            commands::copy_file_paths,
            commands::quit_app,
            note_windows::note_window_init,
            note_windows::open_note_window,
            note_windows::note_window_present,
            note_windows::note_window_sync,
            note_windows::note_window_close,
            note_windows::note_window_destroy,
            note_windows::note_window_maximize,
            note_windows::note_window_widen,
            note_windows::close_all_note_windows,
            note_windows::drag_begin,
            note_windows::drag_update,
            note_windows::drag_end,
            note_windows::drag_indicator,
            note_windows::overlay_ready,
            note_windows::overlay_done,
            note_windows::set_window_border_color,
            app_icon::apply_app_icon,
            app_icon::custom_app_icon,
            app_icon::save_custom_app_icon,
            app_icon::remove_custom_app_icon,
        ])
        .run(tauri::generate_context!())
        .expect("SideNotes 启动失败");
}
