/**
 * 页签栏的排法（第六、七次反馈，playground/src/model/tabLayout.ts，与交互原型 tabs.js 的 layout 相同）：
 *
 * - 都放得下、后面还有位置时全部显示，最后一格是「+」；
 * - 都放得下、只差「+」时不显示「+」，不为它收起页签（第七次反馈）；
 * - 真放不下时从右往左收起，按「N ▾」的实际宽度算，刚好放下为止，不为别的写法预留空位（第六次反馈）；
 * - 当前页签不收：放不下时收它前面的页签，它排到「N ▾」前面；只剩它也放不下时名字缩短（第七次反馈）；
 * - 收起十个以上时「N ▾」写两位数，按两位数的宽度算。
 */

import { describe, expect, it } from 'vitest';
import { fitTabs, type TabMetrics } from '../playground/src/model/tabLayout';

/** 固定部分 100，间距 4；「+」宽 24，「N ▾」一位数宽 30、两位数宽 36（比一个页签窄，与实际相同）。 */
const base: Omit<TabMetrics, 'available' | 'tags'> = {
  fixed: 100,
  gap: 4,
  add: 24,
  count: (hidden) => (hidden >= 10 ? 36 : 30),
};

describe('页签栏的排法', () => {
  it('都放得下、后面还有位置时全部显示，最后一格是「+」', () => {
    // 100 + 3 × (40 + 4) + 24 = 256
    expect(fitTabs({ ...base, available: 256, tags: [40, 40, 40] })).toEqual({ visible: [0, 1, 2], slot: 'add', squeeze: false });
    expect(fitTabs({ ...base, available: 300, tags: [] })).toEqual({ visible: [], slot: 'add', squeeze: false });
  });

  it('都放得下、只差「+」时不显示「+」，不收起页签（第七次反馈）', () => {
    // 不要「+」时最后一个页签后面没有间距：100 + 3 × 44 − 4 = 228
    expect(fitTabs({ ...base, available: 250, tags: [40, 40, 40] })).toEqual({ visible: [0, 1, 2], slot: 'none', squeeze: false });
    expect(fitTabs({ ...base, available: 228, tags: [40, 40, 40] })).toEqual({ visible: [0, 1, 2], slot: 'none', squeeze: false });
  });

  it('真放不下时按「N ▾」的实际宽度从右往左收起，刚好放下为止', () => {
    // 收起一个：100 + 2 × 44 + 30 = 218；收起两个：100 + 44 + 30 = 174
    expect(fitTabs({ ...base, available: 226, tags: [40, 40, 40] })).toEqual({ visible: [0, 1], slot: 'count', squeeze: false });
    expect(fitTabs({ ...base, available: 218, tags: [40, 40, 40] }).visible).toEqual([0, 1]);
    expect(fitTabs({ ...base, available: 216, tags: [40, 40, 40] }).visible).toEqual([0]);
    expect(fitTabs({ ...base, available: 172, tags: [40, 40, 40] }).visible).toEqual([]);
  });

  it('不为别的写法预留空位：只差一个页签时，收起的只有放不下的那一个', () => {
    // 第六次反馈之前最后一格按 4 个字预留宽度，320 的宽度只显示两个标签页签；现在只收起放不下的最后一个（100 + 3 × 48 + 30 = 274）。
    expect(fitTabs({ ...base, available: 320, tags: [44, 44, 44, 84] }).visible).toEqual([0, 1, 2]);
  });

  it('当前页签不收：放不下时收它前面的页签，它排到「N ▾」前面（第七次反馈）', () => {
    const tags = [40, 40, 40, 60];
    // 当前是最后一个：先收第三个（100 + 44 + 44 + 64 + 30 = 282，放不下），再收第二个（100 + 44 + 64 + 30 = 238）。
    expect(fitTabs({ ...base, available: 240, tags, keep: 3 })).toEqual({ visible: [0, 3], slot: 'count', squeeze: false });
    // 当前页签本来就放得下时与没有当前页签一样。
    expect(fitTabs({ ...base, available: 226, tags: [40, 40, 40], keep: 0 }).visible).toEqual([0, 1]);
  });

  it('别的页签都收起后当前页签仍放不下时，它的名字缩短', () => {
    // 100 + 204 + 30 = 334，比 250 宽。
    expect(fitTabs({ ...base, available: 250, tags: [40, 200], keep: 1 })).toEqual({ visible: [1], slot: 'count', squeeze: true });
  });

  it('收起十个以上时按两位数的宽度算', () => {
    const tags = Array.from({ length: 12 }, () => 40);
    // 只放得下一个：100 + 44 + 36（「11 ▾」）= 180；按一位数算会是 174
    expect(fitTabs({ ...base, available: 178, tags }).visible).toEqual([]);
    expect(fitTabs({ ...base, available: 180, tags }).visible).toEqual([0]);
  });
});
