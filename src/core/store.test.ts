import { beforeEach, describe, expect, it, vi } from 'vitest';

// 桥接层在导入时不触碰 Tauri，这里改写其导出以模拟持久化成功与失败。
vi.mock('./bridge', () => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  purgeExpired: vi.fn(),
  emitStoreChange: vi.fn(),
  onStoreChange: vi.fn(async () => () => {}),
  isDesktop: () => false,
}));

import * as bridge from './bridge';
import {
  commitEdit,
  deleteForever,
  getState,
  mergeImported,
  moveNotes,
  reloadFromDisk,
  removeTagEverywhere,
  renameTag,
  reorderNotes,
  resetForTest,
  restoreFromTrash,
  restoreNotes,
  saveDraftAsNote,
  trackTagUsage,
  updateNote,
  updateSettings,
} from './store';
import { DEFAULT_SETTINGS } from './settings';
import type { Note, Snapshot } from './types';

/** 构造记录。 */
function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    text: '内容 #工作',
    emoji: '📝',
    images: [],
    pinned: false,
    collapsed: false,
    status: 'active',
    previousStatus: 'active',
    order: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

const saveSnapshot = vi.mocked(bridge.saveSnapshot);
const saveSettings = vi.mocked(bridge.saveSettings);
const loadSnapshot = vi.mocked(bridge.loadSnapshot);
const emitStoreChange = vi.mocked(bridge.emitStoreChange);

/** 构造数据库快照。 */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    notes: [],
    draft: { text: '', images: [], updatedAt: 0 },
    settings: DEFAULT_SETTINGS,
    tagUsage: {},
    ...overrides,
  };
}

describe('状态仓库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveSnapshot.mockResolvedValue(true);
    saveSettings.mockResolvedValue(true);
    resetForTest({ notes: [note(), note({ id: 'note-2', text: '其它 #设计' })], ready: true });
  });

  it('修改记录成功后替换权威状态', async () => {
    const ok = await updateNote('note-1', { pinned: true });
    expect(ok).toBe(true);
    expect(getState().notes[0].pinned).toBe(true);
    expect(getState().saveFailed).toBe(false);
  });

  it('持久化失败时保持原状并标记失败', async () => {
    saveSnapshot.mockResolvedValue(false);
    const before = getState().notes;
    const ok = await updateNote('note-1', { pinned: true });
    expect(ok).toBe(false);
    expect(getState().notes).toBe(before);
    expect(getState().saveFailed).toBe(true);
  });

  it('保存草稿为新记录并清空草稿', async () => {
    resetForTest({
      notes: [note()],
      draft: { text: '新内容 #临时', images: [], updatedAt: 1 },
      ready: true,
    });
    const created = await saveDraftAsNote('workspace');
    expect(created).not.toBeNull();
    expect(getState().notes).toHaveLength(2);
    expect(getState().draft.text).toBe('');
  });

  it('在置顶页新建时自动置顶，在归档页新建进入归档', async () => {
    resetForTest({ draft: { text: '内容', images: [], updatedAt: 1 }, ready: true });
    const pinned = await saveDraftAsNote('pinned');
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.status).toBe('active');

    resetForTest({ draft: { text: '内容', images: [], updatedAt: 1 }, ready: true });
    const archived = await saveDraftAsNote('archive');
    expect(archived?.status).toBe('archived');
  });

  it('空草稿不创建记录', async () => {
    resetForTest({ draft: { text: '   ', images: [], updatedAt: 1 }, ready: true });
    expect(await saveDraftAsNote('workspace')).toBeNull();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it('批量移入回收站并可撤销', async () => {
    const undo = await moveNotes(['note-1', 'note-2'], 'trash');
    expect(undo).not.toBeNull();
    expect(getState().notes.every((item) => item.status === 'trash')).toBe(true);
    expect(getState().notes[0].deletedAt).not.toBeNull();

    if (!undo) return;
    await restoreNotes(undo);
    expect(getState().notes.every((item) => item.status === 'active')).toBe(true);
  });

  it('移入回收站记住删除前位置，撤销后完整还原', async () => {
    resetForTest({
      notes: [note({ status: 'archived', pinned: true, order: 3, previousStatus: 'active' })],
      ready: true,
    });
    const undo = await moveNotes(['note-1'], 'trash');
    expect(getState().notes[0]).toMatchObject({ status: 'trash', previousStatus: 'archived' });
    expect(getState().notes[0].deletedAt).not.toBeNull();

    if (!undo) throw new Error('移入回收站未保存');
    expect(await restoreNotes(undo)).toBe(true);
    expect(getState().notes[0]).toMatchObject({
      status: 'archived',
      pinned: true,
      order: 3,
      previousStatus: 'active',
      deletedAt: null,
    });
  });

  it('移入回收站写入失败时记录保持原样', async () => {
    saveSnapshot.mockResolvedValue(false);
    expect(await moveNotes(['note-1'], 'trash')).toBeNull();
    expect(getState().notes[0]).toMatchObject({ status: 'active', deletedAt: null });
    expect(getState().saveFailed).toBe(true);
  });

  it('移到置顶会设置置顶并清除手动顺序', async () => {
    resetForTest({ notes: [note({ order: 5 })], ready: true });
    await moveNotes(['note-1'], 'pinned');
    expect(getState().notes[0].pinned).toBe(true);
    expect(getState().notes[0].order).toBeNull();
  });

  it('回收站中的记录不被再次移动', async () => {
    resetForTest({ notes: [note({ status: 'trash', deletedAt: 1 })], ready: true });
    await moveNotes(['note-1'], 'archive');
    expect(getState().notes[0].status).toBe('trash');
  });

  it('排序写入连续序号', async () => {
    resetForTest({
      notes: [
        note({ id: 'a', createdAt: 3000 }),
        note({ id: 'b', createdAt: 2000 }),
        note({ id: 'c', createdAt: 1000 }),
      ],
      ready: true,
    });
    const undo = await reorderNotes(new Set(['c']), 'a', false);
    expect(undo).not.toBeNull();
    const orders = getState()
      .notes.filter((item) => item.order !== null)
      .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
      .map((item) => item.id);
    expect(orders[0]).toBe('c');
  });

  it('拖到自身不产生排序', async () => {
    expect(await reorderNotes(new Set(['note-1']), 'note-1', false)).toBeNull();
  });

  it('跨组落位继承目标组的置顶状态', async () => {
    resetForTest({
      notes: [note({ id: 'pinned-note', pinned: true }), note({ id: 'plain-note', pinned: false })],
      ready: true,
    });
    await reorderNotes(new Set(['plain-note']), 'pinned-note', true);
    expect(getState().notes.find((item) => item.id === 'plain-note')?.pinned).toBe(true);
  });

  it('提交编辑会规范正文中的标签位置', async () => {
    await commitEdit('note-1', '新正文 #甲\n其它 #乙', []);
    expect(getState().notes[0].text).toBe('新正文\n其它\n\n#甲 #乙');
  });

  it('设置变更经过校验', async () => {
    await updateSettings({ width: 9999 });
    expect(getState().settings.width).toBe(720);
  });

  it('设置只经 save_settings 写入，不整体重写记录', async () => {
    const ok = await updateSettings({ theme: 'dark' });
    expect(ok).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(emitStoreChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'settings', settings: expect.objectContaining({ theme: 'dark' }) }),
    );
  });

  it('连续的设置变更合并为一次写入', async () => {
    const first = updateSettings({ width: 400 });
    const second = updateSettings({ width: 420 });
    // 界面立即应用最新值，不等待写入完成。
    expect(getState().settings.width).toBe(420);
    await Promise.all([first, second]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.calls[0][0].width).toBe(420);
  });

  it('设置写入失败时回滚并标记失败', async () => {
    saveSettings.mockResolvedValue(false);
    const ok = await updateSettings({ theme: 'dark' });
    expect(ok).toBe(false);
    expect(getState().settings.theme).toBe('light');
    expect(getState().saveFailed).toBe(true);
    expect(emitStoreChange).not.toHaveBeenCalled();
  });

  it('记录写入成功后通知其它窗口刷新', async () => {
    await updateNote('note-1', { pinned: true });
    expect(emitStoreChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'data' }));
  });

  it('重新读库时采用数据库中的记录', async () => {
    loadSnapshot.mockResolvedValue(snapshot({ notes: [note({ id: 'from-disk' })] }));
    await reloadFromDisk();
    expect(getState().notes.map((item) => item.id)).toEqual(['from-disk']);
  });

  it('重新读库期间本窗口有新写入时丢弃过时结果', async () => {
    let resolveLoad: (value: Snapshot) => void = () => {};
    loadSnapshot.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)));
    const reloading = reloadFromDisk();
    await updateNote('note-1', { pinned: true });
    resolveLoad(snapshot({ notes: [note({ id: 'stale' })] }));
    await reloading;
    expect(getState().notes.find((item) => item.id === 'note-1')?.pinned).toBe(true);
    expect(getState().notes.some((item) => item.id === 'stale')).toBe(false);
  });

  it('重新读库保留本窗口尚未落盘的草稿', async () => {
    resetForTest({ ready: true, draftDirty: true, draft: { text: '写了一半', images: [], updatedAt: 1 } });
    loadSnapshot.mockResolvedValue(snapshot({ draft: { text: '', images: [], updatedAt: 2 } }));
    await reloadFromDisk();
    expect(getState().draft.text).toBe('写了一半');
  });

  it('永久删除只影响回收站中的目标记录', async () => {
    resetForTest({
      notes: [note({ id: 'a', status: 'trash' }), note({ id: 'b', status: 'active' })],
      ready: true,
    });
    await deleteForever(['a', 'b']);
    const ids = getState().notes.map((item) => item.id);
    expect(ids).toEqual(['b']);
  });

  it('从回收站恢复到删除前的位置', async () => {
    resetForTest({
      notes: [note({ id: 'a', status: 'trash', previousStatus: 'archived', deletedAt: 1 })],
      ready: true,
    });
    await restoreFromTrash(['a']);
    expect(getState().notes[0].status).toBe('archived');
    expect(getState().notes[0].deletedAt).toBeNull();
  });

  it('导入时同标识仅在备份更新时替换', async () => {
    resetForTest({ notes: [note({ id: 'a', text: '旧内容', updatedAt: 1000 })], ready: true });
    await mergeImported(
      [
        note({ id: 'a', text: '新内容', updatedAt: 2000 }),
        note({ id: 'b', text: '新增记录', updatedAt: 500 }),
      ],
      null,
    );
    const map = new Map(getState().notes.map((item) => [item.id, item.text]));
    expect(map.get('a')).toBe('新内容');
    expect(map.get('b')).toBe('新增记录');
  });

  it('导入时较旧的同标识记录不覆盖现有内容', async () => {
    resetForTest({ notes: [note({ id: 'a', text: '现有内容', updatedAt: 5000 })], ready: true });
    await mergeImported([note({ id: 'a', text: '过期内容', updatedAt: 1000 })], null);
    expect(getState().notes[0].text).toBe('现有内容');
  });

  it('标签筛选记录访问次数与时间', async () => {
    await trackTagUsage('工作');
    await trackTagUsage('工作');
    expect(getState().tagUsage['工作'].count).toBe(2);
    expect(getState().tagUsage['工作'].last).toBeGreaterThan(0);
  });

  it('全局重命名标签只改标签，并迁移访问统计', async () => {
    resetForTest({
      ready: true,
      notes: [note({ id: 'a', text: '正文 A\n\n#工作 #会议' }), note({ id: 'b', text: '正文 B\n\n#生活' })],
      tagUsage: { 工作: { count: 3, last: 10 } },
    });
    expect(await renameTag('工作', '项目')).toBe(true);
    expect(getState().notes.find((item) => item.id === 'a')?.text).toBe('正文 A\n\n#项目 #会议');
    expect(getState().notes.find((item) => item.id === 'b')?.text).toBe('正文 B\n\n#生活');
    expect(getState().tagUsage['项目']).toEqual({ count: 3, last: 10 });
    expect(getState().tagUsage['工作']).toBeUndefined();
  });

  it('重命名为已有标签时两者合并', async () => {
    resetForTest({ ready: true, notes: [note({ id: 'a', text: '正文\n\n#工作 #会议' })] });
    await renameTag('工作', '会议');
    expect(getState().notes[0].text).toBe('正文\n\n#会议');
  });

  it('全局移除标签保留正文，空记录保留标签名', async () => {
    resetForTest({
      ready: true,
      notes: [note({ id: 'a', text: '正文\n\n#工作 #会议' }), note({ id: 'b', text: '#工作' })],
    });
    expect(await removeTagEverywhere('工作')).toBe(true);
    expect(getState().notes.find((item) => item.id === 'a')?.text).toBe('正文\n\n#会议');
    expect(getState().notes.find((item) => item.id === 'b')?.text).toBe('工作');
  });
});
