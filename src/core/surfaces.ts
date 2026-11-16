/**
 * 五套主题的结构差异与根节点属性。
 *
 * 颜色、字体、尺寸、材质等数值差异都在设计令牌中（`docs/design-system/tokens/`，三个窗口直接引用）；
 * 这里只保留令牌表达不了的 6 项结构差异，取值与 Playground 的 `surfaces.ts`、原型的 `surfaces.js` 一致，
 * 由 `surfaces.test.ts` 逐项比对。结构差异写在根节点的数据属性上，样式按属性选择，组件本身不区分主题。
 * 代码中主题叫 surface，与设置字段一致；`theme` 是明暗模式。
 */

import type { SurfaceMode } from './types';

/** 一套主题的结构差异。 */
export interface SurfaceSpec {
  id: SurfaceMode;
  /** 中文名。 */
  name: string;
  /** 与屏幕边缘的关系：贴边整块、离开边缘的浮动面板、分开的若干块。 */
  dock: 'flush' | 'floating' | 'blocks';
  /** 记录的组织方式：带标题栏的窗格、卡片、玻璃块。 */
  entries: 'panes' | 'cards' | 'tiles';
  /** 页签形态：文字加下划线、分段控件。 */
  tabs: 'underline' | 'segmented';
  /** 半透明表面，背后透出桌面（需要透明窗口与系统材质，见 adaptation.md 第三节）。 */
  translucent: boolean;
  /** 把快捷键直接写在界面上。 */
  inlineShortcuts: boolean;
  /** 页签前的分区色点。 */
  tabMarks: boolean;
}

/** 五套主题，第一项是默认的终端。 */
export const SURFACES: readonly SurfaceSpec[] = [
  { id: 'terminal', name: '终端', dock: 'flush', entries: 'panes', tabs: 'underline', translucent: false, inlineShortcuts: true, tabMarks: false },
  { id: 'magazine', name: '杂志', dock: 'floating', entries: 'cards', tabs: 'segmented', translucent: false, inlineShortcuts: false, tabMarks: false },
  { id: 'paper', name: '记录纸', dock: 'flush', entries: 'cards', tabs: 'underline', translucent: false, inlineShortcuts: false, tabMarks: false },
  { id: 'win11', name: 'Windows 11', dock: 'floating', entries: 'cards', tabs: 'underline', translucent: true, inlineShortcuts: false, tabMarks: false },
  { id: 'glass', name: '磨砂玻璃', dock: 'blocks', entries: 'tiles', tabs: 'segmented', translucent: true, inlineShortcuts: false, tabMarks: true },
];

/** 默认主题。 */
export const DEFAULT_SURFACE: SurfaceMode = 'terminal';

/** 各主题界面字体的第一项，用于字体组合框里「跟随主题」的说明（与令牌的 --sn-font-ui 一致，测试比对）。 */
export const THEME_FONTS: Readonly<Record<SurfaceMode, string>> = {
  terminal: 'Maple Mono NF CN',
  magazine: 'Segoe UI Variable Text',
  paper: 'Archivo',
  win11: 'Segoe UI Variable Text',
  glass: 'Inter',
};

/** 0.7.3 之前的「界面材质」取值：标准改为终端，记录纸、Windows 11、磨砂玻璃沿用同名取值。 */
const LEGACY_SURFACES: Readonly<Record<string, SurfaceMode>> = { standard: 'terminal' };

/** 读取主题的结构差异。 */
export function surfaceSpec(id: SurfaceMode): SurfaceSpec {
  return SURFACES.find((item) => item.id === id) ?? SURFACES[0];
}

/** 迁移并校验主题取值：`standard` 改为终端，无法识别的取值回到默认。 */
export function normalizeSurface(value: unknown): SurfaceMode {
  const id = typeof value === 'string' && Object.hasOwn(LEGACY_SURFACES, value) ? LEGACY_SURFACES[value] : value;
  return SURFACES.some((item) => item.id === id) ? (id as SurfaceMode) : DEFAULT_SURFACE;
}

/**
 * 主题、明暗与结构差异对应的数据属性。
 *
 * 令牌按 `data-sn-surface` 与 `data-sn-theme` 取值，结构样式按 `data-sn-dock` 等属性选择；
 * 设置页的主题预览把同一组属性写在预览元素上，里面就用那一套主题的令牌。
 */
export function surfaceAttributes(surface: SurfaceMode, theme: 'light' | 'dark'): Record<string, string> {
  const item = surfaceSpec(surface);
  return {
    'data-sn-surface': item.id,
    'data-sn-theme': theme,
    'data-sn-dock': item.dock,
    'data-sn-entries': item.entries,
    'data-sn-tabs': item.tabs,
    'data-sn-translucent': String(item.translucent),
    'data-sn-shortcuts': item.inlineShortcuts ? 'inline' : 'tooltip',
    'data-sn-tab-marks': String(item.tabMarks),
  };
}

/** 把主题、明暗与结构差异写到元素上（窗口的根节点）。 */
export function applySurface(node: HTMLElement, surface: SurfaceMode, theme: 'light' | 'dark'): void {
  for (const [name, value] of Object.entries(surfaceAttributes(surface, theme))) node.setAttribute(name, value);
}
