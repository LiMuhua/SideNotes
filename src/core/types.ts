/**
 * 记录、草稿与设置的类型定义。
 *
 * 字段与 Rust 侧 `models.rs` 对应，命名保持 camelCase；
 * 迁移自原型的逻辑沿用同一套字段名，避免重复的转换层。
 */

/** 记录所在位置。 */
import type { ShortcutBindings } from './shortcuts';

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

/** 主题（代码中沿用设置字段名 surface）：终端、杂志、记录纸、Windows 11、磨砂玻璃。 */
export type SurfaceMode = 'terminal' | 'magazine' | 'paper' | 'win11' | 'glass';

/** 记录窗口的标签页位置：左侧竖排或顶部横排。 */
export type WindowTabsPosition = 'side' | 'top';

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
  /** 字体；空字符串表示跟随主题，「系统默认」是 Segoe UI 与微软雅黑 UI。 */
  fontFamily: string;
  /** 字号 8–24，步长 0.5；作用是整页缩放（界面按 13px 设计）。 */
  fontSize: number;
  /** 应用图标：内置图标的 id，或 custom 表示上传的图片，见 core/appIcons。 */
  appIcon: string;
  edge: EdgeSide;
  width: number;
  /** 鼠标移出后收起侧栏的延迟，毫秒。 */
  hideDelay: number;
  /** 侧栏出入动画时长，毫秒；0 表示关闭动画。 */
  animDuration: number;
  /** 进入编辑时把卡片滚到列表顶部。编辑期间侧栏一律保持展开，不再提供开关。 */
  scrollOnEdit: boolean;
  /** 鼠标移到屏幕边缘时唤出侧栏。 */
  edgeTrigger: boolean;
  /** 卡片正文的最大高度（按 13px 字号计的网页像素），超出部分渐隐，双击卡片查看全文。 */
  cardMaxHeight: number;
  /** 提示条弹出的位置。 */
  toastPosition: ToastPosition;
  /** 记录窗口的标签页在左侧还是顶部。 */
  windowTabs: WindowTabsPosition;
  /** 固定为页签的标签，按页签栏的顺序保存，不带 #。 */
  pinnedTags: string[];
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
  /** 快照目录；为空时使用数据目录下的 snapshots 文件夹。 */
  snapshotDirectory: string;
  /** 改过的快捷键；没有出现的命令使用默认按键，见 core/shortcuts。 */
  shortcuts: ShortcutBindings;
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

/** 导出备份的结果。 */
export interface ExportReport {
  /** 导出的文件夹。 */
  directory: string;
  /** 其中的 JSON 文件。 */
  file: string;
  /** 一并导出的附件数。 */
  attachments: number;
  /** 记录引用了、但数据目录中已经找不到的附件数。 */
  missing: number;
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

/** 附件清理结果。 */
export interface CleanupReport {
  /** 删除的附件数。 */
  removed: number;
  /** 释放的字节数。 */
  freed: number;
  /** 没有被引用、但刚导入不久而暂时保留的附件数。 */
  pending: number;
}

/**
 * 快照的创建原因：每天自动、手动、导入备份前、永久删除前、更换存储位置前、恢复快照前。
 * 自动与恢复前的快照由后端自己创建。
 */
export type SnapshotReason = 'auto' | 'manual' | 'import' | 'delete' | 'migrate' | 'restore';

/** 一份数据快照：数据库副本与它引用的附件（附件在快照目录中只备份一次，所有快照共用）。 */
export interface DataSnapshot {
  /** 编号，取创建时的毫秒时间戳。 */
  id: string;
  createdAt: number;
  reason: SnapshotReason;
  /** 创建时的数据目录。 */
  dataDirectory: string;
  /** 记录条数（含回收站）。 */
  noteCount: number;
  /** 引用的附件子文件夹名。 */
  attachments: string[];
  /** 引用了、但数据目录与备份中都找不到的附件子文件夹。 */
  missing: string[];
}

/** 快照目录的概况。 */
export interface SnapshotOverview {
  directory: string;
  /** 按创建时间从新到旧排列，附带数据库快照文件的字节数。 */
  snapshots: Array<DataSnapshot & { size: number }>;
  /** 备份的附件子文件夹数与总字节数。 */
  attachmentCount: number;
  attachmentSize: number;
}

/** 从快照恢复的结果。 */
export interface RestoreReport {
  /** 恢复前为当前数据创建的快照编号。 */
  backup: string;
  /** 恢复后的记录条数（含回收站）。 */
  notes: number;
  /** 从备份拷回数据目录的附件数。 */
  restoredAttachments: number;
  /** 快照引用了、但备份中也找不到的附件数。 */
  missingAttachments: number;
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
