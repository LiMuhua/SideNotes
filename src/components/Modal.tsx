/**
 * 对话框与提示条。
 *
 * 焦点约束、Esc 关闭与点击背景关闭的行为沿用原型；
 * Esc 的层级处理在 `useKeyboard` 中统一安排，这里只处理本层。
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { TOAST_DURATION, useToastContext } from '../hooks/useToast';
import type { ToastItem } from '../core/types';

export interface ModalProps {
  title: string;
  /** 标题前的图标（样式沿用原型的 .modal-header h2 .icon）。 */
  icon?: IconName;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

/** 带焦点约束的对话框。 */
export function Modal({ title, icon, className, children, footer, onClose }: ModalProps) {
  const modal = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('has-modal');
    // 打开后把焦点交给第一个可操作控件。
    const timer = window.setTimeout(() => {
      const focusable = modal.current?.querySelector<HTMLElement>(
        '[autofocus],input:not([type="hidden"]),textarea,select,button,[contenteditable="true"]',
      );
      (focusable ?? modal.current)?.focus({ preventScroll: true });
    }, 30);

    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('has-modal');
      const target = previousFocus.current;
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    };
  }, []);

  // Tab 在对话框内循环，不跑到背后的列表上。
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !modal.current) return;
    const controls = Array.from(
      modal.current.querySelectorAll<HTMLElement>(
        'button,a[href],input,textarea,select,[tabindex="0"],[contenteditable="true"]',
      ),
    ).filter((node) => !(node as HTMLButtonElement).disabled && !node.hidden);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={modal}
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="modal-header">
          <h2 id={titleId}>
            {icon ? <Icon name={icon} /> : null}
            {title}
          </h2>
          <button
            type="button"
            className="icon-button"
            data-action="close-modal"
            aria-label="关闭对话框"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer === null ? null : <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export interface ConfirmProps {
  title: string;
  description: string;
  confirmLabel?: string;
  /** 返回 false 表示操作未完成，保留对话框。 */
  onConfirm: () => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
}

/** 二次确认对话框。 */
export function ConfirmDialog({ title, description, confirmLabel = '确认', onConfirm, onCancel }: ConfirmProps) {
  // 确认操作通常要异步写库，进行中忽略重复点击，避免同一操作执行两次。
  const pending = useRef(false);
  return (
    <Modal
      title={title}
      className="confirm-modal"
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            className="button secondary"
            data-action="close-modal"
            aria-label="取消"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="button danger"
            data-action=""
            aria-label={confirmLabel}
            onClick={() => {
              if (pending.current) return;
              pending.current = true;
              void Promise.resolve(onConfirm())
                .then((result) => {
                  if (result !== false) onCancel();
                })
                .finally(() => {
                  pending.current = false;
                });
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-description">{description}</p>
    </Modal>
  );
}

/**
 * 一条提示：停留 6 秒，带操作的 9 秒；指针停在提示条上或焦点在提示条内时暂停计时，离开后接着计时（至少再停 1 秒）。
 */
function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const remaining = useRef<number>(item.actions.length ? TOAST_DURATION.action : TOAST_DURATION.plain);
  const started = useRef(0);
  const timer = useRef(0);

  const resume = useCallback(() => {
    window.clearTimeout(timer.current);
    started.current = Date.now();
    timer.current = window.setTimeout(() => onDismiss(item.id), remaining.current);
  }, [item.id, onDismiss]);

  const pause = useCallback(() => {
    window.clearTimeout(timer.current);
    remaining.current = Math.max(1000, remaining.current - (Date.now() - started.current));
  }, []);

  useEffect(() => {
    resume();
    return () => window.clearTimeout(timer.current);
  }, [resume]);

  return (
    <div
      ref={node}
      className={item.error ? 'toast error' : 'toast'}
      role={item.error ? 'alert' : undefined}
      onPointerEnter={pause}
      onPointerLeave={() => {
        if (!node.current?.contains(document.activeElement)) resume();
      }}
      onFocus={pause}
      onBlur={(event) => {
        if (!node.current?.contains(event.relatedTarget as Node | null) && !node.current?.matches(':hover')) resume();
      }}
    >
      <Icon name={item.error ? 'alert' : 'check-circle'} />
      <span>{item.message}</span>
      {item.actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="toast-action"
          onClick={() => {
            action.run();
            onDismiss(item.id);
          }}
        >
          {action.label}
        </button>
      ))}
      <button type="button" className="icon-button" data-action="" aria-label="关闭提示" onClick={() => onDismiss(item.id)}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/**
 * 提示区域：每个窗口一个，放在窗口的面板里（侧栏的随侧栏收起）。
 * `className` 区分窗口：速记浮窗是 capture-toast-region，设置窗口是 settings-toast-region（位置见 theme.css）。
 */
export function ToastRegion({ className }: { className?: string }) {
  const { items, dismiss } = useToastContext();
  return (
    <div className={className ? `toast-region ${className}` : 'toast-region'} role="status" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}
