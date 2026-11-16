/**
 * 全局搜索（第五次反馈）：Playground 的规则（playground/src/model/notes.tsx）与交互原型的 app.js 相同。
 *
 * - 搜索全部未删除的记录，与当前页签无关；只写 # 还没写标签名时不算搜索；
 * - 写完整的已有标签只匹配这个标签，没写完的按前缀匹配；
 * - 结果按页签分组：每条记录放在它所在的页签——置顶的在置顶（第七次反馈），其余没有固定标签的在随记，有的在第一个固定标签；
 *   置顶组总在最上面，其余与页签栏的顺序相同，组内置顶在前；
 * - 只搜一个已有标签时，搜索框里出现「固定为页签」「合并」。
 */

import { describe, expect, it } from 'vitest';
import type { Note } from '@/core/types';
import { homeTab, searchGroups, searchTerms, singleSearchTag } from '../playground/src/model/notes';

let sequence = 0;
function note(text: string, extra: Partial<Note> = {}): Note {
  sequence += 1;
  return {
    id: `n${sequence}`,
    text,
    emoji: '',
    images: [],
    pinned: false,
    collapsed: false,
    status: 'active',
    previousStatus: 'active',
    order: null,
    createdAt: sequence,
    updatedAt: sequence,
    deletedAt: null,
    ...extra,
  };
}

const pinned = ['开发', '产品'];
const plain = note('买牛奶\n\n#生活');
const pinnedPlain = note('常用命令\n\n#生活', { pinned: true });
const dev = note('发布检查\n\n#开发 #产品');
const product = note('产品评审\n\n#产品 #产品经理');
const manager = note('经理周会\n\n#产品经理');
const trashed = note('发布草稿\n\n#开发', { status: 'trash' });
const notes = [plain, pinnedPlain, dev, product, manager, trashed];

describe('全局搜索', () => {
  it('记录所在的页签：置顶的在置顶，其余没有固定标签的在随记，有的在第一个固定标签', () => {
    expect(homeTab(plain, pinned)).toBe('workspace');
    // 第七次反馈：没有固定标签的置顶记录也在置顶（此前算在随记）。
    expect(homeTab(pinnedPlain, pinned)).toBe('pinned');
    expect(homeTab(note('置顶的开发\n\n#开发', { pinned: true }), pinned)).toBe('pinned');
    expect(homeTab(dev, pinned)).toBe('tag:开发');
    expect(homeTab(product, pinned)).toBe('tag:产品');
  });

  it('只写 # 不算搜索；回收站中的记录不出现', () => {
    expect(searchTerms('#')).toBe('');
    expect(searchTerms('发布 #')).toBe('发布');
    expect(searchGroups(notes, pinned, '#')).toEqual([]);
    const ids = searchGroups(notes, pinned, '发布').flatMap((group) => group.notes.map((item) => item.id));
    expect(ids).toEqual([dev.id]);
  });

  it('置顶组总在最上面，其余按页签栏的顺序分组，组内置顶在前', () => {
    const groups = searchGroups(notes, pinned, '#生活');
    expect(groups.map((group) => group.tab)).toEqual(['pinned', 'workspace']);
    expect(groups.map((group) => group.notes.map((item) => item.id))).toEqual([[pinnedPlain.id], [plain.id]]);
    const pinnedDev = note('置顶的开发\n\n#开发', { pinned: true });
    expect(searchGroups([...notes, pinnedDev], pinned, '#开发').map((group) => group.tab)).toEqual(['pinned', 'tag:开发']);
    expect(searchGroups(notes, pinned, '#产').map((group) => [group.tab, group.notes.length])).toEqual([
      ['workspace', 1],
      ['tag:开发', 1],
      ['tag:产品', 1],
    ]);
  });

  it('写完整的已有标签只匹配这个标签，没写完的按前缀匹配', () => {
    const exact = searchGroups(notes, pinned, '#产品').flatMap((group) => group.notes.map((item) => item.id));
    expect(exact).toEqual([dev.id, product.id]);
    const prefix = searchGroups(notes, pinned, '#产品经').flatMap((group) => group.notes.map((item) => item.id));
    expect(prefix).toEqual([manager.id, product.id]);
  });

  it('只搜一个已有标签时返回这个标签的写法，搜别的时为空', () => {
    expect(singleSearchTag('#产品 ', notes)).toBe('产品');
    expect(singleSearchTag('#产', notes)).toBe('');
    expect(singleSearchTag('#产品 评审', notes)).toBe('');
    expect(singleSearchTag('#不存在', notes)).toBe('');
  });
});
