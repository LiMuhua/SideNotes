/**
 * 设置：外观与交互、快捷键。
 *
 * 设置项、取值范围与默认值取自现有应用（`src/core/settings.ts`、`AppearancePanel.tsx`、0.7.3 的快捷键页）。
 * 明暗模式与界面材质在 Playground 中分别对应外壳的「主题」与「方向」。
 */

import { useState, type KeyboardEvent } from 'react';
import { ANIM_DURATION_RANGE, CARD_HEIGHT_RANGE, FONT_SIZE_RANGE, HIDE_DELAY_RANGE, PAGE_SIZE_RANGE, WIDTH_RANGE } from '@/core/settings';
import type { ToastPosition } from '@/core/types';
import { DIRECTIONS } from '../directions';
import { useNotes } from '../model/notes';
import { usePlayground, useSystemDark, type ThemeMode } from '../shell/state';
import { Button } from '../ui/Button';
import { cx } from '../ui/context';
import { TextInput } from '../ui/Field';
import { Keys } from '../ui/Misc';
import { Select } from '../ui/Select';
import { Segmented, Switch } from '../ui/Toggle';
import { SettingGroup, SettingRow } from './SettingsWindow';
import { SHORTCUTS, type ShortcutGroup, type ShortcutSpec } from './shortcuts';

/** 带数值显示的滑块；松开后才写入（字号滑块拖动途中不重排，T54）。 */
function RangeField({ label, value, min, max, step, unit, onCommit }: { label: string; value: number; min: number; max: number; step: number; unit: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return (
    <span className="sn-range-field">
      <input
        type="range"
        className="sn-range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => {
          if (draft !== null) onCommit(draft);
          setDraft(null);
        }}
        onKeyUp={() => {
          if (draft !== null) onCommit(draft);
          setDraft(null);
        }}
      />
      <span className="sn-range-value">
        {shown}
        <span className="sn-unit">{unit}</span>
      </span>
    </span>
  );
}

/** 毫秒输入：只写数字，单位 ms 固定在输入框之后；候选值用 datalist（T52）。 */
function MillisecondsField({ label, value, min, max, presets, onCommit }: { label: string; value: number; min: number; max: number; presets: number[]; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const listId = `${label}-presets`;
  const commit = () => {
    const number = Number(text.replace(/\s*(ms|毫秒)$/i, ''));
    const next = Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : value;
    setText(String(next));
    onCommit(next);
  };
  return (
    <span className="sn-ms-field">
      <TextInput
        inputSize="sm"
        aria-label={label}
        inputMode="numeric"
        list={listId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <datalist id={listId}>
        {presets.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>
      <span className="sn-unit">ms</span>
    </span>
  );
}

const THEMES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const TOAST_POSITIONS: ReadonlyArray<{ value: ToastPosition; label: string }> = [
  { value: 'top-center', label: '顶部正中' },
  { value: 'top-right', label: '右上角' },
  { value: 'bottom-center', label: '底部正中' },
];

const FONTS = ['Maple Mono NF CN', 'Segoe UI Variable Text', 'Microsoft YaHei UI', 'Cascadia Mono', '系统默认'];

export function AppearancePanel() {
  const playground = usePlayground();
  const systemDark = useSystemDark();
  const { settings, updateSettings } = useNotes();
  return (
    <>
      <SettingGroup title="显示">
        <SettingRow title="明暗模式" stacked>
          <div className="sn-choice-grid" role="radiogroup" aria-label="明暗模式">
            {THEMES.map((theme) => (
              <label key={theme.value} className={cx('sn-choice', playground.theme === theme.value && 'is-selected')}>
                <input type="radio" name="sn-theme" className="sn-sr-only" checked={playground.theme === theme.value} onChange={() => playground.set({ theme: theme.value })} />
                <span className="sn-choice-preview" aria-hidden="true">
                  {theme.value === 'system' ? (
                    <>
                      <MiniSidebar direction={playground.direction} theme="light" />
                      <MiniSidebar direction={playground.direction} theme="dark" />
                    </>
                  ) : (
                    <MiniSidebar direction={playground.direction} theme={theme.value} />
                  )}
                </span>
                <span className="sn-choice-label">
                  {theme.label}
                  {theme.value === 'system' ? <span className="sn-choice-hint">当前为{systemDark ? '深色' : '浅色'}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="界面材质" help="Playground 中对应五套设计方向；正式版保留哪些材质待评审后确定" stacked>
          <div className="sn-choice-grid is-five" role="radiogroup" aria-label="界面材质">
            {DIRECTIONS.map((direction) => (
              <label key={direction.id} className={cx('sn-choice', playground.direction === direction.id && 'is-selected')}>
                <input type="radio" name="sn-material" className="sn-sr-only" checked={playground.direction === direction.id} onChange={() => playground.set({ direction: direction.id })} />
                <span className="sn-choice-preview" aria-hidden="true">
                  <MiniSidebar direction={direction.id} theme={playground.resolvedTheme} />
                </span>
                <span className="sn-choice-label">{direction.name}</span>
              </label>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="侧栏">
        <SettingRow title="显示位置">
          <Segmented
            label="触发边缘"
            size="sm"
            value={settings.edge}
            onChange={(edge) => updateSettings({ edge })}
            options={[
              { value: 'left', label: '屏幕左侧' },
              { value: 'right', label: '屏幕右侧' },
            ]}
          />
        </SettingRow>
        <SettingRow title="贴边唤出" help="鼠标移到屏幕边缘时唤出侧栏">
          <Switch label="贴边唤出" hideLabel checked={settings.edgeTrigger} onChange={(edgeTrigger) => updateSettings({ edgeTrigger })} />
        </SettingRow>
        <SettingRow title="移出后收起" help="鼠标移出侧栏后多久收起">
          <MillisecondsField label="移出后收起（毫秒）" value={settings.hideDelay} min={HIDE_DELAY_RANGE.min} max={HIDE_DELAY_RANGE.max} presets={[300, 600, 1000]} onCommit={(hideDelay) => updateSettings({ hideDelay })} />
        </SettingRow>
        <SettingRow title="编辑时保持展开" help="书写时鼠标移出也不收起">
          <Switch label="编辑时保持展开" hideLabel checked={settings.protectEditing} onChange={(protectEditing) => updateSettings({ protectEditing })} />
        </SettingRow>
        <SettingRow title="宽度" help="随字号等比加宽，也可拖动侧栏边缘调整">
          <RangeField label="侧栏宽度" value={settings.width} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} step={WIDTH_RANGE.step} unit="px" onCommit={(width) => updateSettings({ width })} />
        </SettingRow>
        <SettingRow title="出入动画" help="设为 0 关闭动画">
          <RangeField label="出入动画时长" value={settings.animDuration} min={ANIM_DURATION_RANGE.min} max={ANIM_DURATION_RANGE.max} step={ANIM_DURATION_RANGE.step} unit="ms" onCommit={(animDuration) => updateSettings({ animDuration })} />
        </SettingRow>
        <SettingRow title="卡片高度" help="正文超过这个高度时渐隐，双击卡片查看全文">
          <RangeField label="卡片最大高度" value={settings.cardMaxHeight} min={CARD_HEIGHT_RANGE.min} max={CARD_HEIGHT_RANGE.max} step={CARD_HEIGHT_RANGE.step} unit="px" onCommit={(cardMaxHeight) => updateSettings({ cardMaxHeight })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="文字">
        <SettingRow title="字体" help="用于全部界面文字，代码仍用等宽字体">
          <span className="sn-font-field">
            <TextInput inputSize="sm" aria-label="字体" list="sn-font-list" defaultValue={settings.fontFamily} onBlur={(event) => updateSettings({ fontFamily: event.target.value || settings.fontFamily })} />
            <datalist id="sn-font-list">
              {FONTS.map((font) => (
                <option key={font} value={font} />
              ))}
            </datalist>
          </span>
        </SettingRow>
        <SettingRow title="字号" help="界面文字随之等比缩放，松开滑块后应用">
          <RangeField label="字体大小" value={settings.fontSize} min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} step={FONT_SIZE_RANGE.step} unit="px" onCommit={(fontSize) => updateSettings({ fontSize })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="其它">
        <SettingRow title="列表加载" help="滚动到底部时按批加载，每批 5–100 条">
          <span className="sn-inline-controls">
            <Switch label="滚动按需加载" hideLabel checked={settings.lazyLoading} onChange={(lazyLoading) => updateSettings({ lazyLoading })} />
            <TextInput
              inputSize="sm"
              className="sn-number"
              aria-label="每批加载记录数"
              type="number"
              min={PAGE_SIZE_RANGE.min}
              max={PAGE_SIZE_RANGE.max}
              disabled={!settings.lazyLoading}
              defaultValue={settings.pageSize}
              onBlur={(event) => updateSettings({ pageSize: Math.min(PAGE_SIZE_RANGE.max, Math.max(PAGE_SIZE_RANGE.min, Number(event.target.value) || settings.pageSize)) })}
            />
            <span className="sn-unit">条/批</span>
          </span>
        </SettingRow>
        <SettingRow title="整理提醒" help="工作区记录超过这个数时提醒整理">
          <span className="sn-inline-controls">
            <Switch label="启用工作区整理提醒" hideLabel checked={settings.tidyLimit > 0} onChange={(on) => updateSettings({ tidyLimit: on ? 50 : 0 })} />
            <TextInput
              inputSize="sm"
              className="sn-number"
              aria-label="工作区整理提醒阈值"
              type="number"
              min={1}
              disabled={settings.tidyLimit === 0}
              defaultValue={settings.tidyLimit || 50}
              onBlur={(event) => updateSettings({ tidyLimit: Math.max(1, Number(event.target.value) || 50) })}
            />
            <span className="sn-unit">条</span>
          </span>
        </SettingRow>
        <SettingRow title="通知位置" help="「已保存」等操作提示弹出的位置">
          <Select aria-label="通知弹出位置" size="sm" value={settings.toastPosition} onChange={(toastPosition) => updateSettings({ toastPosition })} options={TOAST_POSITIONS} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

/** 迷你侧栏：颜色全部来自所示方向与主题的令牌。 */
function MiniSidebar({ direction, theme }: { direction: string; theme: 'light' | 'dark' }) {
  return (
    <span className="sn-mini" data-sn-direction={direction} data-sn-theme={theme}>
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

/** 把键盘事件写成「Ctrl+Shift+K」这样的组合。 */
function comboOf(event: KeyboardEvent): string | null {
  const key = event.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  const parts = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
  const name = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  return [...parts, name].join('+');
}

const GROUPS: readonly ShortcutGroup[] = ['全局', '侧栏', '编辑', '格式'];

/** 快捷键：可重新绑定的按键点击后录入，录入时检查冲突（0.7.3 的 T70）。 */
export function ShortcutsPanel() {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const keysOf = (spec: ShortcutSpec) => bindings[spec.id] ?? spec.keys;

  const record = (spec: ShortcutSpec, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setRecording(null);
      return;
    }
    const combo = comboOf(event);
    event.preventDefault();
    if (!combo) return;
    if (!/Ctrl|Alt/.test(combo) && spec.group === '全局') {
      setMessage({ id: spec.id, text: '全局快捷键需要带 Ctrl 或 Alt' });
      return;
    }
    const clash = SHORTCUTS.find((other) => other.id !== spec.id && keysOf(other) === combo);
    if (clash) {
      setMessage({ id: spec.id, text: `与「${clash.label}」冲突` });
      return;
    }
    setBindings((current) => ({ ...current, [spec.id]: combo }));
    setMessage(null);
    setRecording(null);
  };

  return (
    <>
      {GROUPS.map((group) => (
        <SettingGroup
          key={group}
          title={group}
          aside={
            group === '全局' ? (
              <Button variant="ghost" size="sm" onClick={() => setBindings({})}>
                恢复默认
              </Button>
            ) : undefined
          }
        >
          {SHORTCUTS.filter((spec) => spec.group === group).map((spec) => (
            <SettingRow key={spec.id} title={spec.label} help={spec.proposed ? '本次设计提出的操作，现有应用尚未实现' : undefined}>
              <span className="sn-shortcut-cell">
                {message?.id === spec.id ? <span className="sn-shortcut-message">{message.text}</span> : null}
                {spec.proposed ? <span className="sn-proposed">提议</span> : null}
                {spec.rebindable ? (
                  <button
                    type="button"
                    className={cx('sn-shortcut-button', recording === spec.id && 'is-recording')}
                    aria-label={`${spec.label}：${keysOf(spec)}，点击后按下新的快捷键`}
                    onClick={() => {
                      setRecording(spec.id);
                      setMessage(null);
                    }}
                    onKeyDown={(event) => (recording === spec.id ? record(spec, event) : undefined)}
                    onBlur={() => setRecording((current) => (current === spec.id ? null : current))}
                  >
                    {recording === spec.id ? '按下新的快捷键…' : <Keys combo={keysOf(spec)} />}
                  </button>
                ) : (
                  <span className="sn-shortcut-fixed">
                    {spec.keys.split(' / ').map((combo) => (
                      <Keys key={combo} combo={combo} />
                    ))}
                  </span>
                )}
              </span>
            </SettingRow>
          ))}
        </SettingGroup>
      ))}
    </>
  );
}
