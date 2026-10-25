/**
 * 记录的校验、默认值、排序与搜索。
 *
 * 校验规则与原型一致：导入备份与读取存档都经过同一套归一化，
 * 避免损坏数据进入界面；时间戳限制在 JavaScript 可表示范围内。
 */

import { isValidEmoji, pickEmoji } from './emoji';
import { canonicalize, parse, tagKey } from './tags';
import type { Draft, Note, NoteImage, NoteStatus, Settings, TabKey } from './types';

/** 单张图片上限，与附件读取和截图粘贴保持一致。 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** 单条记录的图片上限。 */
export const MAX_IMAGES_PER_NOTE = 12;
/** 时间戳允许的绝对值上限。 */
const MAX_TIMESTAMP = 8_640_000_000_000_000;

/** 生成稳定标识。 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 校验时间戳，越界时回落到当前时间。 */
function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= MAX_TIMESTAMP ? number : fallback;
}

/** 校验图片数据，拒绝外部请求地址以避免记录在渲染时发起网络请求。 */
export function normalizeImage(value: unknown): NoteImage | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<NoteImage>;
  if (typeof input.data !== 'string' || input.data.length > MAX_IMAGE_BYTES * 1.5) return null;
  if (!/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)(;[^,]*)?,/i.test(input.data)) return null;
  return {
    id: typeof input.id === 'string' && input.id ? input.id : createId(),
    name: String(input.name || '图片').slice(0, 160),
    type: String(input.type || 'image/png'),
    data: input.data,
  };
}

/** 校验一条记录；正文与图片同时为空时视为无效。 */
export function normalizeNote(value: unknown): Note | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.text !== 'string') return null;

  const images = Array.isArray(input.images)
    ? input.images.slice(0, MAX_IMAGES_PER_NOTE).map(normalizeImage).filter((image): image is NoteImage => image !== null)
    : [];
  if (!input.text.trim() && !images.length) return null;

  const status: NoteStatus = ['active', 'archived', 'trash'].includes(input.status as string)
    ? (input.status as NoteStatus)
    : 'active';
  const created = normalizeTimestamp(input.createdAt);

  return {
    id: typeof input.id === 'string' && input.id.length > 0 && input.id.length < 100 ? input.id : createId(),
    text: canonicalize(input.text),
    emoji: isValidEmoji(input.emoji) ? input.emoji : '',
    images,
    pinned: Boolean(input.pinned),
    collapsed: Boolean(input.collapsed),
    status,
    previousStatus: input.previousStatus === 'archived' ? 'archived' : 'active',
    order: Number.isFinite(Number(input.order)) && input.order !== null ? Number(input.order) : null,
    createdAt: created,
    updatedAt: normalizeTimestamp(input.updatedAt, created),
    deletedAt:
      input.deletedAt === null || input.deletedAt === undefined
        ? null
        : normalizeTimestamp(input.deletedAt, Date.now()),
  };
}

/** 校验草稿。 */
export function normalizeDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object') return { text: '', images: [], updatedAt: 0 };
  const input = value as Record<string, unknown>;
  return {
    text: typeof input.text === 'string' ? input.text : '',
    images: Array.isArray(input.images)
      ? input.images
          .slice(0, MAX_IMAGES_PER_NOTE)
          .map(normalizeImage)
          .filter((image): image is NoteImage => image !== null)
      : [],
    updatedAt: Number(input.updatedAt) || 0,
  };
}

/** 为缺少 Emoji 或存在重复的记录补齐唯一字符。 */
export function ensureEmoji(notes: Note[]): Note[] {
  const reserved = new Set(notes.map((note) => (isValidEmoji(note.emoji) ? note.emoji : '')).filter(Boolean));
  const used = new Set<string>();
  return notes.map((note) => {
    if (isValidEmoji(note.emoji) && !used.has(note.emoji)) {
      used.add(note.emoji);
      return note;
    }
    const emoji = pickEmoji(reserved);
    reserved.add(emoji);
    used.add(emoji);
    return { ...note, emoji };
  });
}

/** 创建一条新记录，Emoji 从未占用池分配。 */
export function createNote(
  text: string,
  images: NoteImage[],
  options: { pinned?: boolean; status?: NoteStatus; existing?: Note[] } = {},
): Note {
  const now = Date.now();
  return {
    id: createId(),
    text: canonicalize(text),
    emoji: pickEmoji((options.existing ?? []).map((note) => note.emoji)),
    images: images.map((image) => ({ ...image })),
    pinned: Boolean(options.pinned),
    collapsed: false,
    status: options.status ?? 'active',
    previousStatus: 'active',
    order: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** 默认按创建时间倒序；手动排序后使用持久化的序号。 */
export function compareNoteOrder(a: Note, b: Note): number {
  const left = a.order ?? -a.createdAt;
  const right = b.order ?? -b.createdAt;
  return left - right || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

/** 判断记录是否属于当前页签。 */
export function inTab(note: Note, tab: TabKey): boolean {
  if (tab === 'archive') return note.status === 'archived';
  return note.status === 'active' && (tab !== 'pinned' || note.pinned);
}

/**
 * 支持正文与多个标签组合的搜索。
 *
 * 查询中的 `#标签` 按前缀匹配，其余词条在正文、标签与图片名中逐词匹配。
 */
export function matchesQuery(note: Note, query: string): boolean {
  if (!String(query).trim()) return true;
  const parsed = parse(note.text);
  const tags: string[] = [];
  const text = String(query)
    .replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_match, tag: string) => {
      tags.push(tagKey(tag));
      return ' ';
    })
    .trim()
    .toLocaleLowerCase();

  const tagsMatch = tags.every((tag) => parsed.tags.some((item) => tagKey(item).startsWith(tag)));
  if (!tagsMatch) return false;

  const haystack = `${parsed.body} ${parsed.tags.join(' ')} ${note.images
    .map((image) => image.name)
    .join(' ')}`.toLocaleLowerCase();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** 判断回收站记录是否超过保留天数。 */
export function isExpired(note: Note, retainDays: number, now = Date.now()): boolean {
  return Boolean(note.deletedAt) && now - (note.deletedAt ?? 0) > Math.max(1, retainDays) * 86_400_000;
}

/** 今天显示时分，其他日期显示完整年月日时分。 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return hm;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')} ${hm}`;
}

/** 完整本地时间，用于设置页与记录信息。 */
export function formatFullTime(timestamp: number): string {
  if (!timestamp) return '尚无';
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 取卡片标题：首个非空行，去掉 Markdown 标记。 */
export function noteTitle(note: Note): string {
  const body = parse(note.text).body;
  const line = body.split('\n').find((item) => item.trim());
  if (!line) return note.images.length ? '图片记录' : '记录';
  return (
    line
      .replace(/^#{1,6}\s+|^[-*+]\s+|^\d+\.\s+/, '')
      .replace(/[*`~]/g, '')
      .slice(0, 120) || '记录'
  );
}

/** 标签候选及其排序分数。 */
export interface RankedTag {
  tag: string;
  /** 当前页签内包含此标签的记录数。 */
  count: number;
  /** 其中置顶的条数。 */
  pinned: number;
  /** 最近修改时间。 */
  updated: number;
  score: number;
  match: boolean;
  exact: boolean;
  selected: boolean;
}

/**
 * 汇总标签并按固定权重评分。
 *
 * 权重与原型一致：访问频率 40、近期访问 30、记录条数 4、置顶情况 3。
 */
export function rankTags(
  notes: Note[],
  tab: TabKey,
  usage: Record<string, { count: number; last: number }>,
  query: string,
  selectedTag: string,
  now = Date.now(),
): RankedTag[] {
  const grouped = new Map<string, { tag: string; count: number; pinned: number; updated: number }>();
  notes
    .filter((note) => inTab(note, tab))
    .forEach((note) => {
      parse(note.text).tags.forEach((tag) => {
        const key = tagKey(tag);
        const item = grouped.get(key) ?? { tag, count: 0, pinned: 0, updated: 0 };
        item.count += 1;
        item.pinned += note.pinned ? 1 : 0;
        item.updated = Math.max(item.updated, note.updatedAt);
        grouped.set(key, item);
      });
    });

  const tagQueries = Array.from(query.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu));
  const tagMode = tagQueries.length > 0;
  const keyword = tagKey(tagMode ? tagQueries[tagQueries.length - 1][1] : query.trim());

  return Array.from(grouped.values())
    .map<RankedTag>((item) => {
      const record = usage[tagKey(item.tag)] ?? { count: 0, last: 0 };
      const ageDays = (now - (Number(record.last) || 0)) / 86_400_000;
      const score =
        40 * Math.log2(1 + (Number(record.count) || 0)) +
        30 * Math.max(0, 1 - ageDays / 14) +
        4 * Math.min(item.count, 10) +
        3 * Math.min(item.pinned, 4);
      const key = tagKey(item.tag);
      return {
        ...item,
        score,
        match: Boolean(keyword && (tagMode ? key.startsWith(keyword) : key.includes(keyword))),
        exact: Boolean(keyword && key === keyword),
        selected: Boolean(selectedTag && tagKey(selectedTag) === key),
      };
    })
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        Number(b.match) - Number(a.match) ||
        Number(b.selected) - Number(a.selected) ||
        b.score - a.score ||
        b.updated - a.updated ||
        a.tag.localeCompare(b.tag, 'zh-CN'),
    );
}

/** 判断记录是否需要显示「展开全文」。 */
export function likelyLong(note: Note): boolean {
  const body = parse(note.text).body;
  return body.length > 360 || body.split('\n').length > 9 || note.images.length > 1;
}

/** 判断当前记录数是否触发整理提醒。 */
export function shouldNudgeTidy(notes: Note[], settings: Settings, now = Date.now()): boolean {
  const count = notes.filter((note) => note.status === 'active').length;
  const limit = settings.tidyLimit || 0;
  return limit > 0 && count > limit && now > (settings.tidySnoozeUntil || 0);
}
