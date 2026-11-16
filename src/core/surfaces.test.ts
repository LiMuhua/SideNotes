import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE as PLAYGROUND_DEFAULT, SURFACES as PLAYGROUND_SURFACES } from '../../docs/design-system/playground/src/surfaces';
import { tokensFor } from '../../docs/design-system/tests/token-utils';
import { DEFAULT_SURFACE, SURFACES, THEME_FONTS, normalizeSurface, surfaceAttributes } from './surfaces';

/** 6 项结构差异与名称，按同样的字段取出后比较。 */
function structure(item: object): Record<string, unknown> {
  const { id, name, dock, entries, tabs, translucent, inlineShortcuts, tabMarks } = item as Record<string, unknown>;
  return { id, name, dock, entries, tabs, translucent, inlineShortcuts, tabMarks };
}

describe('主题结构', () => {
  it('主题列表、名称与 6 项结构差异与 Playground 一致', () => {
    expect(SURFACES.map(structure)).toEqual(PLAYGROUND_SURFACES.map(structure));
    expect(DEFAULT_SURFACE).toBe(PLAYGROUND_DEFAULT);
  });

  it('「跟随主题」的说明与各主题令牌的界面字体一致', () => {
    for (const { id } of SURFACES) {
      const fontUi = tokensFor(id, `tokens/${id}.css`, 'light').get('--sn-font-ui') ?? '';
      const first = fontUi.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      expect(THEME_FONTS[id], id).toBe(first);
    }
  });

  it('旧取值迁移：standard 改为终端，无法识别的取值回到默认', () => {
    expect(normalizeSurface('standard')).toBe('terminal');
    for (const { id } of SURFACES) expect(normalizeSurface(id)).toBe(id);
    for (const value of ['unknown', '', undefined, null, 3, 'toString']) expect(normalizeSurface(value)).toBe(DEFAULT_SURFACE);
  });

  it('根节点属性：主题、明暗与 6 项结构差异', () => {
    expect(surfaceAttributes('glass', 'dark')).toEqual({
      'data-sn-surface': 'glass',
      'data-sn-theme': 'dark',
      'data-sn-dock': 'blocks',
      'data-sn-entries': 'tiles',
      'data-sn-tabs': 'segmented',
      'data-sn-translucent': 'true',
      'data-sn-shortcuts': 'tooltip',
      'data-sn-tab-marks': 'true',
    });
    expect(surfaceAttributes('terminal', 'light')['data-sn-shortcuts']).toBe('inline');
  });
});
