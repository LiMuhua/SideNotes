'use strict';

/**
 * @brief 浮层：问号说明、下拉列表与图标的大图预览挂在 body 下的独立一层，按视口定位（本次提出）。
 * @details 浮层不属于任何容器，不会被设置页等可滚动的区域裁剪或遮挡，也不会撑出滚动条。
 * 浮层随字号整页缩放（样式中带 zoom），位置按视口坐标算好后除以缩放倍数再写入；
 * 下方放不下时翻到上方，左右限制在视口内；两边都放不下时限制高度，内容在浮层里滚动。
 */
window.SideNotesLayer = (function createLayer() {
  const MARGIN = 8;
  let root = null;
  const tracked = new Set();

  /** @brief 浮层所在的一层：body 的最后一个子元素，叠在侧栏、速记浮窗、设置窗口与它的确认层之上。 @return {HTMLElement} 容器。 */
  function container() {
    if (!root || !root.isConnected) {
      root = document.createElement('div');
      root.className = 'floating-layer';
      document.body.append(root);
    }
    return root;
  }

  /**
   * @brief 把浮层放到锚点旁边。
   * @param {HTMLElement} floating 已放进容器的浮层。 @param {Element|DOMRect} anchor 锚点元素或矩形。
   * @param {object} options placement：bottom-start（默认）、bottom-end、bottom、top；offset 间距；matchWidth 至少与锚点同宽；scroll 放不下时限制高度。
   */
  function place(floating, anchor, options = {}) {
    if (!floating.isConnected) return;
    const zoom = parseFloat(window.getComputedStyle(floating).zoom) || 1;
    const rect = anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
    if (!rect) return;
    const offset = options.offset === undefined ? 6 : options.offset;
    const viewWidth = document.documentElement.clientWidth, viewHeight = document.documentElement.clientHeight;
    floating.style.left = '0px';
    floating.style.top = '0px';
    floating.style.maxWidth = (viewWidth - MARGIN * 2) / zoom + 'px';
    if (options.matchWidth) floating.style.minWidth = rect.width / zoom + 'px';
    if (options.scroll) floating.style.maxHeight = '';
    let size = floating.getBoundingClientRect();
    const below = viewHeight - rect.bottom - offset - MARGIN, above = rect.top - offset - MARGIN;
    const upward = options.placement === 'top' ? size.height <= above || above > below : size.height > below && above > below;
    if (options.scroll && size.height > (upward ? above : below)) {
      floating.style.maxHeight = Math.max(80, upward ? above : below) / zoom + 'px';
      size = floating.getBoundingClientRect();
    }
    let top = upward ? rect.top - offset - size.height : rect.bottom + offset;
    let left = options.placement === 'bottom' || options.placement === 'top' ? rect.left + (rect.width - size.width) / 2 : options.placement === 'bottom-end' ? rect.right - size.width : rect.left;
    left = Math.max(MARGIN, Math.min(left, viewWidth - size.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, viewHeight - size.height - MARGIN));
    floating.style.left = left / zoom + 'px';
    floating.style.top = top / zoom + 'px';
    floating.dataset.side = upward ? 'top' : 'bottom';
  }

  /**
   * @brief 打开浮层：放进容器、定位，窗口缩放或任何区域滚动时重新定位。
   * @param {HTMLElement} floating 浮层。 @param {Element} anchor 锚点。 @param {object} options 同 place。
   * @return {Function} 关闭函数：移除浮层并停止跟随。
   */
  function open(floating, anchor, options = {}) {
    container().append(floating);
    const entry = { floating: floating, anchor: anchor, options: options };
    tracked.add(entry);
    place(floating, anchor, options);
    return function close() {
      tracked.delete(entry);
      floating.remove();
    };
  }

  /** 锚点随页面滚动或窗口变化时跟着走；锚点已不在页面上时浮层一并移除。 */
  function reposition(event) {
    tracked.forEach(function follow(entry) {
      if (event && event.type === 'scroll' && event.target instanceof Node && entry.floating.contains(event.target)) return;
      if (!entry.anchor.isConnected) { tracked.delete(entry); entry.floating.remove(); return; }
      place(entry.floating, entry.anchor, entry.options);
    });
  }
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);

  return Object.freeze({ container: container, place: place, open: open });
})();
