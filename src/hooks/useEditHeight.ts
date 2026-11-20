/**
 * 侧栏卡片进入、退出编辑时高度平滑地变过去（第七轮反馈 5：长记录进入编辑时卡片一下子撑高、出现编辑区的滚动条）。
 *
 * 卡片的高度由内容决定，进入编辑时预览换成编辑区，退出时换回来，高度在一次提交里跳到新的值。这里先把卡片按变之前的
 * 高度固定住（溢出的部分裁掉），等新的内容排好（编辑区是在提交之后的 effect 里建出来的，等两帧），量出新的高度，
 * 再从旧的高度动画到新的高度，结束后去掉固定的高度，交还给内容。
 *
 * 变之前的高度来自 ResizeObserver：它在排版之后、绘制之前回调，状态变化的那次提交里记着的还是变之前的高度；
 * 动画中途又切换时，记着的是当时画出来的高度，从那里接着变。
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { RESIZE_EASING_CSS, resizeDuration } from '../core/motion';

/** 卡片最近一次排版后的高度（边框盒）。 */
const heights = new WeakMap<Element, number>();
let observer: ResizeObserver | null = null;

function watch(element: Element): () => void {
  if (typeof ResizeObserver !== 'function') return () => {};
  observer ??= new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const box = entry.borderBoxSize?.[0];
      heights.set(entry.target, box ? box.blockSize : entry.target.getBoundingClientRect().height);
    });
  });
  observer.observe(element);
  return () => observer?.unobserve(element);
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 动画的标识：同一张卡片又切换时先停下上一次的。 */
const ANIMATION_ID = 'sn-edit-height';
/** 各卡片的切换次数：上一次的动画收尾时，卡片已经开始了新的一次，就不动新一次设下的样式。 */
const rounds = new WeakMap<Element, number>();

/** `editing` 变化时，`ref` 指向的卡片高度从旧值平滑地变到新值（时长随距离加长、减速的缓动，见 core/motion）。 */
export function useEditHeight(ref: RefObject<HTMLElement | null>, editing: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    return element ? watch(element) : undefined;
  }, [ref]);

  const previous = useRef(editing);
  useLayoutEffect(() => {
    if (previous.current === editing) return;
    previous.current = editing;
    const element = ref.current;
    if (!element || reducedMotion() || typeof element.animate !== 'function') return;
    const from = heights.get(element) ?? element.getBoundingClientRect().height;
    const round = (rounds.get(element) ?? 0) + 1;
    rounds.set(element, round);
    element.getAnimations().forEach((animation) => {
      if (animation.id === ANIMATION_ID) animation.cancel();
    });
    // 先按旧的高度固定住，新的内容排好之前看不出跳动。预览的卡片有最大高度（正文按设置截断），变化期间不受它限制。
    element.style.height = `${from}px`;
    element.style.maxHeight = 'none';
    element.style.overflow = 'hidden';
    const release = (): void => {
      element.style.height = '';
      element.style.maxHeight = '';
      element.style.overflow = '';
    };
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        element.style.height = '';
        element.style.maxHeight = '';
        const to = element.getBoundingClientRect().height;
        if (Math.abs(to - from) < 2) {
          release();
          return;
        }
        element.style.maxHeight = 'none';
        const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration: resizeDuration(to - from),
          easing: RESIZE_EASING_CSS,
        });
        animation.id = ANIMATION_ID;
        // 动画期间裁掉溢出的部分；结束后交还给内容（被下一次切换取消时由下一次接着管）。
        const done = (): void => {
          if (rounds.get(element) !== round) return;
          element.style.maxHeight = '';
          element.style.overflow = '';
        };
        animation.finished.then(done, done);
      });
    });
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        release();
      }
    };
  }, [ref, editing]);
}
