/**
 * 页签栏的排法（第六、七、八次反馈，与交互原型 tabs.js 的 layout 相同）。
 *
 * 1. 页签都放得下就全部显示；后面还有位置时最后一格是「+」（新建页签），没有位置就不显示「+」，不为它收起页签
 *    （第七次反馈：此前把「+」也算在内，页签都放得下、只差「+」时也会收起一个页签）。
 * 2. 页签真放不下时，按页签栏的顺序能放几个放几个，其余从右往左收进「N ▾」；每收一个按「N ▾」的实际宽度重新算，
 *    刚好放下为止，不为别的写法预留宽度（第六次反馈）。最后一个显示的页签与「N ▾」合成末格（第八次反馈）。
 * 3. 末格可以换成收起的页签（第八次反馈：此前选中的页签排到「N ▾」前面，宽的页签会把前面几个挤掉）：当前页签本该收起时
 *    换进来，始终显示名字（第七次反馈）；否则是上一次换进来的，切到前面的页签后仍在末格。换进来的页签较窄、空出的位置
 *    放得下菜单里排在最前的页签时，它补到末格前面。
 * 4. 显示哪些页签按不带当前页签条数的宽度定（第八次反馈）：切换页签时前面的页签不变。条数或换进来的页签多出的宽度，
 *    依次这样让出：不显示「+」，不写当前页签的条数，末格页签的名字缩短（最短留两个字），最后才收起前面的页签。
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
  /** 末格的页签与「N ▾」之间的距离（两者合成一格，紧挨着）；省略时与页签间距相同。 */
  joint?: number;
  /** 当前页签在 tags 中的位置；当前是随记或置顶时省略。 */
  current?: number;
  /**
   * 当前页签的条数占的宽度（条数与它前面的间距）。当前是标签页签时算在 tags[current] 里，是置顶时算在 fixed 里；
   * 随记的条数一直显示，为 0。
   */
  extra?: number;
  /** 上一次换进末格的页签在 tags 中的位置；没有时省略。 */
  swapped?: number;
  /** 页签的名字最多能缩短多少（名字超出两个字的部分）；省略时不缩短。 */
  shrink?: (index: number) => number;
}

export interface TabFit {
  /** 显示在页签栏里的标签页签（tags 的下标），按显示的顺序：末格的页签在最后。 */
  visible: number[];
  /** 最后一格：add 是「+」，count 是「N ▾」，none 是页签都放得下、只是放不下「+」，这一格不显示。 */
  slot: 'add' | 'count' | 'none';
  /** 与「N ▾」合成末格的页签（tags 的下标）；没有收起的页签，或一个标签页签也放不下时为 -1。 */
  last: number;
  /** 名字缩短的页签（tags 的下标）；没有时为 -1。 */
  squeezed: number;
  /** 当前页签写不写条数：放不下时先不写。 */
  counted: boolean;
}

/** 允许的误差：宽度是小数，四舍五入可能多出不到一像素。 */
const TOLERANCE = 1;

/** @returns 显示哪些标签页签、按什么顺序，最后一格写什么，哪个页签的名字缩短，当前页签写不写条数。 */
export function fitTabs({
  available,
  fixed,
  tags,
  gap,
  add,
  count,
  joint = gap,
  current = -1,
  extra = 0,
  swapped = -1,
  shrink = () => 0,
}: TabMetrics): TabFit {
  const limit = available + TOLERANCE;
  const all = tags.map((_, index) => index);
  // 不写当前页签条数时的宽度：显示哪些页签按它定，切换页签时不变。
  const plainTags = tags.map((width, index) => (index === current ? width - extra : width));
  const plainFixed = current < 0 ? fixed - extra : fixed;
  /**
   * 一排的宽度：front 依次排开，last 是与「N ▾」合成末格的页签（宽 lastWidth），more 是最后一格的宽度；counted 时按写条数的宽度算。
   * 最后一格不显示（more 为 0）时最后一个页签后面没有间距；末格的页签与「N ▾」之间是 joint。
   */
  const row = (counted: boolean, front: readonly number[], last = -1, more = 0, lastWidth?: number) => {
    const widths = counted ? tags : plainTags;
    const tabs = front.reduce((total, index) => total + widths[index] + gap, 0) + (last >= 0 ? (lastWidth ?? widths[last]) + gap : 0);
    const head = counted ? fixed : plainFixed;
    if (more <= 0) return head + tabs - gap;
    return head + tabs + (last >= 0 ? joint - gap : 0) + more;
  };
  const rest = (front: readonly number[], last: number) => tags.length - front.length - (last >= 0 ? 1 : 0);

  // 1. 都放得下：全部显示，后面还有位置时是「+」；放不下「+」时不显示它，再放不下就不写当前页签的条数。
  if (row(false, all) <= limit) {
    if (row(true, all, -1, add) <= limit) return { visible: all, slot: 'add', last: -1, squeezed: -1, counted: true };
    return { visible: all, slot: 'none', last: -1, squeezed: -1, counted: row(true, all) <= limit };
  }

  // 2. 放不下：按顺序能放几个放几个（不写条数时的宽度），最后一个是末格本来的页签。没有固定的标签时没有可收的页签。
  if (!tags.length) return { visible: [], slot: 'none', last: -1, squeezed: -1, counted: row(true, all) <= limit };
  let shown = tags.length - 1;
  while (shown > 0 && row(false, all.slice(0, shown - 1), shown - 1, count(tags.length - shown)) > limit) shown -= 1;
  const occupant = shown - 1;

  // 3. 换进末格的页签：当前页签本该收起时是它；否则是上一次换进来的，末格本来是当前页签时不换。
  let pick = -1;
  if (current >= shown) pick = current;
  else if (swapped >= shown && (occupant < 0 || current !== occupant)) pick = swapped;
  const front = all.slice(0, Math.max(occupant, 0));
  const last = pick >= 0 ? pick : occupant;
  // 换进来的较窄：菜单里排在最前的页签补到末格前面，补到放不下为止（写条数、名字不缩短时算）。
  if (pick >= 0 && row(true, front, last, count(rest(front, last))) <= limit) {
    for (const index of all) {
      if (front.includes(index) || index === pick) continue;
      const next = [...front, index];
      if (row(true, next, last, count(rest(next, last))) > limit) break;
      front.push(index);
    }
  }

  // 4. 多出的宽度：先不写当前页签的条数，再缩短末格页签的名字，缩到最短仍放不下才收起前面的页签。
  let counted = true;
  let squeezed = -1;
  while (row(counted, front, last, count(rest(front, last))) > limit) {
    if (counted && extra > 0) {
      counted = false;
      continue;
    }
    if (last >= 0) {
      const width = (counted ? tags : plainTags)[last];
      if (row(counted, front, last, count(rest(front, last)), width - shrink(last)) <= limit) {
        squeezed = last;
        break;
      }
    }
    if (!front.length) {
      squeezed = last;
      break;
    }
    front.pop();
  }
  return { visible: last >= 0 ? [...front, last] : front, slot: 'count', last, squeezed, counted };
}
