/**
 * 工具提示。
 *
 * 指针停留 500ms 或键盘聚焦时出现在目标下方，Esc 关闭；
 * 一个提示刚关闭的 300ms 内移到另一个目标，立即显示，不再等待（与 Radix Tooltip 的跳过延迟一致）。
 * 提示只补充说明，不承载唯一的信息：图标按钮的名称仍由 aria-label 提供。
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Keys } from './Misc';
import { Layer, useAnchoredPosition, type Placement } from './layer';

const OPEN_DELAY = 500;
const SKIP_WINDOW = 300;
let lastHidden = 0;

export interface TooltipProps {
  content: ReactNode;
  /** 快捷键，显示在说明之后。 */
  shortcut?: string;
  placement?: Placement;
  children: ReactNode;
  /** 只在需要时使用：让目标的 aria-describedby 指向提示。 */
  describe?: boolean;
}

export function Tooltip({ content, shortcut, placement = 'bottom', children, describe = false }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const wrapper = useRef<HTMLSpanElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const floating = useRef<HTMLDivElement>(null);
  const id = useId();
  const { style } = useAnchoredPosition(open, target, floating, placement, 8);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    target.current = (wrapper.current?.firstElementChild as HTMLElement | null) ?? null;
    if (Date.now() - lastHidden < SKIP_WINDOW) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen((current) => {
      if (current) lastHidden = Date.now();
      return false;
    });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!describe) return;
    const element = wrapper.current?.firstElementChild;
    if (!element) return;
    if (open) element.setAttribute('aria-describedby', id);
    else element.removeAttribute('aria-describedby');
  }, [describe, open, id]);

  return (
    <span
      ref={wrapper}
      className="sn-tooltip-anchor"
      onPointerOver={show}
      onPointerOut={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget as Node | null)) hide();
      }}
      onFocus={(event) => {
        // 只响应键盘聚焦，鼠标点击后不弹出提示。
        if ((event.target as HTMLElement).matches(':focus-visible')) show();
      }}
      onBlur={hide}
      onPointerDown={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          hide();
        }
      }}
    >
      {children}
      {open ? (
        <Layer>
          <div ref={floating} id={id} role="tooltip" className="sn-tooltip" style={style}>
            <span>{content}</span>
            {shortcut ? <Keys combo={shortcut} tone="inverse" /> : null}
          </div>
        </Layer>
      ) : null}
    </span>
  );
}
