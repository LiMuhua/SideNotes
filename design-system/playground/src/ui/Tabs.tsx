/**
 * 页签与提示条。
 *
 * 页签按 WAI-ARIA 页签模式：左右方向键切换并立即显示（自动激活），Home 与 End 到两端，
 * 只有当前页签在 Tab 顺序中。
 * 提示条在窗口顶部正中弹出（沿用现有应用的默认位置与反色样式），4 秒后消失，
 * 带操作（如「撤销」）时停留 6 秒；指针停在提示条上时暂停计时。
 */

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from './context';
import { Icon, type IconName } from './Icon';
import { Layer } from './layer';

export interface TabSpec<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  count?: number;
}

export interface TabsProps<T extends string> {
  label: string;
  value: T;
  tabs: ReadonlyArray<TabSpec<T>>;
  onChange: (value: T) => void;
  /** 页签与面板的 id 前缀，面板用 `tabPanelId` 取得对应 id。 */
  idBase: string;
  size?: 'sm' | 'md';
}

export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const tabPanelId = (base: string, value: string) => `${base}-panel-${value}`;

export function Tabs<T extends string>({ label, value, tabs, onChange, idBase, size = 'md' }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.value === value);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].value);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div ref={list} role="tablist" aria-label={label} className={cx('sn-tabs', `is-${size}`)}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            id={tabId(idBase, tab.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idBase, tab.value)}
            tabIndex={selected ? 0 : -1}
            className="sn-tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={move}
          >
            {tab.icon ? <Icon name={tab.icon} /> : null}
            <span>{tab.label}</span>
            {tab.count !== undefined ? <span className="sn-tab-count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div id={tabPanelId(idBase, value)} role="tabpanel" aria-labelledby={tabId(idBase, value)} tabIndex={0} className={cx('sn-tab-panel', className)}>
      {children}
    </div>
  );
}

/** 生成一组页签的 id 前缀。 */
export function useTabIds(): string {
  return useId().replace(/:/g, '');
}

/* ==================== 提示条 ==================== */

export interface ToastOptions {
  message: string;
  tone?: 'neutral' | 'success' | 'danger';
  action?: { label: string; run: () => void };
}

interface ToastEntry extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

export function useToast(): (options: ToastOptions) => void {
  return useContext(ToastContext);
}

const TONE_ICONS: Record<NonNullable<ToastOptions['tone']>, IconName> = {
  neutral: 'info',
  success: 'check-circle',
  danger: 'alert',
};

let toastSequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const schedule = useCallback(
    (toast: ToastEntry) => {
      window.clearTimeout(timers.current.get(toast.id));
      timers.current.set(toast.id, window.setTimeout(() => dismiss(toast.id), toast.action ? 6000 : 4000));
    },
    [dismiss],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      toastSequence += 1;
      const toast = { ...options, id: toastSequence };
      // 同时最多保留三条，最新的在最上面。
      setToasts((current) => [toast, ...current].slice(0, 3));
      schedule(toast);
    },
    [schedule],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Layer>
        <div className="sn-toast-region" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cx('sn-toast', toast.tone && toast.tone !== 'neutral' && `is-${toast.tone}`)}
              role={toast.tone === 'danger' ? 'alert' : undefined}
              onPointerEnter={() => window.clearTimeout(timers.current.get(toast.id))}
              onPointerLeave={() => schedule(toast)}
            >
              <Icon name={TONE_ICONS[toast.tone ?? 'neutral']} />
              <span className="sn-toast-message">{toast.message}</span>
              {toast.action ? (
                <button
                  type="button"
                  className="sn-toast-action"
                  onClick={() => {
                    toast.action?.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button type="button" className="sn-toast-close" aria-label="关闭提示" onClick={() => dismiss(toast.id)}>
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>
      </Layer>
    </ToastContext.Provider>
  );
}
