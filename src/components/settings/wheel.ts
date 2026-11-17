/**
 * 设置窗口的滚轮调整（与交互原型 settings.js 的 initializeWheel、wheelTarget 与 nudge 相同）。
 *
 * 指针停在滑块或数值框上转动滚轮：向上加、向下减，每一格一个步长，按住 Shift 为十个步长，结果限制在取值范围内。
 * 一次滚动手势只交给一个对象：手势开始时指针在控件上，由控件接管，页面不滚动；开始时在别处，整个手势都滚动页面，
 * 中途扫过滑块也不改值。停顿超过 400ms 算新的手势；触控板的小增量累计到约 30px 才算一格；禁用的控件不接管；
 * Ctrl + 滚轮留给缩放。
 *
 * 改值的方式与用户输入相同：写入数值并派发 input 事件，React 的 onChange 照常收到；滚轮停下 500ms 后，
 * 在控件上派发 `WHEEL_COMMIT` 事件，数值框、数字组合框与松开才保存的滑块（字号）据此提交。
 */

import { useEffect, type RefObject } from 'react';

/** 滚轮停下 500ms 后在控件上派发的提交事件。 */
export const WHEEL_COMMIT = 'sidenotes:wheel-commit';

/** 两次滚动之间超过这个间隔（毫秒）算新的手势。 */
const GESTURE_GAP = 400;
/** 触控板的小增量累计到这个距离（像素）算一格。 */
const PIXELS_PER_STEP = 30;
/** 滚轮停下多久（毫秒）后提交。 */
const COMMIT_DELAY = 500;

/** 滚轮的接管对象：滑块组（滑块与旁边的数值框）、数字组合框或独立的数值框。 */
function wheelTarget(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof Element)) return null;
  const range = target.closest('.settings-range');
  const combobox = target.closest('.settings-combobox');
  const control = range
    ? range.querySelector<HTMLInputElement>('input[type="range"]')
    : combobox
      ? combobox.querySelector<HTMLInputElement>('input')
      : target.closest<HTMLInputElement>('input[type="number"]');
  return control && !control.disabled ? control : null;
}

/** React 管理的输入框要经原生的 value 设置器写入，随后的 input 事件才会触发 onChange。 */
function writeValue(control: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

const commitTimers = new WeakMap<HTMLInputElement, number>();

/** 按步长加减并限制在取值范围内；步长取 data-wheel-step（组合框的滚轮步长），没有时取 step。 */
function nudge(control: HTMLInputElement, steps: number): void {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const step = Number(control.dataset.wheelStep || control.step) || 1;
  const current = Number(control.value);
  const base = Number.isFinite(current) ? current : minimum;
  const next = Math.max(minimum, Math.min(maximum, Number((base + steps * step).toFixed(6))));
  if (next === current) return;
  writeValue(control, String(next));
  window.clearTimeout(commitTimers.get(control));
  commitTimers.set(
    control,
    window.setTimeout(() => control.dispatchEvent(new CustomEvent(WHEEL_COMMIT, { detail: control.value })), COMMIT_DELAY),
  );
}

/** 在设置窗口的根元素上接管滚轮。 */
export function useSettingsWheel(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let owner: HTMLInputElement | null = null;
    let lastAt = 0;
    let carry = 0;
    const adjust = (event: WheelEvent): void => {
      if (event.ctrlKey) return;
      const now = Date.now();
      if (now - lastAt > GESTURE_GAP) {
        owner = wheelTarget(event.target);
        carry = 0;
      }
      lastAt = now;
      if (!owner || !owner.isConnected || owner.disabled) return;
      event.preventDefault();
      let steps = 0;
      if (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50) {
        steps = Math.sign(event.deltaY);
        carry = 0;
      } else {
        carry += event.deltaY;
        if (Math.abs(carry) >= PIXELS_PER_STEP) {
          steps = Math.trunc(carry / PIXELS_PER_STEP);
          carry -= steps * PIXELS_PER_STEP;
        }
      }
      if (steps) nudge(owner, -steps * (event.shiftKey ? 10 : 1));
    };
    node.addEventListener('wheel', adjust, { passive: false });
    return () => node.removeEventListener('wheel', adjust);
  }, [root]);
}

/** 控件订阅滚轮的提交事件；`commit` 收到滚轮停下时的数值。 */
export function useWheelCommit(control: RefObject<HTMLInputElement | null>, commit: (value: string) => void): void {
  useEffect(() => {
    const node = control.current;
    if (!node) return;
    const handle = (event: Event): void => commit(String((event as CustomEvent<string>).detail ?? node.value));
    node.addEventListener(WHEEL_COMMIT, handle);
    return () => node.removeEventListener(WHEEL_COMMIT, handle);
  });
}
