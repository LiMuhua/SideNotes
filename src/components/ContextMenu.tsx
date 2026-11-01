/**
 * 右键菜单。
 *
 * 卡片菜单与侧栏空白处的菜单共用：固定定位并处理视口边界，支持上下键、Home/End 导航与 Esc 关闭。
 * 与系统菜单一样，点到菜单之外（包括侧栏窗口之外）、窗口尺寸变化或列表滚动时关闭。
 * 外观沿用原型 note-menu.js 的类名。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

/** 菜单锚点：按钮元素或鼠标位置。 */
export type MenuAnchor = HTMLElement | { x: number; y: number };

/** 一个菜单项。 */
export interface MenuEntry<C extends string> {
  command: C;
  label: string;
  icon: IconName;
  /** 右侧的快捷键或操作提示。 */
  hint?: string;
  danger?: boolean;
  /** 附加类名，供样式区分状态（如展开与收起的箭头方向）。 */
  className?: string;
}

/** 菜单内容：菜单项与分隔线。 */
export type MenuItems<C extends string> = Array<MenuEntry<C> | 'separator'>;

export interface ContextMenuProps<C extends string> {
  entries: MenuItems<C>;
  anchor: MenuAnchor;
  /** 菜单的可访问名称。 */
  label: string;
  /** 附加在菜单根节点上的 data 属性，便于测试与样式定位。 */
  data?: Record<`data-${string}`, string>;
  onCommand: (command: C) => void;
  onClose: () => void;
}

export function ContextMenu<C extends string>({ entries, anchor, label, data, onCommand, onClose }: ContextMenuProps<C>) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

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

  // 定位完成、菜单可见后再把焦点交给首项：定位前菜单处于隐藏状态，无法获得焦点。
  const placed = position !== null;
  useEffect(() => {
    if (placed) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [placed]);

  // 点击外部、窗口尺寸变化或列表滚动都收起菜单。点到侧栏窗口之外时页面收不到按下事件，
  // 只会失焦，因此窗口失焦也关闭；否则菜单一直开着，侧栏也会因此不再自动收起。
  useEffect(() => {
    const handlePointer = (event: PointerEvent): void => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    const handleScroll = (event: Event): void => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', handlePointer, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
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
      aria-label={label}
      {...data}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
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
            data-menu-command={entry.command}
            className={['note-context-item', entry.danger ? 'is-danger' : '', entry.className ?? '']
              .filter(Boolean)
              .join(' ')}
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
