import { describe, expect, it } from 'vitest';
import { RESIZE_EASING_CSS, resizeDuration } from './motion';

describe('编辑时伸缩的时长', () => {
  it('随变化的距离加长，有上下限', () => {
    expect(resizeDuration(10)).toBe(240);
    expect(resizeDuration(100)).toBe(260);
    expect(resizeDuration(-100)).toBe(260);
    expect(resizeDuration(2000)).toBe(420);
  });

  it('打字时用短一档的时长', () => {
    expect(resizeDuration(20, 'typing')).toBe(140);
    expect(resizeDuration(100, 'typing')).toBe(170);
    expect(resizeDuration(1000, 'typing')).toBe(240);
  });

  it('缓动写成 CSS 的三次贝塞尔', () => {
    expect(RESIZE_EASING_CSS).toBe('cubic-bezier(0.2, 0, 0, 1)');
  });
});
