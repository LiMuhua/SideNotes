/**
 * Tauri 命令与事件的前端封装。
 *
 * 所有平台调用集中在此，界面组件不直接引用 Tauri API：
 * 既便于在 jsdom 环境下测试，也让非 Tauri 环境（如纯浏览器预览）可以降级运行。
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Draft, EdgeSide, FileStatus, Note, Settings, Snapshot, StorageInfo, TagUsage } from './types';
import { normalizeDraft, normalizeNote } from './notes';
import { normalizeSettings } from './settings';

/** 侧栏几何参数。 */
export interface SidebarLayout {
  edge: EdgeSide;
  width: number;
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
} as const;

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

/** 隐藏侧栏。 */
export function hideSidebar(): Promise<void> {
  return call<void>('hide_sidebar', undefined, undefined as unknown as void);
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

/** 同步固定状态：固定时保留任务栏图标便于 Alt+Tab 切回。 */
export function setSidebarPinned(pinned: boolean): Promise<void> {
  return call<void>('set_sidebar_pinned', { pinned }, undefined as unknown as void);
}

/** 退出应用。 */
export function quitApp(): Promise<void> {
  return call<void>('quit_app', undefined, undefined as unknown as void);
}

/* ==================== 文件与剪贴板 ==================== */

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

/* ==================== 事件订阅 ==================== */

/** 订阅后端事件；非桌面环境返回空的取消函数。 */
export async function onAppEvent(event: string, handler: () => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return listen(event, () => handler());
}
