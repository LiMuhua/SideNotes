import { describe, expect, it } from 'vitest';
import { pastedName, referencesFor } from './attachments';

describe('附件副本', () => {
  it('图片写成内嵌图片，其它文件写成文件引用，多个时每个一行', () => {
    const markdown = referencesFor([
      { name: '截图-20261102-090510.png', path: 'C:\\Data\\attachments\\1-0\\截图-20261102-090510.png' },
      { name: '方案 (终版).pdf', path: 'C:\\Data\\attachments\\2-0\\方案 (终版).pdf' },
    ]);
    expect(markdown).toBe(
      '![截图-20261102-090510](C:\\Data\\attachments\\1-0\\截图-20261102-090510.png)\n' +
        '[方案 (终版).pdf](<C:\\Data\\attachments\\2-0\\方案 (终版).pdf>)',
    );
  });

  it('截图没有文件名时按粘贴时间命名，复制的文件保留原名', () => {
    const now = new Date(2026, 10, 2, 9, 5, 10);
    expect(pastedName({ name: 'image.png', type: 'image/png' }, 0, now)).toBe('截图-20261102-090510.png');
    expect(pastedName({ name: '', type: 'image/jpeg' }, 1, now)).toBe('截图-20261102-090510-2.jpg');
    expect(pastedName({ name: '设计稿.png', type: 'image/png' }, 0, now)).toBe('设计稿.png');
  });
});
