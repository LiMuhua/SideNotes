/**
 * 实时 Markdown 编辑器。
 *
 * 原文是唯一数据源：可编辑 DOM 只是原文的一种呈现，所有修改都先作用于原文，
 * 再重新排版并恢复选区。光标进入被标记包裹的内容时显示完整原始标记，
 * 其余内容保持渲染效果；选中文字时按选区的起点（锚点）判断，在展开的原文里拖动或按 Shift 扩选，
 * 标记保持展开。删除或改写选中的文字时按所见内容处理：完整选中一段格式的文字即连同隐藏标记一起删除，
 * 只选中一部分时保留隐藏的标记，不留下半截语法。
 *
 * 排版只在以下时机重建，避免正文内移动光标造成闪烁：
 * - 原文变化；
 * - 光标跨行；
 * - 可见标记的集合发生变化。
 *
 * 输入法组合期间不重建 DOM，组合结束后一次性吸收浏览器写入的内容。
 * 快捷键、回车续写与智能粘贴见 markdown-commands；粘贴截图或文件时交给应用保存副本，
 * 再把返回的图片或文件引用插在粘贴时的光标处。
 * 附件（内嵌图片与本机文件引用）与预览一样整块显示，光标靠近时也不展开原文：原文很长（附件副本的完整路径），
 * 展开后编辑很不方便。退格、删除与选中删除都按整个引用处理，查看与修改原文交给应用的附件弹窗（onAttachment）。
 * 输入 #标签 时在光标后以灰字提示已有标签，Tab 选用，上下键切换候选，Esc 关闭。
 */

import { fileLabel, filePath, isImageName, isLegacyToken } from './files';
import { placeAttachment, titleLine } from './insert';
import {
  codeLanguage,
  continueBlock,
  inCode,
  indentLines,
  linkWithAddress,
  setHeading,
  smartPaste,
  taskShorthand,
  toggleInline,
  toggleLink,
  toggleList,
  toggleQuote,
  toggleTag,
  toggleTask,
  wrapCodeBlock,
  type EditResult,
} from './markdown-commands';
import { comboFromEvent, commandFor, physicalKey, type ShortcutBindings, type ShortcutId } from './shortcuts';
import { bodyEnd } from './tags';

/** 行模型，保留各行原始换行符与首尾空白。 */
interface LineModel {
  text: string;
  start: number;
  end: number;
  eol: string;
}

/** 原文选区。 */
export interface SourceRange {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}

/** 编辑器中的附件：内嵌图片或本机文件的引用。 */
export interface EditorAttachment {
  kind: 'image' | 'file';
  /** 引用在原文中的范围 [start, end)。 */
  start: number;
  end: number;
  /** 引用的原文，如 `![截图](C:\…\a.png)`。 */
  source: string;
  /** 地址：本机文件的路径或图片网址，按原文的写法（去掉尖括号）。 */
  target: string;
  /** 图片的说明文字或文件引用的显示名称。 */
  label: string;
}

/** 创建选项。 */
export interface EditorOptions {
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number;
  /** 最大高度（像素），默认 380；null 表示不限，由外面的布局决定高度。 */
  maxHeight?: number | null;
  /** 原文变化时回调。 */
  onChange?: (value: string) => void;
  /** 需要应用层处理的图片预览请求；提供了 onAttachment 时不再使用。 */
  onPreviewImage?: (src: string, alt: string) => void;
  /**
   * 点击附件（内嵌图片或本机文件引用）。附件在编辑面中与预览一样整块显示、不展开原文，
   * 查看与修改原文、更换或打开文件都交给应用的附件弹窗；`event` 用于判断是否按住了 Ctrl。
   */
  onAttachment?: (attachment: EditorAttachment, event: MouseEvent) => void;
  /**
   * 标签联想候选：`prefix` 为 # 之后已输入的部分，`text` 为去掉这个标签后的原文，
   * 用于排除本条记录已有的标签。按优先顺序返回完整标签名。
   */
  tagSuggestions?: (prefix: string, text: string) => string[];
  /** 读取剪贴板文字，Ctrl+K 用剪贴板中的网址生成链接；未提供时按普通链接处理。 */
  readClipboard?: () => Promise<string>;
  /**
   * 粘贴截图或文件：由应用保存副本并返回要插入的 Markdown（图片或文件引用），
   * 编辑器把它插在粘贴时的光标处；返回 null 表示不插入。未提供时忽略粘贴的文件。
   */
  pasteFiles?: (files: File[]) => Promise<string | null>;
  /** 把本机图片路径换算为可显示的地址；未提供时本机图片只显示原文。 */
  resolveImage?: (path: string) => string;
  /** 设置中改过的快捷键，按键时读取，改动立即生效；未提供时全部使用默认按键（见 core/shortcuts）。 */
  shortcuts?: () => ShortcutBindings;
}

/** 一段隐藏的成对标记（行内代码、强调、下划线、链接）：分组范围、内容范围与各个标记的位置。 */
interface HiddenGroup {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  markers: Array<[number, number]>;
}

/** 正在显示的标签联想。 */
interface TagSuggestion {
  /** 标签位置与已输入内容，用于判断是否仍是同一个标签。 */
  key: string;
  /** # 所在位置。 */
  start: number;
  /** 光标位置，即已输入部分的末尾。 */
  caret: number;
  typed: string;
  candidates: string[];
  index: number;
}

/** 联想最多列出的候选数。 */
const MAX_TAG_SUGGESTIONS = 9;

/** 列表项或待办的项头：缩进、圆点或序号、空白与待办标记（与原型 clampToContent、removeListPrefix 相同）。 */
const LIST_PREFIX = /^(\s{0,3})([-+*]|\d+[.)])([\t ]+)(\[[ xX]\][\t ]+)?/;

/** 按行拆分，保留换行符种类。 */
function splitLines(value: string): LineModel[] {
  const result: LineModel[] = [];
  const endings = /\r\n|\r|\n/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = endings.exec(value))) {
    result.push({ text: value.slice(start, match.index), start, end: match.index, eol: match[0] });
    start = match.index + match[0].length;
  }
  result.push({ text: value.slice(start), start, end: value.length, eol: '' });
  return result;
}

/** 取得允许在编辑器内预览的图片地址；本机图片文件经 `resolve` 换算为可显示的地址。 */
function imageAddress(value: string, resolve?: (path: string) => string): string | null {
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?,/i.test(value)) return value;
  const path = filePath(value);
  if (path && !isLegacyToken(path)) return resolve && isImageName(path) ? resolve(path) : null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** 创建元素，只写入文本内容，不解析 HTML。 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 读取节点内的原文，忽略不参与映射的装饰节点。 */
function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.hasAttribute('data-md-decoration')) return '';
  if (el.tagName === 'BR') return '';
  let value = '';
  for (const child of Array.from(el.childNodes)) value += nodeText(child);
  return value;
}

/** 统计节点起点到选区端点之间的原文长度。 */
function pointLength(node: Node, target: Node, offset: number): { found: boolean; length: number } {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute('data-md-decoration')) {
    return { found: node === target || node.contains(target), length: 0 };
  }
  if (node === target) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { found: true, length: Math.min(offset, (node.nodeValue ?? '').length) };
    }
    let length = 0;
    const children = Array.from(node.childNodes);
    for (let index = 0; index < Math.min(offset, children.length); index += 1) {
      length += nodeText(children[index]).length;
    }
    return { found: true, length };
  }
  if (node.nodeType === Node.TEXT_NODE) return { found: false, length: (node.nodeValue ?? '').length };
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
    return { found: false, length: 0 };
  }
  let length = 0;
  for (const child of Array.from(node.childNodes)) {
    const part = pointLength(child, target, offset);
    length += part.length;
    if (part.found) return { found: true, length };
  }
  return { found: false, length };
}

/** 判断插入光标是否紧邻某段标记。 */
function markerVisible(caret: number | null, start: number, length: number): boolean {
  return caret !== null && caret >= start && caret <= start + length;
}

/** 当前聚焦的实例，供全局 selectionchange 复用。 */
let focusedEditor: MarkdownEditor | null = null;
let selectionFrame = 0;

/** 编辑面中按住附件（图片或文件块）准备拖动或正在拖动（原型 editor.js 的 pressAttachment）。 */
interface AttachmentDrag {
  node: HTMLElement;
  pointerId: number;
  /** 按下的位置。 */
  x: number;
  y: number;
  /** 附件引用在原文中的范围。 */
  start: number;
  end: number;
  /** 移动超过 4 像素后才算开始拖动；之前松开是单击，照常打开附件弹窗。 */
  active: boolean;
  /** 落点（按移动前的原文偏移计），-1 表示没有落点（在附件自身或范围之外）。 */
  target: number;
  bounds: { min: number; max: number; own: { start: number; end: number } } | null;
  ghost: HTMLDivElement | null;
  guide: HTMLDivElement | null;
  /** 拖影 left、top 为 0 时在屏幕上的位置（外层可能有位移）。 */
  origin: { x: number; y: number };
}

/** 同一时间只有一个附件在拖动。 */
let attachmentDrag: AttachmentDrag | null = null;
/** 从编辑面中拖动选中的文字：落在同一个编辑面时移到落点，不是复制一份。 */
let textDrag: { editor: MarkdownEditor; start: number; end: number } | null = null;

/** 文档中取视口坐标处的光标位置（Chromium 两种接口都有，旧版只有 caretRangeFromPoint）。 */
type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** 登记当前聚焦的实例。 */
function setFocusedEditor(editor: MarkdownEditor | null): void {
  focusedEditor = editor;
}

/** 当前聚焦的实例是否为指定对象。 */
function isFocusedEditor(editor: MarkdownEditor): boolean {
  return focusedEditor === editor;
}

if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', () => {
    if (!focusedEditor || selectionFrame) return;
    selectionFrame = window.requestAnimationFrame(() => {
      selectionFrame = 0;
      if (focusedEditor && !focusedEditor.element.isConnected) focusedEditor = null;
      focusedEditor?.selectionChanged();
    });
  });
}

/** 实时 Markdown 编辑控制器。 */
export class MarkdownEditor {
  /** 真正的可编辑表面。 */
  readonly element: HTMLDivElement;

  private options: EditorOptions;
  private value: string;
  private lines: LineModel[];
  /** 当前光标所在行，仅用于编辑态样式。 */
  private activeLine = -1;
  /** 当前可见标记的组合，用于判断是否需要重建排版。 */
  private markerState = '';
  private composing = false;
  /** Ctrl+Shift+V 按下期间的粘贴按纯文本处理，不做格式识别。 */
  private plainPaste = false;
  /** 正在显示的标签联想。 */
  private suggestion: TagSuggestion | null = null;
  /** 按 Esc 关闭或刚选用过的标签（位置与内容）；内容不变时不再提示。 */
  private dismissedTag = '';
  /** 组合结束的吸收阶段不追加中间撤销快照。 */
  private compositionEnding = false;
  private destroyed = false;
  /** 拖动附件松开后浏览器还会派发一次单击，不能当作点开附件。 */
  private suppressClick = false;
  /** 排版期间忽略选区事件。 */
  private rendering = false;
  private selection: SourceRange;
  private undoStack: Array<{ value: string; selection: SourceRange }> = [];
  private redoStack: Array<{ value: string; selection: SourceRange }> = [];
  private listeners: Array<[EventTarget, string, EventListener, boolean | AddEventListenerOptions]> = [];

  constructor(host: HTMLElement, options: EditorOptions = {}) {
    this.options = options;
    this.value = String(options.value ?? '');
    this.lines = splitLines(this.value);
    this.selection = { start: this.value.length, end: this.value.length, direction: 'none' };

    this.element = element('div', 'live-markdown-editor markdown-body');
    this.element.contentEditable = 'true';
    this.element.dataset.mdEditor = '';
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    this.setLabels(options.placeholder, options.ariaLabel);
    this.element.spellcheck = false;
    this.element.tabIndex = 0;
    if (typeof options.minHeight === 'number') this.element.style.minHeight = `${options.minHeight}px`;
    // null 表示不限高度：编辑器由外面的布局决定高度（速记浮窗填满标题区与底栏之间）。
    if (options.maxHeight !== null) this.element.style.maxHeight = `${options.maxHeight ?? 380}px`;
    this.element.style.overflowY = 'auto';
    this.element.style.whiteSpace = 'pre-wrap';
    this.element.style.overflowWrap = 'anywhere';

    host.append(this.element);
    this.bindEvents();
    this.render();
  }

  /* ==================== 对外接口 ==================== */

  /** 读取完整原文。 */
  getValue(): string {
    return this.value;
  }

  /** 设置外部原文。默认不触发 onChange，避免回写循环。 */
  setValue(value: string, options: { emit?: boolean } = {}): void {
    if (this.destroyed) return;
    const next = String(value ?? '');
    if (next === this.value) return;
    // 外部清空通常来自提交：先结束组合状态，避免旧 DOM 回写新值。
    if (this.composing) this.composing = false;
    this.value = next;
    this.selection = {
      start: Math.min(this.selection.start, next.length),
      end: Math.min(this.selection.end, next.length),
      direction: this.selection.direction,
    };
    this.activeLine = this.hasFocus() ? this.lineAt(this.selection.end) : -1;
    this.render(this.hasFocus() ? this.selection : null);
    if (options.emit) this.notify();
  }

  /** 聚焦并恢复原文选区。 */
  focus(options: FocusOptions = {}): void {
    if (this.destroyed) return;
    this.element.focus(options);
    this.setSelectionRange(this.selection.start, this.selection.end, this.selection.direction);
  }

  /**
   * 让光标出现在可见范围内：从编辑区往外，每一层可以滚动的容器都滚到光标那一行，上下留一点余量。
   * 进入编辑时光标放在正文末尾，正文长、编辑区出现滚动条时要滚过去，否则看不到光标在哪。
   */
  revealCaret(): void {
    if (this.destroyed) return;
    for (let node: HTMLElement | null = this.element; node; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight || !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
      const caret = this.caretRect(this.selection.end);
      if (!caret) return;
      const box = node.getBoundingClientRect();
      const margin = Math.min(caret.height * 1.5, node.clientHeight / 4);
      if (caret.top < box.top + margin) node.scrollTop -= box.top + margin - caret.top;
      else if (caret.top + caret.height > box.bottom - margin) node.scrollTop += caret.top + caret.height - (box.bottom - margin);
    }
  }

  /** 取消焦点。 */
  blur(): void {
    if (!this.destroyed) this.element.blur();
  }

  /** 按原文位置设置选区。 */
  setSelectionRange(start: number, end = start, direction: SourceRange['direction'] = 'none'): void {
    if (this.destroyed) return;
    const clamp = (value: number): number => Math.max(0, Math.min(Number(value) || 0, this.value.length));
    const next = { start: clamp(start), end: clamp(end), direction };
    if (next.start > next.end) next.start = next.end;
    this.selection = next;
    if (!this.composing) {
      this.activeLine = this.hasFocus()
        ? this.lineAt(direction === 'backward' ? next.start : next.end)
        : -1;
      if (this.markerKey() !== this.markerState) this.render();
    }
    this.restoreSelection(this.selection);
  }

  /** 读取当前原文选区。落在附件原文中间的端点移到引用之后（附件原文始终隐藏，光标不应停在里面）。 */
  readSelection(): SourceRange {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return this.selection;
    const anchor = this.sourceOffset(selection.anchorNode, selection.anchorOffset);
    const focus = this.sourceOffset(selection.focusNode, selection.focusOffset);
    if (anchor === null || focus === null) return this.selection;
    const snap = (offset: number): number => {
      for (const [from, to] of this.atomicRanges()) {
        if (offset > from && offset < to) return to;
      }
      return offset;
    };
    const [from, to] = [snap(anchor), snap(focus)];
    return {
      start: Math.min(from, to),
      end: Math.max(from, to),
      direction: from > to ? 'backward' : from < to ? 'forward' : 'none',
    };
  }

  /** 以原文片段替换选区。 */
  replace(text: string, range: SourceRange = this.readSelection()): void {
    this.remember(range);
    this.value = this.value.slice(0, range.start) + text + this.value.slice(range.end);
    const caret = range.start + text.length;
    this.selection = { start: caret, end: caret, direction: 'none' };
    this.activeLine = this.lineAt(caret);
    this.render(this.selection);
    this.notify();
  }

  /**
   * 应用编辑命令的结果：原文有变化时记入撤销历史，写回原文、恢复选区并通知变化。
   * 返回是否已处理；结果为 null 表示命令不适用，由调用方按默认方式处理。
   */
  applyEdit(result: EditResult | null, before: SourceRange = this.readSelection()): boolean {
    if (!result || this.destroyed) return false;
    const changed = result.value !== this.value;
    if (changed) this.remember(before);
    this.value = result.value;
    this.selection = { start: result.start, end: result.end, direction: 'none' };
    this.activeLine = this.lineAt(result.end);
    this.render(this.selection);
    if (changed) this.notify();
    return true;
  }

  /**
   * 插入附件引用（原型第二版的插入规则，见 core/insert）：标签行始终在最后；落在标题行上时作为单独一行插在标题之后；
   * 其余插在 `range`（默认当前选区）处。可以撤销。
   */
  insertAttachment(markdown: string, range: SourceRange = this.readSelection()): void {
    const placed = placeAttachment(this.value, markdown, range);
    this.applyEdit({ value: placed.text, start: placed.caret, end: placed.caret }, range);
  }

  /** 记录当前状态用于撤销。拖放等外部插入在修改前调用。 */
  /** 视口坐标处的原文位置（拖放的落点）；取不到时是末尾。 */
  offsetAt(x: number, y: number): number {
    const doc = document as CaretDocument;
    const point = doc.caretPositionFromPoint?.(x, y) ?? null;
    const range = point ? null : (doc.caretRangeFromPoint?.(x, y) ?? null);
    const offset = point
      ? this.sourceOffset(point.offsetNode, point.offset)
      : range
        ? this.sourceOffset(range.startContainer, range.startOffset)
        : null;
    return offset === null ? this.value.length : offset;
  }

  /**
   * 把一段原文移到另一个位置（编辑面中拖动选中的文字），记入撤销历史；落点在这段原文之内时不动。
   * @param target 落点，按移动前的原文计。
   */
  moveText(start: number, end: number, target: number): boolean {
    if (!(end > start) || (target >= start && target <= end)) return false;
    const text = this.value.slice(start, end);
    if (!text) return false;
    this.remember({ start, end, direction: 'none' });
    const rest = this.value.slice(0, start) + this.value.slice(end);
    const at = target > end ? target - text.length : target;
    this.value = rest.slice(0, at) + text + rest.slice(at);
    const caret = at + text.length;
    this.selection = { start: caret, end: caret, direction: 'none' };
    this.activeLine = this.lineAt(caret);
    this.render(this.selection);
    this.notify();
    return true;
  }

  remember(selection: SourceRange): void {
    this.undoStack.push({ value: this.value, selection: { ...selection } });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** 把 DOM 选区端点换算为原文偏移。 */
  sourceOffset(target: Node | null, offset: number): number | null {
    if (!target) return null;
    if (target !== this.element && !this.element.contains(target)) return null;
    const children = Array.from(this.element.childNodes);
    if (target === this.element) {
      let length = 0;
      for (let index = 0; index < Math.min(offset, children.length); index += 1) {
        length += nodeText(children[index]).length + this.domEnding(children[index], index, children.length).length;
      }
      return length;
    }
    let length = 0;
    for (let index = 0; index < children.length; index += 1) {
      const part = pointLength(children[index], target, offset);
      if (part.found) return length + part.length;
      length += part.length + this.domEnding(children[index], index, children.length).length;
    }
    return length;
  }

  /** 释放实例并移除所有监听。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (isFocusedEditor(this)) setFocusedEditor(null);
    for (const [target, type, handler, options] of this.listeners) {
      target.removeEventListener(type, handler, options);
    }
    this.listeners = [];
    this.element.remove();
  }

  /** 更新高度上限，设置变化时调用。 */
  setMaxHeight(value: number): void {
    this.element.style.maxHeight = `${value}px`;
  }

  /** 更新占位提示与无障碍名称；提示中写有快捷键，更换按键后随之更新。 */
  setLabels(placeholder?: string, ariaLabel?: string): void {
    const text = placeholder ?? '写下内容…';
    this.element.dataset.placeholder = text;
    this.element.setAttribute('aria-label', ariaLabel ?? text);
  }

  /** 选区变化时同步状态；仅在标记边界或所在行变化时重排，否则只更新标签联想。 */
  selectionChanged(): void {
    if (this.destroyed || this.rendering || this.composing || !this.hasFocus()) return;
    const previous = this.selection;
    this.selection = this.readSelection();
    const clamped = this.clampToContent(this.selection, previous);
    if (clamped) {
      this.selection = clamped;
      this.restoreSelection(clamped);
    }
    this.activeLine = this.lineAt(
      this.selection.direction === 'backward' ? this.selection.start : this.selection.end,
    );
    if (this.markerKey() !== this.markerState) this.render(this.selection);
    else this.refreshSuggestion();
  }

  /**
   * 光标落在列表项或待办的项头上（圆点、序号或复选框之前）时移到正文开头：项头不能编辑，只能整体删去（原型 clampToContent）。
   * 从正文开头往左移时跳到上一行末尾；选中一段文字时不处理；代码块里的「- 」不是列表。
   */
  private clampToContent(next: SourceRange, previous: SourceRange | null): SourceRange | null {
    if (next.start !== next.end) return null;
    const lines = splitLines(this.value);
    const index = this.lineAt(next.end);
    const line = lines[index];
    const item = line?.text.match(LIST_PREFIX);
    if (!line || !item || inCode(this.value, line.start)) return null;
    const content = line.start + item[0].length;
    if (next.end >= content) return null;
    const leaving = Boolean(previous) && previous!.start === previous!.end && previous!.end === content && index > 0;
    const caret = leaving ? lines[index - 1].end : content;
    return { start: caret, end: caret, direction: 'none' };
  }

  /** 光标在列表项或待办的正文开头时，退格删去项头（保留缩进），这一行变回普通文字（原型 removeListPrefix）。 */
  private removeListPrefix(caret: number): boolean {
    if (inCode(this.value, caret)) return false;
    const line = splitLines(this.value)[this.lineAt(caret)];
    const item = line?.text.match(LIST_PREFIX);
    if (!line || !item || caret !== line.start + item[0].length) return false;
    this.replace('', { start: line.start + item[1].length, end: caret, direction: 'none' });
    return true;
  }

  /* ==================== 私有：选区与原文映射 ==================== */

  /** 本实例是否拥有输入焦点。 */
  private hasFocus(): boolean {
    return document.activeElement === this.element || this.element.contains(document.activeElement);
  }

  /** 查找原文位置所属行。 */
  private lineAt(offset: number): number {
    const lines = splitLines(this.value);
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (offset < lines[index + 1].start) return index;
    }
    return lines.length - 1;
  }

  /** 读取当前 DOM 中的原文，包含输入法尚未排版的内容。 */
  private readDOM(): string {
    let result = '';
    const children = Array.from(this.element.childNodes);
    for (let index = 0; index < children.length; index += 1) {
      result += nodeText(children[index]);
      result += this.domEnding(children[index], index, children.length);
    }
    return result;
  }

  /** 读取块间实际换行，兼容输入法删除跨行选区后的 DOM 合并。 */
  private domEnding(child: Node, index: number, count: number): string {
    if (index >= count - 1) return '';
    if (child.nodeType === Node.ELEMENT_NODE) {
      const eol = (child as HTMLElement).dataset.eol;
      if (eol) return eol;
    }
    return (this.value.match(/\r\n|\r|\n/) ?? ['\n'])[0];
  }

  /**
   * 找到原文偏移对应的可编辑位置。
   * 附件的原文始终隐藏，位置落在引用开头时放在原文节点之前，落在引用之中或末尾时放在附件块之后，
   * 不把光标放进看不见的节点。
   */
  private domPoint(offset: number): { node: Node; offset: number } {
    const index = this.lineAt(offset);
    const line = this.element.children[index];
    if (!line) return { node: this.element, offset: this.element.childNodes.length };
    let remaining = Math.max(0, Math.min(offset - this.lines[index].start, this.lines[index].text.length));
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node) =>
        node.parentElement?.closest('[data-md-decoration]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const childPoint = (child: Node, after: boolean): { node: Node; offset: number } => {
      const parent = child.parentNode as Node;
      return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, child) + (after ? 1 : 0) };
    };
    let node: Node | null;
    let last: { node: Node; offset: number } | null = null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      // 列表与待办的项头一直隐藏（原型第二版，data-md-locked），光标不能落在里面：项头两端与中间的位置
      // 都改放到这个元素之外，中间的位置按正文开头处理（与 clampToContent 一致）。
      const locked = text.parentElement?.closest<HTMLElement>('[data-md-locked]');
      if (locked) {
        if (remaining <= 0) return childPoint(locked, false);
        if (remaining <= text.length) return childPoint(locked, true);
        remaining -= text.length;
        last = childPoint(locked, true);
        continue;
      }
      // 显示出来的列表项头是 inline-block（占满悬挂缩进），光标落在它里面时浏览器的 Home、End 只在
      // 项头这一小块内移动，光标也画在项头文字之后而不是正文开头。项头两端的位置改放到这个元素之外。
      const listMarker = text.parentElement?.closest<HTMLElement>('.md-list-marker.is-revealed');
      if (listMarker) {
        if (remaining <= 0) return childPoint(listMarker, false);
        if (remaining < text.length) return { node: text, offset: remaining };
        remaining -= text.length;
        last = childPoint(listMarker, true);
        continue;
      }
      const atomic = text.parentElement?.closest<HTMLElement>('.md-attachment-source');
      if (atomic) {
        if (remaining <= 0) return childPoint(atomic, false);
        const chip = atomic.nextElementSibling?.matches('[data-md-attachment]') ? atomic.nextElementSibling : atomic;
        if (remaining <= text.length) return childPoint(chip, true);
        remaining -= text.length;
        last = childPoint(chip, true);
        continue;
      }
      if (remaining <= text.length) return { node: text, offset: remaining };
      remaining -= text.length;
      last = { node: text, offset: text.length };
    }
    return last ?? { node: line, offset: 0 };
  }

  /** 排版后恢复原文选区，保留反向选择。 */
  private restoreSelection(saved: SourceRange): void {
    if (!this.hasFocus() || this.composing || !this.element.isConnected) return;
    const selection = window.getSelection();
    if (!selection) return;
    const start = this.domPoint(saved.start);
    const end = this.domPoint(saved.end);
    const backward = saved.direction === 'backward';
    if (selection.setBaseAndExtent) {
      selection.setBaseAndExtent(
        backward ? end.node : start.node,
        backward ? end.offset : start.offset,
        backward ? start.node : end.node,
        backward ? start.offset : end.offset,
      );
    } else {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /** 当前隐藏的成对标记，按分组从内到外排列：完整选中链接中的加粗文字时，两层标记一并处理。 */
  private hiddenGroups(): HiddenGroup[] {
    const groups = new Map<string, HiddenGroup>();
    for (const node of Array.from(
      this.element.querySelectorAll<HTMLElement>('.md-syntax.is-hidden[data-md-group-start]'),
    )) {
      const start = Number(node.dataset.mdGroupStart);
      const end = Number(node.dataset.mdGroupEnd);
      const markerStart = Number(node.dataset.mdStart);
      const markerEnd = Number(node.dataset.mdEnd);
      const key = `${start}:${end}`;
      const group = groups.get(key) ?? { start, end, contentStart: start, contentEnd: end, markers: [] };
      if (markerStart === start) group.contentStart = markerEnd;
      if (markerEnd === end) group.contentEnd = markerStart;
      group.markers.push([markerStart, markerEnd]);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((left, right) => left.end - left.start - (right.end - right.start));
  }

  /**
   * 按所见内容换算选区：返回实际处理的原文范围，以及其中必须保留的隐藏标记。
   *
   * 隐藏的标记看不见，删除或改写选中的文字时不能只删掉其中一半，否则会留下 `](地址)` 这样的残缺语法：
   * - `expand` 为真（删除、剪切、复制）时，完整选中一段格式的文字即视为选中整段，连同标记一起处理，
   *   使「选中整个链接删除」删掉全部原文、「完整复制链接」保留方括号，与原型一致；
   * - 选区只覆盖一段格式的一部分时，保留落在选区里的隐藏标记，只处理可见的文字。
   * 已展开的标记用户看得见，照常按原文处理。
   */
  private visibleSpan(range: SourceRange, expand: boolean): { start: number; end: number; kept: Array<[number, number]> } {
    if (range.start === range.end) return { start: range.start, end: range.end, kept: [] };
    // 附件整块显示，选区碰到它就按整个引用处理。
    let { start, end } = this.atomicRange(range);
    const groups = this.hiddenGroups();
    if (expand) {
      for (const group of groups) {
        if (
          group.contentStart < group.contentEnd &&
          start <= group.contentStart &&
          end >= group.contentEnd &&
          start < group.end &&
          end > group.start
        ) {
          start = Math.min(start, group.start);
          end = Math.max(end, group.end);
        }
      }
    }
    const kept: Array<[number, number]> = [];
    for (const group of groups) {
      // 整段格式都在范围内时，标记随内容一起处理。
      if (group.start >= start && group.end <= end) continue;
      for (const [markerStart, markerEnd] of group.markers) {
        const from = Math.max(markerStart, start);
        const to = Math.min(markerEnd, end);
        if (from < to) kept.push([from, to]);
      }
    }
    kept.sort((left, right) => left[0] - right[0]);
    return { start, end, kept };
  }

  /** 选区中用户看得见的原文：去掉需要保留的隐藏标记，用于复制与剪切。 */
  private visibleText(range: SourceRange): string {
    const span = this.visibleSpan(range, true);
    let text = '';
    let cursor = span.start;
    for (const [from, to] of span.kept) {
      text += this.value.slice(cursor, from);
      cursor = to;
    }
    return text + this.value.slice(cursor, span.end);
  }

  /**
   * 用文字替换选区，保留不能拆开的隐藏标记，光标落在插入的文字之后。
   * `expand` 见 visibleSpan：删除时完整选中的格式整段删除，输入或粘贴时只替换其中的文字。
   */
  private replaceVisible(text: string, range: SourceRange, expand: boolean): EditResult {
    const span = this.visibleSpan(range, expand);
    const kept = span.kept.map(([from, to]) => this.value.slice(from, to)).join('');
    const caret = span.start + text.length;
    return {
      value: this.value.slice(0, span.start) + text + kept + this.value.slice(span.end),
      start: caret,
      end: caret,
    };
  }

  /* ==================== 私有：排版 ==================== */

  /**
   * 决定标记是否展开的位置：插入光标所在处；选中文字时取选区的起点（锚点）。
   * 在已展开的原文里拖动、双击选词或按 Shift 扩选时，锚点仍在这段标记中，标记保持展开，便于修改；
   * 从渲染后的文字开始选择时，经过的标记保持隐藏，删除时按所见内容处理（见 visibleSpan）。
   * 全选时保持渲染效果。
   */
  private markerCaret(): number | null {
    if (!this.hasFocus()) return null;
    const { start, end, direction } = this.selection;
    if (start === end) return start;
    if (start === 0 && end === this.value.length) return null;
    return direction === 'backward' ? end : start;
  }

  /** 计算当前行与可见标记的标识。 */
  private markerKey(): string {
    const caret = this.markerCaret();
    let key = `${this.activeLine}|`;
    for (const node of Array.from(this.element.querySelectorAll<HTMLElement>('.md-syntax:not([data-md-locked])'))) {
      const start = Number(node.dataset.mdRevealStart ?? node.dataset.mdStart);
      const end = Number(node.dataset.mdRevealEnd ?? node.dataset.mdEnd);
      if (markerVisible(caret, start, end - start)) key += `${start}:${end};`;
    }
    return key;
  }

  /**
   * 为原文标记生成可折叠节点；`extra` 为附加类名，供样式区分标记种类。
   * `locked` 的标记一直隐藏、不随光标展开：列表项头与待办标记由圆点、序号与复选框代替（原型第二版）。
   */
  private syntax(
    parent: HTMLElement,
    text: string,
    caret: number | null,
    start = 0,
    range: { start: number; end: number } | null = null,
    extra = '',
    locked = false,
  ): void {
    if (!text) return;
    const revealed =
      !locked &&
      (range ? markerVisible(caret, range.start, range.end - range.start) : markerVisible(caret, start, text.length));
    const node = element('span', `md-syntax ${revealed ? 'is-revealed' : 'is-hidden'}${extra ? ` ${extra}` : ''}`, text);
    node.dataset.mdStart = String(start);
    node.dataset.mdEnd = String(start + text.length);
    node.dataset.mdRevealStart = String(range ? range.start : start);
    node.dataset.mdRevealEnd = String(range ? range.end : start + text.length);
    if (range) {
      node.dataset.mdGroupStart = String(range.start);
      node.dataset.mdGroupEnd = String(range.end);
    }
    if (locked) node.dataset.mdLocked = '';
    node.hidden = !revealed;
    if (!revealed) node.setAttribute('aria-hidden', 'true');
    parent.append(node);
  }

  /** 添加不参与原文映射的视觉装饰。 */
  private decoration(parent: HTMLElement, className: string, text: string): void {
    const node = element('span', className, text);
    node.dataset.mdDecoration = '';
    node.contentEditable = 'false';
    node.setAttribute('aria-hidden', 'true');
    parent.append(node);
  }

  /**
   * 附件整块显示：原文放在始终隐藏的节点中参与光标映射，后面跟一个不可编辑的图片或文件块，
   * 与卡片预览的样式一致。`address` 为图片的显示地址，文件引用传 null。
   */
  private attachment(parent: HTMLElement, attachment: Omit<EditorAttachment, 'end'>, address: string | null): void {
    const end = attachment.start + attachment.source.length;
    const source = element('span', 'md-attachment-source', attachment.source);
    source.hidden = true;
    source.setAttribute('aria-hidden', 'true');
    source.dataset.mdStart = String(attachment.start);
    source.dataset.mdEnd = String(end);
    parent.append(source);

    const isImage = attachment.kind === 'image';
    // 图片与文件块都是按钮（原型 md-editor-image、md-attachment-chip）；不用原生拖放，按住移动由 pressAttachment 处理。
    const chip = element('button', isImage ? 'md-editor-image' : 'md-attachment-chip');
    chip.type = 'button';
    chip.tabIndex = -1;
    chip.draggable = false;
    chip.contentEditable = 'false';
    chip.dataset.mdDecoration = '';
    chip.dataset.mdAttachment = attachment.kind;
    chip.dataset.mdStart = String(attachment.start);
    chip.dataset.mdEnd = String(end);
    chip.dataset.mdTarget = attachment.target;
    chip.dataset.mdLabel = attachment.label;
    if (isImage && address) {
      chip.dataset.mdPreview = address;
      chip.setAttribute('aria-label', `图片：${attachment.label || '图片'}`);
      const picture = element('img', 'markdown-image');
      picture.src = address;
      picture.alt = attachment.label;
      picture.loading = 'lazy';
      picture.draggable = false;
      chip.append(picture);
    } else {
      chip.setAttribute('aria-label', `文件：${attachment.label}`);
      // 文件图标取页面中的图标定义（侧栏与速记浮窗都挂载了 IconSprite）。
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'icon');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-file');
      icon.append(use);
      chip.append(icon, element('span', '', attachment.label));
    }
    parent.append(chip);
  }

  /* ==================== 拖动附件调整位置（原型第二版） ==================== */

  /**
   * 按住编辑面中的图片或文件块：移动 4 像素后开始拖动，松开时移到插入光标处；没有移动就是单击，照常打开附件弹窗。
   * 不用浏览器的原生拖放：按下附件时要阻止默认行为，光标与焦点才不会被附件夺走（见 mousedown），原生拖放因此无法开始。
   * Esc 取消拖动，不退出编辑。
   */
  private pressAttachment(event: PointerEvent): void {
    const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-md-attachment]') : null;
    if (!node || !this.element.contains(node) || event.button !== 0 || attachmentDrag || this.composing) return;
    if (this.element.contentEditable === 'false') return;
    const start = Number(node.dataset.mdStart);
    const end = Number(node.dataset.mdEnd);
    if (!(end > start) || !this.value.slice(start, end).trim()) return;
    const drag: AttachmentDrag = {
      node,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start,
      end,
      active: false,
      target: -1,
      bounds: null,
      ghost: null,
      guide: null,
      origin: { x: 0, y: 0 },
    };
    attachmentDrag = drag;
    const move = (next: Event): void => {
      if ((next as PointerEvent).pointerId === drag.pointerId) this.moveAttachmentDrag(drag, next as PointerEvent);
    };
    const stop = (last: Event): void => {
      if (last.type === 'keydown') {
        const key = last as KeyboardEvent;
        if (key.key !== 'Escape') return;
        if (drag.active) {
          key.preventDefault();
          key.stopPropagation();
        }
      } else if ((last as PointerEvent).pointerId !== drag.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('keydown', stop, true);
      this.endAttachmentDrag(drag, last.type === 'pointerup');
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('pointercancel', stop, true);
    window.addEventListener('keydown', stop, true);
  }

  /**
   * 拖动中：插入光标落在指针处的字符之间；指针靠近编辑区上下边缘时滚动。
   * 拖影的左上角跟着指针，拿起时从原处平滑移到指针的右下方，插入光标与它左边、上面的字不被挡；
   * 拖影放在编辑区的前面、垫在文字下面并半透明，与它重叠的字也能看清，插入光标在最上层。
   */
  private moveAttachmentDrag(drag: AttachmentDrag, event: PointerEvent): void {
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 || !drag.node.isConnected) return;
      drag.active = true;
      const box = drag.node.getBoundingClientRect();
      const grab = { x: drag.x - box.left, y: drag.y - box.top };
      drag.bounds = this.attachmentBounds(drag);
      const ghost = element('div', 'md-drag-ghost is-under-text');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.append(drag.node.cloneNode(true));
      // 插入光标：一条强调色的竖线，上端一个小圆点（与标签页的插入线同一种样子），落在字符之间。
      const guide = element('div', 'md-drop-caret');
      guide.hidden = true;
      // 拖影的定位原点：侧栏与记录窗口的外层可能有位移，先量出 left、top 为 0 时落在屏幕上的哪里。
      const probe = element('span', 'md-drag-probe');
      this.element.before(probe);
      const origin = probe.getBoundingClientRect();
      probe.remove();
      drag.origin = { x: origin.left, y: origin.top };
      ghost.style.setProperty('--local-ghost-x', `${-grab.x}px`);
      ghost.style.setProperty('--local-ghost-y', `${-grab.y}px`);
      this.element.before(ghost);
      this.element.classList.add('is-attachment-drop');
      document.body.append(guide);
      // 下一帧移到指针的右下方（过渡在样式里）。
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          ghost.style.setProperty('--local-ghost-x', 'var(--sn-space-3)');
          ghost.style.setProperty('--local-ghost-y', 'var(--sn-space-4)');
        }),
      );
      drag.ghost = ghost;
      drag.guide = guide;
      drag.node.classList.add('is-drag-source');
      document.body.classList.add('is-dragging-attachment');
    }
    event.preventDefault();
    const { ghost, guide, bounds } = drag;
    if (!ghost || !guide || !bounds) return;
    ghost.style.left = `${event.clientX - drag.origin.x}px`;
    ghost.style.top = `${event.clientY - drag.origin.y}px`;
    const box = this.element.getBoundingClientRect();
    const edge = 24;
    if (this.element.scrollHeight > this.element.clientHeight) {
      if (event.clientY < box.top + edge) this.element.scrollTop -= Math.ceil((box.top + edge - event.clientY) / 3);
      else if (event.clientY > box.bottom - edge) this.element.scrollTop += Math.ceil((event.clientY - box.bottom + edge) / 3);
    }
    // 指针处的原文位置，限制在标题行之后、正文末尾之前；落在附件自身（含紧挨着的空白）等于没动，不显示插入光标。
    const target = Math.max(bounds.min, Math.min(bounds.max, this.offsetAt(event.clientX, event.clientY)));
    drag.target = target >= bounds.own.start && target <= bounds.own.end ? -1 : target;
    const caret = drag.target < 0 ? null : this.caretRect(drag.target);
    if (!caret) {
      guide.hidden = true;
      return;
    }
    guide.hidden = caret.top + caret.height < box.top - 1 || caret.top > box.bottom + 1;
    guide.style.left = `${caret.left}px`;
    guide.style.top = `${caret.top}px`;
    guide.style.height = `${caret.height}px`;
  }

  /** 原文偏移在屏幕上的位置（插入光标）：这个位置的文字矩形；紧挨着图片、文件块或空行时取它们的边缘。 */
  private caretRect(offset: number): { left: number; top: number; height: number } | null {
    const line = this.element.children[this.lineAt(offset)];
    if (!line) return null;
    const widget = Array.from(line.querySelectorAll<HTMLElement>('[data-md-attachment]')).find(
      (node) => Number(node.dataset.mdStart) === offset || Number(node.dataset.mdEnd) === offset,
    );
    if (widget) {
      const box = widget.getBoundingClientRect();
      return { left: Number(widget.dataset.mdStart) === offset ? box.left : box.right, top: box.top, height: box.height };
    }
    const point = this.domPoint(offset);
    const range = document.createRange();
    try {
      range.setStart(point.node, point.offset);
      range.collapse(true);
    } catch {
      return null;
    }
    const rect = Array.from(range.getClientRects()).find((item) => item.height > 0);
    if (rect) return { left: rect.left, top: rect.top, height: rect.height };
    const box = line.getBoundingClientRect();
    return { left: box.left, top: box.top, height: box.height };
  }

  /**
   * 附件可以放的范围（按移动前的原文偏移计）：标题行之后、正文末尾之前，标题与标签不变（与插入附件的规则一致）；
   * 附件自身连同紧挨着的空白算作原处。标题与正文末尾按去掉附件后的原文找，再换回移动前的偏移。
   */
  private attachmentBounds(drag: AttachmentDrag): { min: number; max: number; own: { start: number; end: number } } {
    const length = drag.end - drag.start;
    const remaining = this.value.slice(0, drag.start) + this.value.slice(drag.end);
    const original = (offset: number): number => (offset < drag.start ? offset : offset + length);
    const title = titleLine(remaining);
    // 标题行之后：下一行的开头；标题后面没有换行时（只有标题一行）是标题行末尾，松开时另起一行。
    const next = title ? /^(?:\r\n|\r|\n)/.exec(remaining.slice(title.end)) : null;
    const min = title ? title.end + (next ? next[0].length : 0) : 0;
    const max = bodyEnd(remaining);
    let ownStart = drag.start;
    let ownEnd = drag.end;
    while (ownStart > 0 && /[\t ]/.test(this.value[ownStart - 1])) ownStart -= 1;
    while (ownEnd < this.value.length && /[\t ]/.test(this.value[ownEnd])) ownEnd += 1;
    return { min: original(min), max: Math.max(original(min), original(max)), own: { start: ownStart, end: ownEnd } };
  }

  /** 结束拖动：松开时移动附件，取消或没有落点时不改动。 */
  private endAttachmentDrag(drag: AttachmentDrag, commit: boolean): void {
    attachmentDrag = null;
    if (!drag.active) return;
    drag.ghost?.remove();
    drag.guide?.remove();
    this.element.classList.remove('is-attachment-drop');
    drag.node.classList.remove('is-drag-source');
    document.body.classList.remove('is-dragging-attachment');
    // 松开后浏览器还会派发一次单击，不能当作点开附件。
    this.suppressClick = true;
    window.setTimeout(() => {
      this.suppressClick = false;
    }, 0);
    if (!commit || drag.target < 0 || this.destroyed) return;
    if (!this.hasFocus()) this.element.focus({ preventScroll: true });
    this.moveAttachment(drag.start, drag.end, drag.target);
  }

  /**
   * 把附件引用移到字符位置 target（落点精确到字符），记入撤销历史。
   * 原来那一行只剩空白或列表、引用标记时整行删掉；夹在两个空格之间时去掉一个，免得留下双空格。
   * 落点在标题行末尾（只有标题一行）时另起一行，标题不变。
   * @param target 落点，按移动前的原文偏移计。
   */
  private moveAttachment(start: number, end: number, target: number): boolean {
    const text = this.value.slice(start, end).trim();
    if (!text) return false;
    const lines = splitLines(this.value);
    const eol = (this.value.match(/\r\n|\r|\n/) ?? ['\n'])[0];
    const index = this.lineAt(start);
    const line = lines[index];
    const rest = line.text.slice(0, start - line.start) + line.text.slice(end - line.start);
    let cutStart = start;
    let cutEnd = end;
    if (!rest.replace(/^\s{0,3}(?:(?:[-+*]|\d+[.)])\s*(?:\[[ xX]\]\s*)?|>\s*)/, '').trim()) {
      cutStart = line.start;
      cutEnd = line.end + line.eol.length;
      if (!line.eol && index > 0) cutStart -= lines[index - 1].eol.length;
      // 这一行前后都是空行时一并去掉后面那个，免得留下连着的两行空白。
      const previous = lines[index - 1];
      const following = lines[index + 1];
      if (line.eol && previous && !previous.text.trim() && following && !following.text.trim()) {
        cutEnd = following.end + following.eol.length;
      }
    } else if (this.value[start - 1] === ' ' && this.value[end] === ' ') cutEnd += 1;
    if (target > cutStart && target < cutEnd) return false;
    const remaining = this.value.slice(0, cutStart) + this.value.slice(cutEnd);
    const position = Math.min(remaining.length, target >= cutEnd ? target - (cutEnd - cutStart) : target);
    const title = titleLine(remaining);
    const intoTitle = Boolean(title && position <= title.end);
    const insert = intoTitle ? eol + text : text;
    const at = intoTitle && title ? title.end : position;
    this.remember({ start, end, direction: 'none' });
    this.value = remaining.slice(0, at) + insert + remaining.slice(at);
    const caret = at + insert.length;
    this.selection = { start: caret, end: caret, direction: 'none' };
    this.activeLine = this.lineAt(caret);
    this.render(this.selection);
    this.notify();
    return true;
  }

  /** 当前渲染出的附件在原文中的范围。 */
  private atomicRanges(): Array<[number, number]> {
    return Array.from(this.element.querySelectorAll<HTMLElement>('.md-attachment-source')).map((node) => [
      Number(node.dataset.mdStart),
      Number(node.dataset.mdEnd),
    ]);
  }

  /** 范围碰到附件的原文时扩展到整个引用，删除或替换时不留下半截语法。 */
  private atomicRange(range: SourceRange): SourceRange {
    let { start, end } = range;
    for (const [from, to] of this.atomicRanges()) {
      if (from < end && start < to) {
        start = Math.min(start, from);
        end = Math.max(end, to);
      }
    }
    return { ...range, start, end };
  }

  /** 读取附件块上记下的信息；原文已变化（位置对不上）时返回 null。 */
  private attachmentInfo(chip: HTMLElement): EditorAttachment | null {
    const start = Number(chip.dataset.mdStart);
    const end = Number(chip.dataset.mdEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || end > this.value.length) return null;
    return {
      kind: chip.dataset.mdAttachment === 'image' ? 'image' : 'file',
      start,
      end,
      source: this.value.slice(start, end),
      target: chip.dataset.mdTarget ?? '',
      label: chip.dataset.mdLabel ?? '',
    };
  }

  /** 查找行内定界符，忽略转义与反引号歧义。 */
  private closingMarker(text: string, marker: string, start: number): number {
    let end = text.indexOf(marker, start);
    while (end >= 0) {
      const escaped = /(?:^|[^\\])(?:\\\\)*\\$/.test(text.slice(0, end));
      const ticks = marker[0] === '`';
      const valid = ticks
        ? text[end - 1] !== '`' && text[end + marker.length] !== '`'
        : end > start && !/\s/.test(text[end - 1] ?? '');
      if (!escaped && valid) return end;
      end = text.indexOf(marker, end + marker.length);
    }
    return -1;
  }

  /** 渲染行内格式，所有原始字符仍保留在 DOM 中。 */
  private renderInline(
    text: string,
    parent: HTMLElement,
    caret: number | null,
    start = 0,
    depth = 0,
  ): void {
    if (depth > 8) {
      parent.append(document.createTextNode(text));
      return;
    }
    let index = 0;
    let plain = '';
    const flush = (): void => {
      if (plain) parent.append(document.createTextNode(plain));
      plain = '';
    };

    while (index < text.length) {
      const character = text[index];

      if (character === '\\' && /[\\`*_{}[\]()#+.!~>-]/.test(text[index + 1] ?? '')) {
        flush();
        this.syntax(parent, '\\', caret, start + index);
        parent.append(document.createTextNode(text[index + 1]));
        index += 2;
        continue;
      }

      if (character === '`') {
        const marker = (text.slice(index).match(/^`+/) ?? ['`'])[0];
        const end = this.closingMarker(text, marker, index + marker.length);
        if (end >= 0) {
          flush();
          const group = { start: start + index, end: start + end + marker.length };
          this.syntax(parent, marker, caret, start + index, group);
          parent.append(element('code', 'md-inline-code', text.slice(index + marker.length, end)));
          this.syntax(parent, marker, caret, start + end, group);
          index = end + marker.length;
          continue;
        }
      }

      // Typora 写法的下划线 <u>…</u>：只识别这一对标签，其余 HTML 仍按文字显示。
      if (character === '<' && text.slice(index, index + 3).toLowerCase() === '<u>') {
        const close = text.toLowerCase().indexOf('</u>', index + 3);
        if (close > index + 3) {
          flush();
          const group = { start: start + index, end: start + close + 4 };
          this.syntax(parent, text.slice(index, index + 3), caret, start + index, group);
          const underline = element('u');
          this.renderInline(text.slice(index + 3, close), underline, caret, start + index + 3, depth + 1);
          parent.append(underline);
          this.syntax(parent, text.slice(close, close + 4), caret, start + close, group);
          index = close + 4;
          continue;
        }
      }

      if (character === '*' || character === '_' || character === '~') {
        const markers: string[] =
          character !== '~' && text.slice(index, index + 3) === character.repeat(3)
            ? [character.repeat(3), character.repeat(2)]
            : text[index + 1] === character
              ? [character + character]
              : [];
        if (character !== '~') markers.push(character);
        let consumed = false;
        for (const marker of markers) {
          const contentStart = index + marker.length;
          if (!text[contentStart] || /\s/.test(text[contentStart])) continue;
          const end = this.closingMarker(text, marker, contentStart);
          if (end < 0) continue;
          flush();
          const group = { start: start + index, end: start + end + marker.length };
          this.syntax(parent, marker, caret, start + index, group);
          const formatted = element(marker === '~~' ? 'del' : marker.length > 1 ? 'strong' : 'em');
          const content = marker.length === 3 ? element('em') : formatted;
          this.renderInline(text.slice(contentStart, end), content, caret, start + contentStart, depth + 1);
          if (content !== formatted) formatted.append(content);
          parent.append(formatted);
          this.syntax(parent, marker, caret, start + end, group);
          index = end + marker.length;
          consumed = true;
          break;
        }
        if (consumed) continue;
      }

      const isImage = character === '!' && text[index + 1] === '[';
      if (isImage || character === '[') {
        const labelStart = index + (isImage ? 2 : 1);
        const labelEnd = text.indexOf('](', labelStart);
        if (labelEnd >= 0) {
          let end = labelEnd + 2;
          let level = 1;
          // 尖括号包住的地址（路径含空白或括号时的写法）到「>)」为止，中间的括号与反斜杠按原样保留。
          const angled = text[end] === '<' ? text.indexOf('>)', end + 1) : -1;
          if (angled >= 0) {
            end = angled + 2;
            level = 0;
          }
          while (end < text.length && level > 0) {
            if (text[end] === '\\') {
              end += 2;
              continue;
            }
            if (text[end] === '(') level += 1;
            if (text[end] === ')') level -= 1;
            end += 1;
          }
          if (!level) {
            const label = text.slice(labelStart, labelEnd);
            const target = text
              .slice(labelEnd + 2, end - 1)
              .trim()
              .replace(/^<|>$/g, '');
            const shown = label.replace(/\\([\\[\]])/g, '$1');
            if (isImage) {
              // 图片整块显示（见 attachment），原文只参与光标映射。
              const address = imageAddress(target, this.options.resolveImage);
              if (address) {
                flush();
                this.attachment(parent, { kind: 'image', start: start + index, source: text.slice(index, end), target, label: shown }, address);
                index = end;
                continue;
              }
            } else if (filePath(target)) {
              // 本机文件的引用同样整块显示，不展开很长的副本路径。
              flush();
              const name = shown || fileLabel(target);
              this.attachment(parent, { kind: 'file', start: start + index, source: text.slice(index, end), target, label: name }, null);
              index = end;
              continue;
            } else {
              flush();
              const group = { start: start + index, end: start + end };
              this.syntax(parent, '[', caret, start + index, group);
              const link = element('span', 'markdown-link md-editor-link');
              this.renderInline(label, link, caret, start + labelStart, depth + 1);
              parent.append(link);
              this.syntax(parent, text.slice(labelEnd, end), caret, start + labelEnd, group);
              index = end;
              continue;
            }
          }
        }
      }

      plain += character;
      index += 1;
    }
    flush();
  }

  /**
   * 生成可点击的待办复选框，装饰不参与原文映射。
   *
   * 看得见的方框是里面的 md-task-box，按钮本身右边多出一段透明的间距：光标停在待办项开头时，
   * 浏览器把它画在按钮的边框外沿，外边距不算，间距放在按钮之内光标才不贴着方框。
   */
  private renderTask(line: HTMLElement, offset: number, checked: boolean): void {
    const checkbox = element('button', 'md-task-checkbox md-task-toggle');
    checkbox.append(element('span', 'md-task-box', checked ? '✓' : ''));
    checkbox.type = 'button';
    checkbox.dataset.mdDecoration = '';
    checkbox.dataset.mdTask = String(offset);
    checkbox.contentEditable = 'false';
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-checked', String(checked));
    checkbox.setAttribute('aria-label', checked ? '取消完成待办' : '完成待办');
    line.append(checkbox);
  }

  /** 点击待办时只替换状态字符，保留光标与原始换行。 */
  private toggleTask(checkbox: HTMLElement): void {
    if (this.composing) return;
    const offset = Number(checkbox.dataset.mdTask);
    if (
      !Number.isInteger(offset) ||
      this.value[offset - 1] !== '[' ||
      this.value[offset + 1] !== ']' ||
      !/[ xX]/.test(this.value[offset] ?? '')
    ) {
      return;
    }
    const selection = this.readSelection();
    // 键盘触发按钮时把焦点交回编辑表面，重排后仍可继续输入。
    if (this.hasFocus() && document.activeElement !== this.element) {
      this.element.focus({ preventScroll: true });
    }
    this.remember(selection);
    this.value =
      this.value.slice(0, offset) + (/[xX]/.test(this.value[offset]) ? ' ' : 'x') + this.value.slice(offset + 1);
    this.selection = selection;
    this.activeLine = this.hasFocus() ? this.lineAt(selection.end) : -1;
    this.render(selection);
    this.notify();
  }

  /** 生成每行格式，并保持所有原文字符可回读。 */
  private render(saved: SourceRange | null = null): void {
    if (this.composing || this.destroyed) return;
    this.rendering = true;
    this.lines = splitLines(this.value);
    const caret = this.markerCaret();
    const fragment = document.createDocumentFragment();
    let fence: { character: string; length: number } | null = null;

    for (let index = 0; index < this.lines.length; index += 1) {
      const model = this.lines[index];
      const active = index === this.activeLine;
      const line = element('div', `md-editor-line${active ? ' is-active' : ''}`);
      line.dataset.mdLine = String(index);
      line.dataset.eol = model.eol;

      const marker = model.text.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker && (!fence || (fence.character === marker[1][0] && marker[1].length >= fence.length))) {
        fence = fence ? null : { character: marker[1][0], length: marker[1].length };
        line.classList.add('md-fence-marker');
        if (!markerVisible(caret, model.start, model.text.length)) line.classList.add('is-collapsed');
        this.syntax(line, model.text, caret, model.start);
      } else if (fence || /^(?: {4}|\t)/.test(model.text)) {
        line.classList.add('md-fenced-code');
        line.append(element('code', '', model.text));
      } else {
        const heading = model.text.match(/^(\s{0,3}#{1,6}[\t ]+)(.*)$/);
        const quote = model.text.match(/^(\s{0,3}>[\t ]?)(.*)$/);
        const item = model.text.match(/^(\s{0,3})([-+*]|\d+[.)])([\t ]+)(.*)$/);
        const rule = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(model.text);

        if (heading) {
          line.classList.add('md-heading', `md-heading-${heading[1].trim().length}`);
          this.syntax(line, heading[1], caret, model.start);
          this.renderInline(heading[2], line, caret, model.start + heading[1].length);
        } else if (quote) {
          line.classList.add('md-quote');
          this.syntax(line, quote[1], caret, model.start);
          this.renderInline(quote[2], line, caret, model.start + quote[1].length);
        } else if (rule) {
          line.classList.add('md-rule');
          this.syntax(line, model.text, caret, model.start);
          if (!markerVisible(caret, model.start, model.text.length)) {
            this.decoration(line, 'md-rule-line', '');
          }
        } else if (item) {
          line.classList.add('md-list-item');
          // 缩进的列表项整体右移，项头仍落在悬挂区内。
          if (item[1].length) line.style.setProperty('--md-list-indent', String(item[1].length));
          const prefix = item[1] + item[2] + item[3];
          const task = item[4].match(/^(\[[ xX]\][\t ]+)(.*)$/);
          // 列表与待办的项头不随光标显示原文（原型第二版）：一直显示圆点、序号或复选框；
          // 光标在正文开头按退格删去项头，这一行变回普通文字（见 removeListPrefix），光标也不停在项头之前（clampToContent）。
          if (!task) this.decoration(line, 'md-list-bullet', /^\d/.test(item[2]) ? `${item[2]} ` : '• ');
          this.syntax(line, prefix, caret, model.start, null, 'md-list-marker', true);
          if (task) {
            this.renderTask(line, model.start + prefix.length + 1, /[xX]/.test(task[1]));
            this.syntax(line, task[1], caret, model.start + prefix.length, null, '', true);
            this.renderInline(task[2], line, caret, model.start + prefix.length + task[1].length);
          } else {
            this.renderInline(item[4], line, caret, model.start + prefix.length);
          }
        } else {
          this.renderInline(model.text, line, caret, model.start);
        }
      }

      if (!model.text) {
        const placeholder = element('br');
        placeholder.dataset.mdPlaceholder = '';
        line.append(placeholder);
      }
      fragment.append(line);
    }

    this.element.replaceChildren(fragment);
    this.element.classList.toggle('is-empty', this.value.length === 0);
    this.markerState = this.markerKey();
    this.rendering = false;
    if (saved) this.restoreSelection(saved);
    // 重排会清掉灰字提示，聚焦时按新的光标位置重新计算。
    if (this.hasFocus()) this.refreshSuggestion();
    else this.suggestion = null;
  }

  /* ==================== 私有：标签联想 ==================== */

  /** 光标停在 #标签 末尾时查找候选；不在标签末尾、在代码中或没有候选时返回 null。 */
  private findSuggestion(): TagSuggestion | null {
    const source = this.options.tagSuggestions;
    if (!source || this.composing || !this.hasFocus()) return null;
    const { start, end } = this.selection;
    if (start !== end) return null;
    const line = splitLines(this.value)[this.lineAt(start)];
    const column = start - line.start;
    if (/^[\p{L}\p{N}_-]/u.test(line.text.slice(column))) return null;
    const match = line.text.slice(0, column).match(/(?:^|[\t ])#([\p{L}\p{N}_-]+)$/u);
    if (!match) return null;
    const typed = match[1];
    const tagStart = start - typed.length - 1;
    const key = `${tagStart}:${typed}`;
    if (key === this.dismissedTag || inCode(this.value, start)) return null;
    const candidates = source(typed, this.value.slice(0, tagStart) + this.value.slice(start)).slice(0, MAX_TAG_SUGGESTIONS);
    if (!candidates.length) return null;
    const index = this.suggestion?.key === key ? this.suggestion.index % candidates.length : 0;
    return { key, start: tagStart, caret: start, typed, candidates, index };
  }

  /** 按当前光标重新计算并绘制联想；与正在显示的相同时不重绘，避免灰字闪动。 */
  private refreshSuggestion(): void {
    const next = this.findSuggestion();
    const current = this.suggestion;
    if (
      next &&
      current &&
      next.key === current.key &&
      next.index === current.index &&
      next.candidates.join('\n') === current.candidates.join('\n') &&
      this.element.querySelector('.md-tag-ghost')
    ) {
      return;
    }
    this.clearGhost();
    this.suggestion = next;
    if (next) this.paintGhost(next);
  }

  /** 移除灰字提示。 */
  private clearGhost(): void {
    this.element.querySelectorAll('.md-tag-ghost').forEach((node) => node.remove());
  }

  /** 在光标处插入灰字：当前候选中尚未输入的部分；候选不止一个时附上序号与切换提示。 */
  private paintGhost(suggestion: TagSuggestion): void {
    const tag = suggestion.candidates[suggestion.index];
    const ghost = element('span', 'md-tag-ghost', tag.slice(suggestion.typed.length));
    ghost.dataset.mdDecoration = '';
    ghost.contentEditable = 'false';
    ghost.setAttribute('aria-hidden', 'true');
    const count = suggestion.candidates.length;
    ghost.append(element('span', 'md-tag-ghost-hint', count > 1 ? `${suggestion.index + 1}/${count} ↑↓ · Tab` : 'Tab'));
    const point = this.domPoint(suggestion.caret);
    if (point.node.nodeType !== Node.TEXT_NODE) return;
    const text = point.node as Text;
    if (point.offset < text.length) text.splitText(point.offset);
    text.after(ghost);
    this.restoreSelection(this.selection);
  }

  /** 选用当前候选，补全标签；之后不再对这个标签提示更长的候选。 */
  private acceptSuggestion(): void {
    const suggestion = this.suggestion;
    if (!suggestion) return;
    const tag = suggestion.candidates[suggestion.index];
    const caret = suggestion.start + 1 + tag.length;
    this.dismissedTag = `${suggestion.start}:${tag}`;
    this.applyEdit(
      { value: this.value.slice(0, suggestion.start + 1) + tag + this.value.slice(suggestion.caret), start: caret, end: caret },
      { start: suggestion.caret, end: suggestion.caret, direction: 'none' },
    );
  }

  /**
   * 联想显示时的按键：Tab 选用，上下键切换候选，Esc 关闭。返回是否已处理。
   * 只有一个候选时上下键照常移动光标。
   */
  private suggestionKey(key: KeyboardEvent): boolean {
    const suggestion = this.suggestion;
    if (!suggestion || key.ctrlKey || key.metaKey || key.altKey) return false;
    const count = suggestion.candidates.length;
    if (key.key === 'Tab' && !key.shiftKey) {
      this.acceptSuggestion();
    } else if ((key.key === 'ArrowDown' || key.key === 'ArrowUp') && count > 1) {
      suggestion.index = (suggestion.index + (key.key === 'ArrowDown' ? 1 : count - 1)) % count;
      this.clearGhost();
      this.paintGhost(suggestion);
    } else if (key.key === 'Escape') {
      this.dismissedTag = suggestion.key;
      this.suggestion = null;
      this.clearGhost();
    } else {
      return false;
    }
    return true;
  }

  /** 通知原文变化。 */
  private notify(): void {
    this.options.onChange?.(this.value);
  }

  /** 恢复撤销或重做历史。 */
  private history(redo: boolean): void {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    if (!from.length) return;
    to.push({ value: this.value, selection: this.readSelection() });
    const snapshot = from.pop();
    if (!snapshot) return;
    this.value = snapshot.value;
    this.selection = snapshot.selection;
    this.activeLine = this.lineAt(this.selection.end);
    this.render(this.selection);
    this.notify();
  }

  /** 按字符或词扩展删除范围，避免拆开代理对与组合字符。 */
  private deletionRange(range: SourceRange, type: string): SourceRange {
    if (range.start !== range.end) return range;
    const backward = /Backward$/.test(type);
    if (/Word/.test(type)) {
      if (backward) {
        range.start -= (this.value.slice(0, range.start).match(/(?:\s*\S+|\s+)$/u) ?? [''])[0].length;
      } else {
        range.end += (this.value.slice(range.end).match(/^(?:\s*\S+|\s+)/u) ?? [''])[0].length;
      }
    } else if (/Line/.test(type)) {
      const line = splitLines(this.value)[this.lineAt(range.start)];
      if (backward) range.start = line.start;
      else range.end = line.end;
    } else if (backward && range.start > 0) {
      if (this.value.slice(range.start - 2, range.start) === '\r\n') {
        range.start -= 2;
      } else if (typeof Intl.Segmenter === 'function') {
        // 以字素簇为单位回退，Emoji 与组合字符整体删除。
        const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          this.value.slice(0, range.start),
        );
        for (const segment of segments) range.start = segment.index;
      } else {
        range.start -= (this.value.codePointAt(range.start - 2) ?? 0) > 0xffff ? 2 : 1;
      }
    } else if (!backward && range.end < this.value.length) {
      if (this.value.slice(range.end, range.end + 2) === '\r\n') {
        range.end += 2;
      } else if (typeof Intl.Segmenter === 'function') {
        const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          this.value.slice(range.end),
        );
        const first = segments[Symbol.iterator]().next();
        range.end += first.done ? 1 : first.value.segment.length;
      } else {
        range.end += (this.value.codePointAt(range.end) ?? 0) > 0xffff ? 2 : 1;
      }
    }
    return range;
  }

  /** 处理普通输入；输入法组合交由浏览器执行后再吸收。 */
  private beforeInput(event: InputEvent): void {
    if (this.composing || event.isComposing || event.inputType === 'insertCompositionText') return;
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      this.history(type === 'historyRedo');
      return;
    }
    if (/^delete/.test(type)) {
      event.preventDefault();
      const range = this.readSelection();
      // 选中了文字时按所见内容删除：完整选中的格式连同隐藏标记一起删掉，部分选中时保留标记。
      // 退格或删除碰到附件时整个引用一起删除。
      if (range.start !== range.end) this.applyEdit(this.replaceVisible('', range, true), range);
      else if (type === 'deleteContentBackward' && this.removeListPrefix(range.start)) return;
      else this.replace('', this.atomicRange(this.deletionRange(range, type)));
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      // 回车在列表、引用与代码块中续写；Shift+Enter 只换行。
      const range = this.readSelection();
      if (type === 'insertParagraph' && this.applyEdit(continueBlock(this.value, range.start, range.end), range)) return;
      this.insertText((this.value.match(/\r\n|\r|\n/) ?? ['\n'])[0], range);
      return;
    }
    if (type === 'insertText' || type === 'insertReplacementText' || type === 'insertFromDrop') {
      event.preventDefault();
      const text =
        event.data !== null ? event.data : (event.dataTransfer?.getData('text/plain') ?? '');
      const range = this.readSelection();
      // 行首的 [] 或【】后按空格换成待办项（见 taskShorthand）。
      if (type === 'insertText' && this.applyEdit(taskShorthand(this.value, range.start, range.end, text || ''), range)) return;
      this.insertText(text || '', range);
      return;
    }
    // 富文本格式化命令一律拒绝，原文由 Markdown 标记表达。
    if (/^format/.test(type)) event.preventDefault();
  }

  /** 在选区处输入文字：选中了文字时只替换看得见的部分，保留不能拆开的隐藏标记。 */
  private insertText(text: string, range: SourceRange): void {
    if (range.start === range.end) this.replace(text, range);
    else this.applyEdit(this.replaceVisible(text, range, false), range);
  }

  /**
   * Ctrl+K：剪贴板中是网址时直接用它生成链接，否则插入或去掉链接（见 linkWithAddress、toggleLink）。
   * 读取剪贴板是异步的，期间原文若已变化（继续输入等）就放弃，避免按过时的位置改写。
   */
  private insertLink(range: SourceRange): void {
    const before = this.value;
    const apply = (clipboard: string): void => {
      if (this.destroyed || this.value !== before) return;
      this.applyEdit(
        linkWithAddress(before, range.start, range.end, clipboard) ?? toggleLink(before, range.start, range.end),
        range,
      );
    };
    const read = this.options.readClipboard;
    if (!read) {
      apply('');
      return;
    }
    void read()
      .catch(() => '')
      .then((clipboard) => apply(String(clipboard ?? '')));
  }

  /**
   * 粘贴截图或文件：应用保存副本后返回引用，插在粘贴时的光标处。
   * 保存期间原文若已变化（继续输入等），改为插在当前光标处，避免按过时的位置改写。
   */
  private pasteFiles(files: File[], range: SourceRange): void {
    const handler = this.options.pasteFiles;
    if (!handler) return;
    const before = this.value;
    void handler(files)
      .catch(() => null)
      .then((markdown) => {
        if (!markdown || this.destroyed) return;
        this.insertAttachment(markdown, this.value === before ? range : this.selection);
      });
  }

  /** 吸收输入法或浏览器原生写入，保留原有换行与空白。 */
  private absorbDOM(finish = false): void {
    const next = this.readDOM();
    this.selection = this.readSelection();
    if (next !== this.value) {
      if (!this.composing && !this.compositionEnding) this.remember(this.selection);
      this.value = next;
      this.notify();
    }
    if (finish && !this.composing) {
      this.activeLine = this.hasFocus() ? this.lineAt(this.selection.end) : -1;
      this.render(this.selection);
    }
  }

  /** 注册便于销毁的事件监听。 */
  private listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options: boolean | AddEventListenerOptions = false,
  ): void {
    target.addEventListener(type, handler, options);
    this.listeners.push([target, type, handler, options]);
  }

  /** 绑定编辑、纯文本粘贴与输入法事件。 */
  private bindEvents(): void {
    this.listen(this.element, 'focus', () => {
      setFocusedEditor(this);
      this.activeLine = this.lineAt(this.selection.end);
      this.render(this.selection);
    });

    this.listen(this.element, 'blur', () => {
      if (this.composing) {
        this.composing = false;
        this.compositionEnding = true;
        this.absorbDOM();
        this.compositionEnding = false;
      }
      this.selection = this.readSelection();
      this.activeLine = -1;
      this.render();
      if (isFocusedEditor(this)) setFocusedEditor(null);
    });

    this.listen(this.element, 'mousedown', (event) => {
      // 操作待办或附件时保留正文选区，避免光标被装饰节点夺走。
      const mouse = event as MouseEvent;
      const target = mouse.target as HTMLElement | null;
      if (target?.closest('[data-md-task],[data-md-attachment]') && (mouse.button === undefined || mouse.button === 0)) {
        mouse.preventDefault();
      }
    });

    this.listen(this.element, 'click', (event) => {
      const target = (event.target as HTMLElement | null) ?? null;
      const checkbox = target?.closest<HTMLElement>('[data-md-task]');
      if (checkbox && this.element.contains(checkbox)) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleTask(checkbox);
        return;
      }
      const chip = target?.closest<HTMLElement>('[data-md-attachment]');
      if (chip && this.element.contains(chip)) {
        event.preventDefault();
        event.stopPropagation();
        if (this.suppressClick) return;
        const info = this.attachmentInfo(chip);
        if (!info) return;
        if (this.options.onAttachment) this.options.onAttachment(info, event as MouseEvent);
        else if (chip.dataset.mdPreview) this.options.onPreviewImage?.(chip.dataset.mdPreview, info.label);
      }
    });

    this.listen(this.element, 'beforeinput', (event) => this.beforeInput(event as InputEvent));

    // 按住编辑面中的图片或文件块：移动 4 像素后开始拖动，松开时移到插入光标处（原型 pressAttachment）。
    this.listen(this.element, 'pointerdown', (event) => this.pressAttachment(event as PointerEvent));

    // 从编辑面中拖动选中的文字（原型 editor.js）：记下原文范围，落在同一个编辑面时一步移到落点（moveText），
    // 不经过浏览器「先删去原处再插到落点」的两步，落点不会因为中间的重新排版而错位。
    // 从别处拖来的文字照常插在落点（见 beforeInput 的 insertFromDrop）；拖入的文件由应用处理。
    this.listen(this.element, 'dragstart', (event) => {
      const transfer = (event as DragEvent).dataTransfer;
      const range = this.atomicRange(this.readSelection());
      if (!transfer || !(range.end > range.start)) {
        event.preventDefault();
        return;
      }
      textDrag = { editor: this, start: range.start, end: range.end };
      transfer.setData('text/plain', this.value.slice(range.start, range.end));
      transfer.effectAllowed = 'copyMove';
    });
    this.listen(this.element, 'dragend', () => {
      window.setTimeout(() => {
        if (textDrag?.editor === this) textDrag = null;
      }, 0);
    });
    this.listen(this.element, 'drop', (event) => {
      const drop = event as DragEvent;
      if (drop.defaultPrevented || textDrag?.editor !== this) return;
      drop.preventDefault();
      drop.stopPropagation();
      const { start, end } = textDrag;
      textDrag = null;
      this.moveText(start, end, this.offsetAt(drop.clientX, drop.clientY));
    });

    this.listen(this.element, 'input', (event) => {
      if (event.target === this.element) this.absorbDOM(!this.composing && !(event as InputEvent).isComposing);
    });

    this.listen(this.element, 'compositionstart', () => {
      this.selectionChanged();
      this.remember(this.readSelection());
      this.composing = true;
      // 输入法组合期间 DOM 交给浏览器，先撤下灰字，组合结束重排后再提示。
      this.suggestion = null;
      this.clearGhost();
    });

    this.listen(this.element, 'compositionend', () => {
      this.composing = false;
      this.compositionEnding = true;
      this.absorbDOM(true);
      this.compositionEnding = false;
    });

    this.listen(this.element, 'paste', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      if (!clipboard) return;
      event.preventDefault();
      // 截图与文件交给应用保存副本，再插入引用；只能在粘贴事件中读取剪贴板的文件，先取出来。
      if (clipboard.files.length) {
        this.pasteFiles(Array.from(clipboard.files), this.readSelection());
        return;
      }
      const text = clipboard.getData('text/plain');
      const range = this.readSelection();
      // 纯文本粘贴，或选区拆开了隐藏的标记时，只替换看得见的文字，不做格式识别，避免把半截语法包进链接或代码块。
      if (this.plainPaste || this.visibleSpan(range, false).kept.length) {
        this.insertText(text, range);
        return;
      }
      const pasted = smartPaste(this.value, range.start, range.end, {
        text,
        html: clipboard.getData('text/html'),
        codeLanguage: this.editorLanguage(clipboard.getData('vscode-editor-data')),
      });
      if (!this.applyEdit(pasted, range)) this.insertText(text, range);
    });

    this.listen(this.element, 'copy', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      const range = this.readSelection();
      if (range.start === range.end || !clipboard) return;
      event.preventDefault();
      clipboard.setData('text/plain', this.visibleText(range));
    });

    this.listen(this.element, 'cut', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      const range = this.readSelection();
      if (range.start === range.end || !clipboard) return;
      event.preventDefault();
      clipboard.setData('text/plain', this.visibleText(range));
      this.applyEdit(this.replaceVisible('', range, true), range);
    });

    this.listen(this.element, 'keyup', () => {
      this.plainPaste = false;
    });

    // 标签联想的按键在窗口捕获阶段处理，先于侧栏「Esc 取消编辑」等全局快捷键。
    this.listen(
      window,
      'keydown',
      (event) => {
        const key = event as KeyboardEvent;
        if (key.target !== this.element || this.composing || key.isComposing) return;
        if (!this.suggestionKey(key)) return;
        key.preventDefault();
        key.stopImmediatePropagation();
      },
      true,
    );

    this.listen(this.element, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (this.composing || key.isComposing) return;
      const modifier = key.ctrlKey || key.metaKey;
      this.plainPaste = modifier && key.shiftKey && physicalKey(key) === 'KeyV';
      if (modifier && !key.altKey && !key.shiftKey && key.key.toLowerCase() === 'a') {
        key.preventDefault();
        this.setSelectionRange(0, this.value.length, 'forward');
      } else if (modifier && !key.altKey && /^[zy]$/i.test(key.key)) {
        key.preventDefault();
        this.history(key.key.toLowerCase() === 'y' || key.shiftKey);
      } else if (key.key === 'Tab' && !modifier && !key.altKey) {
        // Tab 不移出编辑区：编辑中焦点离开卡片会保存并退出编辑。
        key.preventDefault();
        const range = this.readSelection();
        if (!this.applyEdit(indentLines(this.value, range.start, range.end, key.shiftKey), range) && !key.shiftKey) {
          this.replace('  ', range);
        }
      } else if ((key.key === 'Home' || key.key === 'End') && !modifier && !key.altKey) {
        if (this.moveToLineBoundary(key.key === 'Home', key.shiftKey)) key.preventDefault();
      } else {
        const bound = commandFor(key, this.options.shortcuts?.() ?? {}, ['format']);
        if (bound === 'link') {
          key.preventDefault();
          this.insertLink(this.readSelection());
          return;
        }
        const command = this.shortcut(key, bound);
        if (!command) return;
        key.preventDefault();
        const range = this.readSelection();
        this.applyEdit(command(this.value, range.start, range.end), range);
      }
    });
  }

  /** 带项头的行（列表项、待办、标题、引用）中正文开始的位置，相对行首；其余行返回 0。按 render 的识别结果判断。 */
  private contentOffset(index: number): number {
    const line = this.element.children[index];
    const text = this.lines[index]?.text ?? '';
    if (!line) return 0;
    const prefix = (pattern: RegExp): number => (text.match(pattern) ?? [''])[0].length;
    if (line.classList.contains('md-heading')) return prefix(/^\s{0,3}#{1,6}[\t ]+/);
    if (line.classList.contains('md-quote')) return prefix(/^\s{0,3}>[\t ]?/);
    if (line.classList.contains('md-list-item')) return prefix(/^\s{0,3}(?:[-+*]|\d+[.)])[\t ]+(?:\[[ xX]\][\t ]+)?/);
    return 0;
  }

  /**
   * 正文文字开始的位置：从 `from`（块级标记之后）起，跳过紧挨着的行内格式开头标记，
   * 如加粗的 **、链接的 [。按渲染出的标记节点判断：开头标记的分组从它自己开始。
   */
  private textStart(index: number, from: number): number {
    const line = this.element.children[index];
    let offset = from;
    while (line) {
      const marker = line.querySelector<HTMLElement>(
        `.md-syntax[data-md-start="${offset}"][data-md-group-start="${offset}"]`,
      );
      const end = Number(marker?.dataset.mdEnd);
      if (!marker || !(end > offset)) break;
      offset = end;
    }
    return offset;
  }

  /**
   * 行内第一个看得见的正文字符之后的位置：不在项头、装饰节点与隐藏的标记里。
   * 紧挨项头的位置会被浏览器归到 inline-block 的项头里，隐藏的标记里又放不下光标，所以取第一个字之后。
   */
  private firstVisibleText(index: number): { node: Node; offset: number } | null {
    const line = this.element.children[index];
    if (!line) return null;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!node.textContent || !parent || parent.closest('.md-list-marker, [data-md-decoration], [hidden], .is-hidden')) {
        continue;
      }
      return { node, offset: 1 };
    }
    return null;
  }

  /**
   * Home 与 End，按正文跳转。Home 回到正文文字的开头：列表项、待办、标题与引用跳过项头，
   * 以加粗、链接等格式开头的行再跳过紧挨着的开头标记。光标在项头之中或正文开头时，End 移到正文第一行的末尾。
   * 其余情况交给浏览器，折行时仍按显示的行移动。返回 true 表示已处理。
   */
  private moveToLineBoundary(home: boolean, extend: boolean): boolean {
    const current = this.readSelection();
    const backward = current.direction === 'backward';
    const focus = backward ? current.start : current.end;
    const anchor = backward ? current.end : current.start;
    const index = this.lineAt(focus);
    const line = this.lines[index];
    const prefixEnd = line.start + this.contentOffset(index);
    let target: number | null;
    if (home) {
      const textStart = this.textStart(index, prefixEnd);
      if (textStart === line.start) return false;
      // 先按浏览器的方式移到显示行的开头：落到正文文字之前（第一行）时改为正文文字开头，折行后的其它行照常停在行首。
      const reached = this.lineBoundaryFrom(this.domPoint(focus), 'backward');
      if (reached === null) return false;
      target = Math.max(reached, textStart);
    } else {
      if (prefixEnd === line.start || focus > prefixEnd) return false;
      const start = this.firstVisibleText(index);
      target = start ? this.lineBoundaryFrom(start, 'forward') : line.end;
      if (target === null) return false;
    }
    const from = extend ? anchor : target;
    const direction = target < from ? 'backward' : target > from ? 'forward' : 'none';
    this.setSelectionRange(Math.min(from, target), Math.max(from, target), direction);
    return true;
  }

  /** 从 DOM 位置出发，按浏览器的方式移到所在显示行的开头或末尾，返回到达的原文位置。 */
  private lineBoundaryFrom(point: { node: Node; offset: number }, direction: 'forward' | 'backward'): number | null {
    const selection = window.getSelection();
    if (!selection || typeof selection.modify !== 'function') return null;
    selection.collapse(point.node, point.offset);
    selection.modify('move', direction, 'lineboundary');
    return this.sourceOffset(selection.focusNode, selection.focusOffset);
  }

  /**
   * 格式快捷键对应的编辑命令：先按设置中的按键找到的命令（`bound`），再看固定的快捷键：
   * Ctrl+0–6 设为正文与标题，兼容 Typora 的 Alt+Shift+5 删除线与 Ctrl+Shift+` 行内代码。
   * 返回 null 表示不是格式快捷键；Ctrl+K 链接需要先读剪贴板，由调用方单独处理（见 insertLink）。
   */
  private shortcut(key: KeyboardEvent, bound: ShortcutId | null): ((value: string, start: number, end: number) => EditResult) | null {
    type Command = (value: string, start: number, end: number) => EditResult;
    const inline = (marker: string): Command => (value, start, end) => toggleInline(value, start, end, marker);
    const commands: Partial<Record<ShortcutId, Command>> = {
      bold: inline('**'),
      italic: inline('*'),
      underline: (value, start, end) => toggleTag(value, start, end, 'u'),
      strike: inline('~~'),
      inlineCode: inline('`'),
      codeBlock: wrapCodeBlock,
      quote: toggleQuote,
      orderedList: (value, start, end) => toggleList(value, start, end, true),
      bulletList: (value, start, end) => toggleList(value, start, end, false),
      taskList: toggleTask,
    };
    if (bound && commands[bound]) return commands[bound] ?? null;
    const combo = comboFromEvent(key);
    const heading = combo?.match(/^Ctrl\+([0-6])$/);
    if (heading) return (value, start, end) => setHeading(value, start, end, Number(heading[1]));
    if (combo === 'Alt+Shift+5') return commands.strike ?? null;
    if (combo === 'Ctrl+Shift+`') return commands.inlineCode ?? null;
    return null;
  }

  /** 读取 VS Code 写入剪贴板的语言信息；不是来自代码编辑器时返回 null。 */
  private editorLanguage(raw: string): string | null {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { mode?: unknown };
      return typeof data.mode === 'string' ? codeLanguage(data.mode) : null;
    } catch {
      return null;
    }
  }
}
