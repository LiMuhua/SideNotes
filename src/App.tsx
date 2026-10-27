/**
 * 应用根组件。
 *
 * 由 `main.tsx` 根据当前窗口标签决定渲染侧栏、速记浮窗还是设置窗口；
 * 三个窗口各自是独立的 WebView，共享同一套状态仓库代码，经跨窗口同步保持一致。
 * 根组件还负责把后端事件（边缘唤出、全局热键、托盘菜单）转成界面动作，
 * 并把主题、字体与材质应用到页面根节点，供 CSS 切换外观。
 */

import { useEffect } from 'react';
import { Icon, IconSprite } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { Capture } from './components/Capture';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ToastProvider } from './hooks/useToast';
import { useStoreSlice } from './hooks/useStore';
import * as store from './core/store';
import * as bridge from './core/bridge';
import { resolveTheme, resolveFontFamily } from './core/settings';
import type { WindowRole } from './main';

export interface AppProps {
  role: WindowRole;
}

/** 设置窗口的窗口操作；放在模块级保证引用稳定。 */
const closeSettings = (): void => void bridge.hideSettings();
const minimizeSettings = (): void => void bridge.minimizeWindow();

/** 应用根。 */
export function App({ role }: AppProps) {
  const ready = useStoreSlice((state) => state.ready);
  const settings = useStoreSlice((state) => state.settings);

  /* ==================== 首次加载与跨窗口同步 ==================== */
  useEffect(() => {
    void store.initialize();
    return store.connectSync();
  }, []);

  /* ==================== 主题、字体与材质 ==================== */
  // 原型同时在 html 与 body 上标记主题和材质，部分样式按 :root 匹配。
  useEffect(() => {
    const theme = resolveTheme(settings.theme);
    const root = document.documentElement;
    for (const node of [root, document.body]) {
      node.dataset.theme = theme;
      node.dataset.surface = settings.surface;
    }
    document.body.dataset.edge = settings.edge;
    root.style.setProperty('--note-font-family', resolveFontFamily(settings.fontFamily));
    root.style.setProperty('--note-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--sidebar-width', `${settings.width}px`);
  }, [settings]);

  /* ==================== 侧栏窗口布局 ==================== */
  // 只在宽度、贴边或边缘唤出变化时通知后端，避免任意状态变化都重设窗口位置，
  // 打断正在进行的滑入滑出动画。
  const { edge, width, edgeTrigger } = settings;
  useEffect(() => {
    if (role !== 'sidebar' || !ready) return;
    void bridge.applySidebarLayout({ edge, width }, edgeTrigger);
  }, [role, ready, edge, width, edgeTrigger]);

  /* ==================== 全局退出事件 ==================== */
  // 托盘菜单的退出必须在任何加载状态下都可用，因此不放在 Sidebar 内部。
  useEffect(() => {
    if (role !== 'sidebar') return;
    let dispose: (() => void) | null = null;
    void bridge
      .onAppEvent(bridge.APP_EVENTS.trayQuit, () => {
        // 先让草稿落盘，再真正退出；失败也允许退出，避免卡住。
        void store.persistDraft().finally(() => void bridge.quitApp());
      })
      .then((unlisten) => {
        dispose = unlisten;
      });
    return () => dispose?.();
  }, [role]);

  /* ==================== 后端事件 ==================== */
  useEffect(() => {
    if (role !== 'sidebar') return;
    const cleanups: Array<() => void> = [];

    // 统一的布局参数：带上动画时长，否则窗口会瞬间跳转而不平移。
    const layout = () => {
      const current = store.getState().settings;
      return { edge: current.edge, width: current.width, animDuration: current.animDuration };
    };

    // 鼠标进入屏幕边缘：编辑中或正在输入时不自动展开，避免打断。
    void bridge
      .onAppEvent(bridge.APP_EVENTS.edgeEnter, () => {
        const active = document.activeElement;
        if (active && active.closest('.live-markdown-editor')) return;
        void bridge.showSidebar(layout());
      })
      .then((unlisten) => cleanups.push(unlisten));

    // 全局热键：呼出侧栏。
    void bridge
      .onAppEvent(bridge.APP_EVENTS.hotkeySidebar, () => {
        void bridge.toggleSidebar(layout());
      })
      .then((unlisten) => cleanups.push(unlisten));

    // 托盘：显示侧栏。
    void bridge
      .onAppEvent(bridge.APP_EVENTS.traySidebar, () => {
        void bridge.showSidebar(layout());
      })
      .then((unlisten) => cleanups.push(unlisten));

    // 托盘：打开设置窗口。
    void bridge
      .onAppEvent(bridge.APP_EVENTS.traySettings, () => {
        void bridge.showSettings();
      })
      .then((unlisten) => cleanups.push(unlisten));

    // 侧栏内的设置按钮通过自定义事件打开设置窗口。
    const openSettings = (): void => {
      void bridge.showSettings();
    };
    window.addEventListener('sidenotes:open-settings', openSettings);
    cleanups.push(() => window.removeEventListener('sidenotes:open-settings', openSettings));

    return () => cleanups.forEach((fn) => fn());
  }, [role]);

  useEffect(() => {
    if (role !== 'capture') return;
    const cleanups: Array<() => void> = [];
    void bridge
      .onAppEvent(bridge.APP_EVENTS.hotkeyCapture, () => {
        void bridge.toggleCapture();
      })
      .then((unlisten) => cleanups.push(unlisten));
    void bridge
      .onAppEvent(bridge.APP_EVENTS.trayCapture, () => {
        void bridge.showCapture();
      })
      .then((unlisten) => cleanups.push(unlisten));
    return () => cleanups.forEach((fn) => fn());
  }, [role]);

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-label="正在加载记录">
        {/* 加载阶段业务组件尚未挂载，图标定义需要在这里先行提供。 */}
        <IconSprite />
        <span className="app-loading-spinner" aria-hidden="true">
          <Icon name="loader" />
        </span>
        正在加载记录…
      </div>
    );
  }

  return (
    <ToastProvider>
      {role === 'sidebar' ? <Sidebar /> : null}
      {role === 'capture' ? <Capture /> : null}
      {role === 'settings' ? <SettingsDialog onClose={closeSettings} onMinimize={minimizeSettings} /> : null}
    </ToastProvider>
  );
}
