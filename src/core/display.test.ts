/**
 * 卡片的标题行与显示正文，以及显示正文到原文的位置换算。
 */

import { describe, expect, it } from 'vitest';
import { displayLineCount, noteDisplay, sourceOffset } from './display';
import { parseBlocks } from './markdown';

describe('显示正文', () => {
  it('首行作标题时正文从第二行起，标签不显示', () => {
    const display = noteDisplay('标题\n\n正文 #标签');
    expect(display.firstLine).toBe('标题');
    expect(display.body).toBe('\n正文');
    expect(display.lineShift).toBe(1);
    expect(displayLineCount(display)).toBe(2);
  });

  it('首行是列表等结构化内容时正文从头显示', () => {
    const display = noteDisplay('- 第一项\n- 第二项');
    expect(display.structured).toBe(true);
    expect(display.lineShift).toBe(0);
    expect(display.body).toBe('- 第一项\n- 第二项');
  });

  it('显示正文中的位置换算回原文，兼容 CRLF', () => {
    const text = '标题\r\n\r\n见 [a](C:\\a.txt)';
    const display = noteDisplay(text);
    const offset = display.body.indexOf('[');
    expect(text[sourceOffset(text, display, offset)]).toBe('[');
  });

  it('待办状态的位置换算回原文后落在方括号之间，卡片中勾选才能改对字符', () => {
    const text = '今日待办\n\n- [x] 甲\n- [ ] 乙';
    const display = noteDisplay(text);
    const list = parseBlocks(display.body).find((block) => block.kind === 'list');
    const offsets = list?.kind === 'list' ? list.items.map((item) => sourceOffset(text, display, item.taskOffset ?? 0)) : [];
    expect(offsets.map((offset) => text.slice(offset - 1, offset + 2))).toEqual(['[x]', '[ ]']);
  });
});
