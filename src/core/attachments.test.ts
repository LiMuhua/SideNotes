import { describe, expect, it } from 'vitest';
import { bytesToDataUrl, dataUrlToBytes, imageMime, pastedName, referencesFor, replaceReference } from './attachments';

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

  it('替换或删除原文中的附件引用，位置失效时按原文重新查找', () => {
    const image = '![图](C:\\Data\\attachments\\1-0\\图.png)';
    const text = `说明\n${image}\n后文`;
    const span = { start: 3, end: 3 + image.length, source: image };
    expect(replaceReference(text, span, '[报告](C:\\r.pdf)')?.text).toBe('说明\n[报告](C:\\r.pdf)\n后文');
    // 删除时所在行只剩空白，整行删去。
    expect(replaceReference(text, span, '')).toEqual({ text: '说明\n后文', start: 3, end: 3 });
    // 原文前面多了文字：按引用原文重新定位。
    expect(replaceReference(`新增\n${text}`, span, '')?.text).toBe('新增\n说明\n后文');
    expect(replaceReference('没有这个引用', span, '')).toBeNull();
  });

  it('图片的 MIME 类型与 data URL 互转', () => {
    expect(imageMime('截图.PNG')).toBe('image/png');
    expect(imageMime('照片.jpeg')).toBe('image/jpeg');
    expect(imageMime('报告.pdf')).toBe('');
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    const url = bytesToDataUrl(bytes, 'image/png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(Array.from(dataUrlToBytes(url))).toEqual(Array.from(bytes));
  });
});
