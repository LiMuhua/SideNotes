/**
 * 设置 → 数据与同步 → 云端同步（第十一轮反馈，技术决策第 63 条）。原名「云端备份」：之后的跨设备自动同步也用这个模块，
 * 现在做的是把记录备份到云端、从云端恢复，所以各项操作仍叫「备份」。
 *
 * 服务卡片在上（卡片角上的点是连接状态，异常为红色、悬停看原因），下面一行放两项、放不下时折行（同「数据目录」）：
 * 账户与远程文件夹、自动备份与失败通知，最后是已有备份（立即备份，列表里逐份恢复）。
 * 群晖 NAS 在弹窗里填地址、用户名与密码后连接，证书上的名字与地址对不上时问用户是否按证书上的名字验证；
 * OneDrive 与 Google Drive 在弹窗里点「打开登录页」，浏览器登录后自动回填授权码，没跳回来时可以把授权码粘贴回来。
 * 自动备份用「频率 + 时间」选，也可以选自定义直接写 crontab。凭据与运行状态都在后端（cloud 模块），这里只存设置里的配置。
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as bridge from '../../core/bridge';
import * as store from '../../core/store';
import { formatBytes } from '../../core/files';
import { DEFAULT_CLOUD_SCHEDULE, normalizeRemoteFolder } from '../../core/settings';
import { snapshotTime } from '../../core/snapshots';
import { MONTH_DAYS, SCHEDULE_KINDS, WEEKDAYS, buildSchedule, formatTime, parseSchedule, parseTime, type ScheduleKind } from '../../core/schedule';
import type { CloudBackup, CloudOverview, CloudProvider, CloudProviderState, CloudSettings, Settings, WebDavOutcome } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { Floating } from '../Floating';
import { Icon } from '../Icon';
import { useConfirm } from './confirm';
import { ActionButton, DataRow, Group, SelectField, Toggle, TextField, classes, type SaveSettings } from './controls';
import { PathText } from './PathText';

/** 备份服务：名称与连接方式。OneDrive 排在 Google Drive 之前（第十轮反馈 3）。 */
const PROVIDERS: ReadonlyArray<readonly [CloudProvider, string, string]> = [
  ['synology', '群晖 NAS', 'WebDAV'],
  ['onedrive', 'OneDrive', 'Microsoft 账户'],
  ['google', 'Google Drive', 'Google 账户'],
];

/** 各备份服务的品牌标识，图形取自原型。内容为固定常量，不含外部输入。 */
const PROVIDER_MARKS: Record<CloudProvider, { viewBox: string; paths: string }> = {
  synology: {
    viewBox: '0 0 24 24',
    paths:
      '<path fill="#4468ff" d="M3 4h10.2L21 8.8v4.1L11 8H3z"/><path fill="#1e3f9e" d="M21 20H10.8L3 15.2v-4.1l10 4.9h8z"/><path fill="#8097ff" d="M3 8h8l8 4.8H11z"/>',
  },
  google: {
    viewBox: '0 0 87.3 78',
    paths:
      '<path fill="#0066da" d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.3 9.3 0 000 53h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"/><path fill="#00832d" d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/><path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/><path fill="#ffba00" d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"/>',
  },
  onedrive: {
    viewBox: '0 0 24 24',
    paths:
      '<defs><linearGradient id="onedrive-mark-gradient" x1="4" y1="19" x2="20" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#0364b8"/><stop offset="1" stop-color="#28a8ea"/></linearGradient></defs><path fill="url(#onedrive-mark-gradient)" d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/><path fill="#fff" fill-opacity=".24" d="M7.1 16.6h10.3c1.45 0 2.6-1.08 2.6-2.45 0-1.3-1.06-2.37-2.39-2.44a3.73 3.73 0 00-7.12-1.48 3.03 3.03 0 00-3.39 3.02c0 1.53 1.23 2.75 2.78 2.75z"/>',
  },
};

/** 云端备份的创建原因。 */
const BACKUP_REASONS: Record<string, string> = { auto: '自动', manual: '手动' };

function ProviderMark({ provider }: { provider: CloudProvider }) {
  const mark = PROVIDER_MARKS[provider];
  return (
    <svg
      className="sync-provider-mark"
      aria-hidden="true"
      focusable="false"
      viewBox={mark.viewBox}
      dangerouslySetInnerHTML={{ __html: mark.paths }}
    />
  );
}

/**
 * 服务卡片角上的点：连接正常是绿色，正在备份是强调色，异常是红色（悬停显示原因）；没有连接过的不画。
 */
function StatusDot({ state, running }: { state: CloudProviderState | undefined; running: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const id = `cloud-status-${useId()}`;
  if (!state || (!state.connected && !state.error && !running)) return null;
  const tone = running ? 'is-running' : state.error ? 'is-error' : 'is-ok';
  return (
    <>
      <span
        ref={anchor}
        className={classes('sync-provider-dot', tone)}
        data-cloud-dot={tone}
        aria-hidden="true"
        onMouseEnter={() => setShown(Boolean(state.error) && !running)}
        onMouseLeave={() => setShown(false)}
      />
      {state.error ? (
        <Floating anchor={anchor} open={shown} options={{ placement: 'bottom-end' }} id={id} role="tooltip" className="settings-help-text settings-floating">
          {state.error}
        </Floating>
      ) : null}
    </>
  );
}

/** 网址里的主机名与端口。 */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/**
 * 叠在设置窗口上的弹窗：与回收站确认、调整应用图标同一层（settings-confirm-backdrop）。
 * Esc 与点背景关闭（忙的时候不关）；焦点在弹窗里循环。
 */
function DialogLayer({
  title,
  busy,
  className,
  onClose,
  children,
  footer,
}: {
  title: string;
  busy?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const headingId = `cloud-dialog-${useId()}`;
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, .cloud-folder-item, .button.primary')?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    event.stopPropagation();
    const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button, input, [tabindex]')).filter(
      (node) => !(node as HTMLButtonElement).disabled && node.tabIndex >= 0 && node.getClientRects().length > 0,
    );
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const host = document.querySelector('.settings-modal')?.parentElement ?? document.body;
  return createPortal(
    <div
      className="settings-confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <section ref={dialog} className={classes('settings-confirm-dialog cloud-dialog', className)} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="settings-confirm-header">
          <h3 id={headingId}>{title}</h3>
          <ActionButton label="关闭" icon="x" className="icon-button" disabled={busy} onClick={onClose} />
        </header>
        {children}
        <footer className="settings-confirm-actions">{footer}</footer>
      </section>
    </div>,
    host,
  );
}

/** 弹窗里的一行：名称与输入框。 */
function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cloud-form-row">
      <span className="cloud-form-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * 连接群晖 NAS：地址、用户名与密码；连接成功才关闭，密码由后端加密存在本机。
 * 证书上的名字与地址对不上（NAS 用 IP 访问、证书是给域名的）时，列出证书上的名字与指纹，用户确认后按证书上的名字验证。
 */
function WebDavDialog({
  cloud,
  onClose,
  onConnected,
}: {
  cloud: CloudSettings;
  onClose: () => void;
  onConnected: (endpoint: string, username: string, tlsName: string) => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState(cloud.endpoint);
  const [username, setUsername] = useState(cloud.account);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mismatch, setMismatch] = useState<Extract<WebDavOutcome, { status: 'certificate' }> | null>(null);

  const connect = async (tlsName: string): Promise<void> => {
    if (!endpoint.trim() || !username.trim() || !password) {
      setError('请填写地址、用户名与密码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const address = endpoint.trim().replace(/\/+$/, '');
      const outcome = await bridge.connectWebDav(address, username.trim(), password, tlsName);
      if (outcome.status === 'certificate') {
        setMismatch(outcome);
        setBusy(false);
        return;
      }
      await onConnected(address, outcome.account, tlsName);
      onClose();
    } catch (problem) {
      setError(bridge.errorText(problem, '没能连接'));
      setBusy(false);
    }
  };

  // 同一个地址重新连接时沿用之前确认过的名字。
  const remembered = endpoint.trim().replace(/\/+$/, '') === cloud.endpoint ? cloud.tlsName : '';
  const edit = (change: () => void): void => {
    change();
    setMismatch(null);
  };

  return (
    <DialogLayer
      title="连接群晖 NAS"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ActionButton label="取消" disabled={busy} onClick={onClose} />
          {mismatch ? (
            <ActionButton
              label={busy ? '正在连接…' : `按 ${mismatch.suggested} 验证并连接`}
              icon="lock"
              className="button primary compact"
              disabled={busy}
              onClick={() => void connect(mismatch.suggested)}
            />
          ) : (
            <ActionButton label={busy ? '正在连接…' : '连接'} icon="link" className="button primary compact" disabled={busy} onClick={() => void connect(remembered)} />
          )}
        </>
      }
    >
      <form
        className="cloud-form"
        onSubmit={(event) => {
          event.preventDefault();
          void connect(mismatch ? mismatch.suggested : remembered);
        }}
      >
        <FormField label="地址">
          <input
            className="form-control"
            type="url"
            value={endpoint}
            placeholder="https://nas.example.com:5006"
            autoComplete="url"
            onChange={(event) => edit(() => setEndpoint(event.target.value))}
          />
        </FormField>
        <FormField label="用户名">
          <input className="form-control" type="text" value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
        </FormField>
        <FormField label="密码">
          <input className="form-control" type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
        </FormField>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {mismatch ? (
        <div className="cloud-certificate" role="status">
          <p>{`证书是给 ${mismatch.names.join('、')} 的，与地址 ${hostOf(endpoint)} 对不上。确认这台 NAS 是你的，就按 ${mismatch.suggested} 验证证书，证书续期后仍然有效。`}</p>
          <code aria-label="证书的 SHA-256 指纹">{mismatch.fingerprint}</code>
        </div>
      ) : null}
      <p className="settings-confirm-error" role="alert" hidden={!error}>
        {error}
      </p>
    </DialogLayer>
  );
}

/** 失败通知的邮件：收件邮箱、发件地址（可空）与 Resend 的 API 密钥；可以先发一封测试邮件。 */
function EmailDialog({
  cloud,
  hasKey,
  onClose,
  onSave,
}: {
  cloud: CloudSettings;
  hasKey: boolean;
  onClose: () => void;
  onSave: (email: string, from: string, key: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const [email, setEmail] = useState(cloud.email);
  const [from, setFrom] = useState(cloud.emailFrom);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState('');
  const validEmail = (value: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

  const check = (): boolean => {
    if (email.trim() && !validEmail(email.trim())) {
      setError('收件邮箱的写法不对');
      return false;
    }
    if (from.trim() && !validEmail(from.trim())) {
      setError('发件地址的写法不对');
      return false;
    }
    if (email.trim() && !hasKey && !key.trim()) {
      setError('要发邮件，请填写 Resend 的 API 密钥');
      return false;
    }
    setError('');
    return true;
  };

  const test = async (): Promise<void> => {
    if (!email.trim()) {
      setError('请先填写收件邮箱');
      return;
    }
    if (!check()) return;
    setBusy('test');
    try {
      await bridge.sendTestEmail(email.trim(), from.trim(), key.trim());
      toast(`测试邮件已发到 ${email.trim()}`);
    } catch (problem) {
      setError(bridge.errorText(problem, '测试邮件没有发出'));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (!check()) return;
    setBusy('save');
    if (await onSave(email.trim(), from.trim(), key.trim())) {
      onClose();
      return;
    }
    setBusy(null);
  };

  return (
    <DialogLayer
      title="失败通知邮件"
      busy={busy !== null}
      onClose={onClose}
      footer={
        <>
          <ActionButton label={busy === 'test' ? '正在发送…' : '发送测试邮件'} icon="mail" disabled={busy !== null} onClick={() => void test()} />
          <span className="cloud-dialog-spacer" />
          <ActionButton label="取消" disabled={busy !== null} onClick={onClose} />
          <ActionButton label="保存" icon="check" className="button primary compact" disabled={busy !== null} onClick={() => void save()} />
        </>
      }
    >
      <form
        className="cloud-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField label="收件邮箱">
          <input className="form-control" type="email" value={email} placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
        </FormField>
        <FormField label="发件地址">
          <input className="form-control" type="email" value={from} placeholder="onboarding@resend.dev" onChange={(event) => setFrom(event.target.value)} />
        </FormField>
        <FormField label="Resend 密钥">
          <input
            className="form-control"
            type="password"
            value={key}
            placeholder={hasKey ? '已保存，不换就留空' : 're_…'}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
          />
        </FormField>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      <p className="settings-confirm-error" role="alert" hidden={!error}>
        {error}
      </p>
    </DialogLayer>
  );
}

/** 远程文件夹的选择框：逐层进入子文件夹，可以新建；根目录不能选。 */
function FolderDialog({ start, onClose, onChoose }: { start: string; onClose: () => void; onChoose: (path: string) => Promise<boolean> }) {
  const [path, setPath] = useState(start);
  // 读到的一层：记下是哪个路径的，换了路径之后、新的结果回来之前显示「正在读取」。
  const [listing, setListing] = useState<{ path: string; folders: string[]; error: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const folders = listing?.path === path ? listing.folders : null;
  const error = actionError || (listing?.path === path ? listing.error : '');

  useEffect(() => {
    let alive = true;
    const initial = first.current;
    first.current = false;
    bridge.listCloudFolders(path).then(
      (list) => {
        if (alive) setListing({ path, folders: list, error: '' });
      },
      (problem: unknown) => {
        if (!alive) return;
        // 设置里的文件夹还没建出来：从根目录开始选。
        if (initial && path !== '/') {
          setPath('/');
          return;
        }
        setListing({ path, folders: [], error: bridge.errorText(problem, '读不出这个文件夹') });
      },
    );
    return () => {
      alive = false;
    };
  }, [path]);

  const go = (next: string): void => {
    setActionError('');
    setPath(next);
  };

  const parent = path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await bridge.createCloudFolder(path, name.trim());
      setName('');
      go(created);
    } catch (problem) {
      setActionError(bridge.errorText(problem, '没能新建文件夹'));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (): Promise<void> => {
    setBusy(true);
    if (await onChoose(path)) {
      onClose();
      return;
    }
    setBusy(false);
  };

  return (
    <DialogLayer
      title="选择远程文件夹"
      busy={busy}
      className="cloud-folder-dialog"
      onClose={onClose}
      footer={
        <>
          <ActionButton label="取消" disabled={busy} onClick={onClose} />
          <ActionButton label="选择这里" icon="check" className="button primary compact" disabled={busy || path === '/'} onClick={() => void choose()} />
        </>
      }
    >
      <div className="cloud-folder-path">
        <ActionButton label="上一级" icon="arrow-up" className="icon-button" disabled={!parent || busy} onClick={() => parent && go(parent)} />
        <code className="settings-path" aria-label="当前位置">
          {path}
        </code>
      </div>
      <ul className="cloud-folder-list" aria-label="子文件夹" aria-busy={folders === null}>
        {folders === null ? <li className="cloud-folder-empty">正在读取…</li> : null}
        {folders?.length === 0 && !error ? <li className="cloud-folder-empty">这里没有文件夹</li> : null}
        {folders?.map((folder) => (
          <li key={folder}>
            <button type="button" className="cloud-folder-item" disabled={busy} onClick={() => go(path === '/' ? `/${folder}` : `${path}/${folder}`)}>
              <Icon name="folder" />
              <span>{folder}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="cloud-folder-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <input className="form-control" type="text" value={name} placeholder="新文件夹的名字" aria-label="新文件夹的名字" onChange={(event) => setName(event.target.value)} />
        <ActionButton label="新建文件夹" icon="plus" disabled={busy || !name.trim()} onClick={() => void create()} />
      </form>
      <p className="settings-confirm-error" role="alert" hidden={!error}>
        {error}
      </p>
    </DialogLayer>
  );
}

/**
 * 登录 OneDrive 或 Google Drive：点「打开登录页」在浏览器里登录，回调到本机后自动回填授权码；浏览器没能跳回来时，
 * 把地址栏里的网址或授权码粘贴到这里（同 Koodo Reader 的做法）。构建时没有写进客户端编号时，先填应用（客户端）ID。
 */
function LoginDialog({
  provider,
  state,
  onClose,
  onLoggedIn,
}: {
  provider: Exclude<CloudProvider, 'synology'>;
  state: CloudProviderState | undefined;
  onClose: () => void;
  onLoggedIn: (account: string) => void;
}) {
  const name = provider === 'onedrive' ? 'OneDrive' : 'Google Drive';
  const needsClient = !state?.builtin;
  const [clientId, setClientId] = useState(state?.client ?? '');
  const [secret, setSecret] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const start = async (): Promise<void> => {
    if (needsClient && !clientId.trim()) {
      setError('请填写应用（客户端）ID');
      return;
    }
    setWaiting(true);
    setError('');
    try {
      const account = await bridge.cloudLogin(provider, clientId.trim(), secret.trim());
      onLoggedIn(account);
      onClose();
    } catch (problem) {
      setWaiting(false);
      const text = bridge.errorText(problem, '登录没有完成');
      if (text !== '已取消登录') setError(text);
    }
  };

  const submit = (): void => {
    if (!code.trim()) return;
    void bridge.submitCloudCode(code.trim());
    setCode('');
  };

  const close = (): void => {
    if (waiting) void bridge.cancelCloudLogin();
    onClose();
  };

  return (
    <DialogLayer
      title={`登录 ${name}`}
      onClose={close}
      footer={
        waiting ? (
          <>
            <ActionButton label="取消登录" onClick={close} />
            <ActionButton label="确定" icon="check" className="button primary compact" disabled={!code.trim()} onClick={submit} />
          </>
        ) : (
          <>
            <ActionButton label="取消" onClick={close} />
            <ActionButton label="打开登录页" icon="external" className="button primary compact" onClick={() => void start()} />
          </>
        )
      }
    >
      {needsClient ? (
        <form
          className="cloud-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!waiting) void start();
          }}
        >
          <FormField label="应用（客户端）ID">
            <input className="form-control" type="text" value={clientId} disabled={waiting} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
          </FormField>
          {provider === 'google' ? (
            <FormField label="客户端密钥">
              <input
                className="form-control"
                type="password"
                value={secret}
                disabled={waiting}
                placeholder={state?.client ? '已保存，不换就留空' : ''}
                autoComplete="off"
                onChange={(event) => setSecret(event.target.value)}
              />
            </FormField>
          ) : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      ) : null}
      {waiting ? (
        <>
          <p className="cloud-dialog-note">已在浏览器里打开登录页，登录后自动完成。</p>
          <form
            className="cloud-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <FormField label="授权码">
              <input
                className="form-control"
                type="text"
                value={code}
                placeholder="浏览器没有跳回来时，粘贴地址栏里的网址或授权码"
                autoComplete="off"
                onChange={(event) => setCode(event.target.value)}
              />
            </FormField>
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </>
      ) : null}
      <p className="settings-confirm-error" role="alert" hidden={!error}>
        {error}
      </p>
    </DialogLayer>
  );
}

/** 自动备份的时间：频率加时间，或自定义 crontab；改了就保存（onSave 检查写法并返回是否保存）。 */
function ScheduleField({ value, onSave }: { value: string; onSave: (cron: string) => Promise<boolean> }) {
  const toast = useToast();
  const form = parseSchedule(value);
  const changeKind = (kind: ScheduleKind): void => {
    // 换到自定义时从现在的写法改起；从自定义换回来时用默认的 03:00、星期一、1 号。
    void onSave(kind === 'custom' ? buildSchedule(form) || value : buildSchedule({ ...form, kind }));
  };
  return (
    <>
      <SelectField label="自动备份的频率" options={SCHEDULE_KINDS} value={form.kind} onChange={(kind) => changeKind(kind as ScheduleKind)} />
      {form.kind === 'weekly' ? (
        <SelectField label="星期几" options={WEEKDAYS} value={form.weekday} onChange={(weekday) => void onSave(buildSchedule({ ...form, weekday: Number(weekday) }))} />
      ) : null}
      {form.kind === 'monthly' ? (
        <SelectField label="每月的哪一天" options={MONTH_DAYS} value={form.day} onChange={(day) => void onSave(buildSchedule({ ...form, day: Number(day) }))} />
      ) : null}
      {form.kind === 'custom' ? (
        <span className="cloud-cron">
          <TextField label="crontab（分 时 日 月 周）" value={form.cron} placeholder={DEFAULT_CLOUD_SCHEDULE} onCommit={onSave} />
        </span>
      ) : form.kind !== 'hourly' ? (
        <span className="cloud-time">
          <TextField
            label="时间"
            value={formatTime(form.hour, form.minute)}
            placeholder="03:00"
            onCommit={(text) => {
              const time = parseTime(text);
              if (!time) {
                toast('时间写成 03:00 这样', null, true);
                return false;
              }
              return onSave(buildSchedule({ ...form, ...time }));
            }}
          />
        </span>
      ) : null}
    </>
  );
}

/** 云端同步分组。 */
export function CloudGroup({ settings, save }: { settings: Settings; save: SaveSettings }) {
  const toast = useToast();
  const confirm = useConfirm();
  const cloud = settings.cloud;
  const [overview, setOverview] = useState<CloudOverview | null>(null);
  // 读到的备份列表：记下是哪个服务、文件夹与哪次备份之后读的，条件变了之后、新的结果回来之前不显示。
  const [listing, setListing] = useState<{ key: string; backups: CloudBackup[]; problem: string } | null>(null);
  const [busy, setBusy] = useState<'backup' | 'disconnect' | null>(null);
  const [dialog, setDialog] = useState<'webdav' | 'login' | 'email' | 'folder' | null>(null);
  // 后端广播状态变化、或这里做了操作之后重新读取。
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => bridge.subscribeAll([bridge.onAppEvent(bridge.APP_EVENTS.cloudStatus, refresh)]), [refresh]);

  useEffect(() => {
    let alive = true;
    void bridge
      .cloudOverview()
      .then((next) => {
        if (alive) setOverview(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [revision]);

  const current = overview?.providers[cloud.provider];
  const connected = Boolean(current?.connected);
  const running = Boolean(overview?.running) || busy === 'backup';

  // 已有备份：连上了才读；换了服务、远程文件夹或又备份了一次之后重读。
  const listKey = `${cloud.provider}|${cloud.folder}|${overview?.lastSuccess ?? 0}|${revision}`;
  const backups = connected && listing?.key === listKey ? listing.backups : null;
  const listProblem = connected && listing?.key === listKey ? listing.problem : '';
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    bridge.listCloudBackups().then(
      (list) => {
        if (alive) setListing({ key: listKey, backups: list, problem: '' });
      },
      (problem: unknown) => {
        if (alive) setListing({ key: listKey, backups: [], problem: bridge.errorText(problem, '读不出云端的备份') });
      },
    );
    return () => {
      alive = false;
    };
  }, [connected, listKey]);

  const saveCloud = (patch: Partial<CloudSettings>): Promise<boolean> => save({ cloud: { ...settings.cloud, ...patch } });

  const disconnect = async (): Promise<void> => {
    setBusy('disconnect');
    try {
      await bridge.cloudDisconnect(cloud.provider);
      toast(cloud.provider === 'synology' ? '已断开群晖 NAS；云端的备份还在' : '已退出登录；云端的备份还在');
    } catch (problem) {
      toast(bridge.errorText(problem, '没能断开'), null, true);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const commitSchedule = async (value: string): Promise<boolean> => {
    const schedule = value.trim() || DEFAULT_CLOUD_SCHEDULE;
    const check = await bridge.checkCloudSchedule(schedule);
    if (check.error) {
      toast(`时间的写法不对：${check.error}`, null, true);
      return false;
    }
    const saved = await saveCloud({ schedule });
    refresh();
    return saved;
  };

  const switchAuto = async (enabled: boolean): Promise<void> => {
    await saveCloud({ enabled });
    refresh();
  };

  /** 打开失败通知时顺带申请系统通知的权限；没允许也照样打开（邮件不受影响）。 */
  const switchNotifications = async (enabled: boolean): Promise<void> => {
    if (enabled) await bridge.requestNotifications().catch(() => false);
    await saveCloud({ notifications: enabled });
  };

  const saveEmail = async (email: string, from: string, key: string): Promise<boolean> => {
    try {
      if (key) await bridge.setResendKey(key);
    } catch (problem) {
      toast(`密钥没有保存：${bridge.errorText(problem)}`, null, true);
      return false;
    }
    const saved = await saveCloud({ email, emailFrom: from });
    refresh();
    return saved;
  };

  const backupNow = async (): Promise<void> => {
    setBusy('backup');
    try {
      const backup = await bridge.cloudBackupNow();
      toast(`已备份 ${backup.noteCount} 条记录`);
    } catch (problem) {
      toast(`备份没有完成：${bridge.errorText(problem)}`, null, true);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const restore = (backup: CloudBackup): void => {
    const when = snapshotTime(backup.createdAt);
    confirm({
      title: '从云端恢复',
      message: `将用${when} 的云端备份（${backup.noteCount} 条记录）替换当前全部记录，包括回收站。恢复前会先为当前数据在本机创建一份快照，可以随时换回；设置与草稿保持不变。`,
      confirmLabel: '恢复',
      icon: 'restore',
      run: async () => {
        try {
          const report = await bridge.cloudRestore(backup.id, settings.snapshotDirectory);
          await store.reloadEverywhere();
          toast(
            report.missingAttachments
              ? `已恢复到${when} 的云端备份；${report.missingAttachments} 个附件在云端也找不到`
              : `已恢复到${when} 的云端备份`,
          );
          return true;
        } catch (problem) {
          toast(`恢复未完成：${bridge.errorText(problem)}；当前记录未改动`, null, true);
          return false;
        }
      },
    });
  };

  // 已有备份一行的取值：份数、上次成功与下次自动备份。
  const summary = [
    connected && backups ? `${backups.length} 份` : '',
    overview?.lastSuccess && overview.lastProvider === cloud.provider ? `上次 ${snapshotTime(overview.lastSuccess)}` : '',
    cloud.enabled && overview?.nextRun ? `下次 ${snapshotTime(overview.nextRun)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const account = (): ReactNode => {
    if (cloud.provider === 'synology') {
      if (connected) {
        return (
          <>
            <span className="settings-value cloud-account" data-cloud-account="">{`${cloud.account} · ${hostOf(cloud.endpoint)}`}</span>
            <ActionButton label="断开连接" icon="cloud-off" disabled={busy !== null} onClick={() => void disconnect()} />
          </>
        );
      }
      return <ActionButton label="连接" icon="link" onClick={() => setDialog('webdav')} />;
    }
    if (connected) {
      return (
        <>
          <span className="settings-value cloud-account" data-cloud-account="">{current?.account}</span>
          <ActionButton label="退出登录" icon="cloud-off" disabled={busy !== null} onClick={() => void disconnect()} />
        </>
      );
    }
    return <ActionButton label="登录" icon="external" disabled={busy !== null} onClick={() => setDialog('login')} />;
  };

  return (
    <Group title="云端同步" className="settings-wide cloud-group">
      <div className="sync-provider-grid" role="group" aria-label="备份服务">
        {PROVIDERS.map(([provider, name, protocol]) => {
          const active = cloud.provider === provider;
          const state = overview?.providers[provider];
          const status = state?.error ? `，连接异常：${state.error}` : state?.connected ? '，已连接' : '';
          return (
            <button
              key={provider}
              type="button"
              className={classes('sync-provider', active && 'active selected')}
              data-provider={provider}
              aria-label={`${name}，${protocol}${status}`}
              aria-pressed={active}
              onClick={() => void saveCloud({ provider })}
            >
              <ProviderMark provider={provider} />
              <span className="sync-provider-name">{name}</span>
              <small>{protocol}</small>
              <StatusDot state={state} running={running && active} />
            </button>
          );
        })}
      </div>
      {listProblem ? <p className="settings-notice is-error">{`云端的备份读取失败：${listProblem}`}</p> : null}
      <div className="settings-field-grid cloud-field-grid">
        <DataRow title="账户">{account()}</DataRow>
        <DataRow title="远程文件夹">
          <PathText label="远程文件夹" path={cloud.folder} />
          <ActionButton label="选择远程文件夹" icon="folder" className="icon-button" disabled={!connected} onClick={() => setDialog('folder')} />
        </DataRow>
      </div>
      <div className="settings-field-grid cloud-field-grid">
        <DataRow title="自动备份">
          <Toggle label="自动备份" checked={cloud.enabled} onChange={(enabled) => void switchAuto(enabled)} />
          <ScheduleField value={cloud.schedule} onSave={commitSchedule} />
        </DataRow>
        <DataRow title="失败通知">
          <Toggle label="备份失败时通知" checked={cloud.notifications} onChange={(enabled) => void switchNotifications(enabled)} />
          <ActionButton label="失败通知邮件" onClick={() => setDialog('email')}>
            <Icon name="mail" />
            {cloud.email || '通知邮件'}
          </ActionButton>
        </DataRow>
      </div>
      <DataRow title="已有备份">
        {summary ? <span className="settings-value">{summary}</span> : null}
        <ActionButton
          label={running ? '正在备份…' : '立即备份'}
          icon="upload"
          disabled={!connected || running || busy !== null}
          onClick={() => void backupNow()}
        />
      </DataRow>
      {connected && backups?.length ? (
        <ul className="snapshot-list cloud-backup-list" aria-label="云端备份列表">
          {backups.map((backup) => (
            <li key={backup.id} className="snapshot-item">
              <span className="snapshot-time">{snapshotTime(backup.createdAt)}</span>
              <span className="snapshot-reason">{BACKUP_REASONS[backup.reason] ?? backup.reason}</span>
              <span className="snapshot-meta">{`${backup.noteCount} 条 · ${formatBytes(backup.size)}`}</span>
              <button type="button" className="button secondary compact" disabled={running} onClick={() => restore(backup)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {dialog === 'webdav' ? (
        <WebDavDialog
          cloud={cloud}
          onClose={() => setDialog(null)}
          onConnected={async (endpoint, username, tlsName) => {
            await saveCloud({ endpoint, account: username, tlsName });
            toast(`已连接 ${hostOf(endpoint)}`);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'login' && cloud.provider !== 'synology' ? (
        <LoginDialog
          provider={cloud.provider}
          state={current}
          onClose={() => setDialog(null)}
          onLoggedIn={(name) => {
            toast(`已登录 ${name}`);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'email' ? (
        <EmailDialog cloud={cloud} hasKey={Boolean(overview?.resendKey)} onClose={() => setDialog(null)} onSave={saveEmail} />
      ) : null}
      {dialog === 'folder' ? (
        <FolderDialog
          start={cloud.folder}
          onClose={() => setDialog(null)}
          onChoose={async (path) => {
            const saved = await saveCloud({ folder: normalizeRemoteFolder(path) });
            if (saved) toast(`之后备份到 ${path}`);
            return saved;
          }}
        />
      ) : null}
    </Group>
  );
}
