/**
 * 应用根组件。
 *
 * 由 `main.tsx` 根据当前窗口标签决定渲染侧栏还是速记浮窗；
 * 两者共享同一份状态仓库与桥接层。根组件还负责把后端事件
 * （边缘唤出、全局热键、托盘菜单）转成界面动作，并把主题、字体、
 * 材质应用到 body 上，供 CSS 切换外观。
 */

import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Capture } from './components/Capture';
import { SettingsModal } from './components/SettingsModal';
import { ToastProvider } from './hooks/useToast';
import * as store from './core/store';
import * as bridge from './core/bridge';
import { resolveTheme, resolveFontFamily } from './core/settings';
import type { WindowRole } from './main';

export interface AppProps {
  role: WindowRole;
}

/** 应用根。 */
export function App({ role }: AppProps) {
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* ==================== 首次加载 ==================== */
  useEffect(() => {
    let cancelled = false;
    void store.initialize().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ==================== 主题、字体与材质 ==================== */
  useEffect(() => {
    const state = store.getState();
    const theme = resolveTheme(state.settings.theme);
    document.body.dataset.theme = theme;
    document.body.dataset.edge = state.settings.edge;
    document.body.dataset.surface = state.settings.surface;
    const root = document.documentElement;
    root.style.setProperty('--note-font-family', resolveFontFamily(state.settings.fontFamily));
    root.style.setProperty('--note-font-size', `${state.settings.fontSize}px`);
    root.style.setProperty('--sidebar-width', `${state.settings.width}px`);
  });

  /* ==================== 后端事件 ==================== */
  useEffect(() => {
    if (role !== 'sidebar') return;
    const cleanups: Array<() => void> = [];

    // 鼠标进入屏幕边缘：交由侧栏自身决定是否展开。
    void bridge.onAppEvent(bridge.APP_EVENTS.edgeEnter, () => {
      // 编辑中或正在输入时不自动展开，避免打断。
      const active = document.activeElement;
      if (active && active.closest('.live-markdown-editor')) return;
      void bridge.showSidebar({ edge: store.getState().settings.edge, width: store.getState().settings.width });
    }).then((unlisten) => cleanups.push(unlisten));

    // 全局热键：呼出侧栏。
    void bridge.onAppEvent(bridge.APP_EVENTS.hotkeySidebar, () => {
      void bridge.toggleSidebar({ edge: store.getState().settings.edge, width: store.getState().settings.width });
    }).then((unlisten) => cleanups.push(unlisten));

    // 托盘：显示侧栏。
    void bridge.onAppEvent(bridge.APP_EVENTS.traySidebar, () => {
      void bridge.showSidebar({ edge: store.getState().settings.edge, width: store.getState().settings.width });
    }).then((unlisten) => cleanups.push(unlisten));

    // 打开设置的自定义事件（侧栏与托盘共用）。
    const openSettings = (): void => setSettingsOpen(true);
    window.addEventListener('sidenotes:open-settings', openSettings);
    cleanups.push(() => window.removeEventListener('sidenotes:open-settings', openSettings));

    return () => cleanups.forEach((fn) => fn());
  }, [role]);

  useEffect(() => {
    if (role !== 'capture') return;
    const cleanups: Array<() => void> = [];
    void bridge.onAppEvent(bridge.APP_EVENTS.hotkeyCapture, () => {
      void bridge.toggleCapture();
    }).then((unlisten) => cleanups.push(unlisten));
    void bridge.onAppEvent(bridge.APP_EVENTS.trayCapture, () => {
      void bridge.showCapture();
    }).then((unlisten) => cleanups.push(unlisten));
    return () => cleanups.forEach((fn) => fn());
  }, [role]);

  /* ==================== 设置变更后同步窗口布局 ==================== */
  useEffect(() => {
    if (role !== 'sidebar') return;
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      void bridge.applySidebarLayout(
        { edge: state.settings.edge, width: state.settings.width },
        state.settings.edgeTrigger,
      );
    });
    return unsubscribe;
  }, [role]);

  /* ==================== 窗口失焦时隐藏（非固定、非编辑） ==================== */
  useEffect(() => {
    if (role !== 'sidebar') return;
    const handleBlur = (): void => {
      // 编辑中或固定时不隐藏，避免切到设置浮层就丢失侧栏。
      if (store.getState().saveFailed) return;
      // 失焦立即收起过于激进：只有移到窗口外才收起，由侧栏的 onMouseLeave 处理。
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [role]);

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-label="正在加载记录">
        <span className="icon" aria-hidden="true">⟳</span>
        正在加载记录…
      </div>
    );
  }

  return (
    <ToastProvider>
      {role === 'sidebar' ? <Sidebar /> : <Capture />}
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </ToastProvider>
  );
}
