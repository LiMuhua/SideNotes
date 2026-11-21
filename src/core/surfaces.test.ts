import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE as PLAYGROUND_DEFAULT, SURFACES as PLAYGROUND_SURFACES } from '../../docs/design-system/playground/src/surfaces';
import { tokensFor } from '../../docs/design-system/tests/token-utils';
import { DEFAULT_SURFACE, SURFACES, THEME_FONTS, normalizeSurface, sidebarMaterial, surfaceAttributes, windowMaterial } from './surfaces';

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

  it('侧栏窗口的材质：分块的磨砂玻璃与不透明的浮动面板全透明，半透明的浮动面板用亚克力，贴边整块不透明', () => {
    for (const { id, dock, translucent } of SURFACES) {
      const expected = dock === 'blocks' ? 'clear' : translucent ? 'acrylic' : dock === 'floating' ? 'clear' : 'opaque';
      expect(sidebarMaterial(id), id).toBe(expected);
    }
    expect(sidebarMaterial('paper')).toBe('clear');
    expect(sidebarMaterial('terminal')).toBe('opaque');
  });

  it('速记浮窗与记录窗口的材质：记录纸的侧栏是浮动面板，这两种窗口仍是不透明的一整块，外框由系统画', () => {
    expect(surfaceAttributes('paper', 'light')['data-sn-dock']).toBe('floating');
    expect(windowMaterial('paper')).toBe('opaque');
    expect(windowMaterial('terminal')).toBe('opaque');
    expect(windowMaterial('magazine')).toBe('clear');
    expect(windowMaterial('win11')).toBe('acrylic');
    expect(windowMaterial('glass')).toBe('acrylic');
  });

  it('浮动面板四角同样圆：贴边一侧的圆角与面板圆角相同', () => {
    for (const { id, dock } of SURFACES) {
      if (dock !== 'floating') continue;
      const tokens = tokensFor(id, `tokens/${id}.css`, 'light');
      expect(tokens.get('--sn-panel-radius-edge'), id).toBe(tokens.get('--sn-panel-radius'));
    }
  });
});
