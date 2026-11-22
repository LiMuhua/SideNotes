import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../core/bridge';
import { normalizeSettings } from '../../core/settings';
import type { CloudBackup, CloudOverview, CloudSettings, Settings } from '../../core/types';
import { CloudGroup } from './CloudPanel';

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => toast }));
// 测试环境没有后端：云端的状态与各项操作由各用例指定。
vi.mock('../../core/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/bridge')>()),
  cloudOverview: vi.fn(),
  listCloudBackups: vi.fn(async () => []),
  listCloudFolders: vi.fn(async () => []),
  cloudLogin: vi.fn(),
  submitCloudCode: vi.fn(async () => {}),
  cloudBackupNow: vi.fn(),
  checkCloudSchedule: vi.fn(async () => ({ next: null, error: '' })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// 下拉框展开时把当前项滚进可视范围，jsdom 没有这个方法。
Element.prototype.scrollIntoView ??= () => {};

/** 云端的状态：默认都没连接，OneDrive 与 Google Drive 这个版本能登录。 */
function overview(connected: Partial<Record<'synology' | 'onedrive' | 'google', boolean>> = {}, resendKey = false): CloudOverview {
  const state = (on = false) => ({ connected: on, account: on ? 'a@b.com' : '', error: '', available: true });
  return {
    providers: { synology: state(connected.synology), onedrive: state(connected.onedrive), google: state(connected.google) },
    running: false,
    syncing: '',
    lastSuccess: 0,
    nextRun: null,
    resendKey,
  };
}

describe('云端同步', () => {
  let container: HTMLDivElement;
  let root: Root;
  let settings: Settings;
  let save: ReturnType<typeof vi.fn<(patch: Partial<Settings>) => Promise<boolean>>>;

  /** 按设置画出分组；保存后用新的设置重画，同设置窗口。 */
  async function render(cloud: Partial<CloudSettings> = {}, state = overview()): Promise<void> {
    vi.mocked(bridge.cloudOverview).mockResolvedValue(state);
    settings = normalizeSettings({ cloud });
    // 保存总在点击的 act 里发生，这里直接重画，由外面的 act 刷新（act 里再套 act 会打乱之后的用例）。
    save = vi.fn(async (patch: Partial<Settings>) => {
      settings = { ...settings, ...patch };
      root.render(<CloudGroup settings={settings} save={save} />);
      return true;
    });
    await act(async () => root.render(<CloudGroup settings={settings} save={save} />));
  }

  const query = <T extends Element>(selector: string): T => {
    const node = document.body.querySelector<T>(selector);
    if (!node) throw new Error(`缺少 ${selector}`);
    return node;
  };
  const toggle = (label: string) => query<HTMLInputElement>(`input[aria-label="${label}"]`);
  const button = (label: string) => query<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const dialogTitle = () => document.body.querySelector('[role="dialog"] h3')?.textContent ?? null;
  const notice = () => document.body.querySelector('[data-cloud-notice]')?.textContent ?? null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    toast.mockClear();
    vi.mocked(bridge.cloudLogin).mockReset();
    vi.mocked(bridge.cloudBackupNow).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('频率可以选「自定义」：换成 crontab 输入框，时间表不变', async () => {
    await render({ schedule: '0 3 * * *' });
    const select = button('自动同步的频率');
    expect(select.textContent).toBe('每天');
    await act(async () => select.click());
    const custom = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent === '自定义');
    await act(async () => custom?.click());
    expect(button('自动同步的频率').textContent).toBe('自定义');
    expect(query<HTMLInputElement>('input[aria-label="crontab（分 时 日 月 周）"]').value).toBe('0 3 * * *');
    expect(save).not.toHaveBeenCalled();
  });

  it('没连接时远程文件夹是根目录，文件夹按钮不可用，不给默认的文件夹', async () => {
    await render({ provider: 'synology' });
    expect(query('code[aria-label="远程文件夹"]').textContent).toBe('/');
    expect(button('选择远程文件夹').disabled).toBe(true);
  });

  it('远程文件夹按服务分别存：换到另一个服务时不沿用别的服务的文件夹', async () => {
    await render({ provider: 'onedrive', folders: { synology: '/backup/Test', onedrive: '', google: '' } }, overview({ synology: true, onedrive: true }));
    expect(query('code[aria-label="远程文件夹"]').textContent).toBe('/');
    expect(button('选择远程文件夹').disabled).toBe(false);
  });

  it('没填邮箱与密钥时打开失败通知：开关不打开，弹出通知邮件并写明原因', async () => {
    await render();
    await act(async () => toggle('同步失败时通知').click());
    expect(toggle('同步失败时通知').checked).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('失败通知邮件');
    expect(notice()).toBe('要打开失败通知，先填好收件邮箱与 Resend 密钥。');
  });

  it('填好邮箱与密钥后可以打开失败通知', async () => {
    await render({ email: 'a@b.com' }, overview({}, true));
    await act(async () => toggle('同步失败时通知').click());
    expect(save).toHaveBeenCalledWith({ cloud: expect.objectContaining({ notifications: true }) });
    expect(dialogTitle()).toBeNull();
  });

  it('没连接时打开自动同步：开关不打开，弹出连接弹窗并写明原因', async () => {
    await render({ provider: 'synology' });
    await act(async () => toggle('自动同步').click());
    expect(save).not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('连接群晖 NAS');
    expect(notice()).toBe('要打开自动同步，先连接群晖 NAS。');
  });

  it('连上了但没选远程文件夹时打开自动同步：开关不打开，弹出文件夹的选择框', async () => {
    await render({ provider: 'synology' }, overview({ synology: true }));
    await act(async () => toggle('自动同步').click());
    expect(save).not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('选择远程文件夹');
    expect(notice()).toBe('要打开自动同步，先选远程文件夹。');
  });

  it('没选文件夹时立即同步：先弹出文件夹的选择框，不同步', async () => {
    await render({ provider: 'synology' }, overview({ synology: true }));
    await act(async () => button('立即同步').click());
    expect(bridge.cloudBackupNow).not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('选择远程文件夹');
    expect(notice()).toBe('先选远程文件夹，再同步。');
  });

  it('点「登录」直接在浏览器里登录，不用填客户端；登录后还没选文件夹就弹出选择框', async () => {
    let finish: (account: string) => void = () => {};
    vi.mocked(bridge.cloudLogin).mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
    await render({ provider: 'onedrive' });
    await act(async () => button('登录').click());
    expect(bridge.cloudLogin).toHaveBeenCalledWith('onedrive');
    expect(dialogTitle()).toBe('登录 OneDrive');
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('已在浏览器里打开登录页，登录后自动完成。');
    expect(document.body.querySelector('[role="dialog"] input[type="password"]')).toBeNull();
    await act(async () => finish('me@example.com'));
    expect(dialogTitle()).toBe('选择远程文件夹');
    expect(notice()).toBe('已登录 me@example.com，选一个文件夹存放云端快照。');
  });

  it('浏览器没跳回来时，把地址栏里的网址粘贴进授权码的文本框，回车提交', async () => {
    vi.mocked(bridge.cloudLogin).mockImplementation(() => new Promise<string>(() => {}));
    await render({ provider: 'google' });
    await act(async () => button('登录').click());
    const code = query<HTMLTextAreaElement>('[role="dialog"] textarea');
    expect(code.placeholder).toBe('浏览器没有跳回来时，粘贴地址栏里的网址或授权码');
    expect(document.activeElement).toBe(code);
    const url = 'http://localhost:61234/?state=s1&code=4%2F0AVMB&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(code, `  ${url}  `);
      code.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(bridge.submitCloudCode).toHaveBeenCalledWith(url);
  });

  it('登录不了时把原因写在弹窗里，可以再试', async () => {
    vi.mocked(bridge.cloudLogin).mockRejectedValue(new Error('这个版本还不能登录 Google Drive：构建时没有带上客户端编号'));
    await render({ provider: 'google' });
    await act(async () => button('登录').click());
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('这个版本还不能登录 Google Drive：构建时没有带上客户端编号');
    expect(button('打开登录页')).toBeTruthy();
  });

  it('上面两行对所有服务（自动同步、上次同步与立即同步），卡片在它们下面；快照份数跟在远程文件夹后面', async () => {
    const backup = { id: '1', createdAt: 1, reason: 'manual', dataDirectory: '', noteCount: 3, attachments: [], missing: [], size: 10 } as unknown as CloudBackup;
    vi.mocked(bridge.listCloudBackups).mockResolvedValueOnce([backup]);
    await render({ provider: 'google', folders: { synology: '', onedrive: '', google: '/Test' } }, overview({ google: true }));
    const group = query('.cloud-group');
    const cards = query('.sync-provider-grid');
    const before = (node: Element) => Boolean(node.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(toggle('自动同步'))).toBe(true);
    expect(before(button('立即同步'))).toBe(true);
    expect(before(query('code[aria-label="远程文件夹"]'))).toBe(false);
    // 立即同步紧跟在上次同步的时间后面，同在一行里。
    expect(button('立即同步').closest('.settings-row')?.textContent).toContain('上次同步');
    const row = query('[data-cloud-snapshots]').closest('.cloud-field-grid');
    expect(row?.textContent).toContain('远程文件夹');
    expect(query('[data-cloud-snapshots]').textContent).toBe('1 份');
    // 列快照时指明服务，不靠后端读设置里选中的那个（刚换卡片时可能还没存好）。
    expect(bridge.listCloudBackups).toHaveBeenCalledWith('google');
    expect(group.textContent).not.toContain('云端快照');
  });

  it('连着几个服务时立即同步发往所有服务：选中的没连接也照样同步，提示写明同步到了哪些服务', async () => {
    vi.mocked(bridge.cloudBackupNow).mockResolvedValue([
      { provider: 'onedrive', noteCount: 167, error: '' },
      { provider: 'google', noteCount: 167, error: '' },
    ]);
    await render({ provider: 'synology', folders: { synology: '', onedrive: '/Test', google: '/Test' } }, overview({ onedrive: true, google: true }));
    await act(async () => button('立即同步').click());
    expect(bridge.cloudBackupNow).toHaveBeenCalledTimes(1);
    expect(dialogTitle()).toBeNull();
    expect(toast).toHaveBeenCalledWith('已同步 167 条记录到 OneDrive、Google Drive', null, false);
  });

  it('一家失败不影响别家：提示哪家同步了、哪家没有与原因', async () => {
    vi.mocked(bridge.cloudBackupNow).mockResolvedValue([
      { provider: 'onedrive', noteCount: 167, error: '' },
      { provider: 'google', noteCount: 0, error: '网络不通：连接超时' },
    ]);
    await render({ provider: 'google', folders: { synology: '', onedrive: '/Test', google: '/Test' } }, overview({ onedrive: true, google: true }));
    await act(async () => button('立即同步').click());
    expect(toast).toHaveBeenCalledWith('已同步到 OneDrive；Google Drive 没有同步：网络不通：连接超时', null, true);
  });

  it('一个服务都没连上时立即同步：弹出选中服务的连接弹窗并写明原因', async () => {
    await render({ provider: 'synology' });
    await act(async () => button('立即同步').click());
    expect(bridge.cloudBackupNow).not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('连接群晖 NAS');
    expect(notice()).toBe('先连接群晖 NAS，再同步。');
  });

  it('别的服务连着时，选中的没连接也能打开自动同步', async () => {
    await render({ provider: 'synology', folders: { synology: '', onedrive: '/Test', google: '' } }, overview({ onedrive: true }));
    await act(async () => toggle('自动同步').click());
    expect(save).toHaveBeenCalledWith({ cloud: expect.objectContaining({ enabled: true }) });
    expect(dialogTitle()).toBeNull();
  });

  it('退出其中一个服务时，还有别的服务可同步，自动同步不关', async () => {
    vi.spyOn(bridge, 'cloudDisconnect').mockResolvedValue();
    await render({ provider: 'onedrive', enabled: true, folders: { synology: '', onedrive: '/Test', google: '/Test' } }, overview({ onedrive: true, google: true }));
    await act(async () => button('退出登录').click());
    expect(bridge.cloudDisconnect).toHaveBeenCalledWith('onedrive');
    expect(save).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('已退出登录；云端的快照还在');
  });

  it('断开最后一个能同步的服务时自动同步一并关掉', async () => {
    vi.spyOn(bridge, 'cloudDisconnect').mockResolvedValue();
    await render({ provider: 'synology', enabled: true, folders: { synology: '/backup/Test', onedrive: '', google: '' } }, overview({ synology: true }));
    await act(async () => button('断开连接').click());
    expect(bridge.cloudDisconnect).toHaveBeenCalledWith('synology');
    expect(save).toHaveBeenCalledWith({ cloud: expect.objectContaining({ enabled: false }) });
    expect(toast).toHaveBeenCalledWith('已断开群晖 NAS，自动同步已关闭；云端的快照还在');
  });
});
