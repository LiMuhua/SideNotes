import { describe, expect, it } from 'vitest';
import { bodyEnd, canonicalize, compose, hasTag, isValidTag, parse, removeTag, tagKey, tagLineStart } from './tags';

describe('标签解析', () => {
  it('提取行尾标签并移出正文', () => {
    const result = parse('一条记录\n\n正文内容 #工作 #待办');
    expect(result.tags).toEqual(['工作', '待办']);
    expect(result.body).toBe('一条记录\n\n正文内容');
  });

  it('忽略代码围栏内的井号', () => {
    const text = '命令\n\n```bash\n# 保持专注 #注释\n```\n\n#开发';
    const result = parse(text);
    expect(result.tags).toEqual(['开发']);
    expect(result.body).toContain('# 保持专注 #注释');
  });

  it('忽略缩进代码块内的标签', () => {
    const result = parse('示例\n\n    git commit -m "#123"\n\n#示例');
    expect(result.tags).toEqual(['示例']);
    expect(result.body).toContain('#123');
  });

  it('忽略行内代码中的标签', () => {
    const result = parse('配色 `#45694e` 很耐看 #设计');
    expect(result.tags).toEqual(['设计']);
    expect(result.body).toBe('配色 `#45694e` 很耐看');
  });

  it('排除十六进制色值', () => {
    const result = parse('主色 #45694e');
    expect(result.tags).toEqual([]);
    expect(result.body).toBe('主色 #45694e');
  });

  it('保留纯数字标签', () => {
    expect(parse('版本 #2026').tags).toEqual(['2026']);
  });

  it('保留 Markdown 标题不作为标签', () => {
    const result = parse('## 二级标题\n\n内容 #标签');
    expect(result.tags).toEqual(['标签']);
    expect(result.body).toContain('## 二级标题');
  });

  it('大小写不同的同名标签只保留一次', () => {
    expect(parse('内容 #Tauri #tauri').tags).toEqual(['Tauri']);
  });

  it('序列化把标签写到正文末尾的独立行', () => {
    expect(compose('正文', ['工作', '待办'])).toBe('正文\n\n#工作 #待办');
    expect(compose('', ['工作'])).toBe('#工作');
    expect(compose('正文', [])).toBe('正文');
  });

  it('规范化是幂等的', () => {
    const once = canonicalize('内容 #a\n其它 #b');
    expect(canonicalize(once)).toBe(once);
  });

  it('移除单个标签保留其余标签与正文', () => {
    expect(removeTag('正文\n\n#甲 #乙', '甲')).toBe('正文\n\n#乙');
  });

  it('标签匹配忽略大小写', () => {
    expect(hasTag('内容 #SideNotes', 'sidenotes')).toBe(true);
    expect(tagKey('#ＳideNotes')).toBe('sidenotes');
  });

  it('校验标签长度与字符集', () => {
    expect(isValidTag('工作')).toBe(true);
    expect(isValidTag('a-b_1')).toBe(true);
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('含 空格')).toBe(false);
    expect(isValidTag('45694e')).toBe(false);
    expect(isValidTag('x'.repeat(41))).toBe(false);
  });

  it('CRLF 原文也能正确解析', () => {
    expect(parse('一行\r\n二行 #标签').tags).toEqual(['标签']);
  });
});

describe('tagLineStart 与 bodyEnd', () => {
  it('找到末尾的标签行，正文末尾在标签行之前最后一个非空字符之后', () => {
    const text = '标题\n正文最后一句\n\n#工作 #会议';
    expect(tagLineStart(text)).toBe(text.indexOf('#工作'));
    expect(bodyEnd(text)).toBe(text.indexOf('句') + 1);
  });

  it('没有标签行时在全文末尾去掉尾部空白；只有标签时在全文末尾', () => {
    expect(tagLineStart('只有正文')).toBe(-1);
    expect(bodyEnd('只有正文\n\n')).toBe(4);
    expect(bodyEnd('#工作 #会议')).toBe('#工作 #会议'.length);
  });
});
