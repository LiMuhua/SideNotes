/**
 * 记录窗口（T83，交互原型 note-window.js；技术决策第 41 条）。
 *
 * 卡片拖出侧栏或点「展开全文」时打开。桌面端每个记录窗口是一个独立的 Tauri 窗口，页面只画这一个窗口，
 * 结构与类名与原型相同（theme.css 的 .note-window），窗口铺满整个 Tauri 窗口：
 * - 标题栏拖动窗口（按住指针，每一步交给后端移动窗口），双击放大或还原；四边与四角用系统的缩放手势。
 * - 一个窗口可以有多个标签页：卡片、别的窗口的标题栏或标签页拖到这里时合并（后端找出落点所在的窗口，
 *   通知它标出插入线并在松开时交过来）；标签页拖到窗口外拆成新窗口。标签页在顶部或左侧，窗口上的按钮与设置中的同一项。
 * - 双击正文编辑，保存快捷键或点到窗口外保存，Esc 取消；不在编辑时 Esc 关闭当前标签页，只剩一个时关闭窗口；
 *   Shift+Esc、Ctrl+Shift+W 与 Alt+F4 关闭窗口，Ctrl+W 关闭当前页；「关闭全部记录窗口」关闭所有窗口。
 * - 打开与关闭的形变动画画在动画层上（Overlay.tsx），这里只给出窗口的副本；轻轻放大一下（已经开着、收下标签页）在窗口里画。
 * 记录变化由跨窗口同步带来（每个窗口有自己的状态仓库），记录被删除或移入回收站时关掉它的标签页。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon, IconSprite } from './Icon';
import { LiveEditor } from './LiveEditor';
import { Markdown } from './Markdown';
import { useStoreSlice } from '../hooks/useStore';
import { useToast } from '../hooks/useToast';
import * as bridge from '../core/bridge';
import * as store from '../core/store';
import { openAttachment } from '../core/attachments';
import { noteDisplay, sourceOffset } from '../core/display';
import { noteTitle } from '../core/notes';
import { matches } from '../core/shortcuts';
import { bodyEnd, canonicalize, parse } from '../core/tags';
import type { MarkdownEditor } from '../core/editor';
import type { Note } from '../core/types';

/** 按内容定宽的上下限（页面像素，原型 FIT_WIDTH）。 */
const FIT_WIDTH: [number, number] = [280, 560];
/** 顶部有标签页时按标签页定宽的上限（原型 FIT_TABS_WIDTH）。 */
const FIT_TABS_WIDTH = 720;
/**
 * 按内容定高的上限，同时不超过工作区的七成（原型 FIT_HEIGHT 是 600 与六成；2026-11-18 用户要求加高）。
 * 下限也比原型的 140 高：一两行的短记录也有个像样的窗口，下面留出空白。
 */
const FIT_HEIGHT = 720;
const FIT_AREA = 0.7;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
/** 量出的高度再加一点余量：图片与字体的取整误差会让内容比窗口高一两个像素，出现滚动条。 */
const FIT_SLACK = 4;
/** 全文浮窗失去焦点后等这么久（毫秒）再收回：隐藏的备用窗口加载时会短暂抢走焦点，后端随即还回来。 */
const PEEK_BLUR_DELAY = 200;
/** 量高度时比窗口窄这么多（页面像素）：内容区换算成物理像素后可能窄一两个像素，见 fitSize。 */
const FIT_WRAP_SLACK = 2;
/** 量尺寸前最多等图片加载这么久（毫秒）：窗口这时还没显示，等一会儿看不出来。 */
const IMAGE_WAIT = 800;
const MARGIN = 12;
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const EVENTS = bridge.NOTE_WINDOW_EVENTS;

/** 窗口里的编辑：正在编辑的记录、当前文字与进入编辑时的原文。 */
interface WindowEdit {
  id: string;
  text: string;
  original: string;
}

/** 标题栏或标签页的拖动手势。 */
interface Gesture {
  mode: 'move' | 'tab';
  pointerId: number;
  startX: number;
  startY: number;
  target: HTMLElement;
  tab: string;
  active: boolean;
  /** 指针下可以合并的窗口（后端给出）。 */
  merge: string | null;
  ghost: HTMLElement | null;
  grab: { x: number; y: number };
  frame: number;
  x: number;
  y: number;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 读取令牌中的时长（毫秒）。 */
function duration(name: string): number {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return 0;
  return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
}

function easing(name: string): string {
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** CSS 颜色换成 #rrggbb（color-mix 的结果是 color(srgb …)）。 */
function hexColor(css: string): string | null {
  const probe = document.createElement('span');
  probe.style.color = css;
  probe.style.display = 'none';
  document.body.append(probe);
  const computed = window.getComputedStyle(probe).color;
  probe.remove();
  let channels: number[] | null = null;
  const srgb = computed.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
  const rgb = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (srgb) channels = srgb.slice(1, 4).map((value) => Math.round(parseFloat(value) * 255));
  else if (rgb) channels = rgb.slice(1, 4).map(Number);
  if (!channels) return null;
  return `#${channels.map((value) => clamp(value, 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 问侧栏这条记录的卡片在屏幕上的位置（物理像素）；侧栏收起或卡片不在视野里时为 null。 */
function requestCardRect(id: string): Promise<bridge.PixelRect | null> {
  return new Promise((resolve) => {
    let settled = false;
    let dispose: (() => void) | null = null;
    const finish = (rect: bridge.PixelRect | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      dispose?.();
      resolve(rect);
    };
    const timer = window.setTimeout(() => finish(null), 250);
    void bridge
      .onWindowEvent<{ id: string; rect: bridge.PixelRect | null }>(EVENTS.cardRect, (payload) => {
        if (payload.id === id) finish(payload.rect);
      })
      .then((unlisten) => {
        dispose = unlisten;
        if (settled) unlisten();
        else void bridge.emitToWindow('main', EVENTS.cardRectRequest, { id, reply: bridge.currentLabel() });
      });
  });
}

/** 记录窗口。 */
export function NoteWindow() {
  const notes = useStoreSlice((state) => state.notes);
  const settings = useStoreSlice((state) => state.settings);
  const toast = useToast();

  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [pinned, setPinned] = useState(false);
  /** 附着在卡片旁的全文浮窗（T100）：点到别处收回，不显示置顶按钮；拖动标题栏后成为独立窗口。 */
  const [attached, setAttached] = useState(false);
  const [editing, setEditing] = useState<WindowEdit | null>(null);
  const [front, setFront] = useState(() => document.hasFocus());
  const [merge, setMerge] = useState(false);
  const [moving, setMoving] = useState(false);
  const [dragTab, setDragTab] = useState('');
  const [opening, setOpening] = useState<bridge.NoteWindowOpen | null>(null);

  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const editingRef = useRef<WindowEdit | null>(null);
  const tabsRef = useRef<string[]>([]);
  const activeRef = useRef('');
  const pinnedRef = useRef(false);
  const attachedRef = useRef(false);
  const originRef = useRef<'drag' | 'expand'>('drag');
  const closingRef = useRef(false);
  const shownRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  const dropRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTimer = useRef(0);
  const sideWidth = useRef(0);
  const scrollKeep = useRef<{ id: string; top: number }>({ id: '', top: 0 });
  const blurTimer = useRef(0);
  /** 窗口所在屏幕的工作区（物理像素，打开时给出），重新定大小时按它限制上限。 */
  const areaRef = useRef<bridge.PixelRect | null>(null);
  /** 手动拖过边框或放大过：之后不再按内容自动改大小（T110）。 */
  const manualSize = useRef(false);
  /** 上一次按内容定大小时的当前页、标签页与标签栏位置，变了才重新定（见下方 fitKey）。 */
  const fittedKey = useRef('');
  const fitKeyRef = useRef('');

  useLayoutEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = active;
    pinnedRef.current = pinned;
  });

  const noteOf = useCallback((id: string): Note | undefined => store.getState().notes.find((note) => note.id === id), []);
  const many = tabs.length > 1;
  const side = settings.windowTabs === 'side' && many;
  const note = notes.find((item) => item.id === active);
  const windowTitle = note ? noteTitle(note) : '';
  const fitKey = `${active}|${tabs.join(',')}|${side ? 'side' : 'top'}`;
  fitKeyRef.current = fitKey;

  // 记录窗口有自己的任务栏按钮，按钮与 Alt+Tab 里写当前标签页的标题。
  useEffect(() => {
    void bridge.setWindowTitle(windowTitle ? `${windowTitle} - SideNotes` : 'SideNotes 记录');
  }, [windowTitle]);

  /* ==================== 与后端同步 ==================== */

  /** 标签页、当前页、置顶与标题栏的位置同步给后端（合并时按标题栏判断落点）。 */
  const sync = useCallback(() => {
    if (!shownRef.current || closingRef.current) return;
    const bands: bridge.PixelRect[] = [];
    if (headerRef.current) bands.push(bridge.rectOf(headerRef.current.getBoundingClientRect()));
    if (stripRef.current && sectionRef.current?.classList.contains('is-side-tabs')) {
      bands.push(bridge.rectOf(stripRef.current.getBoundingClientRect()));
    }
    void bridge.syncNoteWindow({ tabs: tabsRef.current, active: activeRef.current, pinned: pinnedRef.current, bands });
  }, []);

  useEffect(() => {
    sync();
  }, [tabs, active, pinned, side, sync]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(section);
    return () => observer.disconnect();
  }, [sync]);

  /* ==================== 动画 ==================== */

  /** 轻轻放大一下，表示窗口已经开着或刚收下了标签页。 */
  const pulse = useCallback(() => {
    const node = sectionRef.current;
    if (!node || reducedMotion() || typeof node.animate !== 'function') return;
    node.animate([{ transform: 'none' }, { transform: 'scale(1.015)' }, { transform: 'none' }], {
      duration: duration('--sn-duration-normal'),
      easing: easing('--sn-ease-standard'),
    });
  }, []);

  /* ==================== 编辑 ==================== */

  /** 结束窗口中的编辑：保存时内容没变不写库，清空正文时恢复原文（与卡片编辑一致）。 */
  const finishEditing = useCallback(
    async (commit: boolean): Promise<boolean> => {
      const current = editingRef.current;
      if (!current) return true;
      if (commit && current.text.trim() && current.text !== current.original) {
        const saved = await store.updateNote(current.id, { text: canonicalize(current.text) });
        if (!saved) {
          toast('保存失败，修改仍在编辑中', null, true);
          return false;
        }
      }
      editingRef.current = null;
      editorRef.current = null;
      setEditing(null);
      if (!closingRef.current) sectionRef.current?.focus({ preventScroll: true });
      return true;
    },
    [toast],
  );

  const beginEditing = useCallback(() => {
    const target = noteOf(activeRef.current);
    if (!target || editingRef.current) return;
    const next = { id: target.id, text: target.text, original: target.text };
    editingRef.current = next;
    setEditing(next);
  }, [noteOf]);

  /* ==================== 标签页 ==================== */

  /** 切换到一个标签页；正在编辑的先保存。 */
  const activate = useCallback(
    async (id: string): Promise<boolean> => {
      if (!tabsRef.current.includes(id)) return false;
      if (activeRef.current === id) return true;
      if (editingRef.current && !(await finishEditing(true))) return false;
      activeRef.current = id;
      setActive(id);
      return true;
    },
    [finishEditing],
  );

  /** 关闭整个窗口：先结束编辑（保存），再按打开的方式缩回卡片或原地淡出（动画层上播放）。 */
  const closeWindow = useCallback(async () => {
    if (closingRef.current) return;
    if (editingRef.current && !(await finishEditing(true))) return;
    closingRef.current = true;
    hideTip();
    if (!shownRef.current || reducedMotion()) {
      void bridge.destroyNoteWindow();
      return;
    }
    const card = await requestCardRect(activeRef.current);
    const snapshot = sectionRef.current ? snapshotOf(sectionRef.current) : null;
    void bridge.closeNoteWindow(snapshot, card);
  }, [finishEditing]);

  /** 关闭一个标签页：只剩它时关闭整个窗口；关闭后选中同一位置的标签页。 */
  const closeTab = useCallback(
    async (id: string) => {
      const list = tabsRef.current;
      if (list.length <= 1) {
        void closeWindow();
        return;
      }
      if (editingRef.current && activeRef.current === id && !(await finishEditing(true))) return;
      const index = list.indexOf(id);
      const next = list.filter((item) => item !== id);
      tabsRef.current = next;
      setTabs(next);
      if (activeRef.current === id) {
        const replacement = next[Math.min(index, next.length - 1)];
        activeRef.current = replacement;
        setActive(replacement);
      }
      window.requestAnimationFrame(() => {
        const current = stripRef.current?.querySelector<HTMLElement>('.note-window-tab.is-active');
        if (current && sectionRef.current?.contains(document.activeElement)) current.focus({ preventScroll: true });
        else sectionRef.current?.focus({ preventScroll: true });
      });
    },
    [closeWindow, finishEditing],
  );

  /** 把记录放进标签页（插入位置默认在最后），最后一条成为当前页（原型 addTabs）。 */
  const addTabs = useCallback(
    async (ids: string[], at = -1) => {
      const valid = ids.filter((id) => {
        const item = noteOf(id);
        return item && item.status !== 'trash';
      });
      if (!valid.length) return;
      const kept = tabsRef.current.filter((id) => !valid.includes(id));
      const index = at < 0 || at > kept.length ? kept.length : Math.min(at, kept.length);
      const next = [...kept.slice(0, index), ...valid, ...kept.slice(index)];
      tabsRef.current = next;
      setTabs(next);
      if (editingRef.current && !(await finishEditing(true))) return;
      const last = valid[valid.length - 1];
      activeRef.current = last;
      setActive(last);
    },
    [finishEditing, noteOf],
  );

  /** 记录移到了别的窗口：从这里拿走；窗口空了就直接收起，不播放关闭动画（原型 detachTab）。 */
  const removeTabs = useCallback(
    async (ids: string[]) => {
      if (editingRef.current && ids.includes(editingRef.current.id)) await finishEditing(true);
      const next = tabsRef.current.filter((id) => !ids.includes(id));
      tabsRef.current = next;
      if (!next.length) {
        closingRef.current = true;
        void bridge.destroyNoteWindow();
        return;
      }
      setTabs(next);
      if (!next.includes(activeRef.current)) {
        activeRef.current = next[0];
        setActive(next[0]);
      }
    },
    [finishEditing],
  );

  // 记录被删除或移入回收站：关掉它的标签页，都没了就收起窗口。
  useEffect(() => {
    if (!shownRef.current || closingRef.current) return;
    const gone = tabsRef.current.filter((id) => {
      const item = notes.find((candidate) => candidate.id === id);
      return !item || item.status === 'trash';
    });
    if (!gone.length) return;
    if (editingRef.current && gone.includes(editingRef.current.id)) {
      editingRef.current = null;
      setEditing(null);
    }
    void removeTabs(gone);
  }, [notes, removeTabs]);

  /* ==================== 标签页的悬停提示与插入线 ==================== */

  /** 标签页的标题被截断时，悬停片刻显示全名；横排在下方，竖排在右侧。 */
  const showTip = (tab: HTMLElement): void => {
    window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => {
      const name = tab.querySelector<HTMLElement>('.note-window-tab-title');
      if (gestureRef.current || !tab.isConnected || !name || name.scrollWidth <= name.clientWidth + 1) return;
      if (!tipRef.current) {
        tipRef.current = document.createElement('div');
        tipRef.current.className = 'note-window-tooltip';
        tipRef.current.setAttribute('role', 'tooltip');
      }
      const tip = tipRef.current;
      tip.textContent = name.textContent;
      document.body.append(tip);
      const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
      const box = tab.getBoundingClientRect();
      const size = tip.getBoundingClientRect();
      const vertical = Boolean(tab.closest('.is-side-tabs'));
      const left = vertical ? box.right + MARGIN / 2 : clamp(box.left, MARGIN / 2, view.width - size.width - MARGIN / 2);
      const top = vertical
        ? clamp(box.top + (box.height - size.height) / 2, MARGIN / 2, view.height - size.height - MARGIN / 2)
        : box.bottom + MARGIN / 3;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }, 400);
  };

  function hideTip(): void {
    window.clearTimeout(tipTimer.current);
    tipRef.current?.remove();
  }

  /** 标签页在标签栏里的落点：横排看横坐标，竖排看纵坐标；只有一个标签页的窗口接在最后。 */
  const tabIndexAt = (point: { x: number; y: number }): number => {
    const items = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('.note-window-tab') ?? []);
    if (!items.length) return tabsRef.current.length;
    const vertical = Boolean(sectionRef.current?.classList.contains('is-side-tabs'));
    const index = items.findIndex((item) => {
      const box = item.getBoundingClientRect();
      return vertical ? point.y < box.top + box.height / 2 : point.x < box.left + box.width / 2;
    });
    return index < 0 ? items.length : index;
  };

  /** 指针在本窗口的标签栏一带（放宽一点）：在这里松开是调整顺序。 */
  const inTabBand = (point: { x: number; y: number }): boolean => {
    const section = sectionRef.current;
    if (!section) return false;
    if (section.classList.contains('is-side-tabs') && stripRef.current) {
      const strip = stripRef.current.getBoundingClientRect();
      return point.x >= strip.left - MARGIN && point.x <= strip.right + MARGIN && point.y >= strip.top && point.y <= strip.bottom;
    }
    const header = headerRef.current?.getBoundingClientRect();
    return Boolean(header && point.y >= header.top - MARGIN && point.y <= header.bottom + MARGIN && point.x >= header.left && point.x <= header.right);
  };

  /**
   * 标签栏里的插入线：一条强调色的竖线（竖排时是横线），与卡片排序的插入线同一种样子。返回线的矩形，
   * 没有标签栏或放回原处时为 null。`dragged` 为本窗口里正在拖动的标签页。指针靠近标签栏两端时滚动。
   */
  const tabDropRect = (point: { x: number; y: number }, dragged = ''): { rect: bridge.PixelRect; horizontal: boolean } | null => {
    const section = sectionRef.current;
    const strip = stripRef.current;
    const items = Array.from(strip?.querySelectorAll<HTMLElement>('.note-window-tab') ?? []);
    if (!section || !strip || !section.classList.contains('has-tabs') || !items.length) return null;
    const vertical = section.classList.contains('is-side-tabs');
    const box = strip.getBoundingClientRect();
    const edge = MARGIN * 2;
    if (vertical && strip.scrollHeight > strip.clientHeight) {
      if (point.y < box.top + edge) strip.scrollTop -= MARGIN;
      else if (point.y > box.bottom - edge) strip.scrollTop += MARGIN;
    } else if (!vertical && strip.scrollWidth > strip.clientWidth) {
      if (point.x < box.left + edge) strip.scrollLeft -= MARGIN;
      else if (point.x > box.right - edge) strip.scrollLeft += MARGIN;
    }
    const index = tabIndexAt(point);
    const from = dragged ? tabsRef.current.indexOf(dragged) : -1;
    if (from >= 0 && (index === from || index === from + 1)) return null;
    const style = window.getComputedStyle(strip);
    const gap = parseFloat(vertical ? style.rowGap : style.columnGap) || 0;
    const tab = items[Math.min(index, items.length - 1)].getBoundingClientRect();
    if (vertical) {
      const top = clamp(index < items.length ? tab.top - gap / 2 : tab.bottom + gap / 2, box.top, box.bottom);
      return { rect: { x: tab.left, y: top, width: tab.width, height: 0 }, horizontal: true };
    }
    const left = clamp(index < items.length ? tab.left - gap / 2 : tab.right + gap / 2, box.left, box.right);
    return { rect: { x: left, y: tab.top, width: 0, height: tab.height }, horizontal: false };
  };

  /** 本窗口里的插入线（调整标签页顺序时）。 */
  const showOwnDrop = (drop: { rect: bridge.PixelRect; horizontal: boolean } | null): void => {
    if (!drop) {
      dropRef.current?.remove();
      return;
    }
    if (!dropRef.current) {
      dropRef.current = document.createElement('span');
      dropRef.current.className = 'note-window-tab-drop';
      dropRef.current.setAttribute('aria-hidden', 'true');
    }
    const line = dropRef.current;
    line.classList.toggle('is-horizontal', drop.horizontal);
    line.style.left = `${drop.rect.x}px`;
    line.style.top = `${drop.rect.y}px`;
    line.style.width = drop.horizontal ? `${drop.rect.width}px` : '';
    line.style.height = drop.horizontal ? '' : `${drop.rect.height}px`;
    if (!line.isConnected) document.body.append(line);
  };

  // 合并、切换或关掉标签页之后，窗口按当前这一页的内容重新定大小（T110）：内容在上限之内时不出滚动条。
  // 编辑中不变（打字时窗口跟着跳）；手动拖过边框或放大过的窗口保持用户的大小。
  useEffect(() => {
    const section = sectionRef.current;
    const area = areaRef.current;
    if (!section || !area || !shownRef.current || closingRef.current || editing || manualSize.current) return;
    if (fittedKey.current === fitKey) return;
    let cancelled = false;
    void settleImages(section, IMAGE_WAIT).then(() => {
      if (cancelled || closingRef.current || editingRef.current || manualSize.current) return;
      fittedKey.current = fitKey;
      const size = fitSize(section, stripRef.current, area);
      void bridge.fitNoteWindow(size.width, size.height);
    });
    return () => {
      cancelled = true;
    };
  }, [fitKey, editing]);

  /* ==================== 后端事件 ==================== */

  // 打开：标签页写好之后量尺寸（宽高都按内容，原型 fitSize），交给后端摆放、播放打开动画并显示。
  // 先等图片加载出来再量：没加载的图片高度为 0，量出的窗口偏矮，图片出来后正文就出现滚动条。
  const openToken = useRef(0);
  useLayoutEffect(() => {
    const request = opening;
    const section = sectionRef.current;
    if (!request || !section) return;
    setOpening(null);
    const token = ++openToken.current;
    areaRef.current = request.area;
    void settleImages(section, IMAGE_WAIT).then(() => {
      if (token !== openToken.current) return;
      const size = fitSize(section, stripRef.current, request.area);
      fittedKey.current = fitKeyRef.current;
      shownRef.current = true;
      const snapshot = reducedMotion() ? null : snapshotOf(section);
      void bridge.presentNoteWindow(size.width, size.height, snapshot).then(() => sync());
      section.focus({ preventScroll: true });
    });
  }, [opening, sync]);

  useEffect(() => {
    const begin = (request: bridge.NoteWindowOpen): void => {
      originRef.current = request.origin;
      tabsRef.current = request.tabs;
      activeRef.current = request.active;
      pinnedRef.current = request.pinned;
      attachedRef.current = request.attached;
      setTabs(request.tabs);
      setActive(request.active);
      setPinned(request.pinned);
      setAttached(request.attached);
      if (request.kind === 'restore') {
        // 开发时整页重载：窗口保持原来的大小，不按内容重新定。
        manualSize.current = true;
        shownRef.current = true;
        return;
      }
      setOpening(request);
    };
    const opened = bridge.onWindowEvent<bridge.NoteWindowOpen>(EVENTS.open, begin);
    const dispose = bridge.subscribeAll([
      opened,
      bridge.onWindowEvent<{ ids: string[]; x: number; y: number }>(EVENTS.add, (payload) => {
        const point = { x: payload.x / window.devicePixelRatio, y: payload.y / window.devicePixelRatio };
        setMerge(false);
        void addTabs(payload.ids, tabIndexAt(point)).then(() => {
          pulse();
          sectionRef.current?.focus({ preventScroll: true });
        });
      }),
      bridge.onWindowEvent<{ ids: string[] }>(EVENTS.remove, (payload) => void removeTabs(payload.ids)),
      bridge.onWindowEvent<{ id: string }>(EVENTS.activate, (payload) => {
        void activate(payload.id).then(() => {
          pulse();
          sectionRef.current?.focus({ preventScroll: true });
        });
      }),
      bridge.onWindowEvent<{ x: number; y: number } | null>(EVENTS.hint, (payload) => {
        setMerge(Boolean(payload));
        if (!payload) return;
        const point = { x: payload.x / window.devicePixelRatio, y: payload.y / window.devicePixelRatio };
        const drop = tabDropRect(point);
        void bridge.dragIndicator(drop?.rect ?? null, drop?.horizontal ?? false);
      }),
      bridge.onWindowEvent(EVENTS.close, () => void closeWindow()),
      bridge.onWindowEvent(EVENTS.detach, () => {
        attachedRef.current = false;
        setAttached(false);
      }),
    ]);
    // 先订阅打开事件，再取等着的打开请求，备用窗口不会漏掉请求。
    void opened.then(() => bridge.noteWindowInit()).then((request) => {
      if (request) begin(request);
    });
    return dispose;
    // 只在挂载时订阅；处理函数读取的都是 ref 或稳定的回调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ==================== 焦点 ==================== */

  // 获得焦点的窗口边框带一点强调色：透明窗口由样式（:focus-within）画，系统画边框的窗口改 DWM 的边框颜色。
  useEffect(() => {
    const onFocus = (): void => {
      window.clearTimeout(blurTimer.current);
      setFront(true);
      if (document.activeElement === document.body) sectionRef.current?.focus({ preventScroll: true });
    };
    const onBlur = (): void => {
      setFront(false);
      hideTip();
      // 全文浮窗点到别处就收回（T100），编辑中的内容在关闭流程里先保存。焦点很快又回来（被备用窗口短暂抢走）时不收回。
      if (attachedRef.current && shownRef.current && !closingRef.current && !gestureRef.current) {
        window.clearTimeout(blurTimer.current);
        blurTimer.current = window.setTimeout(() => {
          if (!document.hasFocus() && attachedRef.current && !closingRef.current) void closeWindow();
        }, PEEK_BLUR_DELAY);
        return;
      }
      // 点到窗口外保存（原型 focusout）。
      if (editingRef.current && !document.querySelector('.modal-backdrop')) void finishEditing(true);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.clearTimeout(blurTimer.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [finishEditing, closeWindow]);

  useEffect(() => {
    if (document.documentElement.dataset.snWindow === 'clear') return;
    const color = front ? hexColor('color-mix(in srgb, var(--sn-color-accent) 40%, var(--sn-color-border))') : null;
    void bridge.setWindowBorderColor(color);
  }, [front, settings.surface, settings.theme]);

  /* ==================== 标签页的位置 ==================== */

  // 切换标签页的位置（设置中的「窗口标签页」，各窗口同步）：竖排的标签栏另占一列，窗口加宽这一列，正文宽度不变；
  // 改回顶部时再减掉。只跟着设置变化，标签页增减时不改窗口宽度（与原型 changeTabLayout 相同）。
  const layoutSetting = useRef(settings.windowTabs);
  useLayoutEffect(() => {
    const width = side && stripRef.current ? stripRef.current.getBoundingClientRect().width : 0;
    if (layoutSetting.current !== settings.windowTabs) {
      layoutSetting.current = settings.windowTabs;
      const delta = width - sideWidth.current;
      if (shownRef.current && Math.abs(delta) > 0.5) void bridge.widenNoteWindow(delta);
    }
    sideWidth.current = width;
  });

  /* ==================== 标题栏与标签页的拖动 ==================== */

  const endGesture = useCallback(
    async (event: PointerEvent<HTMLElement> | globalThis.PointerEvent, cancel = false) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      window.cancelAnimationFrame(gesture.frame);
      try {
        if (gesture.target.hasPointerCapture(event.pointerId)) gesture.target.releasePointerCapture(event.pointerId);
      } catch {
        /* 已经释放。 */
      }
      gesture.ghost?.remove();
      showOwnDrop(null);
      setMoving(false);
      setDragTab('');
      if (!gesture.active) return;
      const point = { x: event.clientX, y: event.clientY };
      if (cancel) {
        void bridge.dragEnd(false, false);
        return;
      }
      if (gesture.mode === 'move') {
        // 标题栏落在别的窗口的标题栏上：整个窗口并进去，编辑中的内容先保存。
        if (gesture.merge && editingRef.current && !(await finishEditing(true))) {
          void bridge.dragEnd(false, false);
          return;
        }
        void bridge.dragEnd(true, false);
        return;
      }
      const own = inTabBand(point);
      if (!gesture.merge && own) {
        // 在本窗口的标签栏里松开：调整顺序。
        void bridge.dragEnd(false, false);
        const list = tabsRef.current;
        const from = list.indexOf(gesture.tab);
        let to = tabIndexAt(point);
        if (to > from) to -= 1;
        if (from < 0 || to === from) return;
        const next = list.filter((id) => id !== gesture.tab);
        next.splice(to, 0, gesture.tab);
        tabsRef.current = next;
        setTabs(next);
        return;
      }
      // 拖到别的窗口或窗口外：先保存这一页的编辑，再合并过去或拆成新窗口（后端发来 remove 时从这里拿走）。
      const detach = !gesture.merge && tabsRef.current.length > 1;
      if ((gesture.merge || detach) && editingRef.current?.id === gesture.tab && !(await finishEditing(true))) {
        void bridge.dragEnd(false, false);
        return;
      }
      void bridge.dragEnd(true, true, detach);
    },
    [finishEditing],
  );

  /** 跟随指针：拖动窗口时由后端移动窗口；拖动标签页时本窗口里画拖影与插入线，离开窗口后拖影交给动画层。 */
  const paintGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gesture.frame = 0;
    const point = { x: gesture.x, y: gesture.y };
    if (gesture.mode === 'move') {
      void bridge.dragUpdate(false).then((target) => {
        if (gestureRef.current === gesture) gesture.merge = target;
      });
      return;
    }
    const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const outsideWindow = point.x < 0 || point.y < 0 || point.x > view.width || point.y > view.height;
    if (gesture.ghost) {
      gesture.ghost.style.left = `${point.x - gesture.grab.x}px`;
      gesture.ghost.style.top = `${point.y - gesture.grab.y}px`;
      gesture.ghost.style.visibility = outsideWindow ? 'hidden' : '';
    }
    const own = inTabBand(point);
    showOwnDrop(own && !gesture.merge ? tabDropRect(point, gesture.tab) : null);
    void bridge.dragUpdate(outsideWindow).then((target) => {
      if (gestureRef.current !== gesture) return;
      gesture.merge = target;
      gesture.ghost?.classList.toggle('is-detaching', !target && !own && tabsRef.current.length > 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只读 ref
  }, []);

  /** 开始拖动：移动 4 像素后才算，单击与双击照常。 */
  const activateGesture = (gesture: Gesture): void => {
    gesture.active = true;
    hideTip();
    if (gesture.mode === 'move') {
      setMoving(true);
      // 拖动全文浮窗的标题栏：手动拖出来，成为独立的记录窗口（后端在开始拖动时处理）。
      attachedRef.current = false;
      setAttached(false);
      void bridge.dragBegin({ kind: 'move', ids: tabsRef.current });
      return;
    }
    const source = gesture.target.getBoundingClientRect();
    gesture.grab = { x: gesture.startX - source.left, y: gesture.startY - source.top };
    const ghost = document.createElement('div');
    ghost.className = 'note-window-tab-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const copy = gesture.target.cloneNode(true) as HTMLElement;
    copy.classList.remove('is-drag-source');
    ghost.append(copy);
    document.body.append(ghost);
    gesture.ghost = ghost;
    setDragTab(gesture.tab);
    void bridge.dragBegin({
      kind: 'tab',
      ids: [gesture.tab],
      html: ghost.outerHTML,
      ghost: bridge.rectOf(source),
      grab: [gesture.grab.x, gesture.grab.y],
    });
  };

  const startGesture = (event: PointerEvent<HTMLElement>, mode: 'move' | 'tab', tab = ''): void => {
    if (event.button !== 0 || gestureRef.current || closingRef.current) return;
    if (mode === 'move') event.preventDefault();
    const target = event.currentTarget;
    gestureRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
      tab,
      active: false,
      merge: null,
      ghost: null,
      grab: { x: 0, y: 0 },
      frame: 0,
      x: event.clientX,
      y: event.clientY,
    };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* 指针失效时由 pointercancel 收尾。 */
    }
  };

  const moveGesture = (event: PointerEvent<HTMLElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 4) return;
      activateGesture(gesture);
    }
    if (!gesture.frame) gesture.frame = window.requestAnimationFrame(paintGesture);
  };

  // Esc 取消拖动。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const gesture = gestureRef.current;
      if (event.key !== 'Escape' || !gesture?.active) return;
      event.preventDefault();
      event.stopPropagation();
      void endGesture({ pointerId: gesture.pointerId, clientX: gesture.x, clientY: gesture.y } as globalThis.PointerEvent, true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [endGesture]);

  // 标签页放不下时横向滚动：滚轮的上下滚动换成左右。
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, [side, many]);

  // 当前标签页滚进视野。
  useLayoutEffect(() => {
    stripRef.current?.querySelector('.note-window-tab.is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs, side]);

  // 切换标签页时正文回到顶部，同一页重绘时保留滚动位置。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || editing) return;
    if (scrollKeep.current.id !== active) body.scrollTop = 0;
    scrollKeep.current = { id: active, top: body.scrollTop };
  }, [active, editing, note?.text]);

  /* ==================== 按键 ==================== */

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    const bindings = store.getState().settings.shortcuts;
    if (matches(event, bindings, 'closeWindows')) {
      event.preventDefault();
      void bridge.closeAllNoteWindows();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Shift+Esc 关闭整个窗口；编辑中的内容与单击 × 一样先保存。
      if (event.shiftKey) void closeWindow();
      else if (editingRef.current) void finishEditing(false);
      else void closeTab(activeRef.current);
      return;
    }
    // 桌面端补上 Ctrl+W 关闭当前页、Ctrl+Shift+W 关闭窗口（浏览器中被占用，原型没有）。
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (event.shiftKey) void closeWindow();
      else void closeTab(activeRef.current);
      return;
    }
    if (editingRef.current && matches(event, bindings, 'save')) {
      event.preventDefault();
      event.stopPropagation();
      void finishEditing(true);
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLElement>, id: string): void => {
    const vertical = Boolean(sectionRef.current?.classList.contains('is-side-tabs'));
    const forward = event.key === 'ArrowRight' || (vertical && event.key === 'ArrowDown');
    const backward = event.key === 'ArrowLeft' || (vertical && event.key === 'ArrowUp');
    const list = tabsRef.current;
    const index = list.indexOf(id);
    const next = forward ? list[(index + 1) % list.length] : backward ? list[(index - 1 + list.length) % list.length] : '';
    if (next) {
      event.preventDefault();
      void activate(next).then(() => {
        window.requestAnimationFrame(() => stripRef.current?.querySelector<HTMLElement>('.note-window-tab.is-active')?.focus());
      });
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void closeTab(id);
    }
  };

  /* ==================== 正文 ==================== */

  const toggleTask = (target: Note, offset: number, checked: boolean): void => {
    const display = noteDisplay(target.text);
    const index = sourceOffset(target.text, display, offset);
    if (target.text[index - 1] !== '[' || target.text[index + 1] !== ']') return;
    const text = target.text.slice(0, index) + (checked ? 'x' : ' ') + target.text.slice(index + 1);
    void store.updateNote(target.id, { text });
  };

  const openReference = (target: string): void => {
    void openAttachment(target).catch((error: unknown) => toast(bridge.errorText(error, '这个附件不能直接打开'), null, true));
  };

  const renderBody = () => {
    if (!note) return null;
    if (editing && editing.id === note.id) {
      return (
        <LiveEditor
          value={editing.text}
          ariaLabel="编辑记录"
          minHeight={0}
          maxHeight={null}
          autoFocus
          onChange={(text) => {
            if (editingRef.current) editingRef.current.text = text;
          }}
          onReady={(editor) => {
            editorRef.current = editor;
            // 与卡片编辑一致，光标放在正文末尾（标签行之前）。
            const end = bodyEnd(editor.getValue());
            editor.setSelectionRange(end, end);
            window.requestAnimationFrame(() => editor.revealCaret());
          }}
          onAttachment={(reference) => openReference(reference.target)}
        />
      );
    }
    const display = noteDisplay(note.text);
    const tags = parse(note.text).tags;
    return (
      <>
        {/* 标题已经写在标题栏或标签页里，正文不再重复首行（与卡片相同）。 */}
        <div className="note-window-content markdown-body">
          <Markdown
            text={display.body}
            handlers={{
              onTaskToggle: (offset, checked) => toggleTask(note, offset, checked),
              onAttachment: (attachment) => openReference(attachment.target),
            }}
          />
          {note.images.map((image) => (
            <button
              key={image.id}
              type="button"
              className="note-image-button"
              aria-label={`预览图片：${image.name}`}
              onClick={() => openReference(image.data)}
            >
              <img className="note-image" src={image.data} alt={image.name} draggable={false} />
            </button>
          ))}
        </div>
        {tags.length ? (
          <div className="note-window-tags">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip"
                data-tag={tag}
                aria-label={`#${tag}`}
                onClick={() => void bridge.emitToWindow('main', EVENTS.filterTag, tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );
  };

  const titleOf = (item: Note | undefined): string => (item ? noteTitle(item) : '');

  const strip = (
    <div
      ref={stripRef}
      className="note-window-tabs"
      role="tablist"
      aria-orientation={side ? 'vertical' : 'horizontal'}
      onScroll={hideTip}
    >
      {many
        ? tabs.map((id) => {
            const item = notes.find((candidate) => candidate.id === id);
            const name = titleOf(item);
            const current = id === active;
            return (
              <div
                key={id}
                className={['note-window-tab', current ? 'is-active' : '', dragTab === id ? 'is-drag-source' : ''].filter(Boolean).join(' ')}
                data-note-id={id}
                role="tab"
                aria-selected={current}
                aria-label={name}
                tabIndex={current ? 0 : -1}
                onClick={() => void activate(id)}
                onAuxClick={(event) => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  void closeTab(id);
                }}
                onPointerDown={(event) => {
                  hideTip();
                  if (!(event.target as Element).closest('button')) startGesture(event, 'tab', id);
                }}
                onPointerMove={moveGesture}
                onPointerUp={(event) => void endGesture(event)}
                onPointerCancel={(event) => void endGesture(event, true)}
                onPointerEnter={(event) => showTip(event.currentTarget)}
                onPointerLeave={hideTip}
                onKeyDown={(event) => onTabKeyDown(event, id)}
              >
                <span className="note-window-tab-emoji" aria-hidden="true">
                  {item?.emoji || '📝'}
                </span>
                <span className="note-window-tab-title">{name}</span>
                <button
                  type="button"
                  className="icon-button note-window-tab-close"
                  aria-label={`关闭标签页：${name}`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(id);
                  }}
                >
                  <Icon name="x" />
                </button>
              </div>
            );
          })
        : null}
    </div>
  );

  const title = titleOf(note);
  const classes = [
    'note-window',
    many ? 'has-tabs' : '',
    side ? 'is-side-tabs' : '',
    editing ? 'is-editing' : '',
    pinned ? 'is-pinned' : '',
    attached ? 'is-attached' : '',
    front ? 'is-front' : '',
    merge ? 'is-merge-target' : '',
    moving ? 'is-moving' : '',
    dragTab ? 'is-dragging-tab' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
    <IconSprite />
    <section
      ref={sectionRef}
      className={classes}
      role="dialog"
      tabIndex={-1}
      aria-label={many ? `${tabs.length} 条记录` : title}
      onKeyDown={onKeyDown}
    >
      <header
        ref={headerRef}
        className="note-window-header"
        onPointerDown={(event) => {
          if (!(event.target as Element).closest('button,.note-window-tab')) startGesture(event, 'move');
        }}
        onPointerMove={moveGesture}
        onPointerUp={(event) => void endGesture(event)}
        onPointerCancel={(event) => void endGesture(event, true)}
        onDoubleClick={(event) => {
          if ((event.target as Element).closest('button,.note-window-tab')) return;
          manualSize.current = true;
          void bridge.maximizeNoteWindow();
        }}
      >
        <span className="note-window-emoji" aria-hidden="true">
          {note ? note.emoji || '📝' : ''}
        </span>
        <h2 className="note-window-title">{title}</h2>
        {side ? null : strip}
        {/* 标签栏右侧留一块空白：标签页再多也有地方按住拖动窗口。 */}
        <div className="note-window-grip" aria-hidden="true" />
        <div className="window-actions">
          {/* 标签页放在顶部还是左侧：有标签页时才显示，切换的是设置中的同一项。 */}
          <button
            type="button"
            className="icon-button note-window-layout"
            aria-pressed={side}
            aria-label={side ? '标签页放到顶部' : '标签页放到左侧'}
            onClick={() => {
              void store.updateSettings({ windowTabs: settings.windowTabs === 'side' ? 'top' : 'side' });
              sectionRef.current?.focus({ preventScroll: true });
            }}
          >
            <Icon name={side ? 'panel-top' : 'panel-left'} />
          </button>
          {/* 全文浮窗附着在卡片旁、一直在最前，不显示置顶按钮；拖出来成为独立窗口后才有。 */}
          {attached ? null : (
            <button
              type="button"
              className="icon-button note-window-pin"
              aria-pressed={pinned}
              aria-label={pinned ? '取消置顶窗口' : '置顶窗口'}
              onClick={() => {
                pinnedRef.current = !pinned;
                setPinned(!pinned);
              }}
            >
              <Icon name="pin" />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="关闭窗口"
            aria-keyshortcuts="Shift+Escape"
            onClick={() => void closeWindow()}
          >
            <Icon name="x" />
          </button>
        </div>
      </header>
      {/* 正文外面一层横排的容器：标签页放在左侧时，标签栏排在正文之前。 */}
      <div className="note-window-main">
        {side ? strip : null}
        <div
          ref={bodyRef}
          className="note-window-body"
          role="tabpanel"
          onScroll={(event) => {
            scrollKeep.current = { id: active, top: event.currentTarget.scrollTop };
          }}
          onDoubleClick={(event) => {
            if (editingRef.current || (event.target as Element).closest('button,a,input,textarea,[contenteditable="true"]')) return;
            event.preventDefault();
            beginEditing();
          }}
        >
          {renderBody()}
        </div>
      </div>
      {EDGES.map((edge) => (
        <div
          key={edge}
          className="note-window-resize"
          data-edge={edge}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            manualSize.current = true;
            void bridge.startResizeDragging(edge);
          }}
        />
      ))}
    </section>
    </>
  );
}

/**
 * 新窗口的大小按内容决定（原型 fitSize）：先按内容的自然宽度排一次，再按这个宽度量高度。
 * 宽 280–560（顶部有标签页时上限 720，竖排的标签栏另加它的宽度）、高 220 到 720 与工作区的七成，长文在窗口里滚动。
 * 高度按内容的滚动高度量（不受当前窗口高度的限制），再加几个像素的余量，避免刚好差一点出现滚动条。
 * `area` 为工作区（物理像素），返回页面像素。窗口已经挪到目标屏幕上，页面像素比与显示时一致。
 */
function fitSize(section: HTMLElement, strip: HTMLElement | null, area: bridge.PixelRect): { width: number; height: number } {
  const ratio = window.devicePixelRatio || 1;
  const view = { width: area.width / ratio, height: area.height / ratio };
  const side = section.classList.contains('is-side-tabs');
  const extra = side && strip ? strip.getBoundingClientRect().width : 0;
  const cap = section.classList.contains('has-tabs') && !side ? FIT_TABS_WIDTH : FIT_WIDTH[1];
  const maxWidth = Math.max(Math.min(MIN_WIDTH, view.width - MARGIN * 2), Math.min(cap + extra, view.width - MARGIN * 2));
  const style = section.style;
  style.position = 'absolute';
  style.inset = 'auto';
  style.left = '0';
  style.top = '0';
  style.width = 'max-content';
  style.maxWidth = `${maxWidth}px`;
  style.height = 'auto';
  const width = clamp(Math.ceil(section.getBoundingClientRect().width), Math.min(FIT_WIDTH[0] + extra, maxWidth), maxWidth);
  style.maxWidth = '';
  // 高度按留出滚动条、再窄一点的宽度量。排满的中文行宽度少一点就多折一行：窗口还小的时候正文出现过滚动条，
  // 变到量好的尺寸后，有滚动条时正文窄、行多，正好需要滚动条，没有时又放得下，浏览器保留原来的滚动条。
  // 按有滚动条的宽度量，两种情况都放得下，滚动条就会去掉。
  style.width = `${width - FIT_WRAP_SLACK}px`;
  const body = section.querySelector<HTMLElement>('.note-window-body');
  if (body) body.style.overflowY = 'scroll';
  // 正文区自己会滚动：它的滚动高度比可见高度多出的部分也要算进来，否则长一点的内容按当前窗口高度量，偏矮。
  const hidden = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
  const height = clamp(
    Math.ceil(section.getBoundingClientRect().height + hidden) + FIT_SLACK,
    MIN_HEIGHT,
    Math.max(MIN_HEIGHT, Math.min(view.height * FIT_AREA, FIT_HEIGHT)),
  );
  if (body) body.style.overflowY = '';
  style.cssText = '';
  return { width, height };
}

/**
 * 等窗口里的图片与字体加载好（最多 `timeout` 毫秒）。窗口还没显示，懒加载的图片不会自己加载，先改成立即加载。
 */
async function settleImages(root: HTMLElement, timeout: number): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  images.forEach((image) => {
    image.loading = 'eager';
  });
  const ready = Promise.all([document.fonts.ready.catch(() => undefined), ...images.map((image) => image.decode().catch(() => undefined))]);
  await Promise.race([ready, new Promise((resolve) => window.setTimeout(resolve, timeout))]);
}

/** 窗口的副本：动画层用它播放打开与关闭的动画。去掉缩放手柄与焦点状态，图片立即加载。 */
function snapshotOf(section: HTMLElement): string {
  const copy = section.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.note-window-resize').forEach((node) => node.remove());
  copy.querySelectorAll('img').forEach((image) => image.removeAttribute('loading'));
  copy.classList.remove('is-moving', 'is-merge-target', 'is-dragging-tab');
  copy.removeAttribute('tabindex');
  copy.setAttribute('aria-hidden', 'true');
  return copy.outerHTML;
}
