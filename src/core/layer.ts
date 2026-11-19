/**
 * 浮层的定位（与交互原型 layer.js 相同）：问号说明、下拉列表、字体候选等挂在 body 下的独立一层，按视口定位。
 *
 * 浮层不属于任何容器，不会被设置页等可滚动的区域裁剪或遮挡，也不会撑出滚动条。
 * 下方放不下时翻到上方，左右限制在视口内；两边都放不下时限制高度（`scroll`），内容在浮层里滚动。
 * 只放在下方的浮层（`stayBelow`，字体候选）不翻到上方：下面空间太小时先把锚点所在的滚动区域往上滚出空间。
 * 桌面端的字号是 WebView 整页缩放，浮层没有 CSS zoom，这里按 1 计算；原型的 zoom 换算保留，以防样式中带 zoom。
 */

/** 浮层与视口边缘的最小距离。 */
const MARGIN = 8;
/** 只放在下方的浮层至少要有这么高的空间（约六行候选），不够时把锚点所在的滚动区域往上滚。 */
const ROOM_BELOW = 240;

export interface FloatingOptions {
  /** bottom-start（默认）、bottom-end、bottom（居中）、top（优先放在上方）。 */
  placement?: 'bottom-start' | 'bottom-end' | 'bottom' | 'top';
  /** 与锚点的间距，默认 6。 */
  offset?: number;
  /** 至少与锚点同宽（下拉列表）。 */
  matchWidth?: boolean;
  /** 放不下时限制高度，在浮层里滚动。 */
  scroll?: boolean;
  /** 只放在锚点下方，不翻到上方（字体候选，T112）。 */
  stayBelow?: boolean;
}

/** 锚点所在、能纵向滚动的最近一层容器。 */
function scrollParent(anchor: Element): HTMLElement | null {
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** 锚点下面的空间不够 ROOM_BELOW 时，把它所在的滚动区域往上滚出空间（滚到底了就作罢），返回锚点新的位置。 */
function makeRoomBelow(anchor: Element, rect: DOMRect, offset: number, viewHeight: number): DOMRect {
  const below = viewHeight - rect.bottom - offset - MARGIN;
  const scroller = below < ROOM_BELOW ? scrollParent(anchor) : null;
  if (!scroller) return rect;
  const before = scroller.scrollTop;
  scroller.scrollTop = before + (ROOM_BELOW - below);
  return scroller.scrollTop === before ? rect : anchor.getBoundingClientRect();
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
  const offset = options.offset ?? 6;
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  let rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
  if (options.stayBelow && anchor instanceof Element) rect = makeRoomBelow(anchor, rect, offset, viewHeight);
  floating.style.left = '0px';
  floating.style.top = '0px';
  floating.style.maxWidth = `${(viewWidth - MARGIN * 2) / zoom}px`;
  if (options.matchWidth) floating.style.minWidth = `${rect.width / zoom}px`;
  if (options.scroll) floating.style.maxHeight = '';
  let size = floating.getBoundingClientRect();
  const below = viewHeight - rect.bottom - offset - MARGIN;
  const above = rect.top - offset - MARGIN;
  const upward = options.stayBelow
    ? false
    : options.placement === 'top'
      ? size.height <= above || above > below
      : size.height > below && above > below;
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
  // 只放在下方的浮层不往上挪去盖住输入框：放不下的部分已经限制了高度。
  if (!options.stayBelow) top = Math.max(MARGIN, Math.min(top, viewHeight - size.height - MARGIN));
  floating.style.left = `${left / zoom}px`;
  floating.style.top = `${top / zoom}px`;
  floating.dataset.side = upward ? 'top' : 'bottom';
}
