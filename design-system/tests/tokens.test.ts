/**
 * 设计令牌的完整性与对比度检查。
 *
 * - 每个主题在浅色与深色下都必须定义清单中的全部令牌，共享令牌只在 base.css 中定义一次。
 * - 关键的前景与背景组合必须满足 WCAG 2.2：正文 4.5:1，界面元素与辅助信息 3:1。
 * - 半透明表面（Windows 11、磨砂玻璃）按最坏情况检查：表面由下到上叠在纯黑与纯白背景上，
 *   两种情况都要达标；这样无论桌面背景是什么，侧栏里的文字都清楚。
 */

import { describe, expect, it } from 'vitest';
import { TOKENS } from '../tokens/schema';
import { isTransparent, stackContrast } from '../tokens/parse';
import { parseBlocks, readDesignFile, resolve, tokensFor, type Theme } from './token-utils';

/** 参与检查的主题与令牌文件。 */
export const SURFACE_FILES: ReadonlyArray<{ id: string; file: string }> = [
  { id: 'terminal', file: 'tokens/terminal.css' },
  { id: 'magazine', file: 'tokens/magazine.css' },
  { id: 'paper', file: 'tokens/paper.css' },
  { id: 'win11', file: 'tokens/win11.css' },
  { id: 'glass', file: 'tokens/glass.css' },
];

const THEMES: Theme[] = ['light', 'dark'];

describe('共享令牌', () => {
  const base = parseBlocks(readDesignFile('tokens/base.css'));
  const defined = new Set(base.flatMap((block) => Array.from(block.declarations.keys())));

  it('base.css 定义了全部共享令牌', () => {
    const missing = TOKENS.filter((token) => token.shared && !defined.has(token.name)).map((token) => token.name);
    expect(missing).toEqual([]);
  });

  it('base.css 不包含主题令牌', () => {
    const extra = Array.from(defined).filter((name) => !TOKENS.find((token) => token.name === name)?.shared);
    expect(extra).toEqual([]);
  });
});

describe.each(SURFACE_FILES)('主题 $id 的令牌', ({ id, file }) => {
  const blocks = parseBlocks(readDesignFile(file));

  it('不重复定义共享令牌，也没有清单之外的令牌', () => {
    const names = blocks.flatMap((block) => Array.from(block.declarations.keys())).filter((name) => name !== 'color-scheme');
    const unknown = names.filter((name) => !TOKENS.some((token) => token.name === name));
    const shared = names.filter((name) => TOKENS.find((token) => token.name === name)?.shared);
    expect(unknown).toEqual([]);
    expect(shared).toEqual([]);
  });

  it('随明暗变化的令牌在深色规则中全部重新定义', () => {
    const dark = blocks.filter((block) => block.selector.includes("[data-sn-theme='dark']"));
    const names = new Set(dark.flatMap((block) => Array.from(block.declarations.keys())));
    const missing = TOKENS.filter((token) => token.themed && !names.has(token.name)).map((token) => token.name);
    expect(missing).toEqual([]);
  });

  it.each(THEMES)('%s 模式下定义了全部令牌，引用都能展开', (theme) => {
    const tokens = tokensFor(id, file, theme);
    const missing = TOKENS.filter((token) => !tokens.has(token.name)).map((token) => token.name);
    expect(missing).toEqual([]);
    TOKENS.forEach((token) => expect(() => resolve(tokens, token.name)).not.toThrow());
    expect(tokens.get('color-scheme')).toBe(theme);
  });
});

const CARD = ['--sn-color-panel', '--sn-color-card'];

describe.each(SURFACE_FILES.flatMap(({ id, file }) => THEMES.map((theme) => ({ id, file, theme }))))(
  '主题 $id（$theme）的对比度',
  ({ id, file, theme }) => {
    const tokens = tokensFor(id, file, theme);
    const ratio = (foreground: string, layers: string[]) => stackContrast(tokens, foreground, layers);

    /** 文字会直接放在上面的表面；面板本身完全透明时（磨砂玻璃）不放文字，跳过。 */
    const textSurfaces: string[][] = [
      CARD,
      [...CARD, '--sn-color-panel-band'],
      // 输入框放在面板上；磨砂玻璃的面板透明，输入框放在玻璃块里。
      [...(isTransparent(tokens, '--sn-color-panel') ? CARD : ['--sn-color-panel']), '--sn-color-surface-sunken'],
      ['--sn-color-bg'],
      ['--sn-color-surface'],
      ['--sn-color-surface-raised'],
      ...(isTransparent(tokens, '--sn-color-panel') ? [] : [['--sn-color-panel']]),
    ];

    it.each(['--sn-color-text', '--sn-color-text-secondary', '--sn-color-text-muted'])('%s 在各层表面上不低于 4.5:1', (text) => {
      textSurfaces.forEach((layers) => expect(ratio(text, layers), `${text} / ${layers.join(' + ')}`).toBeGreaterThanOrEqual(4.5));
    });

    it('选中与悬停卡片上的文字不低于 4.5:1', () => {
      // 选中卡片内的弱化文字改用次要文字色（见 components.md「记录卡片」），弱化文字只要求在悬停的控件上达标。
      const active = [...CARD, '--sn-color-card-active'];
      expect(ratio('--sn-color-text', active)).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text-secondary', active)).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text', [...active, '--sn-color-card-head-active'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text-secondary', [...active, '--sn-color-card-head-active'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text-secondary', [...CARD, '--sn-color-accent-subtle']), '多选').toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text-muted', [...CARD, '--sn-color-hover'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text', ['--sn-color-bg', '--sn-color-selected'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-text-secondary', ['--sn-color-bg', '--sn-color-selected'])).toBeGreaterThanOrEqual(4.5);
    });

    it('强调色文字与强调色填充不低于 4.5:1', () => {
      [CARD, ['--sn-color-surface'], ['--sn-color-surface-raised'], ['--sn-color-bg'], [...CARD, '--sn-color-accent-subtle']].forEach(
        (layers) => expect(ratio('--sn-color-accent-text', layers), layers.join(' + ')).toBeGreaterThanOrEqual(4.5),
      );
      expect(ratio('--sn-color-on-accent', ['--sn-color-accent'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-on-accent', ['--sn-color-accent-hover'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-on-inverse', ['--sn-color-inverse'])).toBeGreaterThanOrEqual(4.5);
    });

    it('状态色在表面与浅底上不低于 4.5:1', () => {
      ['--sn-color-success', '--sn-color-warning', '--sn-color-danger', '--sn-color-info'].forEach((status) => {
        expect(ratio(status, ['--sn-color-surface']), status).toBeGreaterThanOrEqual(4.5);
        expect(ratio(status, ['--sn-color-surface-raised']), `${status} / 菜单`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(status, ['--sn-color-surface', `${status}-subtle`]), `${status} 浅底`).toBeGreaterThanOrEqual(4.5);
      });
      expect(ratio('--sn-color-danger', CARD), '危险色 / 卡片').toBeGreaterThanOrEqual(4.5);
    });

    it('控件边界、焦点环与页签标记不低于 3:1', () => {
      [CARD, ['--sn-color-surface'], ['--sn-color-surface-raised'], ['--sn-color-bg']].forEach((layers) => {
        expect(ratio('--sn-color-border-strong', layers), `border-strong / ${layers.join(' + ')}`).toBeGreaterThanOrEqual(3);
        expect(ratio('--sn-color-focus', layers), `focus / ${layers.join(' + ')}`).toBeGreaterThanOrEqual(3);
      });
      ['workspace', 'pinned', 'archive'].forEach((mark) =>
        expect(ratio(`--sn-color-mark-${mark}`, CARD), mark).toBeGreaterThanOrEqual(3),
      );
    });

    it('编辑区的文字、Markdown 标记、行号与光标清楚可辨', () => {
      // 编辑底色取代卡片底色，直接叠在面板上；占位文字与标签补全用弱化文字色，行号用 Markdown 标记的颜色。
      const editing = ['--sn-color-panel', '--sn-color-editing'];
      ['--sn-color-text', '--sn-color-text-secondary', '--sn-color-text-muted', '--sn-color-syntax', '--sn-color-accent-text'].forEach(
        (text) => expect(ratio(text, editing), text).toBeGreaterThanOrEqual(4.5),
      );
      expect(ratio('--sn-code-text', [...editing, '--sn-code-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-color-caret', editing)).toBeGreaterThanOrEqual(3);
    });

    it('状态栏上的文字不低于 4.5:1', () => {
      expect(ratio('--sn-color-on-statusbar', ['--sn-color-panel', '--sn-color-statusbar'])).toBeGreaterThanOrEqual(4.5);
    });

    it('代码文字在代码块上不低于 4.5:1', () => {
      expect(ratio('--sn-code-text', [...CARD, '--sn-code-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio('--sn-code-text', ['--sn-color-surface', '--sn-code-bg'])).toBeGreaterThanOrEqual(4.5);
    });
  },
);
