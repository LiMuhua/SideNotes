/**
 * 侧栏的页签（原型第二版，DS-11）：随记、置顶与用户手动固定的标签。
 *
 * - 随记（内部仍叫 workspace）显示没有任何已固定标签的记录；置顶显示置顶的记录；标签页签写成 `tag:标签`，
 *   显示带这个标签的记录。去掉了「归档」：旧的归档记录回到随记，正文加上 #归档（notes.ts 的 migrateArchivedNote）。
 * - 固定的标签按页签栏的顺序保存在设置的 pinnedTags 中，只由用户手动固定，不会自动出现。
 * - 全局搜索的结果按记录所在的页签分组（homeTab），置顶组在最前。
 *
 * 这些规则原在 Playground 的 model/notes.tsx，实现桌面端时搬进 src/core（T78），Playground 从这里引用，
 * 与交互原型的 tabs.js 相同。
 */

import { compareNoteOrder, matchesQuery } from './notes';
import { compose, parse, tagKey } from './tags';
import type { Note, TabKey } from './types';

const TAG_TAB = 'tag:';

/** 随记与置顶的名称。 */
export const TAB_LABELS = { workspace: '随记', pinned: '置顶' } as const;

/** 页签对应的标签；随记与置顶返回空字符串。 */
export function tagOfTab(tab: TabKey): string {
  return tab.startsWith(TAG_TAB) ? tab.slice(TAG_TAB.length) : '';
}

/** 标签页签的标识。 */
export function tabOfTag(tag: string): TabKey {
  return `tag:${tag}`;
}

/** 页签在提示中的名称：随记、置顶或「标签」。 */
export function tabLabel(tab: TabKey): string {
  const tag = tagOfTab(tab);
  return tag ? `「${tag}」` : TAB_LABELS[tab as 'workspace' | 'pinned'];
}

/** 页签显示的名称（不带引号）：随记、置顶或标签名。 */
export function tabName(tab: TabKey): string {
  return tagOfTab(tab) || TAB_LABELS[tab as 'workspace' | 'pinned'];
}

/** 已固定的同名标签（不分大小写），返回固定时的写法；没有时为空字符串。 */
export function findPinned(pinned: readonly string[], tag: string): string {
  const key = tagKey(tag);
  return pinned.find((item) => tagKey(item) === key) ?? '';
}

/** 记录是否带有某个标签（忽略大小写与全角差异）。 */
export function hasTagKey(note: Note, tag: string): boolean {
  const key = tagKey(tag);
  return parse(note.text).tags.some((item) => tagKey(item) === key);
}

/** 记录所在的第一个标签页签（按页签栏的顺序）；没有时为空字符串。 */
export function pinnedTagOf(note: Note, pinned: readonly string[]): string {
  return pinned.find((tag) => hasTagKey(note, tag)) ?? '';
}

/** 页签是否还在：标签页签移出页签栏之后就不在了。 */
export function tabExists(tab: TabKey, pinned: readonly string[]): boolean {
  const tag = tagOfTab(tab);
  return tag ? Boolean(findPinned(pinned, tag)) : tab === 'workspace' || tab === 'pinned';
}

/** 记录是否显示在这个页签里：随记是没有任何已固定标签的记录，置顶是置顶的记录，标签页签是带这个标签的记录。 */
export function belongsTo(note: Note, tab: TabKey, pinned: readonly string[]): boolean {
  if (note.status !== 'active') return false;
  if (tab === 'pinned') return note.pinned;
  const tag = tagOfTab(tab);
  return tag ? hasTagKey(note, tag) : !pinnedTagOf(note, pinned);
}

/** 页签内的记录，按现有应用的排序规则：置顶的在前，再按手动顺序与创建时间。 */
export function notesInTab(notes: readonly Note[], tab: TabKey, pinned: readonly string[]): Note[] {
  const list = notes.filter((note) => belongsTo(note, tab, pinned)).sort(compareNoteOrder);
  return tab === 'pinned' ? list : [...list.filter((note) => note.pinned), ...list.filter((note) => !note.pinned)];
}

/** 页签内经过搜索与标签筛选后的记录。 */
export function filterNotes(notes: readonly Note[], tab: TabKey, pinned: readonly string[], query: string, tag: string): Note[] {
  return notesInTab(notes, tab, pinned).filter((note) => matchesQuery(note, query) && (!tag || hasTagKey(note, tag)));
}

/** 页签栏的顺序：随记、置顶与固定的标签。 */
export function tabOrder(pinned: readonly string[]): TabKey[] {
  return ['workspace', 'pinned', ...pinned.map(tabOfTag)];
}

/** 全局搜索结果的分组顺序（第七次反馈）：置顶总在最上面，其余与页签栏相同。 */
export function resultOrder(pinned: readonly string[]): TabKey[] {
  return ['pinned', 'workspace', ...pinned.map(tabOfTag)];
}

/**
 * 记录所在的页签：置顶的在置顶，其余没有已固定标签的在随记，有的在它的第一个固定标签。
 * 全局搜索的结果按它分组，「转到」也去这里。
 */
export function homeTab(note: Note, pinned: readonly string[]): TabKey {
  return resultOrder(pinned).find((tab) => belongsTo(note, tab, pinned)) ?? 'workspace';
}

/** 页签里的记录条数。 */
export function tabCount(notes: readonly Note[], tab: TabKey, pinned: readonly string[]): number {
  return notes.filter((note) => belongsTo(note, tab, pinned)).length;
}

/** 未删除记录中的全部标签与条数，条数多的在前（新建页签的候选）。 */
export function allTags(notes: readonly Note[]): Array<{ tag: string; count: number }> {
  const groups = new Map<string, { tag: string; count: number }>();
  notes.forEach((note) => {
    if (note.status !== 'active') return;
    parse(note.text).tags.forEach((tag) => {
      const key = tagKey(tag);
      const entry = groups.get(key);
      if (entry) entry.count += 1;
      else groups.set(key, { tag, count: 1 });
    });
  });
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

/**
 * 把卡片移到另一个页签时要改的字段（与交互原型的 tabPatch 相同）：到标签页签加上这个标签，从别的标签页签来时换掉原来那个；
 * 到随记去掉当前页签的标签（从置顶来时取消置顶）；到置顶只置顶。
 */
export function tabPatch(note: Note, from: TabKey, to: TabKey): Partial<Note> {
  if (to === 'pinned') return { pinned: true };
  const patch: Partial<Note> = {};
  if (to === 'workspace' && from === 'pinned') patch.pinned = false;
  const fromTag = tagOfTab(from);
  const toTag = tagOfTab(to);
  if (fromTag || toTag) {
    const parsed = parse(note.text);
    let tags = parsed.tags.slice();
    if (fromTag && (!toTag || tagKey(fromTag) !== tagKey(toTag))) tags = tags.filter((tag) => tagKey(tag) !== tagKey(fromTag));
    if (toTag && !tags.some((tag) => tagKey(tag) === tagKey(toTag))) tags.push(toTag);
    if (tags.join('\n') !== parsed.tags.join('\n')) patch.text = compose(parsed.body, tags);
  }
  return patch;
}
