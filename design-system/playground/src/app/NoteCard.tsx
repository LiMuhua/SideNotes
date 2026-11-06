/**
 * 记录卡片。
 *
 * 交互沿用现有应用：指针移到卡片上或单击即选中（悬停与单击共用一个高亮），双击进入编辑，
 * 右键打开卡片菜单，点时间收起或展开正文，点 Emoji 更换，点标签按标签筛选；
 * 编辑时 Ctrl+Enter 保存、Esc 取消，焦点离开卡片即保存并回到预览。
 * 正文超过设置中的最大高度时渐隐，双击查看全文。
 *
 * 本次提出的补充（见 interactions.md）：卡片可以用 ↑ ↓ 逐张聚焦，Enter 编辑，Delete 移入回收站；
 * 操作按钮移到标题行，只在悬停、选中或聚焦时显示，不再单独占一行；底部只在有标签时显示标签。
 * 单行记录与收起的记录只剩标题行。
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Markdown, MarkdownInline } from '@/components/Markdown';
import { noteDisplay, sourceOffset } from '@/core/display';
import { formatFullTime, formatTime, noteTitle } from '@/core/notes';
import { parse } from '@/core/tags';
import type { Note, TabKey } from '@/core/types';
import { NoteEditor } from '../content/NoteEditor';
import { useSurface, cx } from '../ui/context';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Keys } from '../ui/Misc';
import { SHORTCUT_KEYS } from './shortcuts';

export interface NoteCardProps {
  note: Note;
  tab: TabKey;
  /** 高亮：悬停或单击选中。 */
  active: boolean;
  /** 多选中。 */
  checked: boolean;
  editing: boolean;
  /** 另一张卡片正在编辑，本卡片变淡。 */
  dimmed: boolean;
  /** 正文最大高度（设置中的「卡片高度」，按 13px 字号计的像素）。 */
  maxHeight: number;
  tabIndex: number;
  onHover: (id: string | null) => void;
  onSelect: (event: MouseEvent) => void;
  onEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onMenu: (point: { x: number; y: number }) => void;
  onCopy: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleCollapse: () => void;
  onTag: (tag: string) => void;
  onEmoji: () => void;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function NoteCard(props: NoteCardProps) {
  const { note, active, checked, editing, dimmed, maxHeight } = props;
  const surface = useSurface();
  const content = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);
  const display = noteDisplay(note.text);
  const titleText = display.firstLine.replace(/^#{1,6}\s+/, '');
  const tags = parse(note.text).tags;

  // 正文实际溢出时渐隐；图片加载、字号变化后由 ResizeObserver 复核。
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setTruncated(element.scrollHeight > element.clientHeight + 2));
    observer.observe(element);
    return () => observer.disconnect();
  }, [editing, note.collapsed]);

  return (
    <article
      className={cx(
        'sn-note',
        active && 'is-active',
        checked && 'is-checked',
        editing && 'is-editing',
        dimmed && 'is-dimmed',
        note.collapsed && 'is-collapsed',
        truncated && !note.collapsed && !editing && 'is-truncated',
      )}
      data-note-id={note.id}
      tabIndex={props.tabIndex}
      aria-label={noteTitle(note)}
      aria-current={active ? 'true' : undefined}
      onMouseEnter={() => props.onHover(note.id)}
      onMouseLeave={() => props.onHover(null)}
      onClick={(event) => {
        if (!editing) props.onSelect(event);
      }}
      onDoubleClick={(event) => {
        if (editing || (event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        props.onEdit();
      }}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        event.stopPropagation();
        props.onMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={props.onKeyDown}
    >
      <header className="sn-note-head">
        <button
          type="button"
          className="sn-note-emoji"
          aria-label="更换 Emoji"
          title="更换 Emoji"
          onClick={(event) => {
            event.stopPropagation();
            props.onEmoji();
          }}
        >
          {note.emoji}
        </button>
        <h3 className="sn-note-title">{display.structured ? noteTitle(note) : <MarkdownInline text={titleText} />}</h3>
        {note.pinned && props.tab !== 'pinned' ? <Icon name="pin" className="sn-note-pin" /> : null}
        {editing ? null : (
          <div className="sn-note-actions" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            <IconButton icon="copy" label="复制记录与附件" size="sm" onClick={props.onCopy} />
            {note.status === 'active' ? (
              <IconButton icon={note.pinned ? 'pin-off' : 'pin'} label={note.pinned ? '取消置顶' : '置顶记录'} size="sm" onClick={props.onTogglePin} />
            ) : null}
            <IconButton
              icon={note.status === 'archived' ? 'restore' : 'archive'}
              label={note.status === 'archived' ? '恢复记录' : '归档记录'}
              size="sm"
              onClick={props.onToggleArchive}
            />
            <IconButton
              icon="more"
              label="更多操作"
              size="sm"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                props.onMenu({ x: box.left, y: box.bottom });
              }}
            />
          </div>
        )}
        <button
          type="button"
          className="sn-note-time"
          aria-label={`${note.collapsed ? '展开' : '收起'}记录正文`}
          title={`创建：${formatFullTime(note.createdAt)}\n修改：${formatFullTime(note.updatedAt)}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleCollapse();
          }}
        >
          {formatTime(note.updatedAt)}
          <Icon name="chevron-down" className="sn-note-time-chevron" />
        </button>
      </header>

      {editing ? (
        <NoteEditArea text={note.text} inlineShortcuts={surface.inlineShortcuts} onSave={props.onSave} onCancel={props.onCancel} />
      ) : note.collapsed || !display.body.trim() ? null : (
        <div
          ref={content}
          className="sn-note-body"
          style={{ maxHeight }}
          title={truncated ? '内容较长，双击卡片查看全文' : undefined}
        >
          <Markdown
            text={display.body}
            className="sn-note-markdown"
            handlers={{
              // 位置相对显示正文（去掉了标题行），换算回原文后切换待办。
              onTaskToggle: (offset, value) => {
                const at = sourceOffset(note.text, display, offset);
                props.onTextChange(`${note.text.slice(0, at)}${value ? 'x' : ' '}${note.text.slice(at + 1)}`);
              },
            }}
          />
        </div>
      )}

      {editing || note.collapsed || !tags.length ? null : (
        <footer className="sn-note-tags">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="sn-note-tag"
              onClick={(event) => {
                event.stopPropagation();
                props.onTag(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </footer>
      )}
    </article>
  );
}

/**
 * 编辑区：进入编辑时挂载，草稿取进入编辑那一刻的原文。
 * Ctrl+Enter 保存，Esc 取消；焦点离开编辑区（例如点到卡片之外）时保存并回到预览。
 * 编辑栏的按钮按下时不抢焦点，点「取消」不会先触发失焦保存。
 */
function NoteEditArea({ text, inlineShortcuts, onSave, onCancel }: { text: string; inlineShortcuts: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(text);
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  return (
    <div
      className="sn-note-editor"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onSave(draft);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onSave(draft);
      }}
    >
      <NoteEditor value={draft} onChange={setDraft} autoFocus ariaLabel="编辑记录" minHeight={60} maxHeight={320} />
      <div className="sn-note-edit-bar">
        <div className="sn-note-tools">
          <IconButton icon="image" label="添加图片" size="sm" onMouseDown={keepFocus} />
          <IconButton icon="file" label="引用文件" size="sm" onMouseDown={keepFocus} />
        </div>
        {inlineShortcuts ? <Keys combo={SHORTCUT_KEYS.save} /> : null}
        <IconButton icon="x" label="取消修改 · Esc" size="sm" onMouseDown={keepFocus} onClick={onCancel} />
        <IconButton icon="check" label={`保存修改 · ${SHORTCUT_KEYS.save}`} size="sm" variant="primary" onMouseDown={keepFocus} onClick={() => onSave(draft)} />
      </div>
    </div>
  );
}
