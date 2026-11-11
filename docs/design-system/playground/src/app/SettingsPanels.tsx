/**
 * 设置：外观与交互、快捷键。
 *
 * 分组、设置项、说明文字、取值范围与默认值沿用现有应用 0.7.3（`AppearancePanel.tsx`、`ShortcutsPanel.tsx`、
 * `src/core/settings.ts`）。不同之处：「界面材质」改称「主题」，五个选项；字体增加「跟随主题」并作为默认值（见 adaptation.md）；
 * 「显示」中新增应用图标（本次提出，见 AppIconPicker.tsx）。
 * 明暗模式与主题在 Playground 中分别对应外壳的「明暗」与「主题」。
 */

import { useState, type KeyboardEvent } from 'react';
import { ANIM_DURATION_RANGE, CARD_HEIGHT_RANGE, FONT_SIZE_RANGE, HIDE_DELAY_RANGE, PAGE_SIZE_RANGE, WIDTH_RANGE } from '@/core/settings';
import type { EdgeSide, ToastPosition } from '@/core/types';
import { SURFACE_BY_ID, SURFACES } from '../surfaces';
import { useNotes } from '../model/notes';
import { usePlayground, useSystemDark, type ThemeMode } from '../shell/state';
import { Button, IconButton } from '../ui/Button';
import { Combobox } from '../ui/Combobox';
import { cx } from '../ui/context';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Tabs';
import { Switch } from '../ui/Toggle';
import { AppIconPicker } from './AppIconPicker';
import { Field, FieldRow, NumberInput, RangeGroup, RangeRow, SettingLabel, SettingsCard, SettingsPage } from './SettingsParts';
import { SHORTCUTS, type ShortcutSpec } from './shortcuts';

const THEMES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const EDGES: ReadonlyArray<{ value: EdgeSide; label: string }> = [
  { value: 'right', label: '屏幕右侧' },
  { value: 'left', label: '屏幕左侧' },
];

const TOAST_POSITIONS: ReadonlyArray<{ value: ToastPosition; label: string }> = [
  { value: 'top-center', label: '顶部正中' },
  { value: 'top-right', label: '右上角' },
  { value: 'bottom-center', label: '底部正中' },
];

/** 「移出后收起」的常用延迟（现有应用的 HIDE_DELAYS）。 */
const HIDE_DELAYS = ['300', '600', '1000'];

/** 字体候选：现有应用的常用字体，加上五套主题用到的字体；「跟随主题」在最前，「系统默认」在最后。 */
const FOLLOW_THEME = '跟随主题';
const SYSTEM_DEFAULT = '系统默认';
const FONTS = [
  'Maple Mono NF CN',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Segoe UI Variable Text',
  'Segoe UI',
  'SimSun',
  'KaiTi',
  'Georgia',
  'Inter',
  'Archivo',
  'Cascadia Mono',
  'Consolas',
  'Noto Sans CJK SC',
];

/** 字体组合框：输入时按内容筛选候选，回车选用当前候选；没有匹配的字体时不更改并提示（现有应用的 FontPicker）。 */
function FontPicker() {
  const { settings, updateSettings } = useNotes();
  const playground = usePlayground();
  const toast = useToast();
  const themeFont = SURFACE_BY_ID[playground.surface].name;
  const value = settings.fontFamily || FOLLOW_THEME;
  const options = [
    { value: FOLLOW_THEME, detail: themeFont },
    ...FONTS.map((font) => ({ value: font, style: { fontFamily: `"${font}"` } })),
    { value: SYSTEM_DEFAULT },
  ];
  return (
    <Combobox
      aria-label="字体"
      className="sn-set-font"
      filter
      value={value}
      options={options}
      onCommit={(next) => {
        if (!next) return false;
        const known = options.find((option) => option.value.toLocaleLowerCase() === next.toLocaleLowerCase());
        if (!known) {
          toast({ message: `没有找到字体「${next}」，请从列表中选择`, tone: 'danger' });
          return false;
        }
        updateSettings({ fontFamily: known.value === FOLLOW_THEME ? '' : known.value });
      }}
    />
  );
}

export function AppearancePanel() {
  const playground = usePlayground();
  const systemDark = useSystemDark();
  const toast = useToast();
  const { settings, updateSettings } = useNotes();
  // 关闭整理提醒时记住原来的阈值，再次打开时恢复（与现有应用一致）。
  const [tidyLimit, setTidyLimit] = useState(settings.tidyLimit || 50);
  // 编辑时滚到顶部（本次提出，默认打开）：Playground 的设置模型沿用现有应用，这一项只在页面上演示。
  const [scrollOnEdit, setScrollOnEdit] = useState(true);

  return (
    <SettingsPage title="外观与交互">
      <SettingsCard title="显示">
        <div className="sn-set-choices">
          <SettingLabel label="明暗模式" />
          <div className="sn-choice-grid" role="radiogroup" aria-label="明暗模式">
            {THEMES.map((theme) => (
              <label key={theme.value} className={cx('sn-choice', playground.theme === theme.value && 'is-selected')}>
                <input type="radio" name="sn-theme" className="sn-sr-only" checked={playground.theme === theme.value} onChange={() => playground.set({ theme: theme.value })} />
                <span className="sn-choice-preview" aria-hidden="true">
                  {theme.value === 'system' ? (
                    <>
                      <MiniSidebar surface={playground.surface} theme="light" />
                      <MiniSidebar surface={playground.surface} theme="dark" />
                    </>
                  ) : (
                    <MiniSidebar surface={playground.surface} theme={theme.value} />
                  )}
                </span>
                <span className="sn-choice-label">
                  {theme.label}
                  {theme.value === 'system' ? <span className="sn-choice-hint">当前为{systemDark ? '深色' : '浅色'}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <SettingLabel label="主题" />
          <div className="sn-choice-grid is-five" role="radiogroup" aria-label="主题">
            {SURFACES.map((surface) => (
              <label key={surface.id} className={cx('sn-choice', playground.surface === surface.id && 'is-selected')}>
                <input type="radio" name="sn-surface" className="sn-sr-only" checked={playground.surface === surface.id} onChange={() => playground.set({ surface: surface.id })} />
                <span className="sn-choice-preview" aria-hidden="true">
                  <MiniSidebar surface={surface.id} theme={playground.resolvedTheme} />
                </span>
                <span className="sn-choice-label">{surface.name}</span>
              </label>
            ))}
          </div>
          <SettingLabel label="应用图标" help="任务栏、托盘、桌面快捷方式与窗口标题区都换成选中的图标" />
          <AppIconPicker />
        </div>
      </SettingsCard>

      <SettingsCard title="文字">
        <FieldRow>
          <Field label="字体" help="默认跟随主题；选了具体字体时替换界面与正文的字体，标题与代码的字体仍跟随主题">
            <FontPicker />
          </Field>
          <RangeRow
            inline
            label="字号"
            value={settings.fontSize}
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            step={FONT_SIZE_RANGE.step}
            unit="px"
            commitOnRelease
            onCommit={(fontSize) => updateSettings({ fontSize })}
          />
        </FieldRow>
        <div className="sn-font-preview">
          <p>随手记下一句话，不打断手头的工作；支持 Markdown 与 #标签。</p>
          <p>The Quick Brown Fox Jumps Over the Lazy Dog.</p>
          <p>{'0123456789 · ¥$€ @#%&*?! · 2026-11-08 · -> => != <= >= === //'}</p>
        </div>
      </SettingsCard>

      <SettingsCard title="侧栏">
        <FieldRow>
          <Field label="显示位置">
            <Select aria-label="触发边缘" value={settings.edge} onChange={(edge) => updateSettings({ edge })} options={EDGES} />
          </Field>
          <Field label="移出后收起">
            <Combobox
              aria-label="移出后收起（毫秒）"
              className="is-number"
              inputMode="numeric"
              wheel={{ min: HIDE_DELAY_RANGE.min, max: HIDE_DELAY_RANGE.max, step: 100 }}
              value={String(settings.hideDelay)}
              options={HIDE_DELAYS.map((delay) => ({ value: delay }))}
              onCommit={(raw) => {
                const hideDelay = Number(raw.replace(/\s*(ms|毫秒)$/i, ''));
                if (!Number.isInteger(hideDelay) || hideDelay < HIDE_DELAY_RANGE.min || hideDelay > HIDE_DELAY_RANGE.max) {
                  toast({ message: `移出后收起可设 ${HIDE_DELAY_RANGE.min} 至 ${HIDE_DELAY_RANGE.max} 毫秒`, tone: 'danger' });
                  return false;
                }
                updateSettings({ hideDelay });
              }}
            />
            <span className="sn-set-unit">ms</span>
          </Field>
          <Field label="编辑时滚到顶部">
            <Switch label="编辑时滚到顶部" hideLabel checked={scrollOnEdit} onChange={setScrollOnEdit} />
          </Field>
        </FieldRow>
        <RangeGroup>
          <RangeRow label="宽度" help="随字号等比加宽，也可拖动侧栏边缘调整" value={settings.width} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} step={WIDTH_RANGE.step} unit="px" onCommit={(width) => updateSettings({ width })} />
          <RangeRow label="出入动画" value={settings.animDuration} min={ANIM_DURATION_RANGE.min} max={ANIM_DURATION_RANGE.max} step={ANIM_DURATION_RANGE.step} unit="ms" onCommit={(animDuration) => updateSettings({ animDuration })} />
          <RangeRow label="卡片高度" help="超出的部分渐隐；点「展开全文」或把卡片拖出侧栏，在窗口中查看全文" value={settings.cardMaxHeight} min={CARD_HEIGHT_RANGE.min} max={CARD_HEIGHT_RANGE.max} step={CARD_HEIGHT_RANGE.step} unit="px" onCommit={(cardMaxHeight) => updateSettings({ cardMaxHeight })} />
        </RangeGroup>
      </SettingsCard>

      <SettingsCard title="其它">
        <FieldRow>
          <Field label="列表加载" help="滚动到列表底部时按批加载">
            <Switch label="滚动按需加载" hideLabel checked={settings.lazyLoading} onChange={(lazyLoading) => updateSettings({ lazyLoading })} />
            <NumberInput
              label="每批加载记录数"
              value={settings.pageSize}
              min={PAGE_SIZE_RANGE.min}
              max={PAGE_SIZE_RANGE.max}
              disabled={!settings.lazyLoading}
              invalid={`每批加载 ${PAGE_SIZE_RANGE.min} 至 ${PAGE_SIZE_RANGE.max} 条`}
              onCommit={(pageSize) => updateSettings({ pageSize })}
            />
            <span className="sn-set-unit">条/批</span>
          </Field>
          <Field label="整理提醒" help="工作区记录超过这个数时提醒整理">
            <Switch label="启用工作区整理提醒" hideLabel checked={settings.tidyLimit > 0} onChange={(on) => updateSettings({ tidyLimit: on ? tidyLimit : 0 })} />
            <NumberInput
              label="工作区整理提醒阈值"
              value={settings.tidyLimit || tidyLimit}
              min={1}
              max={100000}
              disabled={settings.tidyLimit === 0}
              onCommit={(limit) => {
                setTidyLimit(limit);
                updateSettings({ tidyLimit: limit });
              }}
            />
            <span className="sn-set-unit">条</span>
          </Field>
          <Field label="通知位置">
            <Select aria-label="通知弹出位置" value={settings.toastPosition} onChange={(toastPosition) => updateSettings({ toastPosition })} options={TOAST_POSITIONS} />
          </Field>
        </FieldRow>
      </SettingsCard>
    </SettingsPage>
  );
}

/** 迷你侧栏：颜色全部来自所示主题与明暗模式的令牌。 */
function MiniSidebar({ surface, theme }: { surface: string; theme: 'light' | 'dark' }) {
  return (
    <span className="sn-mini" data-sn-surface={surface} data-sn-theme={theme}>
      <span className="sn-mini-panel">
        <span className="sn-mini-line is-title" />
        <span className="sn-mini-card is-active">
          <span className="sn-mini-line" />
          <span className="sn-mini-line is-short" />
        </span>
        <span className="sn-mini-card">
          <span className="sn-mini-line" />
          <span className="sn-mini-line is-accent" />
        </span>
      </span>
    </span>
  );
}

/* ==================== 快捷键 ==================== */

/** 快捷键页的三组（现有应用 0.7.3）：全局与应用内并排，格式占一整行，两列排列。 */
const SHORTCUT_GROUPS: ReadonlyArray<{ title: string; help?: string; ids: readonly string[]; half: boolean }> = [
  { title: '全局', help: '在任何程序中都能使用', ids: ['capture', 'sidebar'], half: true },
  { title: '应用内', ids: ['newNote', 'search', 'settings', 'save'], half: true },
  {
    title: '格式',
    ids: ['bold', 'italic', 'underline', 'strike', 'link', 'inlineCode', 'codeBlock', 'quote', 'orderedList', 'bulletList', 'heading', 'indent', 'plainPaste'],
    half: false,
  },
];

/** 问号中的补充说明：另外固定可用的按键，以及链接读取剪贴板的用法（与现有应用一致；按键上不加悬停提示）。 */
const SHORTCUT_NOTES: Readonly<Record<string, string>> = {
  strike: '也可按 Alt + Shift + 5',
  inlineCode: '也可按 Ctrl + Shift + `',
  link: '剪贴板中是网址时直接生成链接',
};

/** 固定快捷键占用的按键，录入时同样算作冲突。 */
const FIXED_COMBOS: Readonly<Record<string, string>> = {
  'Ctrl+1': '标题 / 正文',
  'Ctrl+2': '标题 / 正文',
  'Ctrl+3': '标题 / 正文',
  'Ctrl+4': '标题 / 正文',
  'Ctrl+5': '标题 / 正文',
  'Ctrl+6': '标题 / 正文',
  'Ctrl+0': '标题 / 正文',
  Tab: '缩进 / 减少缩进',
  'Shift+Tab': '缩进 / 减少缩进',
  'Ctrl+Shift+V': '粘贴为纯文本',
};

/** 把键盘事件写成「Ctrl+Shift+K」这样的组合。 */
function comboOf(event: KeyboardEvent): string | null {
  const key = event.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  const parts = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
  const name = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  return [...parts, name].join('+');
}

/** 按键的显示：「Ctrl + Shift + Space」，与现有应用一致。 */
const display = (combo: string) => combo.split('+').join(' + ');

/**
 * 修饰键的要求，与现有应用的 shortcutProblem 一致：全局快捷键至少按住两个修饰键，或一个修饰键加功能键；
 * 其余快捷键要按住 Ctrl 或 Alt（功能键除外），以免影响打字。Playground 不检查 Windows 自己占用的组合键。
 */
function comboProblem(spec: ShortcutSpec, combo: string): string | null {
  const parts = combo.split('+');
  const modifiers = parts.slice(0, -1);
  const functionKey = /^F\d+$/.test(parts[parts.length - 1]);
  if (spec.group === '全局') {
    return modifiers.length < 2 && !(functionKey && modifiers.length >= 1) ? '至少按住两个修饰键，或一个修饰键加功能键' : null;
  }
  return !functionKey && !modifiers.some((modifier) => modifier !== 'Shift') ? '需要按住 Ctrl 或 Alt，以免影响打字' : null;
}

/** 快捷键：点击按键后按下新的组合即可更换；冲突时提示原因，按键保持不变（0.7.3 的 T70）。 */
export function ShortcutsPanel() {
  const toast = useToast();
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const keysOf = (spec: ShortcutSpec) => bindings[spec.id] ?? spec.keys;
  const changed = Object.keys(bindings).length > 0;

  const record = (spec: ShortcutSpec, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setRecording(null);
      return;
    }
    const combo = comboOf(event);
    event.preventDefault();
    if (!combo) return;
    const problem = comboProblem(spec, combo);
    if (problem) {
      setMessage({ id: spec.id, text: problem });
      return;
    }
    const clash = SHORTCUTS.find((other) => other.rebindable && other.id !== spec.id && keysOf(other) === combo)?.label ?? FIXED_COMBOS[combo];
    if (clash) {
      setMessage({ id: spec.id, text: `与「${clash}」冲突` });
      return;
    }
    setBindings((current) => {
      const next = { ...current, [spec.id]: combo };
      if (combo === spec.keys) delete next[spec.id];
      return next;
    });
    setMessage(null);
    setRecording(null);
  };

  return (
    <SettingsPage
      title="快捷键"
      aside={
        <Button
          variant="secondary"
          icon="restore"
          disabled={!changed}
          onClick={() => {
            setBindings({});
            toast({ message: '已恢复默认快捷键', tone: 'success' });
          }}
        >
          恢复默认
        </Button>
      }
    >
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsCard key={group.title} title={group.title} help={group.help} half={group.half}>
          <div className={cx('sn-shortcut-grid', !group.half && 'is-two')}>
            {group.ids.map((id) => {
              const spec = SHORTCUTS.find((item) => item.id === id);
              if (!spec) return null;
              const keys = keysOf(spec);
              return (
                <div key={spec.id} className="sn-shortcut-row">
                  <SettingLabel label={spec.label} help={SHORTCUT_NOTES[spec.id]} />
                  <span className="sn-shortcut-cell">
                    {message?.id === spec.id ? <span className="sn-shortcut-message">{message.text}</span> : null}
                    {bindings[spec.id] ? (
                      <IconButton
                        icon="restore"
                        label={`恢复默认 ${display(spec.keys)}`}
                        size="sm"
                        onClick={() =>
                          setBindings((current) => {
                            const next = { ...current };
                            delete next[spec.id];
                            return next;
                          })
                        }
                      />
                    ) : null}
                    {spec.rebindable ? (
                      <button
                        type="button"
                        className={cx('sn-shortcut-key', recording === spec.id && 'is-recording')}
                        aria-label={recording === spec.id ? `正在录入「${spec.label}」的快捷键，Esc 取消` : `更换「${spec.label}」的快捷键，当前为 ${display(keys)}`}
                        onClick={() => {
                          setRecording((current) => (current === spec.id ? null : spec.id));
                          setMessage(null);
                        }}
                        onKeyDown={(event) => (recording === spec.id ? record(spec, event) : undefined)}
                        onBlur={() => setRecording((current) => (current === spec.id ? null : current))}
                      >
                        {recording === spec.id ? '按下新的快捷键…' : display(keys)}
                      </button>
                    ) : (
                      <kbd className="sn-shortcut-key is-fixed">
                        {spec.keys.split(' / ').map(display).join(' / ')}
                      </kbd>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </SettingsCard>
      ))}
    </SettingsPage>
  );
}
