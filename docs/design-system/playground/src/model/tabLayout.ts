/**
 * 页签栏放得下几个标签页签（第六次反馈，与交互原型 tabs.js 的 layout 相同）。
 *
 * 页签都放得下时全部显示，最后一格是「+」（新建页签）；真放不下时从右往左收进最后一格，最后一格写「N ▾」，
 * 每收一个按「N ▾」的实际宽度重新算，刚好放下为止。最后一格样子固定，不再为「写当前页签的名字」预留宽度
 * （此前按 4 个字预留，后面空着一段也会收起页签）。
 */

export interface TabMetrics {
  /** 页签栏里可以排页签的宽度。 */
  available: number;
  /** 固定部分：页签栏两端的内边距、随记与置顶，以及它们后面的间距。 */
  fixed: number;
  /** 标签页签的宽度，按页签栏的顺序。 */
  tags: readonly number[];
  /** 页签之间的间距。 */
  gap: number;
  /** 最后一格写「+」时的宽度。 */
  add: number;
  /** 最后一格写「N ▾」时的宽度，N 是收起的个数。 */
  count: (hidden: number) => number;
}

/** 允许的误差：宽度是小数，四舍五入可能多出不到一像素。 */
const TOLERANCE = 1;

/** @returns 显示在页签栏里的标签页签个数（从前往后），其余收进最后一格。 */
export function fitTabs({ available, fixed, tags, gap, add, count }: TabMetrics): number {
  const need = (visible: number, slot: number) => fixed + tags.slice(0, visible).reduce((sum, width) => sum + width + gap, 0) + slot;
  if (need(tags.length, add) <= available + TOLERANCE) return tags.length;
  let visible = tags.length - 1;
  while (visible > 0 && need(visible, count(tags.length - visible)) > available + TOLERANCE) visible -= 1;
  return Math.max(0, visible);
}
