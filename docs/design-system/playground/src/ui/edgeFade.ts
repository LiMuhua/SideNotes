/**
 * 列表上下边缘的渐隐（第八次反馈，与交互原型 app.js 的 fadeListEdges 相同）：卡片与组标题滚到列表的上边或下边时，
 * 在 --sn-space-6 内逐渐变淡，不再被一刀截断；只在那一侧还有内容时出现，刚开始滚动时随滚动距离由浅到深。
 *
 * 遮罩写进各自的 --local-edge-fade（sidebar.css）。遮罩加在卡片自己身上，不加在列表或卡片外面的 .sn-note-item 上：
 * 祖先元素带遮罩时，磨砂玻璃卡片的背景模糊只能取到这个祖先里的内容，透出的壁纸不再模糊。
 */

import { useEffect, type RefObject } from 'react';

/**
 * 一项的遮罩：上边一段从全透明到不透明、下边一段从不透明到全透明，长度都是 size，随上下还有的内容（最多 size）从可见区之外
 * 移进来：上面没有内容时，上边这一段整个在可见区之外，看不出变淡。
 * @param top 这一项的上边到可见区上边的距离（CSS 像素，在上面时为负）。
 * @param height 这一项的高度。
 * @param view 可见区的高度。
 * @param above 上面还有的内容，超过 size 时按 size 算。
 * @param below 下面还有的内容，超过 size 时按 size 算。
 * @param size 渐隐的长度。
 * @returns 遮罩；这一项不在渐隐的位置时为空字符串。
 */
export function edgeMask(top: number, height: number, view: number, above: number, below: number, size: number): string {
  const start = above - size - top;
  const end = view - below - top;
  const fadeTop = above > 0 && start + size > 0 && start < height;
  const fadeBottom = below > 0 && end < height && end + size > 0;
  if (!fadeTop && !fadeBottom) return '';
  const px = (value: number) => `${Math.round(value * 10) / 10}px`;
  const stops = fadeTop ? [`transparent ${px(start)}`, `#000 ${px(start + size)}`] : ['#000 0px'];
  if (fadeBottom) stops.push(`#000 ${px(end)}`, `transparent ${px(end + size)}`);
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

/** 渐隐的项：卡片本身（不是外面的 .sn-note-item）与搜索结果的组标题。 */
const ITEMS = ':scope > .sn-note-item > .sn-note, :scope > .sn-search-group-item';

/** 按现在的滚动位置，给列表里每一项写上遮罩或去掉。 */
export function fadeEdges(list: HTMLElement): void {
  const size = parseFloat(getComputedStyle(list).getPropertyValue('--sn-space-6')) || 0;
  const box = list.getBoundingClientRect();
  // 窗口可能按字号缩放：getBoundingClientRect 是缩放后的尺寸，换算回 CSS 像素。
  const scale = list.offsetHeight ? box.height / list.offsetHeight : 1;
  const rest = list.scrollHeight - list.clientHeight - list.scrollTop;
  // 缩放时滚动位置有小数，滚到头还差不到一像素，算作那一侧没有内容。
  const above = list.scrollTop < 1 ? 0 : Math.min(list.scrollTop, size);
  const below = rest < 1 ? 0 : Math.min(rest, size);
  const items = Array.from(list.querySelectorAll<HTMLElement>(ITEMS));
  const rects = items.map((item) => item.getBoundingClientRect());
  items.forEach((item, index) => {
    const mask = edgeMask((rects[index].top - box.top) / scale - list.clientTop, rects[index].height / scale, list.clientHeight, above, below, size);
    if (mask) item.style.setProperty('--local-edge-fade', mask);
    else item.style.removeProperty('--local-edge-fade');
  });
}

/** 滚动、列表或其中各项的尺寸变化、项目增减之后，下一帧重算渐隐。 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          fadeEdges(list);
        });
    };
    const resized = new ResizeObserver(schedule);
    // 列表的直接子项（卡片外面的 .sn-note-item 与组标题）与卡片同高，量它们就能知道卡片展开、收起与编辑时的高度变化。
    const watch = () => Array.from(list.children).forEach((child) => resized.observe(child));
    const mutations = new MutationObserver(() => {
      watch();
      schedule();
    });
    list.addEventListener('scroll', schedule, { passive: true });
    resized.observe(list);
    watch();
    mutations.observe(list, { childList: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener('scroll', schedule);
      resized.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
}
