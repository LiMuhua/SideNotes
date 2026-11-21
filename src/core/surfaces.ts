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

/**
 * 窗口材质（T84，adaptation.md 第三、四节，技术决策第 40 条）：
 * - `acrylic`：Windows 11 与磨砂玻璃。透明窗口加亚克力，窗口本身就是面板，侧栏窗口离开屏幕边缘一段留白；
 * - `clear`：杂志。透明、不加材质，浮动面板的留白在窗口内，透出桌面；
 * - `opaque`：终端与记录纸，贴边整块，面板铺满窗口。
 * 设置窗口一律不透明，不经过这里。
 */
export type WindowMaterial = 'acrylic' | 'clear' | 'opaque';

/** 主题对应的窗口材质。 */
export function windowMaterial(surface: SurfaceMode): WindowMaterial {
  const item = surfaceSpec(surface);
  if (item.translucent) return 'acrylic';
  return item.dock === 'flush' ? 'opaque' : 'clear';
}

/**
 * 磨砂玻璃的分块侧栏（T101，技术决策第 46 条）：各块各自磨砂，块与块之间透出桌面。系统的亚克力只能加在整个窗口上，
 * 所以这种侧栏的窗口是全透明的（`clear`），背后的屏幕由后端截下、模糊后交给页面当各块的背景。
 */
export function isGlassBlocks(surface: SurfaceMode): boolean {
  const item = surfaceSpec(surface);
  return item.translucent && item.dock === 'blocks';
}

/**
 * 贴边整块、朝屏幕内侧的两个角却是圆角的主题（令牌 `--sn-panel-radius`）：记录纸。不透明的窗口画不出圆角外面的桌面，
 * 角上露出底色，系统的直角边框也还在，看着多出一截线条（第九轮反馈 5）。
 */
const ROUNDED_FLUSH: ReadonlySet<SurfaceMode> = new Set<SurfaceMode>(['paper']);

/**
 * 侧栏窗口的材质：分块的磨砂玻璃与内侧带圆角的记录纸全透明，面板的圆角与边框由页面画；其余与 windowMaterial 相同
 * （速记浮窗与记录窗口仍是一整块，照常用亚克力或不透明的底色）。
 */
export function sidebarMaterial(surface: SurfaceMode): WindowMaterial {
  return isGlassBlocks(surface) || ROUNDED_FLUSH.has(surface) ? 'clear' : windowMaterial(surface);
}

/**
 * 分块磨砂玻璃侧栏的背景处理参数：模糊半径（页面像素）与饱和度，取自令牌 `--sn-panel-blur`、`--sn-panel-saturate`；
 * 其余主题为 null。读取的是根节点当前的令牌，要在写入主题属性之后调用。
 */
export function glassBackdrop(surface: SurfaceMode): { blur: number; saturate: number } | null {
  if (!isGlassBlocks(surface) || typeof document === 'undefined') return null;
  const style = getComputedStyle(document.documentElement);
  const blur = parseFloat(style.getPropertyValue('--sn-panel-blur'));
  const saturate = parseFloat(style.getPropertyValue('--sn-panel-saturate'));
  return { blur: Number.isFinite(blur) && blur > 0 ? blur : 0, saturate: Number.isFinite(saturate) && saturate > 0 ? saturate : 1 };
}

/**
 * 侧栏窗口与屏幕边缘之间的留白（未缩放的 CSS 像素）：只有窗口本身就是面板的 `acrylic` 主题（Windows 11）才有，取自令牌
 * `--sn-panel-inset`。分块的磨砂玻璃窗口全透明，留白画在页面里。读取的是根节点当前的令牌，要在写入主题属性之后调用。
 */
export function windowGap(surface: SurfaceMode): number {
  if (sidebarMaterial(surface) !== 'acrylic' || typeof document === 'undefined') return 0;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sn-panel-inset'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 把主题、明暗与结构差异写到元素上（窗口的根节点）。 */
export function applySurface(node: HTMLElement, surface: SurfaceMode, theme: 'light' | 'dark'): void {
  for (const [name, value] of Object.entries(surfaceAttributes(surface, theme))) node.setAttribute(name, value);
}
