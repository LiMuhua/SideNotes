import { describe, expect, it } from 'vitest';
import {
  compareNoteOrder,
  createNote,
  ensureEmoji,
  formatTime,
  inTab,
  isExpired,
  matchesQuery,
  noteTitle,
  normalizeImage,
  normalizeNote,
  rankTags,
  suggestTags,
} from './notes';
import type { Note } from './types';

/** 构造一条完整记录，测试只覆盖需要的字段。 */
function note(overrides: Partial<Note> = {}): Note {
  const base: Note = {
    id: 'note-1',
    text: '标题\n\n正文 #工作',
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
  };
  return { ...base, ...overrides };
}

describe('记录校验', () => {
  it('补全缺失字段并规范正文', () => {
    const result = normalizeNote({ text: '内容 #标签', createdAt: 123 });
    expect(result).not.toBeNull();
    expect(result?.status).toBe('active');
    expect(result?.pinned).toBe(false);
    expect(result?.order).toBeNull();
    expect(result?.id).toBeTruthy();
    expect(result?.text).toBe('内容\n\n#标签');
  });

  it('拒绝正文与图片同时为空的记录', () => {
    expect(normalizeNote({ text: '   ' })).toBeNull();
    expect(normalizeNote({})).toBeNull();
    expect(normalizeNote(null)).toBeNull();
  });

  it('只保留图片记录中有效的附件', () => {
    const result = normalizeNote({
      text: '',
      images: [
        { id: 'a', name: '图.png', type: 'image/png', data: 'data:image/png;base64,AAAA' },
        { id: 'b', name: '坏.png', type: 'image/png', data: 'https://example.com/x.png' },
      ],
    });
    expect(result?.images).toHaveLength(1);
    expect(result?.images[0].id).toBe('a');
  });

  it('越界时间戳回落到当前时间', () => {
    const result = normalizeNote({ text: '内容', createdAt: 9e18 });
    expect(result?.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('拒绝非 data URL 的图片', () => {
    expect(normalizeImage({ data: 'https://example.com/a.png' })).toBeNull();
    expect(normalizeImage({ data: 'data:text/html,<script>' })).toBeNull();
    expect(normalizeImage({ data: 'data:image/png;base64,AA' })).not.toBeNull();
  });

  it('未知 status 回落为 active', () => {
    expect(normalizeNote({ text: '内容', status: 'unknown' })?.status).toBe('active');
    expect(normalizeNote({ text: '内容', status: 'trash' })?.status).toBe('trash');
  });
});

describe('Emoji 分配', () => {
  it('为缺失的记录补齐 Emoji', () => {
    const result = ensureEmoji([note({ emoji: '' }), note({ id: 'note-2', emoji: '' })]);
    expect(result[0].emoji).toBeTruthy();
    expect(result[1].emoji).toBeTruthy();
    expect(result[0].emoji).not.toBe(result[1].emoji);
  });

  it('重复的 Emoji 会被重新分配', () => {
    const result = ensureEmoji([note({ emoji: '🌱' }), note({ id: 'note-2', emoji: '🌱' })]);
    expect(result[0].emoji).toBe('🌱');
    expect(result[1].emoji).not.toBe('🌱');
  });

  it('新记录不会取用已占用的 Emoji', () => {
    const existing = [note({ emoji: '🌱' })];
    const created = createNote('新内容', [], { existing });
    expect(created.emoji).not.toBe('🌱');
    expect(created.order).toBeNull();
  });
});

describe('排序与页签', () => {
  it('无手动顺序时按创建时间倒序', () => {
    const older = note({ id: 'a', createdAt: 1000 });
    const newer = note({ id: 'b', createdAt: 2000 });
    expect([older, newer].sort(compareNoteOrder)[0].id).toBe('b');
  });

  it('手动顺序优先于创建时间', () => {
    const first = note({ id: 'a', createdAt: 1000, order: 0 });
    const second = note({ id: 'b', createdAt: 9000, order: 1 });
    expect([second, first].sort(compareNoteOrder).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('按页签筛选记录', () => {
    expect(inTab(note({ status: 'active' }), 'workspace')).toBe(true);
    expect(inTab(note({ status: 'archived' }), 'workspace')).toBe(false);
    expect(inTab(note({ status: 'active', pinned: true }), 'pinned')).toBe(true);
    expect(inTab(note({ status: 'active', pinned: false }), 'pinned')).toBe(false);
    expect(inTab(note({ status: 'archived' }), 'archive')).toBe(true);
    expect(inTab(note({ status: 'trash' }), 'workspace')).toBe(false);
  });
});

describe('搜索', () => {
  it('空查询匹配全部', () => {
    expect(matchesQuery(note(), '')).toBe(true);
    expect(matchesQuery(note(), '   ')).toBe(true);
  });

  it('按正文词条匹配', () => {
    expect(matchesQuery(note({ text: '侧栏交互调整 #产品' }), '侧栏')).toBe(true);
    expect(matchesQuery(note({ text: '侧栏交互调整 #产品' }), '速记')).toBe(false);
  });

  it('多个词条需要全部命中', () => {
    const target = note({ text: '发布检查 数据库迁移 #开发' });
    expect(matchesQuery(target, '发布 迁移')).toBe(true);
    expect(matchesQuery(target, '发布 不存在')).toBe(false);
  });

  it('标签按前缀匹配并可与正文组合', () => {
    const target = note({ text: '内容说明 #开发 #测试' });
    expect(matchesQuery(target, '#开发')).toBe(true);
    expect(matchesQuery(target, '#开')).toBe(true);
    expect(matchesQuery(target, '#开发 #测试')).toBe(true);
    expect(matchesQuery(target, '#开发 说明')).toBe(true);
    expect(matchesQuery(target, '#设计')).toBe(false);
  });

  it('只输入 # 时匹配带标签的记录，字面的 # 仍可搜索', () => {
    const tagged = note({ text: '周会纪要 #工作' });
    const plain = note({ text: '学习 C# 语法' });
    expect(matchesQuery(tagged, '#')).toBe(true);
    expect(matchesQuery(plain, '#')).toBe(false);
    expect(matchesQuery(tagged, '# 周会')).toBe(true);
    expect(matchesQuery(tagged, '# 学习')).toBe(false);
    expect(matchesQuery(plain, 'C#')).toBe(true);
  });

  it('匹配图片附件名称', () => {
    const target = note({
      text: '配色参考',
      images: [{ id: 'a', name: '界面配色.svg', type: 'image/svg+xml', data: 'data:image/svg+xml,x' }],
    });
    expect(matchesQuery(target, '界面配色')).toBe(true);
  });
});

describe('标签评分', () => {
  it('精确匹配的标签排在最前', () => {
    const notes = [
      note({ id: 'a', text: '甲 #开发' }),
      note({ id: 'b', text: '乙 #开发' }),
      note({ id: 'c', text: '丙 #设计' }),
    ];
    const ranked = rankTags(notes, 'workspace', {}, '#设计', '');
    expect(ranked[0].tag).toBe('设计');
    expect(ranked[0].exact).toBe(true);
  });

  it('访问频率高的标签分数更高', () => {
    const notes = [note({ id: 'a', text: '甲 #常用' }), note({ id: 'b', text: '乙 #少用' })];
    const now = 1_800_000_000_000;
    const ranked = rankTags(notes, 'workspace', { 常用: { count: 20, last: now } }, '', '', now);
    expect(ranked[0].tag).toBe('常用');
  });

  it('统计条数与置顶情况', () => {
    const notes = [
      note({ id: 'a', text: '甲 #工作', pinned: true }),
      note({ id: 'b', text: '乙 #工作' }),
    ];
    const ranked = rankTags(notes, 'workspace', {}, '', '');
    expect(ranked[0].count).toBe(2);
    expect(ranked[0].pinned).toBe(1);
  });
});

describe('标签联想', () => {
  const notes = [
    note({ id: 'a', text: '甲 #worklog' }),
    note({ id: 'b', text: '乙 #worklog' }),
    note({ id: 'c', text: '丙 #Workflow' }),
    note({ id: 'd', text: '丁 #webapp' }),
    note({ id: 'e', text: '戊 #work-old', status: 'trash' }),
  ];

  it('按前缀匹配，忽略大小写，按评分排序，不含回收站中的标签', () => {
    expect(suggestTags(notes, {}, 'wo')).toEqual(['worklog', 'Workflow']);
    expect(suggestTags(notes, {}, 'WO')).toEqual(['worklog', 'Workflow']);
  });

  it('访问频率高的标签排在前面', () => {
    const now = 1_800_000_000_000;
    expect(suggestTags(notes, { workflow: { count: 9, last: now } }, 'wo', [], now)[0]).toBe('Workflow');
  });

  it('不提示与输入相同的标签和本条记录已有的标签', () => {
    expect(suggestTags(notes, {}, 'worklog')).toEqual([]);
    expect(suggestTags(notes, {}, 'wo', ['worklog'])).toEqual(['Workflow']);
    expect(suggestTags(notes, {}, '')).toEqual([]);
  });
});

describe('回收站到期', () => {
  it('超过保留天数才算到期', () => {
    const now = 1_800_000_000_000;
    expect(isExpired(note({ deletedAt: now - 40 * 86_400_000 }), 30, now)).toBe(true);
    expect(isExpired(note({ deletedAt: now - 10 * 86_400_000 }), 30, now)).toBe(false);
    expect(isExpired(note({ deletedAt: null }), 30, now)).toBe(false);
  });
});

describe('展示辅助', () => {
  it('标题取首个非空行并去掉标记', () => {
    expect(noteTitle(note({ text: '## 发布检查\n\n正文 #开发' }))).toBe('发布检查');
    expect(noteTitle(note({ text: '**加粗标题**\n\n正文' }))).toBe('加粗标题');
  });

  it('首行是图片或链接时只取说明文字', () => {
    expect(noteTitle(note({ text: '![截图-20261102](C:/Data/attachments/1-0/截图.png)\n\n说明' }))).toBe('截图-20261102');
    expect(noteTitle(note({ text: '![](C:/a.png)' }))).toBe('图片');
    expect(noteTitle(note({ text: '见 [方案 (终版).pdf](<C:/a b/(1).pdf>) 第二页' }))).toBe('见 方案 (终版).pdf 第二页');
  });

  it('纯图片记录使用占位标题', () => {
    const target = note({
      text: '',
      images: [{ id: 'a', name: '图.png', type: 'image/png', data: 'data:image/png;base64,AA' }],
    });
    expect(noteTitle(target)).toBe('图片记录');
  });

  it('今天显示时分，其他日期显示完整时间', () => {
    const today = new Date();
    today.setHours(14, 30, 0, 0);
    expect(formatTime(today.getTime())).toBe('14:30');
    expect(formatTime(new Date(2026, 0, 2, 9, 5).getTime())).toBe('2026-01-02 09:05');
  });
});
