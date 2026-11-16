/**
 * 页签栏的排法（第六、七、八次反馈，playground/src/model/tabLayout.ts，与交互原型 tabs.js 的 layout 相同）：
 *
 * - 都放得下、后面还有位置时全部显示，最后一格是「+」；只差「+」时不显示「+」，不为它收起页签（第七次反馈）；
 * - 真放不下时按顺序能放几个放几个，按「N ▾」的实际宽度算，不为别的写法预留空位（第六次反馈）；
 *   最后一个显示的页签与「N ▾」合成末格（第八次反馈）；
 * - 末格可以换成收起的页签（第八次反馈）：当前页签本该收起时换进来，否则是上一次换进来的；换进来的较宽时名字缩短，
 *   不挤掉前面的页签，较窄时菜单里排在最前的页签补到末格前面；
 * - 显示哪些页签按不写当前页签条数时的宽度定（第八次反馈），多出的宽度依次让出：「+」、当前页签的条数、末格页签的名字，
 *   最后才收起前面的页签；
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

/** 末格的页签与「N ▾」紧挨着（与 Playground 相同）。 */
const joined: Omit<TabMetrics, 'available' | 'tags'> = { ...base, joint: 0 };

describe('页签栏的排法', () => {
  it('都放得下、后面还有位置时全部显示，最后一格是「+」', () => {
    // 100 + 3 × (40 + 4) + 24 = 256
    expect(fitTabs({ ...base, available: 256, tags: [40, 40, 40] })).toEqual({ visible: [0, 1, 2], slot: 'add', last: -1, squeezed: -1, counted: true });
    expect(fitTabs({ ...base, available: 300, tags: [] })).toMatchObject({ visible: [], slot: 'add' });
  });

  it('都放得下、只差「+」时不显示「+」，不收起页签（第七次反馈）', () => {
    // 不要「+」时最后一个页签后面没有间距：100 + 3 × 44 − 4 = 228
    expect(fitTabs({ ...base, available: 250, tags: [40, 40, 40] })).toEqual({ visible: [0, 1, 2], slot: 'none', last: -1, squeezed: -1, counted: true });
    expect(fitTabs({ ...base, available: 228, tags: [40, 40, 40] })).toMatchObject({ visible: [0, 1, 2], slot: 'none' });
  });

  it('真放不下时按顺序能放几个放几个，最后一个与「N ▾」合成末格', () => {
    // 放两个：100 + 44 + 40 + 4 + 30 = 218；放一个：100 + 40 + 4 + 30 = 174
    expect(fitTabs({ ...base, available: 226, tags: [40, 40, 40] })).toEqual({ visible: [0, 1], slot: 'count', last: 1, squeezed: -1, counted: true });
    expect(fitTabs({ ...base, available: 218, tags: [40, 40, 40] }).visible).toEqual([0, 1]);
    expect(fitTabs({ ...base, available: 216, tags: [40, 40, 40] })).toMatchObject({ visible: [0], last: 0 });
    expect(fitTabs({ ...base, available: 170, tags: [40, 40, 40] })).toMatchObject({ visible: [], last: -1 });
    // 没有固定的标签时没有可收的页签，放不下「+」就不显示它
    expect(fitTabs({ ...base, available: 50, tags: [] })).toMatchObject({ visible: [], slot: 'none', last: -1 });
  });

  it('末格的页签与「N ▾」紧挨着时，省下的间距也算进去', () => {
    // joint 为 0：100 + 44 + 40 + 30 = 214，放得下两个；按页签间距算要 218
    expect(fitTabs({ ...joined, available: 214, tags: [40, 40, 40] }).visible).toEqual([0, 1]);
    expect(fitTabs({ ...base, available: 214, tags: [40, 40, 40] }).visible).toEqual([0]);
  });

  it('不为别的写法预留空位：只差一个页签时，收起的只有放不下的那一个', () => {
    // 第六次反馈之前最后一格按 4 个字预留宽度，320 的宽度只显示两个标签页签；现在只收起放不下的最后一个（100 + 2 × 48 + 44 + 4 + 30 = 274）。
    expect(fitTabs({ ...base, available: 320, tags: [44, 44, 44, 84] }).visible).toEqual([0, 1, 2]);
  });

  describe('末格换页签（第八次反馈）', () => {
    // 参考、开发、设计、SideNotes：前三个放得下，SideNotes 收起。100 + 2 × 44 + 40 + 30 = 258
    const tags = [40, 40, 40, 80];
    const shrink = (index: number) => (index === 3 ? 40 : 0);

    it('当前页签本该收起时换进末格，前面的页签不动；它较宽时名字缩短', () => {
      expect(fitTabs({ ...joined, available: 260, tags, current: 2 })).toMatchObject({ visible: [0, 1, 2], last: 2, squeezed: -1 });
      // 从菜单选 SideNotes：设计回到菜单，参考与开发不动，SideNotes 缩到 40 放进末格
      expect(fitTabs({ ...joined, available: 260, tags, current: 3, shrink })).toEqual({ visible: [0, 1, 3], slot: 'count', last: 3, squeezed: 3, counted: true });
    });

    it('名字缩到最短仍放不下时，才收起前面的页签', () => {
      // 最短 70：100 + 88 + 70 + 30 = 288 放不下，收起开发：100 + 44 + 80 + 30 = 254，不用缩短
      expect(fitTabs({ ...joined, available: 260, tags, current: 3, shrink: () => 10 })).toMatchObject({ visible: [0, 3], last: 3, squeezed: -1 });
      // 一个标签页签也放不下时，只剩换进来的页签并缩短
      expect(fitTabs({ ...joined, available: 150, tags, current: 3 })).toMatchObject({ visible: [3], last: 3, squeezed: 3 });
    });

    it('切到前面的页签后末格仍是换进来的页签；末格本来是当前页签时不换', () => {
      expect(fitTabs({ ...joined, available: 260, tags, current: 0, swapped: 3, shrink })).toMatchObject({ visible: [0, 1, 3], last: 3 });
      expect(fitTabs({ ...joined, available: 260, tags, swapped: 3, shrink })).toMatchObject({ visible: [0, 1, 3], last: 3 });
      expect(fitTabs({ ...joined, available: 260, tags, current: 2, swapped: 3, shrink })).toMatchObject({ visible: [0, 1, 2], last: 2 });
      // 换进来的页签放回了页签栏（侧栏变宽）时按顺序排
      expect(fitTabs({ ...joined, available: 400, tags, swapped: 3 })).toMatchObject({ visible: [0, 1, 2, 3], slot: 'add' });
    });

    it('换进来的较窄时，菜单里排在最前的页签补到末格前面', () => {
      // 按顺序只放得下一个页签：100 + 44 + 40 + 30 = 214（宽 90 的第三个放不下）。换进宽 20 的第四个之后，第二个补回来：
      // 100 + 88 + 20 + 30 = 238
      expect(fitTabs({ ...joined, available: 260, tags: [40, 40, 90, 20] })).toMatchObject({ visible: [0, 1], last: 1 });
      expect(fitTabs({ ...joined, available: 260, tags: [40, 40, 90, 20], current: 3 })).toMatchObject({ visible: [0, 1, 3], last: 3, squeezed: -1 });
    });
  });

  describe('当前页签的条数（第八次反馈）', () => {
    const tags = [40, 40, 40, 40];

    it('显示哪些页签按不写条数时的宽度定，条数放不下时不写', () => {
      // 不写条数：100 + 88 + 40 + 30 = 258；第一个页签写条数多 10：268
      expect(fitTabs({ ...joined, available: 262, tags: [50, 40, 40, 40], current: 0, extra: 10 })).toEqual({ visible: [0, 1, 2], slot: 'count', last: 2, squeezed: -1, counted: false });
      expect(fitTabs({ ...joined, available: 270, tags: [50, 40, 40, 40], current: 0, extra: 10 })).toMatchObject({ visible: [0, 1, 2], counted: true });
      // 当前是置顶时条数算在固定部分里
      expect(fitTabs({ ...joined, available: 262, fixed: 110, tags, extra: 10 })).toMatchObject({ visible: [0, 1, 2], counted: false });
    });

    it('页签都放得下时先让出「+」，再不写条数，不收起页签', () => {
      // 100 + 88 − 4 = 184；写条数多 10 是 194，加「+」是 222
      expect(fitTabs({ ...base, available: 190, tags: [50, 40], current: 0, extra: 10 })).toEqual({ visible: [0, 1], slot: 'none', last: -1, squeezed: -1, counted: false });
      expect(fitTabs({ ...base, available: 200, tags: [50, 40], current: 0, extra: 10 })).toMatchObject({ slot: 'none', counted: true });
    });
  });

  it('收起十个以上时按两位数的宽度算', () => {
    const tags = Array.from({ length: 12 }, () => 40);
    // 只放得下一个：100 + 40 + 4 + 36（「11 ▾」）= 180；按一位数算会是 174
    expect(fitTabs({ ...base, available: 178, tags }).visible).toEqual([]);
    expect(fitTabs({ ...base, available: 180, tags }).visible).toEqual([0]);
  });
});
