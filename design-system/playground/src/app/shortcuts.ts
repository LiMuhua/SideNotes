/**
 * 快捷键表：侧栏、速记浮窗、设置页与文档共用同一份定义。
 *
 * 默认按键取自现有应用 0.7.3（`src/core/shortcuts.ts`，可在设置中重新绑定）；
 * `proposed` 标出的是本次设计提出的补充（键盘在卡片之间移动、Enter 编辑、Delete 移入回收站），尚未实现。
 */

export type ShortcutGroup = '全局' | '侧栏' | '编辑' | '格式';

export interface ShortcutSpec {
  id: string;
  label: string;
  keys: string;
  group: ShortcutGroup;
  /** 可在设置中重新绑定。 */
  rebindable?: boolean;
  /** 本次设计提出、现有应用尚未实现的操作。 */
  proposed?: boolean;
}

export const SHORTCUTS: readonly ShortcutSpec[] = [
  { id: 'capture', label: '呼出速记', keys: 'Ctrl+Shift+Space', group: '全局', rebindable: true },
  { id: 'sidebar', label: '呼出侧栏', keys: 'Alt+Shift+S', group: '全局', rebindable: true },
  { id: 'newNote', label: '新建记录', keys: 'Ctrl+N', group: '侧栏', rebindable: true },
  { id: 'search', label: '搜索记录与标签', keys: 'Ctrl+F', group: '侧栏', rebindable: true },
  { id: 'copy', label: '复制选中的记录', keys: 'Ctrl+C', group: '侧栏' },
  { id: 'hide', label: '收起侧栏', keys: 'Esc', group: '侧栏' },
  { id: 'move', label: '在卡片之间移动', keys: '↑ / ↓', group: '侧栏', proposed: true },
  { id: 'open', label: '编辑选中的记录', keys: 'Enter', group: '侧栏', proposed: true },
  { id: 'trash', label: '移入回收站', keys: 'Delete', group: '侧栏', proposed: true },
  { id: 'save', label: '保存记录', keys: 'Ctrl+Enter', group: '编辑', rebindable: true },
  { id: 'cancel', label: '取消编辑', keys: 'Esc', group: '编辑' },
  { id: 'bold', label: '加粗', keys: 'Ctrl+B', group: '格式', rebindable: true },
  { id: 'italic', label: '斜体', keys: 'Ctrl+I', group: '格式', rebindable: true },
  { id: 'underline', label: '下划线', keys: 'Ctrl+U', group: '格式', rebindable: true },
  { id: 'strike', label: '删除线', keys: 'Alt+S', group: '格式', rebindable: true },
  { id: 'link', label: '链接', keys: 'Ctrl+K', group: '格式', rebindable: true },
  { id: 'inlineCode', label: '行内代码', keys: 'Alt+C', group: '格式', rebindable: true },
  { id: 'codeBlock', label: '代码块', keys: 'Ctrl+Shift+K', group: '格式', rebindable: true },
  { id: 'quote', label: '引用', keys: 'Ctrl+Shift+Q', group: '格式', rebindable: true },
  { id: 'orderedList', label: '有序列表', keys: 'Ctrl+Shift+[', group: '格式', rebindable: true },
  { id: 'bulletList', label: '无序列表', keys: 'Ctrl+Shift+]', group: '格式', rebindable: true },
  { id: 'heading', label: '标题 / 正文', keys: 'Ctrl+1–6 / Ctrl+0', group: '格式' },
  { id: 'indent', label: '缩进 / 减少缩进', keys: 'Tab / Shift+Tab', group: '格式' },
  { id: 'plainPaste', label: '粘贴为纯文本', keys: 'Ctrl+Shift+V', group: '格式' },
];

/** 常用操作的默认按键，供提示文字与菜单使用。 */
export const SHORTCUT_KEYS = {
  capture: 'Ctrl+Shift+Space',
  newNote: 'Ctrl+N',
  search: 'Ctrl+F',
  save: 'Ctrl+Enter',
} as const;
