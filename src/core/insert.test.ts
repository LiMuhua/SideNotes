import { describe, expect, it } from 'vitest';
import { placeAttachment, titleLine } from './insert';

const IMAGE = '![图](C:/a.png)';

describe('placeAttachment', () => {
  it('落在标签行上或之后时插到标签行之前，单独一段', () => {
    const source = '标题\n正文\n\n#工作';
    const tags = source.indexOf('#工作');
    const placed = placeAttachment(source, IMAGE, { start: source.length, end: source.length });
    expect(placed.text).toBe(`标题\n正文\n\n${IMAGE}\n\n#工作`);
    expect(placed.caret).toBe(tags + IMAGE.length);
  });

  it('落在卡片标题行或 # 标题行上时作为单独一行插在这一行之后', () => {
    const source = '会议纪要\n正文';
    expect(placeAttachment(source, IMAGE, { start: 2, end: 2 }).text).toBe(`会议纪要\n${IMAGE}\n正文`);
    const heading = '- 第一项\n## 小节\n内容';
    const at = heading.indexOf('小节') + 1;
    expect(placeAttachment(heading, IMAGE, { start: at, end: at }).text).toBe(`- 第一项\n## 小节\n${IMAGE}\n内容`);
  });

  it('其余插在光标处，替换选中的文字；没有位置时接在末尾作为单独一段', () => {
    const source = '- 第一项\n- 第二项';
    expect(placeAttachment(source, IMAGE, { start: 4, end: 5 }).text).toBe(`- 第一${IMAGE}\n- 第二项`);
    expect(placeAttachment('正文', IMAGE, null)).toEqual({ text: `正文\n\n${IMAGE}`, caret: 4 + IMAGE.length });
    expect(placeAttachment('', IMAGE, null)).toEqual({ text: IMAGE, caret: IMAGE.length });
  });
});

describe('titleLine', () => {
  it('第一个非空行是普通文字时才是标题行，列表、附件与只有标签的行不算', () => {
    expect(titleLine('\n标题\n正文')).toEqual({ start: 1, end: 3 });
    expect(titleLine('- 列表\n正文')).toBeNull();
    expect(titleLine(`${IMAGE}\n正文`)).toBeNull();
    expect(titleLine('#工作 #会议')).toBeNull();
  });
});
