import { describe, expect, it } from 'vitest';
import { matchFonts, resolveFont } from './fonts';

const FAMILIES = ['Maple Mono NF CN', 'Microsoft YaHei UI', 'Segoe UI', 'Arial', 'Maple Mono', 'Noto Sans Mono'];

describe('字体候选', () => {
  it('完全相同的在前，其次是开头相同的，再次是包含输入的', () => {
    expect(matchFonts(FAMILIES, 'mono')).toEqual(['Maple Mono NF CN', 'Maple Mono', 'Noto Sans Mono']);
    expect(matchFonts(FAMILIES, 'maple mono')).toEqual(['Maple Mono', 'Maple Mono NF CN']);
    expect(matchFonts(FAMILIES, 'ui')).toEqual(['Microsoft YaHei UI', 'Segoe UI']);
    expect(matchFonts(FAMILIES, '  ')).toEqual(FAMILIES);
  });

  it('回车选用第一个候选，没有候选时不允许设置', () => {
    expect(resolveFont(FAMILIES, 'Maple')).toBe('Maple Mono NF CN');
    expect(resolveFont(FAMILIES, 'arial')).toBe('Arial');
    expect(resolveFont(FAMILIES, '不存在的字体')).toBeNull();
  });

  it('空输入或「跟随主题」中的文字选用跟随主题（空串）', () => {
    expect(resolveFont(FAMILIES, '')).toBe('');
    expect(resolveFont(FAMILIES, '跟随主题')).toBe('');
    expect(resolveFont(FAMILIES, '主题')).toBe('');
  });

  it('「系统默认」或其中的文字选用系统默认', () => {
    expect(resolveFont(FAMILIES, '系统默认')).toBe('系统默认');
    expect(resolveFont(FAMILIES, '系统')).toBe('系统默认');
  });
});
