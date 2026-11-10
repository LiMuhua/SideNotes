/**
 * 样式检查：产品样式（侧栏、速记浮窗、设置窗口与组件）只引用设计令牌。
 *
 * - 声明里不写死颜色、像素、rem 与时长；确需固定的数值在同一行行尾注明「固定：原因」。
 * - 引用的变量必须是令牌表中的令牌，或者是组件内部（--local-*）、Markdown 编辑器运行时（--md-*）的变量。
 * - 产品样式不定义 --sn-* 变量：令牌只在 docs/design-system/tokens 中定义，避免两处取值。
 *
 * 桌面场景（desktop.css）、组件页（pages.css）与 Playground 外壳（shell.css）不属于 SideNotes 的设计，不在检查范围内。
 */

import { describe, expect, it } from 'vitest';
import { TOKENS } from '../tokens/schema';
import { declarations, LOCAL_PREFIXES, RAW_VALUES } from './css-rules';
import { readDesignFile } from './token-utils';

const PRODUCT_STYLES = ['base', 'components', 'controls', 'content', 'sidebar', 'windows'] as const;

const TOKEN_NAMES = new Set(TOKENS.map((token) => token.name));

describe.each(PRODUCT_STYLES)('产品样式 %s.css', (name) => {
  const css = readDesignFile(`playground/src/styles/${name}.css`);
  const list = declarations(css);

  it('能取到声明', () => {
    expect(list.length).toBeGreaterThan(0);
  });

  it('不写死颜色、像素、rem 与时长（行尾注明「固定」的除外）', () => {
    const violations = list.flatMap((declaration) =>
      declaration.fixed
        ? []
        : RAW_VALUES.filter(({ pattern }) => pattern.test(declaration.value)).map(
            ({ label }) => `${name}.css:${declaration.line} ${label}：${declaration.property}: ${declaration.value}`,
          ),
    );
    expect(violations).toEqual([]);
  });

  it('只引用令牌表中的令牌与组件内部变量', () => {
    const unknown = [...css.matchAll(/var\(\s*(--[\w-]+)/g)]
      .map((match) => match[1])
      .filter((variable) => !TOKEN_NAMES.has(variable) && !LOCAL_PREFIXES.some((prefix) => variable.startsWith(prefix)));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('不定义 --sn-* 变量', () => {
    const defined = list.filter((declaration) => declaration.property.startsWith('--sn-')).map((declaration) => `${name}.css:${declaration.line} ${declaration.property}`);
    expect(defined).toEqual([]);
  });
});

describe('检查规则本身', () => {
  it('能发现写死的值，跳过注明「固定」的行，多行声明按起始行定位', () => {
    const sample = ['.a {', '  color: #ff0000;', '  margin: 4px; /* 固定：示例 */', '  transition:', '    opacity 120ms;', '  gap: var(--sn-space-2);', '}'].join('\n');
    const found = declarations(sample).filter((declaration) => !declaration.fixed && RAW_VALUES.some(({ pattern }) => pattern.test(declaration.value)));
    expect(found.map((declaration) => [declaration.property, declaration.line])).toEqual([
      ['color', 2],
      ['transition', 4],
    ]);
  });
});
