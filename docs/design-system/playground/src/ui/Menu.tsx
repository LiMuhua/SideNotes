/**
 * 菜单：下拉菜单与右键菜单共用同一个菜单列表。
 *
 * 键盘行为按 WAI-ARIA 菜单模式：上下方向键移动（首尾循环）、Home 与 End 到两端、
 * 输入首字母跳到匹配项、Enter 或空格执行、Esc 关闭并把焦点还给触发者、Tab 关闭。
 * 点到菜单之外或窗口失去焦点时关闭。尺寸参照 Windows 11 菜单（Glance `menu.rs` 记录的同一组数值）。
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from './context';
import { Icon, type IconName } from './Icon';
import { Keys } from './Misc';
import { Layer, useAnchoredPosition, type Anchor, type Placement } from './layer';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  /** 右侧的补充说明，例如「合并成一条…」后面的条数。 */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /**
   * 单选或多选项的状态，对勾画在图标的位置；普通项（kind 为 item）表示当前的那一项，对勾画在右侧，
   * 图标照常显示（页签菜单中当前的页签）。
   */
  checked?: boolean;
  kind?: 'item' | 'checkbox' | 'radio';
  /** 在这一项之前画分隔线。 */
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface MenuListProps {
  items: readonly MenuItem[];
  label: string;
  anchor: Anchor;
  placement: Placement;
  /** 打开时聚焦第一项或最后一项（按上方向键打开时）。 */
  focus?: 'first' | 'last';
  onClose: (reason: 'select' | 'escape' | 'outside' | 'tab') => void;
  id?: string;
  /** 附加的类名，例如页签栏最后一格的菜单按内容定宽（第六次反馈）。 */
  className?: string;
}

function MenuList({ items, label, anchor, placement, focus = 'first', onClose, id, className }: MenuListProps) {
  const menu = useRef<HTMLDivElement>(null);
  const { style } = useAnchoredPosition(true, anchor, menu, placement, 4);
  const enabled = items.filter((item) => !item.disabled);

  const itemsIn = (): HTMLElement[] => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  // 打开时聚焦一次。菜单在第一次定位之前是隐藏的（隐藏的元素不能获得焦点），所以等定位完成再聚焦。
  const positioned = style.visibility !== 'hidden';
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!positioned || focused.current) return;
    focused.current = true;
    const elements = itemsIn();
    const checkedIndex = items.filter((item) => !item.disabled).findIndex((item) => item.checked);
    const target = focus === 'last' ? elements[elements.length - 1] : elements[checkedIndex >= 0 ? checkedIndex : 0];
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positioned]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose('outside');
    };
    const blur = () => onClose('outside');
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = itemsIn();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => elements[(next + elements.length) % elements.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(elements.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose('escape');
        break;
      case 'Tab':
        event.preventDefault();
        onClose('tab');
        break;
      default:
        // 首字母跳转：从当前项之后开始找。
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const key = event.key.toLocaleLowerCase();
          const order = [...enabled.slice(index + 1), ...enabled.slice(0, index + 1)];
          const match = order.find((item) => item.label.toLocaleLowerCase().startsWith(key));
          if (match) elements[enabled.indexOf(match)]?.focus();
        }
    }
  };

  return (
    <Layer>
      <div ref={menu} id={id} role="menu" aria-label={label} className={cx('sn-menu', className)} style={style} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <div key={item.id} role="none" className="sn-menu-slot">
            {item.separatorBefore ? <div role="separator" className="sn-menu-separator" /> : null}
            <button
              type="button"
              role={item.kind === 'checkbox' ? 'menuitemcheckbox' : item.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
              aria-checked={item.kind && item.kind !== 'item' ? Boolean(item.checked) : undefined}
              aria-disabled={item.disabled || undefined}
              aria-current={item.checked && (!item.kind || item.kind === 'item') ? 'true' : undefined}
              tabIndex={-1}
              className={cx('sn-menu-item', item.danger && 'is-danger')}
              onClick={() => {
                if (item.disabled) return;
                onClose('select');
                item.onSelect();
              }}
            >
              <span className="sn-menu-icon">
                {item.kind && item.kind !== 'item' ? (
                  item.checked ? <Icon name="check" /> : null
                ) : item.icon ? (
                  <Icon name={item.icon} />
                ) : null}
              </span>
              <span className="sn-menu-label">{item.label}</span>
              {item.hint ? <span className="sn-menu-hint">{item.hint}</span> : null}
              {item.shortcut ? <Keys combo={item.shortcut} /> : null}
              {item.checked && (!item.kind || item.kind === 'item') ? <Icon name="check" className="sn-menu-check" /> : null}
            </button>
          </div>
        ))}
      </div>
    </Layer>
  );
}

export interface DropdownMenuProps {
  label: string;
  items: readonly MenuItem[];
  placement?: Placement;
  /** 渲染触发按钮，需要把 props 展开到按钮上。 */
  trigger: (props: {
    ref: (element: HTMLButtonElement | null) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls'?: string;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  }) => ReactNode;
}

export function DropdownMenu({ label, items, placement = 'bottom-start', trigger }: DropdownMenuProps) {
  const [open, setOpen] = useState<false | 'first' | 'last'>(false);
  // 触发按钮存在 state 中：菜单定位与关闭后还原焦点都要用到它，渲染期间不读写 ref。
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const id = useId();

  const close = useCallback(
    (reason: 'select' | 'escape' | 'outside' | 'tab') => {
      setOpen(false);
      if (reason === 'select' || reason === 'escape') button?.focus();
    },
    [button],
  );

  return (
    <>
      {trigger({
        ref: setButton,
        'aria-haspopup': 'menu',
        'aria-expanded': Boolean(open),
        'aria-controls': open ? id : undefined,
        onClick: () => setOpen((current) => (current ? false : 'first')),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen('last');
          }
        },
      })}
      {open ? (
        <MenuList id={id} items={items} label={label} anchor={button} placement={placement} focus={open} onClose={close} />
      ) : null}
    </>
  );
}

export interface ContextMenuProps {
  label: string;
  items: readonly MenuItem[];
  /** 视口坐标。 */
  point: { x: number; y: number };
  onClose: () => void;
  className?: string;
}

/** 右键菜单：在指针处打开；用键盘（Shift+F10、菜单键）打开时由调用方传入元素位置。 */
export function ContextMenu({ label, items, point, onClose, className }: ContextMenuProps) {
  const previous = useRef<Element | null>(document.activeElement);
  const close = useCallback(
    (reason: 'select' | 'escape' | 'outside' | 'tab') => {
      onClose();
      if (reason !== 'outside' && previous.current instanceof HTMLElement) previous.current.focus();
    },
    [onClose],
  );
  return <MenuList items={items} label={label} anchor={point} placement="bottom-start" onClose={close} className={className} />;
}
