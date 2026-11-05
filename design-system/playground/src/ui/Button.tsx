/**
 * 按钮与图标按钮。
 *
 * 四种外观：主要（每个区域最多一个）、次要、幽灵（工具栏）、危险。
 * 图标按钮必须有名称（aria-label），悬停或聚焦时以工具提示显示名称与快捷键。
 * `force` 只用于组件页静态展示某个状态。
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx, useDirection } from './context';
import { Icon, type IconName } from './Icon';
import { Keys, Spinner } from './Misc';
import { Tooltip } from './Tooltip';
import type { Placement } from './layer';

export type ForcedState = 'hover' | 'active' | 'focus';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  trailingIcon?: IconName;
  loading?: boolean;
  /** 快捷键：开发者工作台方向直接显示在按钮上，其它方向写入 aria-keyshortcuts 与工具提示。 */
  shortcut?: string;
  force?: ForcedState;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailingIcon, loading = false, shortcut, force, className, children, disabled, ...rest },
  ref,
) {
  const direction = useDirection();
  const button = (
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
      {shortcut && direction.inlineShortcuts ? <Keys combo={shortcut} tone={variant === 'primary' ? 'accent' : 'default'} /> : null}
    </button>
  );
  return shortcut && !direction.inlineShortcuts && children ? (
    <Tooltip content={children} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** 按钮的名称，同时作为工具提示。 */
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary' | 'danger' | 'primary';
  /** 切换按钮的状态，如收藏、视图模式。 */
  pressed?: boolean;
  /** 图标在按下状态下填充（收藏星标）。 */
  fillWhenPressed?: boolean;
  force?: ForcedState;
  tooltip?: boolean;
  /** 工具提示的位置；竖排的图标栏中放在右侧。 */
  tooltipPlacement?: Placement;
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
    tooltip = true,
    tooltipPlacement = 'bottom',
    className,
    ...rest
  },
  ref,
) {
  const button = (
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
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut} placement={tooltipPlacement}>
      {button}
    </Tooltip>
  ) : (
    button
  );
});
