/**
 * 页签栏放得下几个标签页签（第六次反馈，playground/src/model/tabLayout.ts，与交互原型 tabs.js 的 layout 相同）：
 *
 * - 都放得下时全部显示，最后一格是「+」；
 * - 真放不下时从右往左收起，按「N ▾」的实际宽度算，刚好放下为止，不为别的写法预留空位；
 * - 收起十个以上时「N ▾」写两位数，按两位数的宽度算。
 */

import { describe, expect, it } from 'vitest';
import { fitTabs, type TabMetrics } from '../playground/src/model/tabLayout';

/** 固定部分 100，间距 4；「+」宽 24，「N ▾」一位数宽 40、两位数宽 48。 */
const base: Omit<TabMetrics, 'available' | 'tags'> = {
  fixed: 100,
  gap: 4,
  add: 24,
  count: (hidden) => (hidden >= 10 ? 48 : 40),
};

describe('页签栏放得下几个标签页签', () => {
  it('都放得下时全部显示（最后一格是「+」）', () => {
    // 100 + 3 × (40 + 4) + 24 = 256
    expect(fitTabs({ ...base, available: 256, tags: [40, 40, 40] })).toBe(3);
    expect(fitTabs({ ...base, available: 300, tags: [40, 40, 40] })).toBe(3);
    expect(fitTabs({ ...base, available: 300, tags: [] })).toBe(0);
  });

  it('放不下时按「N ▾」的实际宽度从右往左收起，刚好放下为止', () => {
    // 收起一个：100 + 2 × 44 + 40 = 228
    expect(fitTabs({ ...base, available: 250, tags: [40, 40, 40] })).toBe(2);
    expect(fitTabs({ ...base, available: 228, tags: [40, 40, 40] })).toBe(2);
    // 收起两个：100 + 44 + 40 = 184
    expect(fitTabs({ ...base, available: 226, tags: [40, 40, 40] })).toBe(1);
    expect(fitTabs({ ...base, available: 184, tags: [40, 40, 40] })).toBe(1);
    expect(fitTabs({ ...base, available: 150, tags: [40, 40, 40] })).toBe(0);
  });

  it('不为别的写法预留空位：只差一个页签时，收起的只有放不下的那一个', () => {
    // 此前最后一格按 4 个字（约 88）预留，320 的宽度只显示两个标签页签；现在按「1 ▾」的宽度算，只收起放不下的那一个。
    const tags = [44, 44, 44, 84];
    // 全部放下需要 100 + 4 + 4 + 4 + 44 × 3 + 84 + 4 + 24 = 356
    expect(fitTabs({ ...base, available: 320, tags })).toBe(3);
  });

  it('收起十个以上时按两位数的宽度算', () => {
    const tags = Array.from({ length: 12 }, () => 40);
    // 只放得下一个：100 + 44 + 48（「11 ▾」）= 192；按一位数算会是 184
    expect(fitTabs({ ...base, available: 190, tags })).toBe(0);
    expect(fitTabs({ ...base, available: 192, tags })).toBe(1);
  });
});
