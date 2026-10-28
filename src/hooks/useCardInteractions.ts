/**
 * 卡片长按排序与多选，移植自原型 interactions.js。
 *
 * 手势在 document 捕获阶段处理，优先于卡片自身的单击编辑与双击复制：
 * - 在卡片上按住 300 毫秒后开始拖动：可在卡片之间排序；停在页签上会切换过去，
 *   松开即移到该页签；拖到右下角的回收站则移入回收站。松开后一次性保存并提供撤销。
 * - 在列表空白处拖动框选；Ctrl/⌘ 单击切换选择，Shift 单击连续选择；
 *   有选择时单击卡片切换选择，单击别处清除选择，Ctrl+A 全选当前列表。
 *
 * 跟随指针的卡片、插入线与框选矩形是挂在 body 上的临时元素；卡片与页签的状态类
 * 经 React 状态下发，避免与 React 渲染互相覆盖。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Note, TabKey } from '../core/types';

/** 长按多久开始拖动。 */
const HOLD_DELAY = 300;
/** 拖动时停在页签上多久切换过去。 */
const TAB_SWITCH_DELAY = 240;
/** 拖动结束后多久之内的点击视为拖动产生的合成点击。 */
const CLICK_GUARD = 650;
/** 不参与手势、保留自身行为的控件。 */
const INTERACTIVE = 'button,a,input,textarea,select,[contenteditable="true"]';

/** 拖动的放置位置：插入到目标记录之前或之后。 */
export interface DropTarget {
  id: string;
  after: boolean;
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
  /** 拖动中停在页签上时切换页签。 */
  onSwitchTab: (tab: TabKey) => void;
  /** 移到页签或回收站，返回是否保存成功。 */
  onMove: (ids: string[], destination: TabKey | 'trash') => Promise<boolean>;
  /** 插入到目标记录之前或之后。 */
  onReorder: (ids: Set<string>, targetId: string, after: boolean) => void;
  /** 取消尚未生效的单击编辑，对应原型 invalidateCardClick。 */
  onInvalidateClick: () => void;
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
  /** 供事件处理函数同步读取最新状态。 */
  isBusy: () => boolean;
  isSelecting: () => boolean;
  clearSelection: () => void;
}

/** 一次按压或拖动手势。 */
interface Gesture {
  kind: 'sort' | 'frame';
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
  targetMode: '' | 'list' | 'tab' | 'trash';
  targetDestination: string;
  targetId: string;
  after: boolean;
  tabCandidate: string;
  tabTimer: number;
  ghost: HTMLElement | null;
  label: HTMLElement | null;
  guide: HTMLElement | null;
  guideLabel: HTMLElement | null;
  overlay: HTMLElement | null;
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

    /** 阻止本次事件继续触发卡片编辑。 */
    const consume = (event: Event): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
      opts().onInvalidateClick();
    };

    /** 单击选择：Shift 选择连续区间，否则切换单张卡片。 */
    const choose = (id: string, range: boolean, additive: boolean): void => {
      const ids = visibleIds();
      if (range && t.anchor && ids.includes(t.anchor)) {
        const start = ids.indexOf(t.anchor);
        const end = ids.indexOf(id);
        if (!additive) t.selected.clear();
        ids.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => t.selected.add(item));
      } else {
        if (t.selected.has(id)) t.selected.delete(id);
        else t.selected.add(id);
        t.anchor = id;
      }
      t.mode = true;
      commitSelection();
    };

    const setDropTarget = (value: DropTarget | null): void => {
      const key = value ? `${value.id}:${value.after}` : '';
      if (key === t.drop) return;
      t.drop = key;
      setDrop(value);
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

    const setTabTarget = (gesture: Gesture, tab: HTMLElement): void => {
      const destination = tab.dataset.tab ?? '';
      if (gesture.tabCandidate !== destination) {
        window.clearTimeout(gesture.tabTimer);
        gesture.tabTimer = 0;
      }
      gesture.tabCandidate = destination;
      setTabHighlight(destination);
      if (destination !== opts().tab && !gesture.tabTimer) {
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
      const hit = document.elementFromPoint(gesture.x, gesture.y);
      const tabTarget = hit?.closest<HTMLElement>('.sidebar-tabs [data-tab]') ?? null;
      if (tabTarget) {
        setTabTarget(gesture, tabTarget);
        gesture.targetMode = 'tab';
        gesture.targetDestination = tabTarget.dataset.tab ?? '';
        if (label) {
          label.textContent =
            gesture.targetDestination === opts().tab
              ? `${gesture.ids.size} 条 · 当前为${tabName(tabTarget)}，继续拖入列表排序`
              : `${gesture.ids.size} 条 · 停留后可切换到${tabName(tabTarget)}`;
        }
        return;
      }
      clearTabTarget(gesture);
      gesture.targetMode = 'list';
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
        if (gesture.guide && gesture.guideLabel) {
          gesture.guide.hidden = false;
          gesture.guide.classList.add('is-invalid');
          gesture.guide.style.left = `${listBounds.left + 5}px`;
          gesture.guide.style.width = `${Math.max(0, listBounds.width - 10)}px`;
          gesture.guide.style.top = `${Math.max(listBounds.top + 8, Math.min(gesture.y - 10, listBounds.bottom - 26))}px`;
          gesture.guideLabel.textContent = '此处不能放置';
        }
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
      const group = note.status === 'archived' ? '归档' : note.pinned ? '置顶' : '普通';
      const position = best.after ? '之后' : '之前';
      if (label) label.textContent = `${gesture.ids.size} 条 · 松开后放到「${shortTitle(note)}」${position}`;
      if (gesture.guide && gesture.guideLabel) {
        const insertionY = best.after
          ? Math.min(best.bounds.bottom, listBounds.bottom - 2)
          : Math.max(best.bounds.top, listBounds.top + 2);
        gesture.guide.hidden = false;
        gesture.guide.classList.remove('is-invalid');
        gesture.guide.style.left = `${Math.max(4, listBounds.left + 5)}px`;
        gesture.guide.style.width = `${Math.max(0, listBounds.width - 10)}px`;
        gesture.guide.style.top = `${Math.max(4, insertionY - 10)}px`;
        gesture.guideLabel.textContent = `${group} · 放在「${shortTitle(note)}」${position}，松开保存`;
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
      t.mode = true;
      commitSelection();
    };

    /** 跟随指针更新反馈及落点。 */
    const paintGesture = (gesture: Gesture): void => {
      if (t.gesture !== gesture || !gesture.active) return;
      if (gesture.kind === 'sort') {
        if (gesture.ghost) gesture.ghost.style.transform = `translate(${gesture.x + 12}px,${gesture.y + 12}px)`;
        updateDropTarget(gesture);
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
      if (list && gesture.targetMode !== 'tab' && gesture.targetMode !== 'trash') {
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
      opts().onInvalidateClick();
      gesture.ids =
        t.selected.has(gesture.id) && t.selected.size ? new Set(selectedIds()) : new Set([gesture.id]);
      document.body.classList.add('is-sorting-cards');
      setPendingId(null);
      setSortingId(gesture.id);
      setMemberIds(new Set(gesture.ids));
      setSorting(true);
      window.getSelection()?.removeAllRanges();

      const note = findNote(gesture.id);
      gesture.ghost = element('div', 'card-drag-ghost batch-drag-ghost');
      gesture.ghost.setAttribute('aria-hidden', 'true');
      const heading = element('strong', '', `${note?.emoji || '📝'} ${(firstLine(note) || '图片记录').slice(0, 44)}`);
      gesture.label = element('span', '', `${gesture.ids.size} 条 · 拖到 Tab 切换页面，或拖到红色回收站`);
      gesture.ghost.append(heading, gesture.label);
      gesture.guide = element('div', 'card-drop-guide');
      gesture.guide.hidden = true;
      gesture.guideLabel = element('span', 'card-drop-guide-label', '松开后放在这里');
      gesture.guide.append(element('span', 'card-drop-guide-line'), gesture.guideLabel);
      document.body.append(gesture.ghost, gesture.guide);
      try {
        if (gesture.card && gesture.pointerId !== undefined) gesture.card.setPointerCapture(gesture.pointerId);
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
      if (t.frame) window.cancelAnimationFrame(t.frame);
      if (t.scrollFrame) window.cancelAnimationFrame(t.scrollFrame);
      t.frame = 0;
      t.scrollFrame = 0;
      if (gesture.active) {
        t.blockClick = true;
        t.lastDragAt = now();
        opts().onInvalidateClick();
      }
      try {
        if (gesture.card && gesture.pointerId !== undefined && gesture.card.hasPointerCapture(gesture.pointerId)) {
          gesture.card.releasePointerCapture(gesture.pointerId);
        }
      } catch {
        // 系统可能已经释放指针捕获。
      }
      gesture.ghost?.remove();
      gesture.guide?.remove();
      gesture.overlay?.remove();
      opts().trashRef.current?.classList.remove('is-target');
      document.body.classList.remove('is-sorting-cards', 'is-framing-cards');
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
      if (!target || !list || !list.contains(target) || target.closest(`${INTERACTIVE},.sidebar-composer`)) return;
      // 按在列表滚动条上时交给系统滚动。
      const listBounds = list.getBoundingClientRect();
      if (event.clientX >= listBounds.left + list.clientLeft + list.clientWidth) return;
      const card = target.closest<HTMLElement>('.note-card');
      opts().onInvalidateClick();
      const pointer = event as PointerEvent;
      const gesture: Gesture = {
        kind: card ? 'sort' : 'frame',
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
        ghost: null,
        label: null,
        guide: null,
        guideLabel: null,
        overlay: null,
      };
      t.gesture = gesture;
      setBusy(true);
      if (card) {
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
      cancelGesture();
      if (!active || kind !== 'sort') return;
      const moveTo = (destination: TabKey | 'trash'): void => {
        void opts()
          .onMove(Array.from(ids), destination)
          .then((saved) => {
            if (saved) clearSelection();
          });
      };
      if (targetMode === 'trash') moveTo('trash');
      else if (targetMode === 'tab' && targetDestination && targetDestination !== originTab) moveTo(targetDestination as TabKey);
      else if (targetMode === 'list' && targetId) opts().onReorder(ids, targetId, after);
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
      if ((hasSelection() || event.ctrlKey || event.metaKey || event.shiftKey) && !interactive && card?.dataset.noteId) {
        consume(event);
        choose(card.dataset.noteId, event.shiftKey, event.ctrlKey || event.metaKey);
      }
    };

    /** 多选和拖动之后不再触发双击复制。 */
    const captureDoubleClick = (event: MouseEvent): void => {
      const target = targetOf(event);
      if (target?.closest('.note-card') && (hasSelection() || now() - t.lastDragAt < CLICK_GUARD)) consume(event);
    };

    /** 多选模式下 Ctrl+A 全选当前列表。 */
    const keyboard = (event: KeyboardEvent): void => {
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
    isBusy,
    isSelecting,
    clearSelection,
  };
}
