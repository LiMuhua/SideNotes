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
import { createId, createNote, ensureEmoji, MAX_IMAGES_PER_NOTE } from './notes';
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
  let notes = ensureEmoji(snapshot.notes);
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
  // 首次启动没有任何记录时，注入演示数据，便于直观感受界面效果。
  if (notes.length === 0) {
    notes = seedTestData();
    await persist({ notes });
  }
  const removed = await bridge.purgeExpired(snapshot.settings.trashDays);
  if (removed > 0) {
    const refreshed = await bridge.loadSnapshot();
    setState({ notes: ensureEmoji(refreshed.notes) });
  }
}

/** 生成约 25 条演示记录，覆盖工作区、置顶、归档与回收站。 */
function seedTestData(): Note[] {
  const now = Date.now();
  const day = 86_400_000;
  const samples: Array<Partial<Note> & { text: string }> = [
    { text: '欢迎使用 SideNotes\n\n这是一个本地优先的速记工具，支持 Markdown 与 #标签。\n\n- 鼠标移到屏幕边缘呼出侧栏\n- Ctrl+Shift+Space 呼出速记浮窗\n- Ctrl+F 在侧栏内搜索', emoji: '👋', pinned: true, updatedAt: now - 2 * 3600_000 },
    { text: '今日待办\n\n- [x] 整理周会纪要\n- [x] 回复客户邮件\n- [ ] 写 SideNotes 发布说明\n- [ ] 复核账单', emoji: '✅', pinned: true, updatedAt: now - 5 * 3600_000 },
    { text: '周会纪要 #工作\n\n1. 需求评审聚焦在桌面端稳定性\n2. 本周完成设置弹窗重构\n3. 下周开始移动端调研 #会议', emoji: '📋', updatedAt: now - 1 * day },
    { text: '读《纳瓦尔宝典》摘录 #阅读\n\n复利不只是金钱，习惯和关系同样复利积累。把每一天当作一个新的开始，但记住所有决策的复利。', emoji: '📚', updatedAt: now - 2 * day },
    { text: '咖啡豆采购清单 #生活\n\n- 埃塞俄比亚耶加雪菲\n- 哥伦比亚水洗\n- 巴西半日晒\n\n下次去店里试新的处理法', emoji: '☕', updatedAt: now - 3 * day },
    { text: 'SideNotes 路线图 #工作\n\n- v0.6 桌面端稳定版\n- v0.7 数据导入导出\n- v0.8 标签管理面板\n- v1.0 跨设备同步（可选）', emoji: '🗺️', updatedAt: now - 4 * day },
    { text: '健身计划 #健康\n\n每周三次力量 + 两次有氧。\n今天：深蹲 5×5、卧推 5×5、划船 3×8。', emoji: '💪', updatedAt: now - 5 * day },
    { text: '客户端反馈汇总 #工作\n\n- 多数希望侧栏能更窄\n- 希望快捷键可自定义\n- 希望支持代码块高亮 #反馈', emoji: '💬', updatedAt: now - 6 * day },
    { text: '菜谱：番茄牛尾汤 #生活\n\n牛尾焯水，番茄去皮切块，慢炖两小时，最后加盐与迷迭香。', emoji: '🍲', updatedAt: now - 7 * day },
    { text: '电影笔记：《在云端》#影视\n\n关于轻装上阵与人际连结的电影。瑞安的「背包理论」在疫情后读起来格外有味道。', emoji: '🎬', updatedAt: now - 8 * day },
    { text: '看房记录 #生活\n\n- 朝阳两居室，采光好但临街\n- 海淀三居，学区配套完善\n- 顺义别墅，通勤距离偏长', emoji: '🏠', updatedAt: now - 9 * day, collapsed: true },
    { text: 'SideNotes 技术栈 #工作\n\nTauri 2 + React 19 + Vite + TypeScript + rusqlite。\n核心模块都已迁移，桌面端调优进行中。', emoji: '🛠️', updatedAt: now - 10 * day },
    { text: '番茄工作法复盘 #效率\n\n连续四周 25+5 节奏，专注时段明显增加。\n下一步尝试 50+10 长节律，观察能否进一步降噪。', emoji: '⏱️', updatedAt: now - 11 * day },
    { text: '旅行备忘 #旅行\n\n京都行：清水寺、伏见稻荷、岚山竹林。\n预算控制在 8000/人，避开樱花季高峰。', emoji: '✈️', updatedAt: now - 12 * day },
    { text: '生日礼物清单 #生活\n\n- 妈妈：羊绒围巾\n- 朋友：黑胶唱片\n- 同事：手冲咖啡套装', emoji: '🎁', updatedAt: now - 13 * day, collapsed: true },
    { text: '每周复盘模板 #效率\n\n1. 本周完成\n2. 卡住的地方\n3. 下周最重要的三件事\n4. 一个需要放弃的项', emoji: '📝', updatedAt: now - 14 * day },
    { text: '投资笔记 #理财\n\n宽基定投 + 少量主动基金。\n核心：不在情绪高点决策，按月固定金额执行。', emoji: '📈', updatedAt: now - 15 * day },
    { text: '播客收听清单 #阅读\n\n- 《晚点对话》近三期\n- 《不合时宜》关于数字游民\n- 《三五环》产品访谈', emoji: '🎧', updatedAt: now - 16 * day },
    { text: '家庭账单 #理财\n\n本月：水电 320、网费 120、物业 280。\n年度续费：域名 200、云存储 480。', emoji: '🧾', updatedAt: now - 17 * day, collapsed: true },
    { text: '代码片段：防抖函数 #编程\n\n```ts\nfunction debounce<T extends (...a: any[]) => void>(fn: T, ms = 200) {\n  let t = 0;\n  return (...a: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };\n}\n```', emoji: '💻', updatedAt: now - 18 * day },
    { text: '冥想记录 #健康\n\n连续 21 天，每天 10 分钟。\n观察：上午冥想比下午更稳定，呼吸节奏更容易控制。', emoji: '🧘', updatedAt: now - 19 * day },
    { text: '已归档的旧需求 #工作\n\n这批需求已经完成或下线，保留备查。\n- v0.5 的边缘触发阈值调整\n- 早期草稿自动保存策略', emoji: '🗄️', status: 'archived', updatedAt: now - 25 * day },
    { text: '去年此时 #生活\n\n翻到去年今日的日记，状态完全不同。\n记录让时间有了形状。', emoji: '📅', status: 'archived', updatedAt: now - 30 * day },
    { text: '误删的草稿 #工作\n\n不小心移动到回收站的旧草稿，演示恢复流程。', emoji: '♻️', status: 'trash', previousStatus: 'active', deletedAt: now - 2 * day, updatedAt: now - 20 * day },
    { text: '过期的购物清单 #生活\n\n已经买完，可以永久删除。', emoji: '🗑️', status: 'trash', previousStatus: 'active', deletedAt: now - 5 * day, updatedAt: now - 22 * day },
  ];

  return samples.map((sample) => {
    const updatedAt = sample.updatedAt ?? now;
    const status = (sample.status ?? 'active') as NoteStatus;
    return {
      id: createId(),
      text: canonicalize(sample.text),
      emoji: sample.emoji ?? '',
      images: [] as NoteImage[],
      pinned: Boolean(sample.pinned),
      collapsed: Boolean(sample.collapsed),
      status,
      previousStatus: ((sample.previousStatus ?? 'active') as 'active' | 'archived'),
      order: null,
      createdAt: updatedAt,
      updatedAt,
      deletedAt: sample.deletedAt ?? null,
    };
  });
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
