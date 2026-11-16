/**
 * 选择类控件：复选框、开关、单选组与分段控件。
 *
 * 复选框与单选使用原生 input，保留系统的键盘与辅助技术支持，只替换外观；
 * 开关是 role="switch" 的按钮；分段控件是单选组，方向键切换并立即生效。
 */

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './context';
import { Icon, type IconName } from './Icon';
import type { ForcedState } from './Button';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** 部分选中：批量选择时用。 */
  indeterminate?: boolean;
  disabled?: boolean;
  force?: ForcedState;
  'aria-label'?: string;
}

export function Checkbox({ checked, onChange, label, indeterminate = false, disabled, force, ...rest }: CheckboxProps) {
  return (
    <label className={cx('sn-check', disabled && 'is-disabled')} data-force={force}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(element) => {
          if (element) element.indeterminate = indeterminate;
        }}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={rest['aria-label']}
      />
      <span className="sn-check-box" aria-hidden="true">
        <Icon name={indeterminate ? 'minus' : 'check'} />
      </span>
      {label ? <span className="sn-check-label">{label}</span> : null}
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** 不显示文字标签，名称只给辅助技术。 */
  hideLabel?: boolean;
  disabled?: boolean;
  force?: ForcedState;
}

export function Switch({ checked, onChange, label, hideLabel = false, disabled, force }: SwitchProps) {
  const id = useId();
  return (
    <span className={cx('sn-switch-row', disabled && 'is-disabled')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        className="sn-switch"
        data-force={force}
        onClick={() => onChange(!checked)}
      >
        <span className="sn-switch-knob" />
      </button>
      {hideLabel ? null : (
        <label htmlFor={id} className="sn-switch-label">
          {label}
        </label>
      )}
    </span>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function RadioGroup<T extends string>({ label, value, options, onChange, orientation = 'vertical' }: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx('sn-radio-group', `is-${orientation}`)}>
      <legend className="sn-radio-legend">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={cx('sn-radio', option.disabled && 'is-disabled')}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span className="sn-radio-dot" aria-hidden="true" />
          <span className="sn-radio-text">
            <span className="sn-radio-label">{option.label}</span>
            {option.description ? <span className="sn-radio-description">{option.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** 只显示图标，文字作为名称与工具提示。 */
  iconOnly?: boolean;
}

/** 分段控件：radiogroup，左右方向键切换（Home、End 到两端）。 */
export function Segmented<T extends string>({ label, value, options, onChange, size = 'md', iconOnly = false }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((option) => !option.disabled);

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = enabled.findIndex((option) => option.value === value);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    onChange(enabled[next].value);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <div ref={group} className={cx('sn-segmented', `is-${size}`)} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            className="sn-segment"
            onClick={() => onChange(option.value)}
            onKeyDown={move}
          >
            {option.icon ? <Icon name={option.icon} /> : null}
            {iconOnly ? null : <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
