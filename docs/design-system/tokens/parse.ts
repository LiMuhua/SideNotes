/**
 * 令牌文件的解析、层叠与颜色计算。
 *
 * 不依赖 Node 或浏览器接口：设计系统测试（`docs/design-system/tests`）从磁盘读取 CSS 后调用，
 * Playground 的令牌页用 Vite 的 `?raw` 导入同样的 CSS 后调用，两边看到的是同一组数值。
 *
 * 令牌文件只有顶层规则、没有嵌套，按「选择器 { 声明 }」切分即可；
 * 颜色只需支持令牌中出现的 `#rrggbb`、`#rgb` 与 `rgb(r g b / a)` 三种写法。
 */

export type Theme = 'light' | 'dark';

export interface CssBlock {
  selector: string;
  declarations: Map<string, string>;
}

/** 把令牌文件切分为规则块，只保留自定义属性与 color-scheme。 */
export function parseBlocks(css: string): CssBlock[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: CssBlock[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const declaration of match[2].matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
      declarations.set(declaration[1], declaration[2].replace(/\s+/g, ' ').trim());
    }
    blocks.push({ selector: match[1].replace(/\s+/g, ' ').trim(), declarations });
  }
  return blocks;
}

/** 主题令牌文件中的选择器：浅色规则不带明暗属性，深色规则带 `[data-sn-theme='dark']`。 */
function matches(selector: string, surface: string, theme: Theme): boolean {
  return selector.split(',').some((part) => {
    const item = part.trim();
    const isSurface = item.includes(`[data-sn-surface='${surface}']`) || item.startsWith(':root');
    if (!isSurface) return false;
    return item.includes("[data-sn-theme='dark']") ? theme === 'dark' : true;
  });
}

/** 合并共享令牌与主题令牌，得到某主题某明暗模式下全部令牌的原始值（与 CSS 层叠顺序一致）。 */
export function mergeTokens(baseCss: string, surfaceCss: string, surface: string, theme: Theme): Map<string, string> {
  const merged = new Map<string, string>();
  const apply = (blocks: CssBlock[], filter: (block: CssBlock) => boolean) =>
    blocks.filter(filter).forEach((block) => block.declarations.forEach((value, name) => merged.set(name, value)));
  apply(parseBlocks(baseCss), (block) => block.selector === ':root');
  const blocks = parseBlocks(surfaceCss);
  // 先应用浅色（不带明暗属性的）规则，再应用深色规则。
  apply(blocks, (block) => !block.selector.includes('data-sn-theme') && matches(block.selector, surface, theme));
  if (theme === 'dark') apply(blocks, (block) => block.selector.includes('data-sn-theme') && matches(block.selector, surface, theme));
  return merged;
}

/** 展开 `var(--name)` 引用。 */
export function resolve(tokens: Map<string, string>, name: string, depth = 0): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`未定义的令牌：${name}`);
  if (depth > 8) throw new Error(`令牌引用过深：${name}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_match, inner: string) => resolve(tokens, inner, depth + 1));
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 解析颜色值。 */
export function parseColor(value: string): Rgba {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (char) => char + char) : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = value.trim().match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  throw new Error(`无法解析的颜色：${value}`);
}

/** 是否是可以解析的单个颜色值。 */
export function isColor(value: string): boolean {
  return /^#([\da-f]{3}|[\da-f]{6})$/i.test(value.trim()) || /^rgb\(/.test(value.trim());
}

/** 半透明颜色叠在不透明底色上的结果。 */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (front: number, back: number) => front * top.a + back * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** WCAG 2.x 相对亮度。 */
function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度。 */
export function contrast(foreground: Rgba, background: Rgba): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** 两个极端背景：半透明表面叠在桌面上时，实际背景的亮度介于纯黑与纯白之间。 */
export const BACKDROPS: readonly Rgba[] = [
  { r: 0, g: 0, b: 0, a: 1 },
  { r: 255, g: 255, b: 255, a: 1 },
];

/** 从背景开始，依次把令牌颜色（由下到上）叠上去，得到不透明的结果。 */
export function layered(tokens: Map<string, string>, layers: readonly string[], backdrop: Rgba): Rgba {
  return layers.reduce((bottom, name) => composite(parseColor(resolve(tokens, name)), bottom), backdrop);
}

/**
 * 前景令牌在一组叠加表面上的对比度，取两个极端背景中较差的一个。
 * 前景本身半透明时（如「黑色 62%」的文字），先叠到表面上再计算。
 */
export function stackContrast(tokens: Map<string, string>, foreground: string, layers: readonly string[]): number {
  const color = parseColor(resolve(tokens, foreground));
  return Math.min(
    ...BACKDROPS.map((backdrop) => {
      const background = layered(tokens, layers, backdrop);
      return contrast(composite(color, background), background);
    }),
  );
}

/** 表面是否完全透明（如磨砂玻璃的面板本身）：文字不会直接放在它上面。 */
export function isTransparent(tokens: Map<string, string>, name: string): boolean {
  return parseColor(resolve(tokens, name)).a < 0.05;
}

/** 对比度检查用到的组合，测试与令牌页共用：前景，以及由下到上叠起来的表面。 */
export interface ContrastPair {
  label: string;
  foreground: string;
  layers: readonly string[];
  /** 最低要求：正文 4.5，界面元素与辅助信息 3。 */
  minimum: 4.5 | 3;
}

const CARD = ['--sn-color-panel', '--sn-color-card'] as const;
/** 悬停或选中的卡片：卡片底色上叠一层选中叠加色。 */
const ACTIVE_CARD = [...CARD, '--sn-color-card-active'] as const;
/** 编辑中的卡片：编辑底色取代卡片底色，直接叠在面板上。 */
const EDITING = ['--sn-color-panel', '--sn-color-editing'] as const;

export const KEY_CONTRAST_PAIRS: readonly ContrastPair[] = [
  { label: '主要文字 / 卡片', foreground: '--sn-color-text', layers: CARD, minimum: 4.5 },
  { label: '次要文字 / 卡片', foreground: '--sn-color-text-secondary', layers: CARD, minimum: 4.5 },
  { label: '弱化文字 / 卡片', foreground: '--sn-color-text-muted', layers: CARD, minimum: 4.5 },
  { label: '弱化文字 / 页脚', foreground: '--sn-color-text-muted', layers: [...CARD, '--sn-color-panel-band'], minimum: 4.5 },
  { label: '主要文字 / 卡片标题栏', foreground: '--sn-color-text', layers: [...CARD, '--sn-color-card-head'], minimum: 4.5 },
  { label: '弱化文字 / 卡片标题栏', foreground: '--sn-color-text-muted', layers: [...CARD, '--sn-color-card-head'], minimum: 4.5 },
  { label: '主要文字 / 选中卡片', foreground: '--sn-color-text', layers: ACTIVE_CARD, minimum: 4.5 },
  { label: '次要文字 / 选中卡片', foreground: '--sn-color-text-secondary', layers: ACTIVE_CARD, minimum: 4.5 },
  { label: '主要文字 / 选中的标题栏', foreground: '--sn-color-text', layers: [...ACTIVE_CARD, '--sn-color-card-head-active'], minimum: 4.5 },
  { label: '次要文字 / 选中的标题栏', foreground: '--sn-color-text-secondary', layers: [...ACTIVE_CARD, '--sn-color-card-head-active'], minimum: 4.5 },
  { label: '主要文字 / 编辑区', foreground: '--sn-color-text', layers: EDITING, minimum: 4.5 },
  { label: 'Markdown 标记 / 编辑区', foreground: '--sn-color-syntax', layers: EDITING, minimum: 4.5 },
  { label: '输入光标 / 编辑区', foreground: '--sn-color-caret', layers: EDITING, minimum: 3 },
  { label: '强调色文字 / 卡片', foreground: '--sn-color-accent-text', layers: CARD, minimum: 4.5 },
  { label: '强调色上的文字', foreground: '--sn-color-on-accent', layers: ['--sn-color-accent'], minimum: 4.5 },
  { label: '危险色 / 菜单', foreground: '--sn-color-danger', layers: ['--sn-color-surface-raised'], minimum: 4.5 },
  { label: '控件边界 / 卡片', foreground: '--sn-color-border-strong', layers: CARD, minimum: 3 },
  { label: '焦点环 / 卡片', foreground: '--sn-color-focus', layers: CARD, minimum: 3 },
  { label: '代码文字 / 代码块', foreground: '--sn-code-text', layers: [...CARD, '--sn-code-bg'], minimum: 4.5 },
  { label: '主要文字 / 设置内容区', foreground: '--sn-color-text', layers: ['--sn-color-surface'], minimum: 4.5 },
  { label: '弱化文字 / 设置分类栏', foreground: '--sn-color-text-muted', layers: ['--sn-color-bg'], minimum: 4.5 },
];

/** 计算一组令牌中某个组合的对比度（两个极端背景中较差的一个）。 */
export function pairContrast(tokens: Map<string, string>, pair: ContrastPair): number {
  return stackContrast(tokens, pair.foreground, pair.layers);
}
