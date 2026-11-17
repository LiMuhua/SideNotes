//! 应用图标（T85，docs/design-system/adaptation.md 第十节）。
//!
//! 内置图标随应用打包在安装目录的 `app-icons/<编号>-<id>/`（`tauri.conf.json` 的 `bundle.resources`），
//! 开发时直接读源码中的 `src-tauri/icons/builtin/`。上传的图片由页面裁好，保存在系统应用数据目录的
//! `app-icon/`：`custom.png`（512 × 512）与 `custom.ico`（清单 icoSizes 的各个尺寸，每一项都是 PNG）。
//! 这个目录不随数据目录迁移，也不进入导出的备份。
//!
//! 选用后立即更换各窗口与托盘的图标，新建的记录窗口也用当前的图标；开始菜单与桌面上指向本程序的快捷方式
//! 改为指向所选图标的 ICO（默认图标时恢复为程序自身的图标），资源管理器可能要等图标缓存刷新才显示出来。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};

/// 上传的图片所在的目录（系统应用数据目录下）。
pub const CUSTOM_DIR: &str = "app-icon";
/// 上传或移除了自定义图标：各窗口重新读取图片。
pub const CHANGED_EVENT: &str = "sidenotes://app-icon-changed";
/// 托盘图标的标识（见 tray.rs）。
const TRAY_ID: &str = "sidenotes-tray";
/// 窗口图标用 64px 的图，托盘用 32px：系统按缩放比例再缩小，比直接缩小大图清楚。
const WINDOW_SIZE: u32 = 64;
const TRAY_SIZE: u32 = 32;
/// 默认图标：快捷方式恢复为程序自身的图标（exe 的图标就是它）。
const DEFAULT_FOLDER: &str = "211-door-smile-indigo";

/// 当前的窗口图标，新建的记录窗口也用它；没有选过时为空，窗口用程序的默认图标。
static CURRENT: Mutex<Option<Image<'static>>> = Mutex::new(None);

/// 自定义图标的目录。
pub fn custom_dir(default_dir: &Path) -> PathBuf {
    default_dir.join(CUSTOM_DIR)
}

/// 内置图标的目录：打包后在安装目录的 `app-icons/` 下，开发时读源码目录。
fn builtin_dir(app: &AppHandle, folder: &str) -> Option<PathBuf> {
    // 目录名只能是清单中的「编号-id」，不接受路径。
    if folder.is_empty() || !folder.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    if let Ok(resources) = app.path().resource_dir() {
        let packed = resources.join("app-icons").join(folder);
        if packed.is_dir() {
            return Some(packed);
        }
    }
    // 开发时 tauri dev 不复制打包资源，直接读源码目录。
    #[cfg(debug_assertions)]
    {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons").join("builtin").join(folder);
        if source.is_dir() {
            return Some(source);
        }
    }
    None
}

/// 从 ICO 中取出某个尺寸的 PNG。页面生成的 ICO 每一项都是 PNG；找不到这个尺寸或不是 PNG 时为 None。
fn ico_png(ico: &[u8], size: u32) -> Option<&[u8]> {
    if ico.len() < 6 || ico[..4] != [0, 0, 1, 0] {
        return None;
    }
    let count = u16::from_le_bytes([ico[4], ico[5]]) as usize;
    (0..count).find_map(|index| {
        let entry = ico.get(6 + index * 16..6 + (index + 1) * 16)?;
        // 一个字节放不下 256，按格式记为 0。
        let side = if entry[0] == 0 { 256 } else { u32::from(entry[0]) };
        if side != size {
            return None;
        }
        let length = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        let data = ico.get(offset..offset.checked_add(length)?)?;
        data.starts_with(&[0x89, b'P', b'N', b'G']).then_some(data)
    })
}

/// 选用的图标：窗口图、托盘图，以及快捷方式指向的 ICO（None 表示恢复为程序自身的图标）。
struct IconSet {
    window: Image<'static>,
    tray: Image<'static>,
    shortcut: Option<PathBuf>,
}

/// 读取选用的图标。`folder` 为空表示上传的图片；找不到图片时为 None。
fn load_icons(app: &AppHandle, default_dir: &Path, folder: Option<&str>) -> Option<IconSet> {
    match folder {
        Some(folder) => {
            let dir = builtin_dir(app, folder)?;
            let png = dir.join("png");
            let window = Image::from_path(png.join(format!("{WINDOW_SIZE}.png"))).ok()?;
            let tray = Image::from_path(png.join(format!("{TRAY_SIZE}.png"))).ok()?;
            let ico = dir.join("icon.ico");
            let shortcut = (folder != DEFAULT_FOLDER && ico.is_file()).then_some(ico);
            Some(IconSet { window, tray, shortcut })
        }
        None => {
            let dir = custom_dir(default_dir);
            let png = std::fs::read(dir.join("custom.png")).ok()?;
            let ico_path = dir.join("custom.ico");
            let ico = std::fs::read(&ico_path).unwrap_or_default();
            // 优先用 ICO 中对应尺寸的一项，没有时用 512 的大图。
            let pick = |size: u32| Image::from_bytes(ico_png(&ico, size).unwrap_or(&png)).ok();
            let (window, tray) = (pick(WINDOW_SIZE)?, pick(TRAY_SIZE)?);
            let shortcut = (!ico.is_empty()).then_some(ico_path);
            Some(IconSet { window, tray, shortcut })
        }
    }
}

/// 给一个窗口换上当前的图标（新建的记录窗口）。
pub fn apply_current(window: &WebviewWindow) {
    let current = CURRENT.lock().ok().and_then(|slot| slot.clone());
    if let Some(image) = current {
        let _ = window.set_icon(image);
    }
}

/// 选用应用图标：更换各窗口与托盘的图标，快捷方式在后台改为指向所选图标。
/// `folder` 为内置图标的目录名，为空时用上传的图片；找不到图片时不做改动（页面已按默认图标显示）。
#[tauri::command]
pub fn apply_app_icon(app: AppHandle, state: State<'_, AppState>, folder: Option<String>) -> AppResult<()> {
    let Some(icons) = load_icons(&app, &state.default_dir, folder.as_deref()) else {
        return Ok(());
    };
    for window in app.webview_windows().values() {
        let _ = window.set_icon(icons.window.clone());
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(icons.tray));
    }
    if let Ok(mut slot) = CURRENT.lock() {
        *slot = Some(icons.window);
    }
    #[cfg(windows)]
    {
        let shortcut = icons.shortcut;
        // 快捷方式要读写磁盘与 COM，放到后台线程，不耽误界面。
        std::thread::spawn(move || shell_links::update(shortcut.as_deref()));
    }
    Ok(())
}

/// 上传的图片。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomIcon {
    /// PNG 的完整路径，页面经本地文件协议显示。
    pub path: String,
    /// 修改时间（毫秒），换了图片时地址随之变化，不读缓存。
    pub modified: u64,
}

/// 读取上传的图片；没有时为 None。
#[tauri::command]
pub fn custom_app_icon(state: State<'_, AppState>) -> Option<CustomIcon> {
    let png = custom_dir(&state.default_dir).join("custom.png");
    let modified = std::fs::metadata(&png)
        .and_then(|meta| meta.modified())
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    Some(CustomIcon { path: png.display().to_string(), modified })
}

/// 保存裁好的图片：512 × 512 的 PNG 与多尺寸的 ICO（都由页面生成），通知各窗口。
#[tauri::command]
pub fn save_custom_app_icon(app: AppHandle, state: State<'_, AppState>, png: Vec<u8>, ico: Vec<u8>) -> AppResult<CustomIcon> {
    // PNG 文件头；ICO 文件头是保留字 0 与类型 1。
    if png.len() < 8 || png[..8] != [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] || ico.len() < 6 || ico[..4] != [0, 0, 1, 0] {
        return Err(AppError::Other("图标数据不完整".into()));
    }
    let dir = custom_dir(&state.default_dir);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("custom.png"), &png)?;
    std::fs::write(dir.join("custom.ico"), &ico)?;
    let _ = app.emit(CHANGED_EVENT, ());
    custom_app_icon(state).ok_or_else(|| AppError::Other("图标未能保存".into()))
}

/// 移除上传的图片，通知各窗口。
#[tauri::command]
pub fn remove_custom_app_icon(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dir = custom_dir(&state.default_dir);
    for name in ["custom.png", "custom.ico"] {
        match std::fs::remove_file(dir.join(name)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
    }
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

/// 开始菜单与桌面上的快捷方式（Windows）。
///
/// 安装程序在开始菜单与桌面创建指向程序的 `.lnk`；这里只改目标是当前程序的快捷方式，把图标位置改为所选图标的 ICO，
/// 选回默认图标时清空图标位置，恢复为程序自身的图标。所有用户共用的快捷方式（ProgramData、公用桌面）
/// 需要管理员权限才能写入，写不了时跳过。图标位置已经相同的不重写。
#[cfg(windows)]
mod shell_links {
    use std::path::{Path, PathBuf};

    use windows::core::{Interface, GUID, HSTRING, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_PublicDesktop, IShellLinkW, SHChangeNotify,
        SHGetKnownFolderPath, ShellLink, KF_FLAG_DEFAULT, SHCNE_UPDATEITEM, SHCNF_PATHW,
    };

    /// 开始菜单的程序目录往下找几层（安装程序可能建一个以应用命名的子目录）。
    const MAX_DEPTH: usize = 2;

    /// 按所选图标更新快捷方式；`icon` 为 None 时恢复为程序自身的图标。
    pub fn update(icon: Option<&Path>) {
        let Ok(exe) = std::env::current_exe() else { return };
        let exe = dunce::canonicalize(&exe).unwrap_or(exe);
        let dirs: Vec<PathBuf> = [FOLDERID_Programs, FOLDERID_Desktop, FOLDERID_CommonPrograms, FOLDERID_PublicDesktop]
            .iter()
            .filter_map(known_folder)
            .collect();
        // SAFETY: 本线程只在这里使用 COM，结束时对应地反初始化。
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        update_links(&dirs, &exe, icon);
        if initialized {
            // SAFETY: 与上面成功的 CoInitializeEx 配对。
            unsafe { CoUninitialize() };
        }
    }

    /// 系统的已知目录（开始菜单、桌面等）。
    fn known_folder(id: &GUID) -> Option<PathBuf> {
        // SAFETY: 返回的字符串由系统分配，读出后用 CoTaskMemFree 释放。
        unsafe {
            let raw = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let path = raw.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(raw.0 as *const _));
            path
        }
    }

    /// 在这些目录中更新目标是 `exe` 的快捷方式，返回改动的个数。调用方负责初始化 COM。
    pub(super) fn update_links(dirs: &[PathBuf], exe: &Path, icon: Option<&Path>) -> usize {
        let mut links = Vec::new();
        for dir in dirs {
            collect_links(dir, MAX_DEPTH, &mut links);
        }
        links.iter().filter(|link| update_link(link, exe, icon).unwrap_or(false)).count()
    }

    fn collect_links(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth > 0 {
                collect_links(&path, depth - 1, out);
            } else if kind.is_file() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lnk")) {
                out.push(path);
            }
        }
    }

    /// 按 Windows 的习惯不区分大小写比较路径。
    fn same_path(a: &Path, b: &Path) -> bool {
        let a = dunce::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
        a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())
    }

    /// 读出 UTF-16 缓冲区中以 0 结尾的字符串。
    fn wide(buffer: &[u16]) -> String {
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..end])
    }

    /// 更新一个快捷方式；目标不是 `exe` 或图标位置已经相同时不改，返回是否改动。
    fn update_link(link: &Path, exe: &Path, icon: Option<&Path>) -> windows::core::Result<bool> {
        // SAFETY: COM 接口都在本函数内创建与释放；缓冲区长度由切片给出。
        unsafe {
            let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = shell.cast()?;
            let name = HSTRING::from(link.as_os_str());
            file.Load(&name, STGM_READWRITE)?;
            let mut target = [0u16; 1024];
            shell.GetPath(&mut target, std::ptr::null_mut(), 0)?;
            let target = wide(&target);
            if target.is_empty() || !same_path(Path::new(&target), exe) {
                return Ok(false);
            }
            let mut location = [0u16; 1024];
            let mut index = 0i32;
            shell.GetIconLocation(&mut location, &mut index)?;
            let wanted = icon.map(|path| path.to_string_lossy().into_owned()).unwrap_or_default();
            if wide(&location).eq_ignore_ascii_case(&wanted) && index == 0 {
                return Ok(false);
            }
            let wanted = HSTRING::from(wanted);
            shell.SetIconLocation(&wanted, 0)?;
            file.Save(PCWSTR::null(), true)?;
            // 通知资源管理器这个快捷方式变了，开始菜单与桌面尽快重绘图标。
            SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(name.as_ptr() as *const _), None);
            Ok(true)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// 在临时目录中建一个指向测试程序的快捷方式，改图标位置后读回。
        #[test]
        fn updates_links_pointing_to_the_program() {
            let dir = std::env::temp_dir().join(format!("sidenotes-links-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let exe = dunce::canonicalize(std::env::current_exe().unwrap()).unwrap();
            let link = dir.join("SideNotes.lnk");
            let other = dir.join("Other.lnk");
            let icon = dir.join("icon.ico");
            // SAFETY: 测试线程初始化 COM，结束时反初始化。
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
                for (path, target) in [(&link, exe.as_path()), (&other, Path::new(r"C:\Windows\notepad.exe"))] {
                    let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
                    shell.SetPath(&HSTRING::from(target.as_os_str())).unwrap();
                    let file: IPersistFile = shell.cast().unwrap();
                    file.Save(&HSTRING::from(path.as_os_str()), true).unwrap();
                }
            }
            let read_icon = |path: &Path| -> String {
                // SAFETY: 同上，COM 已在本线程初始化。
                unsafe {
                    let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
                    let file: IPersistFile = shell.cast().unwrap();
                    file.Load(&HSTRING::from(path.as_os_str()), STGM_READWRITE).unwrap();
                    let mut location = [0u16; 1024];
                    let mut index = 0;
                    shell.GetIconLocation(&mut location, &mut index).unwrap();
                    wide(&location)
                }
            };

            let dirs = [dir.clone()];
            assert_eq!(update_links(&dirs, &exe, Some(&icon)), 1);
            assert_eq!(read_icon(&link), icon.to_string_lossy());
            assert_eq!(read_icon(&other), "");
            // 已经相同时不重写。
            assert_eq!(update_links(&dirs, &exe, Some(&icon)), 0);
            // 选回默认图标：清空图标位置。
            assert_eq!(update_links(&dirs, &exe, None), 1);
            assert_eq!(read_icon(&link), "");

            // SAFETY: 与上面的 CoInitializeEx 配对。
            unsafe { CoUninitialize() };
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ico_png;

    /// 拼一个两项的 ICO：16 是 PNG，32 不是 PNG。
    fn sample() -> Vec<u8> {
        let first = [0x89, b'P', b'N', b'G', 1, 2];
        let second = [9, 9, 9];
        let mut ico = vec![0, 0, 1, 0, 2, 0];
        let start = 6 + 2 * 16;
        for (side, data, offset) in [(16u8, &first[..], start), (32u8, &second[..], start + first.len())] {
            ico.extend_from_slice(&[side, side, 0, 0, 1, 0, 32, 0]);
            ico.extend_from_slice(&(data.len() as u32).to_le_bytes());
            ico.extend_from_slice(&(offset as u32).to_le_bytes());
        }
        ico.extend_from_slice(&first);
        ico.extend_from_slice(&second);
        ico
    }

    #[test]
    fn picks_png_entry_by_size() {
        let ico = sample();
        assert_eq!(ico_png(&ico, 16), Some(&[0x89, b'P', b'N', b'G', 1, 2][..]));
        // 不是 PNG 的项与不存在的尺寸都不取。
        assert_eq!(ico_png(&ico, 32), None);
        assert_eq!(ico_png(&ico, 64), None);
        assert_eq!(ico_png(b"not an ico", 16), None);
    }

    #[test]
    fn rejects_entries_outside_the_file() {
        // 去掉末尾 4 字节后，16 那一项的数据超出了文件。
        let mut ico = sample();
        ico.truncate(ico.len() - 4);
        assert_eq!(ico_png(&ico, 16), None);
    }
}
