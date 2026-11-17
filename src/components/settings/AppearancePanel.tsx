/**
 * 外观与交互。
 *
 * 结构对应原型 settings.js 的 renderAppearance 与 runtimeSettings：
 * 显示（明暗模式、界面材质）、文字（字体、字号、预览）、侧栏、其它。
 * 「出入动画」为桌面端按需求新增的一行，复用宽度行的样式轨道。
 */

import { useState } from 'react';
import {
  ANIM_DURATION_RANGE,
  CARD_HEIGHT_RANGE,
  FONT_SIZE_RANGE,
  HIDE_DELAY_RANGE,
  HIDE_DELAYS,
  WIDTH_RANGE,
  resolveTheme,
} from '../../core/settings';
import { SURFACES, surfaceAttributes } from '../../core/surfaces';
import type { EdgeSide, Settings, SurfaceMode, ToastPosition, WindowTabsPosition } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { ActionButton, Group, Help, NumberCombobox, RangeField, Row, SelectField, TextField, Toggle, classes, moveRadio, type SaveSettings } from './controls';
import { AppIconPicker } from './AppIconPicker';
import { FontPicker } from './FontPicker';

const THEMES: ReadonlyArray<readonly [Settings['theme'], string]> = [
  ['light', '浅色'],
  ['dark', '深色'],
  ['system', '跟随系统'],
];

const EDGES: ReadonlyArray<readonly [EdgeSide, string]> = [
  ['right', '屏幕右侧'],
  ['left', '屏幕左侧'],
];

/** 提示条位置，顺序与默认值见 TOAST_POSITIONS。 */
const TOAST_POSITION_LABELS: ReadonlyArray<readonly [ToastPosition, string]> = [
  ['top-center', '顶部正中'],
  ['top-right', '右上角'],
  ['bottom-center', '底部正中'],
];

/** 记录窗口的标签页位置，顺序与原型相同：顶部、左侧（默认左侧）。 */
const WINDOW_TABS_LABELS: ReadonlyArray<readonly [WindowTabsPosition, string]> = [
  ['top', '顶部'],
  ['side', '左侧'],
];

/** 常用延迟只写数字，单位 ms 固定显示在输入框之后。 */
/** 「移出后收起」的常用值，与原型相同只写数字，单位 ms 写在组合框后面。 */
const DELAY_CHOICES: ReadonlyArray<readonly [number, string]> = HIDE_DELAYS.map((delay) => [delay, String(delay)] as const);

interface PanelProps {
  settings: Settings;
  save: SaveSettings;
}

/**
 * 迷你侧栏：在元素上写入主题与明暗属性，里面用那一套令牌画出面板、标题、两张卡片（与原型 settings.js 的 miniSidebar 相同）。
 */
function MiniSidebar({ surface, theme }: { surface: SurfaceMode; theme: 'light' | 'dark' }) {
  return (
    <span className="mini-sidebar" {...surfaceAttributes(surface, theme)}>
      <span className="mini-panel">
        <span className="mini-line is-title" />
        <span className="mini-card is-active">
          <span className="mini-line" />
          <span className="mini-line is-short" />
        </span>
        <span className="mini-card">
          <span className="mini-line" />
          <span className="mini-line is-accent" />
        </span>
      </span>
    </span>
  );
}

/**
 * 明暗模式与主题：两行选项卡片，预览是用对应主题与明暗的令牌画出的迷你侧栏（components.md 第五节）。
 * 「跟随系统」的预览左右各半，写出当前跟随到的明暗。
 */
function DisplayGroup({ settings, save }: PanelProps) {
  const resolved = resolveTheme(settings.theme);
  return (
    <Group title="显示" className="settings-wide appearance-display">
      <div className="appearance-display-grid">
        <div className="settings-option-block">
          <Row title="明暗模式">
            <div className="settings-choice-grid theme-grid" role="radiogroup" aria-label="明暗模式" onKeyDown={moveRadio}>
              {THEMES.map(([theme, label]) => {
                const selected = settings.theme === theme;
                return (
                  <ActionButton
                    key={theme}
                    label={label}
                    className={classes('settings-choice theme-option', selected && 'selected active')}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => void save({ theme })}
                  >
                    <span className="theme-preview" aria-hidden="true">
                      {(theme === 'system' ? (['light', 'dark'] as const) : [theme]).map((tone) => (
                        <MiniSidebar key={tone} surface={settings.surface} theme={tone} />
                      ))}
                    </span>
                    <span className="choice-label">
                      {label}
                      {theme === 'system' ? (
                        <span className="choice-hint">{`当前为${resolved === 'dark' ? '深色' : '浅色'}`}</span>
                      ) : null}
                    </span>
                  </ActionButton>
                );
              })}
            </div>
          </Row>
        </div>
        <div className="settings-option-block">
          <Row title="主题">
            <div className="surface-choice-grid" role="radiogroup" aria-label="主题" onKeyDown={moveRadio}>
              {SURFACES.map((item) => {
                const selected = settings.surface === item.id;
                return (
                  <ActionButton
                    key={item.id}
                    label={item.name}
                    className={classes('surface-choice theme-option', selected && 'selected active')}
                    data-surface={item.id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => void save({ surface: item.id })}
                  >
                    <span className="theme-preview surface-preview" aria-hidden="true">
                      <MiniSidebar surface={item.id} theme={resolved} />
                    </span>
                    <span className="choice-label">{item.name}</span>
                  </ActionButton>
                );
              })}
            </div>
          </Row>
        </div>
        {/* 应用图标排在主题之后（components.md 7.2）。 */}
        <div className="settings-option-block">
          <Row title="应用图标" description="标题区、速记浮窗、关于页与网页图标都换成选中的图标">
            <AppIconPicker settings={settings} save={save} />
          </Row>
        </div>
      </div>
    </Group>
  );
}

/** 移出后收起（原型的数字组合框）：100–10000 毫秒，常用值 300、600、1000，滚轮一格 100。 */
function HideDelayField({ value, save }: { value: number; save: SaveSettings }) {
  const { min, max } = HIDE_DELAY_RANGE;
  return (
    <NumberCombobox
      label="移出后收起"
      value={value}
      options={DELAY_CHOICES}
      min={min}
      max={max}
      step={1}
      wheelStep={100}
      unit="ms"
      onCommit={(hideDelay) => save({ hideDelay })}
    />
  );
}

/**
 * 交互分类末尾的「其它」（原型 settings.js 的 runtimeSettings）：固定两行，第一行窗口标签页、通知位置，
 * 第二行列表加载、整理提醒；每行按各自的宽度排开，太窄放不下时行内折行。
 */
function RuntimeGroup({ settings, save }: PanelProps) {
  const toast = useToast();
  // 关闭整理提醒时阈值记为 0，这里记住上一次的阈值，重新开启时恢复。
  const [previousLimit, setPreviousLimit] = useState(settings.tidyLimit || 50);

  return (
    <Group title="其它" className="settings-wide settings-runtime-card">
      <div className="settings-runtime-rows">
        <div className="settings-runtime-row">
          <div className="settings-runtime-field">
            <div className="settings-runtime-name">
              窗口标签页
              <Help title="窗口标签页" description="记录窗口中标签页的位置，窗口标题栏上的按钮也能切换" />
            </div>
            <div className="settings-runtime-controls">
              <SelectField
                label="记录窗口的标签页位置"
                options={WINDOW_TABS_LABELS}
                value={settings.windowTabs}
                onChange={(position) => void save({ windowTabs: position as WindowTabsPosition })}
              />
            </div>
          </div>
          <div className="settings-runtime-field">
            <div className="settings-runtime-name">通知位置</div>
            <div className="settings-runtime-controls">
              <SelectField
                label="通知弹出位置"
                options={TOAST_POSITION_LABELS}
                value={settings.toastPosition}
                onChange={(position) => void save({ toastPosition: position as ToastPosition })}
              />
            </div>
          </div>
        </div>
        <div className="settings-runtime-row">
          <div className="settings-runtime-field">
            <div className="settings-runtime-name">
              列表加载
              <Help title="列表加载" description="滚动到列表底部时按批加载" />
            </div>
            <div className="settings-runtime-controls">
              <Toggle label="滚动按需加载" checked={settings.lazyLoading} onChange={(lazyLoading) => void save({ lazyLoading })} />
              <label className="settings-runtime-value">
                <TextField
                  label="每批加载记录数"
                  type="number"
                  min={5}
                  max={100}
                  value={String(settings.pageSize)}
                  disabled={!settings.lazyLoading}
                  onCommit={(raw) => {
                    const pageSize = Number(raw);
                    if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 100) {
                      toast('每批加载 5 至 100 条');
                      return false;
                    }
                    return save({ pageSize });
                  }}
                />
                <span className="settings-runtime-suffix">条/批</span>
              </label>
            </div>
          </div>
          <div className="settings-runtime-field">
            <div className="settings-runtime-name">
              整理提醒
              <Help title="整理提醒" description="记录超过这个数时提醒整理" />
            </div>
            <div className="settings-runtime-controls">
              <Toggle
                label="启用整理提醒"
                checked={settings.tidyLimit > 0}
                onChange={(enabled) => void save({ tidyLimit: enabled ? previousLimit : 0 })}
              />
              <label className="settings-runtime-value">
                <TextField
                  label="整理提醒阈值"
                  type="number"
                  min={1}
                  max={100000}
                  value={String(settings.tidyLimit || previousLimit)}
                  disabled={!settings.tidyLimit}
                  onCommit={async (raw) => {
                    const tidyLimit = Number(raw);
                    if (!Number.isInteger(tidyLimit) || tidyLimit < 1 || tidyLimit > 100000) {
                      toast('请输入 1 至 100000 的整数');
                      return false;
                    }
                    if (!(await save({ tidyLimit }))) return false;
                    setPreviousLimit(tidyLimit);
                    return true;
                  }}
                />
                <span className="settings-runtime-suffix">条</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </Group>
  );
}

export function AppearancePanel({ settings, save }: PanelProps) {
  return (
    <div className="settings-dashboard appearance-dashboard">
      <DisplayGroup settings={settings} save={save} />

      <Group title="文字" className="settings-wide">
        <div className="settings-field-grid settings-typography">
          <Row title="字体" description="默认跟随主题；选了具体字体时替换界面与正文的字体，标题与代码的字体仍跟随主题">
            <FontPicker value={settings.fontFamily} surface={settings.surface} onChoose={(fontFamily) => save({ fontFamily })} />
          </Row>
          <Row title="字号">
            <RangeField
              label="字号"
              settingKey="fontSize"
              value={settings.fontSize}
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={FONT_SIZE_RANGE.step}
              unit=" px"
              commitOnRelease
              onSave={(fontSize) => save({ fontSize })}
            />
          </Row>
        </div>
        <div className="settings-font-preview">
          <p>随手记下一句话，不打断手头的工作；支持 Markdown 与 #标签。</p>
          <p>The Quick Brown Fox Jumps Over the Lazy Dog.</p>
          <p>{'0123456789 · ¥$€ @#%&*?! · 2026-11-08 · -> => != <= >= === //'}</p>
        </div>
      </Group>

      <Group title="侧栏" className="settings-wide">
        <div className="sidebar-settings-layout">
          <div className="sidebar-settings-primary">
            <Row title="显示位置">
              <SelectField
                label="触发边缘"
                options={EDGES}
                value={settings.edge}
                onChange={(edge) => void save({ edge: edge === 'left' ? 'left' : 'right' })}
              />
            </Row>
            <Row title="移出后收起">
              <HideDelayField value={settings.hideDelay} save={save} />
            </Row>
            <Row title="编辑时滚到顶部">
              <Toggle
                label="编辑时滚到顶部"
                checked={settings.scrollOnEdit}
                onChange={(scrollOnEdit) => void save({ scrollOnEdit })}
              />
            </Row>
          </div>
          <Row title="宽度" description="随字号等比加宽，也可拖动侧栏边缘调整" className="sidebar-width-row">
            <RangeField
              label="侧栏宽度"
              settingKey="width"
              value={settings.width}
              min={WIDTH_RANGE.min}
              max={WIDTH_RANGE.max}
              step={WIDTH_RANGE.step}
              unit=" px"
              onSave={(width) => save({ width })}
            />
          </Row>
          <Row title="出入动画" className="sidebar-width-row">
            <RangeField
              label="出入动画"
              settingKey="animDuration"
              value={settings.animDuration}
              min={ANIM_DURATION_RANGE.min}
              max={ANIM_DURATION_RANGE.max}
              step={ANIM_DURATION_RANGE.step}
              unit=" ms"
              onSave={(animDuration) => save({ animDuration })}
            />
          </Row>
          <Row
            title="卡片高度"
            description="超出的部分渐隐；点「展开全文」或把卡片拖出侧栏，在窗口中查看全文"
            className="sidebar-width-row"
          >
            <RangeField
              label="卡片高度"
              settingKey="cardMaxHeight"
              value={settings.cardMaxHeight}
              min={CARD_HEIGHT_RANGE.min}
              max={CARD_HEIGHT_RANGE.max}
              step={CARD_HEIGHT_RANGE.step}
              unit=" px"
              onSave={(cardMaxHeight) => save({ cardMaxHeight })}
            />
          </Row>
        </div>
      </Group>

      <RuntimeGroup settings={settings} save={save} />
    </div>
  );
}
