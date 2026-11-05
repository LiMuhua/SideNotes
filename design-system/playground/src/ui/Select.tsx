/**
 * 下拉选择框。
 *
 * 按 WAI-ARIA 的「只读组合框 + 列表框」模式实现：触发按钮为 combobox，
 * 打开后焦点留在列表框上，用 aria-activedescendant 标出当前项；
 * 上下方向键移动，Home 与 End 到两端，输入首字母跳转，Enter 或空格选定，Esc 关闭。
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './context';
import { Icon, type IconName } from './Icon';
import { Layer, useAnchoredPosition } from './layer';
import type { ForcedState } from './Button';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  /** 显示在选项右侧的补充说明，如数量、语言名。 */
  detail?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  /** 可见标签由外部 label 提供时传 id；否则传 aria-label。 */
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  force?: ForcedState;
  /** 触发按钮的最小宽度跟随内容，或撑满容器。 */
  block?: boolean;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  size = 'md',
  disabled,
  force,
  block = false,
  ...aria
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // 列表至少与触发按钮同宽；宽度在打开时测量，渲染期间不读 ref。
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { style } = useAnchoredPosition(open, trigger, listbox, 'bottom-start', 4);
  const current = options.find((option) => option.value === value);

  const openList = useCallback(
    (at?: number) => {
      const selected = Math.max(0, options.findIndex((option) => option.value === value));
      setActive(at ?? selected);
      setMinWidth(trigger.current?.offsetWidth);
      setOpen(true);
    },
    [options, value],
  );

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    listbox.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!listbox.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    listbox.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const step = (from: number, delta: number): number => {
    for (let index = from + delta, guard = 0; guard < options.length; index += delta, guard += 1) {
      const wrapped = (index + options.length) % options.length;
      if (!options[wrapped].disabled) return wrapped;
    }
    return from;
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => step(index, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => step(index, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(step(-1, 1));
        break;
      case 'End':
        event.preventDefault();
        setActive(step(options.length, -1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        if (event.key.length === 1) {
          const key = event.key.toLocaleLowerCase();
          const order = [...options.keys()].map((offset) => (active + 1 + offset) % options.length);
          const match = order.find((index) => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(key));
          if (match !== undefined) setActive(match);
        }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        disabled={disabled}
        data-force={force}
        className={cx('sn-select', `is-${size}`, block && 'is-block')}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openList();
          }
        }}
      >
        {current?.icon ? <Icon name={current.icon} /> : null}
        <span className="sn-select-value">{current?.label ?? '请选择'}</span>
        <Icon name="chevron-down" className="sn-select-chevron" />
      </button>
      {open ? (
        <Layer>
          <div
            ref={listbox}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${listId}-${active}`}
            aria-label={aria['aria-label']}
            className="sn-listbox"
            style={{ ...style, minWidth }}
            onKeyDown={onListKey}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={cx('sn-option', index === active && 'is-active')}
                onPointerMove={() => !option.disabled && setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="sn-option-check">{option.value === value ? <Icon name="check" /> : null}</span>
                {option.icon ? <Icon name={option.icon} /> : null}
                <span className="sn-option-label">{option.label}</span>
                {option.detail ? <span className="sn-option-detail">{option.detail}</span> : null}
              </div>
            ))}
          </div>
        </Layer>
      ) : null}
    </>
  );
}
