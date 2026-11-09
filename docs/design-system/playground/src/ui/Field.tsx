/**
 * 输入类控件：文本框、搜索框、多行文本框与带标签的表单行。
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './context';
import { Icon } from './Icon';
import { Keys } from './Misc';
import type { ForcedState } from './Button';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  force?: ForcedState;
  size?: never;
  inputSize?: 'sm' | 'md' | 'lg';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, force, inputSize = 'md', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx('sn-input', `is-${inputSize}`, invalid && 'is-invalid', className)}
      aria-invalid={invalid || undefined}
      data-force={force}
      {...rest}
    />
  );
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /** 聚焦的快捷键提示，输入框为空时显示在右侧。 */
  shortcut?: string;
  inputSize?: 'sm' | 'md' | 'lg';
  force?: ForcedState;
}

/** 搜索框：放大镜、清空按钮与快捷键提示；Esc 先清空内容。 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, shortcut, inputSize = 'md', force, className, onKeyDown, ...rest },
  ref,
) {
  return (
    <div className={cx('sn-search', `is-${inputSize}`, className)} data-force={force}>
      <Icon name="search" />
      <input
        ref={ref}
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            event.stopPropagation();
            onValueChange('');
          }
          onKeyDown?.(event);
        }}
        {...rest}
      />
      {value ? (
        <button type="button" className="sn-search-clear" aria-label="清空搜索" onClick={() => onValueChange('')}>
          <Icon name="x" />
        </button>
      ) : shortcut ? (
        <Keys combo={shortcut} />
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** 阅读字体（文本片段）或代码字体。 */
  font?: 'ui' | 'reading' | 'code';
  force?: ForcedState;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, font = 'ui', force, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cx('sn-textarea', `is-font-${font}`, invalid && 'is-invalid', className)}
      aria-invalid={invalid || undefined}
      data-force={force}
      {...rest}
    />
  );
});

export interface FieldProps {
  label: string;
  /** 说明文字，关联到控件的 aria-describedby。 */
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}

/** 表单行：标签在上，说明或错误在下。 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const describedBy = error || hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('sn-field', className)}>
      <label className="sn-field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy })}
      {error ? (
        <p id={describedBy} className="sn-field-error" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="sn-field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
