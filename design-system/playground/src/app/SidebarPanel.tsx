/**
 * 侧栏面板：现有 SideNotes 主窗口的完整界面。
 *
 * 自上而下：标题区、页签与搜索、整理提醒、列表顶栏、新建卡片、筛选条、记录列表、底栏。
 * 新建卡片固定在列表之上，只有记录列表滚动。
 *
 * 键盘（现有）：Ctrl+N 新建、Ctrl+F 搜索、Ctrl+C 复制高亮的卡片、Esc 逐级退出（搜索、多选）后收起侧栏。
 * 键盘（本次提出）：↑ ↓ 在卡片之间移动，Enter 编辑，Delete 移入回收站。
 * 鼠标（现有）：单击选中、Ctrl 或 Shift 单击多选、单击空白清除；双击编辑；右键卡片打开卡片菜单，
 * 右键空白打开侧栏菜单；双击空白收起或展开全部卡片。
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { MarkdownEditor } from '@/core/editor';
import { noteTitle, shouldNudgeTidy } from '@/core/notes';
import { WIDTH_RANGE } from '@/core/settings';
import type { EdgeSide, Note } from '@/core/types';
import { copyText } from '../model/clipboard';
import { useNotes, useSidebarView, type SidebarView, type SidebarViewOptions } from '../model/notes';
import { Button } from '../ui/Button';
import { cx, useDirection, useFormFactor } from '../ui/context';
import { ContextMenu, type MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Misc';
import { useToast } from '../ui/Tabs';
import { Composer } from './Composer';
import { SHORTCUT_KEYS } from './shortcuts';
import { ChangelogDialog, EmojiDialog, GuideDialog, NoteInfoDialog, noteMenuItems, sidebarMenuItems, TrashConfirm, type NoteCommand, type SidebarCommand } from './menus';
import { NoteCard } from './NoteCard';
import { FilterBanner, ListTopline, Resizer, SidebarFooter, SidebarHeader, SidebarNav, TidyNudge } from './SidebarParts';

export interface SidebarPanelProps {
  pinned: boolean;
  /** 设置窗口打开中：侧栏保持展开，固定按钮显示联动状态。 */
  linked?: boolean;
  onTogglePinned: () => void;
  onHide: () => void;
  onOpenSettings: () => void;
  /** 编辑中或菜单、弹窗打开时为 true，场景据此暂停自动收起（「编辑时保持展开」）。 */
  onBusyChange?: (busy: boolean) => void;
  /** 单窗口页面：焦点在页面本身时也响应 Ctrl+C 等快捷键。 */
  primary?: boolean;
  initial?: SidebarViewOptions;
  /** 外部传入的界面状态（组件页的静态示例）。 */
  view?: SidebarView;
  /** 显示整理提醒（组件页演示用；正常按设置中的阈值判断）。 */
  forceNudge?: boolean;
}

type MenuState = { type: 'note'; id: string; point: { x: number; y: number } } | { type: 'sidebar'; point: { x: number; y: number } } | null;

/** 事件目标是否是空白处：不在卡片、按钮、输入框与编辑器之内。 */
function isBlank(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !element?.closest('.sn-note, button, input, textarea, [contenteditable="true"], .sn-composer, [role="menu"], [role="dialog"]');
}

export function SidebarPanel(props: SidebarPanelProps) {
  const own = useSidebarView(props.initial);
  const view = props.view ?? own;
  const data = useNotes();
  const toast = useToast();
  const direction = useDirection();
  const phone = useFormFactor() === 'phone';
  const root = useRef<HTMLElement>(null);
  // 搜索框与新建卡片的编辑器存在 state 中：菜单命令要用到它们，渲染期间不读 ref。
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);
  const [composer, setComposer] = useState<MarkdownEditor | null>(null);
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [trashing, setTrashing] = useState<Note[] | null>(null);
  const [infoNote, setInfoNote] = useState<Note | null>(null);
  const [emojiNote, setEmojiNote] = useState<Note | null>(null);
  const [guide, setGuide] = useState(false);
  const [changelog, setChangelog] = useState(false);
  const [nudgeClosed, setNudgeClosed] = useState(false);

  const { settings } = data;
  const edge: EdgeSide = settings.edge;
  const busy = Boolean(view.editingId || menu || trashing || infoNote || emojiNote || guide || changelog);
  const { onBusyChange } = props;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const items = view.items;
  const editing = view.editingId;
  const nudge = (props.forceNudge || shouldNudgeTidy(data.notes, settings)) && !nudgeClosed && view.tab === 'workspace';

  /** 操作针对的记录：多选时为全部选中的，否则为高亮的那一张。 */
  const targets = useCallback(
    (id?: string | null): Note[] => {
      const key = id ?? view.activeId;
      if (key && view.checked.has(key) && view.checked.size > 1) return items.filter((note) => view.checked.has(note.id));
      const note = key ? data.byId.get(key) : undefined;
      return note ? [note] : [];
    },
    [view.activeId, view.checked, items, data.byId],
  );

  const copy = useCallback(
    async (notes: Note[]) => {
      if (!notes.length) return;
      const ok = await copyText(notes.map((note) => note.text).join('\n\n'));
      if (!ok) toast({ message: '复制失败，请手动选择后复制', tone: 'danger' });
      else toast({ message: notes.length > 1 ? `已复制 ${notes.length} 条记录` : `已复制-${noteTitle(notes[0])}`, tone: 'success' });
    },
    [toast],
  );

  const archive = (notes: Note[]) => {
    const ids = notes.map((note) => note.id);
    if (notes[0]?.status === 'archived') {
      data.setStatus(ids, 'active');
      toast({ message: notes.length > 1 ? `已将 ${notes.length} 条记录移回工作区` : '已移回工作区', tone: 'success' });
    } else {
      data.setStatus(ids, 'archived');
      toast({ message: notes.length > 1 ? `已归档 ${notes.length} 条记录` : '已归档', action: { label: '撤销', run: () => data.setStatus(ids, 'active') } });
    }
  };

  const confirmTrash = () => {
    if (!trashing) return;
    const ids = trashing.map((note) => note.id);
    data.setStatus(ids, 'trash');
    view.setChecked(new Set());
    setTrashing(null);
    toast({ message: ids.length > 1 ? `已将 ${ids.length} 条记录移入回收站` : '已移入回收站', action: { label: '撤销', run: () => data.restore(ids) } });
    root.current?.focus({ preventScroll: true });
  };

  const runNote = (note: Note, command: NoteCommand) => {
    switch (command) {
      case 'copy':
        void copy(targets(note.id));
        break;
      case 'edit':
        view.select(note.id);
        view.setEditingId(note.id);
        break;
      case 'collapse':
        data.setCollapsed([note.id], !note.collapsed);
        break;
      case 'pin':
        data.setPinned(note.id, !note.pinned);
        toast({ message: note.pinned ? '已移到普通记录' : '已置顶', tone: 'success' });
        break;
      case 'archive':
        archive(targets(note.id));
        break;
      case 'duplicate':
        data.duplicate(note.id);
        toast({ message: '已创建副本', tone: 'success' });
        break;
      case 'export':
        toast({ message: '已导出 Markdown（Playground 只演示，不写文件）' });
        break;
      case 'info':
        setInfoNote(note);
        break;
      case 'trash':
        setTrashing(targets(note.id));
        break;
      case 'restore':
        data.restore([note.id]);
        break;
    }
  };

  const runSidebar = (command: SidebarCommand) => {
    switch (command) {
      case 'new':
        composer?.focus({ preventScroll: false });
        break;
      case 'search':
        view.setSearchOpen(true);
        searchInput?.focus();
        break;
      case 'collapse-all':
      case 'expand-all':
        data.setCollapsed(
          items.map((note) => note.id),
          command === 'collapse-all',
        );
        break;
      case 'select-all':
        view.setChecked(new Set(items.map((note) => note.id)));
        break;
      case 'pin':
        props.onTogglePinned();
        break;
      case 'edge':
        data.updateSettings({ edge: edge === 'left' ? 'right' : 'left' });
        break;
      case 'settings':
        props.onOpenSettings();
        break;
      case 'guide':
        setGuide(true);
        break;
      case 'hide':
        props.onHide();
        break;
    }
  };

  /** 单击、Ctrl 单击与 Shift 单击：沿用资源管理器的多选习惯（T09）。 */
  const selectCard = (note: Note, event: MouseEvent) => {
    if (event.shiftKey && (anchor.current ?? view.selectedId)) {
      const from = items.findIndex((item) => item.id === (anchor.current ?? view.selectedId));
      const to = items.findIndex((item) => item.id === note.id);
      const [a, b] = [from, to].sort((x, y) => x - y);
      view.setChecked(new Set(items.slice(Math.max(0, a), b + 1).map((item) => item.id)));
      view.select(note.id);
      return;
    }
    anchor.current = note.id;
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(view.checked);
      if (!next.size && view.selectedId && view.selectedId !== note.id) next.add(view.selectedId);
      if (next.has(note.id)) next.delete(note.id);
      else next.add(note.id);
      view.setChecked(next);
    } else if (view.checked.size) view.setChecked(new Set());
    view.select(note.id);
  };

  const focusCard = (id: string) => {
    view.select(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
  };

  /** 卡片上的按键（本次提出）：↑ ↓ 移动，Enter 编辑，Delete 移入回收站，Ctrl+C 复制。 */
  const onCardKey = (note: Note, event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const index = items.findIndex((item) => item.id === note.id);
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'ArrowDown' && items[index + 1]) focusCard(items[index + 1].id);
    else if (event.key === 'ArrowUp' && items[index - 1]) focusCard(items[index - 1].id);
    else if (event.key === 'Home' && items[0]) focusCard(items[0].id);
    else if (event.key === 'End' && items.length) focusCard(items[items.length - 1].id);
    else if (event.key === 'Enter' && !ctrl) runNote(note, 'edit');
    else if (event.key === 'Delete') setTrashing(targets(note.id));
    else if (ctrl && event.key.toLowerCase() === 'c' && window.getSelection()?.isCollapsed !== false) void copy(targets(note.id));
    else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({ type: 'note', id: note.id, point: { x: box.left + 24, y: box.top + 32 } });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    if (ctrl && key === 'f') runSidebar('search');
    else if (ctrl && key === 'n') runSidebar('new');
    else if (event.key === 'Escape') {
      if (view.checked.size) view.setChecked(new Set());
      else if (view.searchOpen || view.tag) view.clearFilters();
      else props.onHide();
    } else if (!typing && ctrl && key === 'c' && window.getSelection()?.isCollapsed !== false) void copy(targets());
    else return;
    event.preventDefault();
  };

  // 现有应用中 Ctrl+C 复制悬停的卡片，即使焦点不在侧栏里（T44）；单窗口页面在页面级监听。
  useEffect(() => {
    if (!props.primary) return;
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.target !== document.body || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return;
      if (window.getSelection()?.isCollapsed === false) return;
      const list = targets();
      if (list.length) {
        event.preventDefault();
        void copy(list);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [props.primary, targets, copy]);

  const menuNote = menu?.type === 'note' ? data.byId.get(menu.id) : undefined;
  const menuItems: MenuItem[] =
    menu?.type === 'note' && menuNote
      ? noteMenuItems(menuNote, (command) => runNote(menuNote, command))
      : menu?.type === 'sidebar'
        ? sidebarMenuItems(
            { count: items.length, hasExpanded: items.some((note) => !note.collapsed), pinned: props.pinned, edge },
            runSidebar,
          )
        : [];

  return (
    <aside
      ref={root}
      className={cx('sn-sidebar', `is-${direction.dock}`, `has-${direction.entries}`, editing && 'has-editing')}
      data-edge={edge}
      aria-label="SideNotes 侧栏"
      tabIndex={-1}
      onKeyDown={onPanelKey}
      onClick={(event) => {
        if (isBlank(event.target) && !editing) {
          view.select(null);
          view.setChecked(new Set());
        }
      }}
      onContextMenu={(event) => {
        if (!isBlank(event.target)) return;
        event.preventDefault();
        setMenu({ type: 'sidebar', point: { x: event.clientX, y: event.clientY } });
      }}
      onDoubleClick={(event) => {
        if (!isBlank(event.target) || editing) return;
        data.setCollapsed(
          items.map((note) => note.id),
          items.some((note) => !note.collapsed),
        );
      }}
      onMouseDown={(event) => {
        // 双击空白处用于收起或展开全部卡片，不选中其中的文字。
        if (event.detail > 1 && isBlank(event.target)) event.preventDefault();
      }}
    >
      <Resizer edge={edge} width={settings.width} min={WIDTH_RANGE.min} max={WIDTH_RANGE.max} onChange={(width) => data.updateSettings({ width })} />
      <div className="sn-side-top">
        <SidebarHeader
          pinned={props.pinned}
          linked={Boolean(props.linked)}
          edge={edge}
          onTogglePinned={props.onTogglePinned}
          onHide={props.onHide}
          onVersion={() => setChangelog(true)}
        />
        <SidebarNav view={view} onSearchInput={setSearchInput} />
      </div>
      {nudge ? (
        <TidyNudge
          onArchive={() => view.setTab('archive')}
          onSnooze={() => {
            data.updateSettings({ tidySnoozeUntil: Date.now() + 7 * 86_400_000 });
            setNudgeClosed(true);
          }}
          onClose={() => setNudgeClosed(true)}
        />
      ) : null}
      <ListTopline view={view} />
      {view.tab === 'archive' ? null : (
        <Composer onReady={setComposer} onSaved={(id) => view.select(id)} />
      )}
      {view.filtering ? <FilterBanner view={view} /> : null}
      <div className={cx('sn-note-list', `is-${direction.entries}`)} role="list" aria-label={`${items.length} 条记录`}>
        {items.length ? (
          items.map((note) => {
            const active = view.activeId === note.id;
            return (
              <div key={note.id} role="listitem" className="sn-note-item">
                <NoteCard
                  note={note}
                  tab={view.tab}
                  active={active}
                  checked={view.checked.has(note.id)}
                  editing={editing === note.id}
                  dimmed={Boolean(editing && editing !== note.id)}
                  maxHeight={settings.cardMaxHeight}
                  tabIndex={(view.selectedId ?? items[0]?.id) === note.id ? 0 : -1}
                  onHover={view.setHoverId}
                  onSelect={(event) => selectCard(note, event)}
                  onEdit={() => runNote(note, 'edit')}
                  onSave={(text) => {
                    if (text !== note.text) {
                      data.update(note.id, text);
                      toast({ message: '已保存修改', tone: 'success' });
                    }
                    view.setEditingId(null);
                  }}
                  onCancel={() => {
                    view.setEditingId(null);
                    focusCard(note.id);
                  }}
                  onMenu={(point) => {
                    if (!view.checked.has(note.id)) view.select(note.id);
                    setMenu({ type: 'note', id: note.id, point });
                  }}
                  onCopy={() => void copy(targets(note.id))}
                  onTogglePin={() => runNote(note, 'pin')}
                  onToggleArchive={() => archive(targets(note.id))}
                  onToggleCollapse={() => data.setCollapsed([note.id], !note.collapsed)}
                  onTag={(tag) => view.setTag(tag)}
                  onEmoji={() => setEmojiNote(note)}
                  onTextChange={(text) => data.update(note.id, text)}
                  onKeyDown={(event) => onCardKey(note, event)}
                />
              </div>
            );
          })
        ) : view.filtering ? (
          <EmptyState
            icon="search"
            title="没有匹配的记录"
            description="试试更短的关键词；输入 # 可以按标签查找。"
            action={
              <Button variant="secondary" size="sm" onClick={view.clearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={view.tab === 'archive' ? 'archive' : view.tab === 'pinned' ? 'pin' : 'note'}
            title={view.tab === 'archive' ? '还没有归档的记录' : view.tab === 'pinned' ? '还没有置顶的记录' : '还没有记录'}
            description={
              view.tab === 'archive'
                ? '处理完的记录可以归档，归档后不再出现在工作区。'
                : view.tab === 'pinned'
                  ? '常用的记录可以置顶，集中在这里。'
                  : phone
                    ? '在上面直接输入，点保存按钮保存。'
                    : `在上面直接输入，${SHORTCUT_KEYS.save} 保存。`
            }
          />
        )}
      </div>
      <SidebarFooter view={view} onSettings={props.onOpenSettings} />

      {menu && menuItems.length ? (
        <ContextMenu label={menu.type === 'note' ? '记录操作' : '侧栏操作'} items={menuItems} point={menu.point} onClose={() => setMenu(null)} />
      ) : null}
      <TrashConfirm notes={trashing} onCancel={() => setTrashing(null)} onConfirm={confirmTrash} />
      <NoteInfoDialog note={infoNote} onClose={() => setInfoNote(null)} />
      <EmojiDialog
        note={emojiNote}
        onClose={() => setEmojiNote(null)}
        onPick={(emoji) => {
          if (emojiNote) data.setEmoji(emojiNote.id, emoji);
          setEmojiNote(null);
        }}
      />
      <GuideDialog open={guide} onClose={() => setGuide(false)} />
      <ChangelogDialog open={changelog} onClose={() => setChangelog(false)} />
    </aside>
  );
}
