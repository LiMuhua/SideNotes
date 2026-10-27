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
import { ConfirmDialog, ImagePreview, ToastRegion } from "./Modal";
import { useStore } from "../hooks/useStore";
import { useToast } from "../hooks/useToast";
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
  const [confirmTrash, setConfirmTrash] = useState<Note[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ note: Note; anchor: MenuAnchor } | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<Note | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  /* ==================== 拖排序多选（占位：下一步迭代实现） ==================== */
  const sortPendingId: string | null = null;
  const sortingIds = new Set<string>();
  const selectedIds = new Set<string>();
  const dropHints: Record<string, "before" | "after"> = {};
  const dragTarget: string | null = null;

  /* ==================== 鼠标移出收起 ==================== */
  const hideTimer = useRef<number>(0);

  const scheduleHide = useCallback(() => {
    if (pinned || editing || composerActive) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      void bridge.hideSidebar();
    }, state.settings.hideDelay);
  }, [pinned, editing, composerActive, state.settings.hideDelay]);

  const cancelHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
  }, []);

  /* ==================== 拖拽调整侧栏宽度 ==================== */
  // 拖拽期间通过 pointer capture 锁定事件，避免划过文本触发选区。
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizing.current = true;
      startX.current = event.clientX;
      startWidth.current = state.settings.width;
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      document.body.style.userSelect = "none";
    },
    [state.settings.width],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizing.current) return;
      event.preventDefault();
      const delta = event.clientX - startX.current;
      // 右侧边：往左拖增大宽度；左侧边：往右拖增大宽度。
      const adjusted = state.settings.edge === "left" ? delta : -delta;
      const next = Math.min(720, Math.max(360, startWidth.current + adjusted));
      void store.updateSettings({ width: next });
      void bridge.applySidebarLayout(
        { edge: state.settings.edge, width: next },
        state.settings.edgeTrigger,
      );
    },
    [state.settings.edge, state.settings.edgeTrigger],
  );

  const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    resizing.current = false;
    document.body.style.userSelect = "";
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* 忽略已释放 */
    }
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
      const note = await store.saveDraftAsNote(tab);
      if (!note) {
        toast("记录为空，已取消保存", null, true);
        return;
      }
      setComposerText("");
      setComposerActive(false);
      toast("记录已保存");
      if (hideSidebar) void bridge.hideSidebar();
    },
    [tab, toast],
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
        if (editing) {
          cancelEdit();
          return;
        }
        if (composerActive) {
          setComposerActive(false);
          return;
        }
        // 搜索面板开着时 Esc 收起搜索（清空查询）。
        if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
          setSelectedTag("");
          return;
        }
        // 都没有，收起侧栏。
        void bridge.hideSidebar();
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
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  });

  /* ==================== 托盘与系统事件 ==================== */
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    void bridge
      .onAppEvent(bridge.APP_EVENTS.traySettings, () => {
        // 打开设置：通过事件通知应用层
        window.dispatchEvent(new CustomEvent("sidenotes:open-settings"));
      })
      .then((unlisten) => cleanups.push(unlisten));
    void bridge
      .onAppEvent(bridge.APP_EVENTS.trayQuit, () => {
        void store.persistDraft().then(() => bridge.quitApp());
      })
      .then((unlisten) => cleanups.push(unlisten));

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
    [editing],
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
          setConfirmTrash([note]);
          break;
      }
    },
    [tab, beginEdit, handleCopyNote, handleArchiveNote, toast],
  );

  const handleDeleteForever = useCallback(async () => {
    if (!confirmTrash) return;
    const ids = confirmTrash.map((note) => note.id);
    const ok = await store.deleteForever(ids);
    if (!ok) {
      toast("删除失败", null, true);
      return;
    }
    setConfirmTrash(null);
    toast("已永久删除");
  }, [confirmTrash, toast]);

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

  /* ==================== 选择区域计数 ==================== */
  const activeCount = useMemo(
    () => state.notes.filter((note) => inTab(note, "workspace")).length,
    [state.notes],
  );

  /* ==================== 渲染 ==================== */
  const tabCounts: Record<TabKey, number> = useMemo(
    () => ({
      workspace: state.notes.filter((note) => note.status === "active").length,
      pinned: state.notes.filter((note) => note.status === "active" && note.pinned).length,
      archive: state.notes.filter((note) => note.status === "archived").length,
    }),
    [state.notes],
  );

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
                aria-label="版本 0.6.1"
                onClick={() => window.dispatchEvent(new CustomEvent("sidenotes:open-settings"))}
              >
                <span>0.6.1 PREVIEW</span>
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
              onClick={() => void bridge.hideSidebar()}
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
              className={tab === "workspace" ? "tab active" : "tab"}
              data-tab="workspace"
              aria-selected={tab === "workspace"}
              onClick={() => {
                setTab("workspace");
                setQuery("");
                setSearchOpen(false);
                setSelectedTag("");
              }}
            >
              工作区
              <span data-count="workspace">{tabCounts.workspace}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={tab === "pinned" ? "tab active" : "tab"}
              data-tab="pinned"
              aria-selected={tab === "pinned"}
              onClick={() => {
                setTab("pinned");
                setQuery("");
                setSearchOpen(false);
                setSelectedTag("");
              }}
            >
              <Icon name="pin" /> 置顶
              <span data-count="pinned">{tabCounts.pinned}</span>
            </button>
            <button
              type="button"
              role="tab"
              className={tab === "archive" ? "tab active" : "tab"}
              data-tab="archive"
              aria-selected={tab === "archive"}
              onClick={() => {
                setTab("archive");
                setQuery("");
                setSearchOpen(false);
                setSelectedTag("");
              }}
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
                onChange={(event) => setQuery(event.target.value)}
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
          <p>
            {selectedTag
              ? `#${selectedTag}`
              : tab === "workspace"
                ? `${activeCount} 条`
                : `${listNotes.length} 条`}
          </p>
          <TagFilter
            tab={tab}
            selectedTag={selectedTag}
            query={query}
            onSelect={(value) => setSelectedTag(tagKey(value) === tagKey(selectedTag) ? "" : value)}
            onClear={() => setSelectedTag("")}
          />
        </div>

        {/* Composer */}
        <Composer
          text={composerText}
          images={state.draft.images}
          busy={state.pendingAttachments > 0}
          active={composerActive}
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
          maxHeight={Math.min(300, Math.max(120, window.innerHeight * 0.35))}
        />

        {/* 保存失败提示 */}
        {state.saveFailed ? (
          <div className="desktop-notice is-error">
            <Icon name="alert" />
            本地存储不可用，请导出备份后重试
          </div>
        ) : null}

        {/* 记录列表 */}
        <div
          id="note-list"
          className="note-list"
          tabIndex={-1}
          role="list"
          aria-label={`${TAB_LABELS[tab]}记录列表`}
        >
          {listNotes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Icon name="search" />
              </div>
              <h3>{query || selectedTag ? "没有匹配的记录" : `${TAB_LABELS[tab]}暂无记录`}</h3>
              {tab === "workspace" && !query && !selectedTag ? (
                <p>
                  在上方输入框快速记录，
                  <br />
                  或使用 Ctrl+Shift+Space 呼出速记浮窗
                </p>
              ) : null}
            </div>
          ) : (
            listNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                editing={editing}
                selected={selectedIds.has(note.id)}
                tagsExpanded={tagsExpandedId === note.id}
                sortPending={sortPendingId === note.id}
                sorting={sortingIds.has(note.id)}
                dropHint={dropHints[note.id] ?? null}
                dropTarget={dragTarget === note.id}
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
                onFilterTag={(tag) =>
                  setSelectedTag(tagKey(tag) === tagKey(selectedTag) ? "" : tag)
                }
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
                  await bridge.onAppEvent("", () => {}); // 防止 tree-shake
                  const { openPath } = await import("@tauri-apps/plugin-opener");
                  void openPath(path).catch(() => toast("无法打开文件", null, true));
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
            className={state.saveFailed ? "is-error" : ""}
            aria-label={state.saveFailed ? "本地存储失败" : "本地已保存"}
            title={state.saveFailed ? "本地存储失败" : "本地已保存"}
          >
            {state.saveFailed ? <Icon name="alert" /> : <span className="small-dot" />}
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
      {confirmTrash ? (
        <ConfirmDialog
          title="移入回收站"
          description={`将 ${confirmTrash.length} 条记录移入回收站？保留 ${state.settings.trashDays} 天后会提示清理。`}
          confirmLabel="移入回收站"
          onConfirm={handleDeleteForever}
          onCancel={() => setConfirmTrash(null)}
        />
      ) : null}
    </>
  );
}
