/**
 * 数据与同步。
 *
 * 内容对应原型 settings.js 的 renderData（导入与导出、数据目录、云端自动备份），桌面端另加「快照」。
 * 用户反馈原型的布局太乱，桌面端改为一行一项：名称（说明放在问号里）在左，取值与操作靠右，
 * 目录路径占据中间的空间；分组按常用程度排列：数据目录、快照、导入与导出、云端备份。
 * 导入导出、打开目录、更换存储位置（复制数据并改写附件路径）、附件清理、快照与云端备份在桌面端真实可用；
 * 云端同步的界面在 CloudPanel.tsx。
 */

import { useEffect, useState } from 'react';
import * as bridge from '../../core/bridge';
import * as store from '../../core/store';
import { BACKUP_ATTACHMENTS, backupName, parseBackup, rewriteAttachmentPaths, type ParsedBackup } from '../../core/backup';
import { formatBytes } from '../../core/files';
import { snapshotReason, snapshotTime } from '../../core/snapshots';
import type {
  DataSnapshot,
  Settings,
  SnapshotOverview,
  StorageInfo,
  StorageLocation,
} from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { CloudGroup } from './CloudPanel';
import { useConfirm } from './confirm';
import { ActionButton, DataRow, Group, Row, SelectField, TextField, type SaveSettings } from './controls';
import { PathText } from './PathText';

const LOCATIONS: ReadonlyArray<readonly [StorageLocation, string]> = [
  ['appdata', '应用数据目录（AppData）'],
  ['portable', '安装目录（便携模式）'],
  ['custom', '自定义目录'],
];

/** 取出错误说明，供提示条使用。 */
function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : typeof error === 'string' ? error : fallback;
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
    try {
      const parent = await bridge.pickDirectory('选择导出位置');
      if (!parent) return;
      const { notes, draft, settings, tagUsage } = store.getState();
      // 记下数据目录，导入时据此把附件路径改写到导入方的数据目录。
      const { directory } = await bridge.storageInfo();
      const payload = {
        application: 'SideNotes',
        exportedAt: new Date().toISOString(),
        dataDirectory: directory,
        attachmentsDirectory: BACKUP_ATTACHMENTS,
        notes,
        draft,
        settings,
        tagUsage,
      };
      const report = await bridge.exportBackup(parent, backupName(), JSON.stringify(payload, null, 2));
      const summary = `已导出 ${notes.length} 条记录与 ${report.attachments} 个附件`;
      toast(report.missing ? `${summary}；${report.missing} 个附件已经找不到` : summary, {
        label: '打开',
        run: () => void bridge.revealInFolder(report.file),
      });
    } catch (error) {
      toast(`备份未导出：${reason(error, '写入文件失败')}`, null, true);
    }
  };

  const importBackup = async (): Promise<void> => {
    let backup: ParsedBackup;
    let file: string;
    try {
      const chosen = await bridge.openBackupFile();
      if (chosen === null) return;
      backup = parseBackup(chosen.text);
      file = chosen.path;
    } catch (error) {
      toast(`无法导入：${reason(error, '请选择有效的 JSON 备份')}`, null, true);
      return;
    }
    confirm({
      title: '导入本地备份',
      message: `已读取 ${backup.notes.length} 条记录。导入将合并到当前内容，现有记录和当前草稿会保留；标识相同的记录仅在备份更新时替换，${backup.attachmentsDirectory ? '附件一并拷回' : '图片会一起导入'}。`,
      confirmLabel: '合并导入',
      icon: 'upload',
      run: async () => {
        const failed = await store.snapshotBefore('import');
        if (failed) toast(`导入前的快照未创建：${failed}`, null, true);
        let { notes, draft } = backup;
        // 新版备份带有附件：先拷回数据目录，再把记录里的附件路径改写到当前数据目录。
        if (backup.attachmentsDirectory) {
          try {
            await bridge.importBackupAttachments(file, backup.attachmentsDirectory);
            const { directory } = await bridge.storageInfo();
            const relocate = (value: string): string => rewriteAttachmentPaths(value, backup.dataDirectory, directory);
            notes = notes.map((note) => ({ ...note, text: relocate(note.text) }));
            if (draft) draft = { ...draft, text: relocate(draft.text) };
          } catch (error) {
            toast(`附件未能拷回：${reason(error, '请稍后重试')}；记录照常导入`, null, true);
          }
        }
        const merged = await store.mergeImported(notes, draft);
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
    <Group title="导入与导出" className="settings-wide">
      {saveFailed || loadFailed ? (
        <p className="settings-notice is-error">
          {loadFailed ? '未能读取本地记录，已暂停保存，以免覆盖已有数据。' : '本地存储受限，请先导出备份。'}
        </p>
      ) : null}
      <DataRow title="本地备份" help="导出为一个文件夹，含附件；导入时合并到现有记录，附件一同拷回">
        <ActionButton label="导出备份" icon="download" data-action="export-data" onClick={() => void exportBackup()} />
        <ActionButton label="导入备份" icon="upload" data-action="import-data" onClick={() => void importBackup()} />
      </DataRow>
      {saveFailed || loadFailed ? (
        <DataRow title="本地保存">
          <ActionButton label="重试本地保存" icon="restore" data-action="retry-storage" onClick={() => void retry()} />
        </DataRow>
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
  const [cleaning, setCleaning] = useState(false);
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
          const failed = await store.snapshotBefore('migrate');
          if (failed) toast(`迁移前的快照未创建：${failed}`, null, true);
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

  /**
   * 立即清理不再被任何记录引用的附件副本（平时在记录变化后自动进行）。
   * 导入不到一天的附件可能还在其它窗口未保存的内容里，与自动清理一样暂时保留。
   */
  const cleanAttachments = async (): Promise<void> => {
    setCleaning(true);
    try {
      const report = await bridge.cleanupAttachments([]);
      if (report.removed) {
        toast(`已清理 ${report.removed} 个未引用的附件，释放 ${formatBytes(report.freed)}`);
      } else if (report.pending) {
        toast(`没有可清理的附件；${report.pending} 个导入不到一天的附件暂时保留`);
      } else {
        toast('没有未引用的附件');
      }
      onRefresh();
    } catch (error) {
      toast(`附件未清理：${reason(error, '请稍后重试')}`, null, true);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Group title="数据目录" className="settings-wide">
      {info?.unavailableDirectory ? (
        <p className="settings-notice is-error">
          {`数据目录「${info.unavailableDirectory}」不可用（例如移动硬盘未接入），已暂时改用应用数据目录；接入后重新启动即可恢复。`}
        </p>
      ) : null}
      <div className="settings-field-grid">
        <Row title="存储位置">
          <SelectField
            label="数据存储位置"
            options={LOCATIONS}
            value={settings.storageLocation}
            onChange={(location) => void save({ storageLocation: location as StorageLocation })}
          />
        </Row>
        <DataRow title="附件" help="不再被任何记录引用的附件会自动清理">
          <span className="settings-value" data-attachment-usage="">
            {info ? `${info.attachmentCount} 个 · ${formatBytes(info.attachmentSize)}` : '正在读取…'}
          </span>
          <ActionButton
            label={cleaning ? '正在清理…' : '立即清理'}
            icon="trash"
            disabled={cleaning}
            onClick={() => void cleanAttachments()}
          />
        </DataRow>
      </div>
      {settings.storageLocation === 'custom' ? (
        <DataRow title="自定义目录" grow>
          <TextField
            label="自定义数据目录"
            value={settings.customDirectory}
            placeholder="例如 D:\SideNotes"
            onCommit={(customDirectory) => save({ customDirectory: customDirectory.slice(0, 500) })}
          />
          <ActionButton label="选择目录" icon="folder" onClick={() => void chooseDirectory()} />
        </DataRow>
      ) : null}
      {needsMigration ? (
        <DataRow title="迁移到" help="数据库与附件复制到这里，之后的记录保存在这里；原目录保留作为备份" grow>
          <PathText label="迁移的目标目录" path={target} />
          <ActionButton label="迁移到这里" icon="upload" className="button primary compact" onClick={migrate} />
        </DataRow>
      ) : null}
      <DataRow title="当前目录" grow>
        <PathText label="当前数据目录" path={info?.directory || '正在读取…'} />
        <ActionButton label="打开目录" icon="folder" className="icon-button" onClick={() => void openDirectory()} />
      </DataRow>
    </Group>
  );
}

/**
 * 快照：每天自动为数据库创建一份，导入备份、永久删除、迁移与恢复之前也各创建一份；附件只增量备份一次，
 * 所有快照共用。可以立即创建、从任意一份恢复，或把快照目录放到另一块硬盘。
 */
function SnapshotGroup({ settings, save }: { settings: Settings; save: SaveSettings }) {
  const toast = useToast();
  const confirm = useConfirm();
  const directory = settings.snapshotDirectory;
  const [overview, setOverview] = useState<SnapshotOverview | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  // 创建、恢复或更换目录之后重新读取列表；卸载后返回的结果直接丢弃。
  const [revision, setRevision] = useState(0);
  const refresh = (): void => setRevision((value) => value + 1);

  useEffect(() => {
    let alive = true;
    bridge.listSnapshots(directory).then(
      (result) => {
        if (!alive) return;
        setOverview(result);
        setProblem('');
      },
      (error: unknown) => {
        if (!alive) return;
        setOverview(null);
        setProblem(bridge.errorText(error, '无法读取快照目录'));
      },
    );
    return () => {
      alive = false;
    };
  }, [directory, revision]);

  const chooseDirectory = async (): Promise<void> => {
    const path = await bridge.pickDirectory();
    if (!path) return;
    if (await save({ snapshotDirectory: path.slice(0, 500) })) toast('快照目录已更换，之后的快照保存在这里');
  };

  const resetDirectory = async (): Promise<void> => {
    if (await save({ snapshotDirectory: '' })) toast('已改回数据目录下的 snapshots 文件夹');
  };

  const openDirectory = async (): Promise<void> => {
    if (!overview?.directory) return;
    try {
      await bridge.revealInFolder(overview.directory);
    } catch (error) {
      toast(`无法打开目录：${bridge.errorText(error, '系统未响应')}`, null, true);
    }
  };

  const createNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const snapshot = await bridge.createSnapshot(directory, 'manual');
      toast(
        snapshot.missing.length
          ? `已创建快照；${snapshot.missing.length} 个附件已经找不到，未能备份`
          : '已创建快照',
      );
      refresh();
    } catch (error) {
      toast(`快照未创建：${bridge.errorText(error)}`, null, true);
    } finally {
      setBusy(false);
    }
  };

  const restore = (snapshot: DataSnapshot): void => {
    const when = snapshotTime(snapshot.createdAt);
    confirm({
      title: '恢复快照',
      message: `将用${when} 的快照（${snapshot.noteCount} 条记录）替换当前全部记录，包括回收站。恢复前会先为当前数据创建一份快照，可以随时换回；设置与草稿保持不变。`,
      confirmLabel: '恢复',
      icon: 'restore',
      run: async () => {
        try {
          const report = await bridge.restoreSnapshot(directory, snapshot.id);
          await store.reloadEverywhere();
          toast(
            report.missingAttachments
              ? `已恢复到${when} 的快照；${report.missingAttachments} 个附件在备份中也找不到`
              : `已恢复到${when} 的快照`,
          );
          refresh();
          return true;
        } catch (error) {
          toast(`恢复未完成：${bridge.errorText(error)}；当前记录未改动`, null, true);
          return false;
        }
      },
    });
  };

  return (
    <Group
      title="快照"
      description="每天自动创建；导入、永久删除、迁移与恢复之前也会创建"
      className="settings-wide snapshot-group"
    >
      {problem ? <p className="settings-notice is-error">{`快照目录不可用：${problem}`}</p> : null}
      <DataRow title="快照目录" help="放到另一块硬盘，硬盘损坏时也能找回数据" grow>
        <PathText label="快照目录" path={overview?.directory || directory || '正在读取…'} />
        <ActionButton label="打开目录" icon="folder" className="icon-button" onClick={() => void openDirectory()} />
        <ActionButton label="更换" icon="edit" onClick={() => void chooseDirectory()} />
        {directory ? <ActionButton label="恢复默认" icon="restore" onClick={() => void resetDirectory()} /> : null}
      </DataRow>
      <DataRow title="已有快照" help="保留 24 小时内的全部，7 天内每天一份，4 周内每周一份">
        <span className="settings-value">
          {overview
            ? `${overview.snapshots.length} 份 · 附件 ${overview.attachmentCount} 个，${formatBytes(overview.attachmentSize)}`
            : '正在读取…'}
        </span>
        <ActionButton
          label={busy ? '正在创建…' : '立即创建'}
          icon="plus"
          disabled={busy || Boolean(problem)}
          onClick={() => void createNow()}
        />
      </DataRow>
      {overview?.snapshots.length ? (
        <ul className="snapshot-list" aria-label="快照列表">
          {overview.snapshots.map((snapshot) => (
            <li key={snapshot.id} className="snapshot-item">
              <span className="snapshot-time">{snapshotTime(snapshot.createdAt)}</span>
              <span className="snapshot-reason">{snapshotReason(snapshot.reason)}</span>
              <span className="snapshot-meta">{`${snapshot.noteCount} 条 · ${formatBytes(snapshot.size)}`}</span>
              <button type="button" className="button secondary compact" onClick={() => restore(snapshot)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
  // 打开数据分类、迁移数据或清理附件之后重新读取目录信息；卸载后返回的结果直接丢弃。
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
    <div className="settings-dashboard data-dashboard">
      <DirectoryGroup settings={settings} save={save} info={info} onRefresh={() => setRevision((value) => value + 1)} />
      <SnapshotGroup settings={settings} save={save} />
      <BackupGroup saveFailed={saveFailed} loadFailed={loadFailed} />
      <CloudGroup settings={settings} save={save} />
    </div>
  );
}
