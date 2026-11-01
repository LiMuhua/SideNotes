/**
 * Tauri 命令与事件的前端封装。
 *
 * 所有平台调用集中在此，界面组件不直接引用 Tauri API：
 * 既便于在 jsdom 环境下测试，也让非 Tauri 环境（如纯浏览器预览）可以降级运行。
 */

import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, Window } from '@tauri-apps/api/window';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Draft, EdgeSide, FileStatus, Note, Settings, Snapshot, StorageInfo, TagUsage } from './types';
import { normalizeDraft, normalizeNote } from './notes';
import { normalizeSettings } from './settings';

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
  });
}

/** 读取启动时注册失败的全局热键。 */
export function shortcutConflicts(): Promise<string[]> {
  return call<string[]>('shortcut_conflicts', undefined, []);
}

/* ==================== 窗口控制 ==================== */

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

/** 显示设置窗口；带上文本缩放比例，使设置内容按原型尺寸完整显示。 */
export async function showSettings(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('show_settings', { textScale: await textScale() });
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
 * 让用户选择保存位置并写入备份文本。
 *
 * 路径来自系统对话框，对话框插件会把所选路径加入文件系统作用域，
 * 因此不需要放宽固定目录之外的写入权限。返回 false 表示用户取消。
 */
export async function saveBackupFile(defaultName: string, contents: string): Promise<boolean> {
  if (!isDesktop()) throw new Error('浏览器预览不支持写入本地文件');
  const path = await saveDialog({ defaultPath: defaultName, filters: BACKUP_FILTERS });
  if (!path) return false;
  await writeTextFile(path, contents);
  return true;
}

/** 让用户选择备份文件并读取文本；取消时返回 null。 */
export async function openBackupFile(): Promise<string | null> {
  if (!isDesktop()) throw new Error('浏览器预览不支持读取本地文件');
  const path = await openDialog({ multiple: false, directory: false, filters: BACKUP_FILTERS });
  if (!path || Array.isArray(path)) return null;
  const status = await inspectFile(path);
  if (status.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 25 MB，请选择较小的 JSON 文件');
  return readTextFile(path);
}

/** 让用户选择目录；取消时返回 null。 */
export async function pickDirectory(): Promise<string | null> {
  if (!isDesktop()) return null;
  const path = await openDialog({ multiple: false, directory: true });
  return typeof path === 'string' ? path : null;
}

/** 在资源管理器中定位文件或目录。 */
export async function revealInFolder(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('浏览器预览不能打开系统文件夹');
  await revealItemInDir(path);
}

/** 用系统默认程序打开卡片中引用的文件。 */
export async function openFile(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('浏览器预览不能打开本地文件');
  await openPath(path);
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
