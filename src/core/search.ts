/**
 * 全局搜索（原型第二版，DS-12–DS-15，与交互原型 app.js 的 searchResults、matchesQuery 相同）。
 *
 * - 搜索全部未删除的记录，与当前页签无关；只写 # 还没写标签名时不算搜索（刚输入 # 时只联想标签，列表不变）。
 * - 文字与标签分开搜：不带 # 的词只搜标题、正文与附件名，带 # 的词只搜标签；写完整的已有标签只匹配这个标签，
 *   没写完的按前缀匹配。两种可以一起写，同时满足。
 * - 结果按页签分组：每条记录放在它所在的页签（core/tabs 的 homeTab），置顶组总在最上面，其余与页签栏的顺序相同，
 *   组内置顶在前，再按手动顺序与创建时间。
 *
 * 这些规则原在 Playground 的 model/notes.tsx，实现桌面端时搬进 src/core（T79），Playground 从这里引用。
 */

import { compareNoteOrder } from './notes';
import { allTags, homeTab, resultOrder } from './tabs';
import { parse, tagKey } from './tags';
import type { Note, TabKey } from './types';

/**
 * 搜索框的占位文字，桌面端只写在这里。还没定（原型第二版交接第六节），定下后原型、Playground 与这里一起改；
 * 要在最窄的输入框里放得下（侧栏最窄时约 279px）。
 */
export const SEARCH_PLACEHOLDER = '搜正文，#标签 筛选，如「开发 #发布」';

/** 实际的搜索词：去掉只有 # 还没写标签名的部分。 */
export function searchTerms(query: string): string {
  return query.replace(/(^|\s)#(?=\s|$)/gu, ' ').trim();
}

/** 搜索词拆成文字与标签：文字是小写的，标签是 tagKey。 */
export function searchNeedles(terms: string): { words: string[]; tags: string[] } {
  const tags: string[] = [];
  const words = terms
    .replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_match, tag: string) => {
      tags.push(tagKey(tag));
      return ' ';
    })
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return { words, tags };
}

/** 已有标签的 tagKey（未删除记录中的），「#标签」写完整的已有标签时只匹配这个标签。 */
export function knownTags(notes: readonly Note[]): Set<string> {
  return new Set(allTags(notes).map((item) => tagKey(item.tag)));
}

/** 标签 `key` 是否与搜索中的「#标签」相符：写完整的已有标签只认这个标签，没写完的按前缀。 */
export function tagMatches(key: string, needle: string, known: ReadonlySet<string>): boolean {
  return known.has(needle) ? key === needle : key.startsWith(needle);
}

/**
 * 记录是否与搜索词相符：不带 # 的词都要出现在标题、正文或附件名中，带 # 的词都要有相符的标签。
 * @param terms searchTerms 处理过的搜索词。 @param known 已有标签的 tagKey。
 */
export function matchesSearch(note: Note, terms: string, known: ReadonlySet<string>): boolean {
  if (!terms) return true;
  const { words, tags } = searchNeedles(terms);
  const parsed = parse(note.text);
  const keys = parsed.tags.map(tagKey);
  if (!tags.every((tag) => keys.some((key) => tagMatches(key, tag, known)))) return false;
  const haystack = `${parsed.body} ${note.images.map((image) => image.name).join(' ')}`.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface SearchGroup {
  tab: TabKey;
  notes: Note[];
}

/** 全部未删除记录中的搜索结果，按页签分组：置顶组在最前，其余与页签栏的顺序相同，组内置顶在前，再按手动顺序与创建时间。 */
export function searchGroups(notes: readonly Note[], pinned: readonly string[], query: string): SearchGroup[] {
  const terms = searchTerms(query);
  if (!terms) return [];
  const known = knownTags(notes);
  const groups = new Map<TabKey, Note[]>(resultOrder(pinned).map((tab) => [tab, []]));
  notes.forEach((note) => {
    if (note.status !== 'active' || !matchesSearch(note, terms, known)) return;
    groups.get(homeTab(note, pinned))?.push(note);
  });
  return Array.from(groups, ([tab, list]) => ({
    tab,
    notes: list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || compareNoteOrder(a, b)),
  })).filter((group) => group.notes.length);
}

/** 搜索词只是一个已有的标签（如「#产品」）时返回这个标签的写法，否则为空；这时筛选行里有「固定为页签」。 */
export function singleSearchTag(query: string, notes: readonly Note[]): string {
  const match = /^#([\p{L}\p{N}_-]+)$/u.exec(searchTerms(query));
  if (!match) return '';
  const key = tagKey(match[1]);
  return allTags(notes).find((item) => tagKey(item.tag) === key)?.tag ?? '';
}

/**
 * 搜的词正好是一个已有标签的名称时（如「开发」）返回这个标签与条数，否则为空：文字与标签分开搜之后，
 * 筛选行的结果条数后面出现「#开发 8 条」，点它改搜这个标签。
 */
export function wordTag(query: string, notes: readonly Note[]): { tag: string; count: number } | null {
  const word = searchTerms(query);
  if (!/^[\p{L}\p{N}_-]+$/u.test(word)) return null;
  const key = tagKey(word);
  return allTags(notes).find((item) => tagKey(item.tag) === key) ?? null;
}
