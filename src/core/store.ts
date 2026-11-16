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
import type { StoreChange } from './bridge';
import { canonicalize, compose, hasTag, parse, removeTag, tagKey, withTag } from './tags';
import { compareNoteOrder, createId, createNote, ensureEmoji, MAX_IMAGES_PER_NOTE, suggestTags } from './notes';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import { createSampleNotes, shouldLoadSampleData } from '../debug/sample-notes';
import type { Draft, Note, NoteImage, NoteStatus, Settings, Snapshot, TabKey, TagUsage } from './types';

/** 仓库状态。 */
export interface StoreState {
  notes: Note[];
  draft: Draft;
  settings: Settings;
  tagUsage: Record<string, TagUsage>;
  /** 是否已完成首次加载。 */
  ready: boolean;
  /**
   * 首次读库是否失败。此时内存中没有真实数据，暂停一切写入，
   * 直到重新读库成功，避免用空列表或默认设置覆盖数据库。
   */
  loadFailed: boolean;
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
  loadFailed: false,
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
/**
 * 编辑器输入标签时的联想候选：读取当前全部记录与访问统计，
 * 排除 `text`（本条记录除正在输入的标签之外的原文）中已有的标签。
 */
export function tagSuggestions(prefix: string, text: string): string[] {
  return suggestTags(state.notes, state.tagUsage, prefix, parse(text).tags);
}

export function getState(): StoreState {
  return state;
}

/** 替换状态并通知订阅者。 */
function setState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/* ==================== 跨窗口同步 ==================== */

/** 本 WebView 的实例标识，用来忽略自己广播出去的变化。 */
const INSTANCE_ID = createId();
/** 本窗口完成写入的次数；重新读库期间若有新写入，读到的结果即已过时。 */
let localWrites = 0;
/** 最近一次成功落盘的设置，写入失败时据此回滚界面。 */
let persistedSettings: Settings = DEFAULT_SETTINGS;
/** 获得焦点时的读库节流，避免频繁切换窗口时重复读取。 */
const FOCUS_RELOAD_INTERVAL = 800;
let lastReloadAt = 0;

/** 记录一次本窗口写入并通知其它窗口。 */
function announce(change: Omit<StoreChange, 'source'>): void {
  localWrites += 1;
  void bridge.emitStoreChange({ source: INSTANCE_ID, ...change });
}

/**
 * 从数据库重新读取，替换本窗口的内存状态。
 *
 * 尚未落盘的草稿与设置以本窗口为准；读取期间本窗口若又写入过，
 * 结果会缺少这次写入，直接丢弃，避免把新数据回退成旧快照。
 * 首次读库失败的窗口在这里读到数据后恢复写入。返回内存状态是否已与数据库一致。
 */
export async function reloadFromDisk(): Promise<boolean> {
  if (!state.ready) return false;
  const writes = localWrites;
  let snapshot: Snapshot;
  try {
    snapshot = await bridge.loadSnapshot();
  } catch (error) {
    console.error('重新读取本地数据失败', error);
    return false;
  }
  if (writes !== localWrites) return false;
  lastReloadAt = Date.now();
  persistedSettings = snapshot.settings;
  setState({
    notes: ensureEmoji(snapshot.notes),
    tagUsage: snapshot.tagUsage,
    settings: pendingSettings ?? snapshot.settings,
    draft: state.draftDirty ? state.draft : snapshot.draft,
    loadFailed: false,
  });
  return true;
}

/**
 * 接入跨窗口同步，返回取消函数。
 *
 * 设置变化直接携带新值，避免拖动滑块时每帧都整库读取；
 * 记录变化则重新读库。窗口获得焦点时再读一次，兜底错过的通知。
 */
export function connectSync(): () => void {
  // 浏览器预览只有一个窗口且没有数据库，读库只会得到空快照，反而清空界面数据。
  if (!bridge.isDesktop()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void bridge
    .onStoreChange((change) => {
      if (change.source === INSTANCE_ID) return;
      if (change.kind === 'settings' && change.settings) {
        persistedSettings = normalizeSettings(change.settings);
        if (!pendingSettings) setState({ settings: persistedSettings });
        return;
      }
      void reloadFromDisk();
    })
    .then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
  const handleFocus = (): void => {
    if (Date.now() - lastReloadAt < FOCUS_RELOAD_INTERVAL) return;
    void reloadFromDisk();
  };
  window.addEventListener('focus', handleFocus);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener('focus', handleFocus);
  };
}

/** 首次读库失败后的重试间隔（毫秒）：数据库暂时不可用时，稍后通常即可读到。 */
const LOAD_RETRY_DELAYS = [200, 500, 1000];

/** 读取快照，失败时按间隔重试；全部失败才抛出最后一次的错误。 */
async function loadSnapshotWithRetry(): Promise<Snapshot> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await bridge.loadSnapshot();
    } catch (error) {
      if (attempt >= LOAD_RETRY_DELAYS.length) throw error;
      console.warn('读取本地数据失败，稍后重试', error);
      await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAYS[attempt]));
    }
  }
}

/** 首次加载：读取快照并清理到期回收站记录。 */
export async function initialize(): Promise<void> {
  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshotWithRetry();
  } catch (error) {
    // 读取失败也必须结束加载态：否则界面停在加载页，托盘退出等入口全部不可用。
    // 此时内存中没有真实数据，标记读库失败以暂停写入；窗口获得焦点、
    // 收到其它窗口的通知或在设置中重试时会重新读库。
    console.error('读取本地数据失败', error);
    setState({ ready: true, loadFailed: true });
    return;
  }

  const notes = ensureEmoji(snapshot.notes);
  persistedSettings = snapshot.settings;
  lastReloadAt = Date.now();
  setState({
    notes,
    draft: snapshot.draft,
    settings: snapshot.settings,
    tagUsage: snapshot.tagUsage,
    ready: true,
  });

  // 以下均为可选的维护动作，失败不应阻塞界面使用。
  try {
    // 调试开关打开且库为空时，载入示例数据便于检查界面表现。
    if (notes.length === 0 && shouldLoadSampleData()) {
      await persist({ notes: createSampleNotes() });
      return;
    }
    // 补齐的 Emoji 需要落盘，否则下次启动会重新随机。
    if (notes.some((note, index) => note !== snapshot.notes[index])) {
      await persist({ notes });
    }
    const removed = await bridge.purgeExpired(snapshot.settings.trashDays);
    if (removed > 0) {
      const refreshed = await bridge.loadSnapshot();
      setState({ notes: ensureEmoji(refreshed.notes) });
      announce({ kind: 'data' });
    }
  } catch (error) {
    console.error('启动维护任务失败', error);
  }
}

/**
 * 是否允许写库。
 *
 * 后端保存记录时整体替换，首次读库成功之前内存状态不完整，
 * 此时写入会用空列表或默认设置覆盖数据库，必须拒绝。
 */
function canWrite(): boolean {
  return state.ready && !state.loadFailed;
}

/**
 * 原子持久化。
 *
 * 成功后替换权威状态；失败时保持原状并标记保存失败，返回 false。
 * 尚未读到数据库内容时直接返回 false，不发起写入。
 */
export async function persist(patch: {
  notes?: Note[];
  draft?: Draft;
  settings?: Settings;
  tagUsage?: Record<string, TagUsage>;
}): Promise<boolean> {
  if (!canWrite()) {
    console.warn('尚未读到本地数据，已跳过写入');
    return false;
  }
  const notes = ensureEmoji(patch.notes ?? state.notes);
  const draft = patch.draft ?? state.draft;
  const settings = patch.settings ?? state.settings;
  const tagUsage = patch.tagUsage ?? state.tagUsage;

  const saved = await bridge.saveSnapshot(notes, draft, settings, tagUsage);
  if (!saved) {
    setState({ saveFailed: true });
    return false;
  }
  persistedSettings = settings;
  setState({ notes, draft, settings, tagUsage, saveFailed: false, draftDirty: false });
  announce({ kind: 'data' });
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
  /** 这次新建的记录（如合并成的新卡片），撤销时删除。 */
  created?: string[];
}

/**
 * 把一批记录移入回收站，返回撤销所需的原值；写入失败返回 null。
 * 记下移入前的位置（去掉归档之后只有 active），恢复时回到原来的页签。
 */
export async function moveNotes(ids: Iterable<string>, destination: 'trash'): Promise<BatchUndo | null> {
  const targets = new Set(ids);
  if (!targets.size || destination !== 'trash') return null;
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
    return { ...note, status: 'trash' as NoteStatus, previousStatus: 'active' as const, deletedAt: changedAt, updatedAt: changedAt };
  });
  if (!previous.size) return null;
  const saved = await persist({ notes });
  return saved ? { previous } : null;
}

/**
 * 一次修改多条记录的若干字段（如把卡片移到另一个页签：加减标签、置顶），返回撤销所需的原值；写入失败返回 null。
 * 原值包括修改时间，撤销后修改时间也回到原来的。
 */
export async function patchNotes(changes: ReadonlyArray<readonly [string, Partial<Note>]>): Promise<BatchUndo | null> {
  const byId = new Map(changes);
  if (!byId.size) return null;
  const previous = new Map<string, Partial<Note>>();
  const changedAt = Date.now();
  const notes = state.notes.map((note) => {
    const patch = byId.get(note.id);
    if (!patch) return note;
    const before: Partial<Note> = { updatedAt: note.updatedAt };
    for (const key of Object.keys(patch) as Array<keyof Note>) (before as Record<string, unknown>)[key] = note[key];
    previous.set(note.id, before);
    return { ...note, ...patch, ...(patch.text !== undefined ? { text: canonicalize(patch.text) } : {}), updatedAt: changedAt };
  });
  if (!previous.size) return null;
  return (await persist({ notes })) ? { previous } : null;
}

/**
 * 一次修改多条记录的正文或附件（如把图片从一张卡片移到另一张），返回撤销所需的原值；
 * 写入失败返回 null，记录保持原样。
 */
export async function updateNotes(
  changes: ReadonlyArray<{ id: string; text?: string; images?: NoteImage[] }>,
): Promise<BatchUndo | null> {
  const byId = new Map(changes.map((change) => [change.id, change]));
  if (!byId.size) return null;
  const previous = new Map<string, Partial<Note>>();
  const changedAt = Date.now();
  const notes = state.notes.map((note) => {
    const change = byId.get(note.id);
    if (!change) return note;
    previous.set(note.id, { text: note.text, images: note.images });
    return {
      ...note,
      ...(change.text !== undefined ? { text: canonicalize(change.text) } : {}),
      ...(change.images ? { images: change.images } : {}),
      updatedAt: changedAt,
    };
  });
  return (await persist({ notes })) ? { previous } : null;
}

/** 按撤销信息还原批量修改；原值中带有修改时间时一并还原，否则记为现在修改。 */
export async function restoreNotes(undo: BatchUndo): Promise<boolean> {
  const created = new Set(undo.created ?? []);
  const notes = state.notes
    .filter((note) => !created.has(note.id))
    .map((note) => {
      const previous = undo.previous.get(note.id);
      return previous ? { ...note, updatedAt: Date.now(), ...previous } : note;
    });
  return persist({ notes });
}

/**
 * 合并成一条（与交互原型 merge.js 的 commit 相同）：新卡片放在原来第一条的位置、置顶跟随第一条
 * （合并到已有的卡片时改写那一张），原记录移到回收站（keep 时不动）。
 * 返回合并成的记录与撤销所需的原值，撤销时删除新卡片、还原其余记录；写入失败返回 null，记录保持原样。
 * @param sources 来源记录，按列表中的顺序；不含 target。
 */
export async function mergeNotes(options: {
  sources: readonly Note[];
  target: Note | null;
  text: string;
  images: NoteImage[];
  keep: boolean;
}): Promise<{ id: string; undo: BatchUndo } | null> {
  const { sources, target, text, images, keep } = options;
  if (!sources.length) return null;
  const now = Date.now();
  const ids = new Set(sources.map((note) => note.id));
  const previous = new Map<string, Partial<Note>>();
  let notes = state.notes.map((note) => {
    if (target && note.id === target.id) {
      previous.set(note.id, { text: note.text, images: note.images, updatedAt: note.updatedAt });
      return { ...note, text: canonicalize(text), images: images.map((image) => ({ ...image })), updatedAt: now };
    }
    if (!keep && ids.has(note.id) && note.status !== 'trash') {
      previous.set(note.id, {
        status: note.status,
        previousStatus: note.previousStatus,
        deletedAt: note.deletedAt,
        updatedAt: note.updatedAt,
      });
      return { ...note, status: 'trash' as NoteStatus, previousStatus: 'active' as const, deletedAt: now, updatedAt: now };
    }
    return note;
  });
  const created: string[] = [];
  let id = target?.id ?? '';
  if (!target) {
    const first = sources[0];
    const merged = createNote(text, images, { pinned: first.pinned, existing: state.notes });
    // 排在原来第一条的位置：用它的排序值（没有手动排过序时按创建时间排，换算成同样的值）。
    merged.order = first.order ?? -first.createdAt;
    id = merged.id;
    created.push(merged.id);
    notes = [merged, ...notes];
  }
  if (!(await persist({ notes }))) return null;
  return { id, undo: { previous, created } };
}

/**
 * 收起或展开一批记录的正文，返回撤销所需的原值；写入失败返回 null。
 * 折叠只是显示状态，不改动修改时间。
 */
export async function setCollapsed(ids: Iterable<string>, collapsed: boolean): Promise<BatchUndo | null> {
  const targets = new Set(ids);
  const previous = new Map<string, Partial<Note>>();
  const notes = state.notes.map((note) => {
    if (!targets.has(note.id) || note.collapsed === collapsed) return note;
    previous.set(note.id, { collapsed: note.collapsed, updatedAt: note.updatedAt });
    return { ...note, collapsed };
  });
  if (!previous.size) return { previous };
  return (await persist({ notes })) ? { previous } : null;
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
  /** 拖动时停在别的页签上切换了列表：放进这个页签的卡片同时按页签的规则加减标签（core/tabs 的 tabPatch）。 */
  change?: (note: Note) => Partial<Note>,
): Promise<BatchUndo | null> {
  const target = state.notes.find((note) => note.id === targetId);
  if (!target || ids.has(targetId)) return null;

  // 与原型 reorder 一致：按显示顺序计算落点，否则数组中的存储顺序与列表顺序不同时会放错位置。
  const moving = state.notes
    .filter((note) => ids.has(note.id) && note.status !== 'trash')
    .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) || compareNoteOrder(a, b));
  if (!moving.length) return null;

  const group = state.notes
    .filter((note) => note.status === target.status && note.pinned === target.pinned && !ids.has(note.id))
    .sort(compareNoteOrder);
  const index = group.findIndex((note) => note.id === targetId);
  if (index < 0) return null;
  group.splice(index + (after ? 1 : 0), 0, ...moving);

  const ranks = new Map(group.map((note, position) => [note.id, position]));
  const previous = new Map<string, Partial<Note>>();
  state.notes.forEach((note) => {
    if (ranks.has(note.id)) {
      previous.set(note.id, { order: note.order, status: note.status, pinned: note.pinned, text: note.text });
    }
  });

  const notes = state.notes.map((note) =>
    ranks.has(note.id)
      ? {
          ...note,
          ...(change && ids.has(note.id) ? change(note) : {}),
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

/** 更换草稿中的一张图片（附件弹窗的「更换」），位置不变。 */
export function replaceDraftImage(id: string, next: NoteImage): void {
  setState({
    draft: {
      ...state.draft,
      images: state.draft.images.map((image) => (image.id === id ? next : image)),
      updatedAt: Date.now(),
    },
    draftDirty: true,
  });
}

/** 落盘当前草稿。 */
export function persistDraft(): Promise<boolean> {
  return persist({});
}

/**
 * 重试本地存储，对应设置页的「重试本地保存」。
 *
 * 首次读库失败时先重新读库，读到数据后才写入，否则会用空状态覆盖数据库。
 */
export async function retryStorage(): Promise<boolean> {
  if (state.loadFailed && !(await reloadFromDisk())) return false;
  return persist({});
}

/**
 * 更换数据存储位置之后重新读库，并通知其它窗口也重新读取：
 * 记录中的附件路径已在新数据库中改写，各窗口内存里还是旧路径，不能再拿去整体写入。
 */
export async function reloadEverywhere(): Promise<boolean> {
  const reloaded = await reloadFromDisk();
  announce({ kind: 'data' });
  return reloaded;
}

/**
 * 风险操作（导入备份、永久删除、更换存储位置）之前创建一份快照。失败时返回原因，由调用方提示，
 * 不阻止这次操作：用户已经确认过，快照只是多一层保护。浏览器预览没有快照，直接返回。
 */
export async function snapshotBefore(reason: 'import' | 'delete' | 'migrate'): Promise<string | null> {
  if (!bridge.isDesktop()) return null;
  try {
    await bridge.createSnapshot(state.settings.snapshotDirectory, reason);
    return null;
  } catch (error) {
    return bridge.errorText(error, '快照目录不可用');
  }
}

/** 调整正在读取的附件计数。 */
export function setPendingAttachments(delta: number): void {
  setState({ pendingAttachments: Math.max(0, state.pendingAttachments + delta) });
}

/**
 * 保存草稿为新记录，返回新记录；失败返回 null。
 * 在置顶页签中新建的置顶；在标签页签中新建的带上这个标签（新建卡片上的「#标签」，去掉时不带）。
 */
export async function saveDraftAsNote(options: { pinned?: boolean; tag?: string } = {}): Promise<Note | null> {
  if (!state.draft.text.trim() && !state.draft.images.length) return null;
  const text = options.tag ? withTag(state.draft.text, options.tag) : state.draft.text;
  const note = createNote(text, state.draft.images, {
    pinned: Boolean(options.pinned),
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

/** 创建记录副本，与原记录在同一个页签：正文与标签相同，在置顶页签中复制的仍置顶。 */
export async function duplicateNote(note: Note, tab: TabKey): Promise<boolean> {
  const duplicate = createNote(note.text, note.images, {
    pinned: tab === 'pinned',
    existing: state.notes,
  });
  return persist({ notes: [duplicate, ...state.notes] });
}

/** 记录一次标签筛选并保存，作为标签菜单「访问频率」与「近期访问」的评分依据。 */
export async function trackTagUsage(tag: string): Promise<boolean> {
  const key = tagKey(tag);
  const current = state.tagUsage[key] ?? { count: 0, last: 0 };
  const tagUsage = {
    ...state.tagUsage,
    [key]: { count: Math.min(10_000, current.count + 1), last: Date.now() },
  };
  return persist({ tagUsage });
}

/**
 * 在所有记录中重命名标签；新名称已存在时两者合并。固定为页签的标签一起改名。
 *
 * 与原型 manageTag 一致：只改标签，不动正文；访问统计随之迁移到新名称。
 */
export async function renameTag(tag: string, next: string): Promise<boolean> {
  const oldKey = tagKey(tag);
  const newKey = tagKey(next);
  const changedAt = Date.now();
  const notes = state.notes.map((note) => {
    if (!hasTag(note.text, tag)) return note;
    const parsed = parse(note.text);
    const tags = parsed.tags.map((item) => (tagKey(item) === oldKey ? next : item));
    return { ...note, text: compose(parsed.body, tags), updatedAt: changedAt };
  });
  const tagUsage = { ...state.tagUsage };
  if (tagUsage[oldKey]) {
    tagUsage[newKey] = tagUsage[oldKey];
    if (newKey !== oldKey) delete tagUsage[oldKey];
  }
  // 固定为页签的标签跟着改名，位置不变；新名称已经固定时两个页签合并成一个。
  const pinned = state.settings.pinnedTags;
  const settings = pinned.some((item) => tagKey(item) === oldKey)
    ? {
        ...state.settings,
        pinnedTags: pinned.some((item) => tagKey(item) === newKey && newKey !== oldKey)
          ? pinned.filter((item) => tagKey(item) !== oldKey)
          : pinned.map((item) => (tagKey(item) === oldKey ? next : item)),
      }
    : undefined;
  return persist({ notes, tagUsage, ...(settings ? { settings } : {}) });
}

/**
 * 从所有记录中移除标签，正文与附件保留。
 *
 * 只剩这个标签的空记录改用标签名作为正文，避免产生没有内容的记录。
 */
export async function removeTagEverywhere(tag: string): Promise<boolean> {
  const changedAt = Date.now();
  const notes = state.notes.map((note) => {
    if (!hasTag(note.text, tag)) return note;
    let text = removeTag(note.text, tag);
    if (!text.trim() && !note.images.length) text = tag;
    return { ...note, text, updatedAt: changedAt };
  });
  return persist({ notes });
}

/* ==================== 设置 ==================== */

/** 设置写入的合并间隔：拖动滑块时只落盘最后一个值。 */
const SETTINGS_FLUSH_DELAY = 120;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
/** 已应用到界面、尚未落盘的设置。 */
let pendingSettings: Settings | null = null;
let settingsWaiters: Array<(saved: boolean) => void> = [];

/**
 * 保存设置变更。
 *
 * 界面立即应用新值，写入在短暂合并后经 `save_settings` 单独完成，
 * 不再整体重写记录，避免设置窗口持有的旧记录覆盖其它窗口的新内容。
 * 写入失败时回滚到最后一次成功落盘的设置，返回 false。
 * 尚未读到数据库内容时不应用也不写入，直接返回 false，避免把默认设置写回数据库。
 */
export function updateSettings(patch: Partial<Settings>): Promise<boolean> {
  if (!canWrite()) return Promise.resolve(false);
  const settings = normalizeSettings({ ...state.settings, ...patch });
  pendingSettings = settings;
  setState({ settings });
  return new Promise((resolve) => {
    settingsWaiters.push(resolve);
    if (!settingsTimer) settingsTimer = setTimeout(() => void flushSettings(), SETTINGS_FLUSH_DELAY);
  });
}

/** 把合并后的设置写入数据库并通知其它窗口。 */
async function flushSettings(): Promise<void> {
  settingsTimer = null;
  const settings = pendingSettings;
  const waiters = settingsWaiters;
  pendingSettings = null;
  settingsWaiters = [];
  if (!settings) return;
  const saved = await bridge.saveSettings(settings);
  if (saved) {
    persistedSettings = settings;
    if (state.saveFailed) setState({ saveFailed: false });
    announce({ kind: 'settings', settings });
  } else if (!pendingSettings) {
    setState({ settings: persistedSettings, saveFailed: true });
  }
  waiters.forEach((resolve) => resolve(saved));
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
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = null;
  pendingSettings = null;
  settingsWaiters = [];
  localWrites = 0;
  lastReloadAt = 0;
  state = {
    notes: [],
    draft: { text: '', images: [], updatedAt: 0 },
    settings: DEFAULT_SETTINGS,
    tagUsage: {},
    ready: false,
    loadFailed: false,
    saveFailed: false,
    draftDirty: false,
    pendingAttachments: 0,
    ...next,
  };
  persistedSettings = state.settings;
  listeners.forEach((listener) => listener());
}
