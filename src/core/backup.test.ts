import { describe, expect, it } from 'vitest';
import { backupName, parseBackup, rewriteAttachmentPaths } from './backup';

describe('备份', () => {
  it('名称用本地日期', () => {
    expect(backupName(new Date(2026, 10, 3, 1, 30))).toBe('SideNotes-备份-2026-11-03');
  });

  it('解析新旧两种格式：新格式带数据目录与附件文件夹', () => {
    const note = { id: 'a', text: '记录', createdAt: 1, updatedAt: 1 };
    const current = parseBackup(
      JSON.stringify({ notes: [note], draft: { text: '草稿' }, dataDirectory: 'C:\\Data', attachmentsDirectory: 'attachments' }),
    );
    expect(current.notes).toHaveLength(1);
    expect(current.draft?.text).toBe('草稿');
    expect(current.dataDirectory).toBe('C:\\Data');
    expect(current.attachmentsDirectory).toBe('attachments');
    const legacy = parseBackup(JSON.stringify([note]));
    expect(legacy.notes).toHaveLength(1);
    expect(legacy.dataDirectory).toBe('');
    expect(legacy.attachmentsDirectory).toBe('');
    expect(() => parseBackup(JSON.stringify({ notes: 'x' }))).toThrow();
  });

  it('旧备份中的归档记录导入时迁移为带 #归档 的普通记录，回收站中的仍在回收站', () => {
    const parsed = parseBackup(
      JSON.stringify({
        notes: [
          { id: 'a', text: '旧需求 #工作', status: 'archived', createdAt: 1, updatedAt: 1 },
          { id: 'b', text: '删掉的', status: 'trash', previousStatus: 'archived', deletedAt: 2, createdAt: 1, updatedAt: 1 },
        ],
      }),
    );
    expect(parsed.notes.map((note) => [note.status, note.previousStatus, note.text])).toEqual([
      ['active', 'active', '旧需求\n\n#工作 #归档'],
      ['trash', 'active', '删掉的\n\n#归档'],
    ]);
  });

  it('把附件路径改写到当前数据目录，两种斜杠写法都改，其它路径不动', () => {
    const text = '![图](C:\\Old\\attachments\\1-0\\图.png) [表](C:/Old/attachments/2-0/表.xlsx) C:\\Other\\x.txt';
    expect(rewriteAttachmentPaths(text, 'C:\\Old\\', 'D:\\New')).toBe(
      '![图](D:\\New\\attachments\\1-0\\图.png) [表](D:/New/attachments/2-0/表.xlsx) C:\\Other\\x.txt',
    );
    expect(rewriteAttachmentPaths(text, 'C:\\Old', 'C:\\Old')).toBe(text);
    expect(rewriteAttachmentPaths(text, '', 'D:\\New')).toBe(text);
  });
});
