import { beforeEach, describe, expect, it, vi } from 'vitest';

// 桥接层在导入时不触碰 Tauri，这里改写其导出以模拟持久化成功与失败。
vi.mock('./bridge', () => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  saveSettings: vi.fn(),
  purgeExpired: vi.fn(),
  isDesktop: () => false,
}));

import * as bridge from './bridge';
import {
  commitEdit,
  deleteForever,
  getState,
  mergeImported,
  moveNotes,
  reorderNotes,
  resetForTest,
  restoreFromTrash,
  restoreNotes,
  saveDraftAsNote,
  updateNote,
  updateSettings,
} from './store';
import type { Note } from './types';

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

describe('状态仓库', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveSnapshot.mockResolvedValue(true);
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
});
