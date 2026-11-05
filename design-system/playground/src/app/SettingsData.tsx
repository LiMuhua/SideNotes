/**
 * 设置：数据与同步、回收站、关于。
 *
 * 结构沿用现有应用 0.7.3：「数据与同步」一行一项，名称在左、取值与操作靠右（T74）；
 * 回收站可以搜索、按到期与标签筛选、恢复与永久删除；云端备份尚未接入，只保存配置（T11）。
 * Playground 不访问文件系统，目录、快照与附件都是示例数值。
 */

import { useMemo, useState } from 'react';
import { formatFullTime, isExpired, matchesQuery, noteTitle } from '@/core/notes';
import { TRASH_DAYS_RANGE } from '@/core/settings';
import type { StorageLocation } from '@/core/types';
import { useNotes } from '../model/notes';
import { Button } from '../ui/Button';
import { cx } from '../ui/context';
import { ConfirmDialog } from '../ui/Dialog';
import { SearchInput, TextInput } from '../ui/Field';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Tabs';
import { Switch } from '../ui/Toggle';
import { BrandMark } from './SidebarParts';
import { SettingGroup, SettingRow } from './SettingsWindow';

const LOCATIONS: ReadonlyArray<{ value: StorageLocation; label: string; path: string }> = [
  { value: 'appdata', label: '应用数据目录', path: 'C:\\Users\\用户\\AppData\\Roaming\\SideNotes' },
  { value: 'portable', label: '便携模式（程序所在文件夹）', path: 'D:\\Apps\\SideNotes\\SideNotesData' },
  { value: 'custom', label: '自定义目录', path: 'D:\\同步盘\\SideNotes' },
];

const SNAPSHOTS = [
  { id: 'auto', label: '每日自动', ago: 3 * 3_600_000 },
  { id: 'trash', label: '永久删除前', ago: 26 * 3_600_000 },
  { id: 'manual', label: '手动', ago: 4 * 86_400_000 },
];

export function DataPanel() {
  const { settings, updateSettings } = useNotes();
  const toast = useToast();
  const [location, setLocation] = useState<StorageLocation>(settings.storageLocation);
  const [cloud, setCloud] = useState(settings.cloud.enabled);
  const current = LOCATIONS.find((item) => item.value === location) ?? LOCATIONS[0];
  const demo = (action: string) => toast({ message: `${action}（Playground 只演示，不访问文件）` });
  // 快照时间按打开设置页的那一刻计算，渲染期间不再调用 Date.now()。
  const [openedAt] = useState(() => Date.now());

  return (
    <>
      <SettingGroup title="存储位置">
        <SettingRow title="数据目录">
          <span className="sn-setting-value is-path" title={current.path}>
            {current.path}
          </span>
          <Button size="sm" variant="secondary" icon="folder" onClick={() => demo('打开目录')}>
            打开
          </Button>
        </SettingRow>
        <SettingRow title="迁移到" help="复制数据库与附件到新位置，原目录保持不动">
          <Select aria-label="迁移的目标目录" size="sm" value={location} onChange={setLocation} options={LOCATIONS.map(({ value, label }) => ({ value, label }))} />
          <Button
            size="sm"
            variant="secondary"
            disabled={location === settings.storageLocation}
            onClick={() => {
              updateSettings({ storageLocation: location });
              toast({ message: '已迁移到新目录（示例）', tone: 'success' });
            }}
          >
            迁移到这里
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="本地备份">
        <SettingRow title="导出备份" help="导出记录、设置与附件到一个文件夹">
          <Button size="sm" variant="secondary" icon="download" onClick={() => demo('导出备份')}>
            导出
          </Button>
        </SettingRow>
        <SettingRow title="导入备份" help="导入前自动创建一份快照">
          <Button size="sm" variant="secondary" icon="upload" onClick={() => demo('导入备份')}>
            导入
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        title="快照"
        aside={
          <Button size="sm" variant="ghost" icon="plus" onClick={() => toast({ message: '已创建快照（示例）', tone: 'success' })}>
            立即创建
          </Button>
        }
      >
        {SNAPSHOTS.map((snapshot) => (
          <SettingRow key={snapshot.id} title={snapshot.label}>
            <span className="sn-setting-value">{formatFullTime(openedAt - snapshot.ago)}</span>
            <Button size="sm" variant="secondary" onClick={() => demo('从快照恢复')}>
              恢复
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup title="附件">
        <SettingRow title="附件副本" help="不再被引用的副本三天后自动删除">
          <span className="sn-setting-value">5 个 · 1.2 MB</span>
          <Button size="sm" variant="secondary" onClick={() => toast({ message: '没有需要清理的附件', tone: 'success' })}>
            立即清理
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="云端备份">
        <SettingRow title="启用云端自动备份" help="可选功能；接入前只保存配置">
          <Switch label="启用云端自动备份" hideLabel checked={cloud} onChange={setCloud} />
        </SettingRow>
        <SettingRow title="服务">
          <Select
            aria-label="云端服务"
            size="sm"
            disabled={!cloud}
            value={settings.cloud.provider}
            onChange={(provider) => updateSettings({ cloud: { ...settings.cloud, provider } })}
            options={[
              { value: 'synology', label: '群晖 NAS（WebDAV）' },
              { value: 'google', label: 'Google Drive' },
              { value: 'onedrive', label: 'OneDrive' },
            ]}
          />
        </SettingRow>
        <SettingRow title="地址">
          <TextInput inputSize="sm" aria-label="WebDAV 地址" disabled={!cloud} placeholder="https://nas.local:5006/sidenotes" />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

type TrashFilter = 'all' | 'expired';

export function TrashPanel() {
  const data = useNotes();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TrashFilter>('all');
  const [days, setDays] = useState(String(data.settings.trashDays));
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [openedAt] = useState(() => Date.now());
  const trashed = useMemo(
    () =>
      data.notes
        .filter((note) => note.status === 'trash' && matchesQuery(note, query))
        .filter((note) => filter === 'all' || isExpired(note, data.settings.trashDays, openedAt))
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [data.notes, data.settings.trashDays, query, filter, openedAt],
  );

  return (
    <>
      <SettingGroup title="保留策略">
        <SettingRow title="回收站保留" help={`保留 ${TRASH_DAYS_RANGE.min}–${TRASH_DAYS_RANGE.max} 天，到期后自动永久删除`}>
          <Select
            aria-label="保留天数预设"
            size="sm"
            value={['7', '30', '90'].includes(days) ? days : 'custom'}
            onChange={(value) => {
              if (value === 'custom') return;
              setDays(value);
              data.updateSettings({ trashDays: Number(value) });
            }}
            options={[
              { value: '7', label: '7 天' },
              { value: '30', label: '30 天' },
              { value: '90', label: '90 天' },
              { value: 'custom', label: '自定义…' },
            ]}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup
        title={`回收站 · ${trashed.length} 条`}
        aside={
          <Button size="sm" variant="ghost" disabled={!trashed.length} onClick={() => setConfirm(trashed.filter((note) => isExpired(note, data.settings.trashDays, openedAt)).map((note) => note.id))}>
            清理到期项
          </Button>
        }
      >
        <div className="sn-trash-tools">
          <SearchInput value={query} onValueChange={setQuery} placeholder="搜索回收站" aria-label="搜索回收站" inputSize="sm" />
          <Select
            aria-label="回收站到期筛选"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'expired', label: '已到期' },
            ]}
          />
        </div>
        {trashed.length ? (
          trashed.map((note) => (
            <div key={note.id} className="sn-trash-row">
              <span className="sn-trash-emoji" aria-hidden="true">
                {note.emoji}
              </span>
              <span className="sn-trash-text">
                <span className="sn-trash-title">{noteTitle(note)}</span>
                <span className={cx('sn-trash-meta', isExpired(note, data.settings.trashDays, openedAt) && 'is-expired')}>
                  删除于 {formatFullTime(note.deletedAt ?? 0)}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                icon="restore"
                onClick={() => {
                  data.restore([note.id]);
                  toast({ message: '已恢复', tone: 'success' });
                }}
              >
                恢复
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm([note.id])}>
                永久删除
              </Button>
            </div>
          ))
        ) : (
          <p className="sn-setting-empty">{query ? '没有匹配的记录' : '回收站是空的'}</p>
        )}
      </SettingGroup>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm && confirm.length > 1 ? `永久删除 ${confirm.length} 条记录？` : '永久删除这条记录？'}
        description={confirm?.length ? '删除前会自动创建一份快照，可以从快照恢复。' : '没有到期的记录。'}
        confirmLabel="永久删除"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.length) {
            data.removeForever(confirm);
            toast({ message: '已永久删除', tone: 'danger' });
          }
          setConfirm(null);
        }}
      />
    </>
  );
}

export function AboutPanel() {
  const toast = useToast();
  return (
    <>
      <div className="sn-about-head">
        <BrandMark />
        <div>
          <h3 className="sn-about-name">SideNotes</h3>
          <p className="sn-about-tagline">
            {__APP_VERSION__} 预览版 · 本地快速记录：贴边侧栏取用，快捷键浮窗随手记
          </p>
        </div>
        <span className="sn-spacer" />
        <Button size="sm" variant="secondary" onClick={() => toast({ message: '已是最新版本（示例）', tone: 'success' })}>
          检查更新
        </Button>
      </div>
      <SettingGroup title="项目">
        <SettingRow title="官方网站">
          <Button size="sm" variant="ghost" trailingIcon="arrow-up-right" onClick={() => toast({ message: '打开官方网站（示例）' })}>
            打开
          </Button>
        </SettingRow>
        <SettingRow title="GitHub">
          <Button size="sm" variant="ghost" trailingIcon="arrow-up-right" onClick={() => toast({ message: '打开 GitHub（示例）' })}>
            打开
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="开源致谢">
        <SettingRow title="Maple Mono NF CN">
          <span className="sn-setting-value">SIL Open Font License 1.1</span>
        </SettingRow>
        <SettingRow title="Tauri · React">
          <span className="sn-setting-value">MIT / Apache-2.0</span>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="调试">
        <SettingRow title="开发者工具">
          <Button size="sm" variant="secondary" onClick={() => toast({ message: '打开开发者工具（示例）' })}>
            打开
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
