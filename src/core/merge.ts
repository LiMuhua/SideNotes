/**
 * 合并成一条（第四次反馈）：把零散的记录汇总到一张卡片里整理，例如随手记下的一条条采购。规则与交互原型的 merge.js 相同：
 *
 * - 标题：所有来源共有的标签（按标签合并时筛选的标签排在最前），没有时用第一条的标题；弹窗中可以改。
 * - 小节：每条记录除共同标签外的标签合成一个二级小标题，按列表中第一次出现的顺序排；只有共同标签的记录放在最前，
 *   不加小标题；带两个以上其他标签的记录合成一节，例如「装修 · 日常」，不拆成两份。标签行取所有来源标签的并集。
 * - 内容：清单格式下每条记录是一个待办，多出来的行缩进在待办下面；段落格式下每条记录整段放入，之间空一行。
 * - 合并到已有卡片：标题不变；按小标题对号，新内容追加到同名小节末尾，没有的小节加在最后；
 *   只有共同标签的内容加在第一个小标题之前。
 * - 图片：按来源顺序去掉重复，最多 12 张。
 *
 * 原在 Playground 的 model/merge.ts，实现桌面端时搬进 src/core（T80），Playground 从这里引用。
 */

import { noteTitle } from './notes';
import { compose, parse, tagKey } from './tags';
import type { Note, NoteImage } from './types';

export type MergeFormat = 'list' | 'text';

const MAX_IMAGES = 12;

interface Block {
  /** 小节的键：除共同标签外的标签，按小写合在一起；没有其他标签时为空。 */
  key: string;
  heading: string;
  text: string;
}

const includes = (list: readonly string[], tag: string) => list.some((item) => tagKey(item) === tagKey(tag));

/** 所有记录共有的标签，按第一条中的顺序；按标签合并时筛选的标签排在最前。 */
export function commonTags(notes: readonly Note[], first = ''): string[] {
  if (!notes.length) return [];
  const lists = notes.map((note) => parse(note.text).tags);
  const common = lists[0].filter((tag) => lists.every((list) => includes(list, tag)));
  const lead = first ? common.find((tag) => tagKey(tag) === tagKey(first)) : undefined;
  return lead ? [lead, ...common.filter((tag) => tag !== lead)] : common;
}

/** 标签的并集，按出现的顺序。 */
function union(lists: ReadonlyArray<readonly string[]>): string[] {
  const result: string[] = [];
  lists.forEach((list) =>
    list.forEach((tag) => {
      if (!includes(result, tag)) result.push(tag);
    }),
  );
  return result;
}

/** 来源是否都只有一行：都是时默认清单，否则默认段落。 */
export function defaultFormat(notes: readonly Note[]): MergeFormat {
  return notes.every((note) => parse(note.text).body.split('\n').filter((line) => line.trim()).length <= 1) ? 'list' : 'text';
}

/**
 * 一条记录在合并结果中的一块。清单格式：第一行去掉列表、待办、标题标记后写成待办（已勾选的保持勾选），
 * 其余行缩进两格放在待办下面。
 */
function block(note: Note, common: readonly string[], format: MergeFormat): Block {
  const parsed = parse(note.text);
  const extra = parsed.tags.filter((tag) => !includes(common, tag));
  const body = parsed.body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  let text = body;
  if (format === 'list') {
    const lines = body.split(/\r?\n/);
    const first = /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[([ xX])\]\s+)?(.*)$/.exec(lines[0] ?? '');
    const done = Boolean(first?.[1] && first[1] !== ' ');
    const rest = lines
      .slice(1)
      .map((line) => (line.trim() ? `  ${line}` : ''))
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
    text = `${done ? '- [x] ' : '- [ ] '}${(first ? first[2] : lines[0]).trim()}${rest ? `\n${rest}` : ''}`;
  }
  return { key: extra.map(tagKey).join('\u0000'), heading: extra.join(' · '), text };
}

/** 一节里的几块：清单逐行接上，段落之间空一行。 */
const joinBlocks = (texts: readonly string[], format: MergeFormat) => texts.join(format === 'list' ? '\n' : '\n\n');

/** 按小节分组，小节按第一次出现的顺序；没有其他标签的排在最前。 */
function group(blocks: readonly Block[]): Array<{ key: string; heading: string; texts: string[] }> {
  const sections: Array<{ key: string; heading: string; texts: string[] }> = [];
  blocks.forEach((item) => {
    let section = sections.find((entry) => entry.key === item.key);
    if (!section) {
      section = { key: item.key, heading: item.heading, texts: [] };
      sections.push(section);
    }
    section.texts.push(item.text);
  });
  return [...sections.filter((section) => !section.key), ...sections.filter((section) => section.key)];
}

/** 合并后的图片：按来源顺序去掉重复，最多 12 张。 */
export function mergedImages(notes: readonly Note[]): NoteImage[] {
  const result: NoteImage[] = [];
  notes.forEach((note) =>
    note.images.forEach((image) => {
      if (!result.some((item) => item.id === image.id)) result.push({ ...image });
    }),
  );
  return result.slice(0, MAX_IMAGES);
}

/** 弹窗中标题的默认值：共同标签，没有时用第一条的标题。 */
export function defaultTitle(notes: readonly Note[], tag = ''): string {
  const common = commonTags(notes, tag);
  return common.length ? common.join(' · ') : notes[0] ? noteTitle(notes[0]) : '';
}

/** 合并成一张新卡片的原文：标题、只有共同标签的内容、各小节，最后是标签行。 */
export function composeNew(notes: readonly Note[], options: { title: string; format: MergeFormat; tag?: string }): string {
  const common = commonTags(notes, options.tag);
  const sections = group(notes.map((note) => block(note, common, options.format)));
  const body = sections.map((section) => `${section.key ? `## ${section.heading}\n` : ''}${joinBlocks(section.texts, options.format)}`).join('\n\n');
  const tags = union([common, ...notes.map((note) => parse(note.text).tags)]);
  return compose(`${options.title.trim() || (notes[0] ? noteTitle(notes[0]) : '')}\n\n${body}`, tags);
}

/**
 * 合并到已有卡片的原文：标题与原有内容不变；按小标题对号，新内容追加到同名小节末尾，没有的小节加在最后；
 * 只有共同标签的内容加在第一个小标题之前。共同标签按来源与这张卡片一起算。
 */
export function composeInto(target: Note, notes: readonly Note[], options: { format: MergeFormat; tag?: string }): string {
  const common = commonTags([target, ...notes], options.tag);
  const sections = group(notes.map((note) => block(note, common, options.format)));
  const parsed = parse(target.text);
  const keyOf = (heading: string) => heading.split(/\s*·\s*/).map(tagKey).join('\u0000');
  // 原文按二级小标题切开：第一段是标题与小标题之前的内容，其余每段以小标题开头。
  const regions: Array<{ key: string; heading: string; lines: string[] }> = [{ key: '', heading: '', lines: [] }];
  parsed.body
    .replace(/\s+$/, '')
    .split(/\r?\n/)
    .forEach((line) => {
      const match = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) regions.push({ key: keyOf(match[1]), heading: line, lines: [] });
      else regions[regions.length - 1].lines.push(line);
    });
  const trim = (lines: string[]) => {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  };
  sections.forEach((section) => {
    let region = section.key ? regions.find((item) => item.heading && item.key === section.key) : regions[0];
    if (!region) {
      region = { key: section.key, heading: `## ${section.heading}`, lines: [] };
      regions.push(region);
    }
    const lines = trim(region.lines);
    const last = lines[lines.length - 1] ?? '';
    // 清单接在已有的待办后面不空行；其余情况空一行再接。
    const tight = options.format === 'list' && /^\s*(?:[-*+]|\d+[.)])\s|^\s{2,}\S/.test(last);
    if (lines.length && !tight) lines.push('');
    lines.push(...joinBlocks(section.texts, options.format).split('\n'));
  });
  const out: string[] = [];
  regions.forEach((region) => {
    if (region.heading) {
      trim(out);
      if (out.length) out.push('');
      out.push(region.heading);
    }
    out.push(...trim(region.lines.slice()));
  });
  const tags = union([parsed.tags, ...notes.map((note) => parse(note.text).tags)]);
  return compose(out.join('\n'), tags);
}
