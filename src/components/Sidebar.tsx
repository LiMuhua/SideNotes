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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icon, IconSprite } from "./Icon";
import { Composer } from "./Composer";
import { NoteCard } from "./NoteCard";
import { NoteMenu, type MenuAnchor, type MenuCommand } from "./NoteMenu";
import { SidebarMenu, type SidebarCommand } from "./SidebarMenu";
import { TagInput } from "./TagInput";
import { EmojiPicker } from "./EmojiPicker";
import { TagFilter } from "./TagFilter";
import { TagManageDialog } from "./TagManageDialog";
import { ChangelogDialog } from "./ChangelogDialog";
import { ConfirmDialog, ImagePreview, ToastRegion } from "./Modal";
import { useStore } from "../hooks/useStore";
import { useToast } from "../hooks/useToast";
import { useCardInteractions, type ItemDrop } from "../hooks/useCardInteractions";
import * as store from "../core/store";
import * as bridge from "../core/bridge";
import { matchesQuery, shouldNudgeTidy, inTab, compareNoteOrder } from "../core/notes";
import { moveImage, moveReference } from "../core/transfer";
import { chooseAndImportFiles } from "../core/attachments";
import { parse, removeTag, tagKey, canonicalize } from "../core/tags";
import type { EditSession, Note, NoteImage, TabKey } from "../core/types";
import type { MarkdownEditor } from "../core/editor";

const TAB_LABELS: Record<TabKey, string> = {
  workspace: "工作区",
  pinned: "置顶",
  archive: "归档",
};

/** 修改记录写入失败时的提示，沿用原型 updateNote 的文案。 */
const SAVE_FAILED_MESSAGE = "保存失败，原记录未改动。请导出备份后重试。";

/** 设置窗口打开期间推迟收起，按此间隔复查它是否已关闭。 */
const SETTINGS_POLL_INTERVAL = 400;

/** 两组图片附件是否相同（只比较标识与顺序）。 */
function sameImages(left: NoteImage[], right: NoteImage[]): boolean {
  return left.length === right.length && left.every((image, index) => image.id === right[index].id);
}

// 快捷键描述：Ctrl+Enter 触发保存并收起侧栏。

export function Sidebar() {
  const state = useStore();
  const toast = useToast();

  /* ==================== 侧栏与 Tab 状态 ==================== */
  const [tab, setTab] = useState<TabKey>("workspace");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [composerActive, setComposerActive] = useState(false);
  const [pinned, setPinned] = useState(false);
  /** 设置窗口正在显示：侧栏随之保持展开，固定按钮显示为按下以作提示。 */
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* ==================== 编辑事务 ==================== */
  const [editing, setEditing] = useState<EditSession | null>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  // 计时回调与失焦处理读取最新的编辑事务，避免沿用旧闭包。
  const editingRef = useRef<EditSession | null>(null);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  /* ==================== UI 层叠状态 ==================== */
  const [tagsExpandedId, setTagsExpandedId] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<Note | null>(null);
  // key 每次打开递增：在另一张卡片上右键时重新挂载菜单，焦点回到首项。
  const [contextMenu, setContextMenu] = useState<{ note: Note; anchor: MenuAnchor; key: number } | null>(null);
  /** 空白处的右键菜单。 */
  const [sidebarMenu, setSidebarMenu] = useState<{ anchor: MenuAnchor; key: number } | null>(null);
  const menuSerial = useRef(0);
  /**
   * 单击选中的卡片：与指针悬停的卡片使用同一种边框高亮，指针移到另一张卡片上时只高亮那一张。
   * Ctrl+C 复制高亮的卡片：悬停的优先，其次是单击选中的。
   */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<Note | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  /* 标签筛选菜单与标签管理对话框。 */
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [managingTag, setManagingTag] = useState<string | null>(null);
  /* 版号打开的「版本与更新」弹窗。 */
  const [changelogOpen, setChangelogOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);

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

  /** 组装当前侧栏布局，供窗口命令使用。 */
  const currentLayout = useCallback(
    () => ({
      edge: state.settings.edge,
      width: state.settings.width,
      animDuration: state.settings.animDuration,
    }),
    [state.settings.edge, state.settings.width, state.settings.animDuration],
  );

  // 对话框打开期间鼠标移出侧栏不收起，否则对话框会随侧栏一起消失。
  const dialogOpen = Boolean(trashTarget || managingTag || imagePreview || emojiTarget || changelogOpen);
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
      void bridge.isSettingsVisible().then((settingsOpen) => {
        if (token !== hideToken.current || mustStay()) return;
        if (settingsOpen) {
          hideTimer.current = window.setTimeout(attempt, SETTINGS_POLL_INTERVAL);
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
  /** 指针屏幕坐标的位移换算为设置中宽度的比例；浏览器预览没有窗口与界面缩放，保持 1。 */
  const widthPerScreen = useRef(1);

  // 屏幕坐标（screenX、outerWidth）的单位既不同于页面像素（受界面缩放影响），
  // 也不同于窗口逻辑像素（受 Windows 文本缩放影响）。用同一窗口在两种单位下的宽度求比例，
  // 不依赖浏览器对页面缩放和文本缩放的具体处理。
  const refreshPixelRatio = useCallback(() => {
    if (!bridge.isDesktop()) return;
    void bridge.windowScaleFactor().then((scale) => {
      if (scale <= 0 || window.outerWidth <= 0) return;
      // 页面宽度乘页面像素比得到物理宽度，再除以窗口缩放比例得到逻辑宽度。
      const logicalWidth = (window.innerWidth * window.devicePixelRatio) / scale;
      widthPerScreen.current = logicalWidth / window.outerWidth;
    });
  }, []);

  useEffect(() => {
    refreshPixelRatio();
  }, [refreshPixelRatio]);

  const commitWidth = useCallback((width: number) => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    latestWidth.current = width;
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
          { edge: state.settings.edge, width: latestWidth.current },
          state.settings.edgeTrigger,
        );
      });
    },
    [state.settings.edge, state.settings.edgeTrigger, commitWidth],
  );

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
    // 拖动途中指针移出过窗口时，松手后补上推迟的收起。
    if (hidePending.current) scheduleHide();
  }, [scheduleHide]);

  /* ==================== 过滤后的列表 ==================== */
  const listNotes = useMemo(() => {
    const baseList = state.notes
      .filter((note) => inTab(note, tab) && matchesQuery(note, query))
      .filter(
        (note) =>
          !selectedTag ||
          parse(note.text).tags.some((item) => tagKey(item) === tagKey(selectedTag)),
      );

    // 置顶在前，再按手动顺序/创建时间排序。
    const pinned = baseList.filter((note) => note.pinned).sort(compareNoteOrder);
    const normal = baseList.filter((note) => !note.pinned).sort(compareNoteOrder);
    return tab === "pinned" ? pinned : [...pinned, ...normal];
  }, [state.notes, tab, query, selectedTag]);

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
      if (store.getState().pendingAttachments > 0) return;
      void commitEdit();
    }, 0);
  }, [commitEdit]);

  /* ==================== 速记 Composer ==================== */
  const [composerText, setComposerText] = useState("");
  const composerEditorRef = useRef<MarkdownEditor | null>(null);

  const saveComposer = useCallback(
    async (hideSidebar: boolean) => {
      // 与原型一致：草稿为空时不保存也不提示。
      const { draft } = store.getState();
      if (!draft.text.trim() && !draft.images.length) return;
      const note = await store.saveDraftAsNote(tab);
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
      setComposerActive(false);
      toast("记录已保存");
      if (hideSidebar) void bridge.hideSidebar(currentLayout());
    },
    [tab, toast, currentLayout],
  );

  useEffect(() => {
    store.changeDraft(composerText);
  }, [composerText]);

  /** 复制记录：菜单首项、卡片上的复制按钮与 Ctrl+C 共用；多条记录之间空一行。 */
  const handleCopyNotes = useCallback(
    async (notes: Note[]) => {
      try {
        const plain = notes.map((note) => `${note.emoji || "📝"} ${note.text}`).join("\n\n");
        await navigator.clipboard.writeText(plain);
        toast(notes.length > 1 ? `已复制 ${notes.length} 条记录` : "已复制");
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
    window.setTimeout(() => document.getElementById("search-input")?.focus(), 50);
  }, []);

  /** 新建记录：先提交正在进行的编辑，再聚焦新建卡片。Ctrl+N 与空白处菜单共用。 */
  const startNewNote = useCallback(() => {
    if (editingRef.current) void commitEdit();
    window.dispatchEvent(new CustomEvent("sidenotes:focus-composer"));
  }, [commitEdit]);

  /** 固定或取消固定侧栏：标题栏按钮与空白处菜单共用。 */
  const togglePinned = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    void bridge.setSidebarPinned(next);
  }, [pinned]);

  /* ==================== 窗口失焦自动收起 ==================== */
  // 点到侧栏窗口之外与鼠标移出同样触发收起；是否保持展开由到点时的状态决定，
  // 不在这里提前返回，否则菜单随失焦关闭后就再没有机会收起。
  // 整个侧栏失去焦点时，正在编辑的卡片先保存并回到预览，与在侧栏内点到别处一致；
  // 选择附件的对话框打开期间、附件还在读取时不算离开。
  // 重新获得焦点（选完附件、很快又点回侧栏）时取消尚未执行的收起。
  useEffect(() => {
    const handleBlur = (): void => {
      if (editingRef.current && !choosingFiles.current && store.getState().pendingAttachments === 0) {
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
  }, [scheduleHide, cancelHide, commitEdit]);

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

  const handleArchiveNote = useCallback(
    async (note: Note) => {
      const destination = note.status === "archived" ? "workspace" : "archive";
      const undo = await store.moveNotes([note.id], destination);
      if (!undo) {
        toast("操作未保存", null, true);
        return;
      }
      toast(destination === "archive" ? "已归档" : "已移回工作区", {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo);
        },
      });
    },
    [toast],
  );

  /* ==================== 卡片长按排序与多选（对应原型 interactions.js） ==================== */

  /** 切换页签：清空搜索、标签筛选与单击选中，页签按钮与拖动停留共用。 */
  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    setQuery("");
    setSearchOpen(false);
    setSelectedTag("");
    setTagMenuOpen(false);
    setCurrentId(null);
  }, []);

  /** 把拖动的记录移到页签或回收站，提示可撤销，对应原型 moveRecords。 */
  const moveDragged = useCallback(
    async (ids: string[], destination: TabKey | "trash") => {
      const undo = await store.moveNotes(ids, destination);
      if (!undo) {
        toast("移动未保存，请重试", null, true);
        return false;
      }
      const message =
        destination === "trash"
          ? "已移入回收站"
          : destination === "archive"
            ? "已移到归档"
            : destination === "pinned"
              ? "已移到置顶"
              : "已移到工作区";
      toast(`${message} ${ids.length} 条记录`, {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo);
        },
      });
      return true;
    },
    [toast],
  );

  /** 把拖动的记录插入目标之前或之后，提示可撤销，对应原型 reorder。 */
  const reorderDragged = useCallback(
    async (ids: Set<string>, targetId: string, after: boolean) => {
      const count = store.getState().notes.filter((note) => ids.has(note.id) && note.status !== "trash").length;
      const undo = await store.reorderNotes(ids, targetId, after);
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
    [toast],
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
    viewKey: `${tab}\u0000${query}\u0000${selectedTag}`,
    blocked: Boolean(editing) || dialogOpen || tagsExpandedId !== null,
    onSwitchTab: switchTab,
    onMove: moveDragged,
    onReorder: (ids, targetId, after) => void reorderDragged(ids, targetId, after),
    onMoveItem: (drop) => void moveItem(drop),
  });

  // 与原型 keepVisible 一致：固定、弹层、菜单、拖动与读取附件期间不自动收起；
  // 多选，以及「编辑时保持展开」开启时的编辑记录、整理标签与新建卡片的未保存内容，
  // 只在鼠标移出时保持展开：点到侧栏之外（整个侧栏失去焦点）照常收起，编辑中的卡片已在失焦时保存。
  const draftPending = Boolean(state.draft.text.trim() || state.draft.images.length);
  const hold = Boolean(
    pinned || dialogOpen || contextMenu || sidebarMenu || interactions.busy || state.pendingAttachments > 0,
  );
  const holdWhileFocused = Boolean(
    interactions.hasSelection ||
      (state.settings.protectEditing && (editing || tagsExpandedId || (composerActive && draftPending))),
  );
  useEffect(() => {
    holdRef.current = hold;
    holdFocusedRef.current = holdWhileFocused;
    // 保持展开的条件解除时，若之前已触发过收起（鼠标早已移出或窗口已失焦），补一次收起。
    if (hidePending.current && !hold && (!holdWhileFocused || !document.hasFocus())) scheduleHide();
  }, [hold, holdWhileFocused, scheduleHide]);

  /**
   * Ctrl+C 复制：多选时复制选中的全部记录；否则复制高亮的卡片，
   * 指针所在的卡片优先，其次是单击选中的卡片。没有可复制的卡片时提示。
   */
  const copyHighlighted = useCallback(async () => {
    let targets = listNotes.filter((note) => interactions.selected.has(note.id));
    if (!targets.length) {
      const hovered = listRef.current?.querySelector<HTMLElement>(".note-card:hover")?.dataset.noteId;
      const note = listNotes.find((item) => item.id === (hovered ?? currentId));
      if (note) targets = [note];
    }
    if (!targets.length) {
      toast("没有选中内容");
      return;
    }
    await handleCopyNotes(targets);
  }, [listNotes, interactions.selected, currentId, toast, handleCopyNotes]);

  /* ==================== 键盘快捷键 ==================== */
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (editing) {
          void commitEdit();
          return;
        }
        // 与原型一致：按键发生在新建卡片内即保存。保存后焦点仍留在新建卡片里，
        // 不会再触发 focus，不能只依赖「新建卡片激活」状态，否则接着按 Ctrl+Enter 没有反应。
        const inComposer = event.target instanceof Element && Boolean(event.target.closest("#quick-composer"));
        if (composerActive || inComposer) {
          void saveComposer(true);
        }
      }
      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
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
        if (imagePreview) {
          setImagePreview(null);
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
        if (trashTarget) {
          setTrashTarget(null);
          return;
        }
        if (tagMenuOpen) {
          setTagMenuOpen(false);
          return;
        }
        if (editing) {
          cancelEdit();
          return;
        }
        if (composerActive) {
          setComposerActive(false);
          return;
        }
        // 搜索面板开着时 Esc 收起搜索并清空查询；标签筛选独立保留。
        if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
          return;
        }
        // 都没有，收起侧栏。
        setTagMenuOpen(false);
        void bridge.hideSidebar(currentLayout());
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      }
      // Ctrl+N：与原型「新建记录」一致，先提交正在进行的编辑，再聚焦顶部输入卡片。
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
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
      toast(`已${collapse ? "收起" : "展开"} ${ids.length} 张卡片`, {
        label: "撤销",
        run: () => {
          void store.restoreNotes(undo);
        },
      });
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

  /** 侧栏空白处右键：打开侧栏菜单，替代系统窗口菜单与浏览器菜单；输入框与编辑区保留系统菜单。 */
  const handleSidebarContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"],.note-card')) return;
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

  /** 键盘焦点在卡片上时 Enter 或空格开始编辑。 */
  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement;
      if (!target.matches(".note-card")) return;
      event.preventDefault();
      const note = store.getState().notes.find((item) => item.id === target.dataset.noteId);
      if (note) beginEdit(note);
    },
    [beginEdit],
  );

  const handleMenuCommand = useCallback(
    async (note: Note, command: MenuCommand) => {
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
        case "archive":
          await handleArchiveNote(note);
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
          window.dispatchEvent(new CustomEvent("sidenotes:note-info", { detail: note }));
          break;
        case "trash":
          setTrashTarget(note);
          break;
      }
    },
    [tab, beginEdit, handleCopyNote, handleArchiveNote, toast],
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
        case "hide":
          setTagMenuOpen(false);
          void bridge.hideSidebar(currentLayout());
          break;
      }
    },
    [startNewNote, openSearch, toggleCollapseAll, interactions, togglePinned, state.settings.edge, currentLayout],
  );

  /**
   * 确认后把记录移入回收站，并在提示条中提供撤销，对应原型 requestDelete。
   * 保存失败时返回 false，确认对话框保持打开，记录原样保留。
   */
  const handleMoveToTrash = useCallback(async () => {
    if (!trashTarget) return false;
    const undo = await store.moveNotes([trashTarget.id], "trash");
    if (!undo) {
      toast(SAVE_FAILED_MESSAGE, null, true);
      return false;
    }
    toast("已移入回收站", {
      label: "撤销",
      run: () => {
        // 撤销还原删除前的状态、置顶与顺序；写入失败时与原型一样提示保存失败。
        void store.restoreNotes(undo).then((ok) => {
          if (!ok) toast(SAVE_FAILED_MESSAGE, null, true);
        });
      },
    });
    return true;
  }, [trashTarget, toast]);

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileMode = useRef<"image" | "file">("image");
  const fileTarget = useRef<"composer" | string>("composer");

  /**
   * 引用文件：用系统对话框选择文件，复制到应用数据目录中维护，在光标处插入引用（图片为内嵌图片）。
   * 记录只引用副本，原始文件移动或删除后引用仍然有效。
   */
  const referenceFiles = useCallback(
    async (target: "composer" | string) => {
      // 系统对话框打开期间侧栏失焦，不保存编辑也不收起；对话框关闭、窗口重新获得焦点后复位。
      choosingFiles.current = true;
      let markdown: string | null;
      try {
        markdown = await chooseAndImportFiles();
      } catch (error) {
        const reason = error instanceof Error && error.message ? error.message : "请稍后重试";
        toast(`文件未能引用：${reason}`, null, true);
        return;
      } finally {
        choosingFiles.current = false;
      }
      if (!markdown) return;
      const editor = target === "composer" ? composerEditorRef.current : editorRef.current;
      if (target !== "composer" && editingRef.current?.id !== target) return;
      if (editor) {
        editor.focus({ preventScroll: true });
        editor.replace(markdown);
      } else if (target === "composer") {
        setComposerText((current) => current + (current ? "\n" : "") + markdown);
      }
    },
    [toast],
  );

  const triggerFileInput = useCallback(
    (mode: "image" | "file", target: "composer" | string) => {
      if (mode === "file") {
        void referenceFiles(target);
        return;
      }
      fileMode.current = mode;
      fileTarget.current = target;
      if (fileInputRef.current) {
        fileInputRef.current.accept = "image/*";
        // 系统对话框打开期间侧栏失焦，不保存编辑也不收起；对话框关闭、窗口重新获得焦点后复位。
        choosingFiles.current = true;
        fileInputRef.current.click();
      }
    },
    [referenceFiles],
  );

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      choosingFiles.current = false;
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (!files.length) return;

      if (fileMode.current === "image") {
        store.setPendingAttachments(files.length);
        const images: NoteImage[] = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) {
            toast(`${file.name} 不是图片`, null, true);
            store.setPendingAttachments(-1);
            continue;
          }
          if (file.size > 2 * 1024 * 1024) {
            toast(`${file.name} 超过 2 MB 限制`, null, true);
            store.setPendingAttachments(-1);
            continue;
          }
          await new Promise<void>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              images.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                data: String(reader.result),
              });
              store.setPendingAttachments(-1);
              resolve();
            };
            reader.onerror = () => {
              toast(`读取 ${file.name} 失败`, null, true);
              store.setPendingAttachments(-1);
              resolve();
            };
            reader.readAsDataURL(file);
          });
        }
        if (fileTarget.current === "composer") store.addDraftImages(images);
        else if (editing?.id === fileTarget.current) {
          setEditing((prev) => (prev ? { ...prev, images: [...prev.images, ...images] } : prev));
        }
      }
    },
    [editing, toast],
  );

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

  const clearTagFilter = useCallback(() => {
    setSelectedTag("");
    setTagMenuOpen(false);
  }, []);

  /** 空状态中的「清除筛选」：同时清除标签与搜索。 */
  const clearFilters = useCallback(() => {
    setSelectedTag("");
    setQuery("");
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

  const tabCounts: Record<TabKey, number> = useMemo(
    () => ({
      workspace: state.notes.filter((note) => note.status === "active").length,
      pinned: state.notes.filter((note) => note.status === "active" && note.pinned).length,
      archive: state.notes.filter((note) => note.status === "archived").length,
    }),
    [state.notes],
  );

  // 底部存储状态：读库失败与写入失败都显示为异常。
  const storageError = state.loadFailed || state.saveFailed;
  const storageStatus = state.loadFailed ? "未能读取本地记录" : state.saveFailed ? "本地存储失败" : "本地已保存";

  return (
    <>
      <IconSprite />
      <aside
        ref={asideRef}
        className={editing ? "sidebar open has-editing" : "sidebar open"}
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
          className="sidebar-resizer"
          data-edge={state.settings.edge}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />

        <header className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div>
              <h2>SideNotes</h2>
              <button
                id="app-version"
                type="button"
                className="version-button"
                data-action="show-changelog"
                aria-label="版本与更新"
                title="版本与更新日志"
                onClick={() => setChangelogOpen(true)}
              >
                <span>{__APP_VERSION__} PREVIEW</span>
                <span className="update-dot" hidden />
              </button>
            </div>
          </div>
          <div className="window-actions">
            <button
              type="button"
              className={`icon-button${pinned ? " is-pinned" : ""}${settingsOpen && !pinned ? " is-linked" : ""}`}
              aria-pressed={pinned || settingsOpen}
              aria-label={pinned ? "取消固定侧栏" : "固定侧栏保持展开"}
              title={
                pinned
                  ? "取消固定侧栏"
                  : settingsOpen
                    ? "设置窗口打开期间侧栏保持展开，关闭设置后恢复自动收起；点击可一直固定"
                    : "固定侧栏保持展开"
              }
              onClick={togglePinned}
            >
              <Icon name={pinned || settingsOpen ? "pin" : "pin-off"} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="收起侧栏"
              title="收起侧栏 · Esc"
              onClick={() => void bridge.hideSidebar(currentLayout())}
            >
              <Icon name={state.settings.edge === "left" ? "arrow-left" : "arrow-right"} />
            </button>
          </div>
        </header>

        {/* 导航：页签 + 搜索切换 */}
        <div
          className={`sidebar-navigation${query ? " has-search-query" : ""}${searchOpen ? " is-searching" : ""}`}
        >
          <nav className="sidebar-tabs" aria-label="记录列表">
            <button
              type="button"
              role="tab"
              className={`tab${tab === "workspace" ? " active" : ""}${interactions.dragTab === "workspace" ? " is-drag-target" : ""}`}
              data-tab="workspace"
              aria-selected={tab === "workspace"}
              onClick={() => switchTab("workspace")}
            >
              工作区
              <span data-count="workspace">{tabCounts.workspace}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`tab${tab === "pinned" ? " active" : ""}${interactions.dragTab === "pinned" ? " is-drag-target" : ""}`}
              data-tab="pinned"
              aria-selected={tab === "pinned"}
              onClick={() => switchTab("pinned")}
            >
              <Icon name="pin" /> 置顶
              <span data-count="pinned">{tabCounts.pinned}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={`tab${tab === "archive" ? " active" : ""}${interactions.dragTab === "archive" ? " is-drag-target" : ""}`}
              data-tab="archive"
              aria-selected={tab === "archive"}
              onClick={() => switchTab("archive")}
            >
              <Icon name="archive" /> 归档
              <span data-count="archive">{tabCounts.archive}</span>
            </button>
          </nav>
          <div
            id="header-search"
            className={`header-search${searchOpen ? " is-open" : ""}${query ? " has-query" : ""}`}
          >
            {" "}
            <button
              type="button"
              className={`icon-button search-toggle${searchOpen ? " is-active" : ""}`}
              aria-label="搜索记录 · Ctrl+F"
              aria-controls="search-panel"
              aria-expanded={searchOpen}
              title="搜索 · Ctrl+F"
              onClick={() => {
                const next = !searchOpen;
                setSearchOpen(next);
                if (!next) setQuery("");
                else setTimeout(() => document.getElementById("search-input")?.focus(), 50);
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
                搜索记录与标签
              </label>
              {/* 输入 #标签 时以灰字联想已有标签，Tab 选用；不再展开标签菜单。 */}
              <TagInput
                id="search-input"
                type="search"
                placeholder="搜索记录、#标签…"
                autoComplete="off"
                search
                value={query}
                onValueChange={setQuery}
                onBlur={(event) => {
                  // 失焦时若未输入内容则自动收起搜索面板。
                  if (
                    !query &&
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
                    setQuery("");
                    setSelectedTag("");
                  }}
                >
                  <Icon name="x" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* 整理提醒 */}
        {nudgeVisible && tab === "workspace" ? (
          <div className="workspace-nudge">
            <Icon name="alert" />
            <p>
              <strong>工作区记录较多</strong>
              <button type="button" onClick={() => setTab("archive")}>
                归档旧记录
              </button>
              可以让工作区保持整洁
              <button
                type="button"
                onClick={() => {
                  void store.updateSettings({ tidySnoozeUntil: Date.now() + 7 * 86_400_000 });
                  setNudgeDismissed(true);
                }}
              >
                七天后再说
              </button>
            </p>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭提醒"
              onClick={() => setNudgeDismissed(true)}
            >
              <Icon name="x" />
            </button>
          </div>
        ) : null}

        {/* 列表顶部：记录数、标签筛选 */}
        <div className="list-topline">
          <p id="list-summary">{`${listNotes.length} 条${selectedTag ? ` · #${selectedTag}` : ""}`}</p>
          <TagFilter
            tab={tab}
            query={query}
            selectedTag={selectedTag}
            total={tabCounts[tab]}
            open={tagMenuOpen}
            onOpenChange={setTagMenuOpen}
            onSelect={selectTag}
            onClear={clearTagFilter}
            onManage={manageTag}
            onSearch={searchTags}
          />
        </div>

        {/* 读库或保存失败提示：读库失败时已暂停保存，导出备份也没有意义。 */}
        {state.loadFailed || state.saveFailed ? (
          <div className="desktop-notice is-error">
            <Icon name="alert" />
            {state.loadFailed ? "未能读取本地记录，已暂停保存，以免覆盖已有数据" : "本地存储不可用，请导出备份后重试"}
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
          onSave={() => void saveComposer(false)}
          onClose={() => setComposerActive(false)}
          onAttachImage={() => triggerFileInput("image", "composer")}
          onAttachFile={() => triggerFileInput("file", "composer")}
          onRemoveImage={(id) => store.removeDraftImage(id)}
          onPreviewImage={(src, alt) => setImagePreview({ src, alt })}
          maxHeight={Math.min(340, window.innerHeight * 0.42)}
        />

        {/* 记录列表 */}
        <div
          ref={listRef}
          id="note-list"
          className={editing ? "note-list has-editing" : "note-list"}
          tabIndex={-1}
          role="list"
          aria-label={`${TAB_LABELS[tab]}记录列表`}
          onClick={handleListClick}
          onFocus={handleListFocus}
          onDoubleClick={handleListDoubleClick}
          onContextMenu={handleListContextMenu}
          onKeyDown={handleListKeyDown}
        >
          {listNotes.length === 0 ? (
            <div className="empty-state">
              <h3>{query || selectedTag ? "没有匹配的记录" : "暂无记录"}</h3>
              <p>{query || selectedTag ? "调整搜索或标签筛选。" : "在上方直接输入。"}</p>
              {query || selectedTag ? (
                <button
                  type="button"
                  className="button secondary"
                  data-action="clear-filters"
                  aria-label="清除筛选"
                  title="清除筛选"
                  onClick={clearFilters}
                >
                  清除筛选
                </button>
              ) : null}
            </div>
          ) : (
            listNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                editing={editing}
                current={currentId === note.id}
                selected={interactions.selected.has(note.id)}
                menuOpen={contextMenu?.note.id === note.id}
                itemTarget={interactions.itemTargetId === note.id}
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
                onExpand={() => void store.setCollapsed([note.id], false)}
                onCopy={() => void handleCopyNote(note)}
                onTogglePin={() => void store.updateNote(note.id, { pinned: !note.pinned })}
                onArchive={() => void handleArchiveNote(note)}
                onMore={(anchor) => openNoteMenu(note, anchor)}
                onFilterTag={selectTag}
                onRemoveTag={async (tag) => {
                  const newText = removeTag(note.text, tag);
                  await store.commitEdit(note.id, newText, note.images);
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
                onPreviewImage={(src, alt) => setImagePreview({ src, alt })}
                onOpenFile={async (path) => {
                  const status = await bridge.inspectFile(path);
                  if (!status.exists) {
                    toast("文件不存在或已移动", null, true);
                    return;
                  }
                  void bridge.openFile(path).catch(() => toast("无法打开文件", null, true));
                }}
                onTaskToggle={(offset, checked) => void handleTaskToggle(note.id, offset, checked)}
              />
            ))
          )}
        </div>

        {/* 底部状态栏 */}
        <footer className="sidebar-footer">
          <span
            id="storage-status"
            className={storageError ? "is-error" : ""}
            aria-label={storageStatus}
            title={storageStatus}
          >
            {storageError ? <Icon name="alert" /> : <span className="small-dot" />}
          </span>
          <span className="footer-right">
            <button
              type="button"
              className="icon-button"
              aria-label="偏好设置与数据"
              title="偏好设置与数据"
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
      <input ref={fileInputRef} type="file" hidden multiple onChange={handleFileSelected} />

      {/* 图片预览 */}
      {imagePreview ? (
        <ImagePreview
          src={imagePreview.src}
          name={imagePreview.alt || "图片"}
          onClose={() => setImagePreview(null)}
        />
      ) : null}

      {/* 卡片上下文菜单 */}
      {contextMenu ? (
        <NoteMenu
          key={contextMenu.key}
          note={contextMenu.note}
          anchor={contextMenu.anchor}
          onCommand={(command) => void handleMenuCommand(contextMenu.note, command)}
          onClose={() => setContextMenu(null)}
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

      {/* 移入回收站确认 */}
      {trashTarget ? (
        <ConfirmDialog
          title="将这条记录移入回收站？"
          description={`“${(trashTarget.text.split("\n")[0] || "图片记录").slice(0, 70)}”会暂存于回收站，可在设置中恢复。`}
          confirmLabel="移入回收站"
          onConfirm={handleMoveToTrash}
          onCancel={() => setTrashTarget(null)}
        />
      ) : null}

      {/* 版本与更新：对应原型版号按钮的 show-changelog */}
      {changelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}

      {/* 标签管理：重命名或合并、全局移除 */}
      {managingTag ? (
        <TagManageDialog
          tag={managingTag}
          onClose={() => setManagingTag(null)}
          onRenamed={(next) => {
            if (selectedTag && tagKey(selectedTag) === tagKey(managingTag)) setSelectedTag(next);
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
