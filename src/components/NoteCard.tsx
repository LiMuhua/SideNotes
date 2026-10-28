/**
 * 记录卡片。
 *
 * 结构与原型一致：Emoji、标题、时间按钮、正文、标签行与操作行；
 * 正文限高并在溢出时显示「展开全文」，折叠状态只保留标题行与操作行。
 * 编辑态直接在卡片内嵌入实时 Markdown 编辑面，确认前不写入记录。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { LiveEditor } from './LiveEditor';
import { TagInput } from './TagInput';
import { Markdown, MarkdownInline } from './Markdown';
import { formatTime, likelyLong, noteTitle } from '../core/notes';
import { parse } from '../core/tags';
import { noteDisplay, sourceOffset } from '../core/display';
import type { EditSession, Note, NoteImage } from '../core/types';
import type { MarkdownEditor } from '../core/editor';

export interface NoteCardProps {
  note: Note;
  /** 当前编辑事务，仅当 id 匹配时进入编辑态。 */
  editing: EditSession | null;
  /** 是否处于多选状态。 */
  selected: boolean;
  /** 记录菜单正为这张卡片打开。 */
  menuOpen: boolean;
  /** 拖动图片或引用时，这张卡片是放下的目标。 */
  itemTarget: boolean;
  /** 标签整理模式：显示标签删除按钮。 */
  tagsExpanded: boolean;
  /** 长按待启动排序的视觉反馈。 */
  sortPending: boolean;
  /** 被按住拖动的卡片。 */
  sorting: boolean;
  /** 随本次拖动一起移动的卡片。 */
  sortingMember: boolean;
  /** 拖动落点提示。 */
  dropHint: 'before' | 'after' | null;

  onEditChange: (text: string) => void;
  onEditReady: (editor: MarkdownEditor) => void;
  onEditBlur: () => void;
  onFinishEdit: () => void;
  onCancelEdit: () => void;
  onRemoveEditImage: (imageId: string) => void;
  onAttachEditImage: () => void;
  onAttachEditFile: () => void;

  onChooseEmoji: () => void;
  onToggleCollapse: () => void;
  onExpand: () => void;
  onCopy: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onMore: (anchor: HTMLElement) => void;
  onFilterTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRenameTag: (tag: string, next: string) => void;
  onToggleTagsExpanded: () => void;
  onPreviewImage: (src: string, alt: string) => void;
  onOpenFile: (path: string) => void;
  onTaskToggle: (offset: number, checked: boolean) => void;
}

/** 卡片内的图片附件列表。 */
function Attachments({
  images,
  onPreview,
  onRemove,
}: {
  images: NoteImage[];
  onPreview: (image: NoteImage) => void;
  onRemove?: (id: string) => void;
}) {
  if (!images.length) return null;
  return (
    <div className="attachment-list note-edit-attachments">
      {images.map((image) => (
        <div key={image.id} className="attachment-item">
          <button
            type="button"
            className="attachment-preview note-image-button"
            aria-label={`预览 ${image.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onPreview(image);
            }}
          >
            <img src={image.data} alt={image.name} />
          </button>
          {onRemove ? (
            <button
              type="button"
              className="icon-button attachment-remove"
              aria-label={`移除 ${image.name}`}
              title={`移除 ${image.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(image.id);
              }}
            >
              <Icon name="x" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 标签行：可筛选、可就地重命名、可在整理模式下移除。 */
function TagRow({
  tags,
  expanded,
  onFilter,
  onRemove,
  onRename,
  onToggleExpanded,
}: {
  tags: string[];
  expanded: boolean;
  onFilter: (tag: string) => void;
  onRemove: (tag: string) => void;
  onRename: (tag: string, next: string) => void;
  onToggleExpanded: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // 与原型一致：单击标签延迟筛选，留出双击改名的判断时间。立即筛选会让列表重排，第二下点到别处。
  const filterTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(filterTimer.current), []);

  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  /** 提交重命名；空值或未变化时直接退出。 */
  const commit = useCallback(() => {
    if (!renaming) return;
    const next = draft.trim().replace(/^#/, '');
    if (next && next !== renaming) onRename(renaming, next);
    setRenaming(null);
  }, [draft, renaming, onRename]);

  return (
    <div className={expanded ? 'note-tags tags-expanded' : 'note-tags'}>
      {tags.map((tag) =>
        renaming === tag ? (
          <TagInput
            key={tag}
            ref={input}
            className="tag-rename-input"
            type="text"
            maxLength={40}
            value={draft}
            exclude={tags.filter((item) => item !== tag)}
            grow
            aria-label="修改此记录的标签"
            title="Enter 确认，Esc 取消；输入时 Tab 选用联想的标签"
            onValueChange={setDraft}
            onClick={(event) => event.stopPropagation()}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                commit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setRenaming(null);
              }
            }}
          />
        ) : (
          <span key={tag} className="tag-chip-wrap">
            <button
              type="button"
              className="tag-chip"
              onClick={(event) => {
                event.stopPropagation();
                window.clearTimeout(filterTimer.current);
                if (!expanded) filterTimer.current = window.setTimeout(() => onFilter(tag), 550);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                window.clearTimeout(filterTimer.current);
                setDraft(tag);
                setRenaming(tag);
              }}
            >
              <span>{`#${tag}`}</span>
            </button>
            <button
              type="button"
              className="icon-button tag-remove"
              aria-label={`从此记录移除 #${tag}`}
              title={`从此记录移除 #${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(tag);
              }}
            >
              <Icon name="x" />
            </button>
          </span>
        ),
      )}
      {tags.length ? (
        <button
          type="button"
          className="tags-more"
          aria-label={expanded ? '收起标签' : '展开并管理标签'}
          title={expanded ? '收起标签' : '展开并管理标签'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
        >
          <Icon name="more" />
        </button>
      ) : null}
    </div>
  );
}

/** 记录卡片。 */
export const NoteCard = memo(function NoteCard(props: NoteCardProps) {
  const { note, editing } = props;
  const isEditing = editing !== null && editing.id === note.id;
  const parsed = parse(note.text);
  const content = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(() => likelyLong(note));

  // 正文实际溢出才显示「展开全文」，图片加载后需要复核。
  useEffect(() => {
    const target = content.current;
    if (!target || isEditing) return;
    const measure = (): void => {
      setTruncated(target.scrollHeight > target.clientHeight + 2);
    };
    const frame = window.requestAnimationFrame(measure);
    const images = Array.from(target.querySelectorAll('img'));
    images.forEach((image) => {
      image.addEventListener('load', measure);
      image.addEventListener('error', measure);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      images.forEach((image) => {
        image.removeEventListener('load', measure);
        image.removeEventListener('error', measure);
      });
    };
  }, [note.text, note.images.length, isEditing, note.collapsed]);

  const classes = [
    'note-card',
    note.pinned ? 'is-pinned' : '',
    isEditing ? 'is-editing' : '',
    note.collapsed ? 'is-collapsed' : '',
    props.selected ? 'is-selected' : '',
    props.menuOpen ? 'is-menu-open' : '',
    props.itemTarget ? 'is-drop-target' : '',
    props.sortPending ? 'is-sort-pending' : '',
    props.sorting ? 'is-sorting' : '',
    props.sortingMember ? 'is-sorting-member' : '',
    props.dropHint === 'before' ? 'drop-before' : '',
    props.dropHint === 'after' ? 'drop-after' : '',
    truncated && !note.collapsed ? 'is-truncated' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = noteTitle(note);
  // 首行若是结构化内容（代码、列表、引用、图片等），标题不复用该行文本，正文从头显示。
  const display = noteDisplay(note.text);

  return (
    <article
      className={classes}
      data-note-id={note.id}
      tabIndex={0}
      aria-label={title}
      aria-selected={props.selected}
      title={isEditing ? undefined : '双击编辑，右键查看更多操作，长按拖动排序'}
      // 编辑中焦点离开整张卡片（而不只是编辑面）才算失焦，卡片内的工具按钮不打断编辑。
      onBlur={isEditing ? props.onEditBlur : undefined}
    >
      <header className="note-header">
        <button
          type="button"
          className="note-emoji"
          aria-label="选择记录 Emoji"
          title="更换 Emoji"
          onClick={(event) => {
            event.stopPropagation();
            props.onChooseEmoji();
          }}
        >
          {note.emoji || '📝'}
        </button>
        <h3 className="note-title">
          {display.structured ? title : <MarkdownInline text={display.firstLine.replace(/^#{1,6}\s+/, '')} />}
        </h3>
        <button
          type="button"
          className="note-time"
          aria-expanded={!note.collapsed}
          aria-label={`${note.collapsed ? '展开' : '折叠'}记录正文`}
          title={`创建：${new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false })}\n修改：${new Date(
            note.updatedAt,
          ).toLocaleString('zh-CN', { hour12: false })}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleCollapse();
          }}
        >
          {formatTime(note.createdAt)}
        </button>
      </header>

      {isEditing && editing ? (
        <>
          <LiveEditor
            value={editing.text}
            ariaLabel="编辑 Markdown 与标签"
            minHeight={100}
            maxHeight={300}
            autoFocus
            onChange={props.onEditChange}
            onReady={props.onEditReady}
            onPreviewImage={props.onPreviewImage}
          />
          <Attachments
            images={editing.images}
            onPreview={(image) => props.onPreviewImage(image.data, image.name)}
            onRemove={props.onRemoveEditImage}
          />
          <div className="note-edit-actions">
            <div className="composer-tools">
              <button
                type="button"
                className="icon-button"
                aria-label="添加图片"
                title="添加图片"
                onClick={props.onAttachEditImage}
              >
                <Icon name="image" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="引用文件"
                title="引用文件"
                onClick={props.onAttachEditFile}
              >
                <Icon name="file" />
              </button>
            </div>
            <div className="composer-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="取消修改 · Esc"
                title="取消修改 · Esc"
                onClick={props.onCancelEdit}
              >
                <Icon name="x" />
              </button>
              <button
                type="button"
                className="icon-button primary"
                aria-label="保存修改 · Ctrl+Enter"
                title="保存修改 · Ctrl+Enter"
                onClick={props.onFinishEdit}
              >
                <Icon name="check" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div ref={content} className="note-content markdown-body">
            <Markdown
              text={display.body}
              sourceMap
              handlers={{
                onPreviewImage: props.onPreviewImage,
                onOpenFile: props.onOpenFile,
                // 解析位置相对显示正文（去掉了标题行），换算回原文再切换待办。
                onTaskToggle: (offset, checked) => props.onTaskToggle(sourceOffset(note.text, display, offset), checked),
              }}
            />
            {note.images.map((image) => (
              <button
                key={image.id}
                type="button"
                className="note-image-button"
                aria-label={`预览图片：${image.name}`}
                title="点击放大，按住拖到另一张卡片"
                data-drag-item="image"
                data-image-id={image.id}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onPreviewImage(image.data, image.name);
                }}
              >
                <img className="note-image" src={image.data} alt={image.name} loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="note-expand"
            hidden={!truncated || note.collapsed}
            onClick={(event) => {
              event.stopPropagation();
              props.onExpand();
            }}
          >
            <Icon name="chevron-down" />
            展开全文
          </button>
        </>
      )}

      {isEditing ? null : (
        <footer className="note-bottom">
          <TagRow
            tags={parsed.tags}
            expanded={props.tagsExpanded}
            onFilter={props.onFilterTag}
            onRemove={props.onRemoveTag}
            onRename={props.onRenameTag}
            onToggleExpanded={props.onToggleTagsExpanded}
          />
          <div className="note-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="复制记录与附件"
              title="复制记录与附件"
              onClick={(event) => {
                event.stopPropagation();
                props.onCopy();
              }}
            >
              <Icon name="copy" />
            </button>
            {note.status === 'active' ? (
              <button
                type="button"
                className="icon-button"
                aria-pressed={note.pinned}
                aria-label={note.pinned ? '取消置顶' : '置顶记录'}
                title={note.pinned ? '取消置顶' : '置顶记录'}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onTogglePin();
                }}
              >
                <Icon name={note.pinned ? 'pin-off' : 'pin'} />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              aria-label={note.status === 'archived' ? '恢复记录' : '归档记录'}
              title={note.status === 'archived' ? '恢复记录' : '归档记录'}
              onClick={(event) => {
                event.stopPropagation();
                props.onArchive();
              }}
            >
              <Icon name={note.status === 'archived' ? 'restore' : 'archive'} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="更多操作"
              title="更多操作"
              onClick={(event) => {
                event.stopPropagation();
                props.onMore(event.currentTarget);
              }}
            >
              <Icon name="more" />
            </button>
          </div>
        </footer>
      )}
    </article>
  );
});
