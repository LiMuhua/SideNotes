/**
 * Tauri 命令与事件的前端封装。
 *
 * 所有平台调用集中在此，界面组件不直接引用 Tauri API：
 * 既便于在 jsdom 环境下测试，也让非 Tauri 环境（如纯浏览器预览）可以降级运行。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, Window } from '@tauri-apps/api/window';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type {
  CleanupReport,
  DataSnapshot,
  Draft,
  EdgeSide,
  ExportReport,
  FileStatus,
  MigrationReport,
  Note,
  RestoreReport,
  Settings,
  Snapshot,
  SnapshotOverview,
  SnapshotReason,
  StorageInfo,
  TagUsage,
} from './types';
import { normalizeDraft, normalizeNote } from './notes';
import { normalizeSettings, sidebarWindowWidth, uiZoom } from './settings';
import { windowGap, type WindowMaterial } from './surfaces';
import type { GlobalShortcutId } from './shortcuts';

/** 侧栏几何参数。 */
export interface SidebarLayout {
  edge: EdgeSide;
  width: number;
  /** 出入动画时长（毫秒），0 表示关闭动画。 */
  animDuration?: number;
  /** 面板与屏幕边缘之间的留白（逻辑像素，已乘界面缩放）；窗口本身就是面板的主题才有（core/surfaces 的 windowGap）。 */
  gap?: number;
}

/** 后端事件名。 */
export const APP_EVENTS = {
  /** 托盘：打开设置。 */
  traySettings: 'sidenotes://tray-settings',
  /** 托盘：请求退出。 */
  trayQuit: 'sidenotes://tray-quit',
  /** 任一窗口写入数据库后广播，其它窗口据此刷新内存状态。 */
  storeChanged: 'sidenotes://store-changed',
  /** 设置窗口打开、关闭、最小化或还原，载荷为是否正在显示。 */
  settingsVisibility: 'sidenotes://settings-visibility',
  /** 录入快捷键期间的按键，只发给设置窗口，载荷见 RecordedKeys。 */
  shortcutRecorded: 'sidenotes://shortcut-recorded',
} as const;

/**
 * 跨窗口同步通知。
 *
 * 侧栏、速记与设置是三个独立的 WebView，各自持有一份内存状态；
 * 任何一方写库后都要告知其它窗口，否则旧快照会在下次整体保存时覆盖新数据。
 */
export interface StoreChange {
  /** 发出方实例标识，接收方据此忽略自己发出的通知。 */
  source: string;
  /** settings 只携带设置本身；data 表示记录或草稿变化，需重新读库。 */
  kind: 'settings' | 'data';
  settings?: Settings;
}

/** 判断当前是否运行在 Tauri 环境。 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 调用命令；非桌面环境返回兜底值，便于浏览器中预览界面。 */
async function call<T>(command: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isDesktop()) {
    if (fallback !== undefined) return fallback;
    throw new Error('当前环境不支持该桌面能力');
  }
  return invoke<T>(command, args);
}

/* ==================== 数据存取 ==================== */

/** 读取完整快照，并对记录与设置做统一校验。 */
export async function loadSnapshot(): Promise<Snapshot> {
  const raw = await call<{
    notes: unknown[];
    draft: unknown;
    settings: unknown;
    tagUsage: Record<string, TagUsage>;
  }>('load_snapshot', undefined, { notes: [], draft: {}, settings: {}, tagUsage: {} });

  return {
    notes: (Array.isArray(raw.notes) ? raw.notes : [])
      .map(normalizeNote)
      .filter((note): note is Note => note !== null),
    draft: normalizeDraft(raw.draft),
    settings: normalizeSettings(raw.settings),
    tagUsage: raw.tagUsage && typeof raw.tagUsage === 'object' ? raw.tagUsage : {},
  };
}

/**
 * 原子保存快照。
 *
 * 返回 false 表示写入失败且数据库保持原状，调用方据此保留输入并提示用户，
 * 与原型的 `persistSnapshot` 语义一致。
 */
export async function saveSnapshot(
  notes: Note[],
  draft: Draft,
  settings: Settings,
  tagUsage: Record<string, TagUsage>,
): Promise<boolean> {
  if (!isDesktop()) return true;
  try {
    await invoke('save_snapshot', { notes, draft, settings, tagUsage });
    return true;
  } catch {
    return false;
  }
}

/** 仅保存设置。 */
export async function saveSettings(settings: Settings): Promise<boolean> {
  if (!isDesktop()) return true;
  try {
    await invoke('save_settings', { settings });
    return true;
  } catch {
    return false;
  }
}

/** 清理到期回收站记录，返回删除条数。 */
export function purgeExpired(retainDays: number): Promise<number> {
  return call<number>('purge_expired', { retainDays }, 0);
}

/** 回收数据库未使用空间。 */
export function compactDatabase(): Promise<void> {
  return call<void>('compact_database', undefined, undefined as unknown as void);
}

/** 读取数据目录信息。 */
export function storageInfo(): Promise<StorageInfo> {
  return call<StorageInfo>('storage_info', undefined, {
    directory: '（浏览器预览）',
    database: '',
    size: 0,
    noteCount: 0,
    attachmentCount: 0,
    attachmentSize: 0,
    defaultDirectory: '',
    portableDirectory: '',
    unavailableDirectory: '',
  });
}

/**
 * 更换数据存储位置：后端复制数据库与附件、改写记录中的附件路径并改用新位置，原目录保留作为备份。
 * 成功后调用方需让各窗口重新读库。浏览器预览不支持。
 */
export function migrateStorage(target: string): Promise<MigrationReport> {
  return call<MigrationReport>('migrate_storage', { target });
}

/**
 * 清理没有被任何记录引用的附件副本。
 *
 * 后端以数据库中的全部记录（含回收站）与草稿为准，`extra` 补上本窗口尚未保存的编辑内容；
 * 刚导入的附件在保护期内保留（`graceMinutes`，默认 24 小时），其它窗口里还没保存的内容查不到。
 * 浏览器预览没有附件文件夹，返回空结果。
 */
export function cleanupAttachments(extra: string[], graceMinutes?: number): Promise<CleanupReport> {
  return call<CleanupReport>('cleanup_attachments', { extra, graceMinutes }, { removed: 0, freed: 0, pending: 0 });
}

/**
 * 快照目录的概况。`directory` 为设置中的快照目录，空串表示数据目录下的 snapshots 文件夹。
 * 浏览器预览没有快照，返回空列表。
 */
export function listSnapshots(directory: string): Promise<SnapshotOverview> {
  return call<SnapshotOverview>(
    'list_snapshots',
    { directory },
    { directory: '', snapshots: [], attachmentCount: 0, attachmentSize: 0 },
  );
}

/** 立即创建一份快照：手动，或导入备份、永久删除、更换存储位置之前。浏览器预览不支持。 */
export function createSnapshot(
  directory: string,
  reason: Exclude<SnapshotReason, 'auto' | 'restore'>,
): Promise<DataSnapshot> {
  return call<DataSnapshot>('create_snapshot', { directory, reason });
}

/** 距最新一份快照超过一天时创建新的一份，否则返回 null；浏览器预览直接返回 null。 */
export function autoSnapshot(directory: string): Promise<DataSnapshot | null> {
  return call<DataSnapshot | null>('auto_snapshot', { directory }, null);
}

/**
 * 从快照恢复记录：后端先为当前数据创建一份快照，再用快照中的记录替换当前记录（设置与草稿不变），
 * 并从备份拷回缺失的附件。成功后调用方需让各窗口重新读库。浏览器预览不支持。
 */
export function restoreSnapshot(directory: string, id: string): Promise<RestoreReport> {
  return call<RestoreReport>('restore_snapshot', { directory, id });
}

/** 列出系统已安装的字体族名称；浏览器预览读不到系统字体，返回空列表。 */
export function systemFonts(): Promise<string[]> {
  return call<string[]>('system_fonts', undefined, []);
}

/** 读取注册失败（多半被其他程序占用）的全局快捷键编号。 */
export function shortcutConflicts(): Promise<GlobalShortcutId[]> {
  return call<GlobalShortcutId[]>('shortcut_conflicts', undefined, []);
}

/**
 * 更换全局快捷键（编号 → 按键）。后端实际注册一次新的按键，
 * 被其他程序占用时抛出原因，原来的按键保持不变。
 */
export function setGlobalShortcuts(bindings: Partial<Record<GlobalShortcutId, string>>): Promise<void> {
  return call<void>('set_global_shortcuts', { bindings }, undefined as unknown as void);
}

/** 录入快捷键期间后端发来的按键，见 src-tauri/src/recorder.rs。 */
export interface RecordedKeys {
  /** 正按住的修饰键，如 Ctrl+Shift；没有按住时为空。 */
  modifiers: string;
  /** 按下的完整组合（规范写法）；只按修饰键时为 null。 */
  combo: string | null;
  /** 后端已结束录入（设置窗口转到后台或超时）。 */
  ended: boolean;
}

/**
 * 由后端录入快捷键：Windows 上临时接管键盘，被其他程序占用的组合也能录到，
 * 录入期间其他程序与本应用的全局快捷键都不会被触发。成功时返回结束录入的函数；
 * 不支持时（浏览器预览、其他平台）返回 null，调用方改用网页的按键事件录入。
 */
export async function recordShortcut(handler: (keys: RecordedKeys) => void): Promise<(() => void) | null> {
  if (!isDesktop()) return null;
  const unlisten = await listen<RecordedKeys>(APP_EVENTS.shortcutRecorded, (event) => handler(event.payload));
  let session: number;
  try {
    session = await invoke<number>('start_shortcut_recording');
  } catch {
    unlisten();
    return null;
  }
  return () => {
    unlisten();
    // 按编号结束：快速切换录入时，上一次的结束不会停掉新开始的这一次。
    void invoke('stop_shortcut_recording', { session }).catch(() => {});
  };
}

/* ==================== 窗口控制 ==================== */

/** 按当前设置组装侧栏布局：窗口宽度随字号等比加宽（见 sidebarWindowWidth），带上出入动画时长。 */
export function sidebarLayout(
  settings: Pick<Settings, 'edge' | 'width' | 'fontSize' | 'animDuration' | 'surface'>,
): SidebarLayout {
  return {
    edge: settings.edge,
    width: sidebarWindowWidth(settings.width, settings.fontSize),
    animDuration: settings.animDuration,
    gap: Math.round(windowGap(settings.surface) * uiZoom(settings.fontSize) * 100) / 100,
  };
}

/** 显示侧栏。 */
export function showSidebar(layout: SidebarLayout): Promise<void> {
  return call<void>('show_sidebar', { layout }, undefined as unknown as void);
}

/** 隐藏侧栏；传入布局以支持滑出动画。 */
export function hideSidebar(layout: SidebarLayout): Promise<void> {
  return call<void>('hide_sidebar', { layout }, undefined as unknown as void);
}

/** 按设置重新对齐侧栏并同步边缘监视开关。 */
export function applySidebarLayout(layout: SidebarLayout, edgeTrigger: boolean): Promise<void> {
  return call<void>('apply_sidebar_layout', { layout, edgeTrigger }, undefined as unknown as void);
}

/** 隐藏速记浮窗。 */
export function hideCapture(): Promise<void> {
  return call<void>('hide_capture', undefined, undefined as unknown as void);
}

/** 系统文本缩放比例：页面像素比与窗口缩放比例之比，读取失败时按 1 处理。 */
async function textScale(): Promise<number> {
  try {
    const ratio = window.devicePixelRatio / (await getCurrentWindow().scaleFactor());
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  } catch {
    return 1;
  }
}

/**
 * 显示设置窗口；带上系统的文本缩放比例，窗口按原型的 880 × 560 换算为逻辑尺寸。
 * 比例按调用方窗口测得，其中包含字号对应的界面缩放 `zoom`（各窗口相同），这里除去：设置窗口不随字号变化。
 */
export async function showSettings(zoom = 1): Promise<void> {
  if (!isDesktop()) return;
  await invoke('show_settings', { textScale: (await textScale()) / (zoom > 0 ? zoom : 1) });
}

/**
 * 应用界面缩放（字号设置）：当前窗口的 WebView 整页缩放，设置窗口同时按比例调整尺寸。
 * 浏览器预览不缩放。
 */
export function setUiZoom(zoom: number): Promise<void> {
  return call<void>('set_ui_zoom', { zoom }, undefined as unknown as void);
}

/** 按主题设置当前窗口的材质（T84）：acrylic、clear 或 opaque，见 core/surfaces 的 windowMaterial。 */
export function setWindowMaterial(material: WindowMaterial): Promise<void> {
  return call<void>('set_window_material', { material }, undefined as unknown as void);
}

/** 指针是否在侧栏或它与屏幕边缘之间的留白里；侧栏到点收起前查询，留白里不收起（T84）。 */
export function sidebarHoldsCursor(): Promise<boolean> {
  return call<boolean>('sidebar_holds_cursor', {}, false);
}

/** 隐藏设置窗口。 */
export function hideSettings(): Promise<void> {
  return call<void>('hide_settings', undefined, undefined as unknown as void);
}

/** 窗口标签：侧栏、速记浮窗与设置。 */
export type WindowLabel = 'main' | 'capture' | 'settings';

/** 打开指定窗口的开发者工具；浏览器预览下不可用。 */
export function openDevtools(label: WindowLabel): Promise<void> {
  return call<void>('open_devtools', { label });
}

/**
 * 设置窗口当前是否显示在屏幕上（可见且未最小化）。
 *
 * 原型的设置是侧栏之上的弹窗，打开期间侧栏不会收起；桌面端设置是独立窗口，
 * 侧栏据此判断。浏览器预览或查询失败时视为未显示。
 */
export async function isSettingsVisible(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const settings = await Window.getByLabel('settings');
    if (!settings || !(await settings.isVisible())) return false;
    return !(await settings.isMinimized());
  } catch {
    return false;
  }
}

/** 最小化当前窗口；浏览器预览下无操作。 */
export async function minimizeWindow(): Promise<void> {
  if (!isDesktop()) return;
  await getCurrentWindow().minimize();
}

/**
 * 当前窗口所在屏幕的缩放比例（物理像素 / 逻辑像素）。
 *
 * 页面像素比还叠加了系统的文本缩放，两者之比才是页面像素换算到窗口逻辑像素的比例。
 * 浏览器预览没有窗口缩放，返回页面像素比，使换算比例为 1。
 */
export async function windowScaleFactor(): Promise<number> {
  if (!isDesktop()) return window.devicePixelRatio;
  try {
    return await getCurrentWindow().scaleFactor();
  } catch {
    return window.devicePixelRatio;
  }
}

/** 退出应用。 */
export function quitApp(): Promise<void> {
  return call<void>('quit_app', undefined, undefined as unknown as void);
}

/* ==================== 文件与剪贴板 ==================== */

/**
 * 读取剪贴板中的文字，供 Ctrl+K 用剪贴板里的网址生成链接。
 * 桌面端经剪贴板插件读取，不弹出网页的剪贴板授权；没有文字或读取失败时返回空串。
 */
export async function readClipboardText(): Promise<string> {
  try {
    if (isDesktop()) return (await readText()) ?? '';
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/** 把文字写入剪贴板：桌面端经剪贴板插件写入（设置窗口复制目录路径等），浏览器预览用网页的剪贴板。 */
export async function writeClipboardText(text: string): Promise<void> {
  if (isDesktop()) await writeText(text);
  else await navigator.clipboard.writeText(text);
}

/** 导入后的附件：显示名称与应用数据目录中副本的完整路径。 */
export interface ImportedFile {
  name: string;
  path: string;
}

/** 后端在请求体既不是原始字节、也没有 base64 内容时返回的错误，见 commands.rs 的 import_attachment。 */
const RAW_BODY_EXPECTED = '附件内容格式不正确';

/** 字节写成 base64，分段拼接，避免大文件一次展开参数时超过调用栈上限。 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** 取出错误说明：后端的错误是字符串，脚本错误是 Error。 */
export function errorText(error: unknown, fallback = '请稍后重试'): string {
  if (typeof error === 'string' && error) return error;
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 把一段内容（粘贴的截图或文件、拖入的文件）写成应用数据目录中的附件副本。
 *
 * 内容以原始字节传给后端，文件名放在请求头中。网页与后端的通道偶尔会回落到 postMessage
 * （实测速记浮窗在隐藏期间出现过），这时请求体只能是 JSON，改用 base64 再传一次。浏览器预览不支持。
 */
export async function importAttachment(content: Blob, name: string): Promise<ImportedFile> {
  if (!isDesktop()) throw new Error('浏览器预览不支持保存附件');
  const bytes = new Uint8Array(await content.arrayBuffer());
  try {
    return await invoke<ImportedFile>('import_attachment', bytes, { headers: { 'X-File-Name': encodeURIComponent(name) } });
  } catch (error) {
    if (error !== RAW_BODY_EXPECTED) throw error;
    return invoke<ImportedFile>('import_attachment', { name, data: toBase64(bytes) });
  }
}

/** 把用户选择的文件复制为附件副本，按选择顺序返回。 */
export function importFiles(paths: string[]): Promise<ImportedFile[]> {
  return call<ImportedFile[]>('import_files', { paths });
}

/** 用系统对话框选择要引用的文件（默认可多选，`images` 时只列出图片）；取消时返回 null，浏览器预览不支持。 */
export async function chooseFiles(options: { multiple?: boolean; images?: boolean } = {}): Promise<string[] | null> {
  if (!isDesktop()) throw new Error('浏览器预览不支持引用文件');
  const picked = await openDialog({
    multiple: options.multiple ?? true,
    directory: false,
    filters: options.images
      ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'] }]
      : undefined,
  });
  if (!picked) return null;
  return Array.isArray(picked) ? picked : [picked];
}

/**
 * 把附件副本另存到用户选择的位置；只能另存附件文件夹中的文件，由后端校验。
 * 返回 false 表示用户取消，浏览器预览不支持。
 */
export async function saveAttachmentAs(path: string, name: string): Promise<boolean> {
  if (!isDesktop()) throw new Error('浏览器预览不支持另存文件');
  const destination = await saveDialog({ defaultPath: name });
  if (!destination) return false;
  await invoke('export_attachment', { path, destination });
  return true;
}

/**
 * 把一段内容（以 data URL 保存在记录里的图片附件）另存到用户选择的位置。
 * 路径来自系统对话框，对话框插件会把它加入文件系统作用域。返回 false 表示用户取消。
 */
export async function saveBytesAs(bytes: Uint8Array, name: string): Promise<boolean> {
  if (!isDesktop()) throw new Error('浏览器预览不支持另存文件');
  const destination = await saveDialog({ defaultPath: name });
  if (!destination) return false;
  await writeFile(destination, bytes);
  return true;
}

/** 读取用户在系统对话框中选择的文件（对话框插件已把它加入文件系统作用域）。 */
export function readChosenFile(path: string): Promise<Uint8Array> {
  if (!isDesktop()) return Promise.reject(new Error('浏览器预览不支持读取本地文件'));
  return readFile(path);
}

/** 本机文件的显示地址（应用的本地文件协议，只能读到应用数据目录中的附件副本）；浏览器预览原样返回。 */
export function localFileUrl(path: string): string {
  return isDesktop() ? convertFileSrc(path) : path;
}

/** 校验文件引用是否仍然可用。 */
export function inspectFile(path: string): Promise<FileStatus> {
  return call<FileStatus>('inspect_file', { path }, { exists: false, size: 0, isDirectory: false });
}

/**
 * 把文件路径写入剪贴板。
 *
 * 返回 true 表示写入了系统原生文件剪贴板；当前实现只写入路径文本并返回 false，
 * 界面据此明确提示，不把结果伪装成可直接粘贴为附件。
 */
export function copyFilePaths(paths: string[]): Promise<boolean> {
  return call<boolean>('copy_file_paths', { paths }, false);
}

/** 备份文件的体积上限，与原型一致。 */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const BACKUP_FILTERS = [{ name: 'SideNotes JSON 备份', extensions: ['json'] }];

/**
 * 导出备份：后端在 `directory` 下新建名为 `name` 的文件夹（重名时加序号），写入 JSON 内容，
 * 并把记录引用的附件复制到其中的 attachments 文件夹。浏览器预览不支持。
 */
export function exportBackup(directory: string, name: string, contents: string): Promise<ExportReport> {
  return call<ExportReport>('export_backup', { directory, name, contents });
}

/** 让用户选择备份 JSON 并读取；返回路径与文本，取消时返回 null。 */
export async function openBackupFile(): Promise<{ path: string; text: string } | null> {
  if (!isDesktop()) throw new Error('浏览器预览不支持读取本地文件');
  const path = await openDialog({ multiple: false, directory: false, filters: BACKUP_FILTERS });
  if (!path || Array.isArray(path)) return null;
  const status = await inspectFile(path);
  if (status.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 25 MB，请选择较小的 JSON 文件');
  return { path, text: await readTextFile(path) };
}

/** 导入备份时拷回附件：把 JSON 文件旁边 `folder` 中的附件复制到数据目录，已有的保留，返回新复制的数量。 */
export function importBackupAttachments(file: string, folder: string): Promise<number> {
  return call<number>('import_backup_attachments', { file, folder });
}

/** 让用户选择目录；`title` 为对话框标题。取消时返回 null。 */
export async function pickDirectory(title?: string): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await openDialog({ multiple: false, directory: true, title });
  return typeof path === 'string' ? path : null;
}

/** 在资源管理器中定位文件或目录。 */
export async function revealInFolder(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('浏览器预览不能打开系统文件夹');
  await revealItemInDir(path);
}

/**
 * 用系统默认程序打开卡片中引用的文件。
 * 只能打开应用数据目录中的附件副本，由后端校验实际路径；其它路径会被拒绝。
 */
export async function openFile(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('浏览器预览不能打开本地文件');
  await invoke('open_attachment', { path });
}

/** 用系统浏览器打开外部链接；浏览器预览由链接自身处理。 */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await openUrl(url);
}

/** 读取系统通知权限；非桌面环境视为不支持。 */
export async function notificationGranted(): Promise<boolean | null> {
  if (!isDesktop()) return null;
  try {
    return await isPermissionGranted();
  } catch {
    return null;
  }
}

/** 申请系统通知权限，返回是否已允许。 */
export async function requestNotifications(): Promise<boolean> {
  if (!isDesktop()) return false;
  return (await requestPermission()) === 'granted';
}

/* ==================== 事件订阅 ==================== */

/** 订阅后端事件；非桌面环境返回空的取消函数。 */
export async function onAppEvent(event: string, handler: () => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return listen(event, () => handler());
}

/**
 * 一次建立几个订阅，返回立即可用的取消函数，供 effect 的清理使用。
 *
 * 订阅是异步建立的，清理可能先于建立完成执行：开发模式下 StrictMode 会挂载、卸载再挂载一次，
 * 热更新也会重跑 effect。迟到的订阅在建立后立即取消，否则同一事件会留下两个处理函数，
 * 按一次快捷键切换两次，窗口显示后立刻又被收起。
 */
export function subscribeAll(pending: ReadonlyArray<Promise<UnlistenFn>>): () => void {
  let disposed = false;
  const active: UnlistenFn[] = [];
  for (const subscription of pending) {
    subscription
      .then((unlisten) => {
        if (disposed) unlisten();
        else active.push(unlisten);
      })
      .catch(() => {
        /* 订阅失败时没有需要取消的处理函数。 */
      });
  }
  return () => {
    disposed = true;
    active.splice(0).forEach((unlisten) => unlisten());
  };
}

/** 向所有窗口广播一次数据变化；通知失败不影响本窗口已完成的写入。 */
export async function emitStoreChange(change: StoreChange): Promise<void> {
  if (!isDesktop()) return;
  try {
    await emit(APP_EVENTS.storeChanged, change);
  } catch {
    /* 其它窗口获得焦点时会重新读库兜底。 */
  }
}

/** 订阅其它窗口的数据变化。 */
export async function onStoreChange(handler: (change: StoreChange) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return listen<StoreChange>(APP_EVENTS.storeChanged, (event) => handler(event.payload));
}

/** 订阅设置窗口的显示状态（可见且未最小化）变化。 */
export async function onSettingsVisibility(handler: (showing: boolean) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return listen<boolean>(APP_EVENTS.settingsVisibility, (event) => handler(Boolean(event.payload)));
}

/* ==================== 记录窗口（T83，技术决策第 41 条） ==================== */

/** 页面像素或物理像素的矩形，由用途决定。 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 记录窗口的打开请求（后端 note_windows::OpenPayload）。 */
export interface NoteWindowOpen {
  tabs: string[];
  active: string;
  pinned: boolean;
  /** drag：拖出的，关闭时倾斜着缩回卡片；expand：展开全文的，原路滑回。 */
  origin: 'drag' | 'expand';
  /** 出场动画：展开全文、拖出侧栏、标签页拆出；restore 为开发时整页重载后恢复原来的标签页。 */
  kind: 'expand' | 'drop' | 'detach' | 'restore';
  /** 目标屏幕的工作区（物理像素）。 */
  area: PixelRect;
}

/** 记录窗口、动画层与侧栏之间的事件（后端 note_windows::events）。 */
export const NOTE_WINDOW_EVENTS = {
  open: 'sidenotes://note-window/open',
  add: 'sidenotes://note-window/add',
  remove: 'sidenotes://note-window/remove',
  activate: 'sidenotes://note-window/activate',
  hint: 'sidenotes://note-window/hint',
  close: 'sidenotes://note-window/close',
  ghost: 'sidenotes://overlay/ghost',
  indicator: 'sidenotes://overlay/indicator',
  morph: 'sidenotes://overlay/morph',
  clear: 'sidenotes://overlay/clear',
  land: 'sidenotes://card-land',
  /** 记录窗口问侧栏：这条记录的卡片在屏幕上的位置（关闭时缩回去），载荷 { id, reply }。 */
  cardRectRequest: 'sidenotes://card-rect-request',
  /** 侧栏的回答，载荷 { id, rect }，rect 为屏幕物理像素，卡片看不见时为 null。 */
  cardRect: 'sidenotes://card-rect',
  /** 记录窗口里点了标签：侧栏按这个标签筛选，载荷为标签名。 */
  filterTag: 'sidenotes://filter-tag',
} as const;

/** 页面矩形（DOMRect）取出可以序列化的四个值。 */
export function rectOf(rect: DOMRect | PixelRect): PixelRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * 只订阅发给本窗口的事件。后端用 emit_to 指定窗口发送，但默认的 listen 收得到发给任何窗口的事件，
 * 记录窗口之间会互相串，所以按本窗口的标签订阅。
 */
export async function onWindowEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return getCurrentWebviewWindow().listen<T>(event, (received) => handler(received.payload));
}

/** 发事件给指定窗口。 */
export async function emitToWindow(label: string, event: string, payload: unknown): Promise<void> {
  if (!isDesktop()) return;
  try {
    await emitTo(label, event, payload);
  } catch {
    /* 窗口已经关闭。 */
  }
}

/** 当前窗口的标签；浏览器预览为空串。 */
export function currentLabel(): string {
  if (!isDesktop()) return '';
  try {
    return getCurrentWindow().label;
  } catch {
    return '';
  }
}

/** 当前窗口内容区左上角在屏幕上的位置（物理像素）。 */
export async function innerOrigin(): Promise<{ x: number; y: number }> {
  if (!isDesktop()) return { x: window.screenX, y: window.screenY };
  const position = await getCurrentWindow().innerPosition();
  return { x: position.x, y: position.y };
}

/** 当前窗口是否显示中。 */
export async function isWindowVisible(): Promise<boolean> {
  if (!isDesktop()) return true;
  try {
    return await getCurrentWindow().isVisible();
  } catch {
    return false;
  }
}

/** 记录窗口启动：取等着它的打开请求（备用窗口没有时为 null，之后用事件送达）。 */
export function noteWindowInit(): Promise<NoteWindowOpen | null> {
  return call<NoteWindowOpen | null>('note_window_init', undefined, null);
}

/** 展开全文：在记录窗口中打开，`from` 为卡片的矩形（页面像素）。已经打开时切到它的标签页。 */
export function openNoteWindow(ids: string[], from: DOMRect | null): Promise<void> {
  return call<void>(
    'open_note_window',
    { ids, from: from ? rectOf(from) : null, dpr: window.devicePixelRatio },
    undefined as unknown as void,
  );
}

/**
 * 量好尺寸（页面像素）后显示窗口；`snapshot` 为窗口的副本，动画层用它播放打开动画，为空时直接显示。
 * 换算成物理像素再交给后端：页面像素比含 Windows 的文本缩放，后端算不出来。
 */
export function presentNoteWindow(width: number, height: number, snapshot: string | null): Promise<void> {
  const ratio = window.devicePixelRatio;
  return call<void>('note_window_present', { width: width * ratio, height: height * ratio, dpr: ratio, snapshot }, undefined as unknown as void);
}

/** 标签页、当前页、置顶与标题栏的位置（页面像素）同步给后端。 */
export function syncNoteWindow(state: { tabs: string[]; active: string; pinned: boolean; bands: PixelRect[] }): Promise<void> {
  return call<void>('note_window_sync', { ...state, dpr: window.devicePixelRatio }, undefined as unknown as void);
}

/** 关闭窗口：有副本时在动画层上缩回 `to`（卡片在屏幕上的矩形），`to` 为空时原地提起淡出；没有副本时直接关闭。 */
export function closeNoteWindow(snapshot: string | null, to: PixelRect | null): Promise<void> {
  return call<void>('note_window_close', { snapshot, to }, undefined as unknown as void);
}

/** 直接关闭当前记录窗口，不播放动画。 */
export function destroyNoteWindow(): Promise<void> {
  return call<void>('note_window_destroy', undefined, undefined as unknown as void);
}

/** 双击标题栏：放大到工作区里侧栏之外的部分，再双击还原。 */
export function maximizeNoteWindow(): Promise<void> {
  return call<void>('note_window_maximize', { dpr: window.devicePixelRatio }, undefined as unknown as void);
}

/** 窗口加宽 `delta`（页面像素，负数为减窄）：标签页换到左侧或顶部时，正文宽度不变。 */
export function widenNoteWindow(delta: number): Promise<void> {
  return call<void>('note_window_widen', { delta, dpr: window.devicePixelRatio }, undefined as unknown as void);
}

/** 关闭全部记录窗口，返回是否有窗口。 */
export function closeAllNoteWindows(): Promise<boolean> {
  return call<boolean>('close_all_note_windows', undefined, false);
}

/** 跨窗口拖动：卡片拖出侧栏、标签页拖出窗口、拖动窗口的标题栏。 */
export type DragKind = 'cards' | 'tab' | 'move';

/** 开始拖动。`html` 为拖影（画在动画层上），`ghost` 为拖影的大小，`grab` 为指针相对拖影左上角（页面像素）。 */
export function dragBegin(request: {
  kind: DragKind;
  ids: string[];
  html?: string;
  ghost?: PixelRect;
  grab?: [number, number];
}): Promise<void> {
  return call<void>(
    'drag_begin',
    { request: { ...request, grab: request.grab ?? [0, 0], dpr: window.devicePixelRatio } },
    undefined as unknown as void,
  );
}

/** 拖动的一步：`outside` 为指针离开了来源（侧栏或窗口）。返回指针下可以合并的窗口。 */
export function dragUpdate(outside: boolean): Promise<string | null> {
  return call<string | null>('drag_update', { outside }, null);
}

/** 结束拖动：`drop` 为假时取消；`detach` 为标签页拖到窗口外时可以拆成新窗口（窗口不止一个标签页）。 */
export function dragEnd(drop: boolean, outside: boolean, detach = false): Promise<{ target: string | null; opened: boolean }> {
  return call('drag_end', { drop, outside, detach }, { target: null, opened: false });
}

/** 拖动经过本窗口时算出的插入线（页面像素），由动画层画在最上面；null 时收起。 */
export function dragIndicator(rect: PixelRect | null, horizontal: boolean): Promise<void> {
  return call<void>('drag_indicator', { rect, horizontal, dpr: window.devicePixelRatio }, undefined as unknown as void);
}

/** 动画层：关闭动画的第一帧已经画出。 */
export function overlayReady(id: number): Promise<void> {
  return call<void>('overlay_ready', { id }, undefined as unknown as void);
}

/** 动画层：动画播放完毕。 */
export function overlayDone(id: number): Promise<void> {
  return call<void>('overlay_done', { id }, undefined as unknown as void);
}

/** 系统画边框的窗口：获得焦点时边框的颜色（#rrggbb），null 恢复默认。 */
export function setWindowBorderColor(color: string | null): Promise<void> {
  return call<void>('set_window_border_color', { color }, undefined as unknown as void);
}

/** 缩放手柄的边与系统缩放方向的对应。 */
const RESIZE_DIRECTIONS = {
  n: 'North',
  s: 'South',
  e: 'East',
  w: 'West',
  ne: 'NorthEast',
  nw: 'NorthWest',
  se: 'SouthEast',
  sw: 'SouthWest',
} as const;

/** 按住窗口的边或角缩放（系统的缩放手势）。 */
export async function startResizeDragging(edge: string): Promise<void> {
  if (!isDesktop() || !(edge in RESIZE_DIRECTIONS)) return;
  await getCurrentWindow().startResizeDragging(RESIZE_DIRECTIONS[edge as keyof typeof RESIZE_DIRECTIONS]);
}

/* ==================== 应用图标（T85） ==================== */

/** 上传的图片。 */
export interface CustomAppIcon {
  /** PNG 的完整路径（系统应用数据目录的 app-icon/custom.png）。 */
  path: string;
  /** 修改时间（毫秒）：换了图片时显示地址随之变化，不读缓存。 */
  modified: number;
}

/** 任一窗口上传或移除了自定义图标后，后端广播的事件。 */
export const APP_ICON_CHANGED = 'sidenotes://app-icon-changed';

/** 更换各窗口与托盘的图标：folder 为内置图标的目录名，为 null 时用上传的图片。 */
export function applyAppIcon(folder: string | null): Promise<void> {
  return call<void>('apply_app_icon', { folder }, undefined as unknown as void);
}

/** 读取上传的图片；没有上传或在浏览器预览中为 null。 */
export function customAppIcon(): Promise<CustomAppIcon | null> {
  return call<CustomAppIcon | null>('custom_app_icon', undefined, null);
}

/** 保存裁好的图片：512 × 512 的 PNG 与多尺寸的 ICO。 */
export function saveCustomAppIcon(png: Uint8Array, ico: Uint8Array): Promise<CustomAppIcon> {
  return call<CustomAppIcon>('save_custom_app_icon', { png: Array.from(png), ico: Array.from(ico) });
}

/** 移除上传的图片。 */
export function removeCustomAppIcon(): Promise<void> {
  return call<void>('remove_custom_app_icon');
}

/** 读出上传的图片（移除前保存一份，撤销时写回）；读不到时为 null。 */
export async function readCustomAppIcon(path: string): Promise<{ png: Uint8Array; ico: Uint8Array } | null> {
  if (!isDesktop()) return null;
  try {
    const [png, ico] = await Promise.all([readFile(path), readFile(path.replace(/\.png$/i, '.ico'))]);
    return { png, ico };
  } catch {
    return null;
  }
}

/** 订阅自定义图标的变化（任一窗口上传或移除）。 */
export function onAppIconChanged(handler: () => void): Promise<UnlistenFn> {
  return onAppEvent(APP_ICON_CHANGED, handler);
}
