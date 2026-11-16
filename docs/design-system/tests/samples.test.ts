/**
 * 第六次反馈补充的示例数据：交互原型（docs/prototype/app.js 的 createMoreExamples）与 Playground（playground/src/model/samples.ts）
 * 是同一批记录。
 *
 * - 两边的 id、正文、置顶、收起与回收站状态一致，id 不重复，都以 sample6- 开头；
 * - 覆盖验收清单要求的情况：相近的标签、跨页签的同一个词、很长的标签名、长标题、不带标签与带很多标签的记录、
 *   图片与文件引用、置顶、回收站，以及一年以前的日期。
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { canonicalize, parse } from '@/core/tags';
import { createExtraSampleNotes, SAMPLE_PINNED_TAGS } from '../playground/src/model/samples';
import { designPath } from './token-utils';

interface PrototypeSample {
  id: string;
  text: string;
  hours: number;
  pinned?: boolean;
  collapsed?: boolean;
  status?: string;
  deleted?: number;
  images?: unknown[];
}

/** 从原型的 app.js 里取出 createMoreExamples 运行（它不依赖别的全局变量），图片地址换成占位。 */
function prototypeSamples(): PrototypeSample[] {
  const source = readFileSync(resolvePath(designPath('../prototype'), 'app.js'), 'utf-8');
  const start = source.indexOf('function createMoreExamples');
  const end = source.indexOf('const SAMPLE_PINNED_TAGS', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return runInNewContext(`${source.slice(start, end)}; createMoreExamples(function svg(source) { return 'svg:' + source.length; });`) as PrototypeSample[];
}

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 15, 8);
const playground = createExtraSampleNotes(NOW);
const prototype = prototypeSamples();

describe('第六次反馈的示例数据', () => {
  it('原型与 Playground 是同一批记录：id、正文、置顶、收起与回收站状态一致', () => {
    expect(playground.map((note) => note.id)).toEqual(prototype.map((item) => item.id));
    prototype.forEach((item, index) => {
      const note = playground[index];
      expect(note.text).toBe(canonicalize(item.text));
      expect(note.pinned).toBe(Boolean(item.pinned));
      expect(note.collapsed).toBe(Boolean(item.collapsed));
      expect(note.status).toBe(item.status === 'trash' ? 'trash' : 'active');
      expect(note.createdAt).toBe(NOW + item.hours * HOUR);
      expect(note.images.length).toBe((item.images ?? []).length);
    });
  });

  it('id 不重复，都以 sample6- 开头；回收站中的记录有删除时间', () => {
    const ids = playground.map((note) => note.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('sample6-'))).toBe(true);
    playground.forEach((note) => expect(note.deletedAt === null).toBe(note.status !== 'trash'));
  });

  it('覆盖验收清单要求的情况', () => {
    const tags = playground.map((note) => parse(note.text).tags);
    const tagged = (tag: string) => tags.filter((list) => list.includes(tag)).length;
    // 相近的标签（写完整的已有标签只匹配它本身）与很长的标签名。
    expect(tagged('产品')).toBeGreaterThan(0);
    expect(tagged('产品经理')).toBeGreaterThan(0);
    expect(tagged('设计规范')).toBeGreaterThan(0);
    expect(tags.flat().some((tag) => tag.length >= 10)).toBe(true);
    // 「发布」出现在几个不同的页签里（开发、产品、设计）。
    const release = playground.filter((note) => note.text.includes('发布') && note.status === 'active');
    expect(new Set(release.flatMap((note) => parse(note.text).tags).filter((tag) => ['开发', '产品', '设计'].includes(tag))).size).toBe(3);
    // 长标题、只有一行、不带标签、带很多标签。
    expect(playground.some((note) => note.text.split('\n')[0].length > 20)).toBe(true);
    expect(playground.some((note) => !note.text.includes('\n'))).toBe(true);
    expect(tags.filter((list) => list.length === 0).length).toBeGreaterThanOrEqual(2);
    expect(tags.some((list) => list.length >= 8)).toBe(true);
    // 图片（一条记录多张）、文件引用、置顶、回收站与一年以前的日期。
    expect(playground.some((note) => note.images.length >= 2)).toBe(true);
    expect(playground.filter((note) => note.text.includes('](file:///')).length).toBeGreaterThanOrEqual(2);
    expect(playground.filter((note) => note.pinned).length).toBeGreaterThanOrEqual(3);
    expect(playground.filter((note) => note.status === 'trash').length).toBeGreaterThanOrEqual(3);
    expect(playground.some((note) => NOW - note.createdAt > 365 * 24 * HOUR)).toBe(true);
  });

  it('Playground 默认固定的标签足够多，侧栏窄时页签栏放不下；不固定「阅读」（组件页用它演示「固定为页签」）', () => {
    expect(SAMPLE_PINNED_TAGS.length).toBeGreaterThanOrEqual(6);
    expect(SAMPLE_PINNED_TAGS).not.toContain('阅读');
  });
});
