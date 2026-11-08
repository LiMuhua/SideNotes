/**
 * 可输入的组合框：输入框加候选列表，用于字体、「移出后收起」、回收站保留天数这类既有常用值、又可以自己填写的设置。
 *
 * 按 WAI-ARIA 的「可编辑组合框 + 列表框」模式：焦点始终留在输入框，用 aria-activedescendant 标出当前候选。
 * ↓ 打开列表或下移，↑ 上移，Enter 选用当前候选（列表关闭时提交输入的内容），Esc 先关闭列表；
 * 点候选即选用；失去焦点时提交输入的内容。filter 为 true 时按输入的内容筛选候选（现有应用的字体组合框）。
 * 数值型的组合框可以用滚轮加减（wheel，见 wheel.ts）。
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cx } from './context';
import { Icon } from './Icon';
import { Layer, useAnchoredPosition } from './layer';
import { useWheelStep } from './wheel';

export interface ComboboxOption {
  value: string;
  /** 列表中显示的文字，缺省为 value。 */
  label?: string;
  /** 显示在候选右侧的补充说明。 */
  detail?: string;
  /** 候选文字的样式，例如字体候选用自己的字体显示。 */
  style?: CSSProperties;
}

export interface ComboboxProps {
  value: string;
  options: readonly ComboboxOption[];
  /** 选用候选或提交输入的内容；返回 false 表示不接受，输入框恢复原值。 */
  onCommit: (value: string) => boolean | void;
  'aria-label': string;
  placeholder?: string;
  /** 按输入的内容筛选候选；不筛选时始终列出全部候选。 */
  filter?: boolean;
  /** 输入框中显示的文字；缺省为 value（例如空值显示为占位文字）。 */
  display?: string;
  size?: 'sm' | 'md';
  inputMode?: 'text' | 'numeric';
  /** 数值型的组合框（「移出后收起」、回收站保留天数）：滚轮按步长加减，结果限制在范围之内并立即提交。 */
  wheel?: { min: number; max: number; step: number };
  className?: string;
}

const labelOf = (option: ComboboxOption) => option.label ?? option.value;

export function Combobox({ value, options, onCommit, placeholder, filter = false, display, size = 'sm', inputMode = 'text', wheel, className, ...aria }: ComboboxProps) {
  const shown = display ?? value;
  const [text, setText] = useState(shown);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // 列表至少与输入框同宽；宽度在打开时测量，渲染期间不读 ref。
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined);
  const field = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { style } = useAnchoredPosition(open, field, listbox, 'bottom-start', 4);

  // 外部的值变化（例如另一个窗口改了设置）时，未在输入的输入框跟着更新。
  const [lastShown, setLastShown] = useState(shown);
  if (lastShown !== shown) {
    setLastShown(shown);
    if (!dirty) setText(shown);
  }

  const keyword = text.trim().toLocaleLowerCase();
  const candidates = filter && dirty && keyword ? options.filter((option) => labelOf(option).toLocaleLowerCase().includes(keyword)) : options;

  const openList = (at?: number) => {
    const current = candidates.findIndex((option) => option.value === value);
    setActive(at ?? Math.max(0, current));
    setMinWidth(field.current?.offsetWidth);
    setOpen(true);
  };

  const finish = (next: string) => {
    setOpen(false);
    setDirty(false);
    if (onCommit(next) === false) setText(shown);
  };

  const choose = (option: ComboboxOption) => {
    // 输入框显示取值本身（例如「30」），候选文字（「30 天」）只在列表中显示。
    setText(option.value === value ? shown : option.value);
    finish(option.value);
  };

  useWheelStep(
    field,
    (direction, multiplier) => {
      if (!wheel) return;
      const typed = Number.parseInt(text, 10);
      const base = Number.isFinite(typed) ? typed : Number.parseInt(value, 10);
      const next = String(Math.min(wheel.max, Math.max(wheel.min, base + direction * wheel.step * multiplier)));
      setText(next);
      finish(next);
    },
    Boolean(wheel),
  );

  useEffect(() => {
    if (!open) return;
    listbox.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive((index) => (index + 1) % Math.max(1, candidates.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList(candidates.length - 1);
        else setActive((index) => (index - 1 + candidates.length) % Math.max(1, candidates.length));
        break;
      case 'Enter':
        event.preventDefault();
        if (open && candidates[active]) choose(candidates[active]);
        else finish(text.trim());
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <span ref={field} className={cx('sn-combobox', `is-${size}`, open && 'is-open', className)} data-wheel-step={wheel ? '' : undefined}>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={aria['aria-label']}
          aria-autocomplete={filter ? 'list' : 'none'}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && candidates[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          inputMode={inputMode}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setDirty(true);
            if (filter) openList(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (listbox.current?.contains(event.relatedTarget as Node | null)) return;
            setOpen(false);
            if (dirty) finish(text.trim());
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="sn-combobox-toggle"
          aria-label={`展开${aria['aria-label']}的候选`}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            if (open) setOpen(false);
            else openList();
          }}
        >
          <Icon name="chevron-down" />
        </button>
      </span>
      {open && candidates.length ? (
        <Layer>
          <div ref={listbox} id={listId} role="listbox" aria-label={aria['aria-label']} className="sn-listbox" style={{ ...style, minWidth }}>
            {candidates.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                className={cx('sn-option', index === active && 'is-active')}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="sn-option-check">{option.value === value ? <Icon name="check" /> : null}</span>
                <span className="sn-option-label" style={option.style}>
                  {labelOf(option)}
                </span>
                {option.detail ? <span className="sn-option-detail">{option.detail}</span> : null}
              </div>
            ))}
          </div>
        </Layer>
      ) : null}
    </>
  );
}
