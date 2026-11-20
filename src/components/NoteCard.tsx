/**
 * 记录卡片（原型第二版，components.md 第二节）。
 *
 * 标题行：勾选框（多选按钮按下时代替 Emoji）、Emoji、标题（最多一行，2026-11-18 用户要求；原型两行）与右侧一格；右侧一格平时是置顶标记与时间，
 * 悬停、高亮或聚焦时换成操作按钮（置顶在最前，然后是复制、更多，收起在最右，落在时间原来的位置），标题宽度因此不变。
 * 只有标题行的记录不留正文区；底部一行只在有标签时出现。正文按设置限高，超出部分渐隐，下面出现「展开全文」，
 * 点它在记录窗口中查看全文（T83）。
 * 列表只让一张卡片进入 Tab 顺序，卡片内的按钮也只在高亮的一张上可聚焦（interactions.md 3.2）。
 * 编辑态直接在卡片内嵌入实时 Markdown 编辑面，确认前不写入记录。
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { KeyHint } from './KeyHint';
import { LiveEditor } from './LiveEditor';
import { TagInput } from './TagInput';
import { Markdown, MarkdownInline } from './Markdown';
import { formatTime, likelyLong, noteTitle } from '../core/notes';
import { isValidTag, parse } from '../core/tags';
import { noteDisplay, sourceOffset } from '../core/display';
import type { AttachmentReference } from '../core/attachments';
import type { EditSession, Note, NoteImage } from '../core/types';
import type { MarkdownEditor } from '../core/editor';
import { useShortcut } from '../hooks/useShortcut';
import { useEditHeight } from '../hooks/useEditHeight';

export interface NoteCardProps {
  note: Note;
  /** 当前编辑事务，仅当 id 匹配时进入编辑态。 */
  editing: EditSession | null;
  /** 单击选中的卡片：与悬停使用同一种边框高亮，Ctrl+C 复制它。 */
  current: boolean;
  /** 列表唯一的 Tab 停靠点：编辑中的卡片，否则是高亮的卡片，没有高亮时是第一张。 */
  tabStop: boolean;
  /** 刚被「查看」「转到」找到的卡片：闪一下（theme.css 的 is-located）。 */
  located?: boolean;
  /** 是否处于多选状态。 */
  selected: boolean;
  /** 记录菜单正为这张卡片打开。 */
  menuOpen: boolean;
  /** 拖动图片或引用时，这张卡片是放下的目标。 */
  itemTarget: boolean;
  /**
   * 进入编辑时让编辑面获得焦点。从资源管理器拖入文件、停留后进入编辑时为 false：
   * 拖动途中移动焦点会让 WebView2 不再派发放下事件，放下插入后再聚焦。
   */
  editAutoFocus?: boolean;
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
  onCopy: () => void;
  onTogglePin: () => void;
  onMore: (anchor: HTMLElement) => void;
  onFilterTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onRenameTag: (tag: string, next: string) => void;
  onToggleTagsExpanded: () => void;
  /** 双击标签改名时进入整理态（原型 startTagRename）。 */
  onEnterTagsExpanded: () => void;
  /** 改的标签名不合规（原型 finishTagRename 的提示）。 */
  onInvalidTag: () => void;
  /**
   * 点击正文中的附件（图片、文件引用）：预览时范围已换算为记录原文中的位置，
   * 编辑时为编辑器原文中的位置。按住 Ctrl 点击直接打开，由调用方按 event 判断。
   */
  onAttachment: (reference: AttachmentReference, event: { ctrlKey: boolean; metaKey: boolean }) => void;
  /** 点击以 data URL 保存在记录里的图片附件。 */
  onEmbeddedImage: (image: NoteImage) => void;
  onTaskToggle: (offset: number, checked: boolean) => void;
  /** 这条记录的全文浮窗正附着在卡片旁（T100）：按钮换成「收起全文」，卡片带强调色边框，连线连到这里。 */
  peeked?: boolean;
  /**
   * 「展开全文」：在卡片旁打开全文浮窗，从这张卡片的位置展开（T83、T100）；`collapse` 为真时是「收起全文」。
   */
  onExpand: (card: HTMLElement, collapse: boolean) => void;
}

/** 卡片内的图片附件列表。 */
function Attachments({
  images,
  onOpen,
  onRemove,
}: {
  images: NoteImage[];
  onOpen: (image: NoteImage) => void;
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
            aria-label={`图片：${image.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(image);
            }}
          >
            <img src={image.data} alt={image.name} />
          </button>
          {onRemove ? (
            <button
              type="button"
              className="icon-button attachment-remove"
              aria-label={`移除 ${image.name}`}
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
  tabIndex,
  onFilter,
  onRemove,
  onRename,
  onToggleExpanded,
  onEnterExpanded,
  onInvalid,
}: {
  tags: string[];
  expanded: boolean;
  /** 只有高亮的卡片里的按钮进入 Tab 顺序。 */
  tabIndex: number;
  onFilter: (tag: string) => void;
  onRemove: (tag: string) => void;
  onRename: (tag: string, next: string) => void;
  onToggleExpanded: () => void;
  onEnterExpanded: () => void;
  onInvalid: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  // 放不下的标签收起，「…」常驻并写出收起了几个（与原型的 fitCardTags 相同）；没有收起时「…」平时隐藏。
  const [hiddenCount, setHiddenCount] = useState(0);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const fit = (): void => {
      const wraps = Array.from(element.querySelectorAll<HTMLElement>('.tag-chip-wrap'));
      const more = element.querySelector<HTMLElement>('.tags-more');
      wraps.forEach((wrap) => {
        wrap.hidden = false;
      });
      if (!more || expanded) {
        setHiddenCount(0);
        return;
      }
      const width = element.clientWidth;
      if (!width) return;
      const reserve = more.getBoundingClientRect().width || 24;
      const gap = 4;
      let used = 0;
      let visible = 0;
      for (const wrap of wraps) {
        const next = used + wrap.getBoundingClientRect().width + (visible ? gap : 0);
        if (next + reserve + gap <= width) {
          used = next;
          visible += 1;
        } else {
          wrap.hidden = true;
        }
      }
      setHiddenCount(wraps.length - visible);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tags, expanded, renaming]);
  // 与原型一致：单击标签延迟筛选，留出双击改名的判断时间。立即筛选会让列表重排，第二下点到别处。
  const filterTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(filterTimer.current), []);

  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);

  /**
   * 提交重命名；未变化时直接退出。名称不合规时提示（原型 finishTagRename）：按 Enter 时留在输入框里改，
   * 点到别处时放弃这次修改。
   */
  const commit = useCallback(
    (leaving = false) => {
      if (!renaming) return;
      const next = draft.trim().replace(/^#/, '');
      if (next !== renaming && !isValidTag(next)) {
        onInvalid();
        if (leaving) setRenaming(null);
        else input.current?.focus();
        return;
      }
      if (next !== renaming) onRename(renaming, next);
      setRenaming(null);
    },
    [draft, renaming, onRename, onInvalid],
  );

  return (
    <div ref={row} className={expanded ? 'note-tags tags-expanded' : 'note-tags'}>
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
            onValueChange={setDraft}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => commit(true)}
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
              data-tag={tag}
              tabIndex={tabIndex}
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
                // 改名时同时进入整理态，其它卡片的整理态收起（原型 startTagRename）。
                if (!expanded) onEnterExpanded();
              }}
            >
              <span>{`#${tag}`}</span>
            </button>
            <button
              type="button"
              className="tag-remove"
              aria-label={`从此记录移除 #${tag}`}
              data-tag={tag}
              tabIndex={tabIndex}
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
          aria-label={expanded ? '收起标签' : hiddenCount ? `展开剩余 ${hiddenCount} 个标签` : '管理标签'}
          data-hidden-count={hiddenCount}
          tabIndex={tabIndex}
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
  const card = useRef<HTMLElement>(null);
  // 进入、退出编辑时卡片高度平滑地变过去（第七轮反馈 5）。
  useEditHeight(card, isEditing);
  const [truncated, setTruncated] = useState(() => likelyLong(note));
  const saveKeys = useShortcut('save');

  // 正文实际溢出时渐隐并在悬停时提示，图片加载后需要复核。
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

  const tabIndex = props.current ? 0 : -1;
  /** 按下「展开全文」时全文浮窗是否开着（见按钮的说明）；键盘触发时没有按下，为 null。 */
  const peekedOnPress = useRef<boolean | null>(null);
  const title = noteTitle(note);
  // 首行若是结构化内容（代码、列表、引用、图片等），标题不复用该行文本，正文从头显示。
  const display = noteDisplay(note.text);
  // 标题行去掉标题标记后渲染；标题中的附件同样可以点击，位置加上标题文字在原文中的起点换算回原文。
  const titleText = display.firstLine.replace(/^#{1,6}\s+/, '');
  const titleOffset = note.text.indexOf(display.firstLine) + display.firstLine.length - titleText.length;
  // 只有标题行的记录不留正文区，与收起的记录一样只剩标题行。
  const single = !display.body.trim() && !note.images.length;

  const classes = [
    'note-card',
    note.pinned ? 'is-pinned' : '',
    isEditing ? 'is-editing' : '',
    note.collapsed ? 'is-collapsed' : '',
    single && !isEditing ? 'is-single' : '',
    props.current ? 'is-current' : '',
    props.located ? 'is-located' : '',
    props.selected ? 'is-selected' : '',
    props.menuOpen ? 'is-menu-open' : '',
    props.itemTarget ? 'is-drop-target' : '',
    props.sortPending ? 'is-sort-pending' : '',
    props.sorting ? 'is-sorting' : '',
    props.sortingMember ? 'is-sorting-member' : '',
    props.dropHint === 'before' ? 'drop-before' : '',
    props.dropHint === 'after' ? 'drop-after' : '',
    truncated && !note.collapsed ? 'is-truncated' : '',
    props.peeked ? 'is-peeking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /** 卡片上的按钮：阻止冒泡，不触发卡片的单击选中与双击编辑。 */
  const run = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };

  return (
    <article
      ref={card}
      className={classes}
      data-note-id={note.id}
      tabIndex={props.tabStop || isEditing ? 0 : -1}
      aria-label={title}
      aria-selected={props.selected}
      aria-current={props.current ? 'true' : undefined}
      // 编辑中焦点离开整张卡片（而不只是编辑面）才算失焦，卡片内的工具按钮不打断编辑。
      onBlur={isEditing ? props.onEditBlur : undefined}
    >
      <header className="note-header">
        {/* 多选按钮按下时，图标的位置换成勾选框（theme.css 的 .note-list.is-selecting）。 */}
        <span className="note-select-mark" aria-hidden="true">
          <Icon name="check" />
        </span>
        <button
          type="button"
          className="note-emoji"
          data-action="choose-emoji"
          aria-label="更换 Emoji"
          tabIndex={tabIndex}
          onClick={run(props.onChooseEmoji)}
        >
          {note.emoji || '📝'}
        </button>
        <h3 className="note-title">
          {/* 首行是代码、列表、引用、图片、分隔线或文件路径时整段作为正文，标题写「记录」（首行超过 120 字时仍用短标题）。 */}
          {display.structured ? (
            display.firstLine.length > 120 ? title : '记录'
          ) : (
            <MarkdownInline
              text={titleText}
              handlers={{
                onAttachment: (attachment, event) => {
                  const start = titleOffset + attachment.start;
                  const end = titleOffset + attachment.end;
                  props.onAttachment({ ...attachment, start, end, source: note.text.slice(start, end) }, event);
                },
              }}
            />
          )}
        </h3>
        <div className="note-side">
          {/* 平时是置顶标记与创建时间；点时间收起或展开正文（时间不进入 Tab 顺序，键盘用收起按钮）。 */}
          <span className="note-meta">
            {note.pinned ? (
              <span className="note-pin" aria-label="已置顶">
                <Icon name="pin" />
              </span>
            ) : null}
            <button
              type="button"
              className="note-time"
              data-action="toggle-note-collapse"
              tabIndex={-1}
              aria-label={note.collapsed ? '展开正文' : '收起正文'}
              onClick={run(props.onToggleCollapse)}
            >
              {formatTime(note.createdAt)}
            </button>
          </span>
          {isEditing ? null : (
            <div className="note-actions">
              {note.status === 'active' ? (
                <button
                  type="button"
                  className={note.pinned ? 'icon-button note-pin-toggle is-pinned' : 'icon-button note-pin-toggle'}
                  data-action="pin-note"
                  aria-pressed={note.pinned}
                  aria-label={note.pinned ? '取消置顶' : '置顶记录'}
                  tabIndex={tabIndex}
                  onClick={run(props.onTogglePin)}
                >
                  <Icon name={note.pinned ? 'pin-off' : 'pin'} />
                </button>
              ) : null}
              <button
                type="button"
                className="icon-button"
                data-action="copy-note"
                aria-label="复制记录与附件 · Ctrl+C"
                tabIndex={tabIndex}
                onClick={run(props.onCopy)}
              >
                <Icon name="copy" />
              </button>
              <button
                type="button"
                className="icon-button"
                data-action="more-note"
                aria-label="更多操作 · Shift+F10"
                tabIndex={tabIndex}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onMore(event.currentTarget);
                }}
              >
                <Icon name="more" />
              </button>
              <button
                type="button"
                className={note.collapsed ? 'icon-button note-collapse is-collapsed' : 'icon-button note-collapse'}
                data-action="toggle-note-collapse"
                aria-label={note.collapsed ? '展开正文' : '收起正文'}
                aria-expanded={!note.collapsed}
                tabIndex={tabIndex}
                onClick={run(props.onToggleCollapse)}
              >
                <Icon name="chevron-down" />
              </button>
            </div>
          )}
        </div>
      </header>

      {isEditing && editing ? (
        <>
          <LiveEditor
            value={editing.text}
            ariaLabel="编辑 Markdown 与标签"
            minHeight={100}
            maxHeight={300}
            autoFocus={props.editAutoFocus ?? true}
            onChange={props.onEditChange}
            onReady={props.onEditReady}
            onAttachment={props.onAttachment}
          />
          <Attachments images={editing.images} onOpen={props.onEmbeddedImage} onRemove={props.onRemoveEditImage} />
          <div className="note-edit-actions">
            <div className="composer-tools">
              <button type="button" className="icon-button" aria-label="添加图片" onClick={props.onAttachEditImage}>
                <Icon name="image" />
              </button>
              <button type="button" className="icon-button" aria-label="引用文件" onClick={props.onAttachEditFile}>
                <Icon name="file" />
              </button>
            </div>
            <div className="composer-actions">
              <KeyHint combo={saveKeys} />
              <button type="button" className="icon-button" aria-label="取消修改 · Esc" onClick={props.onCancelEdit}>
                <Icon name="x" />
              </button>
              <button
                type="button"
                className="icon-button primary"
                aria-label={`保存修改 · ${saveKeys}`}
                onClick={props.onFinishEdit}
              >
                <Icon name="check" />
              </button>
            </div>
          </div>
        </>
      ) : single ? null : (
        <div ref={content} className="note-content markdown-body">
          <Markdown
            text={display.body}
            sourceMap
            handlers={{
              // 解析位置相对显示正文（去掉了标题行），换算回原文再切换待办或打开附件弹窗。
              onTaskToggle: (offset, checked) => props.onTaskToggle(sourceOffset(note.text, display, offset), checked),
              onAttachment: (attachment, event) => {
                const start = sourceOffset(note.text, display, attachment.start);
                const end = sourceOffset(note.text, display, attachment.end);
                props.onAttachment({ ...attachment, start, end, source: note.text.slice(start, end) }, event);
              },
            }}
          />
          {note.images.map((image) => (
            <button
              key={image.id}
              type="button"
              className="note-image-button"
              aria-label={`预览图片：${image.name}`}
              data-drag-item="image"
              data-image-id={image.id}
              tabIndex={tabIndex}
              onClick={run(() => props.onEmbeddedImage(image))}
            >
              <img className="note-image" src={image.data} alt={image.name} loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      )}

      {/* 正文超出卡片高度时出现「展开全文」（原型 note-expand），收起的卡片不显示；全文浮窗开着时是「收起全文」（T100）。
       * 按下时就记住要做哪一样：按下会让全文浮窗失去焦点而自己收回，松开时按钮可能已经换回「展开全文」。 */}
      {isEditing || single ? null : (
        <button
          type="button"
          className="note-expand"
          data-action="open-note"
          aria-label={props.peeked ? '收起全文' : '展开全文'}
          aria-expanded={Boolean(props.peeked)}
          hidden={!truncated}
          tabIndex={tabIndex}
          onPointerDown={() => {
            peekedOnPress.current = Boolean(props.peeked);
          }}
          onClick={(event) => {
            event.stopPropagation();
            const collapse = peekedOnPress.current ?? Boolean(props.peeked);
            peekedOnPress.current = null;
            const card = event.currentTarget.closest<HTMLElement>('.note-card');
            if (card) props.onExpand(card, collapse);
          }}
        >
          <Icon name="chevron-down" />
          {props.peeked ? '收起全文' : '展开全文'}
        </button>
      )}

      {/* 底部只在有标签时出现，没有标签时不占位置。 */}
      {isEditing || !parsed.tags.length ? null : (
        <footer className="note-bottom">
          <TagRow
            tags={parsed.tags}
            expanded={props.tagsExpanded}
            tabIndex={tabIndex}
            onFilter={props.onFilterTag}
            onRemove={props.onRemoveTag}
            onRename={props.onRenameTag}
            onToggleExpanded={props.onToggleTagsExpanded}
            onEnterExpanded={props.onEnterTagsExpanded}
            onInvalid={props.onInvalidTag}
          />
        </footer>
      )}
    </article>
  );
});
