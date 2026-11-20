import { describe, expect, it } from 'vitest';
import { parseColor, tintScale, TINT_FLOOR } from './glassTone';

// 磨砂玻璃深色的令牌：块的底色与三种文字（tokens/glass.css）。
const DARK_CARD = { r: 18, g: 22, b: 24, a: 0.8 };
const DARK_TEXTS = [
  { r: 255, g: 255, b: 255, a: 0.95 },
  { r: 255, g: 255, b: 255, a: 0.8 },
  { r: 255, g: 255, b: 255, a: 0.7 },
];
// 浅色。
const LIGHT_CARD = { r: 255, g: 255, b: 255, a: 0.78 };
const LIGHT_TEXTS = [
  { r: 0, g: 0, b: 0, a: 0.88 },
  { r: 0, g: 0, b: 0, a: 0.72 },
  { r: 0, g: 0, b: 0, a: 0.62 },
];

describe('磨砂玻璃按背后的明暗调着色', () => {
  it('深色玻璃背后很暗时淡到下限', () => {
    expect(tintScale({ low: 0.005, high: 0.03 }, DARK_CARD, DARK_TEXTS)).toBe(TINT_FLOOR);
  });

  it('深色玻璃背后很亮时回到令牌的浓度附近', () => {
    expect(tintScale({ low: 0.6, high: 0.95 }, DARK_CARD, DARK_TEXTS)).toBeGreaterThan(0.8);
  });

  it('浅色玻璃背后很亮时淡到下限，很暗时变浓', () => {
    expect(tintScale({ low: 0.7, high: 0.95 }, LIGHT_CARD, LIGHT_TEXTS)).toBe(TINT_FLOOR);
    expect(tintScale({ low: 0.01, high: 0.05 }, LIGHT_CARD, LIGHT_TEXTS)).toBeGreaterThan(0.8);
  });

  it('背后明暗相差越大，着色越浓', () => {
    const calm = tintScale({ low: 0.05, high: 0.15 }, DARK_CARD, DARK_TEXTS);
    const busy = tintScale({ low: 0.05, high: 0.5 }, DARK_CARD, DARK_TEXTS);
    expect(busy).toBeGreaterThan(calm);
  });

  it('令牌的浓度在纯黑纯白上都够清楚，所以结果不超过 1', () => {
    expect(tintScale({ low: 0, high: 1 }, DARK_CARD, DARK_TEXTS)).toBeLessThanOrEqual(1);
    expect(tintScale({ low: 0, high: 1 }, LIGHT_CARD, LIGHT_TEXTS)).toBeLessThanOrEqual(1);
  });

  it('读得出浏览器算好的颜色', () => {
    expect(parseColor('rgba(18, 22, 24, 0.8)')).toEqual({ r: 18, g: 22, b: 24, a: 0.8 });
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')).toBeNull();
  });
});
