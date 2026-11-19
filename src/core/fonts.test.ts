import { describe, expect, it } from 'vitest';
import { filterFonts, typedFont } from './fonts';

const FAMILIES = ['Maple Mono NF CN', 'Microsoft YaHei UI', 'Segoe UI', 'Arial'];

describe('输入的字体名', () => {
  it('与候选只差大小写时用候选的写法', () => {
    expect(typedFont(FAMILIES, ' arial ')).toEqual({ family: 'Arial', known: true });
    expect(typedFont(FAMILIES, '系统默认')).toEqual({ family: '系统默认', known: true });
  });

  it('不在候选中的名称标记为不认识（字体框不保存它）', () => {
    expect(typedFont(FAMILIES, 'Maple')).toEqual({ family: 'Maple', known: false });
    expect(typedFont(FAMILIES, '不存在的字体')).toEqual({ family: '不存在的字体', known: false });
    expect(typedFont(FAMILIES, 'x'.repeat(130)).family).toHaveLength(120);
  });

  it('空输入或「跟随主题」保存为空字符串', () => {
    expect(typedFont(FAMILIES, '  ')).toEqual({ family: '', known: true });
    expect(typedFont(FAMILIES, '跟随主题')).toEqual({ family: '', known: true });
  });
});

describe('筛选字体候选', () => {
  const choices = [{ label: '跟随主题' }, ...FAMILIES.map((label) => ({ label })), { label: '系统默认' }];

  it('名称包含输入的文字即保留，不分大小写', () => {
    expect(filterFonts(choices, 'ui').map((choice) => choice.label)).toEqual(['Microsoft YaHei UI', 'Segoe UI']);
    expect(filterFonts(choices, ' MAPLE ').map((choice) => choice.label)).toEqual(['Maple Mono NF CN']);
    expect(filterFonts(choices, '默认').map((choice) => choice.label)).toEqual(['系统默认']);
  });

  it('对得更上的排在前面：完全相同、名称开头、单词开头、中间包含，同一级按字母顺序（T112）', () => {
    const fonts = ['Bookman Old Style', 'Cambria Math', 'Ebrima', 'Malgun Gothic', 'Maiandra GD', 'Magneto', 'Ma'].map((label) => ({ label }));
    expect(filterFonts(fonts, 'ma').map((choice) => choice.label)).toEqual([
      'Ma',
      'Magneto',
      'Maiandra GD',
      'Malgun Gothic',
      'Cambria Math',
      'Bookman Old Style',
      'Ebrima',
    ]);
  });

  it('输入为空时全部保留，筛不出时为空', () => {
    expect(filterFonts(choices, '  ')).toHaveLength(choices.length);
    expect(filterFonts(choices, '不存在的字体')).toEqual([]);
  });
});
