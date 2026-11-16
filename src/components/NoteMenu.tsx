/**
 * 卡片上下文菜单。
 *
 * 右下角「…」按钮与卡片右键共用同一菜单，菜单项按记录状态生成；
 * 定位、键盘导航与点到外部即关闭由 ContextMenu 处理。
 */

import { ContextMenu, type MenuAnchor, type MenuItems } from './ContextMenu';
import type { Note } from '../core/types';

export type { MenuAnchor } from './ContextMenu';

/** 菜单命令。 */
export type MenuCommand =
  | 'copy'
  | 'edit'
  | 'collapse'
  | 'pin'
  | 'move'
  | 'locate'
  | 'duplicate'
  | 'export'
  | 'info'
  | 'trash';

export interface NoteMenuProps {
  note: Note;
  anchor: MenuAnchor;
  /** 有可以移去的页签（随记与固定的标签页签，当前页签除外）时出现「移到…」。 */
  canMove: boolean;
  /** 全局搜索时最上面的「转到「X」」：切到这条记录所在的页签（与原型 note-menu.js 相同）；不在搜索时省略。 */
  locateLabel?: string;
  onCommand: (command: MenuCommand) => void;
  onClose: () => void;
}

/** 按记录状态生成菜单项（与原型 note-menu.js 相同：去掉了「归档」，换成移到随记或固定的标签页签）。 */
function buildEntries(note: Note, canMove: boolean, locateLabel?: string): MenuItems<MenuCommand> {
  const entries: MenuItems<MenuCommand> = [
    ...(locateLabel ? [{ command: 'locate' as const, label: locateLabel, icon: 'arrow-right' as const }, 'separator' as const] : []),
    { command: 'copy', label: '复制内容与附件', icon: 'copy', hint: 'Ctrl+C' },
    { command: 'edit', label: '编辑内容', icon: 'edit', hint: '双击' },
    {
      command: 'collapse',
      label: note.collapsed ? '展开正文' : '收起正文',
      icon: 'chevron-down',
      className: note.collapsed ? undefined : 'is-expanded',
    },
    'separator',
  ];
  if (note.status === 'active') {
    entries.push({
      command: 'pin',
      label: note.pinned ? '移到普通记录' : '置顶记录',
      icon: note.pinned ? 'pin-off' : 'pin',
    });
  }
  if (canMove) entries.push({ command: 'move', label: '移到…', icon: 'arrow-right' });
  entries.push('separator');
  entries.push({ command: 'duplicate', label: '创建副本', icon: 'duplicate' });
  entries.push({ command: 'export', label: '导出 Markdown', icon: 'download' });
  entries.push({ command: 'info', label: '记录信息', icon: 'info' });
  entries.push('separator');
  entries.push({ command: 'trash', label: '移入回收站', icon: 'trash', danger: true, hint: 'Delete' });
  return entries;
}

/** 记录操作菜单。 */
export function NoteMenu({ note, anchor, canMove, locateLabel, onCommand, onClose }: NoteMenuProps) {
  return (
    <ContextMenu
      entries={buildEntries(note, canMove, locateLabel)}
      anchor={anchor}
      label="记录操作"
      data={{ 'data-note-menu': note.id }}
      onCommand={onCommand}
      onClose={onClose}
    />
  );
}
