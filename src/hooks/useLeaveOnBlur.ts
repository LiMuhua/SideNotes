import { useEffect } from 'react';
import * as bridge from '../core/bridge';
import { useLatest } from './useLatest';

/** 失焦后等多久再问后端是不是小窗：前台变化的事件经后端转一道，比页面的失焦晚到一点。 */
export const POPUP_GRACE = 150;
/** 小窗关掉后等多久看焦点回没回来：Ditto 先藏起小窗，再把前台交回来粘贴。 */
export const POPUP_RETURN = 300;

/**
 * 窗口失焦后判断是不是离开了（第十三轮反馈 1，技术决策第 72 条）：别的程序从这个窗口唤出的小窗（如 Ditto 的剪贴板历史）
 * 抢走焦点不算，小窗关掉、焦点回来后接着编辑，粘贴进来的内容落在原处；失焦不是因为小窗，或者小窗关掉后焦点去了别处，
 * 才调用 `onLeave`（保存编辑、收起侧栏等）。小窗由后端认出（popups），开着、关掉时发事件给这个窗口。
 */
export function useLeaveOnBlur(onLeave: () => void): void {
  const leave = useLatest(onLeave);
  useEffect(() => {
    let timer = 0;
    // 别的程序从这里唤出的小窗正开着。
    let popup = false;
    const check = (): void => {
      if (!popup && !document.hasFocus()) leave.current();
    };
    const onBlur = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void bridge.externalPopupOpen().then((open) => {
          popup = popup || open;
          check();
        });
      }, POPUP_GRACE);
    };
    const onFocus = (): void => {
      window.clearTimeout(timer);
      popup = false;
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    const unsubscribe = bridge.subscribeAll([
      bridge.onExternalPopup((open) => {
        popup = open;
        window.clearTimeout(timer);
        if (!open) timer = window.setTimeout(check, POPUP_RETURN);
      }),
    ]);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, [leave]);
}
