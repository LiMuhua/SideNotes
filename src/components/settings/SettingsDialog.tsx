/**
 * 设置对话框。
 *
 * 桌面端的设置是一个独立的无边框窗口，窗口内容就是原型的 `.modal.settings-modal`：
 * 外壳对应 app.js 的 openModal，分类布局对应 settings.js 的 open 与 renderPanel，
 * DOM 结构、类名与文案逐项对照，以便原样复用 prototype.css。
 * 与原型的差别只有两处：标题栏承担窗口拖动，关闭按钮旁补充最小化按钮。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as bridge from '../../core/bridge';
import * as store from '../../core/store';
import type { Settings } from '../../core/types';
import { useStoreSlice } from '../../hooks/useStore';
import { useToast } from '../../hooks/useToast';
import { Icon, IconSprite, type IconName } from '../Icon';
import { ToastRegion } from '../Modal';
import { AboutPanel } from './AboutPanel';
import { AppearancePanel } from './AppearancePanel';
import { ConfirmOverlay, ConfirmProvider, type ConfirmRequest } from './confirm';
import { ActionButton, classes } from './controls';
import { DataPanel } from './DataPanel';
import { ShortcutsPanel } from './ShortcutsPanel';
import { TrashPanel, TrashRetention } from './TrashPanel';

type SectionId = 'appearance' | 'shortcuts' | 'data' | 'trash' | 'about';

/** 设置分类，名称与图标与原型一致。 */
const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'appearance', label: '外观与交互', icon: 'sun' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'data', label: '数据与同步', icon: 'cloud' },
  { id: 'trash', label: '回收站', icon: 'trash' },
  { id: 'about', label: '关于', icon: 'info' },
];

export interface SettingsDialogProps {
  /** 关闭设置：桌面端隐藏设置窗口。 */
  onClose: () => void;
  /** 最小化设置窗口。 */
  onMinimize: () => void;
}

export function SettingsDialog({ onClose, onMinimize }: SettingsDialogProps) {
  const toast = useToast();
  const settings = useStoreSlice((state) => state.settings);
  const notes = useStoreSlice((state) => state.notes);
  const saveFailed = useStoreSlice((state) => state.saveFailed);
  const [section, setSection] = useState<SectionId>('appearance');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  // 确认层关闭后把焦点还给触发它的按钮。
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    void bridge
      .shortcutConflicts()
      .then(setConflicts)
      .catch(() => {});
  }, []);

  // 切换分类后回到内容顶部，与原型 renderPanel 一致。
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [section]);

  useEffect(() => {
    if (confirm) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  }, [confirm]);

  // 子控件（字体列表、说明气泡、数值框等）未处理的 Esc 关闭设置窗口。
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      if (confirm) setConfirm(null);
      else onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [confirm, onClose]);

  const save = useCallback(
    async (patch: Partial<Settings>): Promise<boolean> => {
      const saved = await store.updateSettings(patch);
      if (!saved) toast('设置未保存，请导出备份后重试', null, true);
      return saved;
    },
    [toast],
  );

  const openConfirm = useCallback((request: ConfirmRequest) => {
    returnFocus.current = document.activeElement;
    setConfirm(request);
  }, []);

  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  return (
    <ConfirmProvider value={openConfirm}>
      <IconSprite />
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-modal-title"
        tabIndex={-1}
        inert={confirm ? true : undefined}
        aria-hidden={confirm ? true : undefined}
      >
        <header className="modal-header" data-tauri-drag-region="">
          <h2 id="active-modal-title" data-tauri-drag-region="">
            设置
          </h2>
          <div className="settings-window-actions" data-tauri-drag-region="">
            <ActionButton label="最小化" icon="minus" className="icon-button" data-action="minimize-window" onClick={onMinimize} />
            <ActionButton label="关闭对话框" icon="x" className="icon-button" data-action="close-modal" onClick={onClose} />
          </div>
        </header>
        <div className="modal-body">
          <div className="settings-layout">
            <nav
              ref={nav}
              className="settings-nav"
              aria-label="设置分类"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={(event) => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = SECTIONS.findIndex((item) => item.id === section);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? SECTIONS.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length;
                setSection(SECTIONS[next].id);
                nav.current?.querySelector<HTMLElement>(`[data-section="${SECTIONS[next].id}"]`)?.focus();
              }}
            >
              {SECTIONS.map((item) => {
                const active = item.id === section;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={classes('settings-nav-button settings-nav-item', active && 'active')}
                    data-action=""
                    aria-label={item.label}
                    title={item.label}
                    data-section={item.id}
                    role="tab"
                    aria-controls="settings-panel"
                    id={`settings-tab-${item.id}`}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div
              ref={panel}
              className="settings-panel settings-content"
              id="settings-panel"
              role="tabpanel"
              data-section={section}
              aria-labelledby={`settings-tab-${section}`}
            >
              <div className="settings-panel-heading settings-content-header">
                <h3>{current.label}</h3>
                {section === 'trash' ? <TrashRetention days={settings.trashDays} save={save} /> : null}
              </div>
              {section === 'appearance' ? <AppearancePanel settings={settings} save={save} /> : null}
              {section === 'shortcuts' ? <ShortcutsPanel conflicts={conflicts} /> : null}
              {section === 'data' ? <DataPanel settings={settings} save={save} saveFailed={saveFailed} /> : null}
              {section === 'trash' ? <TrashPanel notes={notes} settings={settings} /> : null}
              {section === 'about' ? <AboutPanel /> : null}
            </div>
          </div>
        </div>
      </section>
      {confirm ? <ConfirmOverlay request={confirm} onClose={() => setConfirm(null)} /> : null}
      <ToastRegion />
    </ConfirmProvider>
  );
}
