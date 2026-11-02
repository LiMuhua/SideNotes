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

/** 提示条在窗口中弹出的位置。 */
export type ToastPosition = 'top-center' | 'top-right' | 'bottom-center';

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
  /** 设置的结构版本，用于升级时迁移旧的默认值。 */
  settingsVersion: number;
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
  /** 卡片正文的最大高度（按 13px 字号计的网页像素），超出部分渐隐，双击卡片查看全文。 */
  cardMaxHeight: number;
  /** 提示条弹出的位置。 */
  toastPosition: ToastPosition;
  /** 是否已看过使用指南；首次启动时显示一次，之后可从侧栏菜单再次打开。 */
  guideSeen: boolean;
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
  /** 附件副本数。 */
  attachmentCount: number;
  /** 附件副本的总字节数。 */
  attachmentSize: number;
  /** 系统应用数据目录（「应用数据目录」选项的位置）。 */
  defaultDirectory: string;
  /** 便携模式的数据目录（程序所在文件夹下的 SideNotesData）。 */
  portableDirectory: string;
  /** 启动时记下的数据目录不可用、暂时改用默认目录时，为原来的目录；否则为空。 */
  unavailableDirectory: string;
}

/** 更换数据存储位置的结果。 */
export interface MigrationReport {
  /** 新的数据目录。 */
  directory: string;
  /** 复制的附件数。 */
  attachments: number;
  /** 改写了附件路径的记录与草稿数。 */
  rewritten: number;
  /** 新目录中原有的数据库改名后的路径；没有时为空。 */
  backup: string;
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
