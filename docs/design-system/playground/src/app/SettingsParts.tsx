/**
 * 设置窗口的排版部件：页面标题、分组卡片、紧凑的设置项、滑块行、数据行与数值输入。
 *
 * 布局沿用现有应用 0.7.3 的设置页（`src/components/settings/controls.tsx`）：相关的设置放在同一张卡片里，
 * 一行可以放几项，名称在控件左边，说明收在名称后的问号里；滑块独占一行，右侧是可以直接输入的数值与单位。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../ui/context';
import { useToast } from '../ui/Tabs';
import { HelpTip } from '../ui/Tooltip';
import { useWheelStep } from '../ui/wheel';

/**
 * 设置页：标题在左，右侧可以放与整页有关的操作（例如「恢复默认」）。
 * 窗口高度固定（第四次反馈），内容少的页不显空：fill 让最后一块（回收站的列表）伸到底部。
 * 各页的标题都在最上面（第五次反馈：关于页不再上下居中）。
 */
export function SettingsPage({ title, aside, layout, children }: { title: string; aside?: ReactNode; layout?: 'fill'; children: ReactNode }) {
  return (
    <div className={cx('sn-set-page', layout && `is-${layout}`)}>
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

/** 一行放几项设置，按各自的宽度排开，放不下时折行；新的一行开头没有竖线（第六次反馈：不按列对齐）。 */
export function FieldRow({ children, spread = false }: { children: ReactNode; spread?: boolean }) {
  return <div className={cx('sn-set-row', spread && 'is-spread')}>{children}</div>;
}

/**
 * 目录路径：等宽字体，只占一行，放不下时末尾省略，不把别的控件挤乱；按钮紧跟在路径之后。
 * 放不下时悬停显示完整路径，双击复制完整路径（双击不选中文字）（本次提出）。
 */
export function PathText({ label, path }: { label: string; path: string }) {
  const toast = useToast();
  return (
    <code
      className="sn-set-path"
      aria-label={label}
      onMouseEnter={(event) => {
        const node = event.currentTarget;
        if (node.scrollWidth > node.clientWidth) node.title = path;
        else node.removeAttribute('title');
      }}
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      onDoubleClick={() => {
        if (!navigator.clipboard) {
          toast({ message: '无法复制目录路径', tone: 'danger' });
          return;
        }
        navigator.clipboard.writeText(path).then(
          () => toast({ message: '已复制目录路径', tone: 'success' }),
          () => toast({ message: '无法复制目录路径', tone: 'danger' }),
        );
      }}
    >
      {path}
    </code>
  );
}

export interface NumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** 滚轮每一格的增减量，默认 1。 */
  step?: number;
  disabled?: boolean;
  /** 超出范围时的提示。 */
  invalid?: string;
  onCommit: (value: number) => void;
  /** 滚轮改出的新值交给这里；不给时直接提交（滑块旁的数值框交给滑块，字号要等滚轮停下再应用）。 */
  onWheelValue?: (value: number) => void;
}

/**
 * 数值输入：回车或失去焦点时提交；不是范围内的整数时提示并恢复原值（与现有应用的 TextField 一致）。
 * 指针停在框上转动滚轮可以加减，结果限制在范围之内（见 ui/wheel.ts）。
 */
export function NumberInput({ label, value, min, max, step = 1, disabled, invalid, onCommit, onWheelValue }: NumberInputProps) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  useWheelStep(
    input,
    (direction, multiplier) => {
      const typed = text === null ? value : Number(text);
      const next = Math.min(max, Math.max(min, (Number.isFinite(typed) ? typed : value) + direction * step * multiplier));
      setText(null);
      if (onWheelValue) onWheelValue(next);
      else if (next !== value) onCommit(next);
    },
    !disabled,
  );
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
      ref={input}
      type="text"
      inputMode="numeric"
      className="sn-set-number"
      aria-label={label}
      disabled={disabled}
      data-wheel-step={disabled ? undefined : ''}
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
  /** 松开滑块后才提交（字号：拖动途中不重排整个界面）；滚轮调整时等滚轮停下再提交。 */
  commitOnRelease?: boolean;
  /** 与其他设置放在同一行（例如字号跟在字体之后），不独占一行。 */
  inline?: boolean;
  onCommit: (value: number) => void;
}

/** 连续几条滑块：名称、滑块与数值各占一列，滑块的起点对齐，不随名称长短参差。 */
export function RangeGroup({ children }: { children: ReactNode }) {
  return <div className="sn-set-ranges">{children}</div>;
}

/** 滚轮停下这么久（毫秒）之后，才提交松开后才应用的滑块。 */
const WHEEL_COMMIT_DELAY = 500;

/** 滑块行：名称、占满一行的滑块、可以直接输入的数值与单位；滑块与数值框都可以用滚轮调整。 */
export function RangeRow({ label, help, value, min, max, step, unit, commitOnRelease = false, inline = false, onCommit }: RangeRowProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const shown = draft ?? value;
  // 直接输入或滚轮改出的数值按步长取整，与拖动滑块的结果一致。
  const snap = (number: number) => Math.min(max, Math.max(min, min + Math.round((number - min) / step) * step));
  const release = () => {
    window.clearTimeout(timer.current);
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const wheelTo = (number: number) => {
    const next = snap(number);
    if (!commitOnRelease) {
      if (next !== value) onCommit(next);
      return;
    }
    setDraft(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDraft(null);
      if (next !== value) onCommit(next);
    }, WHEEL_COMMIT_DELAY);
  };
  useWheelStep(slider, (direction, multiplier) => wheelTo(shown + direction * step * multiplier));
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className={cx('sn-set-range', inline && 'is-inline')}>
      <SettingLabel label={label} help={help} />
      <input
        ref={slider}
        type="range"
        className="sn-range"
        aria-label={label}
        data-wheel-step=""
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
          step={step}
          invalid={`${label}可设 ${min} 至 ${max}`}
          onCommit={(number) => onCommit(snap(number))}
          onWheelValue={wheelTo}
        />
        <span className="sn-set-unit">{unit}</span>
      </span>
    </div>
  );
}
