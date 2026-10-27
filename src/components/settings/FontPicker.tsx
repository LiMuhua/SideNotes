/**
 * 字体组合框。
 *
 * 对应原型 settings.js 的 fontPicker：展开即列出全部候选，可直接输入字体名；
 * 系统字体需用户主动点击「读取系统字体…」授权后才读取，并缓存字体名称。
 */

import { useEffect, useRef, useState } from 'react';
import { ActionButton, classes } from './controls';

/** 常见字体，与原型列表一致。 */
const FONTS = [
  '系统默认',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Segoe UI',
  'SimSun',
  'KaiTi',
  'Arial',
  'Consolas',
  'Noto Sans CJK SC',
];

const FONTS_KEY = 'sidenotes.fonts.v1';
const DEFAULT_LABEL = '系统默认';

/* ==================== 系统字体缓存 ==================== */

/** 已读取的系统字体，所有组合框实例共享，与原型的模块级缓存一致。 */
let installedFonts: string[] = readCachedFonts();

function readCachedFonts(): string[] {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(FONTS_KEY) ?? 'null');
    const families = (cached as { families?: unknown } | null)?.families;
    if (!Array.isArray(families)) return [];
    const valid = families.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '' && value.length < 121,
    );
    return [...new Set(valid)].slice(0, 4000);
  } catch {
    return [];
  }
}

function fontsLoaded(): boolean {
  return installedFonts.length > 0;
}

/** 通过 Local Font Access 读取字体族名称并缓存，返回字体族数量。 */
async function loadSystemFonts(): Promise<number> {
  const query = (window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> })
    .queryLocalFonts;
  if (typeof query !== 'function') throw new Error('unsupported');
  const fonts = await query.call(window);
  installedFonts = [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  try {
    localStorage.setItem(FONTS_KEY, JSON.stringify({ families: installedFonts }));
  } catch {
    /* 本次读取的列表仍然可用。 */
  }
  return installedFonts.length;
}

function supportsFontQuery(): boolean {
  return typeof (window as Window & { queryLocalFonts?: unknown }).queryLocalFonts === 'function';
}

/* ==================== 组合框 ==================== */

interface Choice {
  label: string;
  kind: 'font' | 'permission' | 'custom';
  family: string;
}

export function FontPicker({ value, onChoose }: { value: string; onChoose: (family: string) => Promise<boolean> }) {
  const saved = value || DEFAULT_LABEL;
  // 输入中的内容记为草稿；未输入时显示已保存的字体。
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [reading, setReading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const families = [...new Set([...FONTS, ...installedFonts, value].filter(Boolean))];
  const choices: Choice[] = families.map((family) => ({ label: family, kind: 'font', family }));
  if (!fontsLoaded()) {
    choices.push({ label: reading ? '正在读取系统字体…' : '读取系统字体…', kind: 'permission', family: '' });
  }
  const typed = text.trim();
  if (
    typed &&
    typed !== DEFAULT_LABEL &&
    !families.some((family) => family.toLocaleLowerCase() === typed.toLocaleLowerCase())
  ) {
    choices.push({ label: `使用“${typed}”`, kind: 'custom', family: typed });
  }

  // 键盘切换候选时让当前项保持可见。
  useEffect(() => {
    if (active < 0) return;
    list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = (): void => {
    setOpen(false);
    setActive(-1);
  };

  const choose = async (family: string): Promise<void> => {
    const next = family === DEFAULT_LABEL ? '' : family.trim().slice(0, 120);
    if (!(await onChoose(next))) return;
    setDraft(null);
    close();
    input.current?.focus();
  };

  const readFonts = async (): Promise<void> => {
    if (reading || fontsLoaded()) return;
    if (!supportsFontQuery()) {
      setFeedback('当前环境不支持读取字体，可输入字体名称并回车。');
      return;
    }
    setReading(true);
    setFeedback('正在读取系统字体…');
    try {
      setFeedback(`已读取 ${await loadSystemFonts()} 个字体族`);
    } catch {
      setFeedback('字体权限未开启；可重试，或输入字体名并回车。');
    } finally {
      setReading(false);
    }
  };

  const pick = (choice: Choice): void => {
    if (choice.kind === 'permission') void readFonts();
    else void choose(choice.family);
  };

  return (
    <div
      ref={picker}
      className="font-combobox"
      onBlur={() => {
        // 等焦点落定后再判断是否离开整个组合框。
        window.setTimeout(() => {
          if (picker.current?.contains(document.activeElement)) return;
          setDraft(null);
          close();
        }, 0);
      }}
    >
      <div className="font-combobox-field">
        <input
          ref={input}
          className="form-control"
          type="text"
          autoComplete="off"
          value={text}
          placeholder="选择或输入字体"
          aria-label="记录字体"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="settings-font-options"
          aria-activedescendant={open && active >= 0 ? `settings-font-option-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const next = active + (event.key === 'ArrowDown' ? 1 : -1);
              setActive((next + choices.length) % choices.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const current = open && active >= 0 ? choices[active] : undefined;
              if (current) pick(current);
              else void choose(text || DEFAULT_LABEL);
            }
          }}
        />
        <ActionButton
          label="展开字体列表"
          icon="chevron-down"
          className="font-combobox-toggle icon-button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) close();
            else setOpen(true);
            input.current?.focus();
          }}
        />
      </div>
      <div
        ref={list}
        className="font-combobox-list"
        id="settings-font-options"
        role="listbox"
        aria-label="字体候选"
        hidden={!open}
      >
        {choices.map((choice, index) => (
          <ActionButton
            key={`${choice.kind}-${choice.label}`}
            label={choice.label}
            className={classes(
              'font-combobox-option',
              choice.kind === 'custom' && 'font-custom-option',
              choice.kind === 'permission' && 'font-permission-option',
              choice.label === saved && 'is-selected',
              index === active && 'is-active',
            )}
            id={`settings-font-option-${index}`}
            tabIndex={-1}
            role="option"
            aria-selected={choice.label === text}
            disabled={choice.kind === 'permission' && reading}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(choice)}
          />
        ))}
      </div>
      <div className="font-combobox-status" aria-live="polite">
        {feedback}
      </div>
    </div>
  );
}
