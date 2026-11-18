/**
 * 侧栏页签栏（原型第二版，interactions.md 第十二节，与交互原型的 tabs.js 相同）。
 *
 * - 页签是随记、置顶与用户手动固定的标签；标签页签不写 #，名称超过 4 个字截断，条数只写在随记与当前页签上。
 * - 排法见 core/tabLayout 的 fitTabs：放得下时全部显示，最后一格是「+」；放不下时最后一个显示的页签与「N ▾」合成末格，
 *   从菜单选页签只换末格里的页签，前面的页签不动；当前页签本该收起时也换进末格，始终显示名字。
 *   宽度取自看不见的测量行（与页签栏同样的类名，见 window.css 的 .tabs-measure）。
 * - 双击标签页签原地改名，右键「改名」「移出页签栏」；最后一格菜单中收起的页签右键多一项「放到页签栏」。
 * - 按住标签页签（或菜单中收起的页签）移动 5 像素后拖动排序，插入线标出位置；拖到最后一格上停 0.6 秒展开菜单。
 * - 键盘：← → 在可见的页签之间切换，Home、End 到两端；移到最后一格时只聚焦，Enter 或 ↓ 打开菜单（是「+」时新建页签）。
 * 卡片拖到页签上的处理在 useCardInteractions：页签与菜单中的页签带 data-tab，最后一格停留时调用 openMenu({ dragging: true })。
 */

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { ContextMenu, type MenuItems } from './ContextMenu';
import { useLatest } from '../hooks/useLatest';
import { fitTabs, type TabFit } from '../core/tabLayout';
import { allTags, findPinned, tabOfTag, tagOfTab } from '../core/tabs';
import { tagKey } from '../core/tags';
import type { Note, TabKey } from '../core/types';

/** 新建页签时最多列出的已有标签。 */
const MAX_CANDIDATES = 6;
/** 拖动页签或卡片时，停在最后一格上多久展开菜单。 */
const MENU_DELAY = 600;

export interface SidebarTabsHandle {
  /**
   * 打开最后一格的菜单。dragging：焦点不移进菜单（拖动卡片或页签时停在最后一格上）；hold：拖动卡片时展开，
   * 拖动期间不因滚动、指针与窗口失焦关闭，由拖动的一方松开或取消时调用 closeMenu 收起。
   */
  openMenu: (options?: { dragging?: boolean; hold?: boolean }) => void;
  closeMenu: () => void;
  /**
   * Esc 分层的第一层（侧栏在捕获阶段处理 Esc，先于这些控件自己的处理）：关闭页签的右键菜单、最后一格的菜单、
   * 新建页签面板或取消改名，焦点回到打开它的页签或最后一格（与原型菜单的 returnFocus 相同）；没有打开的返回 false。
   * 拖动卡片时展开的菜单（hold）不在这里关闭，由拖动的一方取消拖动时收起。
   */
  dismiss: () => boolean;
}

export interface SidebarTabsProps {
  ref?: Ref<SidebarTabsHandle>;
  tab: TabKey;
  /** 全局搜索时搜索框盖住页签栏，页签不标出当前页签；排法仍按当前页签算，结束搜索时页签栏不变。 */
  searching: boolean;
  notes: readonly Note[];
  pinnedTags: readonly string[];
  /** 随记的条数（一直显示）与当前页签的条数。 */
  workspaceCount: number;
  currentCount: number;
  /** 拖动卡片时指针停着的页签（浅强调色）。 */
  dragTab: string | null;
  onSelect: (tab: TabKey) => void;
  /** 固定一个标签并切换过去；返回是否完成（名称不合法时提示并返回 false）。 */
  onPin: (name: string) => boolean;
  onUnpin: (tag: string) => void;
  /** 改名，完成后焦点回到改名后的页签。 */
  onRename: (tag: string, next: string) => Promise<unknown> | void;
  /** 收起的页签改名：打开「管理 #标签」。 */
  onManage: (tag: string) => void;
  /** 拖动排序后的新顺序。 */
  onReorder: (list: string[]) => Promise<boolean>;
  /** 打开的弹层：menu 是最后一格的菜单或页签的右键菜单，input 是新建页签面板或改名框（侧栏据此保持展开）。 */
  onPopupChange?: (popup: 'menu' | 'input' | null) => void;
  /** 搜索框展开、盖住了页签栏：页签不可交互，读屏软件也不读（与原型 toggleSearch 相同）。 */
  covered?: boolean;
}

type Point = { x: number; y: number };

/** 拖动页签排序的过程（指针移动 5 像素后才开始）。 */
interface Press {
  tag: string;
  x: number;
  y: number;
  pointerId: number;
  active: boolean;
  /** 落点在固定顺序中的位置；-1 表示放回原处或不在页签栏与菜单里。 */
  index: number;
  region: '' | 'bar' | 'menu';
  timer: number;
}

/** 插入线：页签栏中是竖线，菜单中是横线。 */
interface DropLine {
  left: number;
  top: number;
  width?: number;
  height?: number;
  horizontal: boolean;
}

export function SidebarTabs({
  ref,
  tab,
  searching,
  notes,
  pinnedTags: tags,
  workspaceCount,
  currentCount,
  dragTab,
  onSelect,
  onPin,
  onUnpin,
  onRename,
  onManage,
  onReorder,
  onPopupChange,
  covered = false,
}: SidebarTabsProps) {
  const nav = useRef<HTMLElement>(null);
  const measure = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<TabFit | null>(null);
  // 上一次换进末格的页签：切到前面的页签后末格仍是它（只在本次打开期间记得）。
  const [swapped, setSwapped] = useState('');
  const [renaming, setRenaming] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tag: string; point: Point; collapsed: boolean } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{ dragging: boolean; hold: boolean; key: number; anchor: HTMLElement } | null>(null);
  // 新建页签的面板，挂在最后一格下方（记下打开时的按钮，渲染时不读 ref）。
  const [creating, setCreating] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState('');
  const [dropLine, setDropLine] = useState<DropLine | null>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const menuSerial = useRef(0);

  const selectedTab = searching ? null : tab;
  const current = tagOfTab(tab);
  const currentIndex = current ? tags.findIndex((item) => tagKey(item) === tagKey(current)) : -1;
  const swappedIndex = swapped ? tags.findIndex((item) => tagKey(item) === tagKey(swapped)) : -1;
  const shown = fit ? fit.visible.filter((index) => index < tags.length) : tags.map((_, index) => index);
  const hidden = tags.filter((_, index) => !shown.includes(index));
  const slot = fit ? fit.slot : 'add';
  const last = fit ? fit.last : -1;
  const slotTag = last >= 0 ? tags[last] ?? '' : '';
  // 末格里的页签是换进来的：排在它前面的页签有收起的。
  const swappedIn = last >= 0 && tags.some((_, index) => index < last && !shown.includes(index));
  const slotIsCurrent = Boolean(slotTag) && tagKey(slotTag) === tagKey(current);
  const counted = !fit || fit.counted;

  // 告诉侧栏打开了哪种弹层：菜单期间保持展开（与原型 keepVisible 的 NoteMenus.isOpen 相同）。
  const popup = slotMenu || tabMenu ? 'menu' : creating || renaming ? 'input' : null;
  useEffect(() => {
    onPopupChange?.(popup);
  }, [popup, onPopupChange]);
  useEffect(() => () => onPopupChange?.(null), [onPopupChange]);

  /** 页签上写的条数：随记一直写；当前页签放得下时写（测量行照常写，用来量宽度）。 */
  const countOf = (key: TabKey, measured = false): number | null => {
    if (key === 'workspace') return workspaceCount;
    if (key !== tab) return null;
    return measured || counted ? currentCount : null;
  };

  /* ==================== 排布 ==================== */

  /** 量出显示哪些标签页签（规则见 core/tabLayout）：宽度取自看不见的测量行。 */
  const layout = useCallback(() => {
    const box = measure.current;
    const row = nav.current;
    const parent = row?.parentElement;
    if (!box || !row || !parent || row.querySelector('.tab-rename-input')) return;
    const width = (node: Element | null) => (node ? node.getBoundingClientRect().width : 0);
    const parentStyle = getComputedStyle(parent);
    const available = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
    const rowStyle = getComputedStyle(box);
    const gap = parseFloat(rowStyle.columnGap) || 0;
    const edges = parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.paddingRight);
    const fixed = Array.from(box.querySelectorAll('[data-measure="fixed"]')).reduce((sum, node) => sum + width(node) + gap, edges);
    const one = width(box.querySelector('[data-measure="count"]'));
    const two = width(box.querySelector('[data-measure="count-2"]'));
    const probe = width(box.querySelector('[data-measure="probe"]'));
    const measured = Array.from(box.querySelectorAll<HTMLElement>('[data-measure="tag"]'));
    const widths = measured.map(width);
    const labels = measured.map((node) => width(node.querySelector('.tab-name')));
    const currentAt = Number(box.dataset.current ?? -1);
    // 当前页签的条数占的宽度（随记的条数一直显示，不算）：显示哪些页签不按它定，切换页签时前面的页签不变。
    const selected = box.querySelector<HTMLElement>('[aria-selected="true"]');
    const counter = selected && selected.dataset.tab !== 'workspace' ? selected.querySelector('[data-count]') : null;
    const extra = counter ? width(counter) + (parseFloat(getComputedStyle(selected as Element).columnGap) || 0) : 0;
    const next = fitTabs({
      available,
      fixed,
      tags: widths,
      gap,
      add: width(box.querySelector('[data-measure="add"]')),
      count: (count) => (count >= 10 ? two : one),
      // 末格的页签与「N ▾」紧挨着：「N ▾」的负外边距抵消了页签间距（theme.css 的 .tab-more.is-joined）。
      joint: 0,
      current: currentAt,
      extra,
      swapped: Number(box.dataset.swapped ?? -1),
      // 名字最短留两个字；本来就不到两个字的不再缩。
      shrink: (index) => Math.max(0, labels[index] - probe),
    });
    setFit((previous) =>
      previous &&
      previous.slot === next.slot &&
      previous.last === next.last &&
      previous.squeezed === next.squeezed &&
      previous.counted === next.counted &&
      previous.visible.join() === next.visible.join()
        ? previous
        : next,
    );
    // 当前页签在末格时记下它：切到前面的页签后末格仍是它。
    const name = currentAt >= 0 && next.last === currentAt ? (measured[currentAt]?.dataset.tag ?? '') : '';
    if (name) setSwapped((previous) => (tagKey(previous) === tagKey(name) ? previous : name));
  }, [setFit, setSwapped]);

  // 每次渲染后复核：条数、当前页签、字号与主题都会改变页签的宽度；结果不变时不会再渲染。
  useLayoutEffect(() => {
    layout();
  });
  // 侧栏宽度变化、字体加载完成时重新测量。
  useEffect(() => {
    const row = nav.current;
    const box = measure.current;
    if (!row?.parentElement || !box) return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(row.parentElement);
    observer.observe(box);
    return () => observer.disconnect();
  }, [layout]);

  /* ==================== 菜单 ==================== */

  const openMenu = useCallback((options: { dragging?: boolean; hold?: boolean } = {}) => {
    const anchor = moreRef.current;
    if (!anchor) return;
    menuSerial.current += 1;
    setTabMenu(null);
    setSlotMenu({ dragging: Boolean(options.dragging), hold: Boolean(options.hold), key: menuSerial.current, anchor });
  }, [setTabMenu, setSlotMenu]);
  const closeMenu = useCallback(() => setSlotMenu(null), [setSlotMenu]);

  /** 焦点移到页签栏里的这个页签（从菜单选中后它换进末格；下一帧再找，等页签栏按新的末格渲染）。 */
  const focusTab = useCallback((key: TabKey) => {
    window.requestAnimationFrame(() => {
      const node = Array.from(nav.current?.querySelectorAll<HTMLElement>('.tab[data-tab]') ?? []).find((item) => item.dataset.tab === key);
      node?.focus({ preventScroll: true });
    });
  }, []);

  const dismiss = useCallback(() => {
    const target = document.activeElement;
    // 改名框与新建页签面板自己处理 Esc（取消并把焦点还回去）；焦点不在里面时由这里关闭。
    if (renaming) {
      if (!(target instanceof HTMLElement && target.classList.contains('tab-rename-input'))) setRenaming('');
      return true;
    }
    if (creating) {
      if (!(target instanceof HTMLElement && target.closest('.tab-create-panel'))) {
        setCreating(null);
        if (creating.isConnected) creating.focus({ preventScroll: true });
      }
      return true;
    }
    if (tabMenu) {
      setTabMenu(null);
      // 菜单中收起的页签回到它在菜单里的那一项，页签栏里的回到这个页签。
      const key = tabOfTag(tabMenu.tag);
      const item = tabMenu.collapsed ? document.querySelector<HTMLElement>(`.tab-menu [data-tab="${CSS.escape(key)}"]`) : null;
      if (item) item.focus({ preventScroll: true });
      else focusTab(key);
      return true;
    }
    if (slotMenu && !slotMenu.hold) {
      setSlotMenu(null);
      if (slotMenu.anchor.isConnected) slotMenu.anchor.focus({ preventScroll: true });
      return true;
    }
    return false;
  }, [renaming, creating, tabMenu, slotMenu, focusTab]);
  useImperativeHandle(ref, () => ({ openMenu, closeMenu, dismiss }), [openMenu, closeMenu, dismiss]);

  /** 单击最后一格：都放得下时直接新建页签，有收起的页签时打开菜单。 */
  const activateMore = () => {
    if (hidden.length) openMenu();
    else setCreating(moreRef.current);
  };

  type SlotCommand = `tab:${string}` | 'create';
  const slotEntries: MenuItems<SlotCommand> = [
    ...hidden.map((tag) => ({
      command: tabOfTag(tag) as SlotCommand,
      label: tag,
      icon: 'hash' as const,
      data: { 'data-tab': tabOfTag(tag) } as Record<`data-${string}`, string>,
      className: [dragging && tagKey(dragging) === tagKey(tag) ? 'is-drag-source' : '', dragTab === tabOfTag(tag) ? 'is-drag-target' : '']
        .filter(Boolean)
        .join(' '),
      onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setTabMenu({ tag, point: { x: event.clientX, y: event.clientY }, collapsed: true });
      },
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => startPress(event, tag),
    })),
    ...(hidden.length ? (['separator'] as const) : []),
    { command: 'create', label: '新建页签', icon: 'plus' },
  ];

  /* ==================== 拖动排序 ==================== */

  /** 指针处的插入位置：index 按固定的顺序计（保存用），菜单中按纵向位置落在收起的页签之间。 */
  const dropAt = (x: number, y: number): { index: number; region: Press['region']; line: DropLine | null } => {
    const position = (tag: string) => tags.findIndex((item) => tagKey(item) === tagKey(tag));
    const menuItems = Array.from(document.querySelectorAll<HTMLElement>('.tab-menu .note-context-item[data-tab]'));
    const menu = menuItems[0]?.closest('.tab-menu');
    if (menu) {
      const box = menu.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        let row = menuItems.findIndex((node) => {
          const rect = node.getBoundingClientRect();
          return y < rect.top + rect.height / 2;
        });
        if (row < 0) row = menuItems.length;
        const anchor = menuItems[Math.min(row, menuItems.length - 1)].getBoundingClientRect();
        return {
          index: row < menuItems.length ? position(tagOfTab(menuItems[row].dataset.tab as TabKey)) : tags.length,
          region: 'menu',
          line: { left: anchor.left, top: row < menuItems.length ? anchor.top : anchor.bottom, width: anchor.width, horizontal: true },
        };
      }
    }
    const bar = nav.current?.getBoundingClientRect();
    if (!bar || y < bar.top - 8 || y > bar.bottom + 8 || x < bar.left || x > bar.right) return { index: -1, region: '', line: null };
    const visibleTabs = Array.from(nav.current?.querySelectorAll<HTMLElement>('.tab.is-tag-tab') ?? []);
    let at = visibleTabs.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    if (at < 0) at = visibleTabs.length;
    // 换进末格的页签不在它本来的位置：落在它前后时，排到前面最后一个页签之后。
    const front = visibleTabs.filter((node) => !node.classList.contains('is-swapped'));
    const index =
      at < visibleTabs.length && !visibleTabs[at].classList.contains('is-swapped')
        ? position(tagOfTab(visibleTabs[at].dataset.tab as TabKey))
        : front.length
          ? position(tagOfTab(front[front.length - 1].dataset.tab as TabKey)) + 1
          : 0;
    const anchorNode = visibleTabs.length ? visibleTabs[Math.min(at, visibleTabs.length - 1)] : moreRef.current;
    const anchor = anchorNode?.getBoundingClientRect();
    return {
      index,
      region: 'bar',
      line: anchor ? { left: visibleTabs.length && at >= visibleTabs.length ? anchor.right : anchor.left, top: anchor.top, height: anchor.height, horizontal: false } : null,
    };
  };

  // 拖动中的处理函数要读到最新的页签与菜单：每次提交之后放进 ref，窗口上的监听器只调用 ref 里的函数。
  const handlers = useRef({ move: (_event: PointerEvent) => {}, end: (_event: PointerEvent) => {} });
  const movePress = useCallback((event: PointerEvent) => handlers.current.move(event), []);
  const endPress = useCallback((event: PointerEvent) => handlers.current.end(event), []);

  function startPress(event: ReactPointerEvent<HTMLElement>, tag: string) {
    if (event.button !== 0 || press.current) return;
    press.current = { tag, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false, index: -1, region: '', timer: 0 };
    window.addEventListener('pointermove', movePress, true);
    window.addEventListener('pointerup', endPress, true);
    window.addEventListener('pointercancel', endPress, true);
  }

  const handleMove = (event: PointerEvent) => {
    const state = press.current;
    if (!state || event.pointerId !== state.pointerId) return;
    if (!state.active) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
      state.active = true;
      setDragging(state.tag);
      document.body.classList.add('is-dragging-tab');
    }
    event.preventDefault();
    const box = moreRef.current?.getBoundingClientRect();
    const overMore = Boolean(box) && event.clientX >= box!.left && event.clientX <= box!.right && event.clientY >= box!.top && event.clientY <= box!.bottom;
    const menuOpen = Boolean(document.querySelector('.tab-menu'));
    if (overMore && hidden.length && !menuOpen && !state.timer) {
      state.timer = window.setTimeout(() => {
        if (press.current?.active) openMenu({ dragging: true });
        if (press.current) press.current.timer = 0;
      }, MENU_DELAY);
    } else if (!overMore && state.timer) {
      window.clearTimeout(state.timer);
      state.timer = 0;
    }
    const at = dropAt(event.clientX, event.clientY);
    const from = tags.findIndex((item) => tagKey(item) === tagKey(state.tag));
    state.index = at.index < 0 || at.index === from || at.index === from + 1 ? -1 : at.index;
    state.region = at.region;
    setDropLine(state.index < 0 ? null : at.line);
  };
  const handleEnd = (event: PointerEvent) => {
    const state = press.current;
    if (!state || event.pointerId !== state.pointerId) return;
    window.removeEventListener('pointermove', movePress, true);
    window.removeEventListener('pointerup', endPress, true);
    window.removeEventListener('pointercancel', endPress, true);
    press.current = null;
    window.clearTimeout(state.timer);
    setDropLine(null);
    if (!state.active) return;
    setDragging('');
    document.body.classList.remove('is-dragging-tab');
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (event.type !== 'pointerup' || state.index < 0) return;
    const list = tags.slice();
    const from = list.findIndex((item) => tagKey(item) === tagKey(state.tag));
    if (from < 0) return;
    let to = state.index;
    if (to > from) to -= 1;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const region = state.region;
    void onReorder(list).then((saved) => {
      if (!saved) return;
      // 拖进页签栏的页签排在落点上：末格换进来的页签（不是当前页签时）让出位置，按新的顺序排。
      if (region === 'bar' && swapped && tagKey(swapped) !== tagKey(current)) setSwapped('');
      if (region === 'menu') openMenu({ dragging: true });
      else setSlotMenu(null);
    });
  };
  useEffect(() => {
    handlers.current = { move: handleMove, end: handleEnd };
  });
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', movePress, true);
      window.removeEventListener('pointerup', endPress, true);
      window.removeEventListener('pointercancel', endPress, true);
      document.body.classList.remove('is-dragging-tab');
    },
    [movePress, endPress],
  );

  // 拖动松开后的那次单击不切换页签，也不触发菜单项。
  useEffect(() => {
    const swallow = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('click', swallow, true);
    return () => document.removeEventListener('click', swallow, true);
  }, []);

  /* ==================== 键盘 ==================== */

  /** 页签按 WAI-ARIA 页签模式：← → 切换并立即显示，Home、End 到两端；移到最后一格时只聚焦。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const list = Array.from(nav.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const index = list.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? list[(index + 1) % list.length]
        : event.key === 'ArrowLeft'
          ? list[(index - 1 + list.length) % list.length]
          : event.key === 'Home'
            ? list[0]
            : event.key === 'End'
              ? list[list.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    if (!next.classList.contains('tab-more') && next.dataset.tab) onSelect(next.dataset.tab as TabKey);
  };

  /* ==================== 渲染 ==================== */

  const fixedTab = (key: 'workspace' | 'pinned', measured: boolean) => {
    const selected = measured ? tab === key : selectedTab === key;
    const count = countOf(key, measured);
    const content = (
      <>
        <span className="tab-mark" aria-hidden="true" />
        {key === 'pinned' ? (
          <>
            <Icon name="pin" /> 置顶
          </>
        ) : (
          '随记'
        )}
        <span data-count={key} hidden={count === null}>
          {count ?? ''}
        </span>
      </>
    );
    if (measured) {
      return (
        <span key={key} className={selected ? 'tab active' : 'tab'} data-measure="fixed" data-tab={key} aria-selected={selected}>
          {content}
        </span>
      );
    }
    return (
      <button
        key={key}
        type="button"
        role="tab"
        className={['tab', selected ? 'active' : '', dragTab === key ? 'is-drag-target' : ''].filter(Boolean).join(' ')}
        data-tab={key}
        aria-selected={selected}
        aria-controls="note-list"
        tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(key)}
      >
        {content}
      </button>
    );
  };

  const tagTab = (index: number) => {
    const tag = tags[index];
    if (tag === undefined) return null;
    const key = tabOfTag(tag);
    if (renaming && tagKey(renaming) === tagKey(tag)) {
      return (
        <RenameInput
          key={`rename-${tag}`}
          tag={tag}
          onDone={(value) => {
            setRenaming('');
            const next = value?.trim().replace(/^#/, '') ?? '';
            if (!next || next === tag) {
              focusTab(key);
              return;
            }
            void Promise.resolve(onRename(tag, next)).then(() => focusTab(tabOfTag(next)));
          }}
        />
      );
    }
    const selected = selectedTab === key;
    const count = countOf(key);
    return (
      <button
        key={key}
        type="button"
        role="tab"
        className={[
          'tab is-tag-tab',
          selected ? 'active' : '',
          index === last ? 'is-slot' : '',
          index === last && swappedIn ? 'is-swapped' : '',
          index === fit?.squeezed ? 'is-squeezed' : '',
          dragTab === key ? 'is-drag-target' : '',
          dragging && tagKey(dragging) === tagKey(tag) ? 'is-drag-source' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-tab={key}
        aria-selected={selected}
        aria-controls="note-list"
        tabIndex={selected ? 0 : -1}
        onClick={() => onSelect(key)}
        onDoubleClick={(event) => {
          event.preventDefault();
          setRenaming(tag);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSlotMenu(null);
          setTabMenu({ tag, point: { x: event.clientX, y: event.clientY }, collapsed: false });
        }}
        onPointerDown={(event) => startPress(event, tag)}
      >
        <span className="tab-mark" aria-hidden="true" />
        <span className="tab-name">{tag}</span>
        <span className="tab-count" data-count="" hidden={count === null}>
          {count ?? ''}
        </span>
      </button>
    );
  };

  return (
    <>
      <nav
        ref={nav}
        className="sidebar-tabs"
        role="tablist"
        aria-label="记录列表"
        aria-hidden={covered || undefined}
        inert={covered || undefined}
        onKeyDown={handleKeyDown}
      >
        {fixedTab('workspace', false)}
        {fixedTab('pinned', false)}
        {shown.map(tagTab)}
        {slot === 'none' ? null : (
          <button
            ref={moreRef}
            type="button"
            role="tab"
            className={['tab tab-more', hidden.length ? '' : 'is-add', hidden.length && last >= 0 ? 'is-joined' : '', dragTab === 'more' ? 'is-drag-target' : '']
              .filter(Boolean)
              .join(' ')}
            aria-selected={false}
            aria-controls="note-list"
            aria-haspopup={hidden.length ? 'menu' : undefined}
            aria-expanded={hidden.length ? Boolean(slotMenu) : Boolean(creating)}
            aria-label={hidden.length ? `另有 ${hidden.length} 个收起的页签，新建页签` : '新建页签'}
            tabIndex={-1}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              activateMore();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              activateMore();
            }}
          >
            {hidden.length ? (
              <>
                <span className="tab-more-count">{hidden.length}</span>
                <Icon name="chevron-down" />
              </>
            ) : (
              <Icon name="plus" />
            )}
          </button>
        )}
      </nav>

      {/* 测量行：与页签栏同样的页签，看不见，只用来量宽度（包括收起的页签与最后一格的「+」和「N ▾」）。 */}
      <nav ref={measure} className="sidebar-tabs tabs-measure" data-current={currentIndex} data-swapped={swappedIndex} aria-hidden="true" inert>
        {fixedTab('workspace', true)}
        {fixedTab('pinned', true)}
        {tags.map((tag) => {
          const key = tabOfTag(tag);
          const selected = tab === key;
          const count = countOf(key, true);
          return (
            <span key={key} className={selected ? 'tab is-tag-tab active' : 'tab is-tag-tab'} data-measure="tag" data-tag={tag} data-tab={key} aria-selected={selected}>
              <span className="tab-mark" aria-hidden="true" />
              <span className="tab-name">{tag}</span>
              <span className="tab-count" data-count="" hidden={count === null}>
                {count ?? ''}
              </span>
            </span>
          );
        })}
        <span className="tab-name-probe" data-measure="probe">
          汉字
        </span>
        <span className="tab tab-more is-add" data-measure="add">
          <Icon name="plus" />
        </span>
        <span className="tab tab-more is-joined" data-measure="count">
          <span className="tab-more-count">8</span>
          <Icon name="chevron-down" />
        </span>
        <span className="tab tab-more is-joined" data-measure="count-2">
          <span className="tab-more-count">88</span>
          <Icon name="chevron-down" />
        </span>
      </nav>

      {slotMenu ? (
        <ContextMenu<SlotCommand>
          key={slotMenu.key}
          entries={slotEntries}
          anchor={slotMenu.anchor}
          label="页签"
          className="tab-menu"
          focus={!slotMenu.dragging}
          onCommand={(command) => {
            setSlotMenu(null);
            if (command === 'create') {
              setCreating(slotMenu.anchor);
              return;
            }
            onSelect(command as TabKey);
            focusTab(command as TabKey);
          }}
          onClose={() => {
            // 拖动中（页签或卡片）展开的菜单不因指针事件关闭，松开后由拖动的一方处理。
            if (press.current?.active || slotMenu.hold) return;
            setSlotMenu(null);
          }}
        />
      ) : null}

      {tabMenu ? (
        <ContextMenu<'promote' | 'rename' | 'unpin'>
          entries={[
            ...(tabMenu.collapsed && !slotIsCurrent ? [{ command: 'promote' as const, label: '放到页签栏', icon: 'arrow-up' as const }] : []),
            { command: 'rename', label: '改名', icon: 'edit', hint: tabMenu.collapsed ? undefined : '双击' },
            'separator',
            { command: 'unpin', label: '移出页签栏', icon: 'x' },
          ]}
          anchor={tabMenu.point}
          label={`页签「${tabMenu.tag}」`}
          onCommand={(command) => {
            const { tag, collapsed } = tabMenu;
            setTabMenu(null);
            if (command === 'promote') {
              setSlotMenu(null);
              setSwapped(tag);
            } else if (command === 'rename') {
              if (collapsed) onManage(tag);
              else setRenaming(tag);
            } else {
              setSlotMenu(null);
              onUnpin(tag);
            }
          }}
          onClose={() => setTabMenu(null)}
        />
      ) : null}

      {creating ? (
        <TabCreatePanel
          anchor={creating}
          notes={notes}
          pinnedTags={tags}
          onPin={onPin}
          onClose={(refocus) => {
            const anchor = creating;
            setCreating(null);
            if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
          }}
        />
      ) : null}

      {dropLine
        ? createPortal(
            <span
              className={dropLine.horizontal ? 'sidebar-tab-drop is-horizontal' : 'sidebar-tab-drop'}
              aria-hidden="true"
              style={{ left: dropLine.left, top: dropLine.top, width: dropLine.width, height: dropLine.height }}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/** 双击页签原地改名：Enter 或点到别处确认，Esc 取消。 */
function RenameInput({ tag, onDone }: { tag: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(tag);
  const finished = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <input
      ref={input}
      className="tab-rename-input"
      type="text"
      value={value}
      size={Math.max(2, Array.from(value).length + 1)}
      aria-label="页签名称"
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}

/**
 * 新建页签：最后一格下方弹出一个输入框，输入时列出还没固定的已有标签（条数多的在前，最多 6 个），
 * ↑ ↓ 选择、Enter 固定，Esc 或点到外面取消。输入的名称不是已有标签时得到一个空页签。
 */
function TabCreatePanel({
  anchor,
  notes,
  pinnedTags,
  onPin,
  onClose,
}: {
  anchor: HTMLElement;
  notes: readonly Note[];
  pinnedTags: readonly string[];
  onPin: (tag: string) => boolean;
  onClose: (refocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [value, setValue] = useState('');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const query = tagKey(value.trim().replace(/^#/, ''));
  const candidates = allTags(notes)
    .filter((item) => !findPinned(pinnedTags, item.tag) && (!query || tagKey(item.tag).includes(query)))
    .slice(0, MAX_CANDIDATES);
  const index = candidates.length ? Math.min(active, candidates.length - 1) : -1;

  // 放在按钮下方、右边对齐，限制在视口内。
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const margin = 8;
    const box = anchor.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    const left = Math.max(margin, Math.min(box.right - size.width, window.innerWidth - size.width - margin));
    const top = Math.max(margin, Math.min(box.bottom + 4, window.innerHeight - size.height - margin));
    setPosition((previous) => (previous && previous.left === left && previous.top === top ? previous : { left, top }));
  }, [anchor, candidates.length]);

  useEffect(() => {
    if (position) input.current?.focus({ preventScroll: true });
  }, [position]);

  // 监听器只挂一次，回调从 useLatest 取（原因见 useLatest）。
  const closeRef = useLatest(onClose);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) closeRef.current(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [closeRef]);

  const choose = (tag: string) => {
    if (tag && onPin(tag)) onClose(false);
  };

  return createPortal(
    <div
      ref={panel}
      className="floating-panel tab-create-panel"
      role="dialog"
      aria-label="新建页签"
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
    >
      <input
        ref={input}
        className="form-control tab-create-input"
        type="text"
        value={value}
        placeholder="标签名称"
        aria-label="标签名称"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={candidates.length > 0}
        aria-controls={listId}
        aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value);
          setActive(event.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && candidates.length) {
            event.preventDefault();
            setActive((index + (event.key === 'ArrowDown' ? 1 : candidates.length - 1) + candidates.length) % candidates.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(index >= 0 ? candidates[index].tag : value.trim());
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose(true);
          }
        }}
      />
      <div id={listId} className="tab-create-list" role="listbox" aria-label="已有标签">
        {candidates.map((item, position) => (
          <button
            key={item.tag}
            id={`${listId}-${position}`}
            type="button"
            role="option"
            aria-selected={position === index}
            tabIndex={-1}
            className={position === index ? 'tab-create-option is-active' : 'tab-create-option'}
            data-tag={item.tag}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(item.tag)}
          >
            <Icon name="hash" />
            <span className="tab-create-option-name">{item.tag}</span>
            <span className="tab-create-option-count">{item.count}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
