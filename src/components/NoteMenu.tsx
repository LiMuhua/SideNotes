/**
 * 卡片上下文菜单。
 *
 * 右下角「…」按钮与卡片右键共用同一菜单；固定定位并处理视口边界，
 * 支持上下键、Home/End 导航与 Esc 关闭。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import type { Note } from '../core/types';

/** 菜单命令。 */
export type MenuCommand =
  | 'copy'
  | 'edit'
  | 'collapse'
  | 'pin'
  | 'archive'
  | 'duplicate'
  | 'export'
  | 'info'
  | 'trash';

/** 菜单锚点：按钮元素或鼠标位置。 */
export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface NoteMenuProps {
  note: Note;
  anchor: MenuAnchor;
  onCommand: (command: MenuCommand) => void;
  onClose: () => void;
}

interface MenuEntry {
  command: MenuCommand;
  label: string;
  icon: IconName;
  hint?: string;
  danger?: boolean;
}

/** 按记录状态生成菜单项。 */
function buildEntries(note: Note): Array<MenuEntry | 'separator'> {
  const entries: Array<MenuEntry | 'separator'> = [
    { command: 'copy', label: '复制内容与附件', icon: 'copy', hint: '双击' },
    { command: 'edit', label: '编辑内容', icon: 'edit' },
    { command: 'collapse', label: note.collapsed ? '展开正文' : '收起正文', icon: 'chevron-down' },
    'separator',
  ];
  if (note.status === 'active') {
    entries.push({
      command: 'pin',
      label: note.pinned ? '移到普通记录' : '置顶记录',
      icon: note.pinned ? 'pin-off' : 'pin',
    });
  }
  entries.push({
    command: 'archive',
    label: note.status === 'archived' ? '移回工作区' : '归档记录',
    icon: note.status === 'archived' ? 'restore' : 'archive',
  });
  entries.push('separator');
  entries.push({ command: 'duplicate', label: '创建副本', icon: 'duplicate' });
  entries.push({ command: 'export', label: '导出 Markdown', icon: 'download' });
  entries.push({ command: 'info', label: '记录信息', icon: 'info' });
  entries.push('separator');
  entries.push({ command: 'trash', label: '移入回收站', icon: 'trash', danger: true });
  return entries;
}

/** 记录操作菜单。 */
export function NoteMenu({ note, anchor, onCommand, onClose }: NoteMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const entries = buildEntries(note);

  // 先按锚点定位，再按视口边界翻转方向。
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const padding = 8;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    node.style.maxHeight = `${Math.max(100, viewHeight - padding * 2)}px`;
    const measured = node.getBoundingClientRect();
    const width = measured.width || 214;
    const height = measured.height || node.scrollHeight || 340;
    const isPoint = !(anchor instanceof HTMLElement);
    const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;

    let left = isPoint ? (anchor as { x: number }).x : rect ? rect.right - width : viewWidth - width - 18;
    let top = isPoint ? (anchor as { y: number }).y : rect ? rect.bottom + 5 : 80;
    if (isPoint && left + width > viewWidth - padding) left = (anchor as { x: number }).x - width;
    if (top + height > viewHeight - padding) {
      top = isPoint
        ? (anchor as { y: number }).y - height
        : rect
          ? rect.top - height - 5
          : viewHeight - height - padding;
    }
    setPosition({
      left: Math.max(padding, Math.min(left, viewWidth - width - padding)),
      top: Math.max(padding, Math.min(top, viewHeight - height - padding)),
    });
  }, [anchor]);

  // 打开后把焦点交给首项。
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  // 点击外部、窗口尺寸变化或列表滚动都收起菜单。
  useEffect(() => {
    const handlePointer = (event: PointerEvent): void => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    const handleScroll = (event: Event): void => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', handlePointer, true);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  /** 在菜单项之间移动焦点。 */
  const moveFocus = useCallback((direction: number | 'first' | 'last') => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? items.length - 1
          : (index + direction + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={menu}
      className="note-context-menu"
      role="menu"
      aria-label="记录操作"
      data-note-menu={note.id}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === 'Tab') {
          onClose();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveFocus('first');
        } else if (event.key === 'End') {
          event.preventDefault();
          moveFocus('last');
        }
      }}
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div key={`separator-${index}`} className="note-context-separator" role="separator" />
        ) : (
          <button
            key={entry.command}
            type="button"
            role="menuitem"
            className={`note-context-item${entry.danger ? ' is-danger' : ''}${
              entry.command === 'collapse' && !note.collapsed ? ' is-expanded' : ''
            }`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCommand(entry.command);
            }}
          >
            <Icon name={entry.icon} />
            <span className="note-context-label">{entry.label}</span>
            {entry.hint ? <span className="note-context-hint">{entry.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
