/**
 * 侧栏面板：现有 SideNotes 主窗口的完整界面。
 *
 * 自上而下：标题区、页签栏、整理提醒、筛选行（标签筛选与搜索）、新建卡片、记录列表、底栏。
 * 搜索是全局的（第五次反馈）：有搜索词时列表是全部记录中的结果，按页签分组，新建卡片收起。
 * 新建卡片固定在列表之上，只有记录列表滚动。
 *
 * 键盘（现有）：Ctrl+N 新建、Ctrl+F 搜索、Ctrl+C 复制高亮的卡片、Esc 逐级退出（搜索、多选）后收起侧栏。
 * 键盘（本次提出）：↑ ↓ 在卡片之间移动，Enter 编辑，Delete 移入回收站。
 * 鼠标（现有）：单击选中、Ctrl 或 Shift 单击多选、单击空白清除；双击编辑；右键卡片打开卡片菜单，
 * 右键空白打开侧栏菜单；双击空白收起或展开全部卡片。
 * 页签与合并（第四次反馈）：页签栏见 SidebarTabs.tsx；卡片菜单的「移到…」打开第二个菜单列出可去的页签；
 * 按标签筛选时筛选条上有「固定为页签」与「合并」，多选后右键可以「合并成一条…」或「合并到这条」（MergeDialog.tsx）。
 */

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { MarkdownEditor } from '@/core/editor';
import { noteTitle, shouldNudgeTidy } from '@/core/notes';
import { tagKey } from '@/core/tags';
import { WIDTH_RANGE } from '@/core/settings';
import type { EdgeSide, Note } from '@/core/types';
import { copyText } from '../model/clipboard';
import { allTags, belongsTo, homeTab, pinnedTagOf, searchTerms, tabLabel, tabName, tabOfTag, tagOfTab, TAB_LABELS, useNotes, useSidebarView, withTag, type SidebarTab, type SidebarView, type SidebarViewOptions } from '../model/notes';
import { Button } from '../ui/Button';
import { cx, useSurface, useFormFactor } from '../ui/context';
import { ContextMenu, type MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/Misc';
import { listHits, setSearchHits } from '../ui/searchHighlight';
import { useToast } from '../ui/Tabs';
import { Composer } from './Composer';
import { MergeDialog, type MergeRequest } from './MergeDialog';
import { SHORTCUT_KEYS } from './shortcuts';
import {
  AVAILABLE_UPDATE,
  ChangelogDialog,
  EmojiDialog,
  GuideDialog,
  NoteInfoDialog,
  noteMenuItems,
  sidebarMenuItems,
  TagManageDialog,
  UpdateDialog,
  type NoteCommand,
  type SidebarCommand,
} from './menus';
import { NoteCard } from './NoteCard';
import { ListTopline, Resizer, SearchGroupHeader, SidebarFooter, SidebarHeader, SidebarNav, TidyNudge, useCollapseAll } from './SidebarParts';
import { useTabActions } from './SidebarTabs';

export interface SidebarPanelProps {
  pinned: boolean;
  /** 设置窗口打开中：侧栏保持展开，固定按钮显示联动状态。 */
  linked?: boolean;
  onTogglePinned: () => void;
  onHide: () => void;
  onOpenSettings: () => void;
  /** 编辑中或菜单、弹窗打开时为 true，场景据此暂停自动收起。 */
  onBusyChange?: (busy: boolean) => void;
  /** 单窗口页面：焦点在页面本身时也响应 Ctrl+C 等快捷键。 */
  primary?: boolean;
  initial?: SidebarViewOptions;
  /** 外部传入的界面状态（组件页的静态示例）。 */
  view?: SidebarView;
  /** 显示整理提醒（组件页演示用；正常按设置中的阈值判断）。 */
  forceNudge?: boolean;
}

type Point = { x: number; y: number };
type MenuState = { type: 'note'; id: string; point: Point } | { type: 'move'; ids: string[]; point: Point } | { type: 'sidebar'; point: Point } | null;

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
  const surface = useSurface();
  const phone = useFormFactor() === 'phone';
  const root = useRef<HTMLElement>(null);
  // 搜索框与新建卡片的编辑器存在 state 中：菜单命令要用到它们，渲染期间不读 ref。
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);
  const [composer, setComposer] = useState<MarkdownEditor | null>(null);
  const anchor = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  // 搜索命中的高亮（第七次反馈）：每次渲染后按当前的搜索词重新标出，结束搜索或卸载时去掉。
  const hits = useId();
  useLayoutEffect(() => {
    const list = root.current;
    if (!list || !view.searching) {
      setSearchHits(hits, []);
      return;
    }
    // 标出范围是读取渲染后的文字节点，只能在提交之后做。
    setSearchHits(hits, listHits(list, searchTerms(view.query), new Set(allTags(data.notes).map((item) => tagKey(item.tag)))));
  });
  useEffect(() => () => setSearchHits(hits, []), [hits]);
  const [infoNote, setInfoNote] = useState<Note | null>(null);
  const [emojiNote, setEmojiNote] = useState<Note | null>(null);
  const [managingTag, setManagingTag] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const [changelog, setChangelog] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [nudgeClosed, setNudgeClosed] = useState(false);
  const [merging, setMerging] = useState<MergeRequest | null>(null);
  const tabs = useTabActions(view);

  const { settings } = data;
  const edge: EdgeSide = settings.edge;
  const busy = Boolean(view.editingId || menu || infoNote || emojiNote || managingTag || guide || changelog || updating || merging);
  // 提示条上的操作（查看、放回）在几秒后才点，读这时的记录；渲染期间不读 ref，在提交后同步。
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });
  const { onBusyChange } = props;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const items = view.items;
  // 收起或展开全部卡片：筛选行右边的按钮、侧栏菜单与双击空白处共用（第六次反馈起有提示条，可以撤销）。
  const collapseAll = useCollapseAll(view);
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
      // 提示文字与现有应用一致：标题超过 24 个字时省略。
      const title = noteTitle(notes[0]);
      if (!ok) toast({ message: '复制失败，请手动选择后复制', tone: 'danger' });
      else toast({ message: notes.length > 1 ? `已复制 ${notes.length} 条记录` : `已复制-${title.length > 24 ? `${title.slice(0, 24)}…` : title}`, tone: 'success' });
    },
    [toast],
  );

  /** 「移到…」可去的页签：随记与固定的标签页签，当前页签除外；置顶有自己的菜单项。 */
  /** 「移到…」可去的页签：随记与固定的标签页签，当前页签除外（全局搜索时是这条记录所在的页签除外）。 */
  const destinationsFor = (note?: Note): SidebarTab[] => {
    const here = view.searching && note ? homeTab(note, data.pinnedTags) : view.tab;
    return (['workspace', ...data.pinnedTags.map(tabOfTag)] as SidebarTab[]).filter((tab) => tab !== here);
  };

  /** 合并完成：新卡片（或合并到的那张）进入编辑；它不在当前页签里时切换到它所在的页签。 */
  const finishMerge = (note: Note) => {
    setMerging(null);
    view.clearSelection();
    if (view.searching) view.goToTab(homeTab(note, data.pinnedTags));
    else if (!belongsTo(note, view.tab, data.pinnedTags)) {
      const tag = pinnedTagOf(note, data.pinnedTags);
      view.setTab(tag ? tabOfTag(tag) : 'workspace');
    }
    // 等弹窗关闭、焦点还原之后再进入编辑，否则还原的焦点会让编辑器失焦，编辑随即结束。
    window.setTimeout(() => {
      view.select(note.id);
      view.setEditingId(note.id);
    }, 0);
  };

  /** 移入回收站（第五次反馈：不再确认，提示条可以撤销）；多选时是全部选中的记录，一次撤销全部恢复。 */
  const trash = (notes: Note[]) => {
    const ids = notes.map((note) => note.id);
    if (!ids.length) return;
    data.setStatus(ids, 'trash');
    view.clearSelection();
    toast({ message: ids.length > 1 ? `已将 ${ids.length} 条记录移入回收站` : '已移入回收站', action: { label: '撤销', run: () => data.restore(ids) } });
    // 卡片没了，焦点回到侧栏（Esc 等按键仍由侧栏处理）；在提交之后做，菜单命令在渲染期间传出，不能读 ref。
    setFocusPanel((tick) => tick + 1);
  };
  const [focusPanel, setFocusPanel] = useState(0);
  useEffect(() => {
    if (focusPanel) root.current?.focus({ preventScroll: true });
  }, [focusPanel]);

  /**
   * 新建卡片保存之后的提示（第五次反馈）：新记录不在当前页签里时写明记在了哪里，「查看」切过去并高亮这一条；
   * 是因为去掉了新建卡片上的页签标签时，还有「放回」：补上这个标签。
   */
  const announceSaved = (note: Note, skipped: string) => {
    if (belongsTo(note, view.tab, data.pinnedTags)) {
      view.select(note.id);
      toast({ message: '已保存', tone: 'success' });
      return;
    }
    const home = homeTab(note, data.pinnedTags);
    const putBack = () => {
      const current = latest.current.byId.get(note.id);
      if (!current) return;
      latest.current.update(note.id, withTag(current.text, skipped));
      toast({ message: `已放回「${skipped}」`, tone: 'success' });
    };
    toast({
      message: `已记在「${tabName(home)}」`,
      actions: [{ label: '查看', run: () => view.goToTab(home, note.id) }, ...(skipped ? [{ label: `放回「${skipped}」`, run: putBack }] : [])],
    });
  };

  // 「转到」一条记录（第五次反馈）：切到它所在的页签之后，列表滚到它；闪一下由卡片的 is-located 负责，动画结束时清掉。
  const { locateId } = view;
  useEffect(() => {
    if (!locateId) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(locateId)}"]`);
    card?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    card?.focus({ preventScroll: true });
  }, [locateId]);

  const runNote = (note: Note, command: NoteCommand) => {
    switch (command) {
      case 'locate':
        view.goToTab(homeTab(note, data.pinnedTags), note.id);
        break;
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
      case 'merge':
        setMerging({ ids: targets(note.id).map((item) => item.id) });
        break;
      case 'merge-into':
        setMerging({ ids: targets(note.id).map((item) => item.id), target: note.id });
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
        trash(targets(note.id));
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
        collapseAll.run(command === 'collapse-all');
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

  /**
   * 单击、Ctrl 单击与 Shift 单击：沿用资源管理器的多选习惯（T09，第七次反馈与交互原型相同）。
   * - 单击：只选中这一张，Ctrl 或 Shift 选中的其它卡片取消（第七次反馈：此前已有多选时单击是取消这一张）；
   * - Ctrl 单击：加选或减选这一张；还没有选中的卡片时，上一次单击的那张一起选上；
   * - Shift 单击：从上一次单击的卡片选到这一张（第六次反馈），换掉原来的选择；同时按 Ctrl 或多选按钮按下时加进原来的选择；
   *   起点不在当前列表中（例如换过页签）时只切换这一张；
   * - 多选按钮按下时单击：勾选或取消这一张。
   */
  const selectCard = (note: Note, event: MouseEvent) => {
    const start = anchor.current ?? view.selectedId;
    const from = start ? items.findIndex((item) => item.id === start) : -1;
    const additive = event.ctrlKey || event.metaKey || view.selectMode;
    if (event.shiftKey && from >= 0) {
      const to = items.findIndex((item) => item.id === note.id);
      const [a, b] = [from, to].sort((x, y) => x - y);
      const range = items.slice(a, b + 1).map((item) => item.id);
      view.setChecked(new Set(additive ? [...view.checked, ...range] : range));
      view.select(note.id);
      return;
    }
    anchor.current = note.id;
    if (additive || event.shiftKey) {
      const next = new Set(view.checked);
      if (!next.size && !view.selectMode && start && start !== note.id && from >= 0) next.add(start);
      if (next.has(note.id)) next.delete(note.id);
      else next.add(note.id);
      view.setChecked(next);
    } else if (view.checked.size) {
      view.clearSelection();
    }
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
    else if (event.key === 'Delete') trash(targets(note.id));
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
    // 打开设置（本次提出）：应用内快捷键，侧栏获得焦点时响应，编辑中同样可用。
    else if (ctrl && key === ',') runSidebar('settings');
    else if (event.key === 'Escape') {
      // 逐级退出：多选（本次提出，包括点了多选按钮还没选的）、搜索（现有：收起并清空搜索词，标签筛选保留）、标签筛选（第五次反馈），最后收起侧栏。
      if (view.selecting) view.clearSelection();
      else if (view.searchOpen) view.endSearch();
      else if (view.tag) view.setTag('');
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
  // 多选的条数按当前列表中选中的计算（与「操作的对象」相同）。
  const selected = menuNote && view.checked.has(menuNote.id) ? targets(menuNote.id).length : 0;
  const menuItems: MenuItem[] =
    menu?.type === 'note' && menuNote
      ? noteMenuItems(
          menuNote,
          (command) =>
            // 「移到…」在原来的位置打开第二个菜单（与交互原型相同）。
            command === 'move' ? setMenu({ type: 'move', ids: targets(menuNote.id).map((item) => item.id), point: menu.point }) : runNote(menuNote, command),
          {
            selected,
            canMove: destinationsFor(menuNote).length > 0,
            locate: view.searching ? tabLabel(homeTab(menuNote, data.pinnedTags)) : undefined,
          },
        )
      : menu?.type === 'move'
        ? destinationsFor(data.byId.get(menu.ids[0])).map<MenuItem>((tab) => ({
            id: tab,
            label: tagOfTab(tab) || TAB_LABELS.workspace,
            icon: tab === 'workspace' ? 'note' : 'hash',
            onSelect: () => tabs.moveTo(menu.ids, tab),
          }))
        : menu?.type === 'sidebar'
        ? sidebarMenuItems(
            { count: items.length, hasExpanded: items.some((note) => !note.collapsed), pinned: props.pinned, edge },
            runSidebar,
          )
        : [];

  /** 一张卡片（列表项）。 */
  const renderNote = (note: Note) => {
    const active = view.activeId === note.id;
    return (
      <div key={note.id} role="listitem" className="sn-note-item">
        <NoteCard
          note={note}
          located={view.locateId === note.id}
          onLocated={view.clearLocate}
          tab={view.tab}
          active={active}
          checked={view.checked.has(note.id)}
          selectMode={view.selectMode}
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
          onToggleCollapse={() => data.setCollapsed([note.id], !note.collapsed)}
          onTag={(tag) => (view.searching ? view.setQuery(`#${tag} `) : view.selectTag(tag))}
          onEmoji={() => setEmojiNote(note)}
          onTextChange={(text) => data.update(note.id, text)}
          onKeyDown={(event) => onCardKey(note, event)}
        />
      </div>
    );
  };

  return (
    <aside
      ref={root}
      className={cx('sn-sidebar', `is-${surface.dock}`, `has-${surface.entries}`, editing && 'has-editing', view.searching && 'is-search-results')}
      data-edge={edge}
      aria-label="SideNotes 侧栏"
      tabIndex={-1}
      onKeyDown={onPanelKey}
      onClick={(event) => {
        if (isBlank(event.target) && !editing) {
          view.select(null);
          view.clearSelection();
        }
      }}
      onContextMenu={(event) => {
        if (!isBlank(event.target)) return;
        event.preventDefault();
        setMenu({ type: 'sidebar', point: { x: event.clientX, y: event.clientY } });
      }}
      onDoubleClick={(event) => {
        if (!isBlank(event.target) || editing) return;
        collapseAll.run();
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
        />
        <SidebarNav view={view} onSearchInput={setSearchInput} />
      </div>
      {nudge ? (
        <TidyNudge
          onSnooze={() => {
            data.updateSettings({ tidySnoozeUntil: Date.now() + 7 * 86_400_000 });
            setNudgeClosed(true);
          }}
          onClose={() => setNudgeClosed(true)}
        />
      ) : null}
      <ListTopline
        view={view}
        onPin={tabs.pin}
        onMerge={(tag) => setMerging({ ids: items.map((note) => note.id), tag })}
        onMergeChecked={() => setMerging({ ids: items.filter((note) => view.checked.has(note.id)).map((note) => note.id) })}
        onTrashChecked={() => trash(items.filter((note) => view.checked.has(note.id)))}
        onManageTag={setManagingTag}
        onSearchTags={() => {
          // 打开搜索并预填 #，光标停在 # 之后，继续输入即按标签查找（现有应用的「搜索」）。
          view.setSearchOpen(true);
          view.setQuery('#');
          window.setTimeout(() => {
            const input = root.current?.querySelector<HTMLInputElement>('.sn-side-search input');
            input?.focus();
            input?.setSelectionRange(1, 1);
          }, 50);
        }}
      />
      <Composer
        tag={view.composerTag}
        onSkipTag={view.skipComposerTag}
        onReady={setComposer}
        onSaved={(note) => {
          // 去掉了新建卡片上的页签标签：当前是标签页签，而新建卡片上已经没有它。
          const skipped = tagOfTab(view.tab) && !view.composerTag ? tagOfTab(view.tab) : '';
          view.resetComposerTag();
          announceSaved(note, skipped);
        }}
      />
      <div className={cx('sn-note-list', `is-${surface.entries}`)} role="list" aria-label={`${items.length} 条记录`}>
        {items.length ? (
          view.searching ? (
            view.groups.map((group) => (
              <Fragment key={group.tab}>
                <div role="listitem" className="sn-search-group-item">
                  <SearchGroupHeader tab={group.tab} count={group.notes.length} onGo={() => view.goToTab(group.tab)} />
                </div>
                {group.notes.map(renderNote)}
              </Fragment>
            ))
          ) : (
            items.map(renderNote)
          )
        ) : view.filtering ? (
          <EmptyState
            icon="search"
            title="没有匹配的记录"
            description={view.searching ? '搜索的是全部记录，换个词试试。' : '调整标签筛选。'}
            action={
              <Button variant="secondary" size="sm" onClick={view.searching ? view.endSearch : view.clearFilters}>
                {view.searching ? '清除搜索' : '清除筛选'}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={tagOfTab(view.tab) ? 'hash' : view.tab === 'pinned' ? 'pin' : 'note'}
            title={tagOfTab(view.tab) ? '这个页签还没有记录' : view.tab === 'pinned' ? '还没有置顶的记录' : '还没有记录'}
            description={
              tagOfTab(view.tab)
                ? `在上面输入，保存时带上 #${tagOfTab(view.tab)}；也可以从卡片菜单「移到…」移过来。`
                : view.tab === 'pinned'
                  ? '常用的记录可以置顶，集中在这里。'
                  : phone
                    ? '在上面直接输入，点保存按钮保存。'
                    : `在上面直接输入，${SHORTCUT_KEYS.save} 保存。`
            }
          />
        )}
      </div>
      <SidebarFooter
        update={AVAILABLE_UPDATE?.version ?? null}
        onVersion={() => (AVAILABLE_UPDATE ? setUpdating(true) : setChangelog(true))}
        onSettings={props.onOpenSettings}
      />

      {menu && menuItems.length ? (
        <ContextMenu
          key={menu.type}
          label={menu.type === 'note' ? '记录操作' : menu.type === 'move' ? '移到页签' : '侧栏操作'}
          items={menuItems}
          point={menu.point}
          onClose={() => setMenu((current) => (current?.type === menu.type ? null : current))}
        />
      ) : null}
      <MergeDialog request={merging} onClose={() => setMerging(null)} onDone={finishMerge} />
      <NoteInfoDialog note={infoNote} onClose={() => setInfoNote(null)} />
      <TagManageDialog
        tag={managingTag}
        onClose={() => setManagingTag(null)}
        onRenamed={(next) => {
          if (managingTag && view.tag && tagKey(view.tag) === tagKey(managingTag)) view.setTag(next);
          setManagingTag(null);
        }}
        onRemoved={() => {
          if (managingTag && view.tag && tagKey(view.tag) === tagKey(managingTag)) view.setTag('');
          setManagingTag(null);
        }}
      />
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
      <UpdateDialog update={AVAILABLE_UPDATE} open={updating} onClose={() => setUpdating(false)} />
    </aside>
  );
}
