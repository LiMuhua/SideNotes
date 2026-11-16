/**
 * 页签栏的排法（第六、七次反馈，与交互原型 tabs.js 的 layout 相同）。
 *
 * 1. 页签都放得下就全部显示；后面还有位置时最后一格是「+」（新建页签），没有位置就不显示「+」，不为它收起页签
 *    （第七次反馈：此前把「+」也算在内，页签都放得下、只差「+」时也会收起一个页签）。
 * 2. 页签真放不下时，从右往左收进最后一格，最后一格写「N ▾」；每收一个按「N ▾」的实际宽度重新算，刚好放下为止，
 *    不为别的写法预留宽度（第六次反馈）。
 * 3. 当前页签不收（第七次反馈：此前收在菜单里，看不出是哪个页签）：放不下时收它前面的页签，它排到「N ▾」前面；
 *    别的页签都收起后仍放不下时，它的名字缩短（squeeze）。
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
  /** 当前页签在 tags 中的位置，它不收起；当前页签不是标签页签时省略。 */
  keep?: number;
}

export interface TabFit {
  /** 显示在页签栏里的标签页签（tags 的下标，按页签栏的顺序）。 */
  visible: number[];
  /** 最后一格：add 是「+」，count 是「N ▾」，none 是页签都放得下、只是放不下「+」，这一格不显示。 */
  slot: 'add' | 'count' | 'none';
  /** 别的页签都收起后，当前页签仍放不下：它的名字缩短。 */
  squeeze: boolean;
}

/** 允许的误差：宽度是小数，四舍五入可能多出不到一像素。 */
const TOLERANCE = 1;

/** @returns 显示哪些标签页签，最后一格写什么。 */
export function fitTabs({ available, fixed, tags, gap, add, count, keep = -1 }: TabMetrics): TabFit {
  // 最后一格不显示时，最后一个页签后面没有间距。
  const fits = (visible: readonly number[], slot: number) =>
    fixed + visible.reduce((sum, index) => sum + tags[index] + gap, 0) + (slot > 0 ? slot : -gap) <= available + TOLERANCE;
  const all = tags.map((_, index) => index);
  if (fits(all, add)) return { visible: all, slot: 'add', squeeze: false };
  if (fits(all, 0)) return { visible: all, slot: 'none', squeeze: false };
  const visible = [...all];
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    if (index === keep) continue;
    visible.splice(visible.indexOf(index), 1);
    if (fits(visible, count(tags.length - visible.length))) return { visible, slot: 'count', squeeze: false };
  }
  return { visible, slot: 'count', squeeze: visible.length > 0 && !fits(visible, count(tags.length - visible.length)) };
}
