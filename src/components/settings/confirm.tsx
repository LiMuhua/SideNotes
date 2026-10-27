/**
 * 设置页内的二次确认。
 *
 * 对应原型 settings.js 的 confirmTrash：确认层叠加在设置对话框之上，
 * 保留原设置页的分类、搜索与滚动位置；取消后焦点回到原操作。
 */

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { IconName } from '../Icon';
import { ActionButton } from './controls';

/** 一次确认请求。 */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  icon: IconName;
  /** 不可恢复的操作使用危险样式。 */
  danger?: boolean;
  /** 返回 false 表示操作未完成，保留确认层并提示重试。 */
  run: () => Promise<boolean>;
}

const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => {});

export const ConfirmProvider = ConfirmContext.Provider;

/** 取得打开确认层的函数。 */
export function useConfirm(): (request: ConfirmRequest) => void {
  return useContext(ConfirmContext);
}

/** 确认层。 */
export function ConfirmOverlay({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const headingId = `trash-confirm-title-${useId()}`;
  const messageId = `trash-confirm-message-${useId()}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);

  const run = async (): Promise<void> => {
    setBusy(true);
    if (await request.run()) {
      onClose();
      return;
    }
    setBusy(false);
    setError('操作未完成，记录仍保留，请重试。');
  };

  return (
    <div
      className="settings-confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        // 焦点只在确认层的三个按钮之间循环。
        const controls = [closeButton.current, cancel.current, confirm.current].filter(
          (node): node is HTMLButtonElement => Boolean(node && !node.disabled),
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section
        className="settings-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={messageId}
      >
        <header className="settings-confirm-header">
          <h3 id={headingId}>{request.title}</h3>
          <ActionButton ref={closeButton} label="取消确认" icon="x" className="icon-button" onClick={onClose} />
        </header>
        <p className="settings-confirm-message" id={messageId}>
          {request.message}
        </p>
        <p className="settings-confirm-error" role="alert" hidden={!error}>
          {error}
        </p>
        <footer className="settings-confirm-actions">
          <ActionButton ref={cancel} label="取消" onClick={onClose} />
          <ActionButton
            ref={confirm}
            label={request.confirmLabel}
            icon={request.icon}
            className={request.danger ? 'button danger compact' : 'button primary compact'}
            disabled={busy}
            onClick={() => void run()}
          />
        </footer>
      </section>
    </div>
  );
}
