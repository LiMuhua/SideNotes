/**
 * 应用根组件。
 *
 * 由 `main.tsx` 根据当前窗口标签决定渲染侧栏、速记浮窗还是设置窗口；
 * 三个窗口各自是独立的 WebView，共享同一套状态仓库代码，经跨窗口同步保持一致。
 * 边缘唤出、全局热键与托盘的「显示侧栏」「快捷速记」由后端直接完成，不经过这里；
 * 根组件只处理托盘的设置与退出，把侧栏布局同步给后端，
 * 并把主题、明暗、结构差异与字体写到页面根节点，供 CSS 取设计令牌；字号按全局的界面缩放应用到各窗口。
 */

import { useEffect, useState } from 'react';
import { Icon, IconSprite } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { Capture } from './components/Capture';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { NoteWindow } from './components/NoteWindow';
import { Overlay } from './components/Overlay';
import { DialogWindow } from './components/DialogWindow';
import { ToastProvider } from './hooks/useToast';
import { useStoreSlice } from './hooks/useStore';
import * as store from './core/store';
import * as bridge from './core/bridge';
import { resolveTheme, resolveFontFamily, uiZoom } from './core/settings';
import { applySurface, windowMaterial } from './core/surfaces';
import { appIconFolder, appIconSource } from './core/appIcons';
import { useCustomAppIcon } from './hooks/useAppIcon';
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

  /* ==================== 窗口材质（T84） ==================== */
  // 侧栏、速记浮窗与记录窗口是透明窗口：按主题加亚克力（Windows 11、磨砂玻璃）、只透明（杂志）或铺满不透明的底色。
  // 根节点的 data-sn-window 供 window.css 去掉对应的留白、圆角与投影；设置窗口与弹窗窗口一律不透明，不写。
  // 动画层（T83）始终全透明、不要系统投影。
  const { surface } = settings;
  useEffect(() => {
    if (role === 'settings' || role === 'dialog') return;
    const material = role === 'overlay' ? 'clear' : windowMaterial(surface);
    document.documentElement.dataset.snWindow = material;
    void bridge.setWindowMaterial(material);
  }, [role, surface]);

  /* ==================== 应用图标（T85） ==================== */
  // 品牌标记由各组件按设置显示（hooks/useAppIcon）；这里更换网页图标，并由侧栏请后端更换各窗口与托盘的图标，
  // 后端对所有窗口一次生效，之后新建的记录窗口也用它。上传的图片读取之前不更换，免得先换成默认图标再换回来。
  const { appIcon } = settings;
  const customIcon = useCustomAppIcon();
  const iconSource = appIconSource(appIcon, customIcon.url);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link || link.getAttribute('href') === iconSource) return;
    link.type = appIcon === 'custom' && customIcon.url ? 'image/png' : 'image/svg+xml';
    link.setAttribute('href', iconSource);
  }, [appIcon, customIcon.url, iconSource]);
  useEffect(() => {
    if (role !== 'sidebar' || !ready || !customIcon.loaded) return;
    void bridge.applyAppIcon(appIconFolder(appIcon, Boolean(customIcon.url))).catch(() => {
      /* 换不了时保留原来的图标，品牌标记照常按设置显示。 */
    });
  }, [role, ready, appIcon, customIcon.loaded, customIcon.url]);

  /* ==================== 字号：全局的界面缩放 ==================== */
  // 字号不只改正文：各窗口的 WebView 整页缩放到「字号 ÷ 13」倍，正文显示为所选字号，
  // 按钮、标签与设置窗口的文字随之等比放大，布局与原型保持同样的比例。
  const { fontSize } = settings;
  useEffect(() => {
    void bridge.setUiZoom(uiZoom(fontSize));
  }, [fontSize]);

  /* ==================== 侧栏窗口布局 ==================== */
  // 只在宽度、字号、贴边、动画时长或边缘唤出变化时通知后端，避免任意状态变化都重设窗口位置，
  // 打断正在进行的滑入滑出动画。窗口宽度随字号等比加宽。后端记下这份布局，
  // 边缘唤出、全局热键与托盘直接按它显示或切换侧栏。
  // 主题决定窗口是否离开屏幕边缘（windowGap），所以主题变化时也重新对齐。
  const { edge, width, edgeTrigger, animDuration } = settings;
  useEffect(() => {
    if (role !== 'sidebar' || !ready) return;
    void bridge.applySidebarLayout(bridge.sidebarLayout({ edge, width, fontSize, animDuration, surface }), edgeTrigger);
  }, [role, ready, edge, width, fontSize, animDuration, edgeTrigger, surface]);

  /* ==================== 全局退出事件 ==================== */
  // 托盘菜单的退出必须在任何加载状态下都可用，因此不放在 Sidebar 内部。
  useEffect(() => {
    if (role !== 'sidebar') return;
    return bridge.subscribeAll([
      bridge.onAppEvent(bridge.APP_EVENTS.trayQuit, () => {
        // 先让草稿落盘，再真正退出；失败也允许退出，避免卡住。
        void store.persistDraft().finally(() => void bridge.quitApp());
      }),
    ]);
  }, [role]);

  /* ==================== 后端事件 ==================== */
  // 订阅用 subscribeAll 建立：清理先于订阅建立完成时也能取消，同一事件不会留下两个处理函数。
  useEffect(() => {
    if (role !== 'sidebar') return;

    const unsubscribe = bridge.subscribeAll([
      // 托盘：打开设置窗口。
      bridge.onAppEvent(bridge.APP_EVENTS.traySettings, () => {
        void bridge.showSettings(uiZoom(store.getState().settings.fontSize));
      }),
    ]);

    // 侧栏内的设置按钮通过自定义事件打开设置窗口。
    const openSettings = (): void => {
      void bridge.showSettings(uiZoom(store.getState().settings.fontSize));
    };
    window.addEventListener('sidenotes:open-settings', openSettings);

    return () => {
      unsubscribe();
      window.removeEventListener('sidenotes:open-settings', openSettings);
    };
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
      {role === 'note' ? <NoteWindow /> : null}
      {role === 'overlay' ? <Overlay /> : null}
      {role === 'dialog' ? <DialogWindow /> : null}
    </ToastProvider>
  );
}
