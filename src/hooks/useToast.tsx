/**
 * 提示条（toast）。
 *
 * 延续原型行为：最多同时保留三条，可附带撤销操作；
 * 带操作的提示保留 9 秒，普通提示 6 秒。
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createId } from '../core/notes';
import type { ToastAction, ToastItem } from '../core/types';

/** 显示提示的函数签名。 */
export type ShowToast = (message: string, action?: ToastAction | null, error?: boolean) => void;

interface ToastContextValue {
  items: ToastItem[];
  show: ShowToast;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 提供提示条能力。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, action = null, error = false) => {
      const id = createId();
      const item: ToastItem = { id, message, error };
      if (action) item.action = action;
      setItems((current) => {
        // 超过三条时丢弃最早的一条，与原型的队列长度一致。
        const next = current.concat(item);
        return next.length > 3 ? next.slice(next.length - 3) : next;
      });
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), action ? 9000 : 6000),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ items, show, dismiss }), [items, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** 读取提示条上下文。 */
export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用');
  return context;
}

/** 取得显示提示的函数。 */
export function useToast(): ShowToast {
  return useToastContext().show;
}
