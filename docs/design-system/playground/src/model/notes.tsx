/**
 * Playground 的记录仓库。
 *
 * 复用现有应用的记录模型与规则（`src/core`）：记录、页签归属、排序、搜索、标签解析都调用同一批函数，
 * 示例数据取自 `src/debug/sample-notes.ts`，后面追加第六次反馈补充的示例（`./samples.ts`）。
 * 数据只在内存中，不调用桌面接口、不读写数据库。
 *
 * 数据层（记录、草稿、设置）全局共享：侧栏、速记浮窗与设置窗口看到同一份数据，
 * 与现有应用三个窗口共用一个数据库的行为一致。界面状态由各个侧栏实例自己持有，见 `useSidebarView`。
 *
 * 页签按第四次反馈（与交互原型相同）：随记、置顶与手动固定的标签，去掉了「归档」。现有应用还是工作区、置顶、归档，
 * 所以页签的归属在这里按新规则计算，不用 `src/core` 的 inTab；旧的归档记录在示例数据中迁移为带 #归档 的普通记录。
 */

import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from 'react';
import { compareNoteOrder, createNote, matchesQuery } from '@/core/notes';
import { DEFAULT_SETTINGS } from '@/core/settings';
import { canonicalize, compose, hasTag, parse, removeTag, tagKey } from '@/core/tags';
import type { Note, NoteStatus, Settings, TagUsage } from '@/core/types';
import { createSampleNotes } from '@/debug/sample-notes';
import { CUSTOM_APP_ICON, DEFAULT_APP_ICON } from './appIcons';
import { createExtraSampleNotes, SAMPLE_PINNED_TAGS } from './samples';

interface State {
  notes: Note[];
  /** 新建卡片与速记浮窗共用的草稿。 */
  draft: string;
  settings: Settings;
  /** 标签筛选的访问记录，标签菜单按它评分（与现有应用的 tagUsage 一致）。 */
  tagUsage: Record<string, TagUsage>;
  /** 应用图标（本次提出）：内置图标的 id，或 CUSTOM_APP_ICON 表示使用上传的图片。 */
  appIcon: string;
  /** 上传并裁好的图标（256 × 256 PNG 的 data URL）；没有上传过时为 null。 */
  customIcon: string | null;
  /** 固定为页签的标签，按页签栏的顺序（第四次反馈；交互原型存在设置的 pinnedTags 中）。 */
  pinnedTags: string[];
}

type Action =
  | { type: 'create'; note: Note }
  | { type: 'update'; id: string; text: string; now: number }
  | { type: 'pin'; id: string; pinned: boolean }
  | { type: 'status'; ids: string[]; status: NoteStatus; now: number }
  | { type: 'restore'; ids: string[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'collapse'; ids: string[]; collapsed: boolean }
  | { type: 'emoji'; id: string; emoji: string }
  | { type: 'order'; ids: string[] }
  | { type: 'draft'; text: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'app-icon'; icon: string }
  | { type: 'custom-icon'; url: string | null }
  | { type: 'track-tag'; tag: string; now: number }
  | { type: 'rename-tag'; tag: string; next: string; now: number }
  | { type: 'remove-tag'; tag: string; now: number }
  | { type: 'pinned-tags'; tags: string[] }
  | { type: 'patch'; changes: ReadonlyArray<readonly [string, Partial<Note>]> }
  | { type: 'reset'; now: number };

/** 给原文带上一个标签；已经带着（不分大小写）时不变。 */
export function withTag(text: string, tag: string): string {
  const parsed = parse(text);
  return parsed.tags.some((item) => tagKey(item) === tagKey(tag)) ? text : compose(parsed.body, [...parsed.tags, tag]);
}

/**
 * 去掉「归档」之后的迁移（第四次反馈，与交互原型相同）：旧的归档记录（包括从归档移进回收站的）回到随记，
 * 正文加上 #归档，可以用这个标签找回或固定成页签。
 */
function migrateArchived(note: Note): Note {
  if (note.status !== 'archived' && note.previousStatus !== 'archived') return note;
  return { ...note, text: canonicalize(withTag(note.text, '归档')), status: note.status === 'trash' ? 'trash' : 'active', previousStatus: 'active' };
}

function initialState(now = Date.now()): State {
  // 字体默认「跟随主题」（空值）：现有设置里的旧默认值 Maple Mono NF CN 迁移为跟随主题，见 adaptation.md。
  return {
    // 示例数据中已经固定了几个标签（SAMPLE_PINNED_TAGS），用来演示标签页签与放不下的情况；页签只由用户手动固定，不会自动出现。
    notes: [...createSampleNotes(now), ...createExtraSampleNotes(now)].map(migrateArchived),
    draft: '',
    settings: { ...DEFAULT_SETTINGS, fontFamily: '' },
    tagUsage: {},
    appIcon: DEFAULT_APP_ICON,
    customIcon: null,
    pinnedTags: SAMPLE_PINNED_TAGS,
  };
}

function reduce(state: State, action: Action): State {
  const update = (ids: readonly string[], change: (note: Note) => Note): Note[] =>
    state.notes.map((note) => (ids.includes(note.id) ? change(note) : note));

  switch (action.type) {
    case 'create':
      return { ...state, notes: [action.note, ...state.notes] };
    case 'update':
      return {
        ...state,
        notes: update([action.id], (note) => ({ ...note, text: canonicalize(action.text), updatedAt: action.now })),
      };
    case 'pin':
      return { ...state, notes: update([action.id], (note) => ({ ...note, pinned: action.pinned })) };
    case 'status':
      return {
        ...state,
        notes: update(action.ids, (note) => ({
          ...note,
          status: action.status,
          // 移入回收站时记住原位置，恢复时回到那里（与现有应用的 previousStatus 语义一致）。
          previousStatus: action.status === 'trash' ? (note.status === 'trash' ? note.previousStatus : note.status) : note.previousStatus,
          deletedAt: action.status === 'trash' ? action.now : null,
        })),
      };
    case 'restore':
      return { ...state, notes: update(action.ids, (note) => ({ ...note, status: note.previousStatus, deletedAt: null })) };
    case 'remove':
      return { ...state, notes: state.notes.filter((note) => !action.ids.includes(note.id)) };
    case 'collapse':
      return { ...state, notes: update(action.ids, (note) => ({ ...note, collapsed: action.collapsed })) };
    case 'emoji':
      return { ...state, notes: update([action.id], (note) => ({ ...note, emoji: action.emoji })) };
    case 'order': {
      // 拖动排序后，按新的顺序为这一组记录写入序号（与现有应用持久化 order 的方式一致）。
      const position = new Map(action.ids.map((id, index) => [id, index]));
      return { ...state, notes: state.notes.map((note) => (position.has(note.id) ? { ...note, order: position.get(note.id) ?? null } : note)) };
    }
    case 'draft':
      return { ...state, draft: action.text };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'app-icon':
      return { ...state, appIcon: action.icon };
    case 'custom-icon':
      // 上传后立即使用新图标；移除时如果正在使用它，回到默认图标。
      return {
        ...state,
        customIcon: action.url,
        appIcon: action.url ? CUSTOM_APP_ICON : state.appIcon === CUSTOM_APP_ICON ? DEFAULT_APP_ICON : state.appIcon,
      };
    case 'track-tag': {
      const key = tagKey(action.tag);
      const current = state.tagUsage[key] ?? { count: 0, last: 0 };
      return { ...state, tagUsage: { ...state.tagUsage, [key]: { count: Math.min(10_000, current.count + 1), last: action.now } } };
    }
    case 'rename-tag': {
      // 与现有应用的 renameTag 一致：只改标签、不动正文，新名称已存在时合并，访问记录随之迁移。
      const oldKey = tagKey(action.tag);
      const newKey = tagKey(action.next);
      const tagUsage = { ...state.tagUsage };
      if (tagUsage[oldKey]) {
        tagUsage[newKey] = tagUsage[oldKey];
        if (newKey !== oldKey) delete tagUsage[oldKey];
      }
      // 固定的页签跟着改名；新名称已经固定时两个页签合成一个（第四次反馈）。
      const pinnedTags = state.pinnedTags.reduce<string[]>((list, item) => {
        const next = tagKey(item) === oldKey ? action.next : item;
        return list.some((entry) => tagKey(entry) === tagKey(next)) ? list : [...list, next];
      }, []);
      return {
        ...state,
        tagUsage,
        pinnedTags,
        notes: state.notes.map((note) => {
          if (!hasTag(note.text, action.tag)) return note;
          const parsed = parse(note.text);
          const tags = parsed.tags.map((item) => (tagKey(item) === oldKey ? action.next : item));
          return { ...note, text: compose(parsed.body, tags), updatedAt: action.now };
        }),
      };
    }
    case 'remove-tag':
      // 与现有应用的 removeTagEverywhere 一致：只剩这个标签的空记录改用标签名作为正文。
      return {
        ...state,
        notes: state.notes.map((note) => {
          if (!hasTag(note.text, action.tag)) return note;
          let text = removeTag(note.text, action.tag);
          if (!text.trim() && !note.images.length) text = action.tag;
          return { ...note, text, updatedAt: action.now };
        }),
      };
    case 'pinned-tags':
      return { ...state, pinnedTags: action.tags };
    case 'patch': {
      const changes = new Map(action.changes);
      return { ...state, notes: state.notes.map((note) => (changes.has(note.id) ? { ...note, ...changes.get(note.id) } : note)) };
    }
    case 'reset':
      // 设置、应用图标与固定的页签都属于偏好，重置示例数据时保留。
      return { ...initialState(action.now), settings: state.settings, appIcon: state.appIcon, customIcon: state.customIcon, pinnedTags: state.pinnedTags };
  }
}

export interface NotesData extends State {
  byId: ReadonlyMap<string, Note>;
  create: (text: string) => Note;
  update: (id: string, text: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  setStatus: (ids: string[], status: NoteStatus) => void;
  restore: (ids: string[]) => void;
  removeForever: (ids: string[]) => void;
  setCollapsed: (ids: string[], collapsed: boolean) => void;
  setEmoji: (id: string, emoji: string) => void;
  /** 一组记录的新顺序（同一页签内）。 */
  reorder: (ids: string[]) => void;
  duplicate: (id: string) => Note | null;
  setDraft: (text: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /** 换成某个内置图标，或者换回已经上传的自定义图标（CUSTOM_APP_ICON）。 */
  setAppIcon: (icon: string) => void;
  /** 保存上传的图标并立即使用；传 null 移除。 */
  setCustomIcon: (url: string | null) => void;
  /** 记一次标签筛选，作为标签菜单的评分依据。 */
  trackTagUsage: (tag: string) => void;
  /** 在所有记录中重命名标签，新名称已存在时合并。 */
  renameTag: (tag: string, next: string) => void;
  /** 从所有记录中移除标签，正文与附件保留。 */
  removeTagEverywhere: (tag: string) => void;
  /** 固定为页签的标签与顺序：固定、移出与撤销都整体替换（第四次反馈）。 */
  setPinnedTags: (tags: string[]) => void;
  /** 按记录改若干字段：移到页签、合并与它们的撤销。 */
  patchNotes: (changes: ReadonlyArray<readonly [string, Partial<Note>]>) => void;
  /** 加入一条已经建好的记录（合并成一条：位置与置顶取自原来的第一条）。 */
  insertNote: (note: Note) => void;
  reset: () => void;
}

const NotesContext = createContext<NotesData | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialState());
  const byId = useMemo(() => new Map(state.notes.map((note) => [note.id, note])), [state.notes]);

  const create = useCallback(
    (text: string) => {
      const note = createNote(text, [], { existing: state.notes });
      dispatch({ type: 'create', note });
      return note;
    },
    [state.notes],
  );
  const duplicate = useCallback(
    (id: string) => {
      const source = state.notes.find((note) => note.id === id);
      if (!source) return null;
      const note = createNote(source.text, source.images, { pinned: source.pinned, status: source.status === 'trash' ? 'active' : source.status, existing: state.notes });
      dispatch({ type: 'create', note });
      return note;
    },
    [state.notes],
  );
  const update = useCallback((id: string, text: string) => dispatch({ type: 'update', id, text, now: Date.now() }), []);
  const setPinned = useCallback((id: string, pinned: boolean) => dispatch({ type: 'pin', id, pinned }), []);
  const setStatus = useCallback((ids: string[], status: NoteStatus) => dispatch({ type: 'status', ids, status, now: Date.now() }), []);
  const restore = useCallback((ids: string[]) => dispatch({ type: 'restore', ids }), []);
  const removeForever = useCallback((ids: string[]) => dispatch({ type: 'remove', ids }), []);
  const setCollapsed = useCallback((ids: string[], collapsed: boolean) => dispatch({ type: 'collapse', ids, collapsed }), []);
  const setEmoji = useCallback((id: string, emoji: string) => dispatch({ type: 'emoji', id, emoji }), []);
  const reorder = useCallback((ids: string[]) => dispatch({ type: 'order', ids }), []);
  const setDraft = useCallback((text: string) => dispatch({ type: 'draft', text }), []);
  const updateSettings = useCallback((patch: Partial<Settings>) => dispatch({ type: 'settings', patch }), []);
  const setAppIcon = useCallback((icon: string) => dispatch({ type: 'app-icon', icon }), []);
  const setCustomIcon = useCallback((url: string | null) => dispatch({ type: 'custom-icon', url }), []);
  const trackTagUsage = useCallback((tag: string) => dispatch({ type: 'track-tag', tag, now: Date.now() }), []);
  const renameTag = useCallback((tag: string, next: string) => dispatch({ type: 'rename-tag', tag, next, now: Date.now() }), []);
  const removeTagEverywhere = useCallback((tag: string) => dispatch({ type: 'remove-tag', tag, now: Date.now() }), []);
  const setPinnedTags = useCallback((tags: string[]) => dispatch({ type: 'pinned-tags', tags }), []);
  const patchNotes = useCallback((changes: ReadonlyArray<readonly [string, Partial<Note>]>) => dispatch({ type: 'patch', changes }), []);
  const insertNote = useCallback((note: Note) => dispatch({ type: 'create', note }), []);
  const reset = useCallback(() => dispatch({ type: 'reset', now: Date.now() }), []);

  const value = useMemo<NotesData>(
    () => ({
      ...state,
      byId,
      create,
      update,
      setPinned,
      setStatus,
      restore,
      removeForever,
      setCollapsed,
      setEmoji,
      reorder,
      duplicate,
      setDraft,
      updateSettings,
      setAppIcon,
      setCustomIcon,
      trackTagUsage,
      renameTag,
      removeTagEverywhere,
      setPinnedTags,
      patchNotes,
      insertNote,
      reset,
    }),
    [
      state,
      byId,
      create,
      update,
      setPinned,
      setStatus,
      restore,
      removeForever,
      setCollapsed,
      setEmoji,
      reorder,
      duplicate,
      setDraft,
      updateSettings,
      setAppIcon,
      setCustomIcon,
      trackTagUsage,
      renameTag,
      removeTagEverywhere,
      setPinnedTags,
      patchNotes,
      insertNote,
      reset,
    ],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesData {
  const value = useContext(NotesContext);
  if (!value) throw new Error('useNotes 必须在 NotesProvider 内使用');
  return value;
}

/* ==================== 页签与列表规则 ==================== */

/**
 * 侧栏页签（第四次反馈）：随记、置顶与固定的标签。随记就是原来的「工作区」（内部仍叫 workspace），
 * 标签页签写成 `tag:标签`。
 */
export type SidebarTab = 'workspace' | 'pinned' | `tag:${string}`;

const TAG_TAB = 'tag:';

export const TAB_LABELS = { workspace: '随记', pinned: '置顶' } as const;

/** 页签对应的标签；随记与置顶返回空字符串。 */
export function tagOfTab(tab: SidebarTab): string {
  return tab.startsWith(TAG_TAB) ? tab.slice(TAG_TAB.length) : '';
}

export function tabOfTag(tag: string): SidebarTab {
  return `tag:${tag}`;
}

/** 页签在提示中的名称：随记、置顶或「标签」。 */
export function tabLabel(tab: SidebarTab): string {
  const tag = tagOfTab(tab);
  return tag ? `「${tag}」` : TAB_LABELS[tab as 'workspace' | 'pinned'];
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
export function tabExists(tab: SidebarTab, pinned: readonly string[]): boolean {
  const tag = tagOfTab(tab);
  return tag ? Boolean(findPinned(pinned, tag)) : tab === 'workspace' || tab === 'pinned';
}

/** 记录是否显示在这个页签里：随记是没有任何已固定标签的记录，置顶是置顶的记录，标签页签是带这个标签的记录。 */
export function belongsTo(note: Note, tab: SidebarTab, pinned: readonly string[]): boolean {
  if (note.status !== 'active') return false;
  if (tab === 'pinned') return note.pinned;
  const tag = tagOfTab(tab);
  return tag ? hasTagKey(note, tag) : !pinnedTagOf(note, pinned);
}

/** 页签内的记录，按现有应用的排序规则：置顶的在前，再按手动顺序与创建时间。 */
export function notesInTab(notes: readonly Note[], tab: SidebarTab, pinned: readonly string[]): Note[] {
  const list = notes.filter((note) => belongsTo(note, tab, pinned)).sort(compareNoteOrder);
  return tab === 'pinned' ? list : [...list.filter((note) => note.pinned), ...list.filter((note) => !note.pinned)];
}

/** 页签内经过搜索与标签筛选后的记录。 */
export function filterNotes(notes: readonly Note[], tab: SidebarTab, pinned: readonly string[], query: string, tag: string): Note[] {
  return notesInTab(notes, tab, pinned).filter((note) => matchesQuery(note, query) && (!tag || hasTagKey(note, tag)));
}

/** 页签栏的顺序：随记、置顶与固定的标签（全局搜索的结果按这个顺序分组）。 */
export function tabOrder(pinned: readonly string[]): SidebarTab[] {
  return ['workspace', 'pinned', ...pinned.map(tabOfTag)];
}

/** 页签显示的名称（不带引号）：随记、置顶或标签名。 */
export function tabName(tab: SidebarTab): string {
  return tagOfTab(tab) || TAB_LABELS[tab as 'workspace' | 'pinned'];
}

/**
 * 记录在页签栏中第一个出现的页签（第五次反馈）：没有已固定标签的在随记，否则置顶的在置顶，其余在它的第一个固定标签。
 * 全局搜索的结果按它分组，「转到」也去这里。
 */
export function homeTab(note: Note, pinned: readonly string[]): SidebarTab {
  return tabOrder(pinned).find((tab) => belongsTo(note, tab, pinned)) ?? 'workspace';
}

/* ==================== 全局搜索（第五次反馈，与交互原型相同） ==================== */

/** 实际的搜索词：去掉只有 # 还没写标签名的部分（刚输入 # 时只联想标签，列表不变）。 */
export function searchTerms(query: string): string {
  return query.replace(/(^|\s)#(?=\s|$)/gu, ' ').trim();
}

/**
 * 搜索匹配：正文、标签与附件名中的文字都要出现；写完整的已有标签（如 #产品）只匹配这个标签，没写完的按前缀匹配。
 * @param known 已有标签的 tagKey。
 */
export function matchesSearch(note: Note, terms: string, known: ReadonlySet<string>): boolean {
  if (!terms) return true;
  const parsed = parse(note.text);
  const tags: string[] = [];
  const text = terms
    .replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_match, tag: string) => {
      tags.push(tagKey(tag));
      return ' ';
    })
    .trim()
    .toLocaleLowerCase();
  const keys = parsed.tags.map(tagKey);
  if (!tags.every((tag) => keys.some((key) => (known.has(tag) ? key === tag : key.startsWith(tag))))) return false;
  const haystack = `${parsed.body} ${parsed.tags.join(' ')} ${note.images.map((image) => image.name).join(' ')}`.toLocaleLowerCase();
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export interface SearchGroup {
  tab: SidebarTab;
  notes: Note[];
}

/** 全部未删除记录中的搜索结果，按页签分组：组的顺序与页签栏相同，组内置顶在前，再按手动顺序与创建时间。 */
export function searchGroups(notes: readonly Note[], pinned: readonly string[], query: string): SearchGroup[] {
  const terms = searchTerms(query);
  if (!terms) return [];
  const known = new Set(allTags(notes).map((item) => tagKey(item.tag)));
  const groups = new Map<SidebarTab, Note[]>(tabOrder(pinned).map((tab) => [tab, []]));
  notes.forEach((note) => {
    if (note.status !== 'active' || !matchesSearch(note, terms, known)) return;
    groups.get(homeTab(note, pinned))?.push(note);
  });
  return Array.from(groups, ([tab, list]) => ({
    tab,
    notes: list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || compareNoteOrder(a, b)),
  })).filter((group) => group.notes.length);
}

/** 搜索词只是一个已有的标签（如「#产品」）时返回这个标签的写法，否则为空；这时搜索框里有「固定为页签」「合并」。 */
export function singleSearchTag(query: string, notes: readonly Note[]): string {
  const match = /^#([\p{L}\p{N}_-]+)$/u.exec(searchTerms(query));
  if (!match) return '';
  const key = tagKey(match[1]);
  return allTags(notes).find((item) => tagKey(item.tag) === key)?.tag ?? '';
}

export function tabCount(notes: readonly Note[], tab: SidebarTab, pinned: readonly string[]): number {
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
export function tabPatch(note: Note, from: SidebarTab, to: SidebarTab): Partial<Note> {
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

/* ==================== 侧栏的界面状态 ==================== */

export interface SidebarViewOptions {
  tab?: SidebarTab;
  selectedId?: string | null;
  editingId?: string | null;
  /** 初始的搜索词与标签筛选（组件页的示例状态）；有搜索词时是全局搜索。 */
  query?: string;
  searchOpen?: boolean;
  tag?: string;
  /** 初始选中的记录（组件页「多选中」的示例）。 */
  checked?: readonly string[];
}

/** 一个侧栏实例的界面状态：页签、搜索、标签筛选、选中、悬停、编辑与多选。 */
export function useSidebarView(options: SidebarViewOptions = {}) {
  const data = useNotes();
  const [tabState, setTabState] = useState<SidebarTab>(options.tab ?? 'workspace');
  const [query, setQuery] = useState(options.query ?? '');
  const [searchOpen, setSearchOpen] = useState(Boolean(options.searchOpen));
  const [tag, setTag] = useState(options.tag ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(options.selectedId ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(options.editingId ?? null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(options.checked ?? []));
  // 筛选行的多选按钮（第六次反馈）：进入多选后单击卡片就是选中或取消，还没选中任何一张时也在多选中。
  const [selectMode, setSelectMode] = useState(false);
  // 新建卡片上去掉了的页签标签（第四次反馈：在标签页签中新建时默认带上这个标签，点 × 这一条不带）。
  const [skippedTag, setSkippedTag] = useState('');
  // 「转到」一条记录：列表滚到它并闪一下（第五次反馈），处理完清空。
  const [locateId, setLocateId] = useState<string | null>(null);

  const { notes, pinnedTags } = data;
  // 当前的标签页签移出页签栏之后回到随记。
  const tab: SidebarTab = tabExists(tabState, pinnedTags) ? tabState : 'workspace';
  // 全局搜索（第五次反馈）：有搜索词时列表是全部记录中的结果，按页签分组，与当前页签和标签筛选无关。
  const searching = Boolean(searchTerms(query));
  const groups = useMemo(() => (searching ? searchGroups(notes, pinnedTags, query) : []), [searching, notes, pinnedTags, query]);
  const items = searching ? groups.flatMap((group) => group.notes) : filterNotes(notes, tab, pinnedTags, '', tag);
  /** 当前页签的全部条数（不计搜索与筛选）。 */
  const total = tabCount(notes, tab, pinnedTags);
  const countOf = useCallback((target: SidebarTab) => tabCount(notes, target, pinnedTags), [notes, pinnedTags]);
  const pageTag = tagOfTab(tab);
  const composerTag = pageTag && tagKey(pageTag) !== tagKey(skippedTag) ? pageTag : '';
  // 单击与悬停共用一个选中状态：悬停的卡片高亮，移开后回到单击选中的卡片（技术决策第 13 条）。
  const activeId = hoverId ?? selectedId;

  const setTab = useCallback((next: SidebarTab) => {
    setTabState(next);
    setChecked(new Set());
    setSelectMode(false);
    setEditingId(null);
    setSkippedTag('');
  }, []);
  /** 清除多选并退出多选（Esc、单击空白处、移动或合并之后）。单击卡片取消最后一张时仍在多选中，与交互原型相同。 */
  const clearSelection = useCallback(() => {
    setChecked(new Set());
    setSelectMode(false);
  }, []);
  const selecting = selectMode || checked.size > 0;
  /** 多选按钮：没有多选时进入多选；已在多选中时退出并清空。 */
  const toggleSelecting = useCallback(() => {
    if (selecting) clearSelection();
    else setSelectMode(true);
  }, [selecting, clearSelection]);
  /** 按标签筛选（现有应用的 selectTag）：清空搜索词，并记一次访问作为标签菜单的评分依据。 */
  const { trackTagUsage } = data;
  const selectTag = useCallback(
    (next: string) => {
      setTag(next);
      setQuery('');
      trackTagUsage(next);
    },
    [trackTagUsage],
  );
  /** 空状态的「清除筛选」：同时清除标签与搜索，并收起搜索框。 */
  const clearFilters = useCallback(() => {
    setQuery('');
    setTag('');
    setSearchOpen(false);
  }, []);
  /** 结束搜索：清空搜索词并收起搜索框，回到原来的页签（标签筛选保留）。 */
  const endSearch = useCallback(() => {
    setQuery('');
    setSearchOpen(false);
  }, []);
  /**
   * 切到一个页签（单击页签、搜索结果的「转到」）：结束搜索，清除标签筛选；给出记录时选中它，列表滚到它并闪一下。
   */
  const goToTab = useCallback(
    (next: SidebarTab, noteId?: string) => {
      setTab(next);
      setQuery('');
      setSearchOpen(false);
      setTag('');
      if (noteId) {
        setSelectedId(noteId);
        setLocateId(noteId);
      }
    },
    [setTab],
  );

  return {
    tab,
    setTab,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    tag,
    setTag,
    selectTag,
    selectedId,
    select: setSelectedId,
    hoverId,
    setHoverId,
    activeId,
    editingId,
    setEditingId,
    checked,
    setChecked,
    /** 是否在多选中：点了多选按钮，或已经选中了记录。 */
    selecting,
    toggleSelecting,
    clearSelection,
    clearFilters,
    endSearch,
    goToTab,
    locateId,
    clearLocate: () => setLocateId(null),
    searching,
    /** 搜索结果的分组（不搜索时为空）。 */
    groups,
    /** 只搜一个已有标签时的标签（筛选行里出现「固定为页签」「合并」）。 */
    searchTag: searching ? singleSearchTag(query, notes) : '',
    items,
    total,
    countOf,
    pinnedTags,
    /** 在标签页签中新建时带上的标签；去掉了或不在标签页签时为空。 */
    composerTag,
    skipComposerTag: () => setSkippedTag(pageTag),
    resetComposerTag: () => setSkippedTag(''),
    filtering: searching || Boolean(tag),
  };
}

export type SidebarView = ReturnType<typeof useSidebarView>;
