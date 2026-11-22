import { describe, expect, it } from 'vitest';
import {
  boundedNumber,
  DEFAULT_CLOUD_SCHEDULE,
  DEFAULT_SETTINGS,
  normalizeFontFamily,
  normalizePinnedTags,
  normalizeRemoteFolder,
  normalizeSettings,
  parseDelay,
  resolveFontFamily,
  sidebarWindowWidth,
  uiZoom,
} from './settings';
import { filePath, fileLabel, formatBytes, isLegacyToken, toMarkdownReference } from './files';

describe('设置校验', () => {
  it('空输入返回完整默认值', () => {
    const settings = normalizeSettings({});
    expect(settings.theme).toBe('light');
    expect(settings.surface).toBe('terminal');
    expect(settings.edge).toBe('right');
    expect(settings.width).toBe(400);
    expect(settings.fontFamily).toBe('');
    expect(settings.fontSize).toBe(12);
    expect(settings.settingsVersion).toBe(3);
    expect(settings.appIcon).toBe('door-smile-indigo');
    expect(settings.pinnedTags).toEqual([]);
    expect(settings.windowTabs).toBe('side');
    expect(settings.scrollOnEdit).toBe(true);
    expect(settings.pageSize).toBe(10);
    expect(settings.trashDays).toBe(30);
    expect('protectEditing' in settings).toBe(false);
    expect(settings.cloud.enabled).toBe(false);
    expect(settings.cardMaxHeight).toBe(220);
    expect(settings.toastPosition).toBe('top-center');
    expect(settings.guideSeen).toBe(false);
    expect(settings.snapshotDirectory).toBe('');
    expect(settings.shortcuts).toEqual({});
  });

  it('版本 3 的迁移：standard 改为终端，旧默认字体改为跟随主题，用户的选择保留', () => {
    // 0.7.3（版本 2）的默认设置：标准材质、Maple Mono NF CN 16px、宽 416；字号与宽度是用户可见的取值，原样保留。
    const legacy = normalizeSettings({ settingsVersion: 2, surface: 'standard', fontFamily: 'Maple Mono NF CN', fontSize: 16, width: 416 });
    expect([legacy.surface, legacy.fontFamily, legacy.fontSize, legacy.width]).toEqual(['terminal', '', 16, 416]);
    for (const surface of ['paper', 'glass', 'win11', 'terminal', 'magazine'] as const) {
      expect(normalizeSettings({ settingsVersion: 2, surface }).surface).toBe(surface);
    }
    // 版本 3 之前空值是「系统默认」，保留为「系统默认」；其它字体是用户选的，保留。
    expect(normalizeSettings({ settingsVersion: 2, fontFamily: '' }).fontFamily).toBe('系统默认');
    expect(normalizeSettings({ settingsVersion: 2, fontFamily: '微软雅黑' }).fontFamily).toBe('微软雅黑');
    // 版本 1 的默认 Segoe UI 13px：字体跟随主题，字号换成默认值。
    const first = normalizeSettings({ fontFamily: 'Segoe UI', fontSize: 13 });
    expect([first.fontFamily, first.fontSize]).toEqual(['', 12]);
    // 版本 3 起原样保存：再显式选择 Segoe UI 13px 不会被改掉。
    const chosen = normalizeSettings({ settingsVersion: 3, fontFamily: 'Segoe UI', fontSize: 13 });
    expect([chosen.fontFamily, chosen.fontSize]).toEqual(['Segoe UI', 13]);
    // 「编辑时保持展开」去掉，迁移后不再出现。
    expect('protectEditing' in normalizeSettings({ settingsVersion: 2, protectEditing: false })).toBe(false);
  });

  it('字体：空值跟随主题，「跟随主题」写法同样记为空值', () => {
    expect(normalizeFontFamily('跟随主题', 3)).toBe('');
    expect(normalizeFontFamily('', 3)).toBe('');
    expect(normalizeFontFamily('系统默认', 3)).toBe('系统默认');
    expect(normalizeFontFamily('Maple Mono NF CN', 3)).toBe('Maple Mono NF CN');
    expect(normalizeFontFamily('Maple Mono NF CN', 2)).toBe('');
    expect(normalizeFontFamily(undefined, 2)).toBe('');
    expect(normalizeFontFamily(42, 3)).toBe('');
  });

  it('固定的页签：去掉 #、空白、无效与重复的标签，保留顺序', () => {
    expect(normalizePinnedTags(['#产品', ' 开发 ', '产品', 'Dev', 'dev', '带 空格', '', 7, 'a'.repeat(41)])).toEqual(['产品', '开发', 'Dev', '7']);
    expect(normalizePinnedTags('产品')).toEqual([]);
    expect(normalizePinnedTags(Array.from({ length: 60 }, (_, index) => `t${index}`))).toHaveLength(50);
  });

  it('应用图标与记录窗口的标签页：无法识别的取值回到默认', () => {
    expect(normalizeSettings({ appIcon: 'stack-smile' }).appIcon).toBe('stack-smile');
    expect(normalizeSettings({ appIcon: 'custom' }).appIcon).toBe('custom');
    expect(normalizeSettings({ appIcon: 'removed-icon' }).appIcon).toBe('door-smile-indigo');
    expect(normalizeSettings({ windowTabs: 'top' }).windowTabs).toBe('top');
    expect(normalizeSettings({ windowTabs: 'left' }).windowTabs).toBe('side');
    expect(normalizeSettings({ scrollOnEdit: false }).scrollOnEdit).toBe(false);
  });

  it('越界数值就近校正', () => {
    expect(normalizeSettings({ width: 100 }).width).toBe(360);
    expect(normalizeSettings({ width: 9999 }).width).toBe(720);
    expect(normalizeSettings({ fontSize: 2 }).fontSize).toBe(8);
    expect(normalizeSettings({ fontSize: 99 }).fontSize).toBe(24);
    expect(normalizeSettings({ fontSize: 12.3 }).fontSize).toBe(12.5);
    expect(normalizeSettings({ fontSize: 'abc' }).fontSize).toBe(12);
    expect(normalizeSettings({ fontSize: null }).fontSize).toBe(12);
    expect(normalizeSettings({ pageSize: 1 }).pageSize).toBe(5);
    expect(normalizeSettings({ pageSize: 500 }).pageSize).toBe(100);
    expect(normalizeSettings({ trashDays: 0 }).trashDays).toBe(1);
    expect(normalizeSettings({ trashDays: 1000 }).trashDays).toBe(365);
    expect(normalizeSettings({ hideDelay: 77 }).hideDelay).toBe(100);
    expect(normalizeSettings({ hideDelay: 99_999 }).hideDelay).toBe(10_000);
    expect(normalizeSettings({ hideDelay: 850 }).hideDelay).toBe(850);
    expect(normalizeSettings({ hideDelay: 'abc' }).hideDelay).toBe(600);
    expect(normalizeSettings({ cardMaxHeight: 50 }).cardMaxHeight).toBe(120);
    expect(normalizeSettings({ cardMaxHeight: 5000 }).cardMaxHeight).toBe(600);
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
    expect(normalizeSettings({ surface: 'unknown' }).surface).toBe('terminal');
    expect(normalizeSettings({ storageLocation: 'cloud' }).storageLocation).toBe('appdata');
    expect(normalizeSettings({ cloud: { provider: 'dropbox' } }).cloud.provider).toBe('synology');
    expect(normalizeSettings({ toastPosition: 'left' }).toastPosition).toBe('top-center');
    expect(normalizeSettings({ toastPosition: 'bottom-center' }).toastPosition).toBe('bottom-center');
    expect(normalizeSettings({ guideSeen: 'yes' }).guideSeen).toBe(false);
    expect(normalizeSettings({ snapshotDirectory: '  D:\\备份  ' }).snapshotDirectory).toBe('D:\\备份');
    expect(normalizeSettings({ snapshotDirectory: 42 }).snapshotDirectory).toBe('42');
    expect(normalizeSettings({ shortcuts: { bold: 'ctrl+shift+b', italic: 'Nope' } }).shortcuts).toEqual({ bold: 'Ctrl+Shift+B' });
  });

  it('保留合法输入', () => {
    const settings = normalizeSettings({
      theme: 'dark',
      surface: 'win11',
      edge: 'left',
      width: 500,
      hideDelay: 1000,
      pinnedTags: ['产品', '开发'],
      lazyLoading: false,
      cloud: { enabled: true, provider: 'onedrive', account: 'a@b.com' },
    });
    expect(settings.theme).toBe('dark');
    expect(settings.surface).toBe('win11');
    expect(settings.edge).toBe('left');
    expect(settings.width).toBe(500);
    expect(settings.hideDelay).toBe(1000);
    expect(settings.pinnedTags).toEqual(['产品', '开发']);
    expect(settings.lazyLoading).toBe(false);
    expect(settings.cloud.enabled).toBe(true);
    expect(settings.cloud.provider).toBe('onedrive');
  });

  it('云端同步：远程文件夹以 / 开头，时间表缺省为每天 3 点，旧版的上次备份与错误丢掉', () => {
    const cloud = normalizeSettings({
      cloud: { folders: { synology: 'backup/Test', google: '/' }, schedule: '  ', lastBackup: 5, lastError: 'x', email: ' a@b.com ', notifications: true },
    }).cloud;
    expect(cloud.folders).toEqual({ synology: '/backup/Test', onedrive: '', google: '' });
    expect(cloud.schedule).toBe(DEFAULT_CLOUD_SCHEDULE);
    expect(cloud.email).toBe('a@b.com');
    expect(cloud.notifications).toBe(true);
    expect(cloud).not.toHaveProperty('lastBackup');
    expect(cloud).not.toHaveProperty('lastError');
    expect(normalizeRemoteFolder('\\Test\\\\备份\\')).toBe('/Test/备份');
    expect(normalizeRemoteFolder('')).toBe('');
    expect(normalizeRemoteFolder('/')).toBe('');
    expect(normalizeSettings({ cloud: { schedule: '*/30 * * * *' } }).cloud.schedule).toBe('*/30 * * * *');
  });

  it('云端同步：没有默认的远程文件夹；0.8.1 的 folder 归当时选中的服务，默认的 /SideNotes 当作没选', () => {
    expect(normalizeSettings({}).cloud.folders).toEqual({ synology: '', onedrive: '', google: '' });
    expect(normalizeSettings({ cloud: { provider: 'onedrive', folder: '/Test' } }).cloud.folders).toEqual({ synology: '', onedrive: '/Test', google: '' });
    expect(normalizeSettings({ cloud: { provider: 'synology', folder: '/SideNotes' } }).cloud.folders.synology).toBe('');
    // 已经按服务分开存的，不再看旧的 folder。
    expect(normalizeSettings({ cloud: { folder: '/Old', folders: { onedrive: '/New' } } }).cloud.folders).toEqual({ synology: '', onedrive: '/New', google: '' });
    expect(normalizeSettings({}).cloud).not.toHaveProperty('folder');
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

  it('字号按 13px 的设计字号换算为界面缩放', () => {
    expect(uiZoom(13)).toBe(1);
    expect(uiZoom(16)).toBeCloseTo(1.2308, 4);
  });

  it('侧栏窗口宽度随字号等比加宽', () => {
    expect(sidebarWindowWidth(416, 13)).toBe(416);
    expect(sidebarWindowWidth(416, 16)).toBe(512);
    expect(sidebarWindowWidth(360, 12)).toBe(332);
  });

  it('字体族：跟随主题不覆盖主题字体，过滤引号与反斜杠', () => {
    expect(resolveFontFamily('')).toBeNull();
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

  it('字节数写成便于阅读的大小', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(3482)).toBe('3.4 KB');
    expect(formatBytes(13_107_200)).toBe('12.5 MB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(-5)).toBe('0 B');
  });
});
