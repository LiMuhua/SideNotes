/**
 * 应用根组件。
 *
 * 由 `main.tsx` 根据当前窗口标签决定渲染侧栏、速记浮窗还是设置窗口；
 * 三个窗口各自是独立的 WebView，共享同一套状态仓库代码，经跨窗口同步保持一致。
 * 根组件还负责把后端事件（边缘唤出、全局热键、托盘菜单）转成界面动作，
 * 并把主题、明暗、结构差异与字体写到页面根节点，供 CSS 取设计令牌；字号按全局的界面缩放应用到各窗口。
 */

import { useEffect, useState } from 'react';
import { Icon, IconSprite } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { Capture } from './components/Capture';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ToastProvider } from './hooks/useToast';
import { useStoreSlice } from './hooks/useStore';
import * as store from './core/store';
import * as bridge from './core/bridge';
import { resolveTheme, resolveFontFamily, sidebarWindowWidth, uiZoom } from './core/settings';
import { applySurface } from './core/surfaces';
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

  /* ==================== 拖入文件的兜底 ==================== */
  // 窗口关闭了 Tauri 的拖放接管，拖入的文件由网页处理：侧栏见 useFileDrop，附件弹窗与速记浮窗各自接收。
  // 没人处理的位置也要阻止默认行为，否则松开时窗口会打开这个文件，离开应用界面。
  useEffect(() => {
    const guard = (event: DragEvent): void => {
      if (event.defaultPrevented || !Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  /* ==================== 主题、明暗与字体 ==================== */
  // 主题、明暗与 6 项结构差异写在根节点的 data-sn-* 上（core/surfaces），三个窗口的样式都按它们取令牌。
  // 「跟随系统」时监听系统的明暗变化，三个窗口立即切换（adaptation.md 第六节）。
  const [systemDark, setSystemDark] = useState(() => resolveTheme('system') === 'dark');
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystemDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
    const root = document.documentElement;
    applySurface(root, settings.surface, theme);
    root.style.colorScheme = theme;
    // 提示条位置作用于三个窗口（theme.css 按 data-sn-toast 选择）。
    root.dataset.snToast = settings.toastPosition;
    document.body.dataset.edge = settings.edge;
    // 选了具体字体时只替换界面与正文的字体，标题与代码的字体仍跟随主题；跟随主题时用令牌中的字体。
    const font = resolveFontFamily(settings.fontFamily);
    for (const name of ['--sn-font-ui', '--sn-font-note']) {
      if (font) root.style.setProperty(name, font);
      else root.style.removeProperty(name);
    }
    root.style.setProperty('--sidebar-width', `${settings.width}px`);
    root.style.setProperty('--card-max-height', `${settings.cardMaxHeight}px`);
    root.style.setProperty('--note-content-max-height', `${settings.cardMaxHeight}px`);
  }, [settings, systemDark]);

  /* ==================== 字号：全局的界面缩放 ==================== */
  // 字号不只改正文：各窗口的 WebView 整页缩放到「字号 ÷ 13」倍，正文显示为所选字号，
  // 按钮、标签与设置窗口的文字随之等比放大，布局与原型保持同样的比例。
  const { fontSize } = settings;
  useEffect(() => {
    void bridge.setUiZoom(uiZoom(fontSize));
  }, [fontSize]);

  /* ==================== 侧栏窗口布局 ==================== */
  // 只在宽度、字号、贴边或边缘唤出变化时通知后端，避免任意状态变化都重设窗口位置，
  // 打断正在进行的滑入滑出动画。窗口宽度随字号等比加宽。
  const { edge, width, edgeTrigger } = settings;
  useEffect(() => {
    if (role !== 'sidebar' || !ready) return;
    void bridge.applySidebarLayout({ edge, width: sidebarWindowWidth(width, fontSize) }, edgeTrigger);
  }, [role, ready, edge, width, fontSize, edgeTrigger]);

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
    const layout = () => bridge.sidebarLayout(store.getState().settings);

    // 鼠标进入屏幕边缘：后端只在侧栏隐藏时发出，直接展开。
    // 不能再按「焦点在编辑区」跳过：侧栏收起后页面焦点仍留在原处，例如新建卡片保存后焦点留在编辑区，
    // 以前据此判断为「正在输入」而忽略唤出，侧栏就再也呼不出来，直到焦点移走。
    void bridge
      .onAppEvent(bridge.APP_EVENTS.edgeEnter, () => {
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
