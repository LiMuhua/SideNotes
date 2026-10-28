/**
 * 外观与交互。
 *
 * 结构对应原型 settings.js 的 renderAppearance 与 runtimeSettings：
 * 显示（明暗模式、界面材质）、文字（字体、字号、预览）、侧栏、其它。
 * 「出入动画」为桌面端按需求新增的一行，复用宽度行的样式轨道。
 */

import { useState } from 'react';
import { ANIM_DURATION_RANGE, FONT_SIZE_RANGE, HIDE_DELAYS, WIDTH_RANGE } from '../../core/settings';
import type { EdgeSide, Settings } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { ActionButton, Group, RangeField, Row, SelectField, TextField, Toggle, classes, type SaveSettings } from './controls';
import { FontPicker } from './FontPicker';

const THEMES: ReadonlyArray<readonly [Settings['theme'], string]> = [
  ['light', '浅色'],
  ['dark', '深色'],
  ['system', '跟随系统'],
];

const SURFACES: ReadonlyArray<readonly [Settings['surface'], string]> = [
  ['standard', '经典'],
  ['paper', '记录纸'],
  ['glass', '磨砂玻璃'],
  ['win11', 'Windows 11'],
];

const EDGES: ReadonlyArray<readonly [EdgeSide, string]> = [
  ['right', '屏幕右侧'],
  ['left', '屏幕左侧'],
];

const DELAY_LABELS: Record<(typeof HIDE_DELAYS)[number], string> = { 300: '300 毫秒', 600: '600 毫秒', 1000: '1 秒' };
const DELAYS = HIDE_DELAYS.map((delay) => [delay, DELAY_LABELS[delay]] as const);

interface PanelProps {
  settings: Settings;
  save: SaveSettings;
}

/** 明暗模式与界面材质：选择卡宽度由网格决定，不随文字撑开。 */
function DisplayGroup({ settings, save }: PanelProps) {
  return (
    <Group title="显示" className="settings-wide appearance-display">
      <div className="appearance-display-grid">
        <div className="settings-option-block">
          <Row title="明暗模式">
            <div className="settings-choice-grid theme-grid" aria-label="明暗模式">
              {THEMES.map(([theme, label]) => {
                const selected = settings.theme === theme;
                return (
                  <ActionButton
                    key={theme}
                    label={label}
                    className={classes('settings-choice theme-option', selected && 'selected active')}
                    aria-pressed={selected}
                    leading={
                      <span className="theme-swatch theme-preview" data-choice={theme} data-theme={theme} aria-hidden="true" />
                    }
                    onClick={() => void save({ theme })}
                  />
                );
              })}
            </div>
          </Row>
        </div>
        <div className="settings-option-block">
          <Row title="界面材质">
            <div className="surface-choice-grid" aria-label="界面材质">
              {SURFACES.map(([surface, label]) => {
                const selected = settings.surface === surface;
                return (
                  <ActionButton
                    key={surface}
                    label={label}
                    className={classes('surface-choice theme-option', selected && 'selected active')}
                    data-surface={surface}
                    aria-pressed={selected}
                    leading={<span className="theme-preview surface-preview" data-surface={surface} aria-hidden="true" />}
                    onClick={() => void save({ surface })}
                  />
                );
              })}
            </div>
          </Row>
        </div>
      </div>
    </Group>
  );
}

/** 列表加载与整理提醒，交互分类末尾的紧凑配置。 */
function RuntimeGroup({ settings, save }: PanelProps) {
  const toast = useToast();
  // 关闭整理提醒时阈值记为 0，这里记住上一次的阈值，重新开启时恢复。
  const [previousLimit, setPreviousLimit] = useState(settings.tidyLimit || 50);

  return (
    <Group title="其它" className="settings-wide settings-runtime-card">
      <div className="settings-runtime-row">
        <div className="settings-runtime-field">
          <div className="settings-runtime-name" title="滚动到列表底部时按批追加记录，每批可设置 5 至 100 条。">
            列表加载
          </div>
          <div className="settings-runtime-controls">
            <Toggle
              label="滚动按需加载"
              title="滚动按需加载"
              checked={settings.lazyLoading}
              onChange={(lazyLoading) => void save({ lazyLoading })}
            />
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
          <div className="settings-runtime-name" title="工作区记录超过阈值时提醒整理，关闭后不再提示。">
            整理提醒
          </div>
          <div className="settings-runtime-controls">
            <Toggle
              label="启用工作区整理提醒"
              title="启用工作区整理提醒"
              checked={settings.tidyLimit > 0}
              onChange={(enabled) => void save({ tidyLimit: enabled ? previousLimit : 0 })}
            />
            <label className="settings-runtime-value">
              <TextField
                label="工作区整理提醒阈值"
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
    </Group>
  );
}

export function AppearancePanel({ settings, save }: PanelProps) {
  return (
    <div className="settings-dashboard appearance-dashboard">
      <DisplayGroup settings={settings} save={save} />

      <Group title="文字" className="settings-wide">
        <div className="settings-field-grid settings-typography">
          <Row title="字体">
            <FontPicker value={settings.fontFamily} onChoose={(fontFamily) => save({ fontFamily })} />
          </Row>
          <Row title="字号">
            <RangeField
              label="字体大小"
              settingKey="fontSize"
              value={settings.fontSize}
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={FONT_SIZE_RANGE.step}
              unit=" px"
              onSave={(fontSize) => save({ fontSize })}
            />
          </Row>
        </div>
        <div className="settings-font-preview">随手记录。 The quick brown fox · 0123456789</div>
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
            <Row
              title="移出后收起"
              description="鼠标移出侧栏或点到其它窗口后，等待所选时间再自动收起。固定侧栏、打开菜单或对话框期间不收起。"
            >
              <SelectField
                label="移出后收起"
                options={DELAYS}
                value={settings.hideDelay}
                onChange={(delay) => void save({ hideDelay: Number(delay) })}
              />
            </Row>
            <Row title="编辑时保持展开" description="正在书写时，鼠标移出也保持侧栏展开。">
              <Toggle
                label="编辑时保持展开"
                checked={settings.protectEditing}
                onChange={(protectEditing) => void save({ protectEditing })}
              />
            </Row>
          </div>
          <Row title="宽度" description="可拖动侧栏边缘直接调整。" className="sidebar-width-row">
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
          <Row title="出入动画" description="侧栏滑入与收起的时长，设为 0 时关闭动画。" className="sidebar-width-row">
            <RangeField
              label="出入动画时长"
              settingKey="animDuration"
              value={settings.animDuration}
              min={ANIM_DURATION_RANGE.min}
              max={ANIM_DURATION_RANGE.max}
              step={ANIM_DURATION_RANGE.step}
              unit=" ms"
              onSave={(animDuration) => save({ animDuration })}
            />
          </Row>
        </div>
      </Group>

      <RuntimeGroup settings={settings} save={save} />
    </div>
  );
}
