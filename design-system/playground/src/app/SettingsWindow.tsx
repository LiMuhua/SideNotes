/**
 * 设置窗口：880 × 720，可调整大小，最小 720 × 560（与现有应用的窗口配置一致）。
 *
 * 五个分类沿用现有应用：外观与交互、快捷键、数据与同步、回收站、关于。
 * 分类栏用上下方向键切换；设置改动立即生效，没有「应用」按钮。
 */

import { useState, type ReactNode } from 'react';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/context';
import { Icon, type IconName } from '../ui/Icon';
import { BrandMark } from './SidebarParts';
import { AboutPanel, DataPanel, TrashPanel } from './SettingsData';
import { AppearancePanel, ShortcutsPanel } from './SettingsPanels';

export type SettingsSection = 'appearance' | 'shortcuts' | 'data' | 'trash' | 'about';

const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: 'appearance', label: '外观与交互', icon: 'sun' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'data', label: '数据与同步', icon: 'cloud' },
  { id: 'trash', label: '回收站', icon: 'trash' },
  { id: 'about', label: '关于', icon: 'info' },
];

export function SettingsWindow({ onClose, initial = 'appearance' }: { onClose: () => void; initial?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial);
  const [minimized, setMinimized] = useState(false);
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  if (minimized) {
    return (
      <button type="button" className="sn-window-chip" onClick={() => setMinimized(false)}>
        <BrandMark small />
        SideNotes 设置（已最小化，点击还原）
      </button>
    );
  }

  return (
    <section
      className="sn-settings"
      role="dialog"
      aria-label="设置"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="sn-settings-titlebar">
        <span className="sn-settings-app">
          <BrandMark small />
          SideNotes 设置
        </span>
        <span className="sn-spacer" />
        <IconButton icon="minus" label="最小化" size="sm" onClick={() => setMinimized(true)} />
        <IconButton icon="x" label="关闭对话框" size="sm" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="sn-settings-body">
        <nav
          className="sn-settings-nav"
          aria-label="设置分类"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const index = SECTIONS.findIndex((item) => item.id === section);
            const next = SECTIONS[(index + (event.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length];
            setSection(next.id);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-section="${next.id}"]`)?.focus());
          }}
        >
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-section={item.id}
              className={cx('sn-settings-nav-item', item.id === section && 'is-active')}
              aria-current={item.id === section ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sn-settings-scroll">
          <div className="sn-settings-content">
            <h3 className="sn-settings-heading">{current.label}</h3>
            {section === 'appearance' ? <AppearancePanel /> : null}
            {section === 'shortcuts' ? <ShortcutsPanel /> : null}
            {section === 'data' ? <DataPanel /> : null}
            {section === 'trash' ? <TrashPanel /> : null}
            {section === 'about' ? <AboutPanel /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 设置分组：标题在外，内容是一张卡片。 */
export function SettingGroup({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="sn-setting-group">
      <div className="sn-setting-group-head">
        <h4 className="sn-setting-group-title">{title}</h4>
        {aside}
      </div>
      <div className="sn-setting-card">{children}</div>
    </section>
  );
}

/** 设置行：名称在左（说明放在问号提示里，T73），取值与操作靠右。 */
export function SettingRow({ title, help, children, stacked = false }: { title: string; help?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cx('sn-setting-row', stacked && 'is-stacked')}>
      <div className="sn-setting-name">
        <span>{title}</span>
        {help ? (
          <span className="sn-setting-help" title={help} aria-label={help} role="img">
            <Icon name="info" />
          </span>
        ) : null}
      </div>
      <div className="sn-setting-control">{children}</div>
    </div>
  );
}
