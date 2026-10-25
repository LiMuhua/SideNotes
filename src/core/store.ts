/**
 * 应用状态仓库。
 *
 * 延续原型的事务语义：所有写入先尝试持久化，成功后才替换权威状态并通知界面；
 * 失败时状态保持原样，由调用方保留用户输入并提示。
 *
 * 状态存放在模块级单例中，组件通过 `useSyncExternalStore` 订阅，
 * 避免大型 Context 在每次按键时触发整棵树重渲染。
 */

import * as bridge from './bridge';
import { canonicalize } from './tags';
import { createNote, ensureEmoji, MAX_IMAGES_PER_NOTE } from './notes';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import type { Draft, Note, NoteImage, NoteStatus, Settings, TabKey, TagUsage } from './types';

/** 仓库状态。 */
export interface StoreState {
  notes: Note[];
  draft: Draft;
  settings: Settings;
  tagUsage: Record<string, TagUsage>;
  /** 是否已完成首次加载。 */
  ready: boolean;
  /** 本地保存是否处于失败状态。 */
  saveFailed: boolean;
  /** 草稿是否有尚未落盘的修改。 */
  draftDirty: boolean;
  /** 正在读取的附件数量。 */
  pendingAttachments: number;
}

/** 初始状态。 */
let state: StoreState = {
  notes: [],
  draft: { text: '', images: [], updatedAt: 0 },
  settings: DEFAULT_SETTINGS,
  tagUsage: {},
  ready: false,
  saveFailed: false,
  draftDirty: false,
  pendingAttachments: 0,
};

const listeners = new Set<() => void>();

/** 订阅状态变化。 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 读取当前状态快照。 */
export function getState(): StoreState {
  return state;
}

/** 替换状态并通知订阅者。 */
function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/** 首次加载：读取快照并清理到期回收站记录。 */
export async function initialize(): Promise<void> {
  const snapshot = await bridge.loadSnapshot();
  const notes = ensureEmoji(snapshot.notes);
  setState({
    notes,
    draft: snapshot.draft,
    settings: snapshot.settings,
    tagUsage: snapshot.tagUsage,
    ready: true,
  });
  // 补齐的 Emoji 需要落盘，否则下次启动会重新随机。
  if (notes.some((note, index) => note !== snapshot.notes[index])) {
    await persist({ notes });
  }
  const removed = await bridge.purgeExpired(snapshot.settings.trashDays);
  if (removed > 0) {
    const refreshed = await bridge.loadSnapshot();
    setState({ notes: ensureEmoji(refreshed.notes) });
  }
}

/**
 * 原子持久化。
 *
 * 成功后替换权威状态；失败时保持原状并标记保存失败，返回 false。
 */
export async function persist(patch: {
  notes?: Note[];
  draft?: Draft;
  settings?: Settings;
  tagUsage?: Record<string, TagUsage>;
}): Promise<boolean> {
  const notes = ensureEmoji(patch.notes ?? state.notes);
  const draft = patch.draft ?? state.draft;
  const settings = patch.settings ?? state.settings;
  const tagUsage = patch.tagUsage ?? state.tagUsage;

  const saved = await bridge.saveSnapshot(notes, draft, settings, tagUsage);
  if (!saved) {
    setState({ saveFailed: true });
    return false;
  }
  setState({ notes, draft, settings, tagUsage, saveFailed: false, draftDirty: false });
  return true;
}

/** 修改一条记录。 */
export async function updateNote(id: string, patch: Partial<Note>): Promise<boolean> {
  const notes = state.notes.map((note) =>
    note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note,
  );
  return persist({ notes });
}

/** 批量修改记录，返回变更前的字段用于撤销。 */
export interface BatchUndo {
  /** 变更前的部分字段。 */
  previous: Map<string, Partial<Note>>;
}

/** 把一批记录移动到目标位置。 */
export async function moveNotes(
  ids: Iterable<string>,
  destination: TabKey | 'trash',
): Promise<BatchUndo | null> {
  const targets = new Set(ids);
  if (!targets.size) return null;
  const previous = new Map<string, Partial<Note>>();
  const changedAt = Date.now();

  const notes = state.notes.map((note) => {
    if (!targets.has(note.id) || note.status === 'trash') return note;
    previous.set(note.id, {
      status: note.status,
      pinned: note.pinned,
      deletedAt: note.deletedAt,
      previousStatus: note.previousStatus,
      order: note.order,
    });
    if (destination === 'trash') {
      return {
        ...note,
        status: 'trash' as NoteStatus,
        previousStatus: note.status === 'archived' ? ('archived' as const) : ('active' as const),
        deletedAt: changedAt,
        updatedAt: changedAt,
      };
    }
    return {
      ...note,
      status: destination === 'archive' ? ('archived' as NoteStatus) : ('active' as NoteStatus),
      pinned: destination === 'archive' ? note.pinned : destination === 'pinned',
      order: null,
      updatedAt: changedAt,
    };
  });

  const saved = await persist({ notes });
  return saved ? { previous } : null;
}

/** 按撤销信息还原批量修改。 */
export async function restoreNotes(undo: BatchUndo): Promise<boolean> {
  const notes = state.notes.map((note) => {
    const previous = undo.previous.get(note.id);
    return previous ? { ...note, ...previous, updatedAt: Date.now() } : note;
  });
  return persist({ notes });
}

/**
 * 把一批记录插入目标记录之前或之后并保存顺序。
 *
 * 跨组落位时继承目标记录的分组与置顶状态，与原型一致。
 */
export async function reorderNotes(
  ids: Set<string>,
  targetId: string,
  after: boolean,
): Promise<BatchUndo | null> {
  const target = state.notes.find((note) => note.id === targetId);
  if (!target || ids.has(targetId)) return null;

  const moving = state.notes
    .filter((note) => ids.has(note.id) && note.status !== 'trash')
    .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));
  if (!moving.length) return null;

  const group = state.notes.filter(
    (note) => note.status === target.status && note.pinned === target.pinned && !ids.has(note.id),
  );
  const index = group.findIndex((note) => note.id === targetId);
  if (index < 0) return null;
  group.splice(index + (after ? 1 : 0), 0, ...moving);

  const ranks = new Map(group.map((note, position) => [note.id, position]));
  const previous = new Map<string, Partial<Note>>();
  state.notes.forEach((note) => {
    if (ranks.has(note.id)) {
      previous.set(note.id, { order: note.order, status: note.status, pinned: note.pinned });
    }
  });

  const notes = state.notes.map((note) =>
    ranks.has(note.id)
      ? {
          ...note,
          order: ranks.get(note.id) ?? null,
          status: ids.has(note.id) ? target.status : note.status,
          pinned: ids.has(note.id) ? target.pinned : note.pinned,
        }
      : note,
  );

  const saved = await persist({ notes });
  return saved ? { previous } : null;
}

/** 更新共享草稿，不立即落盘。 */
export function changeDraft(text: string): void {
  setState({
    draft: { ...state.draft, text, updatedAt: Date.now() },
    draftDirty: true,
  });
}

/** 把图片加入草稿。 */
export function addDraftImages(images: NoteImage[]): void {
  const available = Math.max(0, MAX_IMAGES_PER_NOTE - state.draft.images.length);
  setState({
    draft: {
      ...state.draft,
      images: state.draft.images.concat(images.slice(0, available)),
      updatedAt: Date.now(),
    },
    draftDirty: true,
  });
}

/** 移除草稿中的图片。 */
export function removeDraftImage(id: string): void {
  setState({
    draft: {
      ...state.draft,
      images: state.draft.images.filter((image) => image.id !== id),
      updatedAt: Date.now(),
    },
    draftDirty: true,
  });
}

/** 落盘当前草稿。 */
export function persistDraft(): Promise<boolean> {
  return persist({});
}

/** 调整正在读取的附件计数。 */
export function setPendingAttachments(delta: number): void {
  setState({ pendingAttachments: Math.max(0, state.pendingAttachments + delta) });
}

/** 保存草稿为新记录，返回新记录；失败返回 null。 */
export async function saveDraftAsNote(tab: TabKey): Promise<Note | null> {
  if (!state.draft.text.trim() && !state.draft.images.length) return null;
  const note = createNote(state.draft.text, state.draft.images, {
    pinned: tab === 'pinned',
    status: tab === 'archive' ? 'archived' : 'active',
    existing: state.notes,
  });
  const saved = await persist({
    notes: [note, ...state.notes],
    draft: { text: '', images: [], updatedAt: Date.now() },
  });
  return saved ? note : null;
}

/** 提交一条记录的编辑结果。 */
export async function commitEdit(id: string, text: string, images: NoteImage[]): Promise<boolean> {
  const notes = state.notes.map((note) =>
    note.id === id ? { ...note, text: canonicalize(text), images, updatedAt: Date.now() } : note,
  );
  return persist({ notes });
}

/** 创建记录副本，归属当前页签。 */
export async function duplicateNote(note: Note, tab: TabKey): Promise<boolean> {
  const duplicate = createNote(note.text, note.images, {
    pinned: tab === 'pinned',
    status: tab === 'archive' ? 'archived' : 'active',
    existing: state.notes,
  });
  return persist({ notes: [duplicate, ...state.notes] });
}

/** 记录标签访问并保存，用于标签菜单评分。 */
export async function trackTagUsage(_tag: string, key: string): Promise<void> {
  const current = state.tagUsage[key] ?? { count: 0, last: 0 };
  const tagUsage = {
    ...state.tagUsage,
    [key]: { count: Math.min(10_000, current.count + 1), last: Date.now() },
  };
  await persist({ tagUsage });
}

/** 保存设置变更。 */
export async function updateSettings(patch: Partial<Settings>): Promise<boolean> {
  const settings = normalizeSettings({ ...state.settings, ...patch });
  return persist({ settings });
}

/** 永久删除回收站中的记录。 */
export async function deleteForever(ids: Iterable<string>): Promise<boolean> {
  const targets = new Set(ids);
  const notes = state.notes.filter((note) => note.status !== 'trash' || !targets.has(note.id));
  return persist({ notes });
}

/** 从回收站恢复记录到删除前的位置。 */
export async function restoreFromTrash(ids: Iterable<string>): Promise<boolean> {
  const targets = new Set(ids);
  const notes = state.notes.map((note) =>
    note.status === 'trash' && targets.has(note.id)
      ? { ...note, status: note.previousStatus, deletedAt: null, updatedAt: Date.now() }
      : note,
  );
  return persist({ notes });
}

/** 合并导入的记录：标识相同的仅在备份更新时替换。 */
export async function mergeImported(imported: Note[], importedDraft: Draft | null): Promise<boolean> {
  const merged = new Map(state.notes.map((note) => [note.id, note]));
  imported.forEach((note) => {
    const current = merged.get(note.id);
    if (!current || note.updatedAt > current.updatedAt) merged.set(note.id, note);
  });
  const draft =
    !state.draft.text.trim() && !state.draft.images.length && importedDraft ? importedDraft : state.draft;
  return persist({ notes: Array.from(merged.values()), draft });
}

/** 仅用于测试：重置模块级状态。 */
export function resetForTest(next?: Partial<StoreState>): void {
  state = {
    notes: [],
    draft: { text: '', images: [], updatedAt: 0 },
    settings: DEFAULT_SETTINGS,
    tagUsage: {},
    ready: false,
    saveFailed: false,
    draftDirty: false,
    pendingAttachments: 0,
    ...next,
  };
  listeners.forEach((listener) => listener());
}
