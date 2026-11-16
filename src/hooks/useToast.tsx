/**
 * 提示条（toast）。
 *
 * 每个窗口有自己的提示区域（侧栏、速记浮窗、设置窗口各一个 ToastProvider），提示只出现在操作所在的窗口里。
 * 最多同时保留三条，可附带一个或几个操作（如「撤销」「查看」）；带操作的提示保留 9 秒，普通提示 6 秒；
 * 指针停在提示条上或焦点在提示条内时暂停计时。同一个 key 的提示只留最新的一条（连续收起/展开全部）。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createId } from '../core/notes';
import type { ToastAction, ToastItem } from '../core/types';

/** 显示提示的函数签名。 */
export type ShowToast = (message: string, action?: ToastAction | ToastAction[] | null, error?: boolean, key?: string) => void;

interface ToastContextValue {
  items: ToastItem[];
  show: ShowToast;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 普通提示与带操作的提示停留的时长（毫秒）。 */
export const TOAST_DURATION = { plain: 6000, action: 9000 } as const;

/** 提供提示条能力。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ShowToast>((message, action = null, error = false, key) => {
    const actions = Array.isArray(action) ? action : action ? [action] : [];
    const item: ToastItem = { id: createId(), message, error, actions };
    if (key) item.key = key;
    setItems((current) => {
      // 同一个 key 只留最新的一条；超过三条时丢弃最早的一条，与原型的队列长度一致。
      const next = current.filter((entry) => !key || entry.key !== key).concat(item);
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  }, []);

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
