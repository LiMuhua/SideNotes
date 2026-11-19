/**
 * 侧栏主组件。
 *
 * 组合页签、搜索框、新建卡片、记录列表与所有交互逻辑；
 * 拖排序、多选、卡片编辑、设置入口都统一在此层处理，不再分散到各子组件。
 * 新建卡片固定在列表之上，不随列表滚动。
 *
 * 侧栏内的「鼠标移出收起」逻辑：桌面端通过窗口隐藏而非 CSS 平移，
 * 所以原型的 slideOut 动画对应的是 `bridge.hideSidebar()` 调用。
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icon, IconSprite } from "./Icon";
import { Composer } from "./Composer";
import { NoteCard } from "./NoteCard";
import { NoteMenu, type MenuAnchor, type MenuCommand } from "./NoteMenu";
import { ContextMenu } from "./ContextMenu";
import { SidebarMenu, type SidebarCommand } from "./SidebarMenu";
import { TagInput } from "./TagInput";
import { MergeDialog } from "./MergeDialog";
import { EmojiPicker } from "./EmojiPicker";
import { TagFilter } from "./TagFilter";
import { TagManageDialog } from "./TagManageDialog";
import { ChangelogDialog } from "./ChangelogDialog";
import { UsageGuide } from "./UsageGuide";
import { Modal, ToastRegion } from "./Modal";
import { AttachmentDialog, type AttachmentSubject } from "./AttachmentDialog";
import type { AttachmentPayload, MergePayload } from "./DialogWindow";
import { useDialogWindow } from "../hooks/useDialogWindow";
import { useLatest } from "../hooks/useLatest";
import { useStore } from "../hooks/useStore";
import { useShortcut } from "../hooks/useShortcut";
import { useToast } from "../hooks/useToast";
import { useAppIconSource } from "../hooks/useAppIcon";
import { useCardInteractions, type ItemDrop } from "../hooks/useCardInteractions";
import { useFileDrop, type FileDropTarget } from "../hooks/useFileDrop";
import * as store from "../core/store";
import * as bridge from "../core/bridge";
import { shouldNudgeTidy, noteTitle, compareNoteOrder } from "../core/notes";
import {
  allTags,
  belongsTo,
  filterNotes,
  homeTab,
  findPinned,
  pinnedTagOf,
  tabCount,
  tabExists,
  tabLabel,
  tabName,
  tabOfTag,
  tabPatch,
  tagOfTab,
} from "../core/tabs";
import { SidebarTabs, type SidebarTabsHandle } from "./SidebarTabs";
import { knownTags, searchGroups, searchTerms, singleSearchTag, wordTag, SEARCH_PLACEHOLDER, type SearchGroup } from "../core/search";
import { listHits, setSearchHits } from "../core/searchHighlight";
import { insertAtDisplayLine, moveImage, moveReference } from "../core/transfer";
import {
  importPastedFiles,
  openAttachment,
  referencesFor,
  replaceReference,
  type AttachmentReference,
  type ReferenceSpan,
} from "../core/attachments";
import { placeAttachment } from "../core/insert";
import { bodyEnd, parse, removeTag, tagKey, canonicalize, isValidTag, withTag } from "../core/tags";
import { WIDTH_RANGE, uiZoom } from "../core/settings";
import { comboFromEvent, matches } from "../core/shortcuts";
import type { EditSession, Note, NoteImage, TabKey } from "../core/types";
import type { EditorAttachment, MarkdownEditor } from "../core/editor";


/** 修改记录写入失败时的提示，沿用原型 updateNote 的文案。 */
const SAVE_FAILED_MESSAGE = "保存失败，原记录未改动。请导出备份后重试。";

/** 设置窗口打开期间推迟收起，按此间隔复查它是否已关闭。 */
const SETTINGS_POLL_INTERVAL = 400;
/** 指针停在侧栏与屏幕边缘之间的留白里时，复查是否已经离开的间隔（毫秒）。 */
const GAP_POLL_INTERVAL = 150;

/** 两组图片附件是否相同（只比较标识与顺序）。 */
function sameImages(left: NoteImage[], right: NoteImage[]): boolean {
  return left.length === right.length && left.every((image, index) => image.id === right[index].id);
}

/** 记录所在的位置（记录信息）：置顶、固定的标签页签或随记（原型 note-menu.js 的 place）。 */
function notePlace(note: Note, pinned: readonly string[]): string {
  const tag = pinnedTagOf(note, pinned);
  return [note.pinned ? "置顶" : "", tag ? `页签「${tag}」` : note.pinned ? "" : "随记"].filter(Boolean).join("、");
}

export function Sidebar() {
  const state = useStore();
  const appIcon = useAppIconSource(state.settings.appIcon);
  const searchKeys = useShortcut("search");
  const toast = useToast();

  /* ==================== 侧栏与 Tab 状态 ==================== */
  const [tabValue, setTab] = useState<TabKey>("workspace");
  // 当前的标签页签被移出页签栏（或改名）后回到随记。
  const tab: TabKey = tabExists(tabValue, state.settings.pinnedTags) ? tabValue : "workspace";
  /** 「查看」「转到」要找到的记录，以及刚找到、正在闪一下的那一条。 */
  const [locate, setLocate] = useState<{ id: string; serial: number } | null>(null);
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [composerActive, setComposerActive] = useState(false);
  const [pinned, setPinned] = useState(false);
  /** 设置窗口正在显示：侧栏随之保持展开，固定按钮显示为按下以作提示。 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 全文浮窗正附着在哪张卡片旁（T100，后端的 peek 事件）：卡片的按钮显示「收起全文」，侧栏保持展开。 */
  const [peekId, setPeekId] = useState<string | null>(null);

  /* ==================== 编辑事务 ==================== */
  const [editing, setEditing] = useState<EditSession | null>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  // 计时回调与失焦处理读取最新的编辑事务，避免沿用旧闭包。
  const editingRef = useRef<EditSession | null>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  /** 正在从资源管理器拖入文件，见 useFileDrop。 */
  const fileDraggingRef = useRef(false);

  /* ==================== UI 层叠状态 ==================== */
  const [tagsExpandedId, setTagsExpandedId] = useState<string | null>(null);
  // key 每次打开递增：在另一张卡片上右键时重新挂载菜单，焦点回到首项。
  const [contextMenu, setContextMenu] = useState<{ note: Note; anchor: MenuAnchor; key: number } | null>(null);
  /** 空白处的右键菜单。 */
  const [sidebarMenu, setSidebarMenu] = useState<{ anchor: MenuAnchor; key: number } | null>(null);
  /** 卡片菜单「移到…」的二级菜单：随记与固定的标签页签（当前页签除外）。 */
  const [moveMenu, setMoveMenu] = useState<{ note: Note; anchor: MenuAnchor } | null>(null);
  /** 页签栏打开的弹层（SidebarTabs）：菜单期间保持展开，输入页签名期间在获得焦点时保持展开。 */
  const [tabsPopup, setTabsPopup] = useState<"menu" | "input" | null>(null);
  const menuSerial = useRef(0);
  /**
   * 单击选中的卡片：与指针悬停的卡片使用同一种边框高亮，指针移到另一张卡片上时只高亮那一张。
   * Ctrl+C 复制高亮的卡片：悬停的优先，其次是单击选中的。
   */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<Note | null>(null);
  /**
   * 附件弹窗：附件本身，以及修改后写回到哪里（编辑器、记录，或新建卡片与编辑中的图片附件）。
   * 写回函数在打开时按点击的位置确定，见 handleNoteAttachment 等。
   */
  const [attachmentDialog, setAttachmentDialog] = useState<{
    subject: AttachmentSubject;
    replaceSource?: (source: string) => boolean | Promise<boolean>;
    replaceImage?: (image: NoteImage | null) => boolean | Promise<boolean>;
  } | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  /* 标签筛选菜单与标签管理对话框。 */
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [managingTag, setManagingTag] = useState<string | null>(null);
  /* 版号打开的「版本与更新」弹窗。 */
  const [changelogOpen, setChangelogOpen] = useState(false);
  /* 使用指南：首次启动（设置中尚未记下看过）时显示一次，之后从侧栏菜单打开。 */
  const [guideOpen, setGuideOpen] = useState(false);
  const guideVisible = guideOpen || (state.ready && !state.loadFailed && !state.settings.guideSeen);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    if (!store.getState().settings.guideSeen) void store.updateSettings({ guideSeen: true });
  }, []);

  const listRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);

  /** 高亮一张卡片并把焦点移过去，滚到看得见的位置。 */
  const focusCard = useCallback((id: string | undefined) => {
    if (!id) return;
    setCurrentId(id);
    const card = listRef.current?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(id)}"]`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }, []);


  /** 打开记录菜单：右下角「…」按钮传入按钮元素，右键传入鼠标位置。 */
  const openNoteMenu = useCallback((note: Note, anchor: MenuAnchor) => {
    menuSerial.current += 1;
    setSidebarMenu(null);
    setContextMenu({ note, anchor, key: menuSerial.current });
  }, []);

  /** 打开空白处的侧栏菜单。 */
  const openSidebarMenu = useCallback((anchor: MenuAnchor) => {
    menuSerial.current += 1;
    setContextMenu(null);
    setSidebarMenu({ anchor, key: menuSerial.current });
  }, []);

  /* ==================== 鼠标移出收起 ==================== */
  const asideRef = useRef<HTMLElement>(null);
  const hideTimer = useRef<number>(0);
  /** 正在拖动边框调整宽度；拖动期间指针可能移出窗口，不能因此收起。 */
  const resizing = useRef(false);
  /** 正在用系统对话框选择附件：对话框打开期间侧栏失焦，不算点到了侧栏之外。 */
  const choosingFiles = useRef(false);
  /** 每次安排或取消收起都会递增；异步查询返回时据此判断这次收起是否已被取消。 */
  const hideToken = useRef(0);
  /**
   * 已触发收起（鼠标移出或窗口失焦）但还没有执行。
   * 到点时若仍需保持展开（菜单、对话框、编辑等），保留此标记，条件解除后补一次收起；
   * 否则这些条件在鼠标已移出时结束，侧栏会一直停留，直到鼠标再移入移出一次。
   */
  const hidePending = useRef(false);

  /** 组装当前侧栏布局，供窗口命令使用；窗口宽度随字号等比加宽。 */
  const currentLayout = useCallback(
    () =>
      bridge.sidebarLayout({
        edge: state.settings.edge,
        width: state.settings.width,
        fontSize: state.settings.fontSize,
        animDuration: state.settings.animDuration,
        surface: state.settings.surface,
      }),
    [state.settings.edge, state.settings.width, state.settings.fontSize, state.settings.animDuration, state.settings.surface],
  );

  // 对话框打开期间鼠标移出侧栏不收起，否则对话框会随侧栏一起消失。
  /** 合并成一条的弹窗：来源（按列表中的顺序）、合并到的已有卡片与按标签合并时的标签。 */
  const [mergeRequest, setMergeRequest] = useState<{ notes: Note[]; target: Note | null; tag?: string } | null>(null);
  /** 筛选行：标签菜单挂在它下面（原型 #tag-dropdown 是 .list-topline 的子元素）。 */
  const [topline, setTopline] = useState<HTMLDivElement | null>(null);
  /** 「记录信息」弹窗（卡片菜单，原型 note-menu.js 的 showInfo）。 */
  const [infoNote, setInfoNote] = useState<Note | null>(null);
  const dialogOpen = Boolean(
    managingTag || attachmentDialog || emojiTarget || changelogOpen || guideVisible || mergeRequest || infoNote,
  );
  /**
   * 合并与附件弹窗在独立的弹窗窗口里（T99，桌面端）：状态仍记在这里，打开期间侧栏保持展开，
   * 固定按钮与设置窗口打开时一样显示为临时固定。浏览器预览没有弹窗窗口，仍画在页面里。
   */
  const windowDialogs = bridge.isDesktop();
  const windowDialogOpen = windowDialogs && Boolean(mergeRequest || attachmentDialog);
  const windowDialogOpenRef = useLatest(windowDialogOpen);
  const dialogWindow = useDialogWindow();

  /** 关闭「记录信息」：焦点回到打开它的卡片（原型第二版）。 */
  const closeInfo = useCallback(() => {
    const id = infoNote?.id;
    setInfoNote(null);
    window.requestAnimationFrame(() => focusCard(id));
  }, [infoNote, focusCard]);
  // 卡片菜单与对话框渲染在侧栏元素之外，鼠标移上去就会触发侧栏的 mouseleave。
  // 与原型的 keepVisible 一致：到点时按最新状态再判断一次，避免先移出侧栏、随后才打开对话框时仍被收起。
  // 实际值在卡片手势之后计算（见下方）：holdRef 为任何情况下都保持展开的条件；
  // holdFocusedRef 为编辑、多选等只在侧栏仍有焦点时（鼠标移出）才保持展开的条件，点到侧栏之外照常收起。
  const holdRef = useRef(false);
  const holdFocusedRef = useRef(false);

  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hidePending.current = true;
    const token = ++hideToken.current;
    const mustStay = (): boolean =>
      holdRef.current || choosingFiles.current || (holdFocusedRef.current && document.hasFocus());
    const attempt = (): void => {
      if (token !== hideToken.current || mustStay() || resizing.current) return;
      // 与原型一致：鼠标仍在侧栏上时不收起。
      if (asideRef.current?.matches(":hover")) {
        hidePending.current = false;
        return;
      }
      // 与原型一致：设置弹窗打开期间侧栏保持展开。设置是独立窗口，打开时侧栏会失焦，
      // 鼠标也可能移到设置窗口上，所以到点时先查询设置窗口是否正在显示；
      // 显示时稍后复查，设置窗口关闭（含最小化）后再收起，不需要鼠标重新移入移出。
      // 窗口离开屏幕边缘的主题（T84）：指针停在侧栏与屏幕边缘之间的留白里也算在侧栏上，稍后复查。
      void Promise.all([bridge.isSettingsVisible(), bridge.sidebarHoldsCursor()]).then(([settingsOpen, holdsCursor]) => {
        if (token !== hideToken.current || mustStay()) return;
        if (settingsOpen) {
          hideTimer.current = window.setTimeout(attempt, SETTINGS_POLL_INTERVAL);
          return;
        }
        if (holdsCursor) {
          hideTimer.current = window.setTimeout(attempt, GAP_POLL_INTERVAL);
          return;
        }
        hidePending.current = false;
        // 与原型一致：侧栏收起时一并收起标签菜单。
        setTagMenuOpen(false);
        void bridge.hideSidebar(currentLayout());
      });
    };
    hideTimer.current = window.setTimeout(attempt, state.settings.hideDelay);
  }, [state.settings.hideDelay, currentLayout]);

  const cancelHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideToken.current += 1;
    hidePending.current = false;
  }, []);

  /* ==================== 拖拽调整侧栏宽度 ==================== */
  // 拖动期只更新本地 CSS 变量并节流调用窗口尺寸，不写数据库：
  // 每帧持久化会触发整棵树重渲染，表现为闪动与交互失效。
  const startScreenX = useRef(0);
  const startWidth = useRef(0);
  const latestWidth = useRef(0);
  const resizeFrame = useRef(0);
  /** 拖动调宽时捕获指针的手柄，Esc 取消时释放。 */
  const resizeCapture = useRef<{ element: HTMLElement; pointerId: number } | null>(null);
  /** 指针屏幕坐标的位移换算为设置中宽度的比例；浏览器预览没有窗口与界面缩放，保持 1。 */
  const widthPerScreen = useRef(1);

  // 屏幕坐标（screenX、outerWidth）的单位既不同于页面像素（受界面缩放影响），
  // 也不同于窗口逻辑像素（受 Windows 文本缩放影响）。用同一窗口在两种单位下的宽度求比例，
  // 不依赖浏览器对页面缩放和文本缩放的具体处理。设置中的宽度按 13px 字号计，
  // 窗口逻辑宽度是它乘以界面缩放（见 sidebarWindowWidth），因此最后再除以界面缩放。
  const refreshPixelRatio = useCallback(() => {
    if (!bridge.isDesktop()) return;
    void bridge.windowScaleFactor().then((scale) => {
      if (scale <= 0 || window.outerWidth <= 0) return;
      // 页面宽度乘页面像素比得到物理宽度，再除以窗口缩放比例得到逻辑宽度。
      const logicalWidth = (window.innerWidth * window.devicePixelRatio) / scale;
      widthPerScreen.current =
        logicalWidth / window.outerWidth / uiZoom(store.getState().settings.fontSize);
    });
  }, []);

  useEffect(() => {
    refreshPixelRatio();
  }, [refreshPixelRatio]);

  const commitWidth = useCallback((width: number) => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    latestWidth.current = width;
  }, []);

  /* 宽度手柄：指针一移上去就是左右箭头，停留 400ms 后才高亮，只是划过不会闪一下（interactions.md 第四节）。 */
  const [resizerArmed, setResizerArmed] = useState(false);
  const armTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  const handleResizerEnter = useCallback(() => {
    window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(() => setResizerArmed(true), 400);
  }, []);
  const handleResizerLeave = useCallback(() => {
    window.clearTimeout(armTimer.current);
    if (!resizing.current) setResizerArmed(false);
  }, []);
  /** 手柄获得焦点后 ←、→ 每次调整 8px，按住 Shift 每次 40px；朝屏幕内侧是加宽。 */
  const handleResizerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const settings = store.getState().settings;
    const delta = (event.key === "ArrowLeft" ? 1 : -1) * (settings.edge === "right" ? 1 : -1) * (event.shiftKey ? 40 : 8);
    const width = Math.max(WIDTH_RANGE.min, Math.min(WIDTH_RANGE.max, settings.width + delta));
    if (width !== settings.width) void store.updateSettings({ width });
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizing.current = true;
      // 用屏幕坐标计算位移：调整宽度时窗口本身在移动，窗口内坐标会随之变化，
      // 以它计算会和窗口位置互相反馈，表现为拖动时来回抖动。
      startScreenX.current = event.screenX;
      startWidth.current = state.settings.width;
      latestWidth.current = state.settings.width;
      refreshPixelRatio();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      resizeCapture.current = { element: event.currentTarget as HTMLElement, pointerId: event.pointerId };
      document.body.style.userSelect = "none";
      document.body.classList.add("is-resizing-sidebar");
      cancelHide();
    },
    [state.settings.width, cancelHide, refreshPixelRatio],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizing.current) return;
      const delta = (event.screenX - startScreenX.current) * widthPerScreen.current;
      // 右侧边：往左拖增大宽度；左侧边：往右拖增大宽度。
      const adjusted = state.settings.edge === "left" ? delta : -delta;
      const raw = startWidth.current + adjusted;
      // 窗口每次移动后，浏览器会按新位置补发指针事件，同一鼠标位置换算出的屏幕坐标可能相差 1 像素；
      // 宽度按 4 像素取整，恰在取整边界上时会因此来回跳一档。离当前宽度不足 3 像素时保持不变。
      if (Math.abs(raw - latestWidth.current) < 3) return;
      const next = Math.min(720, Math.max(360, Math.round(raw / 4) * 4));
      if (next === latestWidth.current) return;
      commitWidth(next);
      // 窗口尺寸跟随受 rAF 节流，避免每帧下发命令。
      if (resizeFrame.current) return;
      resizeFrame.current = window.requestAnimationFrame(() => {
        resizeFrame.current = 0;
        void bridge.applySidebarLayout(
          bridge.sidebarLayout({ ...store.getState().settings, width: latestWidth.current }),
          state.settings.edgeTrigger,
        );
      });
    },
    [state.settings.edge, state.settings.edgeTrigger, commitWidth],
  );

  /** 取消拖动调宽：宽度回到开始拖动前，不写入设置。 */
  const cancelResize = useCallback(() => {
    if (!resizing.current) return;
    resizing.current = false;
    document.body.style.userSelect = "";
    document.body.classList.remove("is-resizing-sidebar");
    if (resizeFrame.current) {
      window.cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = 0;
    }
    const capture = resizeCapture.current;
    resizeCapture.current = null;
    try {
      if (capture?.element.hasPointerCapture(capture.pointerId)) capture.element.releasePointerCapture(capture.pointerId);
    } catch {
      /* 忽略已释放 */
    }
    commitWidth(startWidth.current);
    void bridge.applySidebarLayout(
      bridge.sidebarLayout({ ...store.getState().settings, width: startWidth.current }),
      store.getState().settings.edgeTrigger,
    );
    if (hidePending.current) scheduleHide();
  }, [commitWidth, scheduleHide]);

  const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    resizing.current = false;
    document.body.style.userSelect = "";
    document.body.classList.remove("is-resizing-sidebar");
    if (resizeFrame.current) {
      window.cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = 0;
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* 忽略已释放 */
    }
    // 松手才把宽度写入设置并落盘一次。
    void store.updateSettings({ width: latestWidth.current });
    if (!(event.currentTarget as HTMLElement).matches(":hover")) setResizerArmed(false);
    // 拖动途中指针移出过窗口时，松手后补上推迟的收起。
    if (hidePending.current) scheduleHide();
  }, [scheduleHide]);

  /* ==================== 过滤后的列表 ==================== */
  const pinnedTags = state.settings.pinnedTags;
  // 全局搜索（DS-12–DS-15，core/search）：有搜索词时列表是全部记录中的结果，按页签分组，与当前页签和标签筛选无关；
  // 没有搜索词时是当前页签（及标签筛选），置顶在前，再按手动顺序与创建时间（core/tabs 的 notesInTab）。
  const searchText = searchTerms(query);
  const searching = Boolean(searchText);
  const resultGroups = useMemo(
    () => (searching ? searchGroups(state.notes, pinnedTags, query) : []),
    [searching, state.notes, pinnedTags, query],
  );
  const listNotes = useMemo(
    () => (searching ? resultGroups.flatMap((group) => group.notes) : filterNotes(state.notes, tab, pinnedTags, "", selectedTag)),
    [searching, resultGroups, state.notes, tab, pinnedTags, selectedTag],
  );
  /** 每组第一条记录的 id 对应的组：列表中在这条记录之前写组标题。 */
  const groupStarts = useMemo(
    () => new Map<string, SearchGroup>(resultGroups.map((group) => [group.notes[0].id, group])),
    [resultGroups],
  );

  /* ==================== 按需加载 ==================== */
  // 开启「滚动按需加载」时先渲染一批，滚动到列表底部再追加下一批；切换页签、搜索或筛选标签后从第一批开始。
  // 只影响渲染：多选、全选、收起全部与复制仍按整个列表处理。
  const pageSize = state.settings.lazyLoading ? state.settings.pageSize : Number.POSITIVE_INFINITY;
  // 搜索时的视图与页签、标签筛选无关（与原型 renderNotes 的 key 相同）。
  const viewKey = searching ? `search\u0000${searchText}` : `${tab}\u0000\u0000${selectedTag}`;
  const [loaded, setLoaded] = useState({ key: viewKey, count: pageSize });
  const loadedCount = loaded.key === viewKey ? Math.max(loaded.count, pageSize) : pageSize;
  const renderedNotes = useMemo(() => listNotes.slice(0, loadedCount), [listNotes, loadedCount]);
  // 定位记录（「查看」「转到」）：先按需加载到它，渲染之后再滚过去。
  useEffect(() => {
    if (!locate) return;
    const frame = window.requestAnimationFrame(() => {
      const index = listNotes.findIndex((note) => note.id === locate.id);
      if (index < 0) {
        setLocate(null);
        return;
      }
      if (index >= loadedCount) {
        setLoaded({ key: viewKey, count: index + 1 });
        return;
      }
      const card = listRef.current?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(locate.id)}"]`);
      if (!card) return;
      setCurrentId(locate.id);
      card.focus({ preventScroll: true });
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      setLocatedId(locate.id);
      setLocate(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [locate, listNotes, loadedCount, viewKey]);
  useEffect(() => {
    if (!locatedId) return;
    const timer = window.setTimeout(() => setLocatedId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [locatedId]);

  // 列表只占一个 Tab 停靠点：编辑中的卡片，否则是高亮的卡片，没有高亮时是第一张（interactions.md 3.2）。
  const tabStopId =
    editing?.id ?? (currentId && renderedNotes.some((note) => note.id === currentId) ? currentId : renderedNotes[0]?.id);
  const hasMore = renderedNotes.length < listNotes.length;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const list = listRef.current;
    if (!hasMore || !sentinel || !list) return;
    // 底部提示进入列表（提前 120 像素）时追加一批；追加后若仍在可见范围内，会立即再追加，直到填满列表。
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLoaded({ key: viewKey, count: loadedCount + pageSize });
        }
      },
      { root: list, rootMargin: "0px 0px 120px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, viewKey, loadedCount, pageSize]);

  /* ==================== 结束搜索时回到原来的位置 ==================== */
  // 与原型 renderNotes 的 searchReturn 相同：开始搜索时记下原来列表的视图、滚动位置与已加载的条数，
  // 结束搜索（Esc、清空）回到原来的页签与标签筛选时还原；「转到」去别处时不还原。
  // 滚动位置随滚动记下：切到搜索结果时列表已经换了内容，那时再读就晚了。
  const listMemo = useRef({ key: viewKey, scroll: 0, count: loadedCount });
  const searchReturn = useRef<{ key: string; scroll: number; count: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const shownKey = useRef(viewKey);
  const rememberScroll = useCallback(() => {
    if (searching || !listRef.current) return;
    listMemo.current = { key: viewKey, scroll: listRef.current.scrollTop, count: loadedCount };
  }, [searching, viewKey, loadedCount]);
  useLayoutEffect(() => {
    const previous = shownKey.current;
    if (previous === viewKey) return;
    shownKey.current = viewKey;
    const list = listRef.current;
    const wasSearching = previous.startsWith("search\u0000");
    if (searching && !wasSearching) {
      // 开始搜索：结果从顶部开始。
      searchReturn.current = listMemo.current.key === previous ? listMemo.current : null;
      if (list) list.scrollTop = 0;
      return;
    }
    if (searching) {
      if (list) list.scrollTop = 0;
      return;
    }
    const saved = searchReturn.current;
    searchReturn.current = null;
    if (wasSearching && saved && saved.key === viewKey) {
      // 结束搜索、回到原来的列表：先按需加载到原来的条数，渲染之后再滚回去。
      setLoaded({ key: viewKey, count: saved.count });
      pendingScroll.current = saved.scroll;
    } else if (wasSearching && list) {
      list.scrollTop = 0;
    }
  }, [viewKey, searching]);
  useLayoutEffect(() => {
    if (pendingScroll.current === null || !listRef.current) return;
    listRef.current.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
    rememberScroll();
  });

  /* ==================== 搜索命中的高亮 ==================== */
  // 标题与正文按文字、标签按「#标签」标出（core/searchHighlight，CSS 自定义高亮，不改动卡片的节点）。
  // 每次渲染后重新计算：卡片的内容、按需加载出的卡片与编辑都会改变要标的文字。
  const knownTagKeys = useMemo(() => knownTags(state.notes), [state.notes]);
  useEffect(() => {
    const list = listRef.current;
    if (!searching || !list) {
      setSearchHits("sidebar", []);
      return;
    }
    setSearchHits("sidebar", listHits(list, searchText, knownTagKeys, { text: ".note-title, .note-content", tag: ".tag-chip" }));
  });
  useEffect(() => () => setSearchHits("sidebar", []), []);

  /* ==================== 整理提醒（纯派生值，叠加本次会话内的关闭标记） ==================== */
  const nudgeVisible = !nudgeDismissed && shouldNudgeTidy(state.notes, state.settings);

  /* ==================== 编辑器回调（在键盘 effect 之前声明） ==================== */

  const cancelEdit = useCallback(() => {
    setEditing(null);
    editorRef.current = null;
  }, []);

  /**
   * 保存并退出当前编辑，返回是否成功。
   *
   * 正文以编辑器当前内容为准：失焦提交可能早于输入法收尾的状态更新。
   * 内容与附件都没有变化时直接退出，不写库，也不改动修改时间。
   */
  const commitEdit = useCallback(async () => {
    const session = editingRef.current;
    if (!session) return true;
    const current = editorRef.current?.getValue() ?? session.text;
    const text = current.trim() ? current : session.originalText;
    const changed = text !== session.originalText || !sameImages(session.images, session.originalImages);
    if (changed && !(await store.commitEdit(session.id, text, session.images))) {
      toast("保存失败，请稍后重试", null, true);
      return false;
    }
    // 保存期间若已开始编辑另一条记录，不打断新的编辑。
    if (editingRef.current?.id === session.id) {
      editingRef.current = null;
      setEditing(null);
      editorRef.current = null;
    }
    return true;
  }, [toast]);

  /**
   * 编辑卡片失去焦点后保存并回到预览，对应原型 scheduleEditBlur。
   *
   * 等焦点交接完成再判断：焦点仍在编辑卡片内（工具按钮、附件预览）时不提交；
   * 打开了对话框（附件弹窗等）时焦点进入对话框，编辑保持不变，关闭后焦点回到编辑区；
   * 切换到其它窗口时页面焦点仍留在卡片里，编辑保持不变，回来后可以继续；
   * 附件还在读取时也先不提交，避免丢失刚选的图片。
   */
  const editBlurTimer = useRef(0);
  const handleEditBlur = useCallback(() => {
    const session = editingRef.current;
    window.clearTimeout(editBlurTimer.current);
    editBlurTimer.current = window.setTimeout(() => {
      if (!session || editingRef.current?.id !== session.id) return;
      const card = listRef.current?.querySelector(".note-card.is-editing");
      if (card?.contains(document.activeElement)) return;
      if (document.querySelector(".modal-backdrop")) return;
      // 从资源管理器拖入文件期间编辑面会暂时让出焦点（见 useFileDrop），不算离开。
      if (fileDraggingRef.current) return;
      if (store.getState().pendingAttachments > 0) return;
      void commitEdit();
    }, 0);
  }, [commitEdit]);

  /** 切换页签：清空搜索、标签筛选与单击选中，页签按钮与拖动停留共用。 */
  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    setQuery("");
    setSearchOpen(false);
    setSelectedTag("");
    setTagMenuOpen(false);
    setCurrentId(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, []);

  /**
   * 切换页签；给出记录时在列表中找到它（按需加载到它），滚到中间、高亮并闪一下。
   * 搜索结果的「转到」与「已记在」的「查看」共用：去别处，结束搜索时不回到原来的滚动位置。
   */
  const goToTab = useCallback(
    (next: TabKey, noteId?: string) => {
      searchReturn.current = null;
      switchTab(next);
      if (noteId) setLocate({ id: noteId, serial: Date.now() });
    },
    [switchTab],
  );

  /** 结束搜索（Esc、空状态的「清除搜索」）：清空搜索词，收起搜索框，回到原来的页签、标签筛选与滚动位置。 */
  const endSearch = useCallback(() => {
    setQuery("");
    setSearchOpen(false);
    setTagMenuOpen(false);
  }, []);

  /** 把搜索词换成这段文字并聚焦搜索框（筛选行的「#开发 N 条」、搜索时点卡片上的标签）。 */
  const setSearchQuery = useCallback((text: string) => {
    setSearchOpen(true);
    setQuery(text);
    setTagMenuOpen(false);
    window.setTimeout(() => {
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      input?.focus();
      input?.setSelectionRange(text.length, text.length);
    }, 0);
  }, []);

  /* ==================== 速记 Composer ==================== */
  // 新建卡片上的「#标签」：在标签页签中新建时带上这个标签；点 × 这条不带，换页签或保存后恢复。
  const tabTag = tagOfTab(tab);
  const [skipTag, setSkipTag] = useState("");
  const draftTag = tabTag && !(skipTag && tagKey(skipTag) === tagKey(tabTag)) ? tabTag : "";

  /**
   * 新记录的提示（DS-12）：不在当前页签里显示时，写明记在了哪里，「查看」切过去并闪一下这一条；
   * 是因为去掉了新建卡片上的页签标签时，还有「放回」：补上这个标签。其余情况照旧提示「记录已保存」。
   */
  const announceSaved = useCallback(
    (note: Note, skipped: string) => {
      const pinned = store.getState().settings.pinnedTags;
      if (belongsTo(note, tab, pinned)) {
        toast("记录已保存");
        return;
      }
      const home = homeTab(note, pinned);
      const actions = [{ label: "查看", run: () => goToTab(home, note.id) }];
      if (skipped) {
        actions.push({
          label: `放回「${skipped}」`,
          run: () => {
            const current = store.getState().notes.find((item) => item.id === note.id);
            if (!current) return;
            void store.updateNote(note.id, { text: withTag(current.text, skipped) }).then((saved) => {
              toast(saved ? `已放回「${skipped}」` : SAVE_FAILED_MESSAGE, null, !saved);
            });
          },
        });
      }
      toast(`已记在「${tabName(home)}」`, actions);
    },
    [tab, goToTab, toast],
  );
  const [composerText, setComposerText] = useState("");
  const composerEditorRef = useRef<MarkdownEditor | null>(null);

  /**
   * 保存新建卡片：保存按钮与 Ctrl+Enter 共用。侧栏保持展开，焦点留在新建卡片里，可以接着记下一条；
   * 独立的速记浮窗仍是保存即收起（见 Capture）。
   */
  const saveComposer = useCallback(
    async () => {
      // 与原型一致：附件还在读取时只提示；草稿为空时不保存也不提示。
      const { draft, pendingAttachments } = store.getState();
      if (pendingAttachments > 0) {
        toast("内容正在读取，请稍候");
        return;
      }
      if (!draft.text.trim() && !draft.images.length) return;
      // 在置顶页签中新建的置顶；在标签页签中新建的带上这个标签（新建卡片上的「#标签」，点 × 这条不带）。
      const note = await store.saveDraftAsNote({ pinned: tab === "pinned", tag: draftTag });
      if (!note) {
        toast(
          store.getState().loadFailed
            ? "尚未读取到本地记录，已暂停保存，草稿仍在"
            : "没有保存成功，草稿和图片仍在，可导出备份后重试",
          null,
          true,
        );
        return;
      }
      setComposerText("");
      const skipped = tabTag && skipTag && tagKey(skipTag) === tagKey(tabTag) ? tabTag : "";
      setSkipTag("");
      // 保存后列表回到顶部，新记录就在新建卡片下面（原型 focusNewComposer）。
      if (listRef.current) listRef.current.scrollTop = 0;
      announceSaved(note, skipped);
    },
    [tab, draftTag, tabTag, skipTag, setSkipTag, announceSaved, toast],
  );

  useEffect(() => {
    store.changeDraft(composerText);
  }, [composerText]);

  /** 复制记录：菜单首项、卡片上的复制按钮与 Ctrl+C 共用；多条记录之间空一行。单条时提示带上标题，便于确认复制的是哪一条。 */
  const handleCopyNotes = useCallback(
    async (notes: Note[]) => {
      try {
        const plain = notes.map((note) => `${note.emoji || "📝"} ${note.text}`).join("\n\n");
        await navigator.clipboard.writeText(plain);
        if (notes.length > 1) {
          toast(`已复制 ${notes.length} 条记录`);
        } else {
          const title = noteTitle(notes[0]);
          toast(`已复制-${title.length > 24 ? `${title.slice(0, 24)}…` : title}`);
        }
      } catch {
        toast("剪贴板不可用", null, true);
      }
    },
    [toast],
  );

  const handleCopyNote = useCallback((note: Note) => handleCopyNotes([note]), [handleCopyNotes]);

  /** 打开搜索并聚焦输入框：Ctrl+F 与空白处菜单共用。 */
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    window.setTimeout(() => {
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      input?.focus();
      // 已有搜索词时全选，直接输入就是换一个词（原型 toggleSearch）。
      input?.select();
    }, 50);
  }, []);

  /** 新建记录：先提交正在进行的编辑，再聚焦新建卡片。Ctrl+N 与空白处菜单共用。 */
  const startNewNote = useCallback(() => {
    if (editingRef.current) void commitEdit();
    // 搜索中新建：先结束搜索，回到原来的页签（原型 newNote）。
    if (searchTerms(query) || searchOpen) endSearch();
    window.dispatchEvent(new CustomEvent("sidenotes:focus-composer"));
  }, [commitEdit, query, searchOpen, endSearch]);

  /**
   * 固定或取消固定侧栏：标题栏按钮与空白处菜单共用。固定只让侧栏保持展开；
   * 侧栏不出现在任务栏、Alt+Tab 与 Win+Tab 中（2026-11-16 用户要求，见后端 windows::create_owner_window）。
   */
  const togglePinned = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    if (next) {
      cancelHide();
      if (!editingRef.current && !searchOpen) window.dispatchEvent(new CustomEvent("sidenotes:focus-composer"));
    }
  }, [pinned, cancelHide, searchOpen]);

  /** 手动收起侧栏（收起按钮、Esc、空白处菜单）：同时解除固定（原型 hideSidebar(true)）。 */
  const hideManually = useCallback(() => {
    setPinned(false);
    setTagMenuOpen(false);
    void bridge.hideSidebar(currentLayout());
  }, [currentLayout]);

  /* ==================== 窗口失焦自动收起 ==================== */
  // 点到侧栏窗口之外与鼠标移出同样触发收起；是否保持展开由到点时的状态决定，
  // 不在这里提前返回，否则菜单随失焦关闭后就再没有机会收起。
  // 整个侧栏失去焦点时，正在编辑的卡片先保存并回到预览，与在侧栏内点到别处一致；
  // 选择附件的对话框打开期间、附件还在读取时、附件弹窗等对话框开着时不算离开。
  // 弹窗窗口（T99）打开时焦点移到它上面，也不算离开：附件弹窗的修改要写回仍在编辑的卡片。
  // 重新获得焦点（选完附件、很快又点回侧栏）时取消尚未执行的收起。
  useEffect(() => {
    const handleBlur = (): void => {
      if (
        editingRef.current &&
        !choosingFiles.current &&
        store.getState().pendingAttachments === 0 &&
        !document.querySelector(".modal-backdrop") &&
        !windowDialogOpenRef.current
      ) {
        void commitEdit();
      }
      scheduleHide();
    };
    const handleFocus = (): void => {
      choosingFiles.current = false;
      if (hidePending.current) cancelHide();
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [scheduleHide, cancelHide, commitEdit, windowDialogOpenRef]);

  /* ==================== 设置窗口联动 ==================== */
  // 设置窗口打开期间侧栏保持展开（见 scheduleHide）。切到别的窗口时侧栏看起来像卡住不收，
  // 所以跟随设置窗口的显示状态把固定按钮显示为按下，关闭或最小化设置后恢复。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void bridge.isSettingsVisible().then((showing) => {
      if (!disposed) setSettingsOpen(showing);
    });
    void bridge
      .onSettingsVisibility((showing) => setSettingsOpen(showing))
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /* ==================== 托盘与系统事件 ==================== */
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    // 设置与退出的托盘事件统一在 App 层处理，这里只保留侧栏内的交互。

    // 从速记浮窗切换到侧栏时聚焦 Composer 输入区。
    const focusComposer = (): void => {
      setComposerActive(true);
      setTimeout(() => {
        (
          document.querySelector(
            "#quick-composer .live-editor-host [contenteditable]",
          ) as HTMLElement | null
        )?.focus();
      }, 100);
    };
    window.addEventListener("sidenotes:focus-composer", focusComposer);
    cleanups.push(() => window.removeEventListener("sidenotes:focus-composer", focusComposer));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  /* ==================== 编辑器回调（beginEdit 在 cancelEdit/commitEdit 之后声明） ==================== */

  const beginEdit = useCallback(
    (note: Note) => {
      if (editing?.id === note.id) return;
      if (editing) {
        // 先提交当前编辑再开新的
        void commitEdit();
      }
      setCurrentId(note.id);
      setEditing({
        id: note.id,
        text: note.text,
        images: note.images.map((image) => ({ ...image })),
        originalText: note.text,
        originalImages: note.images.map((image) => ({ ...image })),
      });
    },
    [editing, commitEdit],
  );

  /* ==================== 卡片操作 ==================== */

  /**
   * 把卡片移到另一个页签（卡片菜单「移到…」，与拖到页签上相同）：到标签页签加上这个标签，从别的标签页签来时换掉原来那个；
   * 到随记去掉当前页签的标签；到置顶只置顶。移到随记后还在别的固定标签里的，提示写明在哪里。提示条可以撤销。
   */
  const moveToTab = useCallback(
    async (ids: readonly string[], destination: TabKey, origin?: TabKey | "home") => {
      const { notes, settings } = store.getState();
      const pinned = settings.pinnedTags;
      // 来自全局搜索的结果（origin 为 home）时，每条记录按它自己所在的页签算，已经在目的地的不动（与原型 moveRecords 相同）。
      const fromSearch = origin === "home";
      const from = fromSearch ? null : origin ?? tab;
      if (destination === from) return false;
      const changes: Array<readonly [string, Partial<Note>]> = [];
      const moved: Note[] = [];
      const homes = new Set<TabKey>();
      ids.forEach((id) => {
        const note = notes.find((item) => item.id === id);
        if (!note || note.status !== "active") return;
        const source = from ?? homeTab(note, pinned);
        if (source === destination) return;
        homes.add(source);
        const patch: Partial<Note> = { ...tabPatch(note, source, destination), order: null };
        changes.push([id, patch]);
        moved.push({ ...note, ...patch });
      });
      if (!changes.length) {
        if (fromSearch) toast(`已经在${tabLabel(destination)}`);
        return false;
      }
      const fromLabel = from ? tabLabel(from) : homes.size === 1 ? tabLabel(Array.from(homes)[0]) : "原来的页签";
      const undo = await store.patchNotes(changes);
      if (!undo) {
        toast("移动未保存，请重试", null, true);
        return false;
      }
      let message = `已移到${tabLabel(destination)} ${changes.length} 条记录`;
      if (destination === "workspace") {
        const still = moved.map((note) => pinnedTagOf(note, pinned)).filter(Boolean);
        if (still.length) {
          const some = still.length < moved.length ? `${still.length} 条` : "";
          const more = new Set(still.map(tagKey)).size > 1 ? "等页签" : "";
          message = `已移出${fromLabel}，${some}仍在「${still[0]}」${more}`;
        }
      }
      toast(message, {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo);
        },
      });
      return true;
    },
    [tab, toast],
  );

  /* ==================== 卡片长按排序与多选（对应原型 interactions.js） ==================== */

  /* ==================== 页签：固定、移出、改名与排序 ==================== */
  const tabsRef = useRef<SidebarTabsHandle>(null);

  /** 保存固定的标签与顺序；失败时提示，返回是否成功。 */
  const savePinnedTags = useCallback(
    async (list: string[]) => {
      const saved = await store.updateSettings({ pinnedTags: list });
      if (!saved) toast("页签未保存，请重试", null, true);
      return saved;
    },
    [toast],
  );

  /** 把标签固定成页签并切换过去；已经固定的直接切换。与已有标签只差大小写时用已有的写法。 */
  const pinTag = useCallback(
    (name: string): boolean => {
      const raw = String(name || "").trim().replace(/^#/, "");
      if (!isValidTag(raw)) {
        toast("标签最多 40 字；使用文字、数字、下划线或短横线", null, true);
        return false;
      }
      const { notes, settings } = store.getState();
      const known = allTags(notes).find((item) => tagKey(item.tag) === tagKey(raw));
      const tag = findPinned(settings.pinnedTags, raw) || (known ? known.tag : raw);
      if (!findPinned(settings.pinnedTags, tag)) {
        const previous = settings.pinnedTags;
        void savePinnedTags([...previous, tag]).then((saved) => {
          if (!saved) return;
          toast(`已固定为页签「${tag}」`, {
            label: "撤销",
            run: () => void savePinnedTags(previous),
          });
        });
      }
      switchTab(tabOfTag(tag));
      return true;
    },
    [savePinnedTags, switchTab, toast],
  );

  /** 移出页签栏：只是不再固定，记录与标签都不变；当前在这个页签时回到随记。提示条可以撤销，放回原来的位置。 */
  const unpinTag = useCallback(
    (tag: string) => {
      const previous = store.getState().settings.pinnedTags;
      const name = findPinned(previous, tag);
      if (!name) return;
      void savePinnedTags(previous.filter((item) => item !== name)).then((saved) => {
        if (!saved) return;
        if (tagKey(tagOfTab(tab)) === tagKey(name)) switchTab("workspace");
        toast(`已把「${name}」移出页签栏`, { label: "撤销", run: () => void savePinnedTags(previous) });
      });
    },
    [savePinnedTags, switchTab, tab, toast],
  );

  /** 页签改名：所有记录上的这个标签一起改（与已有标签同名时合并），固定的页签跟着改。 */
  const renamePinnedTag = useCallback(
    (tag: string, value: string) => {
      const next = value.trim().replace(/^#/, "");
      if (!next || next === tag) return;
      if (!isValidTag(next)) {
        toast("标签最多 40 字；使用文字、数字、下划线或短横线", null, true);
        return;
      }
      return store.renameTag(tag, next).then((saved) => {
        if (!saved) {
          toast(SAVE_FAILED_MESSAGE, null, true);
          return;
        }
        if (selectedTag && tagKey(selectedTag) === tagKey(tag)) setSelectedTag(next);
        if (tagKey(tagOfTab(tab)) === tagKey(tag)) setTab(tabOfTag(next));
        toast("标签已改名，所有记录一起更新");
      });
    },
    [selectedTag, tab, toast],
  );

  /** 移入回收站：不确认，提示条可以撤销（DS-12）；永久删除与清空回收站仍要确认。 */
  const moveToTrash = useCallback(async (notes: Note[]) => {
    if (!notes.length) return false;
    const undo = await store.moveNotes(notes.map((note) => note.id), "trash");
    if (!undo) {
      toast(SAVE_FAILED_MESSAGE, null, true);
      return false;
    }
    toast(notes.length > 1 ? `已移入回收站 ${notes.length} 条记录` : "已移入回收站", {
      label: "撤销",
      run: () => {
        // 撤销还原删除前的状态、置顶与顺序；写入失败时与原型一样提示保存失败。
        void store.restoreNotes(undo).then((ok) => {
          if (!ok) toast(SAVE_FAILED_MESSAGE, null, true);
        });
      },
    });
    return true;
  }, [toast]);

  /** 把拖动的记录移到页签或回收站，提示可撤销，对应原型 moveRecords；from 是开始拖动时的页签。 */
  const moveDragged = useCallback(
    async (ids: string[], destination: TabKey | "trash", from: TabKey) => {
      if (destination === "trash") return moveToTrash(store.getState().notes.filter((note) => ids.includes(note.id)));
      return moveToTab(ids, destination, searching ? "home" : from);
    },
    [moveToTab, moveToTrash, searching],
  );

  /** 把拖动的记录插入目标之前或之后，提示可撤销，对应原型 reorder。 */
  const reorderDragged = useCallback(
    async (ids: Set<string>, targetId: string, after: boolean, from: TabKey) => {
      const count = store.getState().notes.filter((note) => ids.has(note.id) && note.status !== "trash").length;
      // 拖动时停在别的页签上切换了列表：放进这个页签的卡片同时按页签的规则加减标签。
      const change = from !== tab ? (note: Note) => tabPatch(note, from, tab) : undefined;
      const undo = await store.reorderNotes(ids, targetId, after, change);
      if (!undo) {
        toast("排序未保存，原顺序保持不变", null, true);
        return;
      }
      toast(`已移动 ${count} 条记录`, {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo);
        },
      });
    },
    [tab, toast],
  );

  /** 把图片附件或正文引用移到另一张卡片，提示可撤销。 */
  const moveItem = useCallback(
    async (drop: ItemDrop) => {
      const notes = store.getState().notes;
      const source = notes.find((note) => note.id === drop.sourceId);
      const target = notes.find((note) => note.id === drop.targetId);
      if (!source || !target) return;
      let changes: Array<{ id: string; text?: string; images?: NoteImage[] }> = [];
      let what = "图片";
      if (drop.kind === "image" && drop.imageId) {
        const moved = moveImage(source, target, drop.imageId, drop.index);
        if (moved) {
          changes = [
            { id: source.id, images: moved.sourceImages },
            { id: target.id, images: moved.targetImages },
          ];
        }
      } else if (drop.kind === "text" && Number.isFinite(drop.start) && Number.isFinite(drop.end)) {
        const moved = moveReference(source, target, drop.start as number, drop.end as number, drop.index);
        if (moved) {
          changes = [
            { id: source.id, text: moved.sourceText },
            { id: target.id, text: moved.targetText },
          ];
          what = moved.reference.startsWith("!") ? "图片" : "文件引用";
        }
      }
      if (!changes.length) {
        toast("内容已变化，未能移动，请重试", null, true);
        return;
      }
      const undo = await store.updateNotes(changes);
      if (!undo) {
        toast("移动未保存，原记录未改动", null, true);
        return;
      }
      const title = (target.text.split(/\r?\n/).find((line) => line.trim()) ?? "图片记录").trim().slice(0, 18);
      toast(`已把${what}移到「${title}」`, {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo).then((ok) => {
            if (!ok) toast(SAVE_FAILED_MESSAGE, null, true);
          });
        },
      });
    },
    [toast],
  );

  const interactions = useCardInteractions({
    listRef,
    trashRef,
    visibleNotes: listNotes,
    notes: state.notes,
    tab,
    viewKey,
    blocked: Boolean(editing) || dialogOpen || tagsExpandedId !== null,
    searching,
    onSwitchTab: switchTab,
    onOpenTabMenu: () => tabsRef.current?.openMenu({ dragging: true, hold: true }),
    onCloseTabMenu: () => tabsRef.current?.closeMenu(),
    onMove: moveDragged,
    onReorder: (ids, targetId, after, from) => void reorderDragged(ids, targetId, after, from),
    onMoveItem: (drop) => void moveItem(drop),
  });

  /* ==================== 选中与合并成一条（原型 interactions.js、merge.js） ==================== */
  /** 选中的记录（不含已移入回收站的），按记录的顺序。 */
  const selectedIds = useMemo(
    () => state.notes.filter((note) => interactions.selected.has(note.id) && note.status !== "trash").map((note) => note.id),
    [state.notes, interactions.selected],
  );

  /**
   * 打开合并弹窗（原型 NoteMerge.open）：来源按列表中的顺序（置顶在前），不在列表里的按记录顺序接在后面；
   * 合并到已有卡片时那一张不算来源。来源不够时提示。
   */
  const openMerge = useCallback(
    (options: { ids: readonly string[]; target?: string; tag?: string }) => {
      const { notes } = store.getState();
      const wanted = new Set(options.ids);
      const target = options.target ? notes.find((note) => note.id === options.target && note.status !== "trash") ?? null : null;
      const listed = listNotes.filter((note) => wanted.has(note.id));
      const rest = notes.filter((note) => wanted.has(note.id) && !listed.some((item) => item.id === note.id)).sort(compareNoteOrder);
      const sources = [...listed, ...rest].filter((note) => note.status !== "trash" && note.id !== target?.id);
      if (sources.length < (target ? 1 : 2)) {
        toast("至少要有两条记录才能合并");
        return;
      }
      if (editing) void commitEdit();
      setContextMenu(null);
      setMergeRequest({ notes: sources, target, tag: options.tag });
    },
    [listNotes, editing, commitEdit, toast],
  );

  /**
   * 写入合并结果（原型 merge.js 的 commit）：新卡片放在原来第一条的位置并进入编辑，原记录移到回收站（勾了保留时不动）；
   * 合并成的卡片不在当前页签里时切到它所在的页签。提示条一次撤销全部恢复。
   */
  const commitMerge = useCallback(
    async (request: { notes: Note[]; target: Note | null }, text: string, images: NoteImage[], keep: boolean) => {
      const result = await store.mergeNotes({ sources: request.notes, target: request.target, text, images, keep });
      if (!result) {
        toast("合并未保存，原记录保持不变", null, true);
        return false;
      }
      interactions.clearSelection();
      const { notes, settings } = store.getState();
      const merged = notes.find((note) => note.id === result.id);
      if (merged && !belongsTo(merged, tab, settings.pinnedTags)) {
        const tag = pinnedTagOf(merged, settings.pinnedTags);
        switchTab(merged.pinned && tab === "pinned" ? "pinned" : tag ? tabOfTag(tag) : "workspace");
      }
      const unique = new Set([...(request.target ? [request.target] : []), ...request.notes].flatMap((note) => note.images.map((image) => image.id)));
      const dropped = Math.max(0, unique.size - images.length);
      toast(
        `${request.target ? "已合并到这条 " : "已合并 "}${request.notes.length} 条${keep ? "" : "，原记录在回收站"}${
          dropped ? `；图片超过 12 张，后面 ${dropped} 张没有带过来` : ""
        }`,
        {
          label: "撤销",
          run: () => {
            if (editingRef.current?.id === result.id) cancelEdit();
            void store.restoreNotes(result.undo);
          },
        },
      );
      if (merged) window.setTimeout(() => beginEdit(merged), 0);
      return true;
    },
    [interactions, tab, switchTab, toast, cancelEdit, beginEdit],
  );

  // 合并的弹窗交给弹窗窗口（T99）：「合并」发回这里写入；弹窗关闭后清空状态，这边先清空时关掉弹窗。
  const commitMergeRef = useLatest(commitMerge);
  useEffect(() => {
    if (!mergeRequest || !windowDialogs) return;
    const request = mergeRequest;
    const payload: MergePayload = { notes: request.notes, target: request.target, tag: request.tag };
    let id = 0;
    let alive = true;
    void dialogWindow
      .open(
        "merge",
        payload,
        {
          merge: (data: { text: string; images: NoteImage[]; keep: boolean }) =>
            commitMergeRef.current(request, data.text, data.images, data.keep),
        },
        () => setMergeRequest((current) => (current === request ? null : current)),
      )
      .then((opened) => {
        id = opened;
        if (!alive) dialogWindow.close(opened);
      });
    return () => {
      alive = false;
      if (id) dialogWindow.close(id);
    };
  }, [mergeRequest, windowDialogs, dialogWindow, commitMergeRef]);

  /* ==================== 从资源管理器拖入文件 ==================== */

  /** 放下拖入的文件：保存为附件副本，插到落点（编辑面中的位置，或预览卡片的段落之间，可撤销）。 */
  const dropFiles = useCallback(
    async (target: FileDropTarget | null, files: File[]) => {
      if (!files.length) return;
      if (!target) {
        toast("拖到卡片或新建卡片上才能插入", null, true);
        return;
      }
      let markdown: string;
      store.setPendingAttachments(1);
      try {
        markdown = await importPastedFiles(files);
      } catch (error) {
        toast(`文件未能插入：${bridge.errorText(error, "请稍后重试")}`, null, true);
        return;
      } finally {
        store.setPendingAttachments(-1);
      }
      if (target.kind === "editor") {
        target.editor.focus({ preventScroll: true });
        target.editor.insertAttachment(markdown, { start: target.offset, end: target.offset, direction: "none" });
        return;
      }
      const note = store.getState().notes.find((item) => item.id === target.noteId);
      if (!note) return;
      const undo = await store.updateNotes([{ id: note.id, text: insertAtDisplayLine(note, target.line, markdown) }]);
      if (!undo) {
        toast(SAVE_FAILED_MESSAGE, null, true);
        return;
      }
      toast(`已${target.title}`, { label: "撤销", run: () => void store.restoreNotes(undo) });
    },
    [toast],
  );

  /** 拖入文件时停留进入编辑的卡片：编辑面先不获得焦点，放下插入后再聚焦（见 NoteCard 的 editAutoFocus）。 */
  const [dragEditId, setDragEditId] = useState<string | null>(null);

  /**
   * 进入编辑时把卡片滚到列表顶部（「编辑时滚到顶部」，默认打开）；退出编辑时列表不滚动。
   * 从资源管理器拖入文件、停留后进入编辑的卡片不滚动，否则放下的位置会从指针下面移走。
   */
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!editingId || editingId === dragEditId || !store.getState().settings.scrollOnEdit) return;
    const card = listRef.current?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(editingId)}"]`);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    // 只在开始编辑另一张卡片时滚动一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  const fileDrop = useFileDrop({
    // 对话框开着时交给对话框处理（附件弹窗接收拖入的文件用于替换）。
    enabled: () => !document.querySelector(".modal-backdrop"),
    findNote: (id) => store.getState().notes.find((note) => note.id === id),
    editing: () => (editingRef.current ? { id: editingRef.current.id, editor: editorRef.current } : null),
    composerEditor: () => composerEditorRef.current,
    beginEdit: (note) => {
      setDragEditId(note.id);
      beginEdit(note);
    },
    onActiveChange: (active, left) => {
      // 拖动期间指针移出移入不会触发鼠标事件，开始时取消已安排的收起；拖出窗口后再安排收起。
      // 编辑面只在创建时按 editAutoFocus 聚焦，拖动结束即可复原，之后双击编辑照常聚焦。
      fileDraggingRef.current = active;
      if (active) cancelHide();
      else {
        setDragEditId(null);
        if (left) scheduleHide();
      }
    },
    onDrop: (target, files) => void dropFiles(target, files),
  });

  // 与原型 keepVisible 一致：固定、弹层、菜单、拖动与读取附件期间不自动收起；
  // 多选，以及「编辑时保持展开」开启时的编辑记录、整理标签与新建卡片的未保存内容，
  // 只在鼠标移出时保持展开：点到侧栏之外（整个侧栏失去焦点）照常收起，编辑中的卡片已在失焦时保存。
  const draftPending = Boolean(state.draft.text.trim() || state.draft.images.length);
  const hold = Boolean(
    pinned ||
      dialogOpen ||
      peekId ||
      contextMenu ||
      moveMenu ||
      sidebarMenu ||
      tabsPopup === "menu" ||
      interactions.busy ||
      fileDrop.active ||
      state.pendingAttachments > 0,
  );
  const holdWhileFocused = Boolean(
    interactions.hasSelection ||
      // 编辑期间一律保持展开（原型第二版去掉了「编辑时保持展开」的开关）。
      editing ||
      tagsExpandedId ||
      // 正在输入新页签或页签的新名字，与原型输入搜索词时相同。
      tabsPopup === "input" ||
      (composerActive && draftPending),
  );
  useEffect(() => {
    holdRef.current = hold;
    holdFocusedRef.current = holdWhileFocused;
    // 保持展开的条件解除时，若之前已触发过收起（鼠标早已移出或窗口已失焦），补一次收起。
    if (hidePending.current && !hold && (!holdWhileFocused || !document.hasFocus())) scheduleHide();
  }, [hold, holdWhileFocused, scheduleHide]);

  /**
   * Ctrl+C 复制：多选时复制选中的全部记录；否则复制选中（高亮）的卡片。
   * 单击与指针悬停共用同一个选中状态，高亮的那一张就是复制的对象。没有可复制的卡片时提示。
   */
  const copyHighlighted = useCallback(async () => {
    let targets = listNotes.filter((note) => interactions.selected.has(note.id));
    if (!targets.length) {
      const note = listNotes.find((item) => item.id === currentId);
      if (note) targets = [note];
    }
    if (!targets.length) {
      toast("没有选中内容");
      return;
    }
    await handleCopyNotes(targets);
  }, [listNotes, interactions.selected, currentId, toast, handleCopyNotes]);

  /* ==================== 键盘快捷键 ==================== */
  // 指针在侧栏里的位置：Shift+F10 与菜单键把菜单开在这里；指针离开窗口后为空，菜单开在高亮的卡片旁。
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const track = (event: PointerEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const leave = (event: PointerEvent): void => {
      if (!event.relatedTarget) pointerRef.current = null;
    };
    document.addEventListener("pointermove", track, true);
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("pointerout", leave, true);
    return () => {
      document.removeEventListener("pointermove", track, true);
      document.removeEventListener("pointerdown", track, true);
      document.removeEventListener("pointerout", leave, true);
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // 拖动调宽时按 Esc：取消，宽度回到开始拖动前（原型 finishSidebarResize(false)）。
      if (event.key === "Escape" && resizing.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelResize();
        return;
      }
      const shortcuts = store.getState().settings.shortcuts;
      // 对话框里的保存快捷键交给对话框自己（合并成一条的「合并」、附件弹窗的「应用修改」），
      // 否则在对话框里按 Ctrl+Enter 会保存新建卡片的草稿。
      const inDialog = event.target instanceof Element && Boolean(event.target.closest(".modal"));
      if (matches(event, shortcuts, "save") && !inDialog) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (editing) {
          void commitEdit();
          return;
        }
        // 与原型一致：只有按键发生在新建卡片内才保存草稿（焦点在别处时不保存）。
        const inComposer = event.target instanceof Element && Boolean(event.target.closest("#quick-composer"));
        if (inComposer) {
          void saveComposer();
        }
      }
      if (event.key === "Escape") {
        // 页签栏的菜单、改名框与新建页签面板在最上层（SidebarTabs 的 dismiss）。
        if (tabsRef.current?.dismiss()) return;
        if (moveMenu) {
          // 「移到…」关闭后焦点回到它所属的卡片，与卡片菜单相同。
          const id = moveMenu.note.id;
          setMoveMenu(null);
          window.requestAnimationFrame(() => focusCard(id));
          return;
        }
        if (contextMenu) {
          // 菜单关闭后焦点回到它所属的卡片（interactions.md 3.3）。
          const id = contextMenu.note.id;
          setContextMenu(null);
          window.requestAnimationFrame(() => focusCard(id));
          return;
        }
        if (sidebarMenu) {
          setSidebarMenu(null);
          return;
        }
        if (emojiTarget) {
          setEmojiTarget(null);
          return;
        }
        if (mergeRequest) {
          setMergeRequest(null);
          return;
        }
        if (managingTag) {
          setManagingTag(null);
          return;
        }
        if (changelogOpen) {
          setChangelogOpen(false);
          return;
        }
        if (infoNote) {
          closeInfo();
          return;
        }
        if (guideVisible) {
          closeGuide();
          return;
        }
        if (tagMenuOpen) {
          setTagMenuOpen(false);
          document.getElementById("tag-filter-button")?.focus();
          return;
        }
        // 标签整理态：放弃没确认的改名，收起整理（原型 Esc 的第一层）。
        if (tagsExpandedId) {
          setTagsExpandedId(null);
          return;
        }
        // Esc 逐级退出（interactions.md 3.4）：菜单与弹窗在上面已经关闭，拖动由 useCardInteractions 取消。
        if (editing) {
          cancelEdit();
          return;
        }
        // 新建卡片有内容时失去焦点，草稿保留；没有内容时照常往下（结束搜索、清除筛选或收起侧栏），与原型相同。
        const active = document.activeElement;
        const draftFilled = Boolean(store.getState().draft.text.trim() || store.getState().draft.images.length);
        if (draftFilled && active instanceof HTMLElement && active.closest("#quick-composer")) {
          setComposerActive(false);
          active.blur();
          return;
        }
        if (interactions.hasSelection) {
          interactions.clearSelection();
          return;
        }
        // 关闭搜索框并清空搜索词，标签筛选保留。
        // 结束搜索：搜索框收起但还有搜索词（点放大镜收起时保留）时同样结束，回到原来的页签与滚动位置。
        if (searchOpen || searchText) {
          endSearch();
          // 焦点回到放大镜，接着按 Enter 或空格可以再搜（原型 toggleSearch(false)）。
          window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#header-search .search-toggle")?.focus());
          return;
        }
        if (selectedTag) {
          setSelectedTag("");
          return;
        }
        // 都没有，收起侧栏（手动收起，解除固定）。
        hideManually();
      }
      // 焦点不在卡片上时，↑ ↓ 与 Enter 作用于高亮的卡片（悬停高亮、编辑或菜单结束后），焦点随之落到卡片上。
      if (
        ["ArrowUp", "ArrowDown", "Enter"].includes(event.key) &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.isComposing &&
        currentId &&
        !editing &&
        !dialogOpen &&
        !contextMenu &&
        !sidebarMenu
      ) {
        const target = event.target instanceof Element ? event.target : null;
        const own = target?.closest(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="menu"], [role="listbox"], .note-card',
        );
        const card = listRef.current?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(currentId)}"]`);
        if (!own && card) {
          event.preventDefault();
          if (event.key === "Enter") {
            const note = store.getState().notes.find((item) => item.id === currentId);
            if (note) beginEdit(note);
          } else {
            const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".note-card") ?? []);
            const index = cards.indexOf(card);
            focusCard(cards[event.key === "ArrowDown" ? Math.min(cards.length - 1, index + 1) : Math.max(0, index - 1)]?.dataset.noteId);
          }
          return;
        }
      }
      // Shift+F10 一律打开空白处的侧栏菜单（T111，试验）；菜单键在有高亮的卡片时开卡片菜单，否则开侧栏菜单。
      // 指针在侧栏里时开在指针处，否则开在卡片（或焦点所在元素）左上角附近。输入框、编辑区与对话框里保留它们自己的菜单。
      if (
        (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !dialogOpen
      ) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], .modal')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const focusedCard = target?.closest<HTMLElement>(".note-card[data-note-id]") ?? null;
          const card =
            focusedCard ??
            (currentId ? listRef.current?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(currentId)}"]`) : null) ??
            null;
          const blankMenu = event.key === "F10";
          const note = card && !blankMenu ? store.getState().notes.find((item) => item.id === card.dataset.noteId) : undefined;
          const box = ((blankMenu ? listRef.current : card) ?? target ?? document.body).getBoundingClientRect();
          const anchor = pointerRef.current ?? { x: box.left + 24, y: box.top + 32 };
          if (note) {
            setCurrentId(note.id);
            openNoteMenu(note, anchor);
          } else {
            openSidebarMenu(anchor);
          }
          return;
        }
      }
      // 关闭全部记录窗口（应用内快捷键，默认 Alt+Shift+W）：侧栏与各记录窗口里都能用。
      if (matches(event, shortcuts, "closeWindows")) {
        event.preventDefault();
        void bridge.closeAllNoteWindows();
        return;
      }
      // Ctrl+, 打开设置窗口：侧栏获得焦点时响应，编辑中也可用。
      if (matches(event, shortcuts, "settings")) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("sidenotes:open-settings"));
      }
      if (matches(event, shortcuts, "search")) {
        event.preventDefault();
        openSearch();
      } else if (comboFromEvent(event) === "Ctrl+F") {
        // 搜索换成了别的按键时，Ctrl+F 也不交给 WebView 打开网页的查找栏。
        event.preventDefault();
      }
      // 新建记录：与原型一致，先提交正在进行的编辑，再聚焦顶部输入卡片。
      if (matches(event, shortcuts, "newNote")) {
        event.preventDefault();
        startNewNote();
      }
      // Ctrl+C：不在输入框或编辑区中、页面上也没有选中文字时复制卡片，见 copyHighlighted。
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "c" &&
        !window.getSelection()?.toString()
      ) {
        const target = event.target instanceof Element ? event.target : null;
        const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
        if (!typing && !dialogOpen && !contextMenu && !sidebarMenu) {
          event.preventDefault();
          void copyHighlighted();
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  });

  /** 单击卡片选中（获得焦点并高亮），供 Enter 编辑、Ctrl+C 复制；编辑改为双击。单击空白处取消选中。 */
  const handleListClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || interactions.isBusy() || interactions.isSelecting() || tagsExpandedId) return;
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>(".note-card");
      if (!card) {
        setCurrentId(null);
        return;
      }
      setCurrentId(card.dataset.noteId ?? null);
      if (target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
      if (card.classList.contains("is-editing")) return;
      // 按下时为避免选中文字阻止了默认行为，焦点不会自动移到卡片上。
      card.focus({ preventScroll: true });
    },
    [interactions, tagsExpandedId],
  );

  /** 键盘把焦点移到卡片上时同样选中这张卡片。 */
  const handleListFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.matches(".note-card")) setCurrentId(target.dataset.noteId ?? null);
  }, []);

  /**
   * 指针移到卡片上即选中这张卡片：单击与悬停共用同一个选中状态，只有一种高亮，
   * 高亮的就是 Ctrl+C 复制、Enter 编辑的那一张；指针离开卡片后保持最后选中的一张。
   * 拖动排序与框选期间不改动。
   */
  const handleListHover = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (interactions.isBusy()) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>(".note-card")?.dataset.noteId;
      if (id) setCurrentId((previous) => (previous === id ? previous : id));
    },
    [interactions],
  );

  /** 双击卡片开始编辑；多选与拖动之后的双击已由卡片手势拦下。 */
  const handleListDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || interactions.isBusy() || interactions.isSelecting() || tagsExpandedId) return;
      const target = event.target as HTMLElement;
      if (target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
      const card = target.closest<HTMLElement>(".note-card");
      if (!card || card.classList.contains("is-editing")) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      const note = store.getState().notes.find((item) => item.id === card.dataset.noteId);
      if (note) beginEdit(note);
    },
    [interactions, tagsExpandedId, beginEdit],
  );

  /** 卡片右键打开记录菜单，对应原型 note-menu.js 的 handleContextMenu；编辑区保留系统菜单。 */
  const handleListContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // 按住 Ctrl 右键：在卡片上也打开空白处的侧栏菜单（T111，试验），交给侧栏的右键处理。
      if (event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      const card = target.closest<HTMLElement>(".note-card");
      if (!card || target.closest('input,textarea,[contenteditable="true"]')) return;
      const note = store.getState().notes.find((item) => item.id === card.dataset.noteId);
      if (!note) return;
      event.preventDefault();
      if (dialogOpen || tagsExpandedId) return;
      // 与原型一致：打开菜单前先保存正在进行的编辑。
      if (editingRef.current) void commitEdit();
      setCurrentId(note.id);
      openNoteMenu(note, { x: event.clientX, y: event.clientY });
    },
    [dialogOpen, tagsExpandedId, commitEdit, openNoteMenu],
  );

  /* ==================== 空白处：右键菜单与双击收起展开 ==================== */

  /** 收起或展开当前列表中的全部卡片：有展开的就全部收起，否则全部展开；提示条提供撤销。 */
  const toggleCollapseAll = useCallback(
    async (collapse = listNotes.some((note) => !note.collapsed)) => {
      const ids = listNotes.filter((note) => note.collapsed !== collapse).map((note) => note.id);
      if (!ids.length) return;
      const undo = await store.setCollapsed(ids, collapse);
      if (!undo) {
        toast("操作未保存", null, true);
        return;
      }
      // 连续收起/展开全部只留最新的一条提示（DS-14）。
      toast(
        `已${collapse ? "收起" : "展开"} ${ids.length} 张卡片`,
        {
          label: "撤销",
          run: () => {
            void store.restoreNotes(undo);
          },
        },
        false,
        "collapse-all",
      );
    },
    [listNotes, toast],
  );

  /** 卡片、输入控件、按钮与浮层之外的位置算作空白处。 */
  const isBlank = useCallback(
    (target: EventTarget | null): boolean =>
      target instanceof Element &&
      !target.closest(
        '.note-card,button,a,input,textarea,select,[contenteditable="true"],[role="separator"],.sidebar-composer,.tag-dropdown,.workspace-nudge,.desktop-notice,.toast-region,.drag-trash-zone',
      ),
    [],
  );

  /**
   * 侧栏空白处右键：打开侧栏菜单，替代系统窗口菜单与浏览器菜单；输入框与编辑区保留系统菜单。
   * 按住 Ctrl 右键时在卡片上也打开侧栏菜单（T111，试验）：卡片排得紧凑，卡片之间的缝很难右键点中。
   */
  const handleSidebarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey) && target.closest(".note-card")) return;
      event.preventDefault();
      if (dialogOpen) return;
      openSidebarMenu({ x: event.clientX, y: event.clientY });
    },
    [dialogOpen, openSidebarMenu],
  );

  /** 双击空白处切换当前列表全部卡片的收起与展开。 */
  const handleSidebarDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || !isBlank(event.target) || interactions.isBusy() || dialogOpen) return;
      window.getSelection()?.removeAllRanges();
      void toggleCollapseAll();
    },
    [isBlank, interactions, dialogOpen, toggleCollapseAll],
  );


  /**
   * 卡片的键盘操作（interactions.md 3.2）：↑ ↓ 移动并高亮，Home、End 到两端，Enter 编辑，
   * Delete 移入回收站（不确认，可以撤销）。Shift+F10 与菜单键在文档级的按键处理里打开菜单。
   * 只处理焦点落在卡片本身的按键，卡片内的按钮与编辑区各自处理。
   */
  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const target = event.target as HTMLElement;
      if (!target.matches(".note-card") || target.classList.contains("is-editing")) return;
      const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".note-card") ?? []);
      const index = cards.indexOf(target);
      const note = store.getState().notes.find((item) => item.id === target.dataset.noteId);
      if (!note || index < 0) return;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
      const next =
        event.key === "ArrowDown"
          ? cards[Math.min(cards.length - 1, index + 1)]
          : event.key === "ArrowUp"
            ? cards[Math.max(0, index - 1)]
            : event.key === "Home"
              ? cards[0]
              : event.key === "End"
                ? cards[cards.length - 1]
                : null;
      if (next && plain) {
        event.preventDefault();
        focusCard(next.dataset.noteId);
        return;
      }
      if (event.key === "Enter" && plain && !event.shiftKey) {
        event.preventDefault();
        beginEdit(note);
        return;
      }
      if (event.key === "Delete" && plain) {
        event.preventDefault();
        setCurrentId(note.id);
        // 多选之中的卡片：作用于全部选中的记录（与原型 requestDelete 相同）。
        const ids = interactions.selected.has(note.id) && interactions.selected.size > 1 ? interactions.selected : new Set([note.id]);
        void moveToTrash(store.getState().notes.filter((item) => ids.has(item.id) && item.status !== "trash")).then((done) => {
          if (done && ids.size > 1) interactions.clearSelection();
        });
        return;
      }
    },
    [beginEdit, focusCard, moveToTrash, interactions],
  );

  const handleMenuCommand = useCallback(
    async (note: Note, command: MenuCommand, anchor?: MenuAnchor) => {
      setContextMenu(null);
      switch (command) {
        case "copy":
          await handleCopyNote(note);
          break;
        case "edit":
          beginEdit(note);
          break;
        case "collapse":
          await store.setCollapsed([note.id], !note.collapsed);
          break;
        case "pin":
          await store.updateNote(note.id, { pinned: !note.pinned });
          break;
        case "move":
          if (anchor) setMoveMenu({ note, anchor });
          break;
        case "locate":
          // 搜索结果的「转到」：切到这条记录所在的页签，滚到它并闪一下。
          goToTab(homeTab(note, store.getState().settings.pinnedTags), note.id);
          break;
        case "duplicate":
          if (await store.duplicateNote(note, tab)) toast("已创建副本");
          else toast("副本未创建", null, true);
          break;
        case "export": {
          const blob = new Blob([note.text], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `${(note.emoji || "") + parse(note.text).body.split("\n")[0].slice(0, 40)}.md`;
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
          toast("已导出 Markdown");
          break;
        }
        case "info":
          setInfoNote(note);
          break;
        case "trash": {
          // 多选之中的卡片：作用于全部选中的记录（与原型 note-menu.js 的 targetIds 相同）。
          const ids = interactions.selected.has(note.id) && interactions.selected.size > 1 ? interactions.selected : new Set([note.id]);
          if (await moveToTrash(store.getState().notes.filter((item) => ids.has(item.id) && item.status !== "trash"))) {
            interactions.clearSelection();
          }
          break;
        }
        case "merge":
          openMerge({ ids: selectedIds });
          break;
        case "merge-into":
          openMerge({ ids: selectedIds, target: note.id });
          break;
      }
    },
    [tab, beginEdit, handleCopyNote, moveToTrash, goToTab, toast, interactions, openMerge, selectedIds],
  );

  /** 空白处菜单的命令。 */
  const handleSidebarCommand = useCallback(
    (command: SidebarCommand) => {
      setSidebarMenu(null);
      switch (command) {
        case "new":
          startNewNote();
          break;
        case "search":
          openSearch();
          break;
        case "collapse-all":
          void toggleCollapseAll(true);
          break;
        case "expand-all":
          void toggleCollapseAll(false);
          break;
        case "select-all":
          interactions.selectAll();
          break;
        case "pin":
          togglePinned();
          break;
        case "edge":
          void store.updateSettings({ edge: state.settings.edge === "left" ? "right" : "left" });
          break;
        case "settings":
          window.dispatchEvent(new CustomEvent("sidenotes:open-settings"));
          break;
        case "guide":
          setGuideOpen(true);
          break;
        case "hide":
          hideManually();
          break;
      }
    },
    [startNewNote, openSearch, toggleCollapseAll, interactions, togglePinned, state.settings.edge, hideManually],
  );

  /**
   * 确认后把记录移入回收站，并在提示条中提供撤销，对应原型 requestDelete。
   * 保存失败时返回 false，确认对话框保持打开，记录原样保留。
   */
  const handleTaskToggle = useCallback(
    async (noteId: string, offset: number, checked: boolean) => {
      const note = state.notes.find((item) => item.id === noteId);
      if (!note || note.text[offset - 1] !== "[" || note.text[offset + 1] !== "]") return;
      const newText =
        note.text.slice(0, offset) + (checked ? "x" : " ") + note.text.slice(offset + 1);
      await store.commitEdit(noteId, newText, note.images);
    },
    [state.notes],
  );

  /* ==================== 附件 ==================== */

  // 记录变化（删除记录、清空回收站、更换附件等）一分钟后，清理不再被任何记录引用的附件副本；
  // 启动后半分钟先清理一次。只由侧栏窗口发起，避免三个窗口重复清理；本窗口尚未保存的编辑与
  // 新建卡片内容一并作为引用传入，刚导入的附件另有保护期（见 bridge.cleanupAttachments）。
  const cleanupStarted = useRef(false);
  useEffect(() => {
    if (!state.ready || state.loadFailed) return;
    const delay = cleanupStarted.current ? 60_000 : 30_000;
    cleanupStarted.current = true;
    const timer = window.setTimeout(() => {
      const extra = [editingRef.current?.text ?? "", store.getState().draft.text].filter(Boolean);
      void bridge.cleanupAttachments(extra).catch((error: unknown) => console.warn("附件清理失败", error));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.notes, state.ready, state.loadFailed]);

  // 每天自动为数据库创建一份快照（附件只增量备份一次）：启动一分钟后检查一次，之后每小时检查一次，
  // 距最新一份超过一天才创建。与附件清理一样只由侧栏窗口发起；失败时设置页的快照列表会提示目录不可用。
  useEffect(() => {
    if (!state.ready || state.loadFailed) return;
    const check = (): void => {
      void bridge
        .autoSnapshot(store.getState().settings.snapshotDirectory)
        .catch((error: unknown) => console.warn("自动快照失败", error));
    };
    const first = window.setTimeout(check, 60_000);
    const hourly = window.setInterval(check, 3_600_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(hourly);
    };
  }, [state.ready, state.loadFailed]);

  /**
   * 添加图片与引用文件（原型第二版：两者都写进正文）：用系统对话框选择文件，复制到应用数据目录中维护，
   * 按插入规则插在光标处（标签行始终在最后，见 core/insert）。记录只引用副本，原始文件移动或删除后引用仍然有效。
   */
  const referenceFiles = useCallback(
    async (target: "composer" | string, images = false) => {
      // 系统对话框打开期间侧栏失焦，不保存编辑也不收起；对话框关闭、窗口重新获得焦点后复位。
      choosingFiles.current = true;
      let markdown: string | null = null;
      try {
        const paths = await bridge.chooseFiles({ images });
        choosingFiles.current = false;
        if (paths?.length) {
          store.setPendingAttachments(1);
          try {
            markdown = referencesFor(await bridge.importFiles(paths));
          } finally {
            store.setPendingAttachments(-1);
          }
        }
      } catch (error) {
        const reason = bridge.errorText(error, "请稍后重试");
        toast(`${images ? "图片" : "文件"}未能插入：${reason}`, null, true);
        return;
      } finally {
        choosingFiles.current = false;
      }
      if (!markdown) return;
      const editor = target === "composer" ? composerEditorRef.current : editorRef.current;
      if (target !== "composer" && editingRef.current?.id !== target) return;
      if (editor) {
        editor.focus({ preventScroll: true });
        editor.insertAttachment(markdown);
      } else if (target === "composer") {
        const inserted = markdown;
        setComposerText((current) => placeAttachment(current, inserted, null).text);
      }
    },
    [toast],
  );

  const triggerFileInput = useCallback(
    (mode: "image" | "file", target: "composer" | string) => {
      void referenceFiles(target, mode === "image");
    },
    [referenceFiles],
  );

  /* ==================== 附件弹窗 ==================== */

  /** 包住附件弹窗里的系统对话框（选择文件、另存为）：打开期间侧栏失焦，不当作离开。 */
  const withSystemDialog = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    choosingFiles.current = true;
    try {
      return await run();
    } finally {
      choosingFiles.current = false;
    }
  }, []);

  /** 按住 Ctrl 点击附件：本机文件用系统程序打开，网络图片在浏览器中打开。 */
  const openAttachmentDirectly = useCallback(
    (target: string): Promise<void> =>
      openAttachment(target).catch((error: unknown) =>
        toast(bridge.errorText(error, "无法打开文件"), null, true),
      ),
    [toast],
  );

  /** 附件弹窗的修改写回编辑器（编辑中的卡片或新建卡片），记入编辑器的撤销历史。 */
  const editorReplacer = useCallback(
    (editor: MarkdownEditor | null, reference: ReferenceSpan) =>
      (next: string): boolean => {
        const result = editor ? replaceReference(editor.getValue(), reference, next) : null;
        if (!editor || !result) {
          toast("内容已变化，未能修改附件", null, true);
          return false;
        }
        return editor.applyEdit(
          { value: result.text, start: result.end, end: result.end },
          { start: reference.start, end: reference.end, direction: "none" },
        );
      },
    [toast],
  );

  /** 附件弹窗的修改直接写回记录（卡片预览），提示条提供撤销。 */
  const noteReplacer = useCallback(
    (noteId: string, reference: ReferenceSpan) =>
      async (next: string): Promise<boolean> => {
        const note = store.getState().notes.find((item) => item.id === noteId);
        const result = note ? replaceReference(note.text, reference, next) : null;
        if (!result) {
          toast("内容已变化，未能修改附件", null, true);
          return false;
        }
        const undo = await store.updateNotes([{ id: noteId, text: result.text }]);
        if (!undo) {
          toast(SAVE_FAILED_MESSAGE, null, true);
          return false;
        }
        // 与原型相同：删除图片写「已删除图片」，其余写「已删除附件」。
        const removed = reference.source.trimStart().startsWith("!") ? "已删除图片" : "已删除附件";
        toast(next ? "已修改附件" : removed, { label: "撤销", run: () => void store.restoreNotes(undo) });
        return true;
      },
    [toast],
  );

  /** 点击卡片正文中的附件：编辑中写回编辑器，预览时写回记录；按住 Ctrl 直接打开。 */
  const handleNoteAttachment = useCallback(
    (note: Note, reference: AttachmentReference, event: { ctrlKey: boolean; metaKey: boolean }) => {
      if (event.ctrlKey || event.metaKey) {
        void openAttachmentDirectly(reference.target);
        return;
      }
      const inEditor = editingRef.current?.id === note.id;
      setAttachmentDialog({
        subject: { kind: reference.kind, source: reference.source, target: reference.target, label: reference.label },
        replaceSource: inEditor ? editorReplacer(editorRef.current, reference) : noteReplacer(note.id, reference),
      });
    },
    [openAttachmentDirectly, editorReplacer, noteReplacer],
  );

  /** 点击新建卡片中的附件。 */
  const handleComposerAttachment = useCallback(
    (reference: EditorAttachment, event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey) {
        void openAttachmentDirectly(reference.target);
        return;
      }
      setAttachmentDialog({
        subject: { kind: reference.kind, source: reference.source, target: reference.target, label: reference.label },
        replaceSource: editorReplacer(composerEditorRef.current, reference),
      });
    },
    [openAttachmentDirectly, editorReplacer],
  );

  /** 点击以 data URL 保存的图片附件：编辑中改动编辑事务，预览时直接写回记录（可撤销），新建卡片改动草稿。 */
  const handleEmbeddedImage = useCallback(
    (owner: Note | null, image: NoteImage) => {
      const replaceImage = async (next: NoteImage | null): Promise<boolean> => {
        const swap = (images: NoteImage[]): NoteImage[] =>
          next ? images.map((item) => (item.id === image.id ? next : item)) : images.filter((item) => item.id !== image.id);
        if (!owner) {
          if (next) store.replaceDraftImage(image.id, next);
          else store.removeDraftImage(image.id);
          return true;
        }
        if (editingRef.current?.id === owner.id) {
          setEditing((prev) => (prev ? { ...prev, images: swap(prev.images) } : prev));
          return true;
        }
        const current = store.getState().notes.find((item) => item.id === owner.id);
        if (!current) return false;
        const undo = await store.updateNotes([{ id: owner.id, images: swap(current.images) }]);
        if (!undo) {
          toast(SAVE_FAILED_MESSAGE, null, true);
          return false;
        }
        toast(next ? "已更换图片" : "已删除图片", { label: "撤销", run: () => void store.restoreNotes(undo) });
        return true;
      };
      setAttachmentDialog({ subject: { kind: "embedded", image }, replaceImage });
    },
    [toast],
  );

  // 附件弹窗交给弹窗窗口（T99）：更换、删除与应用修改发回这里，按打开时确定的写回位置写入。
  useEffect(() => {
    if (!attachmentDialog || !windowDialogs) return;
    const dialog = attachmentDialog;
    const payload: AttachmentPayload = {
      subject: dialog.subject,
      canReplaceSource: Boolean(dialog.replaceSource),
      canReplaceImage: Boolean(dialog.replaceImage),
    };
    let id = 0;
    let alive = true;
    void dialogWindow
      .open(
        "attachment",
        payload,
        {
          "replace-source": (data: { source: string }) => (dialog.replaceSource ? dialog.replaceSource(data.source) : false),
          "replace-image": (data: { image: NoteImage | null }) => (dialog.replaceImage ? dialog.replaceImage(data.image) : false),
        },
        () => setAttachmentDialog((current) => (current === dialog ? null : current)),
      )
      .then((opened) => {
        id = opened;
        if (!alive) dialogWindow.close(opened);
      });
    return () => {
      alive = false;
      if (id) dialogWindow.close(id);
    };
  }, [attachmentDialog, windowDialogs, dialogWindow]);

  /* ==================== 标签筛选 ==================== */
  // 对应原型 selectTag：先结束正在进行的编辑，筛选后清空搜索，并记录访问作为菜单评分依据。
  const selectTag = useCallback(
    (tag: string) => {
      if (editing) void commitEdit();
      setSelectedTag(tag);
      setQuery("");
      setTagMenuOpen(false);
      void store.trackTagUsage(tag);
    },
    [editing, commitEdit],
  );

  /** 点卡片上的标签：平时按这个标签筛选；搜索时改搜这个标签（与原型 setSearchQuery 相同）。 */
  const filterByTag = useCallback(
    (tag: string) => {
      // 搜索时改搜这个标签，末尾带一个空格，接着就能输入别的词（原型 setSearchQuery）。
      if (searching) setSearchQuery(`#${tag} `);
      else selectTag(tag);
    },
    [searching, setSearchQuery, selectTag],
  );

  /* ==================== 标签整理态 ==================== */
  // 整理态（卡片上的标签带 ×）时按在整理区之外：先退出整理态，这一下不再触发别的操作（原型 exitTagsFirst）。
  // 改名框失焦时自己提交或放弃。
  useEffect(() => {
    if (!tagsExpandedId) return;
    let swallowClick = false;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".note-tags.tags-expanded, .tag-suggestions, .floating-panel")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      swallowClick = true;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTagsExpandedId(null);
    };
    const onClick = (event: MouseEvent): void => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [tagsExpandedId]);

  /* ==================== 记录窗口（T83） ==================== */
  // 记录窗口关闭时缩回侧栏中的卡片：它来问卡片在屏幕上的位置（侧栏收起或卡片不在视野里时回答 null，窗口原地淡出），
  // 缩回之后卡片轻轻一顿（原型 land）。记录窗口里点标签时，侧栏按这个标签筛选并展开。
  const filterByTagRef = useRef(filterByTag);
  const currentLayoutRef = useRef(currentLayout);
  useLayoutEffect(() => {
    filterByTagRef.current = filterByTag;
    currentLayoutRef.current = currentLayout;
  });
  useEffect(() => {
    const EVENTS = bridge.NOTE_WINDOW_EVENTS;
    /** 侧栏列表中看得见的卡片（原型 cardElement）。 */
    const visibleCard = (id: string): HTMLElement | null => {
      const list = listRef.current;
      const card = list?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(id)}"]`);
      if (!list || !card) return null;
      const rect = card.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      return rect.width && rect.bottom > bounds.top && rect.top < bounds.bottom ? card : null;
    };
    return bridge.subscribeAll([
      bridge.onWindowEvent<{ id: string; reply: string }>(EVENTS.cardRectRequest, (request) => {
        void (async () => {
          let rect: bridge.PixelRect | null = null;
          const card = visibleCard(request.id);
          if (card && (await bridge.isWindowVisible())) {
            const box = card.getBoundingClientRect();
            const origin = await bridge.innerOrigin();
            const ratio = window.devicePixelRatio;
            rect = { x: origin.x + box.left * ratio, y: origin.y + box.top * ratio, width: box.width * ratio, height: box.height * ratio };
          }
          void bridge.emitToWindow(request.reply, EVENTS.cardRect, { id: request.id, rect });
        })();
      }),
      bridge.onWindowEvent<string>(EVENTS.land, (id) => {
        const card = visibleCard(id);
        if (!card || typeof card.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const root = window.getComputedStyle(document.documentElement);
        const token = root.getPropertyValue("--sn-duration-normal").trim();
        const normal = (token.endsWith("ms") ? parseFloat(token) : parseFloat(token) * 1000) || 167;
        card.animate([{ transform: "none" }, { offset: 0.4, transform: "scale(1.015)" }, { transform: "none" }], {
          duration: normal * 2,
          easing: root.getPropertyValue("--sn-ease-standard").trim() || "ease",
        });
      }),
      bridge.onWindowEvent<string>(EVENTS.filterTag, (tag) => {
        filterByTagRef.current(tag);
        void bridge.showSidebar(currentLayoutRef.current());
      }),
      bridge.onWindowEvent<string | null>(EVENTS.peek, (id) => setPeekId(id)),
    ]);
  }, []);

  // 全文浮窗开着时，每一帧看一下它所附着的卡片在哪里（列表滚动、卡片变高、侧栏改宽都会挪动卡片），
  // 变了才告诉后端，连线跟着卡片走；卡片滚出列表时报告看不见，连线收起。
  useEffect(() => {
    if (!peekId || !bridge.isDesktop()) return;
    let frame = 0;
    let last = "";
    const tick = (): void => {
      frame = window.requestAnimationFrame(tick);
      const list = listRef.current;
      const card = list?.querySelector<HTMLElement>(`.note-card[data-note-id="${CSS.escape(peekId)}"]`);
      let rect: bridge.PixelRect | null = null;
      if (list && card) {
        const box = card.getBoundingClientRect();
        const bounds = list.getBoundingClientRect();
        const top = Math.max(box.top, bounds.top);
        const bottom = Math.min(box.bottom, bounds.bottom);
        if (box.width && bottom - top > 1) rect = { x: box.left, y: top, width: box.width, height: bottom - top };
      }
      const key = rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}` : "none";
      if (key === last) return;
      last = key;
      void bridge.reportPeekCard(rect);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [peekId]);

  const clearTagFilter = useCallback(() => {
    setSelectedTag("");
    setTagMenuOpen(false);
  }, []);

  /** 清除筛选：同时清除标签与搜索并收起搜索框，空状态的「清除筛选」与筛选条的「显示全部」共用。 */
  const clearFilters = useCallback(() => {
    setSelectedTag("");
    setQuery("");
    setSearchOpen(false);
  }, []);

  const manageTag = useCallback((tag: string) => {
    setTagMenuOpen(false);
    setManagingTag(tag);
  }, []);

  // 菜单底部「搜索」：打开搜索并预填 #，光标停在 # 之后，继续输入即按标签查找。
  const searchTags = useCallback(() => {
    setTagMenuOpen(false);
    setSearchOpen(true);
    setQuery("#");
    window.setTimeout(() => {
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      input?.focus();
      input?.setSelectionRange(1, 1);
    }, 50);
  }, []);

  /* ==================== 渲染 ==================== */

  // 新建卡片在列表之外，右侧要让出列表滚动条的宽度才能与记录卡片对齐。
  // 滚动条宽度随系统与缩放变化，这里实测后写入 CSS 变量。
  useLayoutEffect(() => {
    const list = listRef.current;
    const aside = asideRef.current;
    if (!list || !aside) return;
    const measure = (): void => {
      aside.style.setProperty("--note-list-gutter", `${Math.max(0, list.offsetWidth - list.clientWidth)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  /** 「移到…」可去的页签：随记与固定的标签页签，当前页签除外（搜索时是这条记录所在的页签除外）；置顶有自己的菜单项。 */
  const moveTargets = useCallback(
    (note: Note) => {
      const here = searching ? homeTab(note, pinnedTags) : tab;
      return (["workspace", ...pinnedTags.map(tabOfTag)] as TabKey[]).filter((item) => item !== here);
    },
    [pinnedTags, searching, tab],
  );
  // 条数只写在随记与当前页签上。
  const workspaceCount = useMemo(() => tabCount(state.notes, "workspace", pinnedTags), [state.notes, pinnedTags]);
  const currentCount = useMemo(() => tabCount(state.notes, tab, pinnedTags), [state.notes, tab, pinnedTags]);
  // 筛选行后面的操作：搜的词正好是已有标签时改搜它；按一个标签筛选或只搜一个已有标签时可以固定为页签。
  const wordMatch = useMemo(() => (searching ? wordTag(query, state.notes) : null), [searching, query, state.notes]);
  const filterTag = searching ? singleSearchTag(query, state.notes) : selectedTag;
  // 收起/展开全部按当前列表决定：还有展开的卡片时收起全部，全部收起后展开全部（原型 syncListTools）。
  const collapseNext = listNotes.some((note) => !note.collapsed);

  // 底部存储状态：读库失败与写入失败都显示为异常。
  const storageError = state.loadFailed || state.saveFailed;
  const storageStatus = state.loadFailed ? "未能读取本地记录" : state.saveFailed ? "本地保存失败" : "本地已保存";

  return (
    <>
      <IconSprite />
      <aside
        ref={asideRef}
        className={["sidebar open", editing ? "has-editing" : "", searching ? "is-search-results" : ""].filter(Boolean).join(" ")}
        data-edge={state.settings.edge}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
        onContextMenu={handleSidebarContextMenu}
        onDoubleClick={handleSidebarDoubleClick}
        onMouseDown={(event) => {
          // 双击空白处用于收起展开全部卡片，不选中其中的文字。
          if (event.detail > 1 && isBlank(event.target)) event.preventDefault();
        }}
      >
        {/* 拖动宽度手柄 */}
        <div
          id="sidebar-resizer"
          className={resizerArmed ? "sidebar-resizer is-armed" : "sidebar-resizer"}
          data-edge={state.settings.edge}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          aria-valuemin={WIDTH_RANGE.min}
          aria-valuemax={WIDTH_RANGE.max}
          aria-valuenow={state.settings.width}
          tabIndex={0}
          onPointerEnter={handleResizerEnter}
          onPointerLeave={handleResizerLeave}
          onKeyDown={handleResizerKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />

        <header className="sidebar-header">
          <div
            className="sidebar-brand"
            onDoubleClick={(event) => {
              // 双击标题区的品牌：列表滚回顶部（原型第二版）。
              if ((event.target as Element).closest("button")) return;
              event.preventDefault();
              window.getSelection()?.removeAllRanges();
              const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
              listRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
            }}
          >
            {/* 品牌标记就是应用图标，配色固定，不随主题变化（components.md 第七节）。 */}
            <img className="brand-mark" src={appIcon} alt="" aria-hidden="true" />
            <h2>SideNotes</h2>
          </div>
          <div className="window-actions">
            <button
              id="sidebar-lock"
              type="button"
              className={`icon-button${pinned ? " is-pinned" : ""}${(settingsOpen || windowDialogOpen) && !pinned ? " is-linked" : ""}`}
              data-action="lock-sidebar"
              aria-pressed={pinned || settingsOpen || windowDialogOpen}
              aria-label={pinned ? "取消固定侧栏" : "固定侧栏"}
              onClick={togglePinned}
            >
              <Icon name="pin" />
            </button>
            <button
              id="sidebar-close"
              type="button"
              className="icon-button"
              data-action="hide-sidebar"
              aria-label="收起侧栏"
              aria-keyshortcuts="Escape"
              onClick={hideManually}
            >
              <Icon name={state.settings.edge === "left" ? "arrow-left" : "arrow-right"} />
            </button>
          </div>
        </header>

        {/* 导航：页签 + 搜索切换 */}
        <div
          className={`sidebar-navigation${query ? " has-search-query" : ""}${searchOpen ? " is-searching" : ""}`}
        >
          <SidebarTabs
            ref={tabsRef}
            tab={tab}
            searching={searching}
            notes={state.notes}
            pinnedTags={pinnedTags}
            workspaceCount={workspaceCount}
            currentCount={currentCount}
            dragTab={interactions.dragTab}
            onSelect={switchTab}
            onPin={pinTag}
            onUnpin={unpinTag}
            onRename={renamePinnedTag}
            onManage={(tag) => setManagingTag(tag)}
            onReorder={savePinnedTags}
            onPopupChange={setTabsPopup}
            covered={searchOpen}
          />
          <div
            id="header-search"
            className={`header-search${searchOpen ? " is-open" : ""}${query ? " has-query" : ""}`}
          >
            {" "}
            <button
              type="button"
              className={`icon-button search-toggle${searchOpen ? " is-active" : ""}`}
              aria-label={`搜索全部记录 · ${searchKeys}`}
              aria-controls="search-panel"
              aria-expanded={searchOpen}
              onClick={() => {
                // 与原型 toggleSearch 相同：收起时保留搜索词与结果，再点一次回到搜索框。
                const next = !searchOpen;
                setSearchOpen(next);
                if (next) {
                  window.setTimeout(() => {
                    const input = document.getElementById("search-input") as HTMLInputElement | null;
                    input?.focus();
                    input?.select();
                  }, 50);
                }
              }}
            >
              <Icon name="search" />
            </button>
            <div
              id="search-panel"
              className="header-search-field"
              aria-hidden={!searchOpen}
              inert={!searchOpen || undefined}
            >
              <label htmlFor="search-input" className="sr-only">
                搜索全部记录与标签
              </label>
              {/* 输入 #标签 时以灰字联想已有标签，Tab 选用；不再展开标签菜单。 */}
              <TagInput
                id="search-input"
                type="search"
                placeholder={SEARCH_PLACEHOLDER}
                autoComplete="off"
                search
                value={query}
                onValueChange={setQuery}
                onBlur={(event) => {
                  // 失焦时没有搜索词就收起；有搜索词时保持展开，结果留在列表中（只写了 # 不算搜索词）。
                  if (
                    !searchText &&
                    !event.currentTarget
                      .closest("#header-search")
                      ?.contains(event.relatedTarget as Node | null)
                  ) {
                    setSearchOpen(false);
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="清空搜索"
                  onClick={() => {
                    // 与原型相同：清空搜索词，搜索框留着、焦点回到输入框；列表回到原来的页签与标签筛选。
                    setQuery("");
                    document.getElementById("search-input")?.focus();
                  }}
                >
                  <Icon name="x" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* 筛选行（原型 renderFilterRow）：左边写列表里是什么——有选中的卡片时是「已选 N 条」，搜索时是结果条数，平时是标签下拉；
            后面是这时能做的操作：选中时「合并」「移入回收站」；搜的词正好是已有标签时「#开发 N 条」改搜这个标签；
            按一个标签筛选或只搜一个已有标签时「固定为页签」（还没固定时）与「合并」（两条以上时）。
            右边是对整个列表的操作：多选与收起/展开全部。 */}
        <div ref={setTopline} className="list-topline">
          <div className="list-filter">
            {selectedIds.length ? (
              <span id="selection-summary" className="search-summary selection-summary">{`已选 ${selectedIds.length} 条`}</span>
            ) : searching ? (
              <span id="search-summary" className="search-summary">{`${listNotes.length} 条`}</span>
            ) : (
              <TagFilter
                tab={tab}
                selectedTag={selectedTag}
                total={currentCount}
                filteredCount={listNotes.length}
                open={tagMenuOpen}
                onOpenChange={setTagMenuOpen}
                onSelect={selectTag}
                onClear={clearTagFilter}
                onManage={manageTag}
                onSearch={searchTags}
                menuHost={topline}
              />
            )}
            <p id="list-summary">
              {selectedIds.length ? (
                <>
                  {selectedIds.length > 1 ? (
                    <button
                      type="button"
                      className="list-summary-action"
                      data-action="merge-selection"
                      onClick={() => openMerge({ ids: selectedIds })}
                    >
                      合并
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="list-summary-action"
                    data-action="trash-selection"
                    onClick={() => {
                      void moveToTrash(state.notes.filter((note) => selectedIds.includes(note.id))).then((done) => {
                        if (done) interactions.clearSelection();
                      });
                    }}
                  >
                    移入回收站
                  </button>
                </>
              ) : null}
              {!selectedIds.length && wordMatch ? (
                <button
                  type="button"
                  className="list-summary-action word-tag-action"
                  data-action="search-word-tag"
                  data-tag={wordMatch.tag}
                  aria-label={`改搜标签 #${wordMatch.tag}，${wordMatch.count} 条`}
                  onClick={() => setSearchQuery(`#${wordMatch.tag}`)}
                >
                  <span className="word-tag-name">{`#${wordMatch.tag}`}</span>
                  <span className="word-tag-count">{`${wordMatch.count} 条`}</span>
                </button>
              ) : null}
              {!selectedIds.length && filterTag && !findPinned(pinnedTags, filterTag) ? (
                <button
                  type="button"
                  className="list-summary-action"
                  data-action="pin-filter-tag"
                  data-tag={filterTag}
                  onClick={() => pinTag(filterTag)}
                >
                  固定为页签
                </button>
              ) : null}
              {!selectedIds.length && filterTag && listNotes.length > 1 ? (
                <button
                  type="button"
                  className="list-summary-action"
                  data-action="merge-filtered"
                  data-tag={filterTag}
                  aria-label={`合并这 ${listNotes.length} 条`}
                  onClick={() => openMerge({ ids: listNotes.map((note) => note.id), tag: filterTag })}
                >
                  合并
                </button>
              ) : null}
            </p>
          </div>
          <div className="list-tools">
            <button
              id="select-mode"
              type="button"
              className="icon-button list-tool"
              data-action="toggle-select-mode"
              aria-pressed={interactions.selecting}
              aria-label={interactions.selecting ? "退出多选" : "多选"}
              onClick={interactions.toggleMode}
            >
              <Icon name="check-square" />
            </button>
            <button
              id="collapse-all"
              type="button"
              className="icon-button list-tool"
              data-action="toggle-collapse-all"
              aria-label={collapseNext ? "收起全部卡片" : "展开全部卡片"}
              disabled={!listNotes.length}
              onClick={() => void toggleCollapseAll()}
            >
              <Icon name={collapseNext ? "fold" : "unfold"} />
            </button>
          </div>
        </div>

        {/* 读库或保存失败提示：读库失败时已暂停保存，导出备份也没有意义。 */}
        {state.loadFailed || state.saveFailed ? (
          <div className="desktop-notice is-error">
            <Icon name="alert" />
            {state.loadFailed ? "未能读取本地记录，已暂停保存，以免覆盖已有数据" : "本地存储不可用，请导出备份后重试"}
          </div>
        ) : null}

        {/* 整理提醒：记录超过设置的条数时提醒整理（固定为页签或合并成一条），可以稍后再说。与原型相同，在筛选行之下。 */}
        {nudgeVisible ? (
          <div id="workspace-nudge" className="workspace-nudge">
            <Icon name="info" />
            <span>{`${state.notes.filter((note) => note.status === "active").length} 条记录，建议整理。`}</span>
            <button
              type="button"
              className="nudge-link"
              data-action="tidy-workspace"
              onClick={() => {
                switchTab("workspace");
                toast("可以把同一类的记录固定为页签，或合并成一条。");
              }}
            >
              查看
            </button>
            <button
              type="button"
              className="nudge-link"
              data-action="snooze-tidy"
              onClick={() => {
                void store.updateSettings({ tidySnoozeUntil: Date.now() + 7 * 86_400_000 });
                setNudgeDismissed(true);
              }}
            >
              稍后
            </button>
            <button
              type="button"
              className="icon-button"
              data-action="tidy-settings"
              aria-label="设置"
              onClick={() => window.dispatchEvent(new CustomEvent("sidenotes:open-settings"))}
            >
              <Icon name="settings" />
            </button>
          </div>
        ) : null}

        {/* 新建卡片固定在列表之上，独占顶部区域，不随列表滚动；左右边距与记录卡片对齐。 */}
        <Composer
          text={composerText}
          images={state.draft.images}
          busy={state.pendingAttachments > 0}
          onChange={setComposerText}
          onReady={(editor) => {
            composerEditorRef.current = editor;
          }}
          onFocus={() => setComposerActive(true)}
          onSave={() => void saveComposer()}
          tabTag={draftTag}
          onSkipTag={() => setSkipTag(tabTag)}
          onAttachImage={() => triggerFileInput("image", "composer")}
          onAttachFile={() => triggerFileInput("file", "composer")}
          onRemoveImage={(id) => store.removeDraftImage(id)}
          onAttachment={handleComposerAttachment}
          onEmbeddedImage={(image) => handleEmbeddedImage(null, image)}
          maxHeight={Math.min(340, window.innerHeight * 0.42)}
        />

        {/* 记录列表 */}
        <div
          ref={listRef}
          id="note-list"
          className={["note-list", editing ? "has-editing" : "", interactions.selecting ? "is-selecting" : ""].filter(Boolean).join(" ")}
          tabIndex={-1}
          role="list"
          aria-label={`${tabName(tab)}记录列表`}
          onClick={handleListClick}
          onScroll={rememberScroll}
          onFocus={handleListFocus}
          onMouseOver={handleListHover}
          onDoubleClick={handleListDoubleClick}
          onContextMenu={handleListContextMenu}
          onKeyDown={handleListKeyDown}
        >
          {listNotes.length === 0 ? (
            <div className="empty-state">
              <h3>{searching || selectedTag ? "没有匹配的记录" : "暂无记录"}</h3>
              <p>{searching ? "搜索的是全部记录，换个词试试。" : selectedTag ? "调整标签筛选。" : "在上方直接输入。"}</p>
              {searching ? (
                <button type="button" className="button secondary" data-action="end-search" onClick={endSearch}>
                  清除搜索
                </button>
              ) : selectedTag ? (
                <button
                  type="button"
                  className="button secondary"
                  data-action="clear-filters"
                  aria-label="清除筛选"
                  onClick={clearFilters}
                >
                  清除筛选
                </button>
              ) : null}
            </div>
          ) : (
            renderedNotes.map((note) => (
              // 搜索结果按页签分组：每组第一条之前写组标题（Fragment 让卡片的位置不随组标题变化）。
              <Fragment key={note.id}>
              {searching && groupStarts.has(note.id) ? (
                <SearchGroupHeader group={groupStarts.get(note.id)!} onGo={(next) => goToTab(next)} />
              ) : null}
              <NoteCard
                note={note}
                editing={editing}
                current={currentId === note.id}
                tabStop={tabStopId === note.id}
                located={locatedId === note.id}
                selected={interactions.selected.has(note.id)}
                menuOpen={contextMenu?.note.id === note.id}
                itemTarget={interactions.itemTargetId === note.id || fileDrop.targetId === note.id}
                editAutoFocus={dragEditId !== note.id}
                tagsExpanded={tagsExpandedId === note.id}
                sortPending={interactions.pendingId === note.id}
                sorting={interactions.sortingId === note.id}
                sortingMember={interactions.memberIds.has(note.id)}
                dropHint={
                  interactions.drop?.id === note.id ? (interactions.drop.after ? "after" : "before") : null
                }
                onEditChange={(text) => setEditing((prev) => (prev ? { ...prev, text } : prev))}
                onEditReady={(editor) => {
                  editorRef.current = editor;
                  // 进入编辑时光标在正文末尾、标签行之前（原型第二版 bodyEnd），接着写正文；
                  // 编辑区有滚动条时滚到光标处（排好版之后再滚）。
                  const end = bodyEnd(editor.getValue());
                  editor.setSelectionRange(end, end);
                  window.requestAnimationFrame(() => editor.revealCaret());
                }}
                onEditBlur={handleEditBlur}
                onFinishEdit={() => void commitEdit()}
                onCancelEdit={cancelEdit}
                onRemoveEditImage={(id) =>
                  setEditing((prev) =>
                    prev
                      ? { ...prev, images: prev.images.filter((image) => image.id !== id) }
                      : prev,
                  )
                }
                onAttachEditImage={() => triggerFileInput("image", note.id)}
                onAttachEditFile={() => triggerFileInput("file", note.id)}
                onChooseEmoji={() => setEmojiTarget(note)}
                onToggleCollapse={() => void store.setCollapsed([note.id], !note.collapsed)}
                onCopy={() => void handleCopyNote(note)}
                onTogglePin={() => void store.updateNote(note.id, { pinned: !note.pinned })}
                onMore={(anchor) => openNoteMenu(note, anchor)}
                onFilterTag={filterByTag}
                onRemoveTag={async (tag) => {
                  // 去掉最后一个标签后记录没有正文也没有图片时，留下标签名作为正文（原型 removeNoteTag）。
                  let newText = removeTag(note.text, tag);
                  if (!newText.trim() && !note.images.length) newText = tag;
                  if (await store.commitEdit(note.id, newText, note.images)) toast(`已从此记录移除 #${tag}`);
                  else toast("标签未保存，请重试", null, true);
                }}
                onRenameTag={async (tag, next) => {
                  const parsed = parse(note.text);
                  const newTags = parsed.tags.map((item) =>
                    tagKey(item) === tagKey(tag) ? next : item,
                  );
                  const newText = canonicalize(
                    parsed.body + "\n\n" + newTags.map((t) => `#${t}`).join(" "),
                  );
                  await store.commitEdit(note.id, newText, note.images);
                }}
                onToggleTagsExpanded={() =>
                  setTagsExpandedId((prev) => (prev === note.id ? null : note.id))
                }
                onEnterTagsExpanded={() => setTagsExpandedId(note.id)}
                onInvalidTag={() => toast("标签使用文字、数字、下划线或短横线，最多40字", null, true)}
                onAttachment={(reference, event) => handleNoteAttachment(note, reference, event)}
                onEmbeddedImage={(image) => handleEmbeddedImage(note, image)}
                onTaskToggle={(offset, checked) => void handleTaskToggle(note.id, offset, checked)}
                peeked={peekId === note.id}
                onExpand={(card, collapse) => {
                  if (collapse) {
                    void bridge.collapsePeek(note.id);
                    return;
                  }
                  void bridge.openNoteWindow([note.id], card.getBoundingClientRect()).catch((error: unknown) => {
                    toast(`未能打开窗口：${bridge.errorText(error)}`, null, true);
                  });
                }}
              />
              </Fragment>
            ))
          )}
          {hasMore ? (
            <div ref={loadMoreRef} className="load-more-sentinel" role="status">
              <span className="load-more-status">{`已显示 ${renderedNotes.length} / ${listNotes.length} 条`}</span>
              <button
                type="button"
                className="load-more-button"
                data-action="load-more"
                aria-label="加载更多"
                onClick={() => setLoaded({ key: viewKey, count: loadedCount + pageSize })}
              >
                加载更多
              </button>
            </div>
          ) : null}
        </div>

        {/* 底部状态栏 */}
        <footer className="sidebar-footer">
          {/* 正常时不显示状态；出错时版本号左边出现警告图标与原因。 */}
          <span
            id="storage-status"
            className={storageError ? "storage-status is-error" : "storage-status"}
            aria-label={storageStatus}
            hidden={!storageError}
          >
            {storageError ? (
              <>
                <Icon name="alert" />
                {storageStatus}
              </>
            ) : null}
          </span>
          <button
            id="app-version"
            type="button"
            className="version-button"
            data-action="show-changelog"
            aria-label={`版本 ${__APP_VERSION__}，查看更新日志`}
            onClick={() => setChangelogOpen(true)}
          >
            <span className="version-label">{`v${__APP_VERSION__}`}</span>
            {/* 检查更新尚未接入，角标不显示。 */}
            <span className="update-badge" aria-hidden="true" hidden>
              <Icon name="arrow-up" />
            </span>
          </button>
          <span className="footer-right">
            <button
              id="settings-button"
              type="button"
              className="icon-button"
              data-action="settings"
              aria-label="设置"
              aria-keyshortcuts="Control+Comma"
              onClick={() => window.dispatchEvent(new CustomEvent("sidenotes:open-settings"))}
            >
              <Icon name="settings" />
            </button>
          </span>
        </footer>

        {/* 拖动时出现的回收站投放区，对应原型 mountDragTargets。 */}
        <div
          ref={trashRef}
          id="drag-trash-zone"
          className="drag-trash-zone"
          role="status"
          aria-label="拖放到这里移入回收站"
          aria-hidden={!interactions.sorting}
        >
          <Icon name="trash" />
          <span className="drag-trash-label">移入回收站</span>
        </div>

        <ToastRegion />
      </aside>

      {/* 隐藏文件选择器 */}

      {/* 图片预览 */}
      {/* 附件弹窗：查看与修改引用、更换、打开、另存为或删除 */}
      {attachmentDialog && !windowDialogs ? (
        <AttachmentDialog
          subject={attachmentDialog.subject}
          onReplaceSource={attachmentDialog.replaceSource}
          onReplaceImage={attachmentDialog.replaceImage}
          withSystemDialog={withSystemDialog}
          onClose={() => setAttachmentDialog(null)}
        />
      ) : null}

      {/* 记录信息（卡片菜单） */}
      {infoNote ? (
        <Modal title="记录信息" className="note-info-modal" onClose={closeInfo}>
          {[
            ["创建时间", new Date(infoNote.createdAt).toLocaleString("zh-CN", { hour12: false })],
            ["修改时间", new Date(infoNote.updatedAt).toLocaleString("zh-CN", { hour12: false })],
            ["正文长度", `${infoNote.text.length} 字`],
            ["图片附件", `${infoNote.images.length} 张`],
            ["位置", notePlace(infoNote, pinnedTags)],
            ["标识", infoNote.id],
          ].map(([label, value]) => (
            <div key={label} className="info-row">
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </Modal>
      ) : null}

      {/* 卡片上下文菜单 */}
      {contextMenu ? (
        <NoteMenu
          key={contextMenu.key}
          note={contextMenu.note}
          anchor={contextMenu.anchor}
          canMove={moveTargets(contextMenu.note).length > 0}
          locateLabel={searching ? `转到${tabLabel(homeTab(contextMenu.note, pinnedTags))}` : undefined}
          mergeCount={interactions.selected.has(contextMenu.note.id) ? selectedIds.length : 0}
          onCommand={(command) => void handleMenuCommand(contextMenu.note, command, contextMenu.anchor)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {/* 卡片菜单「移到…」：与把卡片拖到页签上相同，多选时作用于全部选中的记录。 */}
      {moveMenu ? (
        <ContextMenu<TabKey>
          entries={moveTargets(moveMenu.note).map((destination) => ({
            command: destination,
            label: tabName(destination),
            icon: destination === "workspace" ? "note" : "hash",
          }))}
          anchor={moveMenu.anchor}
          label="移到页签"
          onCommand={(destination) => {
            const { note } = moveMenu;
            setMoveMenu(null);
            const ids = interactions.selected.has(note.id) && interactions.selected.size > 1 ? Array.from(interactions.selected) : [note.id];
            void moveToTab(ids, destination, searching ? "home" : undefined).then((done) => {
              if (done) interactions.clearSelection();
            });
          }}
          onClose={() => setMoveMenu(null)}
        />
      ) : null}

      {/* 空白处的侧栏菜单 */}
      {sidebarMenu ? (
        <SidebarMenu
          key={sidebarMenu.key}
          anchor={sidebarMenu.anchor}
          count={listNotes.length}
          hasExpanded={listNotes.some((note) => !note.collapsed)}
          pinned={pinned}
          edge={state.settings.edge}
          onCommand={handleSidebarCommand}
          onClose={() => setSidebarMenu(null)}
        />
      ) : null}

      {/* Emoji 选择器 */}
      {emojiTarget ? (
        <EmojiPicker
          note={emojiTarget}
          notes={state.notes}
          onClose={() => setEmojiTarget(null)}
          onChoose={async (emoji) => {
            await store.updateNote(emojiTarget.id, { emoji });
            setEmojiTarget(null);
          }}
        />
      ) : null}

      {/* 版本与更新：对应原型版号按钮的 show-changelog */}
      {changelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}

      {/* 使用指南：首次启动显示一次，侧栏菜单可再次打开 */}
      {guideVisible ? <UsageGuide onClose={closeGuide} /> : null}

      {/* 标签管理：重命名或合并、全局移除 */}
      {mergeRequest && !windowDialogs ? (
        <MergeDialog
          notes={mergeRequest.notes}
          target={mergeRequest.target}
          tag={mergeRequest.tag}
          onConfirm={(text, images, keep) => commitMerge(mergeRequest, text, images, keep)}
          onClose={() => setMergeRequest(null)}
        />
      ) : null}

      {managingTag ? (
        <TagManageDialog
          tag={managingTag}
          onClose={() => setManagingTag(null)}
          onRenamed={(next) => {
            if (selectedTag && tagKey(selectedTag) === tagKey(managingTag)) setSelectedTag(next);
            if (tagKey(tagOfTab(tab)) === tagKey(managingTag)) setTab(tabOfTag(next));
            setManagingTag(null);
          }}
          onRemoved={() => {
            if (selectedTag && tagKey(selectedTag) === tagKey(managingTag)) setSelectedTag("");
            setManagingTag(null);
          }}
        />
      ) : null}
    </>
  );
}

/** 搜索结果的组标题（原型 renderSearchGroup）：页签的图标、名称与条数，右侧「转到」切到这个页签并结束搜索。 */
function SearchGroupHeader({ group, onGo }: { group: SearchGroup; onGo: (tab: TabKey) => void }) {
  return (
    <div className="search-group" data-group-tab={group.tab}>
      <span className="search-group-title">
        <Icon name={group.tab === "pinned" ? "pin" : group.tab === "workspace" ? "note" : "hash"} />
        <span className="search-group-name">{tabName(group.tab)}</span>
        <span className="search-group-count">{String(group.notes.length)}</span>
      </span>
      <button
        type="button"
        className="search-group-go"
        data-action="go-to-tab"
        data-go-tab={group.tab}
        aria-label={`转到${tabLabel(group.tab)}`}
        onClick={() => onGo(group.tab)}
      >
        <span>转到</span>
        <Icon name="arrow-right" />
      </button>
    </div>
  );
}
