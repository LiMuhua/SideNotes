/**
 * 桌面端样式的令牌检查（DS-17）：样式只引用设计令牌表中有的令牌，令牌改名或删除时这里报错。
 *
 * - 全部样式文件：引用的 --sn-* 都在令牌表（docs/design-system/tokens/schema.ts）中；不定义 --sn-* 变量；
 *   引用的其它变量都有来源（样式自己定义的变量、脚本写在元素上的运行时变量、组件内部变量）。
 * - theme.css 与 window.css（原型第二版的样式与窗口适配）：不写死颜色、像素、rem 与时长，确需固定的在行尾注明「固定：原因」。
 * - 旧样式层（prototype.css、desktop.css）：不写死颜色，不再使用 0.7.3 的明暗与材质属性；整份放在级联层 legacy 中。
 * 规则与原型的检查相同（docs/design-system/tests/css-rules.ts）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declarations, LOCAL_PREFIXES, RAW_VALUES } from '../../docs/design-system/tests/css-rules';
import { TOKENS } from '../../docs/design-system/tokens/schema';

const STYLES_ROOT = dirname(fileURLToPath(import.meta.url));
const STYLESHEETS = readdirSync(STYLES_ROOT).filter((name) => name.endsWith('.css'));
const read = (name: string): string => readFileSync(resolvePath(STYLES_ROOT, name), 'utf-8');

/** 原型第二版的样式与窗口适配：只引用令牌。 */
const TOKEN_ONLY = ['theme.css', 'window.css'];
/** 旧样式层：保留 0.7.3 与原型早期的布局数值，颜色已换成令牌。 */
const LEGACY = ['prototype.css', 'desktop.css'];

const TOKEN_NAMES = new Set(TOKENS.map((token) => token.name));
/**
 * 脚本写在元素上的运行时变量：App.tsx 的侧栏宽度与卡片高度，Sidebar 量出的列表滚动条宽度，
 * DialogWindow 量出的屏幕高度、App 写入的磨砂玻璃侧栏背景，以及原型脚本写的整页缩放、出入动画与搜索框收起宽度
 * （桌面端不设时按回退值计算）。
 */
const RUNTIME_VARIABLES = new Set([
  '--app-zoom',
  '--sidebar-width',
  '--sidebar-motion',
  '--card-max-height',
  '--note-content-max-height',
  '--search-collapsed-width',
  '--note-list-gutter',
  '--sidebar-anim-duration',
  '--sidebar-hide-offset',
  '--screen-height',
  '--glass-backdrop',
]);

const referenced = (css: string): string[] => [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);

describe('桌面端样式的文件', () => {
  it('样式文件齐全：旧样式层、原型第二版的样式、窗口适配与内置字体', () => {
    expect(new Set(STYLESHEETS)).toEqual(new Set([...LEGACY, ...TOKEN_ONLY, 'fonts.css']));
  });

  it('入口按层次引入：内置字体、base.css 与五套主题的令牌、旧样式层、theme.css、window.css', () => {
    const main = readFileSync(resolvePath(STYLES_ROOT, '../main.tsx'), 'utf-8');
    const imports = [...main.matchAll(/^import '([^']+\.css)';/gm)].map((match) => match[1]);
    const tokens = ['base', 'terminal', 'magazine', 'paper', 'win11', 'glass'].map((name) => `../docs/design-system/tokens/${name}.css`);
    expect(imports).toEqual(['./styles/fonts.css', ...tokens, './styles/prototype.css', './styles/desktop.css', './styles/theme.css', './styles/window.css']);
  });
});

describe.each(STYLESHEETS)('令牌引用 %s', (name) => {
  const css = read(name);

  it('引用的 --sn-* 都在令牌表中', () => {
    const unknown = referenced(css).filter((variable) => variable.startsWith('--sn-') && !TOKEN_NAMES.has(variable));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('不定义 --sn-* 变量：令牌只在 docs/design-system/tokens 中定义', () => {
    const defined = declarations(css).filter((declaration) => declaration.property.startsWith('--sn-'));
    expect(defined.map((declaration) => `${name}:${declaration.line} ${declaration.property}`)).toEqual([]);
  });
});

describe.each(TOKEN_ONLY)('只引用令牌 %s', (name) => {
  const list = declarations(read(name));

  it('能取到声明', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('不写死颜色、像素、rem 与时长（行尾注明「固定」的除外）', () => {
    const violations = list.flatMap((declaration) =>
      declaration.fixed
        ? []
        : RAW_VALUES.filter(({ pattern }) => pattern.test(declaration.value)).map(
            ({ label }) => `${name}:${declaration.line} ${label}：${declaration.property}: ${declaration.value}`,
          ),
    );
    expect(violations).toEqual([]);
  });
});

describe.each(LEGACY)('旧样式层 %s', (name) => {
  const css = read(name);
  const colorRule = RAW_VALUES.find(({ label }) => label === '颜色');

  it('整份放在级联层 legacy 中', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    expect(code.startsWith('@layer legacy {')).toBe(true);
    expect(code.endsWith('}')).toBe(true);
  });

  it('不写死颜色：颜色都来自令牌（行尾注明「固定」的除外）', () => {
    const violations = declarations(css)
      .filter((declaration) => !declaration.fixed && colorRule?.pattern.test(declaration.value))
      .map((declaration) => `${name}:${declaration.line} ${declaration.property}: ${declaration.value}`);
    expect(violations).toEqual([]);
  });

  it('不再使用 0.7.3 的明暗与材质属性，主题只看根节点的 data-sn-* 属性', () => {
    expect(css).not.toMatch(/data-theme|data-surface/);
  });
});

describe('样式中的变量', () => {
  const sources = STYLESHEETS.map((name) => ({ name, css: read(name) }));
  const defined = new Set(
    sources.flatMap(({ css }) => declarations(css).map((declaration) => declaration.property).filter((property) => property.startsWith('--'))),
  );

  it('引用的变量都有来源：令牌、样式定义的变量、运行时变量或组件内部变量', () => {
    const unknown = sources.flatMap(({ name, css }) =>
      referenced(css)
        .filter(
          (variable) =>
            !TOKEN_NAMES.has(variable) &&
            !defined.has(variable) &&
            !RUNTIME_VARIABLES.has(variable) &&
            !LOCAL_PREFIXES.some((prefix) => variable.startsWith(prefix)),
        )
        .map((variable) => `${name} ${variable}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });
});
