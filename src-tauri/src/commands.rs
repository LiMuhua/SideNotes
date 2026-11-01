//! 前端可调用的 Tauri 命令。
//!
//! 命令只做数据存取与窗口控制；记录校验、Markdown 解析与交互状态保留在前端，
//! 与原型保持一致，避免同一规则在两侧重复实现。

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachments::{self, ImportedFile};
use crate::edge::EdgeWatcher;
use crate::error::{AppError, AppResult};
use crate::models::{Draft, Note, Snapshot, StorageInfo, TagUsage};
use crate::store::Store;
use crate::windows::{self, SidebarLayout};

/// 应用共享状态。
pub struct AppState {
    pub store: Store,
    pub edge: Arc<EdgeWatcher>,
    /// 启动时注册失败的全局热键，供设置页提示冲突。
    pub shortcut_conflicts: Vec<String>,
}

/// 读取完整快照。
#[tauri::command]
pub fn load_snapshot(state: State<'_, AppState>) -> AppResult<Snapshot> {
    state.store.load()
}

/// 原子保存记录、草稿、设置与标签统计。
#[tauri::command]
pub fn save_snapshot(
    state: State<'_, AppState>,
    notes: Vec<Note>,
    draft: Draft,
    settings: serde_json::Value,
    tag_usage: HashMap<String, TagUsage>,
) -> AppResult<()> {
    state.store.save(&notes, &draft, &settings, &tag_usage)
}

/// 仅保存设置。
#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: serde_json::Value) -> AppResult<()> {
    state.store.save_settings(&settings)
}

/// 清理到期回收站记录，返回删除条数。
#[tauri::command]
pub fn purge_expired(state: State<'_, AppState>, retain_days: i64) -> AppResult<usize> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0);
    state.store.purge_expired(retain_days, now)
}

/// 回收数据库未使用空间。
#[tauri::command]
pub fn compact_database(state: State<'_, AppState>) -> AppResult<()> {
    state.store.compact()
}

/// 读取数据目录信息。
#[tauri::command]
pub fn storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    state.store.info()
}

/// 读取启动时的热键冲突列表。
#[tauri::command]
pub fn shortcut_conflicts(state: State<'_, AppState>) -> Vec<String> {
    state.shortcut_conflicts.clone()
}

/// 显示侧栏。
#[tauri::command]
pub fn show_sidebar(app: AppHandle, layout: SidebarLayout) -> AppResult<()> {
    windows::show_sidebar(&app, &layout)
}

/// 隐藏侧栏；传入布局以支持滑出动画。
#[tauri::command]
pub fn hide_sidebar(app: AppHandle, layout: SidebarLayout) -> AppResult<()> {
    windows::hide_sidebar(&app, &layout)
}

/// 切换侧栏，返回切换后的可见状态。
#[tauri::command]
pub fn toggle_sidebar(app: AppHandle, layout: SidebarLayout) -> AppResult<bool> {
    windows::toggle_sidebar(&app, &layout)
}

/// 按设置重新对齐侧栏，用于宽度或边缘变更。
#[tauri::command]
pub fn apply_sidebar_layout(
    app: AppHandle,
    state: State<'_, AppState>,
    layout: SidebarLayout,
    edge_trigger: bool,
) -> AppResult<()> {
    state.edge.configure(&layout, edge_trigger);
    windows::align_sidebar(&app, &layout)
}

/// 显示速记浮窗。
#[tauri::command]
pub fn show_capture(app: AppHandle) -> AppResult<()> {
    windows::show_capture(&app)
}

/// 隐藏速记浮窗。
#[tauri::command]
pub fn hide_capture(app: AppHandle) -> AppResult<()> {
    windows::hide_capture(&app)
}

/// 切换速记浮窗。
#[tauri::command]
pub fn toggle_capture(app: AppHandle) -> AppResult<bool> {
    windows::toggle_capture(&app)
}

/// 显示设置窗口。`text_scale` 为系统文本缩放比例，用于把设置窗口的设计尺寸换算为窗口尺寸。
#[tauri::command]
pub fn show_settings(app: AppHandle, text_scale: Option<f64>) -> AppResult<()> {
    windows::show_settings(&app, text_scale.unwrap_or(1.0))
}

/// 隐藏设置窗口。
#[tauri::command]
pub fn hide_settings(app: AppHandle) -> AppResult<()> {
    windows::hide_settings(&app)
}

/// 应用界面缩放（字号设置）：调用方窗口的 WebView 整页缩放，设置窗口同时按比例调整尺寸。
#[tauri::command]
pub fn set_ui_zoom(window: WebviewWindow, zoom: f64) -> AppResult<()> {
    windows::set_ui_zoom(&window, zoom)
}

/// 打开指定窗口的开发者工具，供设置页「关于 › 调试」排查界面问题。
#[tauri::command]
pub fn open_devtools(app: AppHandle, label: String) -> AppResult<()> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::Other(format!("窗口 {label} 不存在")))?;
    window.open_devtools();
    Ok(())
}

/// 列出系统已安装的字体族名称，供设置页的字体下拉框联想；在后台线程读取，不阻塞窗口。
#[tauri::command]
pub async fn system_fonts() -> Vec<String> {
    crate::fonts::system_families()
}

/// 把粘贴的内容（截图或文件）写成附件副本，返回名称与副本路径。
///
/// 内容以原始字节作为请求体传入，避免把大文件编码成 JSON 数组；文件名经 `x-file-name` 请求头
/// 以 `encodeURIComponent` 编码传入。
#[tauri::command]
pub async fn import_attachment(app: AppHandle, request: tauri::ipc::Request<'_>) -> AppResult<ImportedFile> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Other("附件内容格式不正确".into()));
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(attachments::percent_decode)
        .unwrap_or_default();
    attachments::import_bytes(&app.path().app_data_dir()?, &name, bytes)
}

/// 把用户选择的文件复制为附件副本，按选择顺序返回名称与副本路径。
#[tauri::command]
pub async fn import_files(app: AppHandle, paths: Vec<String>) -> AppResult<Vec<ImportedFile>> {
    attachments::import_paths(&app.path().app_data_dir()?, &paths)
}

/// 读取指定路径的文件是否存在及其大小，供文件引用校验。
#[tauri::command]
pub fn inspect_file(path: String) -> AppResult<FileStatus> {
    let target = std::path::Path::new(&path);
    match std::fs::metadata(target) {
        Ok(meta) if meta.is_file() => Ok(FileStatus {
            exists: true,
            size: meta.len(),
            is_directory: false,
        }),
        Ok(meta) => Ok(FileStatus {
            exists: true,
            size: 0,
            is_directory: meta.is_dir(),
        }),
        Err(_) => Ok(FileStatus {
            exists: false,
            size: 0,
            is_directory: false,
        }),
    }
}

/// 文件引用校验结果。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub exists: bool,
    pub size: u64,
    pub is_directory: bool,
}

/// 将文件完整路径写入系统剪贴板的文件列表。
///
/// Windows 的 `CF_HDROP` 需要平台 API，`tauri-plugin-clipboard-manager`
/// 目前只提供文本与图片。此处先回退为写入路径文本，并明确告知前端，
/// 不把结果伪装成已写入文件剪贴板（对应原型记录的 CLIP-001）。
#[tauri::command]
pub fn copy_file_paths(app: AppHandle, paths: Vec<String>) -> AppResult<bool> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    if paths.is_empty() {
        return Err(AppError::Other("没有可复制的文件".into()));
    }
    app.clipboard()
        .write_text(paths.join("\r\n"))
        .map_err(|error| AppError::Other(format!("剪贴板写入失败：{error}")))?;
    // false 表示未写入原生文件剪贴板，仅写入了路径文本。
    Ok(false)
}

/// 提交退出：注销热键、隐藏窗口并结束进程。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    crate::shortcuts::unregister_all(&app);
    crate::tray::hide_all(&app);
    app.exit(0);
}

/// 把窗口置顶状态同步给侧栏，对应原型的"固定侧栏"。
#[tauri::command]
pub fn set_sidebar_pinned(app: AppHandle, pinned: bool) -> AppResult<()> {
    let sidebar = app
        .get_webview_window(windows::SIDEBAR_LABEL)
        .ok_or_else(|| AppError::Other("侧栏窗口不存在".into()))?;
    // 固定时保留任务栏图标，便于用 Alt+Tab 切回。
    sidebar.set_skip_taskbar(!pinned)?;
    Ok(())
}
