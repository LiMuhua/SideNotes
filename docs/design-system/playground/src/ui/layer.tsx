/**
 * 浮层的挂载点与定位。
 *
 * 菜单、弹窗、工具提示都挂到所在应用窗口的浮层根节点中，而不是 document.body：
 * Playground 中的应用窗口可能被缩放显示，浮层必须跟随窗口一起缩放、并被限制在窗口之内，
 * 这与真实桌面窗口中「浮层不会超出窗口」的行为一致。
 */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const LayerContext = createContext<HTMLElement | null>(null);

/** 浮层根节点：覆盖整个容器，本身不拦截指针。 */
export function LayerRoot({ children }: { children: ReactNode }) {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  return (
    <LayerContext.Provider value={layer}>
      {children}
      <div ref={setLayer} className="sn-layer-root" />
    </LayerContext.Provider>
  );
}

export function useLayer(): HTMLElement | null {
  return useContext(LayerContext);
}

/** 渲染到当前窗口的浮层根节点。 */
export function Layer({ children }: { children: ReactNode }) {
  const layer = useLayer();
  return layer ? createPortal(children, layer) : null;
}

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top' | 'top-start' | 'right-start';

/** 浮层的定位点：元素的 ref、元素本身或一个指针位置（视口坐标）。 */
export type Anchor = RefObject<HTMLElement | null> | HTMLElement | null | { x: number; y: number };

interface Position {
  left: number;
  top: number;
  placement: Placement;
  /** 上下都放不下时，可以滚动的浮层（候选列表、菜单）限制到这个高度，不盖住定位点。 */
  maxHeight?: number;
}

/** 浮层根节点相对视口的位置与缩放比例。 */
function layerFrame(layer: HTMLElement): { rect: DOMRect; scale: number } {
  const rect = layer.getBoundingClientRect();
  const scale = layer.offsetWidth ? rect.width / layer.offsetWidth : 1;
  return { rect, scale: scale || 1 };
}

/**
 * 计算浮层位置：优先放在指定方向，空间不够时翻到另一侧，并限制在窗口之内留出 8px 边距。
 * 上下都放不下时，可以滚动的浮层（overflow 为 auto 或 scroll）放到空间较大的一侧并限制高度，
 * 不再被推回窗口之内、盖住定位点（例如点进组合框准备输入时，候选列表不能遮住输入框）。
 * 返回浮层根节点坐标系中的 left、top（已除以缩放比例）。
 */
export function computePosition(
  layer: HTMLElement,
  anchor: Anchor,
  floating: HTMLElement,
  placement: Placement,
  gap = 6,
): Position {
  const { rect: frame, scale } = layerFrame(layer);
  const toLocal = (value: number, origin: number) => (value - origin) / scale;
  const box =
    anchor === null
      ? new DOMRect()
      : anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : 'current' in anchor
          ? anchor.current?.getBoundingClientRect() ?? new DOMRect()
          : new DOMRect(anchor.x, anchor.y, 0, 0);
  const anchorBox = {
    left: toLocal(box.left, frame.left),
    top: toLocal(box.top, frame.top),
    right: toLocal(box.right, frame.left),
    bottom: toLocal(box.bottom, frame.top),
  };
  // 量浮层本来的尺寸：先去掉上一次为了放进窗口而加的最大高度，量完立即恢复。
  const limited = floating.style.maxHeight;
  floating.style.maxHeight = '';
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  floating.style.maxHeight = limited;
  const scrollable = /auto|scroll/.test(getComputedStyle(floating).overflowY);
  const maxLeft = layer.offsetWidth - width - 8;
  let maxTop = layer.offsetHeight - height - 8;
  let resolved = placement;
  let left: number;
  let top: number;
  let maxHeight: number | undefined;

  if (placement === 'right-start') {
    left = anchorBox.right + gap;
    top = anchorBox.top;
    if (left > maxLeft) left = anchorBox.left - width - gap;
  } else {
    const below = anchorBox.bottom + gap;
    const above = anchorBox.top - height - gap;
    const preferAbove = placement.startsWith('top');
    top = preferAbove ? above : below;
    if (preferAbove && above < 8 && below <= maxTop) {
      top = below;
      resolved = 'bottom';
    } else if (!preferAbove && below > maxTop && above >= 8) {
      top = above;
      resolved = 'top';
    } else if (scrollable && (preferAbove ? above < 8 : below > maxTop)) {
      // 上下都放不下：放到空间较大的一侧，高度限制在这一侧的空间之内。
      const spaceBelow = layer.offsetHeight - 8 - below;
      const spaceAbove = anchorBox.top - gap - 8;
      maxHeight = Math.max(0, Math.floor(Math.max(spaceBelow, spaceAbove)));
      if (spaceBelow >= spaceAbove) {
        top = below;
        resolved = 'bottom';
      } else {
        top = anchorBox.top - gap - maxHeight;
        resolved = 'top';
      }
      maxTop = layer.offsetHeight - maxHeight - 8;
    }
    if (placement.endsWith('-end')) left = anchorBox.right - width;
    else if (placement === 'bottom' || placement === 'top') left = (anchorBox.left + anchorBox.right) / 2 - width / 2;
    else left = anchorBox.left;
  }

  return {
    left: Math.max(8, Math.min(left, maxLeft)),
    top: Math.max(8, Math.min(top, maxTop)),
    placement: resolved,
    maxHeight,
  };
}

/** 打开期间持续定位浮层；窗口尺寸变化或滚动时重新计算。 */
export function useAnchoredPosition(
  open: boolean,
  anchor: Anchor,
  floating: RefObject<HTMLElement | null>,
  placement: Placement,
  gap?: number,
): { style: CSSProperties; placement: Placement } {
  const layer = useLayer();
  const [position, setPosition] = useState<Position | null>(null);

  const update = useCallback(() => {
    if (!layer || !floating.current) return;
    const next = computePosition(layer, anchor, floating.current, placement, gap);
    // 位置没有变化时保持原对象，避免无意义的重渲染。
    setPosition((current) =>
      current && current.left === next.left && current.top === next.top && current.placement === next.placement && current.maxHeight === next.maxHeight
        ? current
        : next,
    );
  }, [layer, anchor, floating, placement, gap]);

  // 关闭后保留上一次的位置但不使用；再次打开时在绘制之前重新测量，不会闪到旧位置。
  useLayoutEffect(() => {
    if (!open) return;
    // 先测量浮层尺寸再定位，必须在绘制前完成，这是 useLayoutEffect 的典型用途。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return {
    // 第一次测量完成前先隐藏，避免浮层在左上角闪一下。
    style: open && position ? { left: position.left, top: position.top, maxHeight: position.maxHeight } : { left: 0, top: 0, visibility: 'hidden' },
    placement: (open && position?.placement) || placement,
  };
}

/** 可获得焦点的元素选择器，用于焦点陷阱与菜单。 */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** 容器内可获得焦点的元素。 */
export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest('[inert]') && element.offsetParent !== null,
  );
}
