/**
 * 记录、草稿与设置的类型定义。
 *
 * 字段与 Rust 侧 `models.rs` 对应，命名保持 camelCase；
 * 迁移自原型的逻辑沿用同一套字段名，避免重复的转换层。
 */

/** 记录所在位置。 */
export type NoteStatus = 'active' | 'archived' | 'trash';

/** 列表页签。 */
export type TabKey = 'workspace' | 'pinned' | 'archive';

/** 图片附件，以 data URL 内嵌保存，便于导入原型备份。 */
export interface NoteImage {
  id: string;
  name: string;
  /** MIME 类型，如 image/png。 */
  type: string;
  /** data URL。 */
  data: string;
}

/** 一条记录。 */
export interface Note {
  id: string;
  /** Markdown 原文，标签以独立行写在正文末尾。 */
  text: string;
  emoji: string;
  images: NoteImage[];
  pinned: boolean;
  /** 正文是否折叠，仅保留标题行与操作行。 */
  collapsed: boolean;
  status: NoteStatus;
  /** 移入回收站前的位置，用于恢复。 */
  previousStatus: Exclude<NoteStatus, 'trash'>;
  /** 手动排序后的序号；null 表示按创建时间倒序。 */
  order: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** 两个入口共享的草稿。 */
export interface Draft {
  text: string;
  images: NoteImage[];
  updatedAt: number;
}

/** 标签访问统计，用于标签菜单评分。 */
export interface TagUsage {
  count: number;
  last: number;
}

/** 明暗模式。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 界面材质。 */
export type SurfaceMode = 'standard' | 'paper' | 'glass' | 'win11';

/** 侧栏贴附边缘。 */
export type EdgeSide = 'left' | 'right';

/** 数据目录位置。 */
export type StorageLocation = 'appdata' | 'portable' | 'custom';

/** 备份服务提供方。 */
export type CloudProvider = 'synology' | 'google' | 'onedrive';

/** 云端备份配置。 */
export interface CloudSettings {
  enabled: boolean;
  provider: CloudProvider;
  endpoint: string;
  account: string;
  folder: string;
  lastBackup: number;
  lastError: string;
  notifications: boolean;
}

/** 应用设置。 */
export interface Settings {
  theme: ThemeMode;
  surface: SurfaceMode;
  fontFamily: string;
  fontSize: number;
  edge: EdgeSide;
  width: number;
  /** 鼠标移出后收起侧栏的延迟，毫秒。 */
  hideDelay: number;
  /** 侧栏出入动画时长，毫秒；0 表示关闭动画。 */
  animDuration: number;
  /** 编辑期间保持侧栏展开。 */
  protectEditing: boolean;
  /** 鼠标移到屏幕边缘时唤出侧栏。 */
  edgeTrigger: boolean;
  /** 滚动按需加载。 */
  lazyLoading: boolean;
  /** 每批加载条数。 */
  pageSize: number;
  /** 整理提醒的忽略截止时间。 */
  tidySnoozeUntil: number;
  /** 工作区整理提醒阈值，0 表示关闭。 */
  tidyLimit: number;
  storageLocation: StorageLocation;
  customDirectory: string;
  /** 回收站保留天数。 */
  trashDays: number;
  cloud: CloudSettings;
}

/** 从后端读取的完整快照。 */
export interface Snapshot {
  notes: Note[];
  draft: Draft;
  settings: Settings;
  tagUsage: Record<string, TagUsage>;
}

/** 数据目录信息。 */
export interface StorageInfo {
  directory: string;
  database: string;
  size: number;
  noteCount: number;
}

/** 文件引用校验结果。 */
export interface FileStatus {
  exists: boolean;
  size: number;
  isDirectory: boolean;
}

/** 提示条动作。 */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** 提示条。 */
export interface ToastItem {
  id: string;
  message: string;
  action?: ToastAction;
  error?: boolean;
}

/** 正在进行的编辑事务：确认前不写入记录。 */
export interface EditSession {
  id: string;
  text: string;
  images: NoteImage[];
  originalText: string;
  originalImages: NoteImage[];
}
