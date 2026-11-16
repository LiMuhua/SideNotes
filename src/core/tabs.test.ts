import { describe, expect, it } from 'vitest';
import {
  allTags,
  belongsTo,
  filterNotes,
  homeTab,
  notesInTab,
  pinnedTagOf,
  resultOrder,
  tabCount,
  tabExists,
  tabLabel,
  tabName,
  tabOfTag,
  tabOrder,
  tabPatch,
  tagOfTab,
} from './tabs';
import type { Note } from './types';

/** 构造一条记录，未指定的字段用默认值。 */
function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note',
    text: '内容',
    emoji: '',
    images: [],
    pinned: false,
    collapsed: false,
    status: 'active',
    previousStatus: 'active',
    order: null,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

const PINNED = ['开发', '设计'];

describe('页签', () => {
  it('标签页签写成 tag:标签，名称与提示里的写法', () => {
    expect(tabOfTag('开发')).toBe('tag:开发');
    expect(tagOfTab('tag:开发')).toBe('开发');
    expect(tagOfTab('workspace')).toBe('');
    expect([tabName('workspace'), tabName('pinned'), tabName('tag:开发')]).toEqual(['随记', '置顶', '开发']);
    expect([tabLabel('workspace'), tabLabel('tag:开发')]).toEqual(['随记', '「开发」']);
    expect(tabOrder(PINNED)).toEqual(['workspace', 'pinned', 'tag:开发', 'tag:设计']);
    expect(resultOrder(PINNED)).toEqual(['pinned', 'workspace', 'tag:开发', 'tag:设计']);
  });

  it('随记是没有任何已固定标签的记录，置顶是置顶的记录，标签页签是带这个标签的记录（不分大小写）', () => {
    const plain = note({ text: '随手一句 #想法' });
    const dev = note({ text: '修复 #开发' });
    const both = note({ text: '评审 #设计 #开发', pinned: true });
    const trash = note({ text: '删掉的 #开发', status: 'trash' });
    expect(belongsTo(plain, 'workspace', PINNED)).toBe(true);
    expect(belongsTo(dev, 'workspace', PINNED)).toBe(false);
    expect(belongsTo(dev, 'tag:开发', PINNED)).toBe(true);
    expect(belongsTo(both, 'tag:设计', PINNED)).toBe(true);
    expect(belongsTo(both, 'pinned', PINNED)).toBe(true);
    expect(belongsTo(trash, 'tag:开发', PINNED)).toBe(false);
    expect(belongsTo(note({ text: '大写 #DEV' }), 'tag:dev', ['dev'])).toBe(true);
    // 没有固定的标签时，全部未删除的记录都在随记。
    expect(belongsTo(dev, 'workspace', [])).toBe(true);
  });

  it('页签内置顶在前，再按手动顺序与创建时间；条数与筛选', () => {
    const notes = [
      note({ id: 'a', text: 'A #开发', createdAt: 3000 }),
      note({ id: 'b', text: 'B #开发', createdAt: 2000, pinned: true }),
      note({ id: 'c', text: 'C #开发 #设计', createdAt: 1000 }),
      note({ id: 'd', text: 'D', createdAt: 4000 }),
    ];
    expect(notesInTab(notes, 'tag:开发', PINNED).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(notesInTab(notes, 'workspace', PINNED).map((item) => item.id)).toEqual(['d']);
    expect(tabCount(notes, 'tag:开发', PINNED)).toBe(3);
    expect(filterNotes(notes, 'tag:开发', PINNED, '', '设计').map((item) => item.id)).toEqual(['c']);
  });

  it('记录所在的页签：置顶的在置顶，其余在第一个固定标签，没有时在随记', () => {
    expect(homeTab(note({ text: 'x #设计 #开发' }), PINNED)).toBe('tag:开发');
    expect(homeTab(note({ text: 'x #开发', pinned: true }), PINNED)).toBe('pinned');
    expect(homeTab(note({ text: 'x #想法' }), PINNED)).toBe('workspace');
    expect(pinnedTagOf(note({ text: 'x #设计 #开发' }), PINNED)).toBe('开发');
  });

  it('移出页签栏之后标签页签就不在了', () => {
    expect(tabExists('tag:开发', PINNED)).toBe(true);
    expect(tabExists('tag:产品', PINNED)).toBe(false);
    expect(tabExists('workspace', [])).toBe(true);
  });

  it('全部标签与条数，条数多的在前，不含回收站', () => {
    const notes = [note({ text: 'a #开发' }), note({ text: 'b #开发 #设计' }), note({ text: 'c #产品', status: 'trash' })];
    expect(allTags(notes)).toEqual([
      { tag: '开发', count: 2 },
      { tag: '设计', count: 1 },
    ]);
  });

  it('移到页签：到标签页签加上标签，从别的标签页签来时换掉原来那个；到随记去掉当前页签的标签；到置顶只置顶', () => {
    const dev = note({ text: '修复 #开发 #紧急' });
    expect(tabPatch(dev, 'tag:开发', 'tag:设计')).toEqual({ text: '修复\n\n#紧急 #设计' });
    expect(tabPatch(dev, 'workspace', 'tag:设计')).toEqual({ text: '修复\n\n#开发 #紧急 #设计' });
    expect(tabPatch(dev, 'tag:开发', 'workspace')).toEqual({ text: '修复\n\n#紧急' });
    expect(tabPatch(dev, 'tag:开发', 'pinned')).toEqual({ pinned: true });
    expect(tabPatch(note({ pinned: true }), 'pinned', 'workspace')).toEqual({ pinned: false });
    // 已经带着目标标签时不重复添加。
    expect(tabPatch(dev, 'workspace', 'tag:开发')).toEqual({});
  });
});
