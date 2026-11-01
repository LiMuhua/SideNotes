/**
 * 可输入的下拉框。
 *
 * 外观沿用原型字体组合框的类名（font-combobox）：输入框右侧是展开按钮，下方列出候选。
 * 可以直接输入，也可以从候选中选择：上下键切换候选，回车选用当前候选或提交输入，
 * Esc 放弃输入并收起列表；没有可收起的内容时 Esc 不做处理，交给设置窗口关闭。
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ActionButton, classes } from './controls';

/** 一个候选。 */
export interface ComboOption {
  /** 选用时提交的值。 */
  value: string;
  label: string;
  /** 附加类名，如「使用输入的字体」一项。 */
  className?: string;
}

export interface ComboboxProps {
  /** 未输入时显示的文字，通常是已保存的值。 */
  text: string;
  /** 按输入内容给出候选；typed 为 null 表示尚未输入，此时列出全部候选。 */
  options: (typed: string | null) => ComboOption[];
  /** 与已保存值相同的候选值，显示为选中。 */
  selected?: string;
  /** 可访问名称。 */
  label: string;
  placeholder?: string;
  /** 失焦时提交输入（数值类设置）；否则放弃输入，恢复为已保存的值。 */
  commitOnBlur?: boolean;
  className?: string;
  /** 提交选中的候选值或输入的文字，返回是否已保存；无论成败，输入框都回到保存后的值。 */
  onCommit: (value: string) => Promise<boolean> | boolean;
}

export function Combobox({ text, options, selected, label, placeholder, commitOnBlur, className, onCommit }: ComboboxProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // 失焦时读取最新的输入，避免回车提交后紧接着的失焦按旧值再提交一次。
  const latestDraft = useRef<string | null>(null);
  useLayoutEffect(() => {
    latestDraft.current = draft;
  });
  const choices = options(draft);

  // 键盘切换候选时让当前项保持可见。
  useEffect(() => {
    if (active < 0) return;
    list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (): void => {
    setOpen(false);
    setActive(-1);
  };

  const commit = async (value: string): Promise<void> => {
    latestDraft.current = null;
    close();
    await onCommit(value);
    setDraft(null);
  };

  return (
    <div
      ref={box}
      className={classes('font-combobox', className)}
      onBlur={() => {
        // 等焦点落定后再判断是否离开整个下拉框。
        window.setTimeout(() => {
          if (box.current?.contains(document.activeElement)) return;
          const pending = latestDraft.current;
          if (commitOnBlur && pending !== null) void commit(pending);
          else {
            setDraft(null);
            close();
          }
        }, 0);
      }}
    >
      <div className="font-combobox-field">
        <input
          ref={input}
          className="form-control"
          type="text"
          autoComplete="off"
          value={draft ?? text}
          placeholder={placeholder}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              if (!open && draft === null) return;
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!choices.length) return;
              setOpen(true);
              const next = active + (event.key === 'ArrowDown' ? 1 : -1);
              setActive((next + choices.length) % choices.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const current = open && active >= 0 ? choices[active] : undefined;
              void commit(current ? current.value : (draft ?? text));
            }
          }}
        />
        <ActionButton
          label={`展开${label}候选`}
          icon="chevron-down"
          className="font-combobox-toggle icon-button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else setOpen(true);
            input.current?.focus();
          }}
        />
      </div>
      <div
        ref={list}
        className="font-combobox-list"
        id={`${id}-options`}
        role="listbox"
        aria-label={`${label}候选`}
        hidden={!open || !choices.length}
      >
        {choices.map((choice, index) => (
          <ActionButton
            key={`${choice.value}-${choice.label}`}
            label={choice.label}
            className={classes(
              'font-combobox-option',
              choice.className,
              choice.value === selected && 'is-selected',
              index === active && 'is-active',
            )}
            id={`${id}-option-${index}`}
            tabIndex={-1}
            role="option"
            aria-selected={choice.value === selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void commit(choice.value)}
          />
        ))}
      </div>
    </div>
  );
}
