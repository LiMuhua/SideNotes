/**
 * 设置页通用控件。
 *
 * 每个控件的标签结构与类名逐一对应原型 settings.js 中的 row、group、help、
 * toggle、select、input、range 与 app.js 的 button 工厂函数，
 * 使 prototype.css 中的设置样式原样生效，桌面端不再另写一套外观。
 * 交互语义同样沿用原型：文本框在失焦或回车时提交，数值框越界时就近校正并提示。
 */

import { useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from '../Icon';
import { boundedNumber } from '../../core/settings';
import { useToast } from '../../hooks/useToast';
import type { Settings } from '../../core/types';

/** 保存设置的函数：成功返回 true，失败时调用方已提示。 */
export type SaveSettings = (patch: Partial<Settings>) => Promise<boolean>;

/** 拼接类名，忽略空值。 */
export function classes(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** 原型 button() 中只放图标、不追加文字的样式。 */
const ICON_ONLY_CLASSES = ['icon-button', 'tag-remove', 'tags-more', 'note-image-button'];

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  /** 可访问名称，同时作为悬停提示与按钮文字。 */
  label: string;
  icon?: IconName;
  /** 放在图标与文字之前的内容，对应原型中 prepend 的预览块。 */
  leading?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** 与原型 button()/action() 等价：图标在前、文字在后；纯图标按钮不显示文字。 */
export function ActionButton({ label, icon, leading, className = 'button secondary compact', ...rest }: ActionButtonProps) {
  const iconOnly = className.split(/\s+/).some((name) => ICON_ONLY_CLASSES.includes(name));
  return (
    <button type="button" className={className} data-action="" aria-label={label} title={label} {...rest}>
      {leading}
      {icon ? <Icon name={icon} /> : null}
      {iconOnly ? null : label}
    </button>
  );
}

/** 字段说明：悬停、聚焦或点击问号时显示，气泡限制在设置面板之内。 */
export function Help({ title, description }: { title: string; description: string }) {
  const id = `setting-help-${useId()}`;
  const [shown, setShown] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // 靠近面板边缘的问号会把气泡推出可视区，这里按面板边界平移回来。
  useLayoutEffect(() => {
    const message = bubble.current;
    if (!shown || !message) return;
    message.style.transform = '';
    const panel = holder.current?.closest('.settings-panel');
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    message.style.maxWidth = `${Math.max(100, bounds.width - 16)}px`;
    const rect = message.getBoundingClientRect();
    const offset = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
    if (offset) message.style.transform = `translateX(${offset}px)`;
  }, [shown]);

  return (
    <span
      ref={holder}
      className="settings-help"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => {
        if (document.activeElement !== trigger.current) setShown(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="settings-help-button"
        aria-label={`${title}说明`}
        aria-expanded={shown}
        aria-describedby={id}
        onClick={() => setShown(true)}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && shown) {
            event.preventDefault();
            event.stopPropagation();
            setShown(false);
          }
        }}
      >
        ?
      </button>
      <span ref={bubble} id={id} className="settings-help-text" role="tooltip" hidden={!shown}>
        {description}
      </span>
    </span>
  );
}

/** 统一标签与控件轨道的设置行。 */
export function Row({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={classes('settings-row setting-row setting-field', className)}>
      <div className="settings-row-info setting-copy">
        <span className="settings-row-label setting-label">{title}</span>
        {description ? <Help title={title} description={description} /> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

/** 带标题的设置卡。 */
export function Group({
  title,
  description,
  className,
  children,
}: {
  title?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={classes('settings-group settings-card settings-section', className)}>
      {title ? (
        <h4 className="settings-group-title settings-section-title">
          {title}
          {description ? <Help title={title} description={description} /> : null}
        </h4>
      ) : null}
      {children}
    </section>
  );
}

/** 开关。 */
export function Toggle({
  label,
  checked,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="toggle settings-toggle"
      aria-label={label}
      title={title}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** 下拉框。 */
export function SelectField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [string | number, string]>;
  value: string | number;
  onChange: (next: string) => void;
}) {
  return (
    <select
      className="form-control"
      aria-label={label}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(([optionValue, text]) => (
        <option key={String(optionValue)} value={String(optionValue)}>
          {text}
        </option>
      ))}
    </select>
  );
}

/**
 * 文本或数字输入框：失焦或回车时提交，提交失败恢复为已保存的值。
 *
 * 编辑中的内容记为草稿；未编辑时直接显示已保存的值，
 * 因此其它窗口修改了同一设置时，输入框会随之更新。
 */
export function TextField({
  label,
  value,
  placeholder,
  type = 'text',
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  disabled?: boolean;
  onCommit: (next: string) => boolean | Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    const next = draft.trim();
    if (next !== value) await onCommit(next);
    // 成功时显示保存后的值，失败时回到原值。
    setDraft(null);
  };

  return (
    <input
      className="form-control"
      type={type}
      value={draft ?? value}
      min={min}
      max={max}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void commit();
      }}
    />
  );
}

/** 滑块与直接输入共享边界的数值控件。 */
export function RangeField({
  label,
  settingKey,
  value,
  min,
  max,
  step,
  unit,
  onSave,
}: {
  label: string;
  settingKey: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 带前导空格的单位，例如 " px"，提示文案与原型一致。 */
  unit: string;
  onSave: (next: number) => Promise<boolean>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  // 回车或 Esc 已处理时，随后的失焦不再重复提交。
  const skipBlur = useRef(false);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    const raw = draft;
    const next = boundedNumber(raw, min, max, step);
    if (next === null) {
      setDraft(null);
      toast(`请输入 ${min} 至 ${max} 的数值`, null, true);
      return;
    }
    const saved = next === value || (await onSave(next));
    setDraft(null);
    if (saved && next !== Number(raw)) toast(`已调整为 ${next}${unit}（${min}–${max}，步进 ${step}）`);
  };

  return (
    <div className="settings-range range-control">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = boundedNumber(event.target.value, min, max, step);
          if (next !== null && next !== value) void onSave(next);
        }}
      />
      <span className="settings-range-number">
        <input
          className="settings-range-value"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          data-setting-key={settingKey}
          aria-label={`${label}数值`}
          title={`输入 ${min}–${max}，步进 ${step}`}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.currentTarget.select()}
          onBlur={() => {
            if (skipBlur.current) skipBlur.current = false;
            else void commit();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') setDraft(null);
            else void commit();
            skipBlur.current = true;
            event.currentTarget.blur();
          }}
        />
        <span className="settings-range-unit">{unit.trim()}</span>
      </span>
    </div>
  );
}

/** 格式化完整本地时间，与原型 fullTime 一致。 */
export function fullTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '尚无';
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
