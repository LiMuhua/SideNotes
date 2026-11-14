/**
 * 记录卡片。
 *
 * 交互沿用现有应用：指针移到卡片上或单击即选中（悬停与单击共用一个高亮），双击进入编辑，
 * 右键打开卡片菜单，点时间收起或展开正文，点 Emoji 更换，点标签按标签筛选；时间显示创建时间。
 * 编辑时 Ctrl+Enter 保存、Esc 取消，焦点离开卡片即保存并回到预览。
 * 正文超过设置中的最大高度时渐隐，双击查看全文。
 *
 * 本次提出的补充（见 interactions.md）：卡片可以用 ↑ ↓ 逐张聚焦，Enter 编辑，Delete 移入回收站；
 * 操作按钮移到标题行右侧，与时间共用一个位置：平时显示时间，悬停、选中或聚焦时换成操作按钮，
 * 收起按钮在操作按钮的最右边，正好落在时间原来的位置。这个位置的宽度取两者中较宽的一个，
 * 所以标题的宽度在悬停前后不变，不会因为按钮出现而被挤短；标题最多显示两行。
 * 底部只在有标签时显示标签，单行记录与收起的记录只剩标题行。
 * 列表只占一个 Tab 停靠点：只有可聚焦的那一张卡片里的按钮进入 Tab 顺序，其余卡片的按钮只响应指针。
 */

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Markdown, MarkdownInline } from '@/components/Markdown';
import { noteDisplay, sourceOffset } from '@/core/display';
import { formatTime, noteTitle } from '@/core/notes';
import { parse } from '@/core/tags';
import type { Note } from '@/core/types';
import type { SidebarTab } from '../model/notes';
import { NoteEditor } from '../content/NoteEditor';
import { useSurface, cx } from '../ui/context';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Keys } from '../ui/Misc';
import { SHORTCUT_KEYS } from './shortcuts';

export interface NoteCardProps {
  note: Note;
  tab: SidebarTab;
  /** 高亮：悬停或单击选中。 */
  active: boolean;
  /** 多选中。 */
  checked: boolean;
  editing: boolean;
  /** 进入编辑时把焦点放进编辑区；组件页的常驻示例不抢焦点。 */
  editAutoFocus?: boolean;
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
  const innerTab = props.tabIndex === 0 ? 0 : -1;

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
          tabIndex={innerTab}
          aria-label="更换 Emoji"
          onClick={(event) => {
            event.stopPropagation();
            props.onEmoji();
          }}
        >
          {note.emoji}
        </button>
        <h3 className="sn-note-title">{display.structured ? noteTitle(note) : <MarkdownInline text={titleText} />}</h3>
        <div className="sn-note-side">
          <div className="sn-note-meta">
            {note.pinned && props.tab !== 'pinned' ? <Icon name="pin" className="sn-note-pin" /> : null}
            <button
              type="button"
              className="sn-note-time"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleCollapse();
              }}
            >
              {formatTime(note.createdAt)}
            </button>
          </div>
          <div className="sn-note-actions" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            {/* 置顶排在最前；已置顶时保持强调色，与平时标题行右侧的置顶标记同色，悬停时不会一下子找不到它。 */}
            {note.status === 'active' ? (
              <IconButton
                icon={note.pinned ? 'pin-off' : 'pin'}
                label={note.pinned ? '取消置顶' : '置顶记录'}
                size="sm"
                tabIndex={innerTab}
                className={cx('sn-note-pin-toggle', note.pinned && 'is-pinned')}
                onClick={props.onTogglePin}
              />
            ) : null}
            {/* 第四次反馈去掉了归档：操作按钮是置顶、复制、更多与收起。 */}
            <IconButton icon="copy" label="复制记录与附件" size="sm" tabIndex={innerTab} onClick={props.onCopy} />
            <IconButton
              icon="more"
              label="更多操作"
              size="sm"
              tabIndex={innerTab}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                props.onMenu({ x: box.left, y: box.bottom });
              }}
            />
            <IconButton
              icon="chevron-down"
              label={note.collapsed ? '展开正文' : '收起正文'}
              aria-expanded={!note.collapsed}
              size="sm"
              tabIndex={innerTab}
              className={cx('sn-note-collapse', note.collapsed && 'is-collapsed')}
              onClick={props.onToggleCollapse}
            />
          </div>
        </div>
      </header>

      {editing ? (
        <NoteEditArea
          text={note.text}
          autoFocus={props.editAutoFocus ?? true}
          inlineShortcuts={surface.inlineShortcuts}
          onSave={props.onSave}
          onCancel={props.onCancel}
        />
      ) : note.collapsed || !display.body.trim() ? null : (
        <div
          ref={content}
          className="sn-note-body"
          style={{ maxHeight }}
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
              tabIndex={innerTab}
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
function NoteEditArea({
  text,
  autoFocus,
  inlineShortcuts,
  onSave,
  onCancel,
}: {
  text: string;
  autoFocus: boolean;
  inlineShortcuts: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
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
      <NoteEditor value={draft} onChange={setDraft} autoFocus={autoFocus} ariaLabel="编辑记录" minHeight={100} maxHeight={300} />
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
