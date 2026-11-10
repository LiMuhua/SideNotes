/**
 * 交互原型检查：docs/prototype 直接引用设计令牌，五套主题的结构差异与 Playground 一致。
 *
 * - surfaces.js 的主题列表与 6 项结构差异与 playground/src/surfaces.ts 一致；旧设置按约定迁移。
 * - index.html 依次引用内置字体、base.css 与五套主题的令牌文件、旧样式层 legacy.css（styles.css 与 v2–v8 都放在级联层 legacy 中）与 theme.css；引用的文件都存在。
 * - theme.css 只引用令牌与运行时变量，确需固定的数值在行尾注明「固定：原因」；旧样式不再写死颜色，也不再使用旧的主题属性。
 * - 原型样式引用的变量都有来源：令牌、原型样式自己定义的变量（旧样式的别名）、settings.js 写在根节点上的运行时变量。
 * - app-icons.js 的内置图标清单与 src-tauri/icons/builtin/manifest.json 一致，图片地址都存在；上传的图片单独保存、按约定校验。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE, SURFACES } from '../playground/src/surfaces';
import { TOKENS } from '../tokens/schema';
import { declarations, LOCAL_PREFIXES, RAW_VALUES } from './css-rules';
import { designPath, tokensFor } from './token-utils';

const PROTOTYPE_ROOT = designPath('../prototype');

function readPrototypeFile(name: string): string {
  return readFileSync(resolvePath(PROTOTYPE_ROOT, name), 'utf-8');
}

/** 原型的全部样式：旧样式（styles.css、v2–v8）在前，令牌化的 theme.css 单独检查。 */
const STYLESHEETS = readdirSync(PROTOTYPE_ROOT).filter((name) => name.endsWith('.css'));
const LEGACY_STYLESHEETS = STYLESHEETS.filter((name) => name !== 'theme.css');

const TOKEN_NAMES = new Set(TOKENS.map((token) => token.name));
/** 脚本写在元素上的运行时变量：settings.js 的整页缩放（字号 ÷ 13）与侧栏宽度，app.js 的搜索框收起宽度。 */
const RUNTIME_VARIABLES = new Set(['--app-zoom', '--sidebar-width', '--search-collapsed-width']);

interface PrototypeSurfaces {
  SURFACES: ReadonlyArray<Record<string, unknown>>;
  DEFAULT_SURFACE: string;
  SETTINGS_VERSION: number;
  THEME_FONTS: Record<string, string>;
  normalizeSurface(value: unknown): string;
  normalizeFontFamily(value: unknown, version?: unknown): string;
}

/** 在独立的上下文中执行 surfaces.js，取出它挂到 window 上的对象。 */
function loadSurfaces(): PrototypeSurfaces {
  const context: { window: { SideNotesSurfaces?: PrototypeSurfaces } } = { window: {} };
  runInNewContext(readPrototypeFile('surfaces.js'), context);
  if (!context.window.SideNotesSurfaces) throw new Error('surfaces.js 没有定义 window.SideNotesSurfaces');
  return context.window.SideNotesSurfaces;
}

/** 结构差异的 6 项与名称，用普通对象比较，避免两个上下文的原型链不同。 */
function structure(item: Record<string, unknown>): Record<string, unknown> {
  const { id, name, dock, entries, tabs, translucent, inlineShortcuts, tabMarks } = item;
  return { id, name, dock, entries, tabs, translucent, inlineShortcuts, tabMarks };
}

describe('主题结构 surfaces.js', () => {
  const surfaces = loadSurfaces();

  it('主题列表、名称与 6 项结构差异与 Playground 一致', () => {
    expect(surfaces.SURFACES.map(structure)).toEqual(SURFACES.map((item) => structure({ ...item })));
    expect(surfaces.DEFAULT_SURFACE).toBe(DEFAULT_SURFACE);
  });

  it('字体组合框中「跟随主题」的说明与各主题令牌的界面字体一致', () => {
    for (const { id } of SURFACES) {
      const fontUi = tokensFor(id, `tokens/${id}.css`, 'light').get('--sn-font-ui') ?? '';
      const first = fontUi.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      expect(surfaces.THEME_FONTS[id], id).toBe(first);
    }
  });

  it('旧取值迁移：standard 改为 terminal，五套主题原样保留，无法识别的取值回到默认', () => {
    expect(surfaces.normalizeSurface('standard')).toBe('terminal');
    for (const { id } of SURFACES) expect(surfaces.normalizeSurface(id)).toBe(id);
    for (const value of ['unknown', '', undefined, null, 3]) expect(surfaces.normalizeSurface(value)).toBe(DEFAULT_SURFACE);
  });

  it('字体迁移：版本 3 之前的旧默认字体改为跟随主题，用户的选择保留', () => {
    const { normalizeFontFamily: font, SETTINGS_VERSION: current } = surfaces;
    expect(current).toBe(3);
    // 版本 3 之前：空值是用户选的「系统默认」；原型与现有应用的默认字体改为跟随主题（空值）。
    expect(font('', 2)).toBe('系统默认');
    expect(font('Segoe UI', 2)).toBe('');
    expect(font('Maple Mono NF CN', undefined)).toBe('');
    expect(font('微软雅黑', 2)).toBe('微软雅黑');
    expect(font(undefined, 2)).toBe('');
    // 版本 3 起原样保存：之后再显式选择 Segoe UI 不会被改回跟随主题。
    expect(font('', current)).toBe('');
    expect(font('Segoe UI', current)).toBe('Segoe UI');
    expect(font('系统默认', current)).toBe('系统默认');
    expect(font('跟随主题', current)).toBe('');
  });
});

interface Manifest {
  default: string;
  icons: Array<{ id: string; number: string; name: string }>;
}

interface PrototypeAppIcons {
  ICONS: ReadonlyArray<{ id: string; number: string; name: string }>;
  DEFAULT_ICON: string;
  CUSTOM_ICON: string;
  CORNER_RATIO: number;
  normalize(value: unknown): string;
  source(id: string): string;
  readCustom(): string;
  writeCustom(url: string): boolean;
  resolve(value: unknown): { id: string; src: string; type: string };
}

/** 在独立的上下文中执行 app-icons.js；localStorage 用内存中的表代替。 */
function loadAppIcons(): PrototypeAppIcons {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  };
  const context: { window: { SideNotesAppIcons?: PrototypeAppIcons }; localStorage: typeof localStorage } = { window: {}, localStorage };
  runInNewContext(readPrototypeFile('app-icons.js'), context);
  if (!context.window.SideNotesAppIcons) throw new Error('app-icons.js 没有定义 window.SideNotesAppIcons');
  return context.window.SideNotesAppIcons;
}

describe('应用图标 app-icons.js', () => {
  const icons = loadAppIcons();
  const manifest = JSON.parse(readFileSync(designPath('../../src-tauri/icons/builtin/manifest.json'), 'utf-8')) as Manifest;

  it('内置图标的清单与 manifest.json 一致，默认图标排第一', () => {
    expect(icons.ICONS.map(({ id, number, name }) => ({ id, number, name }))).toEqual(manifest.icons);
    expect(icons.DEFAULT_ICON).toBe(manifest.default);
    expect(icons.ICONS[0].id).toBe(manifest.default);
    expect(icons.CORNER_RATIO).toBe(14 / 64);
  });

  it('每个内置图标的图片都存在：默认图标用设计系统中的副本，其余引用随应用打包的资源', () => {
    for (const { id } of icons.ICONS) {
      const source = icons.source(id);
      expect(existsSync(resolvePath(PROTOTYPE_ROOT, source)), source).toBe(true);
    }
    expect(icons.source(manifest.default)).toBe('../design-system/assets/app-icon.svg');
  });

  it('设置中的取值：内置图标与 custom 原样保留，找不到的按默认处理', () => {
    for (const { id } of icons.ICONS) expect(icons.normalize(id)).toBe(id);
    expect(icons.normalize('custom')).toBe('custom');
    for (const value of ['removed-icon', '', undefined, null, 211]) expect(icons.normalize(value)).toBe(manifest.default);
  });

  it('上传的图片只接受 PNG 的 data URL；图片不在时按默认图标显示', () => {
    expect(icons.resolve('custom')).toEqual({ id: manifest.default, src: '../design-system/assets/app-icon.svg', type: 'image/svg+xml' });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(icons.writeCustom(png)).toBe(true);
    expect(icons.resolve('custom')).toEqual({ id: 'custom', src: png, type: 'image/png' });
    expect(icons.writeCustom('data:image/png;base64,' + 'A'.repeat(1_500_000))).toBe(false);
    expect(icons.readCustom()).toBe(png);
    expect(icons.writeCustom('')).toBe(true);
    expect(icons.readCustom()).toBe('');
  });
});

describe('页面引用 index.html', () => {
  const html = readPrototypeFile('index.html');
  const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);

  it('先引用内置字体，再引用 base.css 与五套主题的令牌文件，然后是旧样式层 legacy.css，theme.css 最后', () => {
    const head = ['../../src/styles/fonts.css', ...['base', ...SURFACES.map((item) => item.id)].map((name) => `../design-system/tokens/${name}.css`)];
    expect(stylesheets).toEqual([...head, 'legacy.css', 'theme.css']);
  });

  it('旧样式都放进级联层 legacy，原型中其余的样式文件都由 legacy.css 引入', () => {
    const legacy = readPrototypeFile('legacy.css');
    const imports = [...legacy.matchAll(/@import url\('([^']+)'\)\s*layer\(legacy\);/g)].map((match) => match[1]);
    expect(legacy.match(/@import/g)?.length).toBe(imports.length);
    expect(new Set([...imports, 'legacy.css', 'theme.css'])).toEqual(new Set(STYLESHEETS));
  });

  it('引用的样式、脚本与图标都存在', () => {
    const references = [...html.matchAll(/\s(?:href|src)="([^"#][^"]*)"/g)].map((match) => match[1]).filter((value) => !/^(?:[a-z]+:|\/\/)/i.test(value));
    const missing = references.filter((value) => !existsSync(resolvePath(PROTOTYPE_ROOT, value)));
    expect(references.length).toBeGreaterThan(stylesheets.length);
    expect(missing).toEqual([]);
  });

  it('surfaces.js 与 app-icons.js 在设置与主程序之前加载', () => {
    const position = (name: string) => scripts.indexOf(name);
    for (const module of ['surfaces.js', 'app-icons.js']) {
      expect(position(module), module).toBeGreaterThanOrEqual(0);
      expect(position(module), module).toBeLessThan(position('settings.js'));
      expect(position(module), module).toBeLessThan(position('app.js'));
    }
  });

  it('根节点在脚本运行前就带默认主题的属性，避免首屏闪烁', () => {
    const root = html.match(/<html[^>]*>/)?.[0] ?? '';
    expect(root).toContain(`data-sn-surface="${DEFAULT_SURFACE}"`);
    expect(root).toContain('data-sn-theme="light"');
    expect(root).toContain('data-sn-dock="flush"');
  });
});

describe('原型样式 theme.css', () => {
  const css = readPrototypeFile('theme.css');
  const list = declarations(css);

  it('能取到声明', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('不写死颜色、像素、rem 与时长（行尾注明「固定」的除外）', () => {
    const violations = list.flatMap((declaration) =>
      declaration.fixed
        ? []
        : RAW_VALUES.filter(({ pattern }) => pattern.test(declaration.value)).map(
            ({ label }) => `theme.css:${declaration.line} ${label}：${declaration.property}: ${declaration.value}`,
          ),
    );
    expect(violations).toEqual([]);
  });

  it('只引用令牌、运行时变量与组件内部变量', () => {
    const unknown = [...css.matchAll(/var\(\s*(--[\w-]+)/g)]
      .map((match) => match[1])
      .filter((variable) => !TOKEN_NAMES.has(variable) && !RUNTIME_VARIABLES.has(variable) && !LOCAL_PREFIXES.some((prefix) => variable.startsWith(prefix)));
    expect([...new Set(unknown)]).toEqual([]);
  });
});

describe.each(LEGACY_STYLESHEETS)('原型旧样式 %s', (name) => {
  const css = readPrototypeFile(name);
  const list = declarations(css);
  const colorRule = RAW_VALUES.find(({ label }) => label === '颜色');

  it('不写死颜色：颜色都来自令牌（行尾注明「固定」的除外）', () => {
    const violations = list.filter((declaration) => !declaration.fixed && colorRule?.pattern.test(declaration.value)).map((declaration) => `${name}:${declaration.line} ${declaration.property}: ${declaration.value}`);
    expect(violations).toEqual([]);
  });

  it('不再使用旧的明暗与材质属性，主题只看根节点的 data-sn-* 属性', () => {
    expect(css).not.toMatch(/data-theme|data-surface/);
  });
});

describe('原型样式中的变量', () => {
  const sources = STYLESHEETS.map((name) => ({ name, css: readPrototypeFile(name) }));
  const defined = new Set(sources.flatMap(({ css }) => declarations(css).map((declaration) => declaration.property).filter((property) => property.startsWith('--'))));

  it('令牌只在 docs/design-system/tokens 中定义，原型样式不定义 --sn-* 变量', () => {
    expect([...defined].filter((property) => property.startsWith('--sn-'))).toEqual([]);
  });

  it('引用的变量都有来源：令牌、原型样式定义的变量或运行时变量', () => {
    const unknown = sources.flatMap(({ name, css }) =>
      [...css.matchAll(/var\(\s*(--[\w-]+)/g)]
        .map((match) => match[1])
        .filter((variable) => !TOKEN_NAMES.has(variable) && !defined.has(variable) && !RUNTIME_VARIABLES.has(variable) && !LOCAL_PREFIXES.some((prefix) => variable.startsWith(prefix)))
        .map((variable) => `${name} ${variable}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('脚本不再写旧的明暗属性', () => {
    for (const name of ['app.js', 'settings.js', 'boot.js']) expect(readPrototypeFile(name), name).not.toMatch(/dataset\.theme\b|data-theme/);
  });
});
