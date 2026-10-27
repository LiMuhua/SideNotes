/**
 * 回收站。
 *
 * 结构对应原型 settings.js 的 renderTrash 与 retentionPicker：
 * 保留天数并入分类标题栏，主体为搜索、标签与到期筛选、批量操作和记录卡片；
 * 恢复与永久删除都经过二次确认。
 */

import { useId, useRef, useState } from 'react';
import * as store from '../../core/store';
import { boundedNumber } from '../../core/settings';
import { parse } from '../../core/tags';
import type { Note, Settings } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from './confirm';
import { ActionButton, Help, SelectField, fullTime, type SaveSettings } from './controls';

const DAY = 86_400_000;
const PRESETS = [7, 30, 60, 90, 180, 365];

/** 保留天数：可直接输入，也可从预设中选择。 */
function RetentionPicker({ days, save }: { days: number; save: SaveSettings }) {
  const toast = useToast();
  const menuId = `trash-retention-options-${useId()}`;
  // 编辑中的输入记为草稿，未编辑时显示已保存的天数。
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    const raw = draft;
    const next = boundedNumber(raw, 1, 365);
    if (next === null) {
      setDraft(null);
      toast('请输入 1 至 365 的保留天数', null, true);
      return;
    }
    const saved = next === days || (await save({ trashDays: next }));
    setDraft(null);
    if (saved && next !== Number(raw)) toast(`保留天数已调整为 ${next} 天（1–365 天）`);
  };

  const choosePreset = async (preset: number): Promise<void> => {
    if (!(await save({ trashDays: preset }))) return;
    setDraft(null);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div
      className="trash-retention-control"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          input.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        ref={input}
        className="trash-retention-days"
        type="number"
        min={1}
        max={365}
        step={1}
        value={draft ?? String(days)}
        title="保留 1–365 天"
        aria-label="回收站保留天数"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (skipBlur.current) skipBlur.current = false;
          else void commit();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Enter') void commit();
          else setDraft(null);
          setOpen(false);
          skipBlur.current = true;
          event.currentTarget.blur();
        }}
      />
      <span className="trash-retention-unit">天</span>
      <ActionButton
        label="选择预设天数"
        aria-label="选择保留天数预设"
        icon="chevron-down"
        className="icon-button trash-retention-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      />
      <div className="trash-retention-options" role="listbox" aria-label="保留天数预设" id={menuId} hidden={!open}>
        {PRESETS.map((preset) => (
          <ActionButton
            key={preset}
            label={`${preset} 天`}
            className="trash-retention-option"
            data-days={String(preset)}
            role="option"
            aria-selected={preset === days}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void choosePreset(preset)}
          />
        ))}
        <ActionButton
          label="自定义…"
          className="trash-retention-option"
          role="option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(false);
            input.current?.focus();
            input.current?.select();
          }}
        />
      </div>
    </div>
  );
}

/** 标题栏右侧的保留策略。 */
export function TrashRetention({ days, save }: { days: number; save: SaveSettings }) {
  return (
    <div className="trash-retention-inline">
      <span className="trash-retention-label">保留</span>
      <RetentionPicker days={days} save={save} />
      <Help title="保留策略" description="默认 30 天；到期后提示清理，确认前仍可恢复。" />
    </div>
  );
}

/** 记录标题：第一行非空文字，纯图片记录显示为「图片记录」。 */
function trashTitle(note: Note): string {
  return note.text.split('\n').find((line) => line.trim()) || '图片记录';
}

export function TrashPanel({ notes, settings }: { notes: Note[]; settings: Settings }) {
  const toast = useToast();
  const confirm = useConfirm();
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
      message: `永久删除这 ${targets.length} 条记录及其附件？此操作无法撤销。`,
      confirmLabel: '永久删除',
      icon: 'trash',
      danger: true,
      run: async () => {
        const ok = await store.deleteForever(targets.map((note) => note.id));
        if (ok) toast(`已永久删除 ${targets.length} 条记录`);
        else toast('删除失败，请重试', null, true);
        return ok;
      },
    });
  };

  return (
    <>
      <div className="settings-trash-toolbar settings-search-row">
        <input
          className="form-control"
          type="search"
          placeholder="搜索回收站"
          aria-label="搜索回收站"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
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
      <div className="trash-toolbar settings-inline">
        <span className="settings-trash-summary setting-description">
          {visible.length} / {all.length} 条
        </span>
        <ActionButton label="恢复筛选结果" icon="restore" disabled={!visible.length} onClick={() => restore(visible)} />
        <ActionButton label="清理到期项" icon="trash" disabled={!overdue.length} onClick={() => remove(overdue)} />
      </div>
      <div className="settings-trash-list">
        {visible.length === 0 ? (
          <div className="empty-state">{all.length ? '没有匹配的记录' : '回收站为空'}</div>
        ) : (
          visible.map((note) => (
            <article key={note.id} className="settings-trash-item trash-card">
              <div className="trash-item-main">
                <h4 className="trash-title">{trashTitle(note)}</h4>
                <p className="trash-item-meta">
                  删除于 {fullTime(note.deletedAt || note.updatedAt)}
                  {expired(note) ? ' · 已到期' : ''}
                </p>
                <div className="trash-tags">
                  {tagsOf(note)
                    .slice(0, 4)
                    .map((item) => (
                      <span key={item} className="trash-tag">
                        {`#${item}`}
                      </span>
                    ))}
                </div>
              </div>
              <div className="trash-item-actions">
                <ActionButton label="恢复记录" icon="restore" className="icon-button" onClick={() => restore([note])} />
                <ActionButton label="永久删除" icon="trash" className="icon-button" onClick={() => remove([note])} />
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}
