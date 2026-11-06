/**
 * 桌面场景：在模拟的桌面上运行 SideNotes 的三个窗口。
 *
 * - 侧栏贴在屏幕边缘，宽度取设置中的宽度，并随字号等比加宽（T45）；鼠标移到边缘唤出，
 *   移出后按「移出后收起」的延迟收起；固定、编辑中（「编辑时保持展开」）或设置窗口打开期间保持展开。
 * - 速记浮窗 560 × 420、设置窗口 880 × 720 居中弹出，窗口尺寸不随字号变化，内容按字号缩放（T33）。
 * - 字号设置是整页缩放：每个窗口的内容放大「字号 ÷ 13」倍，与现有应用的 WebView 缩放一致。
 * - Alt+Shift+S 呼出侧栏、Ctrl+Shift+Space 呼出速记（全局快捷键，在场景获得焦点时模拟）。
 *
 * 壁纸、工作窗口与任务栏是场景的一部分，不属于 SideNotes 的设计，不使用设计令牌。
 */

import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNotes } from '../model/notes';
import type { SidebarViewOptions } from '../model/notes';
import { cx, FormContext } from '../ui/context';
import { TokenScope } from '../ui/Scope';
import type { SurfaceId } from '../surfaces';
import { CaptureWindow } from './CaptureWindow';
import { SettingsWindow, type SettingsSection } from './SettingsWindow';
import { SidebarPanel } from './SidebarPanel';
import { BrandMark } from './SidebarParts';
import { WorkWindow } from './WorkWindow';

export interface DesktopInitial {
  sidebar?: 'open' | 'hidden';
  pinned?: boolean;
  capture?: boolean;
  settings?: SettingsSection | null;
  view?: SidebarViewOptions;
}

export interface DesktopProps {
  form: 'desktop' | 'phone';
  platform: 'windows' | 'linux';
  wallpaper: 'light' | 'dark' | 'busy';
  initial?: DesktopInitial;
  /** 方案对比页为每个场景指定方向。 */
  surface?: SurfaceId;
  /** 单场景页面：页面级监听全局快捷键。 */
  primary?: boolean;
}

/** 窗口：一个令牌作用域，内容按字号缩放。 */
function AppWindow({ className, style, zoom, surface, children }: { className: string; style?: CSSProperties; zoom: number; surface?: SurfaceId; children: ReactNode }) {
  const { settings } = useNotes();
  const form = useContext(FormContext);
  return (
    <TokenScope surface={surface} className={cx('sn-window', className)} style={{ ...style, zoom }} toast={settings.toastPosition} form={form}>
      {children}
    </TokenScope>
  );
}

export function Desktop({ form, platform, wallpaper, initial = {}, surface, primary = false }: DesktopProps) {
  const data = useNotes();
  const { settings } = data;
  const [visible, setVisible] = useState(initial.sidebar !== 'hidden');
  const [pinned, setPinned] = useState(Boolean(initial.pinned));
  const [capture, setCapture] = useState(Boolean(initial.capture));
  const [settingsWindow, setSettingsWindow] = useState<SettingsSection | null>(initial.settings ?? null);
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const zoom = settings.fontSize / 13;
  const phone = form === 'phone';

  const cancelHide = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    // 固定、设置窗口打开期间（T15）、编辑中且开启了「编辑时保持展开」时不收起。
    if (pinned || settingsWindow || phone || (busy && settings.protectEditing)) return;
    hideTimer.current = window.setTimeout(() => setVisible(false), settings.hideDelay);
  }, [pinned, settingsWindow, phone, busy, settings.protectEditing, settings.hideDelay]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // 全局快捷键的模拟：页面获得焦点时生效。
  useEffect(() => {
    if (!primary) return;
    const listener = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.altKey && event.shiftKey && key === 's') {
        event.preventDefault();
        setVisible((current) => !current);
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.code === 'Space' || key === ' ')) {
        event.preventDefault();
        setCapture(true);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [primary]);

  const edge = phone ? 'right' : settings.edge;
  const sidebarStyle = {
    // 侧栏窗口按字号等比加宽：设置中的宽度按 13px 字号计（T45）。
    width: phone ? undefined : settings.width * zoom,
    '--desk-anim': `${settings.animDuration}ms`,
  } as CSSProperties;

  return (
    <FormContext.Provider value={form}>
      <div className={cx('sn-desktop', `is-${form}`)} data-wallpaper={wallpaper} data-platform={platform} data-edge={edge}>
        <div className="sn-desk-wallpaper" aria-hidden="true" />
        {phone ? <div className="sn-phone-status" aria-hidden="true"><span>14:32</span><span>5G ▮▮▮</span></div> : null}
        {platform === 'linux' && !phone ? (
          <div className="sn-desk-topbar" aria-hidden="true">
            <span>活动</span>
            <span>11月5日 14:32</span>
            <span>▾</span>
          </div>
        ) : null}
        <div className="sn-desk-area">
          {phone ? null : <WorkWindow />}

          {!phone && !visible && settings.edgeTrigger ? (
            <div className="sn-edge-zone" data-edge={edge} onPointerEnter={() => setVisible(true)} aria-hidden="true">
              <span className="sn-edge-hint">移到边缘唤出侧栏 · Alt+Shift+S</span>
            </div>
          ) : null}

          <div
            className={cx('sn-sidebar-frame', visible ? 'is-visible' : 'is-hidden')}
            data-edge={edge}
            style={sidebarStyle}
            onPointerEnter={cancelHide}
            onPointerLeave={scheduleHide}
          >
            <AppWindow className="sn-sidebar-window" zoom={zoom} surface={surface}>
              <SidebarPanel
                pinned={pinned}
                linked={Boolean(settingsWindow)}
                primary={primary}
                initial={initial.view}
                onTogglePinned={() => setPinned((current) => !current)}
                onHide={() => setVisible(false)}
                onOpenSettings={() => setSettingsWindow('appearance')}
                onBusyChange={setBusy}
              />
            </AppWindow>
          </div>

          {capture ? (
            <div className="sn-floating-frame is-capture">
              <div className="sn-window-box">
                <AppWindow className="sn-capture-window" zoom={zoom} surface={surface}>
                  <CaptureWindow
                    onClose={() => setCapture(false)}
                    onContinue={() => {
                      setCapture(false);
                      setVisible(true);
                    }}
                  />
                </AppWindow>
              </div>
            </div>
          ) : null}

          {settingsWindow ? (
            <div className="sn-floating-frame is-settings">
              <div className="sn-window-box">
                <AppWindow className="sn-settings-window" zoom={zoom} surface={surface}>
                  <SettingsWindow initial={settingsWindow} onClose={() => setSettingsWindow(null)} />
                </AppWindow>
              </div>
            </div>
          ) : null}
        </div>
        {phone ? (
          <div className="sn-phone-bar" aria-hidden="true">
            <span />
          </div>
        ) : platform === 'windows' ? (
          <Taskbar sidebarVisible={visible} onSidebar={() => setVisible((current) => !current)} onCapture={() => setCapture(true)} />
        ) : (
          <div className="sn-desk-dock" aria-hidden="true">
            <span className="sn-dock-app is-a" />
            <span className="sn-dock-app is-b" />
            <button type="button" className="sn-dock-app is-sidenotes" aria-label="SideNotes" onClick={() => setVisible((current) => !current)}>
              <BrandMark small />
            </button>
          </div>
        )}
      </div>
    </FormContext.Provider>
  );
}

/** Windows 11 任务栏：居中的图标与右侧的托盘，托盘里的 SideNotes 图标切换侧栏。 */
function Taskbar({ sidebarVisible, onSidebar, onCapture }: { sidebarVisible: boolean; onSidebar: () => void; onCapture: () => void }) {
  return (
    <div className="sn-taskbar">
      <div className="sn-taskbar-apps" aria-hidden="true">
        <span className="sn-taskbar-start" />
        <span className="sn-taskbar-app is-a" />
        <span className="sn-taskbar-app is-b" />
        <span className="sn-taskbar-app is-c" />
      </div>
      <div className="sn-taskbar-tray">
        <button type="button" className="sn-tray-button" aria-label="速记 · Ctrl+Shift+Space" title="速记 · Ctrl+Shift+Space" onClick={onCapture}>
          ✎
        </button>
        <button
          type="button"
          className={cx('sn-tray-button', sidebarVisible && 'is-active')}
          aria-label="SideNotes 侧栏 · Alt+Shift+S"
          title="SideNotes 侧栏 · Alt+Shift+S"
          onClick={onSidebar}
        >
          <BrandMark small />
        </button>
        <span className="sn-tray-clock">
          14:32
          <br />
          2026/11/5
        </span>
      </div>
    </div>
  );
}
