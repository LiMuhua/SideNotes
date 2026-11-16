/**
 * 从资源管理器拖入文件。
 *
 * 用 WebView2 原生的 HTML5 拖放：窗口配置关闭了 Tauri 的拖放接管（dragDropEnabled: false），
 * 拖入的文件以 dragover / drop 事件到达网页，drop 时从 dataTransfer.files 取得文件内容，
 * 与粘贴截图一样保存为附件副本。不用 Tauri 的拖放事件：它在 WebView2 中注册的放下目标会被
 * WebView2 自己的目标覆盖，实测收不到任何事件（见技术决策）。
 *
 * 拖动途中按指针所在位置确定落点：
 * - 预览中的卡片：卡片高亮，插入线标出段落之间的位置；在同一张卡片上停留片刻后进入编辑，
 *   之后可以放到正文中更具体的位置。
 * - 编辑中的卡片与新建卡片：按指针换算出正文中的位置，用一条竖线标出。
 * 放下后由调用方把文件保存为附件副本并插入引用。拖动期间侧栏不收起。
 */

import { useEffect, useRef, useState } from 'react';
import type { MarkdownEditor } from '../core/editor';
import type { Note } from '../core/types';

/** 在卡片上停留多久后进入编辑。 */
const HOVER_EDIT_DELAY = 700;

/** 放下的位置。 */
export type FileDropTarget =
  /** 编辑面（编辑中的卡片或新建卡片）中的原文位置。 */
  | { kind: 'editor'; editor: MarkdownEditor; offset: number }
  /** 预览中的卡片：插到显示正文第 `line` 行之前（超出时接在正文末尾、标签之前）。 */
  | { kind: 'card'; noteId: string; line: number; title: string };

export interface FileDropOptions {
  /** 能否接收：对话框开着时不处理（附件弹窗自己接收拖入的文件）。 */
  enabled: () => boolean;
  findNote: (id: string) => Note | undefined;
  /** 正在编辑的记录及其编辑器。 */
  editing: () => { id: string; editor: MarkdownEditor | null } | null;
  composerEditor: () => MarkdownEditor | null;
  /** 在预览中的卡片上停留片刻后进入编辑。 */
  beginEdit: (note: Note) => void;
  /** 拖入开始或结束，调用方据此让侧栏保持展开；`left` 为真表示拖出了窗口（而不是放下）。 */
  onActiveChange: (active: boolean, left?: boolean) => void;
  /** 放下。没有落点时 target 为 null。 */
  onDrop: (target: FileDropTarget | null, files: File[]) => void;
}

/** 拖动的内容里是否有文件（而不是页面内拖动的文字）。 */
export function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** 卡片标题的简短形式，用在提示文字中。 */
function shortTitle(note: Note): string {
  const line = note.text.split(/\r?\n/).find((item) => item.trim()) ?? '图片记录';
  const title = line.replace(/^#{1,6}\s+/, '').trim();
  return title.length > 14 ? `${title.slice(0, 14)}…` : title;
}

/** 指针位置对应的文本位置；浏览器不支持时返回 null。 */
export function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** 创建挂在 body 上的临时元素。 */
function overlay(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  node.hidden = true;
  document.body.append(node);
  return node;
}

export function useFileDrop(options: FileDropOptions): { targetId: string | null; active: boolean } {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const [targetId, setTargetId] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    // 插入线（预览卡片）、竖线（编辑面）与跟随指针的提示，拖动结束后移除。
    let guide: HTMLElement | null = null;
    let guideLabel: HTMLElement | null = null;
    let caret: HTMLElement | null = null;
    let label: HTMLElement | null = null;
    let hover: { id: string; timer: number } | null = null;
    let dragging = false;
    let currentTarget = '';
    let lastTarget: FileDropTarget | null = null;
    // 拖入开始时让出焦点的编辑面：文件放到正获得焦点的编辑面上时 WebView2 不派发 drop 事件（实测），
    // 所以拖入期间先取消它的焦点，没有插入到编辑面时再还回去。
    let blurred: HTMLElement | null = null;

    const ensureOverlays = (): void => {
      if (guide) return;
      guide = overlay('card-drop-guide file-drop-guide');
      const line = document.createElement('span');
      line.className = 'card-drop-guide-line';
      guideLabel = document.createElement('span');
      guideLabel.className = 'card-drop-guide-label';
      guide.append(line, guideLabel);
      caret = overlay('file-drop-caret');
      label = overlay('file-drop-label');
    };

    const clearHover = (): void => {
      if (hover) window.clearTimeout(hover.timer);
      hover = null;
    };

    const highlight = (id: string): void => {
      if (id === currentTarget) return;
      currentTarget = id;
      setTargetId(id || null);
    };

    const cleanup = (left = false): void => {
      clearHover();
      guide?.remove();
      caret?.remove();
      label?.remove();
      guide = guideLabel = caret = label = null;
      lastTarget = null;
      highlight('');
      if (dragging) {
        dragging = false;
        setActive(false);
        opts.current.onActiveChange(false, left);
      }
    };

    /** 拖入期间取消编辑面的焦点（见 blurred）。 */
    const releaseFocus = (): void => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.isContentEditable) {
        blurred = active;
        active.blur();
      }
    };

    /** 没有插入到编辑面时把焦点还给拖入前的编辑面。 */
    const restoreFocus = (): void => {
      const target = blurred;
      blurred = null;
      if (target?.isConnected && !target.contains(document.activeElement)) target.focus({ preventScroll: true });
    };

    /** 显示跟随指针的提示文字。 */
    const showLabel = (x: number, y: number, text: string): void => {
      if (!label) return;
      label.hidden = false;
      label.textContent = text;
      label.style.left = `${Math.max(6, Math.min(x + 14, window.innerWidth - label.offsetWidth - 6))}px`;
      label.style.top = `${Math.max(6, Math.min(y + 16, window.innerHeight - label.offsetHeight - 6))}px`;
    };

    /** 编辑面中的落点：指针下的原文位置，用竖线标出；指针不在文字上时放到末尾。 */
    const editorTarget = (editor: MarkdownEditor, x: number, y: number): FileDropTarget => {
      const point = caretFromPoint(x, y);
      const offset = (point && editor.sourceOffset(point.node, point.offset)) ?? editor.getValue().length;
      if (caret) {
        let rect: DOMRect | null = null;
        if (point && editor.element.contains(point.node)) {
          const range = document.createRange();
          const limit = point.node.nodeType === Node.TEXT_NODE ? (point.node as Text).length : point.node.childNodes.length;
          range.setStart(point.node, Math.min(point.offset, limit));
          rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        }
        const box = editor.element.getBoundingClientRect();
        const left = rect && rect.height ? rect.left : box.left + 8;
        const top = rect && rect.height ? rect.top : box.bottom - 22;
        caret.hidden = false;
        caret.style.left = `${left - 1}px`;
        caret.style.top = `${top}px`;
        caret.style.height = `${rect && rect.height ? rect.height : 18}px`;
      }
      return { kind: 'editor', editor, offset };
    };

    /** 预览中的卡片：段落之间离指针最近的位置，与卡片之间拖动引用的落点一致。 */
    const cardTarget = (card: HTMLElement, note: Note, y: number): FileDropTarget => {
      const title = shortTitle(note);
      const bounds = card.getBoundingClientRect();
      const content = card.querySelector<HTMLElement>(':scope > .note-content');
      const collapsed = card.classList.contains('is-collapsed') || !content;
      const area = content && !collapsed ? content.getBoundingClientRect() : null;
      const blocks = collapsed ? [] : Array.from(content.querySelectorAll<HTMLElement>(':scope > .markdown-body > [data-line-start]'));
      let line = Number.MAX_SAFE_INTEGER;
      let position = area ? area.bottom : bounds.bottom - 8;
      let text = `插入到「${title}」正文末尾`;
      for (let index = 0; index < blocks.length; index += 1) {
        const rect = blocks[index].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          line = Number(blocks[index].dataset.lineStart);
          position = rect.top;
          text = index === 0 ? `插入到「${title}」正文开头` : `插入到「${title}」第 ${index} 段之后`;
          break;
        }
        position = rect.bottom;
      }
      if (area) position = Math.max(area.top, Math.min(position, area.bottom));
      if (guide && guideLabel) {
        guide.hidden = false;
        guide.style.left = `${bounds.left + 8}px`;
        guide.style.width = `${Math.max(0, bounds.width - 16)}px`;
        guide.style.top = `${position - 10}px`;
        guideLabel.textContent = '停留片刻可进入编辑';
      }
      return { kind: 'card', noteId: note.id, line, title: text };
    };

    /** 按指针位置计算落点，并更新高亮、插入线与提示。 */
    const locate = (x: number, y: number): FileDropTarget | null => {
      ensureOverlays();
      if (guide) guide.hidden = true;
      if (caret) caret.hidden = true;
      const hit = document.elementFromPoint(x, y);
      const composer = hit?.closest('#quick-composer');
      const composerEditor = opts.current.composerEditor();
      if (composer && composerEditor) {
        clearHover();
        highlight('');
        showLabel(x, y, '松开后插入到新建卡片');
        return editorTarget(composerEditor, x, y);
      }
      const card = hit?.closest<HTMLElement>('.note-card[data-note-id]') ?? null;
      const note = card ? opts.current.findNote(card.dataset.noteId ?? '') : undefined;
      if (!card || !note) {
        clearHover();
        highlight('');
        showLabel(x, y, '拖到卡片或新建卡片上插入');
        return null;
      }
      const editing = opts.current.editing();
      if (editing?.id === note.id && editing.editor) {
        clearHover();
        highlight(note.id);
        showLabel(x, y, `松开后插入到「${shortTitle(note)}」的这个位置`);
        return editorTarget(editing.editor, x, y);
      }
      highlight(note.id);
      // 在同一张卡片上停留片刻后进入编辑，之后按正文中的位置插入。
      if (hover?.id !== note.id) {
        clearHover();
        hover = {
          id: note.id,
          timer: window.setTimeout(() => {
            hover = null;
            const current = opts.current.findNote(note.id);
            if (dragging && current) opts.current.beginEdit(current);
          }, HOVER_EDIT_DELAY),
        };
      }
      const target = cardTarget(card, note, y);
      showLabel(x, y, `松开后${target.kind === 'card' ? target.title : ''}`);
      return target;
    };

    const handleOver = (event: DragEvent): void => {
      if (!isFileDrag(event) || !opts.current.enabled()) return;
      // 文件拖入时始终阻止默认处理，否则松开会让窗口打开这个文件。
      event.preventDefault();
      if (!dragging) {
        dragging = true;
        setActive(true);
        opts.current.onActiveChange(true);
        releaseFocus();
      }
      lastTarget = locate(event.clientX, event.clientY);
      if (event.dataTransfer) event.dataTransfer.dropEffect = lastTarget ? 'copy' : 'none';
    };

    const handleLeave = (event: DragEvent): void => {
      if (!dragging) return;
      // 只有离开整个窗口（没有新的目标元素）才算拖出；在元素之间移动也会触发 dragleave。
      if (event.relatedTarget === null) {
        cleanup(true);
        restoreFocus();
      }
    };

    const handleDrop = (event: DragEvent): void => {
      if (!isFileDrag(event) || !opts.current.enabled()) {
        // 拖动途中改为不接收（例如期间打开了弹窗）：照样结束这次拖动，
        // 否则「正在拖入文件」一直为真，侧栏会因此永远保持展开。
        if (dragging) {
          cleanup();
          restoreFocus();
        }
        return;
      }
      event.preventDefault();
      const target = locate(event.clientX, event.clientY) ?? lastTarget;
      const files = Array.from(event.dataTransfer?.files ?? []);
      cleanup();
      // 插入到编辑面时由调用方聚焦那里；否则把焦点还回去。
      if (target?.kind === 'editor' && files.length) blurred = null;
      else restoreFocus();
      opts.current.onDrop(target, files);
    };

    document.addEventListener('dragenter', handleOver, true);
    document.addEventListener('dragover', handleOver, true);
    document.addEventListener('dragleave', handleLeave, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragenter', handleOver, true);
      document.removeEventListener('dragover', handleOver, true);
      document.removeEventListener('dragleave', handleLeave, true);
      document.removeEventListener('drop', handleDrop, true);
      cleanup();
    };
  }, []);

  return { targetId, active };
}
