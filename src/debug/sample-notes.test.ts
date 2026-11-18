import { describe, expect, it } from 'vitest';
import { createBulkSampleNotes } from './bulk-notes';
import { createSampleNotes } from './sample-notes';
import { parse } from '../core/tags';

describe('调试用的示例记录', () => {
  const now = Date.UTC(2026, 10, 18, 8);

  it('一百多条批量记录，标识固定且不重复，日期铺到大约一年前', () => {
    const bulk = createBulkSampleNotes(now);
    expect(bulk.length).toBeGreaterThanOrEqual(100);
    expect(new Set(bulk.map((note) => note.id)).size).toBe(bulk.length);
    expect(bulk.every((note) => note.id.startsWith('bulk-'))).toBe(true);
    const oldest = Math.min(...bulk.map((note) => note.createdAt));
    expect(now - oldest).toBeGreaterThan(300 * 24 * 3_600_000);
    expect(createBulkSampleNotes(now)).toEqual(bulk);
  });

  it('同一个词出现在多个页签的记录里，全局搜索能分出好几组', () => {
    const bulk = createBulkSampleNotes(now);
    const tagsWith = (word: string): Set<string> =>
      new Set(bulk.filter((note) => note.text.includes(word)).map((note) => parse(note.text).tags[0]));
    expect(tagsWith('发布').size).toBeGreaterThanOrEqual(3);
    expect(tagsWith('预算').size).toBeGreaterThanOrEqual(3);
  });

  it('全部示例包括原有的、原型共用的与批量生成的记录', () => {
    const all = createSampleNotes(now);
    expect(all.length).toBeGreaterThanOrEqual(24 + 36 + 100);
    expect(new Set(all.map((note) => note.id)).size).toBe(all.length);
  });
});
