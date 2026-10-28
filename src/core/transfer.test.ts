/**
 * 卡片之间移动图片附件与正文引用：从原文取出、插入目标记录。
 */

import { describe, expect, it } from 'vitest';
import { noteDisplay } from './display';
import { parseBlocks, type InlineNode } from './markdown';
import { insertLine, moveImage, moveReference, removeRange } from './transfer';
import type { Note } from './types';

function note(id: string, text: string, images: Note['images'] = []): Note {
  return {
    id,
    text,
    emoji: '📝',
    images,
    pinned: false,
    collapsed: false,
    status: 'active',
    previousStatus: 'active',
    order: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

/** 显示正文中第一个文件引用或内嵌图片的范围，与卡片渲染时标出的位置一致。 */
function firstReference(text: string): { start: number; end: number } {
  const find = (nodes: InlineNode[]): { start: number; end: number } | null => {
    for (const node of nodes) {
      if (node.kind === 'file' || node.kind === 'image') return { start: node.start, end: node.end };
      if ('children' in node) {
        const inner = find(node.children);
        if (inner) return inner;
      }
    }
    return null;
  };
  for (const block of parseBlocks(noteDisplay(text).body)) {
    if (block.kind === 'file') return { start: block.start, end: block.end };
    if (block.kind === 'paragraph' || block.kind === 'heading') {
      const found = find(block.children);
      if (found) return found;
    }
    if (block.kind === 'list') {
      for (const item of block.items) {
        const found = find(item.children);
        if (found) return found;
      }
    }
  }
  throw new Error('没有引用');
}

describe('取出与插入', () => {
  it('取出句中的引用时合并多余空格', () => {
    expect(removeRange('见 [a](C:\\a.txt) 说明', 2, 15)).toBe('见 说明');
  });

  it('引用独占一行或只剩列表标记时整行删去', () => {
    expect(removeRange('甲\n[a](C:\\a.txt)\n乙', 2, 15)).toBe('甲\n乙');
    expect(removeRange('甲\n- [a](C:\\a.txt)', 4, 17)).toBe('甲');
  });

  it('在指定行之前插入一行，超出末尾时接在最后，沿用原文换行符', () => {
    expect(insertLine('甲\n乙', 1, '新')).toBe('甲\n新\n乙');
    expect(insertLine('甲\r\n乙', 9, '新')).toBe('甲\r\n乙\r\n新');
    expect(insertLine('', 0, '新')).toBe('新');
  });
});

describe('移动引用', () => {
  const source = note('a', '来源\n\n见 [报告.pdf](C:\\docs\\报告.pdf) 附件\n\n#工作');
  const target = note('b', '目标\n\n第一段\n\n第二段\n\n#生活');

  it('从来源取出引用，插到目标正文末尾、标签之前', () => {
    const { start, end } = firstReference(source.text);
    const moved = moveReference(source, target, start, end, Number.MAX_SAFE_INTEGER);
    expect(moved?.reference).toBe('[报告.pdf](C:\\docs\\报告.pdf)');
    expect(moved?.sourceText).toBe('来源\n\n见 附件\n\n#工作');
    expect(moved?.targetText).toBe('目标\n\n第一段\n\n第二段\n[报告.pdf](C:\\docs\\报告.pdf)\n\n#生活');
  });

  it('插到指定段落之前', () => {
    const { start, end } = firstReference(source.text);
    // 目标显示正文为「\n第一段\n\n第二段」，第二段从第 3 行开始。
    const moved = moveReference(source, target, start, end, 3);
    expect(moved?.targetText).toBe('目标\n\n第一段\n\n[报告.pdf](C:\\docs\\报告.pdf)\n第二段\n\n#生活');
  });

  it('位置已失效或同一张卡片时不做改动', () => {
    expect(moveReference(source, target, 0, 2, 0)).toBeNull();
    const { start, end } = firstReference(source.text);
    expect(moveReference(source, source, start, end, 0)).toBeNull();
  });

  it('独占一行的文件路径整行移动', () => {
    const pathNote = note('c', '路径\nC:\\docs\\a.txt\n说明');
    const { start, end } = firstReference(pathNote.text);
    const moved = moveReference(pathNote, target, start, end, 0);
    expect(moved?.sourceText).toBe('路径\n说明');
    expect(moved?.targetText.startsWith('目标\nC:\\docs\\a.txt\n')).toBe(true);
  });
});

describe('移动图片附件', () => {
  const image = (id: string) => ({ id, name: `${id}.png`, type: 'image/png', data: 'data:image/png;base64,AA' });

  it('插到目标附件的指定位置', () => {
    const moved = moveImage(note('a', '甲', [image('x'), image('y')]), note('b', '乙', [image('z')]), 'y', 0);
    expect(moved?.sourceImages.map((item) => item.id)).toEqual(['x']);
    expect(moved?.targetImages.map((item) => item.id)).toEqual(['y', 'z']);
  });

  it('图片不存在或同一张卡片时不做改动', () => {
    const source = note('a', '甲', [image('x')]);
    expect(moveImage(source, note('b', '乙'), 'nope', 0)).toBeNull();
    expect(moveImage(source, source, 'x', 0)).toBeNull();
  });
});
