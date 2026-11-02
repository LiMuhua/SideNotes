/**
 * 数据与同步。
 *
 * 结构对应原型 settings.js 的 renderData：导入与导出、数据目录、云端自动备份三张卡。
 * 导入导出、打开目录与更换存储位置（复制数据并改写附件路径）在桌面端真实可用；
 * 云端备份尚未接入，界面只保存配置并明确说明，不把未实现的能力表现为已完成。
 */

import { useEffect, useState } from 'react';
import * as bridge from '../../core/bridge';
import * as store from '../../core/store';
import { normalizeDraft, normalizeNote } from '../../core/notes';
import type { CloudProvider, CloudSettings, Draft, Note, Settings, StorageInfo, StorageLocation } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from './confirm';
import { ActionButton, Group, Help, Row, SelectField, TextField, Toggle, classes, type SaveSettings } from './controls';

const LOCATIONS: ReadonlyArray<readonly [StorageLocation, string]> = [
  ['appdata', '应用数据目录（AppData）'],
  ['portable', '安装目录（便携模式）'],
  ['custom', '自定义目录'],
];

const PROVIDERS: ReadonlyArray<readonly [CloudProvider, string, string]> = [
  ['synology', '群晖 NAS', 'WebDAV'],
  ['google', 'Google Drive', 'OAuth'],
  ['onedrive', 'OneDrive', 'Microsoft'],
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

/** 取出错误说明，供提示条使用。 */
function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : typeof error === 'string' ? error : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

/** 解析备份文件，与原型 inspectImport 的校验规则一致。 */
function parseBackup(text: string): { notes: Note[]; draft: Draft | null } {
  const parsed: unknown = JSON.parse(text);
  const rawNotes = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.notes : null;
  if (!Array.isArray(rawNotes) || rawNotes.length > 10000) throw new Error('未找到有效的记录列表');
  const notes = rawNotes.map(normalizeNote);
  if (notes.some((note) => !note)) throw new Error('备份含有无效记录，未导入任何内容');
  const rawDraft = isRecord(parsed) ? parsed.draft : null;
  const draft =
    isRecord(rawDraft) && typeof rawDraft.text === 'string' ? { ...normalizeDraft(rawDraft), updatedAt: Date.now() } : null;
  return { notes: notes as Note[], draft };
}

/** 导入与导出。 */
function BackupGroup({ saveFailed, loadFailed }: { saveFailed: boolean; loadFailed: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();

  const exportBackup = async (): Promise<void> => {
    // 读库失败时内存中没有真实记录，导出的会是空备份，还可能覆盖用户已有的备份文件。
    if (store.getState().loadFailed) {
      toast('尚未读取到本地记录，暂不能导出', null, true);
      return;
    }
    const { notes, draft, settings, tagUsage } = store.getState();
    const payload = { application: 'SideNotes', exportedAt: new Date().toISOString(), notes, draft, settings, tagUsage };
    const name = `SideNotes-备份-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      if (await bridge.saveBackupFile(name, JSON.stringify(payload, null, 2))) {
        toast('已生成备份，包含记录、草稿和图片');
      }
    } catch (error) {
      toast(`备份未生成：${reason(error, '写入文件失败')}`, null, true);
    }
  };

  const importBackup = async (): Promise<void> => {
    let backup: { notes: Note[]; draft: Draft | null };
    try {
      const text = await bridge.openBackupFile();
      if (text === null) return;
      backup = parseBackup(text);
    } catch (error) {
      toast(`无法导入：${reason(error, '请选择有效的 JSON 备份')}`, null, true);
      return;
    }
    confirm({
      title: '导入本地备份',
      message: `已读取 ${backup.notes.length} 条记录。导入将合并到当前内容，现有记录和当前草稿会保留；标识相同的记录仅在备份更新时替换，图片会一起导入。`,
      confirmLabel: '合并导入',
      icon: 'upload',
      run: async () => {
        const merged = await store.mergeImported(backup.notes, backup.draft);
        if (merged) toast('备份已合并到本地记录');
        else toast('导入未完成，本地数据库写入失败；当前内容未改动。', null, true);
        return merged;
      },
    });
  };

  const retry = async (): Promise<void> => {
    const recovering = store.getState().loadFailed;
    if (await store.retryStorage()) toast('本地保存已恢复');
    else toast(recovering ? '仍未读取到本地记录，请稍后重试' : '仍未保存，请导出备份', null, true);
  };

  return (
    <Group
      title="导入与导出"
      description="JSON 备份包含记录、图片、草稿与设置。导入前可预览并确认。"
      className="settings-wide"
    >
      <div className="settings-actions data-actions">
        <ActionButton label="导出备份" icon="download" data-action="export-data" onClick={() => void exportBackup()} />
        <ActionButton label="导入备份" icon="upload" data-action="import-data" onClick={() => void importBackup()} />
      </div>
      {saveFailed || loadFailed ? (
        <>
          <p className="settings-notice is-error">
            {loadFailed ? '未能读取本地记录，已暂停保存，以免覆盖已有数据。' : '本地存储受限，请先导出备份。'}
          </p>
          <ActionButton label="重试本地保存" icon="restore" data-action="retry-storage" onClick={() => void retry()} />
        </>
      ) : null}
    </Group>
  );
}

/** 两个目录是否相同（Windows 路径不区分大小写，忽略结尾的分隔符）。 */
function sameDirectory(left: string, right: string): boolean {
  const normalize = (path: string): string => path.trim().replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
  return Boolean(left.trim()) && normalize(left) === normalize(right);
}

/** 所选存储位置对应的目录；自定义目录尚未填写时为空。 */
function locationDirectory(settings: Settings, info: StorageInfo | null): string {
  if (!info) return '';
  if (settings.storageLocation === 'appdata') return info.defaultDirectory;
  if (settings.storageLocation === 'portable') return info.portableDirectory;
  return settings.customDirectory.trim();
}

/** 数据目录。 */
function DirectoryGroup({
  settings,
  save,
  info,
  onRefresh,
}: {
  settings: Settings;
  save: SaveSettings;
  info: StorageInfo | null;
  onRefresh: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const target = locationDirectory(settings, info);
  // 所选位置与当前目录不同时才需要迁移；读取目录信息之前不显示。
  const needsMigration = Boolean(info && target && !sameDirectory(target, info.directory));

  const chooseDirectory = async (): Promise<void> => {
    const path = await bridge.pickDirectory();
    if (!path) return;
    if (await save({ storageLocation: 'custom', customDirectory: path.slice(0, 500) })) {
      toast('已选择目录，点击「迁移到这里」把数据复制过去');
    }
  };

  /**
   * 把数据库与附件复制到所选位置并改用那里的数据；原目录保留作为备份。
   * 成功后各窗口重新读库（记录中的附件路径已改写），目录信息随之刷新。
   */
  const migrate = (): void => {
    if (!info || !target) return;
    confirm({
      title: '迁移数据',
      message: `将把数据库与 ${info.attachmentCount} 个附件复制到「${target}」，之后的记录都保存在新位置。原目录不会删除，保留作为备份。`,
      confirmLabel: '开始迁移',
      icon: 'folder',
      run: async () => {
        try {
          const report = await bridge.migrateStorage(target);
          await store.reloadEverywhere();
          toast(
            report.backup
              ? `已迁移到新目录；那里原有的数据库已改名保留`
              : `已迁移到新目录，原目录保留作为备份`,
          );
          onRefresh();
          return true;
        } catch (error) {
          toast(`迁移未完成：${reason(error, '请稍后重试')}；记录仍保存在原目录`, null, true);
          return false;
        }
      },
    });
  };

  const openDirectory = async (): Promise<void> => {
    if (!info?.database) return;
    try {
      await bridge.revealInFolder(info.database);
    } catch (error) {
      toast(`无法打开目录：${reason(error, '系统未响应')}`, null, true);
    }
  };

  return (
    <Group title="数据目录" className="settings-wide">
      {info?.unavailableDirectory ? (
        <p className="settings-notice is-error">
          {`上次使用的数据目录「${info.unavailableDirectory}」不可用（例如移动硬盘未接入），已暂时使用应用数据目录。接入后重新启动即可恢复，也可以在这里迁移到其它位置。`}
        </p>
      ) : null}
      <Row title="存储位置" description="选择位置后点击「迁移到这里」：数据库与附件复制到新位置，之后的记录保存在那里，原目录保留作为备份。">
        <SelectField
          label="数据存储位置"
          options={LOCATIONS}
          value={settings.storageLocation}
          onChange={(location) => void save({ storageLocation: location as StorageLocation })}
        />
      </Row>
      {settings.storageLocation === 'custom' ? (
        <div className="settings-inline">
          <TextField
            label="自定义数据目录"
            value={settings.customDirectory}
            placeholder="例如 D:\SideNotes"
            onCommit={(customDirectory) => save({ customDirectory: customDirectory.slice(0, 500) })}
          />
          <ActionButton label="选择目录" icon="folder" onClick={() => void chooseDirectory()} />
        </div>
      ) : null}
      {needsMigration ? (
        <div className="settings-inline storage-migration">
          <code className="settings-path directory-field" aria-label="迁移的目标目录" title={target}>
            {target}
          </code>
          <ActionButton label="迁移到这里" icon="upload" onClick={migrate} />
        </div>
      ) : null}
      <div className="settings-inline current-directory">
        <code className="settings-path directory-field" aria-label="当前数据目录" title={info?.directory}>
          {info?.directory || '正在读取…'}
        </code>
        <ActionButton label="打开目录" icon="folder" className="icon-button" onClick={() => void openDirectory()} />
      </div>
    </Group>
  );
}

/** 云端自动备份：桌面版尚未接入云服务，只保存配置。 */
function CloudGroup({ settings, save }: { settings: Settings; save: SaveSettings }) {
  const toast = useToast();
  const cloud = settings.cloud;
  const [notify, setNotify] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void bridge.notificationGranted().then((granted) => {
      if (alive) setNotify(granted);
    });
    return () => {
      alive = false;
    };
  }, []);

  const saveCloud = (patch: Partial<CloudSettings>): Promise<boolean> =>
    save({ cloud: { ...settings.cloud, ...patch } });

  const enableNotifications = async (): Promise<void> => {
    if (notify === null) {
      toast('当前环境不支持系统通知');
      return;
    }
    try {
      const granted = await bridge.requestNotifications();
      setNotify(granted);
      if (granted) void saveCloud({ notifications: true });
      toast(granted ? '已允许备份失败系统通知' : '通知未开启，可稍后在系统设置中允许');
    } catch {
      toast('系统通知请求受限，可稍后在系统设置中允许');
    }
  };

  return (
    <Group title="云端自动备份" className="settings-wide">
      <div className="settings-row setting-row settings-inline-toggle">
        <div className="settings-row-info setting-copy">
          <span className="settings-row-label setting-label">自动备份</span>
          <Help title="自动备份" description="桌面版尚未接入云端服务；开启后只保存配置，不会上传数据。" />
        </div>
        <div className="settings-control">
          <Toggle label="启用云端自动备份" checked={cloud.enabled} onChange={(enabled) => void saveCloud({ enabled })} />
        </div>
      </div>
      <div className="sync-provider-grid">
        {PROVIDERS.map(([provider, name, protocol]) => {
          const active = cloud.provider === provider;
          return (
            <button
              key={provider}
              type="button"
              className={classes('sync-provider', active && 'active selected')}
              data-action=""
              data-provider={provider}
              aria-label={`${name}，${protocol}`}
              aria-pressed={active}
              onClick={() => void saveCloud({ provider, lastError: '', lastBackup: 0 })}
            >
              <ProviderMark provider={provider} />
              <span className="sync-provider-name">{name}</span>
              <small>{protocol}</small>
            </button>
          );
        })}
      </div>
      {cloud.provider === 'synology' ? (
        <Row title="WebDAV 地址">
          <TextField
            label="NAS WebDAV 地址"
            value={cloud.endpoint}
            placeholder="https://nas.example.com:5006"
            onCommit={(endpoint) => saveCloud({ endpoint: endpoint.slice(0, 500) })}
          />
        </Row>
      ) : null}
      <div className="settings-field-grid">
        <Row title="账户" description="仅配置预览，无需密码或令牌。">
          <TextField
            label="同步账户标识"
            value={cloud.account}
            placeholder={cloud.provider === 'synology' ? 'NAS 用户名' : '账户邮箱'}
            onCommit={(account) => saveCloud({ account: account.slice(0, 120) })}
          />
        </Row>
        <Row title="远程文件夹">
          <TextField
            label="云端备份文件夹"
            value={cloud.folder}
            placeholder="SideNotes"
            onCommit={(folder) => saveCloud({ folder: folder.slice(0, 240) })}
          />
        </Row>
      </div>
      <p className={classes('settings-status sync-status', cloud.enabled && 'is-warning')} data-cloud-status="true">
        {cloud.enabled ? '已启用 · 云端服务尚未接入，暂不上传' : '未启用 · 云端服务尚未接入'}
      </p>
      <div className="settings-actions data-actions">
        <ActionButton
          label="云端备份"
          icon="cloud"
          onClick={() => toast(cloud.enabled ? '云端服务尚未接入桌面版，可先导出本地备份' : '请先启用自动备份')}
        />
      </div>
      <Row
        title="备份失败系统通知"
        description={
          notify === null
            ? '当前环境不支持系统通知。'
            : notify
              ? '已允许；仅在备份失败时提醒。'
              : '经你允许后，备份失败时发送系统通知。'
        }
      >
        <ActionButton label={notify ? '已开启' : '开启通知'} icon="bell" onClick={() => void enableNotifications()} />
      </Row>
    </Group>
  );
}

export function DataPanel({
  settings,
  save,
  saveFailed,
  loadFailed,
}: {
  settings: Settings;
  save: SaveSettings;
  saveFailed: boolean;
  loadFailed: boolean;
}) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  // 打开数据分类、迁移数据之后重新读取目录信息；卸载后返回的结果直接丢弃。
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    void bridge
      .storageInfo()
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [revision]);

  return (
    <>
      <p className="settings-notice">
        记录保存在本机 SQLite 数据库，不会上传。云端自动备份尚未接入桌面版，相关选项目前只保存配置，不会上传数据。
      </p>
      <div className="settings-dashboard data-dashboard">
        <BackupGroup saveFailed={saveFailed} loadFailed={loadFailed} />
        <DirectoryGroup settings={settings} save={save} info={info} onRefresh={() => setRevision((value) => value + 1)} />
        <CloudGroup settings={settings} save={save} />
      </div>
    </>
  );
}
