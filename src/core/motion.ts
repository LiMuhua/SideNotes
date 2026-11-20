/**
 * 编辑时窗口与卡片伸缩的时长与缓动（第八轮反馈 7：原来按主题的令牌，终端只有 160 毫秒，一下子就变过去，显得生涩）。
 *
 * 时长随变化的距离加长：只差一两行时短一点，展开一大段时长一点，同样的速度感；上下限让最短的也看得出过程、最长的
 * 不拖沓。缓动是先快后慢的减速曲线，结尾慢慢停稳，不回弹（窗口的大小回弹会看到边框来回抖）。打字时内容一行一行地
 * 增加，用短一档的时长，跟得上输入。
 */

export type ResizeMotion = 'state' | 'typing';

/** 先快后慢、结尾停稳的三次贝塞尔曲线（cubic-bezier 的四个参数）。 */
export const RESIZE_EASING: [number, number, number, number] = [0.2, 0, 0, 1];

/** RESIZE_EASING 写成 CSS 的缓动函数。 */
export const RESIZE_EASING_CSS = `cubic-bezier(${RESIZE_EASING.join(', ')})`;

/** 每类伸缩的时长：基础值、每像素加多少、上下限（毫秒）。 */
const TIMING: Record<ResizeMotion, { base: number; perPixel: number; min: number; max: number }> = {
  state: { base: 200, perPixel: 0.6, min: 240, max: 420 },
  typing: { base: 120, perPixel: 0.5, min: 140, max: 240 },
};

/** 变化 `distance`（页面像素，取绝对值）时伸缩的时长（毫秒）。 */
export function resizeDuration(distance: number, motion: ResizeMotion = 'state'): number {
  const { base, perPixel, min, max } = TIMING[motion];
  return Math.round(Math.max(min, Math.min(max, base + Math.abs(distance) * perPixel)));
}
