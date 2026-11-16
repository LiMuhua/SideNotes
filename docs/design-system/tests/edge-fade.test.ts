/**
 * 列表上下边缘的渐隐（第八次反馈，playground/src/ui/edgeFade.ts，与交互原型 app.js 的 edgeMask 相同）：
 *
 * - 卡片滚到列表的上边或下边时，在 size 内从不透明变到全透明，不再被一刀截断；
 * - 只在那一侧还有内容时出现：列表在最顶部时第一张卡片完整，滚到底时最后一张完整；
 * - 刚开始滚动时，渐隐的一段随滚动距离从可见区之外移进来，由浅到深；
 * - 不在边缘的卡片不加遮罩。
 */

import { describe, expect, it } from 'vitest';
import { edgeMask } from '../playground/src/ui/edgeFade';

/** 可见区高 400，渐隐 16。 */
const VIEW = 400;
const SIZE = 16;

describe('列表边缘的渐隐', () => {
  it('不在边缘的卡片、列表在最顶部或最底部时不加遮罩', () => {
    expect(edgeMask(100, 50, VIEW, SIZE, SIZE, SIZE)).toBe('');
    // 列表在最顶部：第一张卡片贴着上边也不变淡
    expect(edgeMask(0, 50, VIEW, 0, SIZE, SIZE)).toBe('');
    // 滚到底：最后一张卡片贴着下边也不变淡
    expect(edgeMask(350, 50, VIEW, SIZE, 0, SIZE)).toBe('');
  });

  it('上面还有内容时，卡片在上边处从全透明渐变到不透明', () => {
    // 卡片上边在可见区之上 20：可见区上边落在卡片里 20 处，从那里往下 16 变到不透明
    expect(edgeMask(-20, 60, VIEW, SIZE, SIZE, SIZE)).toBe('linear-gradient(to bottom, transparent 20px, #000 36px)');
    // 刚滚了 6：渐隐的一段还有一部分在可见区之外，上边处不是全透明
    expect(edgeMask(-6, 60, VIEW, 6, SIZE, SIZE)).toBe('linear-gradient(to bottom, transparent -4px, #000 12px)');
  });

  it('下面还有内容时，卡片在下边处从不透明渐变到全透明', () => {
    // 卡片上边在可见区 380 处，可见区下边落在卡片里 20 处
    expect(edgeMask(380, 60, VIEW, 0, SIZE, SIZE)).toBe('linear-gradient(to bottom, #000 0px, #000 4px, transparent 20px)');
  });

  it('很高的卡片同时跨过上下两边时两段都有', () => {
    expect(edgeMask(-10, 500, VIEW, SIZE, SIZE, SIZE)).toBe('linear-gradient(to bottom, transparent 10px, #000 26px, #000 394px, transparent 410px)');
  });
});
