/**
 * 设置页通用控件。
 *
 * 每个控件的标签结构与类名逐一对应原型 settings.js 中的 row、group、help、
 * toggle、select、input、range 与 app.js 的 button 工厂函数，
 * 使 prototype.css 中的设置样式原样生效，桌面端不再另写一套外观。
 * 交互语义同样沿用原型：文本框在失焦或回车时提交，数值框越界时就近校正并提示。
 */

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from '../Icon';
import { Floating } from '../Floating';
import { useWheelCommit } from './wheel';
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

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** 可访问名称，同时作为按钮文字。 */
  label: string;
  icon?: IconName;
  /** 放在图标与文字之前的内容，对应原型中 prepend 的预览块。 */
  leading?: ReactNode;
  /** 给出时代替图标与文字作为按钮的内容（例如带预览的选项卡片），名称仍写在 aria-label 中。 */
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 与原型 button()/action() 等价：图标在前、文字在后；纯图标按钮不显示文字。
 * 按钮不加悬停提示，名称只写在 aria-label 中（DS-8）。
 */
export function ActionButton({ label, icon, leading, children, className = 'button secondary compact', ...rest }: ActionButtonProps) {
  const iconOnly = className.split(/\s+/).some((name) => ICON_ONLY_CLASSES.includes(name));
  return (
    <button type="button" className={className} data-action="" aria-label={label} {...rest}>
      {children ?? (
        <>
          {leading}
          {icon ? <Icon name={icon} /> : null}
          {iconOnly ? null : label}
        </>
      )}
    </button>
  );
}

/**
 * 字段说明：悬停、聚焦或点击问号时显示（原型 settings.js 的 help）。
 * 说明挂在 body 下的浮层中（Floating），不被设置页的滚动区域裁剪，放不下时翻到上方。
 */
export function Help({ title, description }: { title: string; description: string }) {
  const id = `setting-help-${useId()}`;
  const [shown, setShown] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <span
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
        aria-describedby={shown ? id : undefined}
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
      <Floating anchor={trigger} open={shown} options={{ placement: 'bottom-start' }} id={id} role="tooltip" className="settings-help-text settings-floating">
        {description}
      </Floating>
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

/**
 * 下拉框（原型 settings.js 的 select）：按钮写出当前项与箭头，列表挂在 body 下的浮层中，与按钮同宽，放不下时翻到上方。
 * 点击或按 ↓、↑、Enter、空格展开；展开后方向键与 Home、End 移动，Enter 或空格选用，Esc 只收起列表（不关闭设置窗口），
 * Tab 或失焦收起。选项上按下鼠标不夺走焦点。
 */
export function SelectField({
  label,
  options,
  value,
  className,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<readonly [string | number, string]>;
  value: string | number;
  className?: string;
  onChange: (next: string) => void;
}) {
  const listId = `select-list-${useId()}`;
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const current = String(value);
  const currentIndex = options.findIndex(([optionValue]) => String(optionValue) === current);

  // 键盘移到的一项滚进列表的可视范围。
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const expand = (): void => {
    setOpen(true);
    setActive(Math.max(0, currentIndex));
  };
  const collapse = (focus: boolean): void => {
    setOpen(false);
    setActive(-1);
    if (focus) button.current?.focus();
  };
  const choose = (next: string): void => {
    collapse(true);
    if (next !== current) onChange(next);
  };
  const move = (index: number): void => setActive(Math.max(0, Math.min(options.length - 1, index)));

  return (
    <>
      <button
        ref={button}
        type="button"
        className={classes('select-box', className)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        value={current}
        onClick={() => (open ? collapse(false) : expand())}
        onBlur={() => collapse(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            collapse(true);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) expand();
            else move(active + (event.key === 'ArrowDown' ? 1 : -1));
          } else if ((event.key === 'Home' || event.key === 'End') && open) {
            event.preventDefault();
            move(event.key === 'Home' ? 0 : options.length - 1);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open && options[active]) choose(String(options[active][0]));
            else expand();
          } else if (event.key === 'Tab' && open) {
            collapse(false);
          }
        }}
      >
        <span className="select-box-value">{currentIndex >= 0 ? options[currentIndex][1] : ''}</span>
        <Icon name="chevron-down" />
      </button>
      <Floating
        anchor={button}
        open={open}
        options={{ placement: 'bottom-start', offset: 4, matchWidth: true, scroll: true }}
        id={listId}
        role="listbox"
        aria-label={label}
        className="select-box-list settings-floating"
      >
        {options.map(([optionValue, text], index) => {
          const selected = String(optionValue) === current;
          return (
            <div
              key={String(optionValue)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={selected}
              className={classes('select-box-option', selected && 'is-selected', index === active && 'is-active')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(String(optionValue))}
            >
              <span className="select-box-check">{selected ? <Icon name="check" /> : null}</span>
              <span className="select-box-label">{text}</span>
            </div>
          );
        })}
      </Floating>
    </>
  );
}

/**
 * 数字组合框（原型 settings.js 的 combobox）：直接输入数值，也可以从列表中选常用值；回车或失焦提交，Esc 还原。
 *
 * 结构是 `span.settings-combobox-wrap > span.settings-combobox > input.settings-combobox-input + 箭头按钮`，后面跟单位。
 * 点输入框只全选、不展开；Alt+↓ 或点箭头展开常用值（列表挂在浮层中，与组合框同宽）。越界时就近校正并提示
 * 「已调整为 N 单位」，无法识别时提示范围并还原。滚轮调整见设置窗口的滚轮处理（`data-wheel-step`）。
 */
export function NumberCombobox({
  label,
  value,
  options,
  min,
  max,
  step = 1,
  wheelStep,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  options: ReadonlyArray<readonly [number, string]>;
  min: number;
  max: number;
  step?: number;
  /** 滚轮每一格的步长，默认等于 step。 */
  wheelStep?: number;
  unit: string;
  onCommit: (next: number) => boolean | Promise<boolean>;
}) {
  const toast = useToast();
  const listId = `combobox-list-${useId()}`;
  const field = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const commit = async (raw: string): Promise<void> => {
    const next = boundedNumber(raw, min, max, step);
    if (next === null) {
      setDraft(null);
      toast(`请输入 ${min} 至 ${max} 的数值`, null, true);
      return;
    }
    if (next !== value && !(await onCommit(next))) {
      setDraft(null);
      return;
    }
    if (next !== Number(raw)) toast(`已调整为 ${next} ${unit}`);
    setDraft(null);
  };
  // 滚轮调整：途中只改显示的数值，停下 500ms 后提交（见 wheel.ts）。
  useWheelCommit(input, (raw) => void commit(raw));

  return (
    <span className="settings-combobox-wrap">
      <span ref={field} className="settings-combobox">
        <input
          ref={input}
          className="settings-combobox-input"
          type="number"
          min={min}
          max={max}
          step={wheelStep ?? step}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          data-wheel-step={wheelStep ?? step}
          value={draft ?? String(value)}
          onClick={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            setOpen(false);
            if (skipBlur.current) skipBlur.current = false;
            else if (draft !== null) void commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && event.altKey) {
              event.preventDefault();
              setOpen(true);
              return;
            }
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape' && open) {
              setOpen(false);
              return;
            }
            if (event.key === 'Escape') setDraft(null);
            else void commit(event.currentTarget.value);
            setOpen(false);
            skipBlur.current = true;
            event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="settings-combobox-toggle"
          tabIndex={-1}
          aria-label={`${label}常用值`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((shown) => !shown);
            input.current?.focus();
          }}
        >
          <Icon name="chevron-down" />
        </button>
      </span>
      <span className="settings-unit">{unit}</span>
      <Floating
        anchor={field}
        open={open}
        options={{ placement: 'bottom-start', offset: 4, matchWidth: true, scroll: true }}
        id={listId}
        role="listbox"
        aria-label={`${label}常用值`}
        className="select-box-list settings-floating"
      >
        {options.map(([optionValue, text]) => {
          const selected = optionValue === value;
          return (
            <div
              key={optionValue}
              role="option"
              aria-selected={selected}
              className={classes('select-box-option', selected && 'is-selected')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen(false);
                void commit(String(optionValue));
                input.current?.focus();
              }}
            >
              <span className="select-box-check">{selected ? <Icon name="check" /> : null}</span>
              <span className="select-box-label">{text}</span>
            </div>
          );
        })}
      </Floating>
    </span>
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
  const field = useRef<HTMLInputElement>(null);

  const commitValue = async (raw: string): Promise<void> => {
    const next = raw.trim();
    if (next !== value) await onCommit(next);
    // 成功时显示保存后的值，失败时回到原值。
    setDraft(null);
  };
  const commit = async (): Promise<void> => {
    if (draft !== null) await commitValue(draft);
  };
  // 数值框的滚轮调整：停下 500ms 后提交（见 wheel.ts）。
  useWheelCommit(field, (raw) => void commitValue(raw));

  return (
    <input
      ref={field}
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

/**
 * 滑块与直接输入共享边界的数值控件。
 *
 * `commitOnRelease` 为真时拖动滑块只更新显示的数值，松开鼠标或按键后才保存：
 * 字号等设置每次变化都会让所有窗口重新排版，拖动途中逐值保存会让界面不停闪动。
 */
export function RangeField({
  label,
  settingKey,
  value,
  min,
  max,
  step,
  unit,
  commitOnRelease = false,
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
  /** 松开滑块后才保存（见上）。 */
  commitOnRelease?: boolean;
  onSave: (next: number) => Promise<boolean>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  // 回车或 Esc 已处理时，随后的失焦不再重复提交。
  const skipBlur = useRef(false);
  // 拖动中尚未保存的滑块值；松开时的事件可能早于这次状态更新的重新渲染，同时记在 ref 中读取。
  const [sliding, setSliding] = useState<number | null>(null);
  const slidingRef = useRef<number | null>(null);
  const rangeInput = useRef<HTMLInputElement>(null);

  const release = (): void => {
    const next = slidingRef.current;
    slidingRef.current = null;
    setSliding(null);
    if (next !== null && next !== value) void onSave(next);
  };
  // 滚轮调整字号这类松开才保存的滑块：滚轮停下 500ms 后保存（见 wheel.ts）；其余滑块随 onChange 已经保存。
  useWheelCommit(rangeInput, () => {
    if (commitOnRelease) release();
  });

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
        ref={rangeInput}
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliding ?? value}
        aria-label={label}
        onChange={(event) => {
          const next = boundedNumber(event.target.value, min, max, step);
          if (next === null) return;
          if (commitOnRelease) {
            slidingRef.current = next;
            setSliding(next);
          } else if (next !== value) {
            void onSave(next);
          }
        }}
        onPointerUp={commitOnRelease ? release : undefined}
        onPointerCancel={commitOnRelease ? release : undefined}
        onKeyUp={commitOnRelease ? release : undefined}
        onBlur={commitOnRelease ? release : undefined}
      />
      <span className="settings-range-number">
        <input
          className="settings-range-value"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(sliding ?? value)}
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
