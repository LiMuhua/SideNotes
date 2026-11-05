/**
 * Playground 的全局状态：当前页面、设计方向、明暗主题、平台、屏幕尺寸与壁纸。
 *
 * 状态写入地址栏参数，刷新或分享链接后保持同一个视图；
 * `frame=bare` 只显示场景本身，便于在指定尺寸下截图验证。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DIRECTION_IDS, type DirectionId } from '../directions';

export type PageId = 'sidebar' | 'capture' | 'settings' | 'components' | 'tokens' | 'compare';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Platform = 'windows' | 'linux';
export type ViewportId = 'fit' | '1920x1080' | '1440x900' | '1280x800' | '1024x768' | 'phone';
export type Wallpaper = 'auto' | 'light' | 'dark' | 'busy';

export interface Viewport {
  id: ViewportId;
  label: string;
  width: number | null;
  height: number | null;
}

export const VIEWPORTS: readonly Viewport[] = [
  { id: 'fit', label: '适应预览区', width: null, height: null },
  { id: '1920x1080', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '1440x900', label: '1440 × 900', width: 1440, height: 900 },
  { id: '1280x800', label: '1280 × 800', width: 1280, height: 800 },
  { id: '1024x768', label: '1024 × 768', width: 1024, height: 768 },
  { id: 'phone', label: 'Android 412 × 892', width: 412, height: 892 },
];

export const PAGES: ReadonlyArray<{ id: PageId; label: string; group: 'app' | 'system' }> = [
  { id: 'sidebar', label: '侧栏', group: 'app' },
  { id: 'capture', label: '速记浮窗', group: 'app' },
  { id: 'settings', label: '设置', group: 'app' },
  { id: 'components', label: '组件', group: 'system' },
  { id: 'tokens', label: '令牌', group: 'system' },
  { id: 'compare', label: '五套对比', group: 'system' },
];

export const WALLPAPERS: ReadonlyArray<{ id: Wallpaper; label: string }> = [
  { id: 'auto', label: '跟随主题' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'busy', label: '繁杂' },
];

interface PlaygroundState {
  page: PageId;
  direction: DirectionId;
  theme: ThemeMode;
  platform: Platform;
  viewport: ViewportId;
  wallpaper: Wallpaper;
  bare: boolean;
}

interface PlaygroundContextValue extends PlaygroundState {
  resolvedTheme: 'light' | 'dark';
  /** 壁纸的实际取值：跟随主题时按明暗决定。 */
  resolvedWallpaper: 'light' | 'dark' | 'busy';
  set: (patch: Partial<PlaygroundState>) => void;
}

const PlaygroundContext = createContext<PlaygroundContextValue | null>(null);

const DEFAULT_STATE: PlaygroundState = {
  page: 'sidebar',
  direction: 'workbench',
  theme: 'system',
  platform: 'windows',
  viewport: 'fit',
  wallpaper: 'auto',
  bare: false,
};

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** 从地址栏读取状态。 */
function readState(): PlaygroundState {
  const params = new URLSearchParams(window.location.search);
  return {
    page: pick(params.get('page'), PAGES.map((page) => page.id), DEFAULT_STATE.page),
    direction: pick(params.get('direction'), DIRECTION_IDS, DEFAULT_STATE.direction),
    theme: pick(params.get('theme'), ['light', 'dark', 'system'] as const, DEFAULT_STATE.theme),
    platform: pick(params.get('platform'), ['windows', 'linux'] as const, DEFAULT_STATE.platform),
    viewport: pick(params.get('viewport'), VIEWPORTS.map((viewport) => viewport.id), DEFAULT_STATE.viewport),
    wallpaper: pick(params.get('wallpaper'), WALLPAPERS.map((item) => item.id), DEFAULT_STATE.wallpaper),
    bare: params.get('frame') === 'bare',
  };
}

/** 把状态写回地址栏，只写与默认值不同的参数。 */
function writeState(state: PlaygroundState): void {
  const params = new URLSearchParams();
  (Object.keys(DEFAULT_STATE) as Array<keyof PlaygroundState>).forEach((key) => {
    if (key === 'bare') {
      if (state.bare) params.set('frame', 'bare');
    } else if (state[key] !== DEFAULT_STATE[key]) {
      params.set(key, String(state[key]));
    }
  });
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

/** 跟随系统时监听系统明暗变化，切换后立即生效（现有应用只在设置变化时判断一次，见现状报告）。 */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaygroundState>(readState);
  const systemDark = useSystemDark();

  useEffect(() => writeState(state), [state]);

  const set = useCallback((patch: Partial<PlaygroundState>) => setState((current) => ({ ...current, ...patch })), []);
  const resolvedTheme = state.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.theme;
  const resolvedWallpaper = state.wallpaper === 'auto' ? resolvedTheme : state.wallpaper;

  const value = useMemo(() => ({ ...state, resolvedTheme, resolvedWallpaper, set }), [state, resolvedTheme, resolvedWallpaper, set]);
  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}

export function usePlayground(): PlaygroundContextValue {
  const value = useContext(PlaygroundContext);
  if (!value) throw new Error('usePlayground 必须在 PlaygroundProvider 内使用');
  return value;
}
