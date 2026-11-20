/**
 * 磨砂玻璃随背后的明暗调整着色（T131，2026-11-19 第六轮反馈：透明度再加大一点，对齐 Glance 的效果）。
 *
 * 令牌里块的底色（--sn-color-card）按最坏情况取：玻璃叠在纯黑或纯白上，弱化文字仍达到 4.5:1，所以偏浓。
 * Glance 按背后的明暗与杂乱程度实时调磨砂程度；这里同样按后端量出的背后明暗（模糊后亮度的第 5 与第 95 百分位，
 * glass.rs 的 Tone），用同一条 4.5:1 的规则算出文字仍够清楚时底色最淡能到多少，背后柔和时玻璃更通透，背后又亮又杂时
 * 回到令牌的浓度。结果是令牌底色透明度的倍数，写在根节点的 --glass-tint-scale 上（window.css 用 color-mix 调淡）。
 */

/** 后端量出的背后明暗：相对亮度（0–1）的第 5 与第 95 百分位。 */
export interface GlassTone {
  low: number;
  high: number;
}

/** 颜色：sRGB 分量 0–255，透明度 0–1。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 最淡也留着令牌底色的这么多（Glance 最通透时的着色约为最磨砂时的五分之一：深色 0.16 ÷ 0.84）。 */
export const TINT_FLOOR = 0.2;
/** 文字与底色的最低对比度（WCAG 2.2 正文，与令牌检查 tokens.test.ts 相同）。 */
const MIN_CONTRAST = 4.5;

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** 相对亮度为 `light` 的灰（sRGB 分量）。 */
function grayOf(light: number): Rgba {
  const value = light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055;
  const channel = Math.min(255, Math.max(0, value * 255));
  return { r: channel, g: channel, b: channel, a: 1 };
}

/** `top` 按自己的透明度叠在不透明的 `bottom` 上（与浏览器一样在 sRGB 里混合）。 */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (a: number, b: number): number => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * 底色透明度的倍数（TINT_FLOOR 到 1）：底色按这个倍数调淡之后，`texts` 中的每种文字叠在玻璃上，背后从最暗到最亮
 * 都不低于 4.5:1。令牌的浓度本身也达不到时（背后比纯黑纯白的检查还极端，不会发生）取 1。
 */
export function tintScale(tone: GlassTone, card: Rgba, texts: readonly Rgba[]): number {
  if (!(card.a > 0) || texts.length === 0) return 1;
  const backs = [grayOf(clamp01(tone.low)), grayOf(clamp01(tone.high))];
  const readable = (scale: number): boolean => {
    const tint = { ...card, a: card.a * scale };
    return backs.every((back) => {
      const glass = over(tint, back);
      return texts.every((text) => contrast(over(text, glass), glass) >= MIN_CONTRAST);
    });
  };
  if (!readable(1)) return 1;
  let [low, high] = [TINT_FLOOR, 1];
  if (readable(low)) return low;
  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;
    if (readable(middle)) high = middle;
    else low = middle;
  }
  return Math.round(high * 1000) / 1000;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** 浏览器算好的颜色（getComputedStyle 的 rgb()/rgba()）拆成分量；认不出时为 null。 */
export function parseColor(text: string): Rgba | null {
  const match = text.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isFinite(value))) return null;
  const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
  return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
}

/** 令牌的颜色（任意 CSS 写法）交给浏览器换算成分量；没有页面或认不出时为 null。 */
export function cssColor(value: string): Rgba | null {
  if (typeof document === 'undefined' || !value.trim()) return null;
  const probe = document.createElement('span');
  probe.style.color = value.trim();
  if (!probe.style.color) return null;
  document.body.append(probe);
  const color = window.getComputedStyle(probe).color;
  probe.remove();
  return parseColor(color);
}
