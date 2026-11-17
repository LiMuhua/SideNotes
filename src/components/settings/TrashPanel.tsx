/**
 * 回收站（原型第二版，与交互原型 settings.js 的 renderTrash 相同）。
 *
 * 上面是搜索框与标签、到期两个筛选；下一行是「N / M 条」，保留天数紧跟在条数之后（两者都在说回收站里的记录），
 * 右边是两个批量操作；下面是记录卡片，到期的写「已到期」并标成警告色。按搜索的快捷键（默认 Ctrl+F）聚焦搜索框并全选。
 * 恢复与永久删除都经过二次确认（桌面端的做法）。
 */

import { useEffect, useRef, useState } from 'react';
import * as store from '../../core/store';
import { matches } from '../../core/shortcuts';
import { parse } from '../../core/tags';
import type { Note, Settings } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { Icon } from '../Icon';
import { useConfirm } from './confirm';
import { ActionButton, Help, NumberCombobox, SelectField, fullTime, type SaveSettings } from './controls';

const DAY = 86_400_000;
/** 保留天数的常用值，与原型相同。 */
const RETENTION_CHOICES: ReadonlyArray<readonly [number, string]> = [7, 30, 60, 90, 180, 365].map(
  (days) => [days, `${days} 天`] as const,
);

/** 记录标题：第一行非空文字，纯图片记录显示为「图片记录」。 */
function trashTitle(note: Note): string {
  return note.text.split('\n').find((line) => line.trim()) || '图片记录';
}

export function TrashPanel({ notes, settings, save }: { notes: Note[]; settings: Settings; save: SaveSettings }) {
  const toast = useToast();
  const confirm = useConfirm();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [view, setView] = useState<'all' | 'expired'>('all');
  // 到期判断以打开回收站的时刻为准，避免渲染期读取时钟。
  const [now] = useState(() => Date.now());

  const retain = settings.trashDays * DAY;
  const expired = (note: Note): boolean => Boolean(note.deletedAt) && now - (note.deletedAt ?? 0) > retain;
  const all = notes
    .filter((note) => note.status === 'trash')
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const tagsOf = (note: Note): string[] => parse(note.text).tags;
  const tagOptions = [...new Set(all.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const activeTag = tagOptions.includes(tag) ? tag : '';
  const keyword = query.trim().toLocaleLowerCase();
  const visible = all.filter(
    (note) =>
      (!keyword ||
        `${note.text} ${note.images.map((image) => image.name).join(' ')}`.toLocaleLowerCase().includes(keyword)) &&
      (!activeTag || tagsOf(note).includes(activeTag)) &&
      (view !== 'expired' || expired(note)),
  );
  const overdue = all.filter(expired);

  // 按搜索的快捷键（默认 Ctrl+F）聚焦搜索框并全选（原型 app.js 的回收站分支）。
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !matches(event, store.getState().settings.shortcuts, 'search')) return;
      event.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const restore = (targets: Note[]): void => {
    if (!targets.length) return;
    confirm({
      title: '恢复记录',
      message: `将恢复这 ${targets.length} 条记录至删除前的位置。`,
      confirmLabel: '确认恢复',
      icon: 'restore',
      run: async () => {
        const ok = await store.restoreFromTrash(targets.map((note) => note.id));
        if (ok) toast(`已恢复 ${targets.length} 条记录`);
        else toast('恢复失败，请重试', null, true);
        return ok;
      },
    });
  };

  const remove = (targets: Note[]): void => {
    if (!targets.length) return;
    confirm({
      title: '永久删除',
      message: `永久删除这 ${targets.length} 条记录及其附件？删除前会先创建一份快照，需要时可以在「数据与同步 › 快照」中恢复。`,
      confirmLabel: '永久删除',
      icon: 'trash',
      danger: true,
      run: async () => {
        const failed = await store.snapshotBefore('delete');
        if (failed) toast(`删除前的快照未创建：${failed}`, null, true);
        const ok = await store.deleteForever(targets.map((note) => note.id));
        if (ok) toast(`已永久删除 ${targets.length} 条记录`);
        else toast('删除失败，请重试', null, true);
        return ok;
      },
    });
  };

  return (
    <>
      <div className="settings-trash-toolbar">
        <label className="settings-search">
          <Icon name="search" />
          <input
            ref={searchInput}
            className="form-control"
            type="search"
            placeholder="搜索回收站"
            aria-label="搜索回收站"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <SelectField
          label="回收站标签筛选"
          options={[['', '全部标签'], ...tagOptions.map((item) => [item, `#${item}`] as const)]}
          value={activeTag}
          onChange={setTag}
        />
        <SelectField
          label="回收站到期筛选"
          options={[
            ['all', '全部'],
            ['expired', '已到期'],
          ]}
          value={view}
          onChange={(next) => setView(next === 'expired' ? 'expired' : 'all')}
        />
      </div>
      <div className="settings-trash-summary">
        <span className="settings-trash-count">{`${visible.length} / ${all.length} 条`}</span>
        <span className="trash-retention">
          <span className="settings-row-label">保留</span>
          <NumberCombobox
            label="回收站保留天数"
            value={settings.trashDays}
            options={RETENTION_CHOICES}
            min={1}
            max={365}
            step={1}
            unit="天"
            onCommit={(trashDays) => save({ trashDays })}
          />
          <Help title="保留策略" description="到期后提示清理，确认前仍可恢复" />
        </span>
        <span className="settings-spacer" />
        <ActionButton label="恢复筛选结果" icon="restore" disabled={!visible.length} onClick={() => restore(visible)} />
        <ActionButton label="清理到期项" icon="trash" disabled={!overdue.length} onClick={() => remove(overdue)} />
      </div>
      <div className="settings-trash-list">
        {visible.length === 0 ? (
          <p className="settings-empty">{all.length ? '没有匹配的记录' : '回收站为空'}</p>
        ) : (
          visible.map((note) => {
            const overdueNote = expired(note);
            const noteTags = tagsOf(note);
            return (
              <article key={note.id} className="settings-trash-item">
                <div className="trash-item-main">
                  <h4 className="trash-title">{trashTitle(note)}</h4>
                  <p className={overdueNote ? 'trash-item-meta is-expired' : 'trash-item-meta'}>
                    {`删除于 ${fullTime(note.deletedAt || note.updatedAt)}${overdueNote ? ' · 已到期' : ''}`}
                  </p>
                  {noteTags.length ? (
                    <div className="trash-tags">
                      {noteTags.slice(0, 4).map((item) => (
                        <span key={item} className="trash-tag">
                          {`#${item}`}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="trash-item-actions">
                  <ActionButton label="恢复记录" icon="restore" className="icon-button" onClick={() => restore([note])} />
                  <ActionButton label="永久删除" icon="trash" className="icon-button" onClick={() => remove([note])} />
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
