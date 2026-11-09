/**
 * 滚轮调整数值：指针停在滑块或数值框上转动滚轮，向上加、向下减，每一格一个步长，按住 Shift 为十个步长。
 *
 * 一次滚动手势只交给一个对象：手势开始时指针下是带 data-wheel-step 的控件，就由它接管并阻止页面滚动；
 * 开始时在别处，整个手势都交给页面。这样滚动设置页时指针扫过滑块，不会误改设置（与浏览器嵌套滚动的锁定方式相同）。
 * 停顿超过 GESTURE_GAP 毫秒算作新的手势。Ctrl + 滚轮留给缩放，不处理。
 */

import { useEffect, useRef, type RefObject } from 'react';

/** 两次滚轮事件相隔超过这个时长（毫秒），算作新的手势。 */
const GESTURE_GAP = 400;
/** 累计滚动这么多像素算一格：鼠标滚轮一格通常是 100，触控板每次的增量很小，要累计起来。 */
const PX_PER_STEP = 30;
/** 按行、按页滚动时换算成像素。 */
const PX_PER_LINE = 16;
const PX_PER_PAGE = 400;

/** 接管滚轮的控件带这个属性，值为空字符串即可。 */
const WHEEL_ATTRIBUTE = 'data-wheel-step';

let owner: Element | 'page' | null = null;
let lastWheel = 0;
let watching = false;

/** 在捕获阶段记下每个手势的归属：先于控件自己的监听执行。 */
function watchGestures() {
  if (watching) return;
  watching = true;
  document.addEventListener(
    'wheel',
    (event) => {
      const now = performance.now();
      if (now - lastWheel > GESTURE_GAP) {
        owner = (event.target instanceof Element ? event.target.closest(`[${WHEEL_ATTRIBUTE}]`) : null) ?? 'page';
      }
      lastWheel = now;
    },
    { capture: true, passive: true },
  );
}

/**
 * 给元素加上滚轮调整。onStep 收到方向（向上滚为 1）与倍数（按住 Shift 为 10）。
 * 元素本身要带 data-wheel-step 属性；enabled 为 false 时滚轮照常滚动页面。
 */
export function useWheelStep(ref: RefObject<HTMLElement | null>, onStep: (direction: 1 | -1, multiplier: number) => void, enabled = true) {
  const handler = useRef(onStep);
  useEffect(() => {
    handler.current = onStep;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    watchGestures();
    let total = 0;
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || owner !== element) return;
      const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      const delta = raw * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? PX_PER_LINE : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? PX_PER_PAGE : 1);
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      if (now - last > GESTURE_GAP || Math.sign(delta) !== Math.sign(total)) total = 0;
      last = now;
      total += delta;
      if (Math.abs(total) < PX_PER_STEP) return;
      total = 0;
      handler.current(delta < 0 ? 1 : -1, event.shiftKey ? 10 : 1);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref, enabled]);
}
