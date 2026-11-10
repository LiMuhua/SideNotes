/**
 * 按钮与图标按钮。
 *
 * 四种外观：主要（每个区域最多一个）、次要、幽灵（工具栏）、危险。
 * 图标按钮必须有名称（aria-label），不加悬停提示：悬停说明只跟问号绑定（HelpTip，本次提出）。
 * `force` 只用于组件页静态展示某个状态。
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx, useSurface } from './context';
import { Icon, type IconName } from './Icon';
import { Keys, Spinner } from './Misc';

export type ForcedState = 'hover' | 'active' | 'focus';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  /** 快捷键：终端主题直接显示在按钮上，其它主题只写入 aria-keyshortcuts。 */
  shortcut?: string;
  force?: ForcedState;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailingIcon, loading = false, shortcut, force, className, children, disabled, ...rest },
  ref,
) {
  const surface = useSurface();
  return (
    <button
      ref={ref}
      type="button"
      className={cx('sn-button', `is-${variant}`, `is-${size}`, loading && 'is-loading', className)}
      data-force={force}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={shortcut}
      {...rest}
    >
      {loading ? <Spinner label="处理中" /> : icon ? <Icon name={icon} /> : null}
      {children ? <span className="sn-button-label">{children}</span> : null}
      {trailingIcon ? <Icon name={trailingIcon} /> : null}
      {shortcut && surface.inlineShortcuts ? <Keys combo={shortcut} tone={variant === 'primary' ? 'accent' : 'default'} /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** 按钮的名称（aria-label）。 */
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary' | 'danger' | 'primary';
  /** 切换按钮的状态，如收藏、视图模式。 */
  pressed?: boolean;
  /** 图标在按下状态下填充（收藏星标）。 */
  fillWhenPressed?: boolean;
  force?: ForcedState;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    shortcut,
    size = 'md',
    variant = 'ghost',
    pressed,
    fillWhenPressed = false,
    force,
    className,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('sn-icon-button', `is-${size}`, `is-${variant}`, className)}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      data-force={force}
      {...rest}
    >
      <Icon name={icon} filled={Boolean(pressed && fillWhenPressed)} />
    </button>
  );
});
