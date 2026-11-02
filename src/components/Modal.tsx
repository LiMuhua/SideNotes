/**
 * 对话框与提示条。
 *
 * 焦点约束、Esc 关闭与点击背景关闭的行为沿用原型；
 * Esc 的层级处理在 `useKeyboard` 中统一安排，这里只处理本层。
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useToastContext } from '../hooks/useToast';

export interface ModalProps {
  title: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

/** 带焦点约束的对话框。 */
export function Modal({ title, className, children, footer, onClose }: ModalProps) {
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
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            data-action="close-modal"
            aria-label="关闭对话框"
            title="关闭对话框"
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
            title="取消"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="button danger"
            data-action=""
            aria-label={confirmLabel}
            title={confirmLabel}
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

/** 提示条区域。 */
export function ToastRegion() {
  const { items, dismiss } = useToastContext();
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <div key={item.id} className={item.error ? 'toast error' : 'toast'}>
          <Icon name={item.error ? 'alert' : 'check-circle'} />
          <span>{item.message}</span>
          {item.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                item.action?.run();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            data-action=""
            aria-label="关闭提示"
            title="关闭提示"
            onClick={() => dismiss(item.id)}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
