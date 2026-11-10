/**
 * 设置：数据与同步、回收站、关于。
 *
 * 分组、设置项、说明文字与操作沿用现有应用 0.7.3（`DataPanel.tsx`、`TrashPanel.tsx`、`AboutPanel.tsx`）。
 * 「数据与同步」按外观页的写法排得紧凑：名称后紧跟取值与操作，相关的两项放在同一行；云端备份的输入框较多，名称单独成列以便对齐。
 * 云端备份尚未接入，与现有应用一样只保存配置（T11）。
 * Playground 不访问文件系统，目录、快照与附件都是示例数值，操作只给出提示。
 */

import { useMemo, useState } from 'react';
import { formatFullTime, isExpired, noteTitle } from '@/core/notes';
import { TRASH_DAYS_RANGE } from '@/core/settings';
import { parse } from '@/core/tags';
import type { CloudProvider, CloudSettings, Note, StorageLocation } from '@/core/types';
import { useNotes } from '../model/notes';
import { Button, IconButton } from '../ui/Button';
import { Combobox } from '../ui/Combobox';
import { cx } from '../ui/context';
import { ConfirmDialog } from '../ui/Dialog';
import { SearchInput, TextInput } from '../ui/Field';
import { Icon, type IconName } from '../ui/Icon';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Tabs';
import { Switch } from '../ui/Toggle';
import { HelpTip } from '../ui/Tooltip';
import { AVAILABLE_UPDATE, UpdateDialog } from './menus';
import { AppIcon } from './SidebarParts';
import { DataRow, Field, FieldRow, PathText, SettingsCard, SettingsPage } from './SettingsParts';

const LOCATIONS: ReadonlyArray<{ value: StorageLocation; label: string; path: string }> = [
  { value: 'appdata', label: '应用数据目录（AppData）', path: 'C:\\Users\\用户\\AppData\\Roaming\\SideNotes' },
  { value: 'portable', label: '安装目录（便携模式）', path: 'D:\\Apps\\SideNotes\\data' },
  { value: 'custom', label: '自定义目录', path: 'D:\\同步盘\\SideNotes' },
];

/** 示例快照：时间按打开设置页的时刻倒推。 */
const SNAPSHOTS = [
  { id: 'daily', reason: '每日自动', ago: 3 * 3_600_000, notes: 21, size: '86 KB' },
  { id: 'delete', reason: '永久删除前', ago: 26 * 3_600_000, notes: 22, size: '88 KB' },
  { id: 'import', reason: '导入前', ago: 4 * 86_400_000, notes: 19, size: '80 KB' },
];

const PROVIDERS: ReadonlyArray<{ id: CloudProvider; name: string; protocol: string }> = [
  { id: 'synology', name: '群晖 NAS', protocol: 'WebDAV' },
  { id: 'google', name: 'Google Drive', protocol: 'OAuth' },
  { id: 'onedrive', name: 'OneDrive', protocol: 'Microsoft' },
];

/** 各备份服务的标识，图形取自现有应用（DataPanel 的 PROVIDER_MARKS）。内容为固定常量，不含外部输入。 */
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
      '<defs><linearGradient id="sn-onedrive-mark" x1="4" y1="19" x2="20" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#0364b8"/><stop offset="1" stop-color="#28a8ea"/></linearGradient></defs><path fill="url(#sn-onedrive-mark)" d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/><path fill="#fff" fill-opacity=".24" d="M7.1 16.6h10.3c1.45 0 2.6-1.08 2.6-2.45 0-1.3-1.06-2.37-2.39-2.44a3.73 3.73 0 00-7.12-1.48 3.03 3.03 0 00-3.39 3.02c0 1.53 1.23 2.75 2.78 2.75z"/>',
  },
};

function ProviderMark({ provider }: { provider: CloudProvider }) {
  const mark = PROVIDER_MARKS[provider];
  return <svg className="sn-provider-mark" aria-hidden="true" focusable="false" viewBox={mark.viewBox} dangerouslySetInnerHTML={{ __html: mark.paths }} />;
}

export function DataPanel() {
  const { settings, updateSettings } = useNotes();
  const toast = useToast();
  const [openedAt] = useState(() => Date.now());
  // 改了存储位置之后，先显示「迁移到」，确认迁移后才成为当前目录（与现有应用一致）。
  const [current, setCurrent] = useState<StorageLocation>(settings.storageLocation);
  const location = LOCATIONS.find((item) => item.value === settings.storageLocation) ?? LOCATIONS[0];
  const currentPath = (LOCATIONS.find((item) => item.value === current) ?? LOCATIONS[0]).path;
  const target = settings.storageLocation === 'custom' ? settings.customDirectory || location.path : location.path;
  const demo = (action: string) => toast({ message: `${action}（Playground 只演示，不访问文件）` });
  const cloud = settings.cloud;
  const saveCloud = (patch: Partial<CloudSettings>) => updateSettings({ cloud: { ...cloud, ...patch } });
  const [notify, setNotify] = useState(false);

  return (
    <SettingsPage title="数据与同步">
      <SettingsCard title="数据目录">
        <FieldRow>
          <Field label="存储位置">
            <Select
              aria-label="数据存储位置"
              size="sm"
              value={settings.storageLocation}
              onChange={(storageLocation) => updateSettings({ storageLocation })}
              options={LOCATIONS.map(({ value, label }) => ({ value, label }))}
            />
          </Field>
          <Field label="附件" help="不再被任何记录引用的附件会自动清理">
            <span className="sn-set-value">5 个 · 1.2 MB</span>
            <Button size="sm" variant="secondary" icon="trash" onClick={() => toast({ message: '没有未引用的附件', tone: 'success' })}>
              立即清理
            </Button>
          </Field>
        </FieldRow>
        {settings.storageLocation === 'custom' ? (
          <FieldRow>
            <Field label="自定义目录" grow>
              <TextInput
                inputSize="sm"
                className="sn-set-data-input"
                aria-label="自定义数据目录"
                placeholder="例如 D:\SideNotes"
                defaultValue={settings.customDirectory}
                onBlur={(event) => updateSettings({ customDirectory: event.target.value.slice(0, 500) })}
              />
              <Button size="sm" variant="secondary" icon="folder" onClick={() => demo('选择目录')}>
                选择目录
              </Button>
            </Field>
          </FieldRow>
        ) : null}
        {settings.storageLocation !== current ? (
          <FieldRow>
            <Field label="迁移到" help="数据库与附件复制到这里，之后的记录保存在这里；原目录保留作为备份" grow>
              <PathText label="迁移的目标目录" path={target} />
              <Button
                size="sm"
                variant="primary"
                icon="upload"
                onClick={() => {
                  setCurrent(settings.storageLocation);
                  toast({ message: '已迁移到新目录，原目录保留作为备份（示例）', tone: 'success' });
                }}
              >
                迁移到这里
              </Button>
            </Field>
          </FieldRow>
        ) : null}
        <FieldRow>
          <Field label="当前目录" grow>
            <PathText label="当前数据目录" path={currentPath} />
            <IconButton icon="folder" label="打开目录" size="sm" onClick={() => demo('打开目录')} />
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title="快照" help="每天自动创建一份；导入、永久删除、迁移与恢复之前各创建一份。保留 24 小时内的全部，7 天内每天一份，4 周内每周一份">
        <FieldRow>
          <Field label="快照目录" grow>
            <PathText label="快照目录" path={`${currentPath}\\snapshots`} />
            <IconButton icon="folder" label="打开目录" size="sm" onClick={() => demo('打开目录')} />
            <Button size="sm" variant="secondary" icon="edit" onClick={() => demo('更换快照目录')}>
              更换
            </Button>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="已有快照">
            <span className="sn-set-value">{`${SNAPSHOTS.length} 份 · 附件 5 个，1.2 MB`}</span>
            <Button size="sm" variant="secondary" icon="plus" onClick={() => toast({ message: '已创建快照（示例）', tone: 'success' })}>
              立即创建
            </Button>
          </Field>
        </FieldRow>
        <ul className="sn-snapshot-list" aria-label="快照列表">
          {SNAPSHOTS.map((snapshot) => (
            <li key={snapshot.id} className="sn-snapshot">
              <span className="sn-snapshot-time">{formatFullTime(openedAt - snapshot.ago)}</span>
              <span className="sn-snapshot-reason">{snapshot.reason}</span>
              <span className="sn-snapshot-meta">
                {snapshot.notes} 条 · {snapshot.size}
              </span>
              <Button size="sm" variant="secondary" onClick={() => demo('从快照恢复')}>
                恢复
              </Button>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title="导入与导出">
        <FieldRow>
          <Field label="本地备份" help="导出为一个文件夹，含附件；导入时合并到现有记录，附件一同拷回">
            <Button size="sm" variant="secondary" icon="download" onClick={() => demo('导出备份')}>
              导出备份
            </Button>
            <Button size="sm" variant="secondary" icon="upload" onClick={() => demo('导入备份')}>
              导入备份
            </Button>
          </Field>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title="云端自动备份">
        <DataRow label="自动备份">
          <Switch label="启用云端自动备份" hideLabel checked={cloud.enabled} onChange={(enabled) => saveCloud({ enabled })} />
        </DataRow>
        <div className="sn-provider-grid" role="group" aria-label="备份服务">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={cx('sn-provider', cloud.provider === provider.id && 'is-selected')}
              aria-pressed={cloud.provider === provider.id}
              aria-label={`${provider.name}，${provider.protocol}`}
              onClick={() => saveCloud({ provider: provider.id, lastError: '', lastBackup: 0 })}
            >
              <ProviderMark provider={provider.id} />
              <span className="sn-provider-name">{provider.name}</span>
              <span className="sn-provider-protocol">{provider.protocol}</span>
            </button>
          ))}
        </div>
        {cloud.provider === 'synology' ? (
          <DataRow label="WebDAV 地址">
            <TextInput
              key="endpoint"
              inputSize="sm"
              className="sn-set-data-input"
              aria-label="NAS WebDAV 地址"
              placeholder="https://nas.example.com:5006"
              defaultValue={cloud.endpoint}
              onBlur={(event) => saveCloud({ endpoint: event.target.value.slice(0, 500) })}
            />
          </DataRow>
        ) : null}
        <DataRow label="账户">
          <TextInput
            key={`account-${cloud.provider}`}
            inputSize="sm"
            className="sn-set-data-input"
            aria-label="同步账户标识"
            placeholder={cloud.provider === 'synology' ? 'NAS 用户名' : '账户邮箱'}
            defaultValue={cloud.account}
            onBlur={(event) => saveCloud({ account: event.target.value.slice(0, 120) })}
          />
        </DataRow>
        <DataRow label="远程文件夹">
          <TextInput
            key="folder"
            inputSize="sm"
            className="sn-set-data-input"
            aria-label="云端备份文件夹"
            placeholder="SideNotes"
            defaultValue={cloud.folder}
            onBlur={(event) => saveCloud({ folder: event.target.value.slice(0, 240) })}
          />
        </DataRow>
        <DataRow label="状态" value={<span className={cx(cloud.enabled && 'sn-set-warning')}>{cloud.enabled ? '已启用，暂不上传' : '未启用'}</span>}>
          <Button size="sm" variant="secondary" icon="cloud" onClick={() => toast({ message: cloud.enabled ? '云端服务尚未接入桌面版，可先导出本地备份' : '请先启用自动备份' })}>
            云端备份
          </Button>
        </DataRow>
        <DataRow label="失败通知">
          <Button
            size="sm"
            variant="secondary"
            icon="bell"
            onClick={() => {
              setNotify(true);
              saveCloud({ notifications: true });
              toast({ message: '已允许备份失败系统通知（示例）', tone: 'success' });
            }}
          >
            {notify ? '已开启' : '开启通知'}
          </Button>
        </DataRow>
      </SettingsCard>
    </SettingsPage>
  );
}

/* ==================== 回收站 ==================== */

/** 保留天数的预设（现有应用的 PRESETS）。 */
const TRASH_PRESETS = [7, 30, 60, 90, 180, 365];

type TrashView = 'all' | 'expired';
type TrashConfirmState = { kind: 'restore' | 'delete'; notes: Note[] } | null;

/** 回收站中的标题：第一行非空文字，只有图片时显示「图片记录」（现有应用的 trashTitle）。 */
function trashTitle(note: Note): string {
  return note.text.split('\n').find((line) => line.trim()) || noteTitle(note) || '图片记录';
}

export function TrashPanel() {
  const data = useNotes();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [view, setView] = useState<TrashView>('all');
  const [confirm, setConfirm] = useState<TrashConfirmState>(null);
  // 到期判断以打开回收站的时刻为准，避免渲染期读取时钟。
  const [openedAt] = useState(() => Date.now());
  const days = data.settings.trashDays;
  const expired = (note: Note) => isExpired(note, days, openedAt);
  const all = useMemo(() => data.notes.filter((note) => note.status === 'trash').sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)), [data.notes]);
  const tagsOf = (note: Note) => parse(note.text).tags;
  const tagOptions = [...new Set(all.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const activeTag = tagOptions.includes(tag) ? tag : '';
  const keyword = query.trim().toLocaleLowerCase();
  const visible = all.filter(
    (note) =>
      (!keyword || `${note.text} ${note.images.map((image) => image.name).join(' ')}`.toLocaleLowerCase().includes(keyword)) &&
      (!activeTag || tagsOf(note).includes(activeTag)) &&
      (view !== 'expired' || expired(note)),
  );
  const overdue = all.filter(expired);

  const retention = (
    <span className="sn-trash-retention">
      <span className="sn-set-label">保留</span>
      <Combobox
        aria-label="回收站保留天数"
        className="is-number"
        inputMode="numeric"
        wheel={{ min: TRASH_DAYS_RANGE.min, max: TRASH_DAYS_RANGE.max, step: 1 }}
        value={String(days)}
        options={TRASH_PRESETS.map((preset) => ({ value: String(preset), label: `${preset} 天` }))}
        onCommit={(raw) => {
          const next = Number(raw);
          if (!Number.isInteger(next) || next < TRASH_DAYS_RANGE.min || next > TRASH_DAYS_RANGE.max) {
            toast({ message: `请输入 ${TRASH_DAYS_RANGE.min} 至 ${TRASH_DAYS_RANGE.max} 的保留天数`, tone: 'danger' });
            return false;
          }
          data.updateSettings({ trashDays: next });
        }}
      />
      <span className="sn-set-unit">天</span>
      <HelpTip label="保留策略">
        到期后提示清理，确认前仍可恢复
      </HelpTip>
    </span>
  );

  // 保留天数紧跟在条数之后（本次提出）：两者都在说回收站里的记录，放在一起读；页面标题的右侧不再放控件。
  return (
    <SettingsPage title="回收站">
      <div className="sn-trash-toolbar">
        <SearchInput value={query} onValueChange={setQuery} placeholder="搜索回收站" aria-label="搜索回收站" inputSize="sm" />
        <Select aria-label="回收站标签筛选" size="sm" value={activeTag} onChange={setTag} options={[{ value: '', label: '全部标签' }, ...tagOptions.map((item) => ({ value: item, label: `#${item}` }))]} />
        <Select
          aria-label="回收站到期筛选"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: '全部' },
            { value: 'expired', label: '已到期' },
          ]}
        />
      </div>
      <div className="sn-trash-summary">
        <span>
          {visible.length} / {all.length} 条
        </span>
        {retention}
        <span className="sn-spacer" />
        <Button size="sm" variant="secondary" icon="restore" disabled={!visible.length} onClick={() => setConfirm({ kind: 'restore', notes: visible })}>
          恢复筛选结果
        </Button>
        <Button size="sm" variant="secondary" icon="trash" disabled={!overdue.length} onClick={() => setConfirm({ kind: 'delete', notes: overdue })}>
          清理到期项
        </Button>
      </div>
      <div className="sn-trash-list">
        {visible.length === 0 ? (
          <p className="sn-set-empty">{all.length ? '没有匹配的记录' : '回收站为空'}</p>
        ) : (
          visible.map((note) => (
            <article key={note.id} className="sn-trash-item">
              <div className="sn-trash-main">
                <h4 className="sn-trash-title">{trashTitle(note)}</h4>
                <p className={cx('sn-trash-meta', expired(note) && 'is-expired')}>
                  删除于 {formatFullTime(note.deletedAt ?? note.updatedAt)}
                  {expired(note) ? ' · 已到期' : ''}
                </p>
                {tagsOf(note).length ? (
                  <div className="sn-trash-tags">
                    {tagsOf(note)
                      .slice(0, 4)
                      .map((item) => (
                        <span key={item} className="sn-trash-tag">
                          #{item}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="sn-trash-actions">
                <IconButton icon="restore" label="恢复记录" size="sm" onClick={() => setConfirm({ kind: 'restore', notes: [note] })} />
                <IconButton icon="trash" label="永久删除" size="sm" onClick={() => setConfirm({ kind: 'delete', notes: [note] })} />
              </div>
            </article>
          ))
        )}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'delete' ? '永久删除' : '恢复记录'}
        description={
          confirm?.kind === 'delete'
            ? `永久删除这 ${confirm.notes.length} 条记录及其附件？删除前会先创建一份快照，需要时可以在「数据与同步 › 快照」中恢复。`
            : `将恢复这 ${confirm?.notes.length ?? 0} 条记录至删除前的位置。`
        }
        confirmLabel={confirm?.kind === 'delete' ? '永久删除' : '确认恢复'}
        danger={confirm?.kind === 'delete'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const ids = confirm.notes.map((note) => note.id);
          if (confirm.kind === 'delete') {
            data.removeForever(ids);
            toast({ message: `已永久删除 ${ids.length} 条记录`, tone: 'success' });
          } else {
            data.restore(ids);
            toast({ message: `已恢复 ${ids.length} 条记录`, tone: 'success' });
          }
          setConfirm(null);
        }}
      />
    </SettingsPage>
  );
}

/* ==================== 关于 ==================== */

const CREDITS: ReadonlyArray<{ name: string; glyph: string; note: string }> = [
  { name: 'Tauri', glyph: '◈', note: '桌面与跨平台运行时' },
  { name: 'React', glyph: '⚛', note: '界面方案参考' },
  { name: 'Vite', glyph: 'ϟ', note: '开发与构建工具' },
  { name: 'SQLite', glyph: '▱', note: '本地数据方案参考' },
  { name: 'Filee', glyph: '▣', note: '桌面外观与交互参考' },
  { name: 'Maple Mono', glyph: 'Aa', note: '内置默认字体 Maple Mono NF CN，SIL Open Font License 1.1' },
];

/** 小块按钮：项目链接、开源致谢与调试共用；外部链接带一个斜箭头。 */
function LinkChip({ icon, glyph, label, external = false, onClick }: { icon?: IconName; glyph?: string; label: string; external?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="sn-link-chip" onClick={onClick}>
      {icon ? <Icon name={icon} /> : null}
      {glyph ? (
        <span className="sn-link-glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {label}
      {external ? <Icon name="arrow-up-right" /> : null}
    </button>
  );
}

export function AboutPanel() {
  const toast = useToast();
  const [update, setUpdate] = useState(false);
  const open = (label: string) => toast({ message: `打开${label}（示例）` });
  return (
    <SettingsPage title="关于">
      <div className="sn-about-hero">
        <AppIcon />
        <div className="sn-about-text">
          <h3 className="sn-about-name">SideNotes</h3>
          <p className="sn-about-tagline">藏在屏幕边上的速记本</p>
        </div>
        <span className="sn-about-version">桌面预览版 {__APP_VERSION__}</span>
      </div>
      <section className="sn-about-section">
        <h4 className="sn-set-card-title">项目</h4>
        <div className="sn-chip-row">
          <LinkChip icon="code" label="GitHub" external onClick={() => open('GitHub')} />
          <LinkChip icon="globe" label="官方网站" external onClick={() => open('官方网站')} />
          <LinkChip icon="heart" label="支持项目" onClick={() => toast({ message: '赞助入口暂未开放，欢迎通过反馈与代码贡献支持项目' })} />
          {/* 检查到新版本时打开与底栏版本号相同的「发现新版本」弹窗，没有新版本时提示已是最新版本；Playground 模拟检查到 0.7.3。 */}
          <LinkChip icon="restore" label="检查更新" onClick={() => (AVAILABLE_UPDATE ? setUpdate(true) : toast({ message: '已是最新版本' }))} />
        </div>
      </section>
      <section className="sn-about-section">
        <h4 className="sn-set-card-title">开源致谢</h4>
        <div className="sn-chip-row">
          {CREDITS.map((credit) => (
            <LinkChip key={credit.name} glyph={credit.glyph} label={credit.name} external onClick={() => open(credit.name)} />
          ))}
        </div>
      </section>
      {/* 调试只有一个按钮（本次提出）：桌面端打开侧栏窗口的开发者工具。网页不能自己打开浏览器的开发者工具，Playground 中提示按 F12。 */}
      <section className="sn-about-section">
        <h4 className="sn-set-card-title">调试</h4>
        <div className="sn-chip-row">
          <LinkChip icon="code" label="打开开发者工具" onClick={() => toast({ message: '浏览器不允许网页打开开发者工具，请按 F12（桌面端会直接打开）' })} />
        </div>
      </section>
      <UpdateDialog update={AVAILABLE_UPDATE} open={update} onClose={() => setUpdate(false)} />
    </SettingsPage>
  );
}
