/**
 * 带标签联想的输入框。
 *
 * 与编辑器中的标签联想一致：输入时在文字之后以灰字提示已有标签的剩余部分，
 * Tab 选用，上下键切换候选，Esc 只关闭提示。灰字是覆盖在输入框上的装饰，不进入输入值。
 * 用于卡片上就地修改标签与「管理标签」对话框。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import * as store from '../core/store';
import { tagKey } from '../core/tags';

export interface TagInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /** 不再提示的标签，如本条记录已有的其它标签。 */
  exclude?: readonly string[];
  /** 输入框随内容变宽时（field-sizing: content）为灰字留出宽度。 */
  grow?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** 测量文字宽度用的画布，所有输入框共用。 */
let measureContext: CanvasRenderingContext2D | null = null;

function textWidth(text: string, font: string): number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

export function TagInput({ value, onValueChange, exclude, grow, ref, className, ...rest }: TagInputProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');

  // 输入值可以带 #，联想按 # 之后的部分匹配；以空白结尾时不再提示。
  const typed = value.trim().replace(/^#/, '');
  const candidates = useMemo(
    () =>
      typed && !/\s$/.test(value) && /^[\p{L}\p{N}_-]+$/u.test(typed) && tagKey(typed) !== dismissed
        ? store.tagSuggestions(typed, (exclude ?? []).map((tag) => `#${tag}`).join(' '))
        : [],
    [typed, value, dismissed, exclude],
  );
  const current = candidates.length ? candidates[index % candidates.length] : '';
  const remainder = current.slice(typed.length);

  // 灰字放在已输入文字的末尾，字体与输入框一致；输入框随内容变宽时再为灰字留出右侧空间。
  useLayoutEffect(() => {
    const node = input.current;
    const overlay = ghost.current;
    if (!node) return;
    node.style.paddingRight = '';
    if (!overlay) return;
    const style = getComputedStyle(node);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    overlay.style.font = font;
    overlay.style.left = `${node.offsetLeft + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) + textWidth(value, font) - node.scrollLeft}px`;
    if (grow) node.style.paddingRight = `${parseFloat(style.paddingRight) + overlay.offsetWidth}px`;
  }, [value, remainder, grow]);

  // 提示显示时的按键在窗口捕获阶段处理，先于侧栏「Esc 收起」等全局快捷键与输入框自身的处理。
  const latest = useRef({ current, candidates, index, typed, value });
  useLayoutEffect(() => {
    latest.current = { current, candidates, index, typed, value };
  });
  useEffect(() => {
    if (!remainder) return;
    const handle = (event: KeyboardEvent): void => {
      const state = latest.current;
      if (event.target !== input.current || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      const count = state.candidates.length;
      if (event.key === 'Tab' && !event.shiftKey) {
        onValueChange(state.value.trim().startsWith('#') ? `#${state.current}` : state.current);
        setDismissed(tagKey(state.current));
      } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count > 1) {
        setIndex((state.index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      } else if (event.key === 'Escape') {
        setDismissed(tagKey(state.typed));
      } else {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [remainder, onValueChange]);

  return (
    <span className="tag-input-shell">
      <input
        {...rest}
        ref={(node) => {
          input.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={className}
        value={value}
        onChange={(event) => {
          setIndex(0);
          onValueChange(event.target.value);
        }}
      />
      {remainder ? (
        <span ref={ghost} className="tag-input-ghost" aria-hidden="true">
          {remainder}
          <span className="md-tag-ghost-hint">
            {count(candidates.length, index)}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** 灰字后的提示：候选不止一个时显示序号与切换方式。 */
function count(total: number, index: number): string {
  return total > 1 ? `${(index % total) + 1}/${total} ↑↓ · Tab` : 'Tab';
}
