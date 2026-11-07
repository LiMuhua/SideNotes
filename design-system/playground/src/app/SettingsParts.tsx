/**
 * 设置窗口的排版部件：页面标题、分组卡片、紧凑的设置项、滑块行、数据行与数值输入。
 *
 * 布局沿用现有应用 0.7.3 的设置页（`src/components/settings/controls.tsx`）：相关的设置放在同一张卡片里，
 * 一行可以放几项，名称在控件左边，说明收在名称后的问号里；滑块独占一行，右侧是可以直接输入的数值与单位。
 */

import { useState, type ReactNode } from 'react';
import { cx } from '../ui/context';
import { useToast } from '../ui/Tabs';
import { HelpTip } from '../ui/Tooltip';

/** 设置页：标题在左，右侧可以放与整页有关的操作（例如「恢复默认」）。 */
export function SettingsPage({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="sn-set-page">
      <header className="sn-set-head">
        <h3 className="sn-set-title">{title}</h3>
        {aside ? <div className="sn-set-aside">{aside}</div> : null}
      </header>
      <div className="sn-set-cards">{children}</div>
    </div>
  );
}

/** 分组卡片：标题与问号说明在上，内容紧凑排列；half 为占半宽的卡片，两张并排。 */
export function SettingsCard({ title, help, half = false, className, children }: { title: string; help?: string; half?: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={cx('sn-set-card', half && 'is-half', className)}>
      <h4 className="sn-set-card-title">
        {title}
        {help ? <HelpTip label={title}>{help}</HelpTip> : null}
      </h4>
      {children}
    </section>
  );
}

/** 设置名称与问号说明。 */
export function SettingLabel({ label, help }: { label: string; help?: string }) {
  return (
    <span className="sn-set-label">
      {label}
      {help ? <HelpTip label={label}>{help}</HelpTip> : null}
    </span>
  );
}

/** 一项设置：名称在左，控件紧跟其后；grow 时控件占满剩余宽度。 */
export function Field({ label, help, grow = false, children }: { label: string; help?: string; grow?: boolean; children: ReactNode }) {
  return (
    <div className={cx('sn-set-field', grow && 'is-grow')}>
      <SettingLabel label={label} help={help} />
      <div className="sn-set-control">{children}</div>
    </div>
  );
}

/** 一行放几项设置，放不下时折行。 */
export function FieldRow({ children, spread = false }: { children: ReactNode; spread?: boolean }) {
  return <div className={cx('sn-set-row', spread && 'is-spread')}>{children}</div>;
}

/** 数据行：名称在左，取值或路径在中间，操作靠右（「数据与同步」页）。 */
export function DataRow({ label, help, value, children }: { label: string; help?: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sn-set-data">
      <SettingLabel label={label} help={help} />
      <div className="sn-set-data-value">{value}</div>
      {children ? <div className="sn-set-data-actions">{children}</div> : null}
    </div>
  );
}

/** 目录路径：等宽字体，过长时在中间省略，悬停显示全文。 */
export function PathText({ label, path }: { label: string; path: string }) {
  return (
    <code className="sn-set-path" aria-label={label} title={path}>
      {path}
    </code>
  );
}

export interface NumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** 超出范围时的提示。 */
  invalid?: string;
  onCommit: (value: number) => void;
}

/** 数值输入：回车或失去焦点时提交；不是范围内的整数时提示并恢复原值（与现有应用的 TextField 一致）。 */
export function NumberInput({ label, value, min, max, disabled, invalid, onCommit }: NumberInputProps) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const number = Number(text);
    setText(null);
    if (!Number.isInteger(number) || number < min || number > max) {
      toast({ message: invalid ?? `请输入 ${min} 至 ${max} 的整数`, tone: 'danger' });
      return;
    }
    if (number !== value) onCommit(number);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      className="sn-set-number"
      aria-label={label}
      disabled={disabled}
      value={text ?? String(value)}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape' && text !== null) {
          event.stopPropagation();
          setText(null);
        }
      }}
    />
  );
}

export interface RangeRowProps {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** 松开滑块后才提交（字号：拖动途中不重排整个界面）。 */
  commitOnRelease?: boolean;
  /** 与其他设置放在同一行（例如字号跟在字体之后），不独占一行。 */
  inline?: boolean;
  onCommit: (value: number) => void;
}

/** 滑块行：名称、占满一行的滑块、可以直接输入的数值与单位。 */
export function RangeRow({ label, help, value, min, max, step, unit, commitOnRelease = false, inline = false, onCommit }: RangeRowProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const release = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className={cx('sn-set-range', inline && 'is-inline')}>
      <SettingLabel label={label} help={help} />
      <input
        type="range"
        className="sn-range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (commitOnRelease) setDraft(next);
          else onCommit(next);
        }}
        onPointerUp={commitOnRelease ? release : undefined}
        onKeyUp={commitOnRelease ? release : undefined}
        onBlur={commitOnRelease ? release : undefined}
      />
      <span className="sn-set-range-value">
        <NumberInput
          label={`${label}（数值）`}
          value={shown}
          min={min}
          max={max}
          invalid={`${label}可设 ${min} 至 ${max}`}
          // 直接输入的数值按步长取整，与拖动滑块的结果一致。
          onCommit={(number) => onCommit(min + Math.round((number - min) / step) * step)}
        />
        <span className="sn-set-unit">{unit}</span>
      </span>
    </div>
  );
}
