/**
 * 弹窗与气泡。
 *
 * 弹窗（模态）：打开时焦点移入（优先 data-autofocus 的元素），Tab 在弹窗内循环，
 * Esc 关闭，关闭后焦点回到打开前的位置；点遮罩关闭可以关掉（确认类弹窗应关掉）。
 * 气泡（非模态）：点触发按钮打开，焦点移入，Esc 或点到外部关闭。
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './context';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Layer, focusableIn, useAnchoredPosition, type Placement } from './layer';

/** 焦点陷阱：Tab 与 Shift+Tab 在容器内循环。 */
function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return;
  const elements = focusableIn(container);
  if (!elements.length) {
    event.preventDefault();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 标题前的图标（例如合并成一条）。 */
  icon?: IconName;
  /** 加在弹窗上的类名，用来调整个别弹窗的宽度与内容排版。 */
  className?: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** 确认类弹窗用 alertdialog，并且点遮罩不关闭。 */
  role?: 'dialog' | 'alertdialog';
  closeOnOverlay?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  icon,
  className,
  description,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  closeOnOverlay = role === 'dialog',
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement;
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? (panel.current ? focusableIn(panel.current)[0] : null);
    (target ?? panel.current)?.focus({ preventScroll: true });
    return () => {
      if (previous.current instanceof HTMLElement && previous.current.isConnected) previous.current.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <Layer>
      <div
        className="sn-dialog-overlay"
        onPointerDown={(event) => {
          if (closeOnOverlay && event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={panel}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx('sn-dialog', `is-${size}`, className)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
            trapTab(event, panel.current);
          }}
        >
          <header className="sn-dialog-header">
            <h2 id={titleId} className="sn-dialog-title">
              {icon ? <Icon name={icon} /> : null}
              {title}
            </h2>
            <IconButton icon="x" label="关闭" size="sm" onClick={onClose} />
          </header>
          {description ? (
            <p id={descriptionId} className="sn-dialog-description">
              {description}
            </p>
          ) : null}
          {children ? <div className="sn-dialog-body">{children}</div> : null}
          {footer ? <footer className="sn-dialog-footer">{footer}</footer> : null}
        </div>
      </div>
    </Layer>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 确认操作：焦点默认落在「取消」上，避免误按 Enter 执行危险操作。 */
export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} data-autofocus>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export interface PopoverProps {
  label: string;
  placement?: Placement;
  trigger: (props: {
    ref: (element: HTMLButtonElement | null) => void;
    'aria-haspopup': 'dialog';
    'aria-expanded': boolean;
    'aria-controls'?: string;
    onClick: () => void;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
}

export function Popover({ label, placement = 'bottom-start', trigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { style } = useAnchoredPosition(open, button, panel, placement, 6);

  const close = useCallback(
    (restore = true) => {
      setOpen(false);
      if (restore) button?.focus();
    },
    [button],
  );

  useEffect(() => {
    if (!open) return;
    const target = panel.current ? focusableIn(panel.current)[0] : null;
    (target ?? panel.current)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, close, button]);

  return (
    <>
      {trigger({
        ref: setButton,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        onClick: () => (open ? close() : setOpen(true)),
      })}
      {open ? (
        <Layer>
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            className="sn-popover"
            style={style}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              }
            }}
          >
            {children(() => close())}
          </div>
        </Layer>
      ) : null}
    </>
  );
}
