import { describe, expect, it } from 'vitest';
import { typedFont } from './fonts';

const FAMILIES = ['Maple Mono NF CN', 'Microsoft YaHei UI', 'Segoe UI', 'Arial'];

describe('输入的字体名', () => {
  it('与候选只差大小写时用候选的写法', () => {
    expect(typedFont(FAMILIES, ' arial ')).toEqual({ family: 'Arial', known: true });
    expect(typedFont(FAMILIES, '系统默认')).toEqual({ family: '系统默认', known: true });
  });

  it('不在候选中的名称原样使用，标记为新的一项', () => {
    expect(typedFont(FAMILIES, 'Maple')).toEqual({ family: 'Maple', known: false });
    expect(typedFont(FAMILIES, '不存在的字体')).toEqual({ family: '不存在的字体', known: false });
    expect(typedFont(FAMILIES, 'x'.repeat(130)).family).toHaveLength(120);
  });

  it('空输入或「跟随主题」保存为空字符串', () => {
    expect(typedFont(FAMILIES, '  ')).toEqual({ family: '', known: true });
    expect(typedFont(FAMILIES, '跟随主题')).toEqual({ family: '', known: true });
  });
});
