import { describe, expect, it } from 'vitest';
import { boundedNumber, DEFAULT_SETTINGS, normalizeSettings, parseDelay, resolveFontFamily } from './settings';
import { filePath, fileLabel, isLegacyToken, toMarkdownReference } from './files';

describe('设置校验', () => {
  it('空输入返回完整默认值', () => {
    const settings = normalizeSettings({});
    expect(settings.theme).toBe('light');
    expect(settings.surface).toBe('standard');
    expect(settings.edge).toBe('right');
    expect(settings.width).toBe(416);
    expect(settings.fontFamily).toBe('Segoe UI');
    expect(settings.pageSize).toBe(10);
    expect(settings.trashDays).toBe(30);
    expect(settings.protectEditing).toBe(true);
    expect(settings.cloud.enabled).toBe(false);
  });

  it('越界数值就近校正', () => {
    expect(normalizeSettings({ width: 100 }).width).toBe(360);
    expect(normalizeSettings({ width: 9999 }).width).toBe(720);
    expect(normalizeSettings({ fontSize: 2 }).fontSize).toBe(12);
    expect(normalizeSettings({ fontSize: 99 }).fontSize).toBe(18);
    expect(normalizeSettings({ pageSize: 1 }).pageSize).toBe(5);
    expect(normalizeSettings({ pageSize: 500 }).pageSize).toBe(100);
    expect(normalizeSettings({ trashDays: 0 }).trashDays).toBe(1);
    expect(normalizeSettings({ trashDays: 1000 }).trashDays).toBe(365);
    expect(normalizeSettings({ hideDelay: 77 }).hideDelay).toBe(100);
    expect(normalizeSettings({ hideDelay: 99_999 }).hideDelay).toBe(10_000);
    expect(normalizeSettings({ hideDelay: 850 }).hideDelay).toBe(850);
    expect(normalizeSettings({ hideDelay: 'abc' }).hideDelay).toBe(600);
  });

  it('移出后收起的输入可带毫秒或秒的单位', () => {
    expect(parseDelay('800')).toBe(800);
    expect(parseDelay(' 800 ms ')).toBe(800);
    expect(parseDelay('600 毫秒')).toBe(600);
    expect(parseDelay('1.5s')).toBe(1500);
    expect(parseDelay('1 秒')).toBe(1000);
    expect(parseDelay('')).toBeNull();
    expect(parseDelay('-5')).toBeNull();
    expect(parseDelay('一秒')).toBeNull();
  });

  it('未知枚举值回落到默认', () => {
    expect(normalizeSettings({ theme: 'neon' }).theme).toBe('light');
    expect(normalizeSettings({ surface: 'unknown' }).surface).toBe('standard');
    expect(normalizeSettings({ storageLocation: 'cloud' }).storageLocation).toBe('appdata');
    expect(normalizeSettings({ cloud: { provider: 'dropbox' } }).cloud.provider).toBe('synology');
  });

  it('保留合法输入', () => {
    const settings = normalizeSettings({
      theme: 'dark',
      surface: 'win11',
      edge: 'left',
      width: 500,
      hideDelay: 1000,
      protectEditing: false,
      lazyLoading: false,
      cloud: { enabled: true, provider: 'onedrive', account: 'a@b.com' },
    });
    expect(settings.theme).toBe('dark');
    expect(settings.surface).toBe('win11');
    expect(settings.edge).toBe('left');
    expect(settings.width).toBe(500);
    expect(settings.hideDelay).toBe(1000);
    expect(settings.protectEditing).toBe(false);
    expect(settings.lazyLoading).toBe(false);
    expect(settings.cloud.enabled).toBe(true);
    expect(settings.cloud.provider).toBe('onedrive');
  });

  it('宽度按步长 4 取整', () => {
    expect(normalizeSettings({ width: 457 }).width).toBe(457);
    expect(boundedNumber(457, 360, 720, 4)).toBe(456);
    expect(boundedNumber(458, 360, 720, 4)).toBe(460);
  });

  it('非数值与空值返回 null', () => {
    expect(boundedNumber('', 1, 10)).toBeNull();
    expect(boundedNumber('abc', 1, 10)).toBeNull();
    expect(boundedNumber('5', 1, 10)).toBe(5);
  });

  it('默认设置是规范化的结果', () => {
    expect(normalizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('字体族过滤引号与反斜杠', () => {
    expect(resolveFontFamily('')).toContain('Segoe UI');
    expect(resolveFontFamily('系统默认')).toContain('Segoe UI');
    expect(resolveFontFamily('Microsoft YaHei')).toBe('"Microsoft YaHei", "Microsoft YaHei UI", sans-serif');
    expect(resolveFontFamily('A"; color:red')).not.toContain('"A"');
  });
});

describe('文件引用', () => {
  it('识别 Windows 盘符与 UNC 路径', () => {
    expect(filePath('C:\\Projects\\a.pdf')).toBe('C:\\Projects\\a.pdf');
    expect(filePath('D:/data/b.txt')).toBe('D:/data/b.txt');
    expect(filePath('\\\\server\\share\\c.docx')).toBe('\\\\server\\share\\c.docx');
  });

  it('把 file URL 还原为本地路径', () => {
    expect(filePath('file:///C:/Projects/%E8%AE%BE%E8%AE%A1.pdf')).toBe('C:\\Projects\\设计.pdf');
    expect(filePath('file://server/share/x.txt')).toBe('\\\\server\\share\\x.txt');
  });

  it('网络地址不是文件引用', () => {
    expect(filePath('https://example.com/a.pdf')).toBeNull();
    expect(filePath('普通文字')).toBeNull();
    expect(filePath('')).toBeNull();
  });

  it('兼容原型遗留的浏览器文件标识', () => {
    const token = 'sidenotes-file:47f798dc-5356-4626-a5fe-218d5a9834f3?name=%E5%9B%BE.xmind';
    expect(isLegacyToken(token)).toBe(true);
    expect(filePath(token)).toBe(token);
    expect(fileLabel(token)).toBe('图.xmind');
  });

  it('取路径的文件名作为显示名称', () => {
    expect(fileLabel('C:\\Projects\\设计稿.pdf')).toBe('设计稿.pdf');
  });

  it('生成的 Markdown 引用转义方括号', () => {
    expect(toMarkdownReference('C:\\a\\b.txt')).toBe('[b.txt](C:\\a\\b.txt)');
    expect(toMarkdownReference('C:\\a\\x.txt', '含[方]括号')).toBe('[含\\[方\\]括号](C:\\a\\x.txt)');
  });
});
