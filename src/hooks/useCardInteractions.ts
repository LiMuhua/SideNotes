/**
 * 卡片长按排序与多选，移植自原型 interactions.js。
 *
 * 手势在 document 捕获阶段处理，优先于卡片自身的单击选中与双击编辑：
 * - 在卡片上按住 300 毫秒后开始拖动：可在卡片之间排序；停在页签上会切换过去，
 *   松开即移到该页签；拖到右下角的回收站则移入回收站。松开后一次性保存并提供撤销。
 * - 在列表空白处拖动框选；Ctrl/⌘ 单击切换选择，Shift 单击连续选择；
 *   有选择时单击卡片切换选择，单击别处清除选择，Ctrl+A 全选当前列表。
 *
 * - 按住卡片中的图片附件或文件引用（含内嵌图片）并移动，可以拖到另一张卡片里：
 *   插入线标出落点（图片之间，或正文段落之间），松开后从原卡片移出并提供撤销。
 * - 拖动途中按 Esc 取消。
 * - 卡片拖出侧栏（指针越过侧栏朝屏幕内侧的边）松开后在记录窗口中打开，经过已开的窗口时并进它的标签页（T83）：
 *   侧栏窗口按住指针，拖影离开侧栏后画在动画层上，落点与新开窗口由后端判断（core/bridge 的 dragBegin 等）。
 *
 * 跟随指针的卡片、插入线与框选矩形是挂在 body 上的临时元素；卡片与页签的状态类
 * 经 React 状态下发，避免与 React 渲染互相覆盖。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as bridge from '../core/bridge';
import type { Note, TabKey } from '../core/types';

/** 长按多久开始拖动。 */
const HOLD_DELAY = 300;
/** 拖动时停在页签上多久切换过去。 */
const TAB_SWITCH_DELAY = 240;
/** 拖动中停在页签栏最后一格上多久展开菜单。 */
const TAB_MENU_DELAY = 600;
/** 拖动结束后多久之内的点击视为拖动产生的合成点击。 */
const CLICK_GUARD = 650;
/** 不参与手势、保留自身行为的控件。 */
const INTERACTIVE = 'button,a,input,textarea,select,[contenteditable="true"]';

/** 拖动的放置位置：插入到目标记录之前或之后。 */
export interface DropTarget {
  id: string;
  after: boolean;
}

/** 拖动图片附件或正文引用到另一张卡片。 */
export interface ItemDrop {
  sourceId: string;
  targetId: string;
  /** image：图片附件；text：正文中的文件引用或内嵌图片。 */
  kind: 'image' | 'text';
  /** 图片附件的标识。 */
  imageId?: string;
  /** 正文引用在来源卡片显示正文中的范围。 */
  start?: number;
  end?: number;
  /** 图片：插入目标附件的序号；正文引用：插入目标显示正文的行号（超出时接在末尾）。 */
  index: number;
}

export interface CardInteractionOptions {
  /** 记录列表（#note-list）。 */
  listRef: RefObject<HTMLElement | null>;
  /** 右下角的回收站投放区。 */
  trashRef: RefObject<HTMLElement | null>;
  /** 当前列表中按显示顺序排列的记录。 */
  visibleNotes: Note[];
  /** 全部记录，用于校验选择与生成提示文字。 */
  notes: Note[];
  /** 当前页签。 */
  tab: TabKey;
  /** 列表视图标识（页签、搜索、标签）；变化时清除选择。 */
  viewKey: string;
  /** 编辑、弹窗或标签整理期间不启动手势。 */
  blocked: boolean;
  /**
   * 正在全局搜索：结果按页签分组，不能在其中排序，也不在停留时切换页签；拖到页签上照样移过去，
   * 每条记录按它自己所在的页签计算（与原型 interactions.js 相同）。
   */
  searching: boolean;
  /** 拖动中停在页签上时切换页签。 */
  onSwitchTab: (tab: TabKey) => void;
  /** 拖动中停在页签栏最后一格上：展开收起的页签，菜单中的页签可以作为落点。 */
  onOpenTabMenu: () => void;
  /** 拖动结束：收起拖动中展开的页签菜单。 */
  onCloseTabMenu: () => void;
  /** 移到页签或回收站，返回是否保存成功；from 是开始拖动时的页签。 */
  onMove: (ids: string[], destination: TabKey | 'trash', from: TabKey) => Promise<boolean>;
  /** 插入到目标记录之前或之后；拖动中切换过页签时，from 是开始拖动时的页签。 */
  onReorder: (ids: Set<string>, targetId: string, after: boolean, from: TabKey) => void;
  /** 把图片附件或正文引用移到另一张卡片。 */
  onMoveItem: (drop: ItemDrop) => void;
}

export interface CardInteractions {
  /** 已选择的记录。 */
  selected: ReadonlySet<string>;
  /** 正在长按、尚未开始拖动的卡片。 */
  pendingId: string | null;
  /** 被按住拖动的卡片。 */
  sortingId: string | null;
  /** 随本次拖动一起移动的卡片。 */
  memberIds: ReadonlySet<string>;
  /** 当前的插入位置。 */
  drop: DropTarget | null;
  /** 指针所在的页签。 */
  dragTab: TabKey | null;
  /** 正在拖动排序。 */
  sorting: boolean;
  /** 正在按压、拖动或框选。 */
  busy: boolean;
  /** 存在选择或处于多选模式。 */
  hasSelection: boolean;
  /** 多选按钮按下：卡片出现勾选框，单击就是勾选（列表加上 is-selecting）。 */
  selecting: boolean;
  /** 按下或松开多选按钮；松开时清空选择。 */
  toggleMode: () => void;
  /** 拖动图片或引用时指针所在的目标卡片。 */
  itemTargetId: string | null;
  /** 供事件处理函数同步读取最新状态。 */
  isBusy: () => boolean;
  isSelecting: () => boolean;
  clearSelection: () => void;
  /** 选中当前列表中的全部记录并进入多选，对应空白处菜单的「选择全部记录」。 */
  selectAll: () => void;
}

/** 一次按压或拖动手势。 */
interface Gesture {
  kind: 'sort' | 'frame' | 'item';
  eventKind: 'pointer' | 'mouse';
  pointerId: number | undefined;
  pointerType: string;
  startX: number;
  startY: number;
  startScrollTop: number;
  x: number;
  y: number;
  active: boolean;
  card: HTMLElement | null;
  id: string;
  base: Set<string>;
  timer: number;
  ids: Set<string>;
  originTab: TabKey;
  targetMode: '' | 'list' | 'tab' | 'trash' | 'window';
  targetDestination: string;
  targetId: string;
  after: boolean;
  tabCandidate: string;
  tabTimer: number;
  /** 停在页签栏最后一格上展开过菜单：结束时收起。 */
  menuOpened: boolean;
  ghost: HTMLElement | null;
  /** 拖影里抓住的那张卡片的副本。 */
  copy: HTMLElement | null;
  /** 指针相对卡片左上角的位置：拖影贴着抓点。 */
  grabX: number;
  grabY: number;
  /** 指针在侧栏之外（松开后在记录窗口中打开）。 */
  outside: boolean;
  /** 已经通知后端开始跨窗口拖动，结束时要通知它。 */
  session: boolean;
  /** 读屏用的说明文字（不放进页面，与原型相同）。 */
  label: HTMLElement | null;
  guide: HTMLElement | null;
  guideLabel: HTMLElement | null;
  overlay: HTMLElement | null;
  /** 拖动的图片或引用元素。 */
  item: HTMLElement | null;
  itemKind: 'image' | 'text';
  /** 放下时的目标卡片与插入序号；为空表示当前位置不能放下。 */
  itemTarget: string;
  itemIndex: number;
}

const now = (): number => performance.now();

function targetOf(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** 记录首行，落点提示用。 */
function firstLine(note: Note | undefined): string {
  return String(note?.text ?? '')
    .split(/\r?\n/)
    .find((line) => line.trim()) ?? '';
}

/** 落点提示中的短标题。 */
function shortTitle(note: Note | undefined): string {
  return (firstLine(note) || '图片记录').trim().slice(0, 18);
}

/** 页签名称（去掉计数）。 */
function tabName(tab: Element): string {
  return (tab.textContent ?? '').replace(/\d+/g, '').trim();
}

/** 卡片的干净副本：去掉拖动、选中与插入线的状态和 id（原型 cardCopy）。 */
function cardCopy(card: HTMLElement): HTMLElement {
  const copy = card.cloneNode(true) as HTMLElement;
  copy.classList.remove('is-sort-pending', 'is-sorting', 'is-sorting-member', 'drop-before', 'drop-after', 'is-selected', 'is-current');
  copy.removeAttribute('id');
  copy.removeAttribute('tabindex');
  copy.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  copy.querySelectorAll('img[loading]').forEach((node) => node.removeAttribute('loading'));
  return copy;
}

/**
 * 指针是否越过了侧栏朝屏幕内侧的边（原型 updateDropTarget 的 outside）：贴右边时在侧栏左边之外，贴左边时在右边之外。
 * 只有桌面端能把卡片拖出窗口；浏览器预览没有记录窗口。
 */
function outsideSidebar(x: number): boolean {
  if (!bridge.isDesktop()) return false;
  const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
  if (!sidebar) return false;
  return document.body.dataset.edge === 'left' ? x > sidebar.right + 4 : x < sidebar.left - 4;
}

export function useCardInteractions(options: CardInteractionOptions): CardInteractions {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [mode, setMode] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sortingId, setSortingId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<ReadonlySet<string>>(() => new Set());
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [dragTab, setDragTab] = useState<TabKey | null>(null);
  const [sorting, setSorting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [itemTargetId, setItemTargetId] = useState<string | null>(null);

  // 手势与选择的即时状态：事件处理函数读写这里，再同步到 React 状态用于渲染。
  const tools = useRef({
    selected: new Set<string>(),
    mode: false,
    anchor: '',
    gesture: null as Gesture | null,
    blockClick: false,
    lastDragAt: Number.NEGATIVE_INFINITY,
    lastPointerAt: Number.NEGATIVE_INFINITY,
    frame: 0,
    scrollFrame: 0,
    drop: '',
    dragTab: '',
    itemTarget: '',
  });

  const commitSelection = useCallback(() => {
    setSelected(new Set(tools.current.selected));
    setMode(tools.current.mode);
  }, []);

  const clearSelection = useCallback(() => {
    const t = tools.current;
    t.selected.clear();
    t.mode = false;
    t.anchor = '';
    commitSelection();
  }, [commitSelection]);

  const selectAll = useCallback(() => {
    const t = tools.current;
    optionsRef.current.visibleNotes.forEach((note) => t.selected.add(note.id));
    t.mode = true;
    commitSelection();
  }, [commitSelection]);

  /**
   * 筛选行的多选按钮（原型 toggleMode）：没按下时按下，卡片出现勾选框，已用 Ctrl 或 Shift 选中的保留；
   * 按下时再点一下退出并清空。
   */
  const toggleMode = useCallback(() => {
    const t = tools.current;
    if (t.mode) {
      clearSelection();
      return;
    }
    t.mode = true;
    commitSelection();
  }, [clearSelection, commitSelection]);

  const isBusy = useCallback(() => Boolean(tools.current.gesture), []);
  const isSelecting = useCallback(() => tools.current.mode || tools.current.selected.size > 0, []);

  // 列表视图变化（切换页签、搜索、标签）时清除选择；拖动途中切换页签除外。
  useEffect(() => {
    if (tools.current.gesture?.active) return;
    clearSelection();
  }, [options.viewKey, clearSelection]);

  // 选择中的记录被删除或移入回收站后不再保留。
  useEffect(() => {
    const t = tools.current;
    const valid = new Set(options.notes.filter((note) => note.status !== 'trash').map((note) => note.id));
    let changed = false;
    t.selected.forEach((id) => {
      if (!valid.has(id)) {
        t.selected.delete(id);
        changed = true;
      }
    });
    if (changed) commitSelection();
  }, [options.notes, commitSelection]);

  useEffect(() => {
    const t = tools.current;
    const opts = (): CardInteractionOptions => optionsRef.current;
    const hasSelection = (): boolean => t.mode || t.selected.size > 0;
    const visibleIds = (): string[] => opts().visibleNotes.map((note) => note.id);
    const selectedIds = (): string[] =>
      opts()
        .notes.filter((note) => t.selected.has(note.id) && note.status !== 'trash')
        .map((note) => note.id);
    const findNote = (id: string): Note | undefined => opts().notes.find((note) => note.id === id);

    /** 阻止本次事件继续触发卡片的选中与编辑。 */
    const consume = (event: Event): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    /** 单击选择：Shift 选择连续区间，否则切换单张卡片。 */
    /**
     * 选中卡片（原型第二版 choose，与 Windows 资源管理器相同）：
     * - Ctrl+单击：加选或减选这一张；还没有选中的卡片时，起点那张也选上（先单击卡片 1，再 Ctrl+单击卡片 2，两张都选中）；
     * - Shift+单击：从起点选到这一张，换掉原来的选择；同时按 Ctrl 或多选按钮按下时，加进原来的选择；
     * - 多选按钮按下时单击：勾选或取消这一张。
     * 起点是上一次不按 Shift 单击的卡片，悬停的高亮不算；起点不在当前列表中时只切换这一张。
     */
    const choose = (id: string, range: boolean, additive: boolean): void => {
      const ids = visibleIds();
      const anchor = t.anchor && ids.includes(t.anchor) ? t.anchor : '';
      if (range && anchor) {
        const start = ids.indexOf(anchor);
        const end = ids.indexOf(id);
        if (!additive) t.selected.clear();
        ids.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => t.selected.add(item));
      } else {
        if (!t.selected.size && !t.mode && anchor && anchor !== id) t.selected.add(anchor);
        if (t.selected.has(id)) t.selected.delete(id);
        else t.selected.add(id);
        t.anchor = id;
      }
      commitSelection();
    };

    const setDropTarget = (value: DropTarget | null): void => {
      const key = value ? `${value.id}:${value.after}` : '';
      if (key === t.drop) return;
      t.drop = key;
      setDrop(value);
    };

    const setItemHighlight = (id: string): void => {
      if (id === t.itemTarget) return;
      t.itemTarget = id;
      setItemTargetId(id || null);
    };

    const setTabHighlight = (tab: string): void => {
      if (tab === t.dragTab) return;
      t.dragTab = tab;
      setDragTab((tab || null) as TabKey | null);
    };

    const clearDropGuide = (gesture: Gesture): void => {
      setDropTarget(null);
      if (gesture.guide) {
        gesture.guide.hidden = true;
        gesture.guide.classList.remove('is-invalid');
      }
    };

    const clearTabTarget = (gesture: Gesture): void => {
      window.clearTimeout(gesture.tabTimer);
      gesture.tabTimer = 0;
      gesture.tabCandidate = '';
      setTabHighlight('');
    };

    /** 停在页签上一段时间后切换过去，保留当前拖动。 */
    const activateDragTab = (gesture: Gesture, destination: TabKey): void => {
      if (t.gesture !== gesture || !gesture.active || gesture.tabCandidate !== destination || destination === opts().tab) {
        return;
      }
      opts().onSwitchTab(destination);
      gesture.targetMode = 'tab';
      gesture.targetDestination = destination;
      gesture.targetId = '';
      setTabHighlight(destination);
      const tab = document.querySelector(`.sidebar-tabs [data-tab="${destination}"]`);
      if (gesture.label && tab) {
        gesture.label.textContent = `${gesture.ids.size} 条 · 已进入${tabName(tab)}，松开移动或继续拖到卡片间排序`;
      }
    };

    /**
     * 记录指针停着的页签，短暂停留后切换过去（与原型 interactions.js 相同）。最后一格停 0.6 秒展开菜单，
     * 菜单中收起的页签可以作为落点；菜单里的页签只作落点，不切换列表。
     */
    const setTabTarget = (gesture: Gesture, tab: HTMLElement): void => {
      const slot = tab.classList.contains('tab-more');
      const inMenu = Boolean(tab.closest('.tab-menu'));
      const destination = slot ? 'more' : (tab.dataset.tab ?? '');
      if (gesture.tabCandidate !== destination) {
        window.clearTimeout(gesture.tabTimer);
        gesture.tabTimer = 0;
      } else if (gesture.tabTimer) {
        return;
      }
      gesture.tabCandidate = destination;
      setTabHighlight(destination);
      if (slot) {
        if (!gesture.menuOpened) {
          gesture.tabTimer = window.setTimeout(() => {
            gesture.tabTimer = 0;
            if (t.gesture !== gesture || !gesture.active) return;
            gesture.menuOpened = true;
            opts().onOpenTabMenu();
          }, TAB_MENU_DELAY);
        }
        return;
      }
      if (!inMenu && !opts().searching && destination !== opts().tab && !gesture.tabTimer) {
        gesture.tabTimer = window.setTimeout(() => {
          gesture.tabTimer = 0;
          activateDragTab(gesture, destination as TabKey);
        }, TAB_SWITCH_DELAY);
      }
    };

    /** 在列表边缘或卡片间隙选择最近的有效插入点。 */
    const updateDropTarget = (gesture: Gesture): void => {
      clearDropGuide(gesture);
      gesture.targetId = '';
      gesture.after = false;
      gesture.targetMode = '';
      gesture.targetDestination = '';
      const label = gesture.label;
      const trash = opts().trashRef.current;
      if (trash) {
        const bounds = trash.getBoundingClientRect();
        const overTrash =
          gesture.x >= bounds.left - 9 &&
          gesture.x <= bounds.right + 9 &&
          gesture.y >= bounds.top - 9 &&
          gesture.y <= bounds.bottom + 9;
        if (overTrash) {
          clearTabTarget(gesture);
          trash.classList.add('is-target');
          gesture.targetMode = 'trash';
          gesture.targetDestination = 'trash';
          if (label) label.textContent = `${gesture.ids.size} 条 · 松开后移入回收站`;
          return;
        }
        trash.classList.remove('is-target');
      }
      // 拖出侧栏：松开后在那里打开记录窗口；经过已开的窗口时由它标出合并的位置（T83）。
      gesture.outside = outsideSidebar(gesture.x);
      gesture.ghost?.classList.toggle('is-window', gesture.outside);
      if (gesture.outside) {
        clearTabTarget(gesture);
        gesture.targetMode = 'window';
        if (label) label.textContent = `${gesture.ids.size} 条 · 松开后在窗口中打开`;
        return;
      }
      const hit = document.elementFromPoint(gesture.x, gesture.y);
      const tabTarget =
        hit?.closest<HTMLElement>('.sidebar-tabs:not(.tabs-measure) [data-tab], .sidebar-tabs .tab-more:not(.is-add), .tab-menu [data-tab]') ?? null;
      if (tabTarget) {
        setTabTarget(gesture, tabTarget);
        gesture.targetMode = 'tab';
        gesture.targetDestination = tabTarget.dataset.tab ?? '';
        if (label) {
          label.textContent = !gesture.targetDestination
            ? `${gesture.ids.size} 条 · 停留后展开收起的页签`
            : gesture.targetDestination === opts().tab
              ? `${gesture.ids.size} 条 · 当前为${tabName(tabTarget)}，继续拖入列表排序`
              : tabTarget.closest('.tab-menu')
                ? `${gesture.ids.size} 条 · 松开后移到${tabName(tabTarget)}`
                : `${gesture.ids.size} 条 · 停留后可切换到${tabName(tabTarget)}`;
        }
        return;
      }
      clearTabTarget(gesture);
      // 拖动中展开的页签菜单里，页签之间的空白、分隔线与「新建页签」都不是落点；也不算在列表里，免得列表跟着滚动。
      if (hit?.closest('.tab-menu')) {
        gesture.targetMode = 'tab';
        gesture.targetDestination = '';
        if (label) label.textContent = `${gesture.ids.size} 条 · 移到收起的页签上松开`;
        return;
      }
      gesture.targetMode = 'list';
      // 搜索结果按页签分组，不能在其中排序；拖到页签上可以移过去。
      if (opts().searching) {
        gesture.targetId = '';
        setDropTarget(null);
        if (gesture.guide) gesture.guide.hidden = true;
        if (label) label.textContent = `${gesture.ids.size} 条 · 搜索结果中不能排序，可以拖到页签上`;
        return;
      }
      const list = opts().listRef.current;
      if (!list) return;
      const listBounds = list.getBoundingClientRect();
      if (gesture.x < listBounds.left - 14 || gesture.x > listBounds.right + 14) {
        if (label) label.textContent = `${gesture.ids.size} 条 · 移入记录列表后松开`;
        return;
      }
      const candidates = Array.from(list.querySelectorAll<HTMLElement>('.note-card[data-note-id]')).filter(
        (card) => !gesture.ids.has(card.dataset.noteId ?? ''),
      );
      if (!candidates.length) {
        if (label) label.textContent = `${gesture.ids.size} 条 · 当前没有可用落点`;
        return;
      }
      type Candidate = { card: HTMLElement; bounds: DOMRect; after: boolean; distance: number };
      let best: Candidate | null = null;
      const measured = candidates.map((card) => ({ card, bounds: card.getBoundingClientRect() }));
      const visible = measured.filter((item) => item.bounds.bottom > listBounds.top && item.bounds.top < listBounds.bottom);
      if (gesture.y > listBounds.bottom && visible.length) {
        const last = visible[visible.length - 1];
        best = { card: last.card, bounds: last.bounds, after: true, distance: 0 };
      } else if (gesture.y < listBounds.top && visible.length) {
        const first = visible[0];
        best = { card: first.card, bounds: first.bounds, after: false, distance: 0 };
      } else {
        for (const item of measured) {
          const { bounds } = item;
          const after = gesture.y > bounds.top + bounds.height / 2;
          const distance =
            gesture.y < bounds.top ? bounds.top - gesture.y : gesture.y > bounds.bottom ? gesture.y - bounds.bottom : 0;
          if (!best || distance < best.distance || (distance === best.distance && bounds.top < best.bounds.top)) {
            best = { card: item.card, bounds, after, distance };
          }
        }
      }
      if (!best) return;
      const note = findNote(best.card.dataset.noteId ?? '');
      if (!note) return;
      gesture.targetId = note.id;
      gesture.after = best.after;
      setDropTarget({ id: note.id, after: best.after });
      const position = best.after ? '之后' : '之前';
      if (label) label.textContent = `${gesture.ids.size} 条 · 松开后放到「${shortTitle(note)}」${position}`;
      if (gesture.guide) {
        // 插入线横跨卡片的宽度，位于两张卡片的间隙中间（Playground 的 sn-drop-line）。
        const insertionY = best.after
          ? Math.min(best.bounds.bottom, listBounds.bottom - 2)
          : Math.max(best.bounds.top, listBounds.top + 2);
        const gap = parseFloat(window.getComputedStyle(list).rowGap) || 0;
        gesture.guide.hidden = false;
        gesture.guide.classList.remove('is-invalid');
        gesture.guide.style.left = `${best.bounds.left}px`;
        gesture.guide.style.width = `${Math.max(0, best.bounds.width)}px`;
        gesture.guide.style.top = `${best.after ? insertionY + gap / 2 : insertionY - gap / 2}px`;
      }
    };

    /**
     * 拖动图片或引用时计算落点：指针下的另一张卡片中，图片附件之间或正文段落之间离指针最近的位置。
     * 折叠的卡片与没有图片或正文的卡片放到末尾。
     */
    const updateItemTarget = (gesture: Gesture): void => {
      const guide = gesture.guide;
      const label = gesture.label;
      gesture.itemTarget = '';
      setItemHighlight('');
      const hit = document.elementFromPoint(gesture.x, gesture.y);
      const list = opts().listRef.current;
      const card = hit?.closest<HTMLElement>('.note-card[data-note-id]') ?? null;
      const note = card ? findNote(card.dataset.noteId ?? '') : undefined;
      if (!card || !note || !list?.contains(card) || note.id === gesture.id || card.classList.contains('is-editing')) {
        if (guide) guide.hidden = true;
        if (label) label.textContent = note?.id === gesture.id ? '拖到另一张卡片上' : '移到另一张卡片上松开';
        return;
      }
      const title = shortTitle(note);
      const bounds = card.getBoundingClientRect();
      const content = card.querySelector<HTMLElement>(':scope > .note-content');
      const collapsed = card.classList.contains('is-collapsed') || !content;
      const area = content && !collapsed ? content.getBoundingClientRect() : null;
      let y = area ? area.bottom : bounds.bottom - 8;
      let index: number;
      let text: string;
      if (gesture.itemKind === 'image') {
        const images = collapsed ? [] : Array.from(content.querySelectorAll<HTMLElement>(':scope > .note-image-button[data-image-id]'));
        index = images.length ? images.length : note.images.length;
        text = `放到「${title}」的图片末尾`;
        for (let position = 0; position < images.length; position += 1) {
          const rect = images[position].getBoundingClientRect();
          if (gesture.y < rect.top + rect.height / 2) {
            index = position;
            y = rect.top;
            text = `放在「${title}」第 ${position + 1} 张图片之前`;
            break;
          }
          y = rect.bottom;
          if (position < images.length - 1) text = `放在「${title}」第 ${position + 1} 张图片之后`;
        }
      } else {
        const blocks = collapsed ? [] : Array.from(content.querySelectorAll<HTMLElement>(':scope > .markdown-body > [data-line-start]'));
        // 没有段落或放在最后时给一个足够大的行号，由移动逻辑接在正文末尾、标签之前。
        index = Number.MAX_SAFE_INTEGER;
        text = `放到「${title}」正文末尾`;
        for (let position = 0; position < blocks.length; position += 1) {
          const rect = blocks[position].getBoundingClientRect();
          if (gesture.y < rect.top + rect.height / 2) {
            index = Number(blocks[position].dataset.lineStart);
            y = rect.top;
            text = position === 0 ? `放到「${title}」正文开头` : `放在「${title}」第 ${position} 段之后`;
            break;
          }
          y = rect.bottom;
          if (position < blocks.length - 1) {
            index = Number(blocks[position].dataset.lineEnd);
            text = `放在「${title}」第 ${position + 1} 段之后`;
          } else {
            index = Number.MAX_SAFE_INTEGER;
          }
        }
      }
      // 正文超出卡片限高时，插入线停在可见范围之内。
      if (area) y = Math.max(area.top, Math.min(y, area.bottom));
      gesture.itemTarget = note.id;
      gesture.itemIndex = index;
      setItemHighlight(note.id);
      if (label) label.textContent = `松开后${text}`;
      if (guide && gesture.guideLabel) {
        guide.hidden = false;
        guide.classList.remove('is-invalid');
        guide.style.left = `${bounds.left + 8}px`;
        guide.style.width = `${Math.max(0, bounds.width - 16)}px`;
        guide.style.top = `${y - 10}px`;
        gesture.guideLabel.textContent = `${text}，松开移动`;
      }
    };

    /** 更新框选区域及与其相交的卡片。 */
    const updateFrame = (gesture: Gesture): void => {
      const list = opts().listRef.current;
      if (!list || !gesture.overlay) return;
      const anchorY = gesture.startY - (list.scrollTop - gesture.startScrollTop);
      const left = Math.min(gesture.startX, gesture.x);
      const top = Math.min(anchorY, gesture.y);
      const right = Math.max(gesture.startX, gesture.x);
      const bottom = Math.max(anchorY, gesture.y);
      const bounds = list.getBoundingClientRect();
      const style = gesture.overlay.style;
      style.left = `${Math.max(left, bounds.left)}px`;
      style.top = `${Math.max(top, bounds.top)}px`;
      style.width = `${Math.max(0, Math.min(right, bounds.right) - Math.max(left, bounds.left))}px`;
      style.height = `${Math.max(0, Math.min(bottom, bounds.bottom) - Math.max(top, bounds.top))}px`;
      t.selected.clear();
      gesture.base.forEach((id) => t.selected.add(id));
      list.querySelectorAll<HTMLElement>('.note-card').forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom && card.dataset.noteId) {
          t.selected.add(card.dataset.noteId);
        }
      });
      commitSelection();
    };

    /** 跟随指针更新反馈及落点。 */
    const paintGesture = (gesture: Gesture): void => {
      if (t.gesture !== gesture || !gesture.active) return;
      if (gesture.kind === 'sort') {
        // 拖影贴着抓点（原型 paintGesture）；拖出侧栏后拖影画在动画层上，这里的藏起来（窗口外画不出来）。
        const wasOutside = gesture.outside;
        if (gesture.ghost) {
          gesture.ghost.style.left = `${gesture.x - gesture.grabX}px`;
          gesture.ghost.style.top = `${gesture.y - gesture.grabY}px`;
        }
        updateDropTarget(gesture);
        if (gesture.ghost) gesture.ghost.style.visibility = gesture.outside ? 'hidden' : '';
        if (gesture.session && (gesture.outside || wasOutside)) void bridge.dragUpdate(gesture.outside);
      } else if (gesture.kind === 'item') {
        if (gesture.ghost) gesture.ghost.style.transform = `translate(${gesture.x + 12}px,${gesture.y + 12}px)`;
        updateItemTarget(gesture);
      } else {
        updateFrame(gesture);
      }
    };

    /** 指针靠近列表上下边缘时持续滚动，无需再次移动指针。 */
    const scrollDuringGesture = (): void => {
      const gesture = t.gesture;
      if (!gesture || !gesture.active) {
        t.scrollFrame = 0;
        return;
      }
      const list = opts().listRef.current;
      if (list && gesture.targetMode !== 'tab' && gesture.targetMode !== 'trash' && gesture.targetMode !== 'window') {
        const bounds = list.getBoundingClientRect();
        const margin = 38;
        let speed = 0;
        if (gesture.y < bounds.top + margin) speed = -Math.ceil((bounds.top + margin - gesture.y) / 4);
        else if (gesture.y > bounds.bottom - margin) speed = Math.ceil((gesture.y - bounds.bottom + margin) / 4);
        speed = Math.max(-22, Math.min(22, speed));
        if (speed) {
          list.scrollTop += speed;
          paintGesture(gesture);
        }
      }
      t.scrollFrame = window.requestAnimationFrame(scrollDuringGesture);
    };

    /** 长按到时后开始拖动；按住期间指针轻微漂移不算取消。 */
    const activateSort = (gesture: Gesture): void => {
      if (t.gesture !== gesture || opts().blocked) return;
      gesture.active = true;
      gesture.originTab = opts().tab;
      gesture.targetMode = 'list';
      gesture.ids =
        t.selected.has(gesture.id) && t.selected.size ? new Set(selectedIds()) : new Set([gesture.id]);
      document.body.classList.add('is-sorting-cards');
      setPendingId(null);
      setSortingId(gesture.id);
      setMemberIds(new Set(gesture.ids));
      setSorting(true);
      window.getSelection()?.removeAllRanges();

      // 拖影是卡片本身的副本：向右错开、倾斜、浮起（Playground 的 sn-drag-ghost）；拖出侧栏时保持倾斜并放大一点。
      // 副本放进带 note-list 类的外壳，卡片的样式照常生效。多选时是一叠真实的卡片：抓住的那张在最上面，
      // 后面叠着另外两张选中卡片的副本，右上角写出条数；选中的卡片不在当前列表中时，用抓住那张的副本垫在后面。
      // 说明文字只留给读屏，不放进页面（原型 activateSort）。
      const card = gesture.card as HTMLElement;
      const source = card.getBoundingClientRect();
      gesture.grabX = gesture.startX - source.left;
      gesture.grabY = gesture.startY - source.top;
      const ghost = element('div', 'card-drag-ghost note-list');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${source.width}px`;
      const list = opts().listRef.current;
      const members =
        gesture.ids.size > 1 && list
          ? Array.from(list.querySelectorAll<HTMLElement>('.note-card')).filter(
              (item) => item !== card && gesture.ids.has(item.dataset.noteId ?? ''),
            )
          : [];
      for (let layer = Math.min(2, gesture.ids.size - 1); layer > 0; layer -= 1) {
        const back = cardCopy(members[layer - 1] ?? card);
        back.classList.add('card-drag-layer');
        back.style.setProperty('--local-layer', String(layer));
        ghost.append(back);
      }
      const copy = cardCopy(card);
      copy.classList.add('is-current');
      ghost.append(copy);
      if (gesture.ids.size > 1) ghost.append(element('span', 'card-drag-count', String(gesture.ids.size)));
      gesture.ghost = ghost;
      gesture.copy = copy;
      gesture.label = element('span', '', `${gesture.ids.size} 条`);
      gesture.guide = element('div', 'card-drop-guide');
      gesture.guide.hidden = true;
      gesture.guide.append(element('span', 'card-drop-guide-line'));
      document.body.append(gesture.ghost, gesture.guide);
      // 桌面端：拖影也交给动画层，拖出侧栏后画在那里。抓点按拖影的错开量修正，窗口从拖影所在的位置展开。
      if (bridge.isDesktop()) {
        const shift = new DOMMatrixReadOnly(window.getComputedStyle(ghost).transform).e;
        gesture.session = true;
        void bridge.dragBegin({
          kind: 'cards',
          ids: Array.from(gesture.ids),
          html: ghost.outerHTML,
          ghost: { x: 0, y: 0, width: source.width, height: copy.offsetHeight || source.height },
          grab: [gesture.grabX - (Number.isFinite(shift) ? shift : 0), gesture.grabY],
        });
      }
      try {
        if (gesture.card && gesture.pointerId !== undefined) gesture.card.setPointerCapture(gesture.pointerId);
      } catch {
        // 指针已失效时由 pointercancel 清理。
      }
      paintGesture(gesture);
      t.scrollFrame = window.requestAnimationFrame(scrollDuringGesture);
    };

    /** 长按或移动超过 6 像素后开始拖动图片或引用。 */
    const activateItem = (gesture: Gesture): void => {
      if (t.gesture !== gesture || opts().blocked || gesture.active) return;
      window.clearTimeout(gesture.timer);
      gesture.active = true;
      setPendingId(null);
      window.getSelection()?.removeAllRanges();
      const item = gesture.item;
      const name =
        gesture.itemKind === 'image'
          ? (item?.querySelector('img')?.getAttribute('alt') ?? '') || '图片'
          : (item?.textContent ?? '').trim() || item?.querySelector('img')?.getAttribute('alt') || '图片';
      gesture.ghost = element('div', 'card-drag-ghost batch-drag-ghost item-drag-ghost');
      gesture.ghost.setAttribute('aria-hidden', 'true');
      const icon = gesture.itemKind === 'image' || item?.querySelector('img') ? '🖼' : '📄';
      gesture.label = element('span', '', '拖到另一张卡片上');
      gesture.ghost.append(element('strong', '', `${icon} ${name.slice(0, 40)}`), gesture.label);
      gesture.guide = element('div', 'card-drop-guide');
      gesture.guide.hidden = true;
      gesture.guideLabel = element('span', 'card-drop-guide-label', '');
      gesture.guide.append(element('span', 'card-drop-guide-line'), gesture.guideLabel);
      document.body.append(gesture.ghost, gesture.guide);
      document.body.classList.add('is-dragging-item');
      item?.classList.add('is-drag-source');
      try {
        if (item && gesture.pointerId !== undefined) item.setPointerCapture(gesture.pointerId);
      } catch {
        // 指针已失效时由 pointercancel 清理。
      }
      paintGesture(gesture);
      t.scrollFrame = window.requestAnimationFrame(scrollDuringGesture);
    };

    /** 在空白处拖动超过 4 像素后开始框选。 */
    const activateFrame = (gesture: Gesture): void => {
      gesture.active = true;
      gesture.overlay = element('div', 'card-selection-rectangle');
      gesture.overlay.setAttribute('aria-hidden', 'true');
      document.body.append(gesture.overlay);
      document.body.classList.add('is-framing-cards');
      paintGesture(gesture);
      t.scrollFrame = window.requestAnimationFrame(scrollDuringGesture);
    };

    /** 清理按压计时、指针捕获和所有拖动反馈。 */
    const cancelGesture = (): boolean => {
      const gesture = t.gesture;
      if (!gesture) return false;
      window.clearTimeout(gesture.timer);
      clearTabTarget(gesture);
      // 停在最后一格上展开过页签菜单：松开、Esc 或指针取消都在这里收起（菜单在拖动期间不因滚动与指针事件关闭）。
      if (gesture.menuOpened) opts().onCloseTabMenu();
      if (t.frame) window.cancelAnimationFrame(t.frame);
      if (t.scrollFrame) window.cancelAnimationFrame(t.scrollFrame);
      t.frame = 0;
      t.scrollFrame = 0;
      if (gesture.active) {
        t.blockClick = true;
        t.lastDragAt = now();
      }
      try {
        const captured = gesture.kind === 'item' ? gesture.item : gesture.card;
        if (captured && gesture.pointerId !== undefined && captured.hasPointerCapture(gesture.pointerId)) {
          captured.releasePointerCapture(gesture.pointerId);
        }
      } catch {
        // 系统可能已经释放指针捕获。
      }
      // 没有在记录窗口中打开的拖动（取消、放回列表、移到页签或回收站）：通知后端收起动画层上的拖影。
      if (gesture.session) {
        gesture.session = false;
        void bridge.dragEnd(false, false);
      }
      gesture.ghost?.remove();
      gesture.guide?.remove();
      gesture.overlay?.remove();
      gesture.item?.classList.remove('is-drag-source');
      setItemHighlight('');
      opts().trashRef.current?.classList.remove('is-target');
      document.body.classList.remove('is-sorting-cards', 'is-framing-cards', 'is-dragging-item');
      setDropTarget(null);
      setPendingId(null);
      setSortingId(null);
      setMemberIds(new Set());
      setSorting(false);
      t.gesture = null;
      setBusy(false);
      return true;
    };

    /** 按下：卡片上开始长按计时，空白处准备框选。 */
    const press = (event: PointerEvent | MouseEvent): void => {
      if (event.type === 'pointerdown') t.lastPointerAt = now();
      else if (now() - t.lastPointerAt < 700) return;
      if (!t.gesture) t.blockClick = false;
      if (event.button !== 0 || t.gesture || opts().blocked) return;
      const target = targetOf(event);
      const list = opts().listRef.current;
      if (!target || !list || !list.contains(target)) return;
      // 卡片中的图片附件与文件引用：按住移动可拖到另一张卡片，单击仍是放大或打开。
      const item = target.closest<HTMLElement>('[data-drag-item]');
      const itemCard = item?.closest<HTMLElement>('.note-card[data-note-id]') ?? null;
      const draggable = Boolean(item && itemCard && list.contains(itemCard) && !itemCard.classList.contains('is-editing'));
      if (!draggable && target.closest(`${INTERACTIVE},.sidebar-composer`)) return;
      // 按在列表滚动条上时交给系统滚动。
      const listBounds = list.getBoundingClientRect();
      if (event.clientX >= listBounds.left + list.clientLeft + list.clientWidth) return;
      const found = draggable ? itemCard : target.closest<HTMLElement>('.note-card');
      // 按住 Ctrl 拖动（T111，试验）：在卡片上按下也是框选，不长按拖动；不移动时仍是 Ctrl+单击多选。
      // 卡片排得紧凑，卡片之间的缝很难按中。编辑中的卡片按在编辑区里（上面已经返回），照常选文字。
      const frameOnCard = Boolean(found && !draggable && (event.ctrlKey || event.metaKey));
      const card = frameOnCard ? null : found;
      const pointer = event as PointerEvent;
      const gesture: Gesture = {
        kind: draggable ? 'item' : card ? 'sort' : 'frame',
        eventKind: event.type === 'pointerdown' ? 'pointer' : 'mouse',
        pointerId: event.type === 'pointerdown' ? pointer.pointerId : undefined,
        pointerType: (event.type === 'pointerdown' && pointer.pointerType) || 'mouse',
        startX: event.clientX,
        startY: event.clientY,
        startScrollTop: list.scrollTop,
        x: event.clientX,
        y: event.clientY,
        active: false,
        card,
        id: card?.dataset.noteId ?? '',
        base: new Set(event.ctrlKey || event.metaKey || event.shiftKey ? t.selected : []),
        timer: 0,
        ids: new Set(),
        originTab: opts().tab,
        targetMode: '',
        targetDestination: '',
        targetId: '',
        after: false,
        tabCandidate: '',
        tabTimer: 0,
        menuOpened: false,
        ghost: null,
        copy: null,
        grabX: 0,
        grabY: 0,
        outside: false,
        session: false,
        label: null,
        guide: null,
        guideLabel: null,
        overlay: null,
        item: draggable ? item : null,
        itemKind: item?.dataset.dragItem === 'image' ? 'image' : 'text',
        itemTarget: '',
        itemIndex: 0,
      };
      t.gesture = gesture;
      setBusy(true);
      if (gesture.kind === 'item') {
        // 按住不动 300 毫秒或移动超过 6 像素开始拖动；不阻止默认行为，单击仍能放大或打开。
        gesture.timer = window.setTimeout(() => activateItem(gesture), HOLD_DELAY);
        if (gesture.pointerType === 'mouse') event.preventDefault();
      } else if (card) {
        setPendingId(gesture.id);
        gesture.timer = window.setTimeout(() => activateSort(gesture), HOLD_DELAY);
        // 鼠标按住卡片时不开始选中文字；触摸保留默认行为以便滚动。
        if (gesture.pointerType === 'mouse') event.preventDefault();
      } else {
        event.preventDefault();
      }
    };

    /** 只处理与起点同一输入通道的事件。 */
    const samePointer = (event: PointerEvent | MouseEvent): boolean => {
      const gesture = t.gesture;
      if (!gesture) return false;
      if (gesture.eventKind === 'pointer') {
        return event.type.startsWith('pointer') && (event as PointerEvent).pointerId === gesture.pointerId;
      }
      return event.type.startsWith('mouse');
    };

    /** 移动：长按开始前鼠标移动不会中断计时，框选移动 4 像素后开始。 */
    const move = (event: PointerEvent | MouseEvent): void => {
      if (!samePointer(event)) return;
      const gesture = t.gesture as Gesture;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      const distance = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);
      if (!gesture.active) {
        if (gesture.kind === 'frame' && distance >= 4) activateFrame(gesture);
        else if (gesture.kind === 'item' && distance >= 6) activateItem(gesture);
        else if (gesture.pointerType === 'touch' && distance > 30) {
          cancelGesture();
          return;
        } else return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!t.frame) {
        t.frame = window.requestAnimationFrame(() => {
          t.frame = 0;
          paintGesture(gesture);
        });
      }
    };

    /** 松开：一次性保存排序或移动，不触发编辑。 */
    const release = (event: PointerEvent | MouseEvent): void => {
      if (!samePointer(event)) return;
      const gesture = t.gesture as Gesture;
      if (gesture.active) {
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        paintGesture(gesture);
        consume(event);
      }
      const { active, kind, targetId, after, ids, targetMode, targetDestination, originTab } = gesture;
      // 拖出侧栏松开：后端在松开处新开记录窗口（拖出的窗口默认置顶），落在已开的窗口上时并进它的标签页。
      if (active && kind === 'sort' && targetMode === 'window' && gesture.session) {
        gesture.session = false;
        void bridge.dragEnd(true, true).then((result) => {
          if (result.target || result.opened) clearSelection();
        });
      }
      const itemDrop: ItemDrop | null =
        kind === 'item' && gesture.itemTarget
          ? {
              sourceId: gesture.id,
              targetId: gesture.itemTarget,
              kind: gesture.itemKind,
              imageId: gesture.item?.dataset.imageId,
              start: Number(gesture.item?.dataset.srcStart),
              end: Number(gesture.item?.dataset.srcEnd),
              index: gesture.itemIndex,
            }
          : null;
      cancelGesture();
      if (active && itemDrop) opts().onMoveItem(itemDrop);
      if (!active || kind !== 'sort') return;
      const moveTo = (destination: TabKey | 'trash'): void => {
        void opts()
          .onMove(Array.from(ids), destination, originTab)
          .then((saved) => {
            if (saved) clearSelection();
          });
      };
      if (targetMode === 'trash') moveTo('trash');
      else if (targetMode === 'tab' && targetDestination && targetDestination !== originTab) moveTo(targetDestination as TabKey);
      else if (targetMode === 'list' && targetId) opts().onReorder(ids, targetId, after, originTab);
    };

    /** 捕获多选点击，以及拖动之后浏览器补发的点击。 */
    const captureClick = (event: MouseEvent): void => {
      const target = targetOf(event);
      if (!target) return;
      if (t.blockClick) {
        t.blockClick = false;
        if (event.detail !== 0 && now() - t.lastDragAt < CLICK_GUARD) {
          consume(event);
          return;
        }
      }
      const list = opts().listRef.current;
      const interactive = target.closest(`${INTERACTIVE},.modal,.capture,.tag-dropdown`);
      const card = target.closest<HTMLElement>('.note-card');
      const outside = !card || !list?.contains(card) || card.classList.contains('is-editing');
      if (outside) {
        if (hasSelection() && !interactive) {
          consume(event);
          clearSelection();
        }
        return;
      }
      const id = card?.dataset.noteId;
      if (!id) return;
      const modifier = event.ctrlKey || event.metaKey;
      // 多选按钮按下时：单击卡片的任何地方都是勾选或取消，卡片上的按钮、链接、待办与标签不再响应。
      if (t.mode) {
        consume(event);
        choose(id, event.shiftKey, true);
        return;
      }
      if ((modifier || event.shiftKey) && !interactive) {
        consume(event);
        choose(id, event.shiftKey, modifier);
        return;
      }
      // 不按键单击卡片：只选中（高亮）这一张，Ctrl 或 Shift 选中的其它卡片取消；它记作起点。
      if (!interactive) {
        if (t.selected.size) clearSelection();
        t.anchor = id;
      }
    };

    /** 多选和拖动之后不再触发双击编辑。 */
    const captureDoubleClick = (event: MouseEvent): void => {
      const target = targetOf(event);
      if (target?.closest('.note-card') && (hasSelection() || now() - t.lastDragAt < CLICK_GUARD)) consume(event);
    };

    /** 多选模式下 Ctrl+A 全选当前列表；拖动途中按 Esc 取消拖动。 */
    const keyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && t.gesture?.active) {
        consume(event);
        cancelGesture();
        return;
      }
      const target = targetOf(event);
      if (
        hasSelection() &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'a' &&
        !target?.closest('input,textarea,[contenteditable="true"]')
      ) {
        consume(event);
        visibleIds().forEach((id) => t.selected.add(id));
        commitSelection();
      }
    };

    const keepDragPriority = (event: Event): void => {
      if (t.gesture?.active) consume(event);
    };
    const noSelection = (event: Event): void => {
      if (t.gesture?.kind === 'sort') event.preventDefault();
    };
    const pointerCancel = (): void => {
      cancelGesture();
    };

    document.addEventListener('pointerdown', press, true);
    document.addEventListener('mousedown', press, true);
    document.addEventListener('pointermove', move, { capture: true, passive: false });
    document.addEventListener('mousemove', move, { capture: true, passive: false });
    document.addEventListener('pointerup', release, true);
    document.addEventListener('mouseup', release, true);
    document.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('blur', pointerCancel);
    document.addEventListener('click', captureClick, true);
    document.addEventListener('dblclick', captureDoubleClick, true);
    document.addEventListener('contextmenu', keepDragPriority, true);
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('selectstart', noSelection, true);
    return () => {
      cancelGesture();
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('mousedown', press, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('mouseup', release, true);
      document.removeEventListener('pointercancel', pointerCancel, true);
      window.removeEventListener('blur', pointerCancel);
      document.removeEventListener('click', captureClick, true);
      document.removeEventListener('dblclick', captureDoubleClick, true);
      document.removeEventListener('contextmenu', keepDragPriority, true);
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('selectstart', noSelection, true);
    };
  }, [clearSelection, commitSelection]);

  return {
    selected,
    pendingId,
    sortingId,
    memberIds,
    drop,
    dragTab,
    sorting,
    busy,
    hasSelection: mode || selected.size > 0,
    selecting: mode,
    itemTargetId,
    isBusy,
    isSelecting,
    clearSelection,
    selectAll,
    toggleMode,
  };
}
