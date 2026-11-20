//! 前端可调用的 Tauri 命令。
//!
//! 命令只做数据存取与窗口控制；记录校验、Markdown 解析与交互状态保留在前端，
//! 与原型保持一致，避免同一规则在两侧重复实现。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::attachments::{self, ImportedFile};
use crate::backup;
use crate::edge::EdgeWatcher;
use crate::error::{AppError, AppResult};
use crate::location;
use crate::migration::{self, MigrationReport};
use crate::models::{Draft, Note, Snapshot, StorageInfo, TagUsage};
use crate::snapshots;
use crate::store::Store;
use crate::windows::{self, SidebarLayout};

/// 全局快捷键的现状：各编号正在使用的按键，以及注册失败（多半被其他程序占用）的编号。
#[derive(Debug, Default)]
pub struct HotkeyState {
    pub bound: HashMap<String, String>,
    pub failed: Vec<String>,
}

/// 应用共享状态。
pub struct AppState {
    pub store: Store,
    pub edge: Arc<EdgeWatcher>,
    /// 全局快捷键的现状，供设置页提示冲突与更换按键。
    pub hotkeys: Mutex<HotkeyState>,
    /// 系统应用数据目录：默认的数据目录，也是记下当前数据目录（location.json）的位置。
    pub default_dir: PathBuf,
    /// 启动时记下的数据目录不可用、暂时改用默认目录时，为原来的目录；迁移成功后清空。
    pub unavailable_dir: Mutex<Option<PathBuf>>,
    /// 当前数据目录的其它写法：解析软链接之前的路径（系统应用数据目录或 location.json 中记下的写法），
    /// 较早的记录按这些写法引用附件；迁移时一并改写，迁移成功后清空。
    pub data_aliases: Mutex<Vec<PathBuf>>,
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

/// 读取数据目录信息，附带三种存储位置各自的目录，供设置页判断是否需要迁移。
#[tauri::command]
pub fn storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    let mut info = state.store.info()?;
    info.default_directory = state.default_dir.display().to_string();
    info.portable_directory = location::portable_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    info.unavailable_directory = state
        .unavailable_dir
        .lock()
        .ok()
        .and_then(|value| value.as_ref().map(|path| path.display().to_string()))
        .unwrap_or_default();
    Ok(info)
}

/// 更换数据存储位置：复制数据库与附件到 `target`、改写附件路径并改用新位置，原目录保留作为备份。
///
/// 成功后记下新的数据目录（下次启动直接使用），并把新的附件文件夹开放给本地文件协议。
/// 各窗口需要重新读库，由前端广播。
#[tauri::command]
pub async fn migrate_storage(app: AppHandle, state: State<'_, AppState>, target: String) -> AppResult<MigrationReport> {
    // 目标是软链接时迁到它指向的实际目录（见 paths）。
    let aliases = state.data_aliases.lock().map(|aliases| aliases.clone()).unwrap_or_default();
    let report = migration::migrate(&state.store, &crate::paths::resolve(std::path::Path::new(target.trim())), &aliases)?;
    let directory = state.store.directory();
    let attachments_dir = directory.join(attachments::ATTACHMENTS_DIR);
    std::fs::create_dir_all(&attachments_dir)?;
    app.asset_protocol_scope().allow_directory(&attachments_dir, true)?;
    location::remember(&state.default_dir, &directory)?;
    if let Ok(mut unavailable) = state.unavailable_dir.lock() {
        *unavailable = None;
    }
    if let Ok(mut aliases) = state.data_aliases.lock() {
        aliases.clear();
    }
    Ok(report)
}

/// 导出备份：在 `directory` 下新建名为 `name` 的文件夹，写入 JSON 内容 `contents`，并复制记录引用的附件。
#[tauri::command]
pub async fn export_backup(
    state: State<'_, AppState>,
    directory: String,
    name: String,
    contents: String,
) -> AppResult<backup::ExportReport> {
    backup::export(&state.store, &crate::paths::resolve(std::path::Path::new(directory.trim())), &name, &contents)
}

/// 导入备份时拷回附件：把 JSON 文件 `file` 旁边 `folder` 文件夹中的附件复制到数据目录，返回新复制的数量。
#[tauri::command]
pub async fn import_backup_attachments(state: State<'_, AppState>, file: String, folder: String) -> AppResult<usize> {
    backup::import_attachments(&state.store.directory(), &crate::paths::resolve(std::path::Path::new(&file)), &folder)
}

/// 快照目录：设置中填写的目录，没有填写时为数据目录下的 snapshots 文件夹；是软链接时用实际位置。
fn snapshot_root(state: &AppState, directory: &str) -> PathBuf {
    match directory.trim() {
        "" => state.store.directory().join(snapshots::SNAPSHOTS_DIR),
        custom => crate::paths::resolve(std::path::Path::new(custom)),
    }
}

/// 列出快照与附件备份的概况。
#[tauri::command]
pub async fn list_snapshots(state: State<'_, AppState>, directory: String) -> AppResult<snapshots::SnapshotOverview> {
    snapshots::overview(&snapshot_root(&state, &directory), &state.store.directory())
}

/// 立即创建一份快照：手动，或导入备份、永久删除、更换存储位置之前。
#[tauri::command]
pub async fn create_snapshot(
    state: State<'_, AppState>,
    directory: String,
    reason: String,
) -> AppResult<snapshots::SnapshotInfo> {
    snapshots::create(&state.store, &snapshot_root(&state, &directory), &reason, snapshots::now_millis())
}

/// 距最新一份快照超过一天时创建新的一份，否则返回 null。由侧栏窗口定时调用。
#[tauri::command]
pub async fn auto_snapshot(
    state: State<'_, AppState>,
    directory: String,
) -> AppResult<Option<snapshots::SnapshotInfo>> {
    snapshots::auto(&state.store, &snapshot_root(&state, &directory), snapshots::now_millis())
}

/// 从快照恢复记录：先为当前数据创建一份快照，再替换记录并拷回缺失的附件；各窗口需要重新读库。
#[tauri::command]
pub async fn restore_snapshot(
    state: State<'_, AppState>,
    directory: String,
    id: String,
) -> AppResult<snapshots::RestoreReport> {
    snapshots::restore(&state.store, &snapshot_root(&state, &directory), &id, snapshots::now_millis())
}

/// 读取注册失败的全局快捷键编号，设置页据此提示冲突。
#[tauri::command]
pub fn shortcut_conflicts(state: State<'_, AppState>) -> Vec<String> {
    state.hotkeys.lock().map(|hotkeys| hotkeys.failed.clone()).unwrap_or_default()
}

/// 更换全局快捷键（编号 → 按键）：新按键注册成功才生效，被占用时返回原因，原来的按键保持不变。
///
/// 保持同步命令：注册由插件转到主线程执行，同步命令本身就在主线程上，
/// 持有状态锁等待注册时不会与主线程上读取冲突列表的命令互相等待。
#[tauri::command]
pub fn set_global_shortcuts(app: AppHandle, state: State<'_, AppState>, bindings: HashMap<String, String>) -> AppResult<()> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    return crate::shortcuts::apply(&app, &state.hotkeys, &bindings);
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, state, bindings);
        Err(AppError::Other("移动端不支持全局快捷键".into()))
    }
}

/// 开始录入快捷键：辅助进程接管键盘，按下的组合发给设置窗口（见 recorder），返回录入编号。
/// 当前平台不支持时返回错误，设置页改用网页的按键事件录入。等辅助进程装好钩子需要一点时间，放到后台线程，不阻塞主线程。
#[tauri::command]
pub async fn start_shortcut_recording(app: AppHandle) -> AppResult<u64> {
    tauri::async_runtime::spawn_blocking(move || crate::recorder::start(&app))
        .await
        .map_err(|error| AppError::Other(format!("无法录入按键：{error}")))?
}

/// 结束编号为 `session` 的录入，卸载键盘钩子。
#[tauri::command]
pub fn stop_shortcut_recording(session: u64) {
    crate::recorder::stop(session);
}

/// 显示侧栏。
#[tauri::command]
pub fn show_sidebar(app: AppHandle, layout: SidebarLayout) -> AppResult<()> {
    windows::show_sidebar(&app, &layout).inspect_err(|error| crate::diag::log(format!("显示侧栏失败：{error}")))
}

/// 隐藏侧栏；传入布局以支持滑出动画。
#[tauri::command]
pub fn hide_sidebar(app: AppHandle, layout: SidebarLayout) -> AppResult<()> {
    windows::hide_sidebar(&app, &layout).inspect_err(|error| crate::diag::log(format!("收起侧栏失败：{error}")))
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

/// 隐藏速记浮窗。
#[tauri::command]
pub fn hide_capture(app: AppHandle) -> AppResult<()> {
    windows::hide_capture(&app)
}

/// 显示设置窗口。`text_scale` 为系统文本缩放比例，`zoom` 为字号对应的界面缩放，用于把设置窗口的设计尺寸换算为窗口尺寸。
#[tauri::command]
pub fn show_settings(app: AppHandle, text_scale: Option<f64>, zoom: Option<f64>) -> AppResult<()> {
    windows::show_settings(&app, text_scale.unwrap_or(1.0), zoom.unwrap_or(12.0 / 13.0))
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

/// 按主题设置调用方窗口的材质：acrylic、clear 或 opaque（见 windows::set_window_material）。
#[tauri::command]
pub fn set_window_material(window: WebviewWindow, material: String) -> AppResult<()> {
    windows::set_window_material(&window, &material)
}

/// 指针是否在侧栏或它与屏幕边缘之间的留白里；页面到点收起前查询，留白里不收起。
#[tauri::command]
pub fn sidebar_holds_cursor(app: AppHandle) -> bool {
    windows::sidebar_holds_cursor(&app)
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
/// 以 `encodeURIComponent` 编码传入。网页与后端的通道回落到 postMessage 时只能传 JSON，
/// 前端改为传 `{ name, data }`，`data` 为 base64。副本写到当前数据目录的附件文件夹中。
#[tauri::command]
pub async fn import_attachment(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<ImportedFile> {
    let header_name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(attachments::percent_decode)
        .unwrap_or_default();
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => attachments::import_bytes(&state.store.directory(), &header_name, bytes),
        tauri::ipc::InvokeBody::Json(value) => {
            let data = value
                .get("data")
                .and_then(serde_json::Value::as_str)
                .and_then(attachments::base64_decode)
                .ok_or_else(|| AppError::Other(RAW_BODY_EXPECTED.into()))?;
            let name = value.get("name").and_then(serde_json::Value::as_str).unwrap_or(&header_name);
            attachments::import_bytes(&state.store.directory(), name, &data)
        }
    }
}

/// 请求体既不是原始字节、也没有 base64 内容时的错误，前端据此改用 base64 重试（见 bridge.importAttachment）。
const RAW_BODY_EXPECTED: &str = "附件内容格式不正确";

/// 把用户选择的文件复制为附件副本，按选择顺序返回名称与副本路径。
#[tauri::command]
pub async fn import_files(state: State<'_, AppState>, paths: Vec<String>) -> AppResult<Vec<ImportedFile>> {
    attachments::import_paths(&state.store.directory(), &paths)
}

/// 用系统默认程序打开附件文件夹中的文件。
///
/// 只打开附件副本：记录中的路径可能来自导入的备份，直接打开任意路径可能运行不明程序。
/// 由后端按实际路径校验，不受用户目录链接或文件系统虚拟化影响。
#[tauri::command]
pub fn open_attachment(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let root = state.store.directory().join(attachments::ATTACHMENTS_DIR);
    if !attachments::is_inside(&root, std::path::Path::new(&path)) {
        return Err(AppError::Other("只能打开附件文件夹中的文件".into()));
    }
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|error| AppError::Other(format!("无法打开文件：{error}")))
}

/// 显示图片用的路径与尺寸（T115）：附件文件夹里的大图换成缩小的副本（没有就生成），`tier` 为 card 或 window；
/// 不是附件文件夹里的 PNG、JPEG 时返回 None，页面显示原图。生成副本要读整张原图，放到后台线程里做。
#[tauri::command]
pub async fn display_image(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    tier: String,
) -> AppResult<Option<crate::thumbnails::DisplayImage>> {
    let root = state.store.directory().join(attachments::ATTACHMENTS_DIR);
    // 与启动时开放给本地文件协议的路径一致（解析过链接的实际路径），否则副本会被拒绝加载。
    let cache = crate::paths::resolve(&app.path().app_cache_dir()?).join(crate::thumbnails::THUMBNAILS_DIR);
    let edge = crate::thumbnails::edge_for(&tier);
    tauri::async_runtime::spawn_blocking(move || crate::thumbnails::display_image(&root, &cache, std::path::Path::new(&path), edge))
        .await
        .map_err(|error| AppError::Other(format!("图片副本生成中断：{error}")))?
}

/// 把附件副本另存到用户在系统对话框中选择的位置。
///
/// 只导出附件文件夹中的文件，与打开附件同样按实际路径校验；目标路径来自保存对话框。
#[tauri::command]
pub async fn export_attachment(state: State<'_, AppState>, path: String, destination: String) -> AppResult<()> {
    let root = state.store.directory().join(attachments::ATTACHMENTS_DIR);
    if !attachments::is_inside(&root, std::path::Path::new(&path)) {
        return Err(AppError::Other("只能另存附件文件夹中的文件".into()));
    }
    std::fs::copy(&path, &destination)?;
    Ok(())
}

/// 清理没有被任何记录引用的附件副本。
///
/// 引用以数据库中的全部记录（含回收站）与草稿为准，`extra` 补上调用方窗口里尚未保存的编辑内容。
/// `grace_minutes` 为新附件的保护期（默认见 `CLEANUP_GRACE`）：其它窗口里还没保存的内容查不到，
/// 刚导入的附件在保护期内即使没有引用也保留。
#[tauri::command]
pub async fn cleanup_attachments(
    state: State<'_, AppState>,
    extra: Vec<String>,
    grace_minutes: Option<u64>,
) -> AppResult<attachments::CleanupReport> {
    let mut texts = state.store.reference_texts()?;
    texts.extend(extra);
    let grace = grace_minutes.map_or(attachments::CLEANUP_GRACE, |minutes| {
        std::time::Duration::from_secs(minutes.saturating_mul(60))
    });
    attachments::cleanup(&state.store.directory(), &texts, grace, std::time::SystemTime::now())
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
///
/// 磨砂玻璃的实时模糊先在主线程上拆掉（同步命令在主线程上执行，见 glass_live::shutdown）；它的调度队列要靠消息循环
/// 走完关闭，这时等一小会儿再退出，窗口已经藏起来，看不出差别。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    crate::shortcuts::unregister_all(&app);
    crate::tray::hide_all(&app);
    if crate::glass_live::shutdown() {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            app.exit(0);
        });
    } else {
        app.exit(0);
    }
}
