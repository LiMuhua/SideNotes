/**
 * 浮层的定位（与交互原型 layer.js 相同）：问号说明、下拉列表、字体候选等挂在 body 下的独立一层，按视口定位。
 *
 * 浮层不属于任何容器，不会被设置页等可滚动的区域裁剪或遮挡，也不会撑出滚动条。
 * 下方放不下时翻到上方，左右限制在视口内；两边都放不下时限制高度（`scroll`），内容在浮层里滚动。
 * 桌面端的字号是 WebView 整页缩放，浮层没有 CSS zoom，这里按 1 计算；原型的 zoom 换算保留，以防样式中带 zoom。
 */

/** 浮层与视口边缘的最小距离。 */
const MARGIN = 8;

export interface FloatingOptions {
  /** bottom-start（默认）、bottom-end、bottom（居中）、top（优先放在上方）。 */
  placement?: 'bottom-start' | 'bottom-end' | 'bottom' | 'top';
  /** 与锚点的间距，默认 6。 */
  offset?: number;
  /** 至少与锚点同宽（下拉列表）。 */
  matchWidth?: boolean;
  /** 放不下时限制高度，在浮层里滚动。 */
  scroll?: boolean;
}

let root: HTMLElement | null = null;

/** 浮层所在的一层：body 的最后一个子元素，叠在侧栏、速记浮窗、设置窗口与它们的确认层之上。 */
export function floatingContainer(): HTMLElement {
  if (!root || !root.isConnected) {
    root = document.createElement('div');
    root.className = 'floating-layer';
    document.body.append(root);
  }
  return root;
}

/** 把浮层放到锚点旁边。浮层要已经在页面上（放进 floatingContainer）。 */
export function placeFloating(floating: HTMLElement, anchor: Element | DOMRect, options: FloatingOptions = {}): void {
  if (!floating.isConnected) return;
  const zoom = parseFloat(getComputedStyle(floating).zoom) || 1;
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  const offset = options.offset ?? 6;
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  floating.style.left = '0px';
  floating.style.top = '0px';
  floating.style.maxWidth = `${(viewWidth - MARGIN * 2) / zoom}px`;
  if (options.matchWidth) floating.style.minWidth = `${rect.width / zoom}px`;
  if (options.scroll) floating.style.maxHeight = '';
  let size = floating.getBoundingClientRect();
  const below = viewHeight - rect.bottom - offset - MARGIN;
  const above = rect.top - offset - MARGIN;
  const upward = options.placement === 'top' ? size.height <= above || above > below : size.height > below && above > below;
  if (options.scroll && size.height > (upward ? above : below)) {
    floating.style.maxHeight = `${Math.max(80, upward ? above : below) / zoom}px`;
    size = floating.getBoundingClientRect();
  }
  let top = upward ? rect.top - offset - size.height : rect.bottom + offset;
  let left =
    options.placement === 'bottom' || options.placement === 'top'
      ? rect.left + (rect.width - size.width) / 2
      : options.placement === 'bottom-end'
        ? rect.right - size.width
        : rect.left;
  left = Math.max(MARGIN, Math.min(left, viewWidth - size.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewHeight - size.height - MARGIN));
  floating.style.left = `${left / zoom}px`;
  floating.style.top = `${top / zoom}px`;
  floating.dataset.side = upward ? 'top' : 'bottom';
}
