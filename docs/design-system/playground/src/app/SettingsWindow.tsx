/**
 * 设置窗口：960 × 720，可调整大小，最小 720 × 560。现有应用是 880 × 720；加宽 80px，让「外观与交互 › 其它」的三项排在一行（本次提出）。
 *
 * 布局沿用现有应用 0.7.3：标题栏只写「设置」；左边是窄的分类栏，右边是当前分类的页面，
 * 页面由几张分组卡片组成，相关的设置放在一起。五个分类：外观与交互、快捷键、数据与同步、回收站、关于。
 * 分类栏用上下方向键切换；设置改动立即生效，没有「应用」按钮。
 */

import { useState } from 'react';
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
      {/* 标题栏是拖动区域，与现有应用的 data-tauri-drag-region 一致。 */}
      <header className="sn-settings-titlebar" data-drag-region="">
        <span className="sn-settings-app">设置</span>
        <span className="sn-spacer" />
        <IconButton icon="minus" label="最小化" size="sm" onClick={() => setMinimized(true)} />
        <IconButton icon="x" label="关闭设置" size="sm" shortcut="Esc" onClick={onClose} />
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
          {section === 'appearance' ? <AppearancePanel /> : null}
          {section === 'shortcuts' ? <ShortcutsPanel /> : null}
          {section === 'data' ? <DataPanel /> : null}
          {section === 'trash' ? <TrashPanel /> : null}
          {section === 'about' ? <AboutPanel /> : null}
        </div>
      </div>
    </section>
  );
}
