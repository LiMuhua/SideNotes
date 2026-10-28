/**
 * 实时 Markdown 编辑器。
 *
 * 原文是唯一数据源：可编辑 DOM 只是原文的一种呈现，所有修改都先作用于原文，
 * 再重新排版并恢复选区。光标进入被标记包裹的内容时显示完整原始标记，
 * 其余内容保持渲染效果。
 *
 * 排版只在以下时机重建，避免正文内移动光标造成闪烁：
 * - 原文变化；
 * - 光标跨行；
 * - 可见标记的集合发生变化。
 *
 * 输入法组合期间不重建 DOM，组合结束后一次性吸收浏览器写入的内容。
 */

import { filePath } from './files';

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

/** 创建选项。 */
export interface EditorOptions {
  value?: string;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number;
  maxHeight?: number;
  /** 原文变化时回调。 */
  onChange?: (value: string) => void;
  /** 需要应用层处理的图片预览请求。 */
  onPreviewImage?: (src: string, alt: string) => void;
}

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

/** 取得允许在编辑器内预览的图片地址。 */
function imageAddress(value: string): string | null {
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?,/i.test(value)) return value;
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
  /** 组合结束的吸收阶段不追加中间撤销快照。 */
  private compositionEnding = false;
  private destroyed = false;
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
    this.element.dataset.placeholder = options.placeholder ?? '写下内容…';
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    this.element.setAttribute('aria-label', options.ariaLabel ?? this.element.dataset.placeholder);
    this.element.spellcheck = false;
    this.element.tabIndex = 0;
    if (typeof options.minHeight === 'number') this.element.style.minHeight = `${options.minHeight}px`;
    this.element.style.maxHeight = `${options.maxHeight ?? 380}px`;
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

  /** 读取当前原文选区。 */
  readSelection(): SourceRange {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return this.selection;
    const anchor = this.sourceOffset(selection.anchorNode, selection.anchorOffset);
    const focus = this.sourceOffset(selection.focusNode, selection.focusOffset);
    if (anchor === null || focus === null) return this.selection;
    return {
      start: Math.min(anchor, focus),
      end: Math.max(anchor, focus),
      direction: anchor > focus ? 'backward' : anchor < focus ? 'forward' : 'none',
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

  /** 记录当前状态用于撤销。拖放等外部插入在修改前调用。 */
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

  /** 选区变化时同步状态；仅在标记边界或所在行变化时重排。 */
  selectionChanged(): void {
    if (this.destroyed || this.rendering || this.composing || !this.hasFocus()) return;
    this.selection = this.readSelection();
    this.activeLine = this.lineAt(
      this.selection.direction === 'backward' ? this.selection.start : this.selection.end,
    );
    if (this.markerKey() !== this.markerState) this.render(this.selection);
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

  /** 找到原文偏移对应的可编辑文本节点。 */
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
    let node: Node | null;
    let last: Text | null = null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      last = text;
      if (remaining <= text.length) return { node: text, offset: remaining };
      remaining -= text.length;
    }
    return last ? { node: last, offset: last.length } : { node: line, offset: 0 };
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

  /**
   * 把完整选中的格式内容扩展为成对原文。
   *
   * 浏览器复制可见文本时会省略隐藏的开闭标记；此处按分组范围补齐，
   * 使「完整复制链接保留左方括号」等情形与原型一致。
   */
  private clipboardRange(range: SourceRange = this.readSelection()): SourceRange {
    const result = { ...range };
    if (result.start === result.end) return result;
    const groups = new Map<
      string,
      { start: number; end: number; contentStart: number; contentEnd: number }
    >();
    for (const node of Array.from(this.element.querySelectorAll<HTMLElement>('[data-md-group-start]'))) {
      const start = Number(node.dataset.mdGroupStart);
      const end = Number(node.dataset.mdGroupEnd);
      const key = `${start}:${end}`;
      const group = groups.get(key) ?? { start, end, contentStart: start, contentEnd: end };
      if (Number(node.dataset.mdStart) === start) group.contentStart = Number(node.dataset.mdEnd);
      if (Number(node.dataset.mdEnd) === end) group.contentEnd = Number(node.dataset.mdStart);
      groups.set(key, group);
    }
    // 从内到外处理：完整选中链接中的加粗文字时，一并保留两层标记。
    const ordered = Array.from(groups.values()).sort(
      (left, right) => left.end - left.start - (right.end - right.start),
    );
    for (const group of ordered) {
      if (
        group.contentStart < group.contentEnd &&
        result.start <= group.contentStart &&
        result.end >= group.contentEnd &&
        result.start < group.end &&
        result.end > group.start
      ) {
        result.start = Math.min(result.start, group.start);
        result.end = Math.max(result.end, group.end);
      }
    }
    return result;
  }

  /* ==================== 私有：排版 ==================== */

  /** 需要展开标记的插入位置；选中正文时保持渲染效果。 */
  private markerCaret(): number | null {
    return this.hasFocus() && this.selection.start === this.selection.end ? this.selection.end : null;
  }

  /** 计算当前行与可见标记的标识。 */
  private markerKey(): string {
    const caret = this.markerCaret();
    let key = `${this.activeLine}|`;
    for (const node of Array.from(this.element.querySelectorAll<HTMLElement>('.md-syntax'))) {
      const start = Number(node.dataset.mdRevealStart ?? node.dataset.mdStart);
      const end = Number(node.dataset.mdRevealEnd ?? node.dataset.mdEnd);
      if (markerVisible(caret, start, end - start)) key += `${start}:${end};`;
    }
    return key;
  }

  /** 为原文标记生成可折叠节点；`extra` 为附加类名，供样式区分标记种类。 */
  private syntax(
    parent: HTMLElement,
    text: string,
    caret: number | null,
    start = 0,
    range: { start: number; end: number } | null = null,
    extra = '',
  ): void {
    if (!text) return;
    const revealed = range
      ? markerVisible(caret, range.start, range.end - range.start)
      : markerVisible(caret, start, text.length);
    const node = element('span', `md-syntax ${revealed ? 'is-revealed' : 'is-hidden'}${extra ? ` ${extra}` : ''}`, text);
    node.dataset.mdStart = String(start);
    node.dataset.mdEnd = String(start + text.length);
    node.dataset.mdRevealStart = String(range ? range.start : start);
    node.dataset.mdRevealEnd = String(range ? range.end : start + text.length);
    if (range) {
      node.dataset.mdGroupStart = String(range.start);
      node.dataset.mdGroupEnd = String(range.end);
    }
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
            if (isImage) {
              // 图片的源文本参与光标映射，图片本身只是不可编辑的预览。
              const address = imageAddress(target);
              if (address) {
                flush();
                this.syntax(parent, text.slice(index, end), caret, start + index);
                const preview = element('button', 'md-editor-image');
                preview.type = 'button';
                preview.tabIndex = -1;
                preview.contentEditable = 'false';
                preview.dataset.mdDecoration = '';
                preview.dataset.mdPreview = address;
                preview.dataset.mdAlt = label;
                preview.setAttribute('aria-label', `放大图片：${label || '图片'}`);
                const picture = element('img', 'markdown-image');
                picture.src = address;
                picture.alt = label;
                picture.loading = 'lazy';
                picture.draggable = false;
                preview.append(picture);
                parent.append(preview);
                index = end;
                continue;
              }
            } else {
              flush();
              const group = { start: start + index, end: start + end };
              this.syntax(parent, '[', caret, start + index, group);
              const isFile = Boolean(filePath(target));
              const link = element('span', `markdown-link md-editor-link${isFile ? ' is-file' : ''}`);
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

  /** 生成可点击的待办复选框，装饰不参与原文映射。 */
  private renderTask(line: HTMLElement, offset: number, checked: boolean): void {
    const checkbox = element('button', 'md-task-checkbox md-task-toggle', checked ? '✓' : '');
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
          if (!task && !markerVisible(caret, model.start, prefix.length)) {
            this.decoration(line, 'md-list-bullet', /^\d/.test(item[2]) ? `${item[2]} ` : '• ');
          }
          this.syntax(line, prefix, caret, model.start, null, 'md-list-marker');
          if (task) {
            this.renderTask(line, model.start + prefix.length + 1, /[xX]/.test(task[1]));
            this.syntax(line, task[1], caret, model.start + prefix.length);
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
      this.replace('', this.deletionRange(this.readSelection(), type));
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      this.replace((this.value.match(/\r\n|\r|\n/) ?? ['\n'])[0]);
      return;
    }
    if (type === 'insertText' || type === 'insertReplacementText' || type === 'insertFromDrop') {
      event.preventDefault();
      const text =
        event.data !== null ? event.data : (event.dataTransfer?.getData('text/plain') ?? '');
      this.replace(text || '');
      return;
    }
    // 富文本格式化命令一律拒绝，原文由 Markdown 标记表达。
    if (/^format/.test(type)) event.preventDefault();
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
      // 操作待办或图片时保留正文选区，避免光标被装饰节点夺走。
      const mouse = event as MouseEvent;
      const target = mouse.target as HTMLElement | null;
      if (target?.closest('[data-md-task],[data-md-preview]') && (mouse.button === undefined || mouse.button === 0)) {
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
      const preview = target?.closest<HTMLElement>('[data-md-preview]');
      if (preview && this.element.contains(preview)) {
        event.preventDefault();
        event.stopPropagation();
        this.options.onPreviewImage?.(preview.dataset.mdPreview ?? '', preview.dataset.mdAlt ?? '');
      }
    });

    this.listen(this.element, 'beforeinput', (event) => this.beforeInput(event as InputEvent));

    this.listen(this.element, 'input', (event) => {
      if (event.target === this.element) this.absorbDOM(!this.composing && !(event as InputEvent).isComposing);
    });

    this.listen(this.element, 'compositionstart', () => {
      this.selectionChanged();
      this.remember(this.readSelection());
      this.composing = true;
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
      // 文件由应用的附件流程处理，编辑器只接收纯文本。
      if (clipboard.files.length) return;
      this.replace(clipboard.getData('text/plain'));
    });

    this.listen(this.element, 'copy', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      const range = this.clipboardRange();
      if (range.start === range.end || !clipboard) return;
      event.preventDefault();
      clipboard.setData('text/plain', this.value.slice(range.start, range.end));
    });

    this.listen(this.element, 'cut', (event) => {
      const clipboard = (event as ClipboardEvent).clipboardData;
      const range = this.clipboardRange();
      if (range.start === range.end || !clipboard) return;
      event.preventDefault();
      clipboard.setData('text/plain', this.value.slice(range.start, range.end));
      this.replace('', range);
    });

    this.listen(this.element, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (this.composing || key.isComposing) return;
      const modifier = key.ctrlKey || key.metaKey;
      if (modifier && !key.altKey && !key.shiftKey && key.key.toLowerCase() === 'a') {
        key.preventDefault();
        this.setSelectionRange(0, this.value.length, 'forward');
      } else if (modifier && !key.altKey && /^[zy]$/i.test(key.key)) {
        key.preventDefault();
        this.history(key.key.toLowerCase() === 'y' || key.shiftKey);
      } else if (key.key === 'Tab' && !modifier && !key.altKey) {
        key.preventDefault();
        this.replace('  ');
      }
    });
  }
}
