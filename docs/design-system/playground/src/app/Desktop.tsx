/**
 * 桌面场景：在模拟的桌面上运行 SideNotes 的三个窗口。
 *
 * - 侧栏贴在屏幕边缘，宽度取设置中的宽度，并随字号等比加宽（T45）；鼠标移到边缘唤出，
 *   移出后按「移出后收起」的延迟收起；固定、编辑中或设置窗口打开期间保持展开。
 * - 速记浮窗 560 × 420、设置窗口 880 × 720 居中弹出，窗口尺寸不随字号变化，内容按字号缩放（T33）；
 *   按住标题区可以拖动，便于把浮窗移到不同的背景上检查材质。
 * - 字号设置是整页缩放：每个窗口的内容放大「字号 ÷ 13」倍，与现有应用的 WebView 缩放一致。
 * - Alt+Shift+S 呼出侧栏、Ctrl+Shift+Space 呼出速记（全局快捷键，在场景获得焦点时模拟）。
 *
 * 壁纸、工作窗口与任务栏是场景的一部分，不属于 SideNotes 的设计，不使用设计令牌。
 */

import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { resolveFontFamily } from '@/core/settings';
import { useNotes } from '../model/notes';
import type { SidebarViewOptions } from '../model/notes';
import { cx, FormContext } from '../ui/context';
import { TokenScope } from '../ui/Scope';
import type { SurfaceId } from '../surfaces';
import { CaptureWindow } from './CaptureWindow';
import { SettingsWindow, type SettingsSection } from './SettingsWindow';
import { SidebarPanel } from './SidebarPanel';
import { AppIcon } from './SidebarParts';
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

/**
 * 窗口：一个令牌作用域，内容按字号缩放。
 * 设置中选了具体字体时替换界面与正文的字体（标题与代码的字体仍跟随主题）；空值表示「跟随主题」，见 adaptation.md。
 */
function AppWindow({ className, style, zoom, surface, children }: { className: string; style?: CSSProperties; zoom: number; surface?: SurfaceId; children: ReactNode }) {
  const { settings } = useNotes();
  const form = useContext(FormContext);
  const font = settings.fontFamily ? resolveFontFamily(settings.fontFamily) : null;
  const fontStyle = font ? ({ '--sn-font-ui': font, '--sn-font-note': font } as CSSProperties) : null;
  return (
    <TokenScope surface={surface} className={cx('sn-window', className)} style={{ ...style, ...fontStyle, zoom }} toast={settings.toastPosition} form={form}>
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
    // 固定、设置窗口打开期间（T15）、编辑中时不收起（「编辑时保持展开」已去掉，编辑期间一律保持展开）。
    if (pinned || settingsWindow || phone || busy) return;
    hideTimer.current = window.setTimeout(() => setVisible(false), settings.hideDelay);
  }, [pinned, settingsWindow, phone, busy, settings.hideDelay]);

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
            <FloatingWindow kind="capture" draggable={!phone}>
              <AppWindow className="sn-capture-window" zoom={zoom} surface={surface}>
                <CaptureWindow
                  onClose={() => setCapture(false)}
                  onContinue={() => {
                    setCapture(false);
                    setVisible(true);
                  }}
                />
              </AppWindow>
            </FloatingWindow>
          ) : null}

          {settingsWindow ? (
            <FloatingWindow kind="settings" draggable={!phone}>
              <AppWindow className="sn-settings-window" zoom={zoom} surface={surface}>
                <SettingsWindow initial={settingsWindow} onClose={() => setSettingsWindow(null)} />
              </AppWindow>
            </FloatingWindow>
          ) : null}
        </div>
        {phone ? (
          <div className="sn-phone-bar" aria-hidden="true">
            <span />
          </div>
        ) : platform === 'windows' ? (
          <Taskbar
            sidebarVisible={visible}
            settingsOpen={Boolean(settingsWindow)}
            onSidebar={() => setVisible((current) => !current)}
            onCapture={() => setCapture(true)}
          />
        ) : (
          <div className="sn-desk-dock" aria-hidden="true">
            <span className="sn-dock-app is-a" />
            <span className="sn-dock-app is-b" />
            <button type="button" className="sn-dock-app is-sidenotes" aria-label="SideNotes" onClick={() => setVisible((current) => !current)}>
              <AppIcon />
            </button>
          </div>
        )}
      </div>
    </FormContext.Provider>
  );
}

/** 按住标题区拖动时，从这些控件上按下不算拖动。 */
const INTERACTIVE = 'button, input, textarea, select, a, [role="button"], [contenteditable="true"]';

/**
 * 浮动窗口（速记浮窗、设置窗口）：居中弹出；按住标题区（data-drag-region）可以拖动，位置限制在桌面区域之内，
 * 关闭后再打开回到正中。拖动用来把浮窗移到不同的背景上检查材质，例如磨砂玻璃。
 * 舞台缩小显示时，指针的位移按缩放比例换算；按下时取消默认动作，编辑区的焦点不会因此丢失。
 */
function FloatingWindow({ kind, draggable, children }: { kind: 'capture' | 'settings'; draggable: boolean; children: ReactNode }) {
  const drag = useRef<{ pointer: number; x: number; y: number; from: { x: number; y: number }; scale: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!draggable || event.button !== 0 || !target?.closest('[data-drag-region]') || target.closest(INTERACTIVE)) return;
    const element = event.currentTarget;
    const scale = element.getBoundingClientRect().width / element.offsetWidth || 1;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: offset, scale };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const element = event.currentTarget;
    const frame = element.parentElement;
    if (!current || current.pointer !== event.pointerId || !frame) return;
    const limitX = Math.max(0, (frame.clientWidth - element.offsetWidth) / 2);
    const limitY = Math.max(0, (frame.clientHeight - element.offsetHeight) / 2);
    const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
    setOffset({
      x: clamp(current.from.x + (event.clientX - current.x) / current.scale, limitX),
      y: clamp(current.from.y + (event.clientY - current.y) / current.scale, limitY),
    });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  return (
    <div className={cx('sn-floating-frame', `is-${kind}`)}>
      <div
        className="sn-window-box"
        style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Windows 11 任务栏：居中的图标与右侧的托盘，托盘里的 SideNotes 图标切换侧栏。
 * 侧栏与速记浮窗不出现在任务栏中；设置窗口打开时出现一个带运行指示的图标，与现有应用一致（设置窗口 skipTaskbar 为 false）。
 */
function Taskbar({
  sidebarVisible,
  settingsOpen,
  onSidebar,
  onCapture,
}: {
  sidebarVisible: boolean;
  settingsOpen: boolean;
  onSidebar: () => void;
  onCapture: () => void;
}) {
  return (
    <div className="sn-taskbar">
      <div className="sn-taskbar-apps" aria-hidden="true">
        <span className="sn-taskbar-start" />
        <span className="sn-taskbar-app is-a" />
        <span className="sn-taskbar-app is-b" />
        <span className="sn-taskbar-app is-c" />
        {settingsOpen ? (
          <span className="sn-taskbar-app is-sidenotes" title="SideNotes 设置">
            <AppIcon />
          </span>
        ) : null}
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
          <AppIcon />
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
