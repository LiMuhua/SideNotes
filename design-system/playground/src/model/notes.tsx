/**
 * Playground 的记录仓库。
 *
 * 复用现有应用的记录模型与规则（`src/core`）：记录、页签归属、排序、搜索、标签解析都调用同一批函数，
 * 示例数据取自 `src/debug/sample-notes.ts`。数据只在内存中，不调用桌面接口、不读写数据库。
 *
 * 数据层（记录、草稿、设置）全局共享：侧栏、速记浮窗与设置窗口看到同一份数据，
 * 与现有应用三个窗口共用一个数据库的行为一致。界面状态由各个侧栏实例自己持有，见 `useSidebarView`。
 */

import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from 'react';
import { compareNoteOrder, createNote, inTab, matchesQuery } from '@/core/notes';
import { DEFAULT_SETTINGS } from '@/core/settings';
import { canonicalize, parse, tagKey } from '@/core/tags';
import type { Note, NoteStatus, Settings, TabKey } from '@/core/types';
import { createSampleNotes } from '@/debug/sample-notes';

interface State {
  notes: Note[];
  /** 新建卡片与速记浮窗共用的草稿。 */
  draft: string;
  settings: Settings;
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
  | { type: 'reset'; now: number };

function initialState(now = Date.now()): State {
  return { notes: createSampleNotes(now), draft: '', settings: DEFAULT_SETTINGS };
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
    case 'reset':
      return { ...initialState(action.now), settings: state.settings };
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
      reset,
    }),
    [state, byId, create, update, setPinned, setStatus, restore, removeForever, setCollapsed, setEmoji, reorder, duplicate, setDraft, updateSettings, reset],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesData {
  const value = useContext(NotesContext);
  if (!value) throw new Error('useNotes 必须在 NotesProvider 内使用');
  return value;
}

/* ==================== 列表规则 ==================== */

export const TAB_LABELS: Record<TabKey, string> = { workspace: '工作区', pinned: '置顶', archive: '归档' };
export const TAB_ORDER: readonly TabKey[] = ['workspace', 'pinned', 'archive'];

/** 记录是否带有某个标签（忽略大小写与全角差异）。 */
export function hasTagKey(note: Note, tag: string): boolean {
  const key = tagKey(tag);
  return parse(note.text).tags.some((item) => tagKey(item) === key);
}

/** 页签内的记录，按现有应用的排序规则。 */
export function notesInTab(notes: readonly Note[], tab: TabKey): Note[] {
  return notes.filter((note) => inTab(note, tab)).sort(compareNoteOrder);
}

/** 页签内经过搜索与标签筛选后的记录。 */
export function filterNotes(notes: readonly Note[], tab: TabKey, query: string, tag: string): Note[] {
  return notesInTab(notes, tab).filter((note) => matchesQuery(note, query) && (!tag || hasTagKey(note, tag)));
}

export function tabCounts(notes: readonly Note[]): Record<TabKey, number> {
  return {
    workspace: notes.filter((note) => inTab(note, 'workspace')).length,
    pinned: notes.filter((note) => inTab(note, 'pinned')).length,
    archive: notes.filter((note) => inTab(note, 'archive')).length,
  };
}

/** 页签内的标签与条数，按条数从多到少。 */
export function tagsInTab(notes: readonly Note[], tab: TabKey): Array<{ tag: string; count: number }> {
  const groups = new Map<string, { tag: string; count: number }>();
  notesInTab(notes, tab).forEach((note) =>
    parse(note.text).tags.forEach((tag) => {
      const key = tagKey(tag);
      const entry = groups.get(key);
      if (entry) entry.count += 1;
      else groups.set(key, { tag, count: 1 });
    }),
  );
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

/* ==================== 侧栏的界面状态 ==================== */

export interface SidebarViewOptions {
  tab?: TabKey;
  selectedId?: string | null;
  editingId?: string | null;
  /** 初始的搜索词与标签筛选（组件页的示例状态）。 */
  query?: string;
  searchOpen?: boolean;
  tag?: string;
}

/** 一个侧栏实例的界面状态：页签、搜索、标签筛选、选中、悬停、编辑与多选。 */
export function useSidebarView(options: SidebarViewOptions = {}) {
  const data = useNotes();
  const [tab, setTabState] = useState<TabKey>(options.tab ?? 'workspace');
  const [query, setQuery] = useState(options.query ?? '');
  const [searchOpen, setSearchOpen] = useState(Boolean(options.searchOpen));
  const [tag, setTag] = useState(options.tag ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(options.selectedId ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(options.editingId ?? null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  const items = filterNotes(data.notes, tab, query, tag);
  const counts = tabCounts(data.notes);
  // 单击与悬停共用一个选中状态：悬停的卡片高亮，移开后回到单击选中的卡片（技术决策第 13 条）。
  const activeId = hoverId ?? selectedId;

  const setTab = useCallback((next: TabKey) => {
    setTabState(next);
    setChecked(new Set());
    setEditingId(null);
  }, []);
  const clearFilters = useCallback(() => {
    setQuery('');
    setTag('');
    setSearchOpen(false);
  }, []);

  return {
    tab,
    setTab,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    tag,
    setTag,
    selectedId,
    select: setSelectedId,
    hoverId,
    setHoverId,
    activeId,
    editingId,
    setEditingId,
    checked,
    setChecked,
    clearFilters,
    items,
    counts,
    filtering: Boolean(query.trim() || tag),
  };
}

export type SidebarView = ReturnType<typeof useSidebarView>;
