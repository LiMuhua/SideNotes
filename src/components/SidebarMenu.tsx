/**
 * 侧栏空白处的右键菜单。
 *
 * 在卡片之外的任意位置（标题栏、页签、列表空白处、底栏）右键打开，替代系统窗口菜单与浏览器菜单。
 * 菜单项覆盖侧栏的常用操作：新建与搜索、收起或展开当前列表的全部卡片（双击空白处同样切换）、
 * 选择全部记录、固定侧栏、切换停靠边、打开设置与收起侧栏。
 */

import { ContextMenu, type MenuAnchor, type MenuItems } from './ContextMenu';
import type { EdgeSide } from '../core/types';

/** 菜单命令。 */
export type SidebarCommand =
  | 'new'
  | 'search'
  | 'collapse-all'
  | 'expand-all'
  | 'select-all'
  | 'pin'
  | 'edge'
  | 'settings'
  | 'hide';

export interface SidebarMenuProps {
  anchor: MenuAnchor;
  /** 当前列表中的卡片数。 */
  count: number;
  /** 当前列表中是否有展开的卡片：有则提供「收起全部」，否则提供「展开全部」。 */
  hasExpanded: boolean;
  pinned: boolean;
  edge: EdgeSide;
  onCommand: (command: SidebarCommand) => void;
  onClose: () => void;
}

function buildEntries({ count, hasExpanded, pinned, edge }: SidebarMenuProps): MenuItems<SidebarCommand> {
  const entries: MenuItems<SidebarCommand> = [
    { command: 'new', label: '新建记录', icon: 'plus', hint: 'Ctrl+N' },
    { command: 'search', label: '搜索记录', icon: 'search', hint: 'Ctrl+F' },
  ];
  if (count > 0) {
    entries.push('separator');
    entries.push(
      hasExpanded
        ? { command: 'collapse-all', label: '收起全部卡片', icon: 'chevron-down', hint: '双击空白处', className: 'is-expanded' }
        : { command: 'expand-all', label: '展开全部卡片', icon: 'chevron-down', hint: '双击空白处' },
    );
    entries.push({ command: 'select-all', label: '选择全部记录', icon: 'check-circle' });
  }
  entries.push('separator');
  entries.push({ command: 'pin', label: pinned ? '取消固定侧栏' : '固定侧栏', icon: pinned ? 'pin-off' : 'pin' });
  entries.push({
    command: 'edge',
    label: edge === 'left' ? '停靠到屏幕右侧' : '停靠到屏幕左侧',
    icon: edge === 'left' ? 'arrow-right' : 'arrow-left',
  });
  entries.push({ command: 'settings', label: '设置', icon: 'settings' });
  entries.push('separator');
  entries.push({ command: 'hide', label: '收起侧栏', icon: edge === 'left' ? 'arrow-left' : 'arrow-right', hint: 'Esc' });
  return entries;
}

/** 侧栏菜单。 */
export function SidebarMenu(props: SidebarMenuProps) {
  return (
    <ContextMenu
      entries={buildEntries(props)}
      anchor={props.anchor}
      label="侧栏操作"
      data={{ 'data-sidebar-menu': '' }}
      onCommand={props.onCommand}
      onClose={props.onClose}
    />
  );
}
