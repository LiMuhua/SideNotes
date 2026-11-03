/**
 * Tauri 命令与事件的前端封装。
 *
 * 所有平台调用集中在此，界面组件不直接引用 Tauri API：
 * 既便于在 jsdom 环境下测试，也让非 Tauri 环境（如纯浏览器预览）可以降级运行。
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, Window } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
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
import { normalizeSettings, sidebarWindowWidth } from './settings';

/** 侧栏几何参数。 */
export interface SidebarLayout {
  edge: EdgeSide;
  width: number;
  /** 出入动画时长（毫秒），0 表示关闭动画。 */
  animDuration?: number;
}

/** 后端事件名。 */
export const APP_EVENTS = {
  /** 鼠标进入屏幕边缘热区。 */
  edgeEnter: 'sidenotes://edge-enter',
  /** 全局热键：呼出速记浮窗。 */
  hotkeyCapture: 'sidenotes://hotkey-capture',
  /** 全局热键：呼出侧栏。 */
  hotkeySidebar: 'sidenotes://hotkey-sidebar',
  /** 托盘：显示侧栏。 */
  traySidebar: 'sidenotes://tray-sidebar',
  /** 托盘：快捷速记。 */
  trayCapture: 'sidenotes://tray-capture',
  /** 托盘：打开设置。 */
  traySettings: 'sidenotes://tray-settings',
  /** 托盘：请求退出。 */
  trayQuit: 'sidenotes://tray-quit',
  /** 任一窗口写入数据库后广播，其它窗口据此刷新内存状态。 */
  storeChanged: 'sidenotes://store-changed',
  /** 设置窗口打开、关闭、最小化或还原，载荷为是否正在显示。 */
  settingsVisibility: 'sidenotes://settings-visibility',
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

/** 读取启动时注册失败的全局热键。 */
export function shortcutConflicts(): Promise<string[]> {
  return call<string[]>('shortcut_conflicts', undefined, []);
}

/* ==================== 窗口控制 ==================== */

/** 按当前设置组装侧栏布局：窗口宽度随字号等比加宽（见 sidebarWindowWidth），带上出入动画时长。 */
export function sidebarLayout(
  settings: Pick<Settings, 'edge' | 'width' | 'fontSize' | 'animDuration'>,
): SidebarLayout {
  return {
    edge: settings.edge,
    width: sidebarWindowWidth(settings.width, settings.fontSize),
    animDuration: settings.animDuration,
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

/** 切换侧栏，返回切换后的可见状态。 */
export function toggleSidebar(layout: SidebarLayout): Promise<boolean> {
  return call<boolean>('toggle_sidebar', { layout }, true);
}

/** 按设置重新对齐侧栏并同步边缘监视开关。 */
export function applySidebarLayout(layout: SidebarLayout, edgeTrigger: boolean): Promise<void> {
  return call<void>('apply_sidebar_layout', { layout, edgeTrigger }, undefined as unknown as void);
}

/** 显示速记浮窗。 */
export function showCapture(): Promise<void> {
  return call<void>('show_capture', undefined, undefined as unknown as void);
}

/** 隐藏速记浮窗。 */
export function hideCapture(): Promise<void> {
  return call<void>('hide_capture', undefined, undefined as unknown as void);
}

/** 切换速记浮窗。 */
export function toggleCapture(): Promise<boolean> {
  return call<boolean>('toggle_capture', undefined, true);
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
 * 显示设置窗口；带上文本缩放比例，使设置内容按原型尺寸完整显示。
 * 比例按调用方窗口测得，已包含字号对应的界面缩放（各窗口的缩放相同）。
 */
export async function showSettings(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('show_settings', { textScale: await textScale() });
}

/**
 * 应用界面缩放（字号设置）：当前窗口的 WebView 整页缩放，设置窗口同时按比例调整尺寸。
 * 浏览器预览不缩放。
 */
export function setUiZoom(zoom: number): Promise<void> {
  return call<void>('set_ui_zoom', { zoom }, undefined as unknown as void);
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

/** 同步固定状态：固定时保留任务栏图标便于 Alt+Tab 切回。 */
export function setSidebarPinned(pinned: boolean): Promise<void> {
  return call<void>('set_sidebar_pinned', { pinned }, undefined as unknown as void);
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
