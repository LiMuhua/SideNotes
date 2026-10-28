/**
 * 侧栏主组件。
 *
 * 组合页签、搜索框、记录列表、Composer 与所有交互逻辑；
 * 拖排序、多选、卡片编辑、设置入口都统一在此层处理，不再分散到各子组件。
 *
 * 侧栏内的「鼠标移出收起」逻辑：桌面端通过窗口隐藏而非 CSS 平移，
 * 所以原型的 slideOut 动画对应的是 `bridge.hideSidebar()` 调用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon, IconSprite } from "./Icon";
import { Composer } from "./Composer";
import { NoteCard } from "./NoteCard";
import { NoteMenu, type MenuAnchor, type MenuCommand } from "./NoteMenu";
import { EmojiPicker } from "./EmojiPicker";
import { TagFilter } from "./TagFilter";
import { TagManageDialog } from "./TagManageDialog";
import { ConfirmDialog, ImagePreview, ToastRegion } from "./Modal";
import { useStore } from "../hooks/useStore";
import { useToast } from "../hooks/useToast";
import { useCardInteractions } from "../hooks/useCardInteractions";
import * as store from "../core/store";
import * as bridge from "../core/bridge";
import { matchesQuery, shouldNudgeTidy, inTab, compareNoteOrder } from "../core/notes";
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

  /* ==================== 编辑事务 ==================== */
  const [editing, setEditing] = useState<EditSession | null>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);

  /* ==================== UI 层叠状态 ==================== */
  const [tagsExpandedId, setTagsExpandedId] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<Note | null>(null);
  const [contextMenu, setContextMenu] = useState<{ note: Note; anchor: MenuAnchor } | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<Note | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  /* 标签筛选菜单与标签管理对话框。 */
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [managingTag, setManagingTag] = useState<string | null>(null);

  /* ==================== 单击编辑（对应原型 editCard 的延迟编辑） ==================== */
  // 单击后延迟开始编辑，留出双击复制与长按拖动的判断时间；任何手势都会让计时失效。
  const clickTimer = useRef(0);
  const clickEpoch = useRef(0);
  const invalidateCardClick = useCallback(() => {
    window.clearTimeout(clickTimer.current);
    clickTimer.current = 0;
    clickEpoch.current += 1;
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);

  /* ==================== 鼠标移出收起 ==================== */
  const hideTimer = useRef<number>(0);
  /** 每次安排或取消收起都会递增；异步查询返回时据此判断这次收起是否已被取消。 */
  const hideToken = useRef(0);

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
  const dialogOpen = Boolean(trashTarget || managingTag || imagePreview || emojiTarget);
  // 卡片菜单与对话框渲染在侧栏元素之外，鼠标移上去就会触发侧栏的 mouseleave。
  // 与原型的 keepVisible 一致：打开期间不安排收起，计时结束时再按最新状态判断一次，
  // 避免先移出侧栏、随后才打开对话框时仍被收起。实际值在卡片手势之后计算（见下方）。
  const keepVisibleRef = useRef(false);

  const scheduleHide = useCallback(() => {
    if (keepVisibleRef.current) return;
    window.clearTimeout(hideTimer.current);
    const token = ++hideToken.current;
    hideTimer.current = window.setTimeout(() => {
      if (keepVisibleRef.current) return;
      // 与原型一致：设置弹窗打开期间侧栏保持展开。设置是独立窗口，打开时侧栏会失焦，
      // 鼠标也可能移到设置窗口上，所以到点时先查询设置窗口是否正在显示。
      void bridge.isSettingsVisible().then((settingsOpen) => {
        if (settingsOpen || token !== hideToken.current || keepVisibleRef.current) return;
        // 与原型一致：侧栏收起时一并收起标签菜单。
        setTagMenuOpen(false);
        void bridge.hideSidebar(currentLayout());
      });
    }, state.settings.hideDelay);
  }, [state.settings.hideDelay, currentLayout]);

  const cancelHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideToken.current += 1;
  }, []);

  /* ==================== 拖拽调整侧栏宽度 ==================== */
  // 拖动期只更新本地 CSS 变量并节流调用窗口尺寸，不写数据库：
  // 每帧持久化会触发整棵树重渲染，表现为闪动与交互失效。
  const resizing = useRef(false);
  const startScreenX = useRef(0);
  const startWidth = useRef(0);
  const latestWidth = useRef(0);
  const resizeFrame = useRef(0);
  /** 页面像素换算为窗口逻辑像素的比例；Windows 文本缩放会让两者不一致。 */
  const logicalPerCss = useRef(1);

  const refreshPixelRatio = useCallback(() => {
    void bridge.windowScaleFactor().then((scale) => {
      if (scale > 0) logicalPerCss.current = window.devicePixelRatio / scale;
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
      const delta = (event.screenX - startScreenX.current) * logicalPerCss.current;
      // 右侧边：往左拖增大宽度；左侧边：往右拖增大宽度。
      const adjusted = state.settings.edge === "left" ? delta : -delta;
      const next = Math.min(720, Math.max(360, Math.round((startWidth.current + adjusted) / 4) * 4));
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
  }, []);

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

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const text = editing.text.trim() ? editing.text : editing.originalText;
    const ok = await store.commitEdit(editing.id, text, editing.images);
    if (!ok) {
      toast("保存失败，请稍后重试", null, true);
      return;
    }
    setEditing(null);
    editorRef.current = null;
  }, [editing, toast]);

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

  /* ==================== 窗口失焦自动收起 ==================== */
  useEffect(() => {
    const handleBlur = (): void => {
      // 打开了浮层或正在编辑/输入时不自动收起，避免点进设置弹窗就消失。
      if (pinned || editing || composerActive || contextMenu || emojiTarget) return;
      scheduleHide();
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [pinned, editing, composerActive, contextMenu, emojiTarget, scheduleHide]);

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
        if (composerActive) {
          void saveComposer(true);
        }
      }
      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
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
        if (!searchOpen) {
          setSearchOpen(true);
          setTimeout(() => document.getElementById("search-input")?.focus(), 50);
        } else {
          document.getElementById("search-input")?.focus();
        }
      }
      // Ctrl+N：与原型「新建记录」一致，先提交正在进行的编辑，再聚焦顶部输入卡片。
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (editing) void commitEdit();
        window.dispatchEvent(new CustomEvent("sidenotes:focus-composer"));
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  });

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

  const handleCopyNote = useCallback(
    async (note: Note) => {
      try {
        const plain = `${note.emoji || "📝"} ${note.text}`;
        await navigator.clipboard.writeText(plain);
        toast("已复制");
      } catch {
        toast("剪贴板不可用", null, true);
      }
    },
    [toast],
  );

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

  /** 切换页签：清空搜索与标签筛选，页签按钮与拖动停留共用。 */
  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    setQuery("");
    setSearchOpen(false);
    setSelectedTag("");
    setTagMenuOpen(false);
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
    onInvalidateClick: invalidateCardClick,
  });

  // 与原型 keepVisible 一致：编辑、弹层、菜单、拖动与多选期间都不自动收起。
  const keepVisible = Boolean(
    pinned ||
      editing ||
      composerActive ||
      dialogOpen ||
      contextMenu ||
      interactions.busy ||
      interactions.hasSelection,
  );
  useEffect(() => {
    keepVisibleRef.current = keepVisible;
  }, [keepVisible]);

  // 计时回调里使用最新的 beginEdit，避免沿用旧的编辑会话。
  const beginEditRef = useRef(beginEdit);
  useEffect(() => {
    beginEditRef.current = beginEdit;
  }, [beginEdit]);

  /** 单击卡片：延迟开始编辑，期间的双击、长按或多选会让它失效。 */
  const handleListClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || interactions.isBusy() || interactions.isSelecting() || tagsExpandedId) return;
      const target = event.target as HTMLElement;
      if (target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
      const card = target.closest<HTMLElement>(".note-card");
      if (!card || card.classList.contains("is-editing")) return;
      const id = card.dataset.noteId;
      window.clearTimeout(clickTimer.current);
      const epoch = clickEpoch.current;
      clickTimer.current = window.setTimeout(() => {
        if (epoch !== clickEpoch.current || interactions.isBusy()) return;
        const note = store.getState().notes.find((item) => item.id === id);
        if (note) beginEditRef.current(note);
      }, 550);
    },
    [interactions, tagsExpandedId],
  );

  /** 双击卡片复制内容，对应原型 copyCard。 */
  const handleListDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || interactions.isBusy() || interactions.isSelecting()) return;
      const target = event.target as HTMLElement;
      if (target.closest('button,a,input,textarea,select,[contenteditable="true"]')) return;
      const card = target.closest<HTMLElement>(".note-card");
      if (!card || card.classList.contains("is-editing")) return;
      invalidateCardClick();
      event.preventDefault();
      const note = store.getState().notes.find((item) => item.id === card.dataset.noteId);
      if (note) void handleCopyNote(note);
    },
    [interactions, invalidateCardClick, handleCopyNote],
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
          await store.updateNote(note.id, { collapsed: !note.collapsed });
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

  const triggerFileInput = useCallback((mode: "image" | "file", target: "composer" | string) => {
    fileMode.current = mode;
    fileTarget.current = target;
    if (fileInputRef.current) {
      fileInputRef.current.accept = mode === "image" ? "image/*" : "*/*";
      fileInputRef.current.click();
    }
  }, []);

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
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
      } else {
        const refs = files.map((file) => `[${file.name}](${file.name})`).join("\n");
        if (fileTarget.current === "composer") {
          setComposerText((current) => current + (current ? "\n" : "") + refs);
        } else if (editorRef.current) {
          editorRef.current.replace(refs);
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
        className="sidebar open"
        data-edge={state.settings.edge}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
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
                type="button"
                className="version-button"
                aria-label={`版本 ${__APP_VERSION__}`}
                onClick={() => window.dispatchEvent(new CustomEvent("sidenotes:open-settings"))}
              >
                <span>{__APP_VERSION__} PREVIEW</span>
              </button>
            </div>
          </div>
          <div className="window-actions">
            <button
              type="button"
              className={`icon-button${pinned ? " is-pinned" : ""}`}
              aria-pressed={pinned}
              aria-label={pinned ? "取消固定侧栏" : "固定侧栏保持展开"}
              title={pinned ? "取消固定侧栏" : "固定侧栏保持展开"}
              onClick={() => {
                const next = !pinned;
                setPinned(next);
                void bridge.setSidebarPinned(next);
              }}
            >
              <Icon name={pinned ? "pin" : "pin-off"} />
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
              <input
                id="search-input"
                type="search"
                placeholder="搜索记录、#标签…"
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  // 与原型一致：输入 # 时展开标签菜单，匹配的标签排在前面。
                  if (event.target.value.includes("#")) setTagMenuOpen(true);
                }}
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

        {/* 记录列表：与原型一致，新建卡片作为粘性首项放在列表内，与记录卡片共用左右边距。 */}
        <div
          ref={listRef}
          id="note-list"
          className="note-list"
          tabIndex={-1}
          role="list"
          aria-label={`${TAB_LABELS[tab]}记录列表`}
          onClick={handleListClick}
          onDoubleClick={handleListDoubleClick}
          onKeyDown={handleListKeyDown}
        >
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
                selected={interactions.selected.has(note.id)}
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
                onEditBlur={() => {
                  // 失焦不自动提交，给跨窗口点击留余地
                }}
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
                onToggleCollapse={() =>
                  void store.updateNote(note.id, { collapsed: !note.collapsed })
                }
                onExpand={() => void store.updateNote(note.id, { collapsed: false })}
                onCopy={() => void handleCopyNote(note)}
                onTogglePin={() => void store.updateNote(note.id, { pinned: !note.pinned })}
                onArchive={() => void handleArchiveNote(note)}
                onMore={(anchor) => setContextMenu({ note, anchor })}
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
          note={contextMenu.note}
          anchor={contextMenu.anchor}
          onCommand={(command) => void handleMenuCommand(contextMenu.note, command)}
          onClose={() => setContextMenu(null)}
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
