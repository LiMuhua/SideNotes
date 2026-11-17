/**
 * 浮层组件：把内容渲染到 body 下的浮层一层（core/layer），按锚点定位，页面滚动或窗口变化时跟着锚点走。
 *
 * 用于问号说明、下拉列表与候选等，不被所在的滚动区域裁剪（与交互原型 layer.js 的 open 相同）。
 */

import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { floatingContainer, placeFloating, type FloatingOptions } from '../core/layer';

export interface FloatingProps extends HTMLAttributes<HTMLDivElement> {
  /** 锚点元素。 */
  anchor: RefObject<Element | null>;
  /** 是否显示；不显示时不渲染。 */
  open: boolean;
  options?: FloatingOptions;
  children: ReactNode;
}

export function Floating({ anchor, open, options, className, children, ...rest }: FloatingProps) {
  const panel = useRef<HTMLDivElement>(null);
  const settings = useRef(options);

  // 每次渲染后重新定位：内容变化（候选变少、说明换行）会改变浮层的尺寸。滚动跟随用最新的选项。
  useLayoutEffect(() => {
    settings.current = options;
    if (open && panel.current && anchor.current) placeFloating(panel.current, anchor.current, options);
  });

  useEffect(() => {
    if (!open) return;
    const follow = (event: Event): void => {
      const floating = panel.current;
      const target = anchor.current;
      if (!floating || !target) return;
      // 浮层自己里面的滚动（候选列表）不用重新定位。
      if (event.type === 'scroll' && event.target instanceof Node && floating.contains(event.target)) return;
      placeFloating(floating, target, settings.current);
    };
    window.addEventListener('resize', follow);
    document.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      document.removeEventListener('scroll', follow, true);
    };
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <div ref={panel} className={className ? `floating-panel ${className}` : 'floating-panel'} {...rest}>
      {children}
    </div>,
    floatingContainer(),
  );
}

/** 把按键组合（如 Ctrl+Enter）拆成按键，「Ctrl++」末尾的空段就是加号本身。 */
export function comboKeys(combo: string): string[] {
  return combo.split('+').reduce<string[]>((list, key, index, all) => {
    if (key) list.push(key);
    else if (index === all.length - 1) list.push('+');
    return list;
  }, []);
}
