'use strict';

/** 实时 Markdown 编辑器：保留原文，以可编辑 DOM 显示排版和插入光标附近的标记。 */
(function exposeLiveMarkdown() {
  let focusedEditor = null; // 当前正在编辑的实例，避免为每张卡片保留全局监听器。
  let selectionFrame = 0; // 合并同一帧中的选区变化。
  let editorSequence = 0; // 无 id 输入框的关联编号。

  /* ==================== 原文与安全 DOM 工具 ==================== */

  /** @brief 创建安全元素，不解析用户输入的 HTML。 @param {string} tag 标签。 @param {string} className 样式类。 @param {string} text 文本。 @return {HTMLElement} 元素。 */
  function element(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** @brief 按行拆分，保留各行原始换行符和首尾空白。 @param {string} value 原文。 @return {object[]} 行模型。 */
  function splitLines(value) {
    const result = [];
    const endings = /\r\n|\r|\n/g;
    let start = 0;
    let match;
    while ((match = endings.exec(value))) {
      result.push({ text: value.slice(start, match.index), start: start, end: match.index, eol: match[0] });
      start = match.index + match[0].length;
    }
    result.push({ text: value.slice(start), start: start, end: value.length, eol: '' });
    return result;
  }

  /** @brief 取得允许显示的图片地址。 @param {string} value 地址。 @return {string|null} 安全地址。 */
  function imageAddress(value) {
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;[^,]*)?,/i.test(value)) return value;
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (error) { return null; }
  }

  /** @brief 读取可编辑节点中的原文，忽略预览装饰。 @param {Node} node 节点。 @return {string} 原文片段。 */
  function nodeText(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1 || node.hasAttribute('data-md-decoration')) return '';
    if (node.tagName === 'BR') return '';
    let value = '';
    for (const child of node.childNodes) value += nodeText(child);
    return value;
  }

  /** @brief 统计节点起点到选区端点的原文长度。 @param {Node} node 当前节点。 @param {Node} target 选区节点。 @param {number} offset 端点偏移。 @return {{found:boolean,length:number}} 是否找到及原文长度。 */
  function pointLength(node, target, offset) {
    if (node.nodeType === 1 && node.hasAttribute('data-md-decoration')) return { found: node === target || node.contains(target), length: 0 };
    if (node === target) {
      if (node.nodeType === 3) return { found: true, length: Math.min(offset, (node.nodeValue || '').length) };
      let length = 0;
      for (let index = 0; index < Math.min(offset, node.childNodes.length); index += 1) length += nodeText(node.childNodes[index]).length;
      return { found: true, length: length };
    }
    if (node.nodeType === 3) return { found: false, length: (node.nodeValue || '').length };
    if (node.nodeType === 1 && node.tagName === 'BR') return { found: false, length: 0 };
    let length = 0;
    for (const child of node.childNodes) {
      const part = pointLength(child, target, offset);
      length += part.length;
      if (part.found) return { found: true, length: length };
    }
    return { found: false, length: length };
  }

  /** @brief 判断插入光标是否紧邻某段标记。 @param {number|null} caret 原文插入位置。 @param {number} start 标记起点。 @param {number} length 标记长度。 @return {boolean} 是否显示标记。 */
  function markerVisible(caret, start, length) {
    return caret !== null && caret >= start && caret <= start + length;
  }

  /** @brief 为原文标记生成可折叠节点。 @param {HTMLElement} parent 父节点。 @param {string} text 标记原文。 @param {number|null} caret 原文插入位置。 @param {number} start 标记起点。 @param {object|null} range 包裹结构范围。 */
  function syntax(parent, text, caret, start = 0, range = null) {
    if (!text) return;
    const revealed = range ? markerVisible(caret, range.start, range.end-range.start) : markerVisible(caret,start,text.length);
    const node = element('span', 'md-syntax ' + (revealed ? 'is-revealed' : 'is-hidden'), text);
    node.dataset.mdStart = String(start);
    node.dataset.mdEnd = String(start + text.length);
    node.dataset.mdRevealStart=String(range?range.start:start);
    node.dataset.mdRevealEnd=String(range?range.end:start+text.length);
    if (range) { node.dataset.mdGroupStart = String(range.start); node.dataset.mdGroupEnd = String(range.end); }
    node.hidden = !revealed;
    if (!revealed) node.setAttribute('aria-hidden', 'true');
    parent.append(node);
  }

  /** @brief 添加不参与原文映射的视觉装饰。 @param {HTMLElement} parent 父节点。 @param {string} className 样式名。 @param {string} text 显示文本。 @return {HTMLElement} 装饰节点。 */
  function decoration(parent, className, text) {
    const node = element('span', className, text);
    node.dataset.mdDecoration = '';
    node.contentEditable = 'false';
    node.setAttribute('aria-hidden', 'true');
    parent.append(node);
    return node;
  }

  /** @brief 查找行内定界符，忽略转义和代码围栏内部的同类字符。 @param {string} text 原文。 @param {string} marker 定界符。 @param {number} start 查找起点。 @return {number} 闭合位置。 */
  function closingMarker(text, marker, start) {
    let end = text.indexOf(marker, start);
    while (end >= 0) {
      const escaped = /(?:^|[^\\])(?:\\\\)*\\$/.test(text.slice(0, end));
      const ticks = marker[0] === '`';
      const valid = ticks ? text[end - 1] !== '`' && text[end + marker.length] !== '`' : end > start && !/\s/.test(text[end - 1]);
      if (!escaped && valid) return end;
      end = text.indexOf(marker, end + marker.length);
    }
    return -1;
  }

  /** @brief 安全渲染行内格式，所有原始字符仍保留在 DOM 中。 @param {string} text 原文。 @param {HTMLElement} parent 容器。 @param {number|null} caret 原文插入位置。 @param {number} start 当前片段的原文起点。 @param {number} depth 递归层数。 */
  function renderInline(text, parent, caret, start = 0, depth = 0) {
    if (depth > 8) { parent.append(document.createTextNode(text)); return; }
    let index = 0;
    let plain = '';
    /** 输出累积的普通文本。 */
    function flush() {
      if (plain) parent.append(document.createTextNode(plain));
      plain = '';
    }
    while (index < text.length) {
      const character = text[index];
      if (character === '\\' && /[\\`*_{}\[\]()#+.!~>-]/.test(text[index + 1] || '')) {
        flush();
        syntax(parent, '\\', caret, start + index);
        parent.append(document.createTextNode(text[index + 1]));
        index += 2;
        continue;
      }
      if (character === '`') {
        const marker = text.slice(index).match(/^`+/)[0];
        const end = closingMarker(text, marker, index + marker.length);
        if (end >= 0) {
          flush();
          syntax(parent, marker, caret, start + index,{start:start+index,end:start+end+marker.length});
          parent.append(element('code', 'md-inline-code', text.slice(index + marker.length, end)));
          syntax(parent, marker, caret, start + end,{start:start+index,end:start+end+marker.length});
          index = end + marker.length;
          continue;
        }
      }
      if (character === '*' || character === '_' || character === '~') {
        const markers = character !== '~' && text.slice(index, index + 3) === character.repeat(3) ? [character.repeat(3), character.repeat(2)] : text[index + 1] === character ? [character + character] : [];
        if (character !== '~') markers.push(character);
        let consumed = false;
        for (const marker of markers) {
          const contentStart = index + marker.length;
          if (!text[contentStart] || /\s/.test(text[contentStart])) continue;
          const end = closingMarker(text, marker, contentStart);
          if (end < 0) continue;
          flush();
          syntax(parent, marker, caret, start + index,{start:start+index,end:start+end+marker.length});
          const formatted = element(marker === '~~' ? 'del' : marker.length > 1 ? 'strong' : 'em');
          const content = marker.length === 3 ? element('em') : formatted;
          renderInline(text.slice(contentStart, end), content, caret, start + contentStart, depth + 1);
          if (content !== formatted) formatted.append(content);
          parent.append(formatted);
          syntax(parent, marker, caret, start + end,{start:start+index,end:start+end+marker.length});
          index = end + marker.length;
          consumed = true;
          break;
        }
        if (consumed) continue;
      }
      const image = character === '!' && text[index + 1] === '[';
      if (image || character === '[') {
        const labelStart = index + (image ? 2 : 1);
        const labelEnd = text.indexOf('](', labelStart);
        if (labelEnd >= 0) {
          let end = labelEnd + 2;
          let level = 1;
          while (end < text.length && level > 0) {
            if (text[end] === '\\') { end += 2; continue; }
            if (text[end] === '(') level += 1;
            if (text[end] === ')') level -= 1;
            end += 1;
          }
          if (!level) {
            flush();
            const label = text.slice(labelStart, labelEnd);
            const target = text.slice(labelEnd + 2, end - 1).trim().replace(/^<|>$/g, '');
            if (image) {
              // 图片的源文本参与光标映射，图片本身只是不可编辑的预览。
              const address = imageAddress(target);
              if (address) {
                syntax(parent, text.slice(index, end), caret, start + index);
                const preview = element('button', 'md-editor-image');
                preview.type = 'button';
                preview.tabIndex = -1;
                preview.contentEditable = 'false';
                preview.dataset.mdDecoration = '';
                preview.dataset.action = 'preview-markdown-image';
                preview.dataset.src = address;
                preview.dataset.alt = label;
                preview.setAttribute('aria-label', '放大图片：' + (label || '图片'));
                parent.append(preview);
                const picture = element('img', 'markdown-image');
                picture.src = address;
                picture.alt = label;
                picture.loading = 'lazy';
                picture.draggable = false;
                preview.append(picture);
                index = end;
                continue;
              }
            } else {
              syntax(parent,'[',caret,start+index,{start:start+index,end:start+end});
              const link = element('span', 'markdown-link md-editor-link');
              renderInline(label, link, caret, start + labelStart, depth + 1);
              parent.append(link);
              syntax(parent,text.slice(labelEnd,end),caret,start+labelEnd,{start:start+index,end:start+end});
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

  /* ==================== 编辑器公用接口 ==================== */

  /**
   * @brief 无依赖的实时 Markdown 编辑控制器。
   * @details 原文是唯一数据源；只在非 IME 组合阶段重建排版，所有输入通过原文选区进行修改。
   * @date 2026-10-20
   * @author LiMuhua
   */
  class MarkdownEditor {
    /** @brief 创建实例并绑定容器。 @param {HTMLElement} host 容器或 textarea。 @param {object} options 初始值、回调和尺寸。 */
    constructor(host, options = {}) {
      this.textarea = host.tagName === 'TEXTAREA' ? host : null; // 兼容原表单与保存逻辑。
      this.options = options; // 创建选项。
      this.value = String(options.value !== undefined ? options.value : this.textarea ? this.textarea.value : ''); // 完整原文。
      this.lines = splitLines(this.value); // 当前行模型。
      this.activeLine = -1; // 当前光标所在行，仅用于编辑状态样式。
      this.markerState = ''; // 当前可见标记的组合，避免在正文内移动时重建排版。
      this.composing = false; // 输入法组合状态。
      this.compositionEnding = false; // 组合结束时不再追加中间撤销快照。
      this.destroyed = false; // 生命周期标记。
      this.rendering = false; // 排版期间忽略选区事件。
      this.selection = { start: this.value.length, end: this.value.length, direction: 'none' }; // 原文选区。
      this.undoStack = []; // 编辑历史。
      this.redoStack = []; // 重做历史。
      this.listeners = []; // 可清理的局部事件监听。
      this.element = element('div', ((this.textarea && this.textarea.className) || '') + ' live-markdown-editor markdown-body'); // 真正的可编辑表面。
      this.element.contentEditable = this.textarea && (this.textarea.disabled || this.textarea.readOnly) ? 'false' : 'true';
      this.element.dataset.mdEditor = '';
      this.element.dataset.editorFor = this.textarea ? this.textarea.id || this.textarea.dataset.editId || 'markdown-' + (++editorSequence) : 'markdown-' + (++editorSequence);
      this.element.dataset.placeholder = options.placeholder || (this.textarea && this.textarea.placeholder) || '写下内容…';
      this.element.setAttribute('role', 'textbox');
      this.element.setAttribute('aria-multiline', 'true');
      this.element.setAttribute('aria-label', (this.textarea && this.textarea.getAttribute('aria-label')) || this.element.dataset.placeholder);
      this.element.spellcheck = this.textarea ? this.textarea.spellcheck : false;
      this.element.tabIndex = this.textarea ? this.textarea.tabIndex : 0;
      this.element.style.minHeight = typeof options.minHeight === 'number' ? options.minHeight + 'px' : options.minHeight || '';
      this.element.style.maxHeight = typeof options.maxHeight === 'number' ? options.maxHeight + 'px' : options.maxHeight || '380px';
      this.element.style.overflowY = 'auto';
      this.element.style.whiteSpace = 'pre-wrap';
      this.element.style.overflowWrap = 'anywhere';
      if (this.textarea) {
        this.originalHidden = this.textarea.hidden; // 销毁时还原原输入框。
        this.originalDisplay = this.textarea.style.display;
        this.originalFocus = Object.getOwnPropertyDescriptor(this.textarea, 'focus');
        this.originalBlur = Object.getOwnPropertyDescriptor(this.textarea, 'blur');
        this.originalSetSelection = Object.getOwnPropertyDescriptor(this.textarea, 'setSelectionRange');
        this.nativeSetSelection = this.textarea.setSelectionRange;
        this.textarea.hidden = true;
        this.textarea.style.display = 'none';
        this.textarea.after(this.element);
        this.textarea.liveMarkdown = this;
        this.textarea.focus = this.focus.bind(this);
        this.textarea.blur = this.blur.bind(this);
        this.textarea.setSelectionRange = this.setSelectionRange.bind(this);
      } else host.append(this.element);
      this.bindEvents();
      this.render();
    }

    /** @brief 读取完整 Markdown 原文。 @return {string} 原文。 */
    getValue() { return this.value; }

    /** @brief 设置外部原文，默认不触发保存事件。 @param {string} value 原文。 @param {object} options emit 可主动派发变更。 */
    setValue(value, options = {}) {
      if (this.destroyed) return;
      const next = String(value == null ? '' : value);
      if (next === this.value) return;
      if (this.composing) {
        // 外部清空通常来自提交；先结束本实例的组合状态，避免旧 DOM 回写新值。
        this.composing = false;
      }
      this.value = next;
      this.selection.start = Math.min(this.selection.start, next.length);
      this.selection.end = Math.min(this.selection.end, next.length);
      this.activeLine = this.hasFocus() ? this.lineAt(this.selection.end) : -1;
      this.render(this.hasFocus() ? this.selection : null);
      if (this.textarea) this.textarea.value = next;
      if (options.emit) this.notify();
    }

    /** @brief 聚焦编辑区并恢复原文选区。 @param {FocusOptions} options 聚焦选项。 */
    focus(options = {}) {
      if (this.destroyed) return;
      this.element.focus(options);
      this.setSelectionRange(this.selection.start, this.selection.end, this.selection.direction);
    }

    /** 取消实际编辑表面的焦点，兼容原 textarea 的收起逻辑。 */
    blur() {
      if (!this.destroyed) this.element.blur();
    }

    /** @brief 按原文位置设置选区，与 textarea 的 UTF-16 偏移保持一致。 @param {number} start 起点。 @param {number} end 终点。 @param {string} direction 选区方向。 */
    setSelectionRange(start, end = start, direction = 'none') {
      if (this.destroyed) return;
      this.selection = { start: Math.max(0, Math.min(Number(start) || 0, this.value.length)), end: Math.max(0, Math.min(Number(end) || 0, this.value.length)), direction: direction };
      if (this.selection.start > this.selection.end) this.selection.start = this.selection.end;
      const active = this.hasFocus() ? this.lineAt(direction === 'backward' ? this.selection.start : this.selection.end) : -1;
      if (!this.composing) {
        this.activeLine = active;
        if (this.markerKey() !== this.markerState) this.render();
      }
      this.restoreSelection(this.selection);
      this.syncTextareaSelection();
    }

    /** 释放表面并恢复原输入框。 */
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (focusedEditor === this) focusedEditor = null;
      for (const binding of this.listeners) binding[0].removeEventListener(binding[1], binding[2], binding[3]);
      if (this.textarea) {
        this.textarea.value = this.value;
        this.textarea.hidden = this.originalHidden;
        this.textarea.style.display = this.originalDisplay;
        if (this.originalFocus) Object.defineProperty(this.textarea, 'focus', this.originalFocus);
        else delete this.textarea.focus;
        if (this.originalBlur) Object.defineProperty(this.textarea, 'blur', this.originalBlur);
        else delete this.textarea.blur;
        if (this.originalSetSelection) Object.defineProperty(this.textarea, 'setSelectionRange', this.originalSetSelection);
        else delete this.textarea.setSelectionRange;
        delete this.textarea.liveMarkdown;
      }
      this.element.remove();
    }

    /* ==================== 私有选区与原文映射 ==================== */

    /** @brief 判断本实例是否拥有输入焦点。 @return {boolean} 是否聚焦。 */
    hasFocus() { return document.activeElement === this.element || this.element.contains(document.activeElement); }

    /** @brief 查找原文位置所属行。 @param {number} offset 原文偏移。 @return {number} 行号。 */
    lineAt(offset) {
      const lines = splitLines(this.value);
      for (let index = 0; index < lines.length - 1; index += 1) if (offset < lines[index + 1].start) return index;
      return lines.length - 1;
    }

    /** @brief 读取当前 DOM，包括输入法尚未排版的内容。 @return {string} 保留空白的原文。 */
    readDOM() {
      let result = '';
      const children = Array.from(this.element.childNodes);
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        result += nodeText(child);
        result += this.domEnding(child, index, children.length);
      }
      return result;
    }

    /** @brief 读取实际块间换行，兼容输入法删除跨行选区后的原生 DOM 合并。 @param {Node} child 行节点。 @param {number} index 当前行。 @param {number} count 实际行数。 @return {string} 当前块之后的换行。 */
    domEnding(child, index, count) {
      if (index >= count - 1) return '';
      return child.nodeType === 1 && child.dataset.eol || (this.value.match(/\r\n|\r|\n/) || ['\n'])[0];
    }

    /** @brief 将 DOM 选区端点转换为原文偏移。 @param {Node} target 端点节点。 @param {number} offset 节点内偏移。 @return {number|null} 原文偏移。 */
    sourceOffset(target, offset) {
      if (!target || !this.element.contains(target) && target !== this.element) return null;
      if (target === this.element) {
        let length = 0;
        for (let index = 0; index < Math.min(offset, this.element.childNodes.length); index += 1) {
          const child = this.element.childNodes[index];
          length += nodeText(child).length + this.domEnding(child, index, this.element.childNodes.length).length;
        }
        return length;
      }
      let length = 0;
      for (let index = 0; index < this.element.childNodes.length; index += 1) {
        const child = this.element.childNodes[index];
        const part = pointLength(child, target, offset);
        if (part.found) return length + part.length;
        length += part.length + this.domEnding(child, index, this.element.childNodes.length).length;
      }
      return length;
    }

    /** @brief 读取原文选区。 @return {object} 起止偏移与方向。 */
    readSelection() {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return this.selection;
      const anchor = this.sourceOffset(selection.anchorNode, selection.anchorOffset);
      const focus = this.sourceOffset(selection.focusNode, selection.focusOffset);
      if (anchor === null || focus === null) return this.selection;
      return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: anchor > focus ? 'backward' : anchor < focus ? 'forward' : 'none' };
    }

    /** @brief 将完整可见格式内容的复制选区扩展为成对原文，避免浏览器省略隐藏的开闭标记。 @param {object} range 原始选区。 @return {object} 复制及剪切使用的完整原文选区。 */
    clipboardRange(range = this.readSelection()) {
      const result = { ...range };
      if (result.start === result.end) return result;
      const groups = new Map();
      for (const node of this.element.querySelectorAll('[data-md-group-start]')) {
        const start = Number(node.dataset.mdGroupStart);
        const end = Number(node.dataset.mdGroupEnd);
        const key = start + ':' + end;
        const group = groups.get(key) || { start: start, end: end, contentStart: start, contentEnd: end };
        if (Number(node.dataset.mdStart) === start) group.contentStart = Number(node.dataset.mdEnd);
        if (Number(node.dataset.mdEnd) === end) group.contentEnd = Number(node.dataset.mdStart);
        groups.set(key, group);
      }
      // 从内到外处理，例如完整选中链接中的加粗文字时，一并保留两层标记。
      for (const group of Array.from(groups.values()).sort((left, right) => (left.end - left.start) - (right.end - right.start))) {
        if (group.contentStart < group.contentEnd && result.start <= group.contentStart && result.end >= group.contentEnd && result.start < group.end && result.end > group.start) {
          result.start = Math.min(result.start, group.start);
          result.end = Math.max(result.end, group.end);
        }
      }
      return result;
    }

    /** @brief 找到原文偏移对应的可编辑文本节点。 @param {number} offset 原文偏移。 @return {{node:Node,offset:number}} DOM 端点。 */
    domPoint(offset) {
      const index = this.lineAt(offset);
      const line = this.element.children[index];
      if (!line) return { node: this.element, offset: this.element.childNodes.length };
      let remaining = Math.max(0, Math.min(offset - this.lines[index].start, this.lines[index].text.length));
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, { acceptNode: function acceptText(node) {
        return node.parentElement && node.parentElement.closest('[data-md-decoration]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      } });
      let node;
      let last = null;
      while ((node = walker.nextNode())) {
        last = node;
        if (remaining <= node.length) return { node: node, offset: remaining };
        remaining -= node.length;
      }
      return last ? { node: last, offset: last.length } : { node: line, offset: 0 };
    }

    /** @brief 排版后恢复原文选区，保留反向选择。 @param {object} saved 原文选区。 */
    restoreSelection(saved) {
      if (!this.hasFocus() || this.composing || !this.element.isConnected) return;
      const selection = window.getSelection();
      const start = this.domPoint(saved.start);
      const end = this.domPoint(saved.end);
      if (selection.setBaseAndExtent) {
        const backward = saved.direction === 'backward';
        selection.setBaseAndExtent(backward ? end.node : start.node, backward ? end.offset : start.offset, backward ? start.node : end.node, backward ? start.offset : end.offset);
      } else {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    /** 同步原输入框的选区属性，供现有工具栏插入逻辑使用。 */
    syncTextareaSelection() {
      if (this.textarea && this.nativeSetSelection) this.nativeSetSelection.call(this.textarea, this.selection.start, this.selection.end, this.selection.direction);
    }

    /** 同步原文选区，仅在标记边界或所在行变化时重排。 */
    selectionChanged() {
      if (this.destroyed || this.rendering || this.composing || !this.hasFocus()) return;
      this.selection = this.readSelection();
      this.syncTextareaSelection();
      const active = this.lineAt(this.selection.direction === 'backward' ? this.selection.start : this.selection.end);
      this.activeLine = active;
      if (this.markerKey() !== this.markerState) this.render(this.selection);
    }

    /* ==================== 私有渲染与输入处理 ==================== */

    /** @brief 返回需要展开标记的插入位置，选中正文时保持排版。 @return {number|null} 插入位置。 */
    markerCaret() {
      return this.hasFocus() && this.selection.start === this.selection.end ? this.selection.end : null;
    }

    /** @brief 计算标记可见状态，正文中的普通光标移动不重建 DOM。 @return {string} 当前行与可见标记标识。 */
    markerKey() {
      const caret = this.markerCaret();
      let key = String(this.activeLine) + '|';
      for (const node of this.element.querySelectorAll('.md-syntax')) {
        const start=Number(node.dataset.mdRevealStart??node.dataset.mdStart);
        const end=Number(node.dataset.mdRevealEnd??node.dataset.mdEnd);
        if (markerVisible(caret, start, end - start)) key += start + ':' + end + ';';
      }
      return key;
    }

    /** @brief 生成可点击的待办复选框，装饰不参与原文映射。 @param {HTMLElement} line 所在行。 @param {number} offset 原文中空格或 x 的位置。 @param {boolean} checked 是否完成。 */
    renderTask(line, offset, checked) {
      const checkbox = element('button', 'md-task-checkbox md-task-toggle', checked ? '✓' : '');
      checkbox.type = 'button';
      checkbox.dataset.mdDecoration = '';
      checkbox.dataset.mdTask = String(offset);
      checkbox.contentEditable = 'false';
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-checked', String(checked));
      checkbox.setAttribute('aria-label', checked ? '取消完成待办' : '完成待办');
      checkbox.disabled = this.element.contentEditable === 'false';
      line.append(checkbox);
    }

    /** @brief 点击待办时只替换状态字符，保留光标和原始换行。 @param {HTMLElement} checkbox 待办按钮。 */
    toggleTask(checkbox) {
      if (this.composing || this.element.contentEditable === 'false') return;
      const offset = Number(checkbox.dataset.mdTask);
      if (!Number.isInteger(offset) || this.value[offset - 1] !== '[' || this.value[offset + 1] !== ']' || !/[ xX]/.test(this.value[offset] || '')) return;
      const selection = this.readSelection();
      // 键盘触发按钮时将焦点还给编辑表面，重排后仍可继续输入。
      if (this.hasFocus() && document.activeElement !== this.element) this.element.focus({ preventScroll: true });
      this.remember(selection);
      this.value = this.value.slice(0, offset) + (/[xX]/.test(this.value[offset]) ? ' ' : 'x') + this.value.slice(offset + 1);
      this.selection = selection;
      this.activeLine = this.hasFocus() ? this.lineAt(selection.end) : -1;
      this.render(selection);
      this.notify();
    }

    /** @brief 生成每行格式，并保持所有原文字符可回读。 @param {object|null} saved 要恢复的原文选区。 */
    render(saved = null) {
      if (this.composing || this.destroyed) return;
      this.rendering = true;
      this.lines = splitLines(this.value);
      const caret = this.markerCaret();
      const fragment = document.createDocumentFragment();
      let fence = null;
      for (let index = 0; index < this.lines.length; index += 1) {
        const model = this.lines[index];
        const active = index === this.activeLine;
        const line = element('div', 'md-editor-line' + (active ? ' is-active' : ''));
        line.dataset.mdLine = String(index);
        line.dataset.eol = model.eol;
        const marker = model.text.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker && (!fence || fence.character === marker[1][0] && marker[1].length >= fence.length)) {
          fence = fence ? null : { character: marker[1][0], length: marker[1].length };
          line.classList.add('md-fence-marker');
          if (!markerVisible(caret, model.start, model.text.length)) line.classList.add('is-collapsed');
          syntax(line, model.text, caret, model.start);
        } else if (fence || /^(?: {4}|\t)/.test(model.text)) {
          line.classList.add('md-fenced-code');
          line.append(element('code', '', model.text));
        } else {
          const heading = model.text.match(/^(\s{0,3}#{1,6}[\t ]+)(.*)$/);
          const quote = model.text.match(/^(\s{0,3}>[\t ]?)(.*)$/);
          const item = model.text.match(/^(\s{0,3})([-+*]|\d+[.)])([\t ]+)(.*)$/);
          const rule = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(model.text);
          if (heading) {
            line.classList.add('md-heading', 'md-heading-' + heading[1].trim().length);
            syntax(line, heading[1], caret, model.start);
            renderInline(heading[2], line, caret, model.start + heading[1].length);
          } else if (quote) {
            line.classList.add('md-quote');
            syntax(line, quote[1], caret, model.start);
            renderInline(quote[2], line, caret, model.start + quote[1].length);
          } else if (rule) {
            line.classList.add('md-rule');
            syntax(line, model.text, caret, model.start);
            if (!markerVisible(caret, model.start, model.text.length)) decoration(line, 'md-rule-line', '');
          } else if (item) {
            line.classList.add('md-list-item');
            const prefix = item[1] + item[2] + item[3];
            const task = item[4].match(/^(\[[ xX]\][\t ]+)(.*)$/);
            if (!task && !markerVisible(caret, model.start, prefix.length)) decoration(line, 'md-list-bullet', /^\d/.test(item[2]) ? item[2] + ' ' : '• ');
            syntax(line, prefix, caret, model.start);
            if (task) {
              this.renderTask(line, model.start + prefix.length + 1, /[xX]/.test(task[1]));
              syntax(line, task[1], caret, model.start + prefix.length);
              renderInline(task[2], line, caret, model.start + prefix.length + task[1].length);
            } else renderInline(item[4], line, caret, model.start + prefix.length);
          } else renderInline(model.text, line, caret, model.start);
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

    /** 同步原输入框并派发既有保存事件。 */
    notify() {
      if (this.textarea) {
        this.textarea.value = this.value;
        this.syncTextareaSelection();
        this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof this.options.onChange === 'function') this.options.onChange(this.value, this);
    }

    /** @brief 保存编辑前状态用于撤销。 @param {object} selection 当前选区。 */
    remember(selection) {
      this.undoStack.push({ value: this.value, selection: { ...selection } });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    /** @brief 以原文片段替换选区并重新排版。 @param {string} text 插入文本。 @param {object} range 原文选区。 */
    replace(text, range = this.readSelection()) {
      this.remember(range);
      this.value = this.value.slice(0, range.start) + text + this.value.slice(range.end);
      const caret = range.start + text.length;
      this.selection = { start: caret, end: caret, direction: 'none' };
      this.activeLine = this.lineAt(caret);
      this.render(this.selection);
      this.notify();
    }

    /** @brief 恢复撤销或重做历史。 @param {boolean} redo 是否重做。 */
    history(redo) {
      const from = redo ? this.redoStack : this.undoStack;
      const to = redo ? this.undoStack : this.redoStack;
      if (!from.length) return;
      to.push({ value: this.value, selection: this.readSelection() });
      const snapshot = from.pop();
      this.value = snapshot.value;
      this.selection = snapshot.selection;
      this.activeLine = this.lineAt(this.selection.end);
      this.render(this.selection);
      this.notify();
    }

    /** @brief 按字符或词扩展删除范围，避免拆开代理对和组合字符。 @param {object} range 当前选区。 @param {string} type 删除类型。 @return {object} 删除范围。 */
    deletionRange(range, type) {
      if (range.start !== range.end) return range;
      const backward = /Backward$/.test(type);
      if (/Word/.test(type)) {
        if (backward) range.start -= (this.value.slice(0, range.start).match(/(?:\s*[^\s]+|\s+)$/u) || [''])[0].length;
        else range.end += (this.value.slice(range.end).match(/^(?:\s*[^\s]+|\s+)/u) || [''])[0].length;
      } else if (/Line/.test(type)) {
        const line = splitLines(this.value)[this.lineAt(range.start)];
        if (backward) range.start = line.start;
        else range.end = line.end;
      } else if (backward && range.start > 0) {
        if (this.value.slice(range.start - 2, range.start) === '\r\n') range.start -= 2;
        else if (typeof Intl.Segmenter === 'function') {
          const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(this.value.slice(0, range.start));
          for (const segment of segments) range.start = segment.index;
        } else range.start -= this.value.codePointAt(range.start - 2) > 0xFFFF ? 2 : 1;
      } else if (!backward && range.end < this.value.length) {
        if (this.value.slice(range.end, range.end + 2) === '\r\n') range.end += 2;
        else if (typeof Intl.Segmenter === 'function') range.end += new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(this.value.slice(range.end))[Symbol.iterator]().next().value.segment.length;
        else range.end += this.value.codePointAt(range.end) > 0xFFFF ? 2 : 1;
      }
      return range;
    }

    /** @brief 处理普通输入；输入法组合输入交由浏览器执行。 @param {InputEvent} event 输入事件。 */
    beforeInput(event) {
      if (this.composing || event.isComposing || event.inputType === 'insertCompositionText') return;
      const type = event.inputType;
      if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); this.history(type === 'historyRedo'); return; }
      if (/^delete/.test(type)) {
        event.preventDefault();
        this.replace('', this.deletionRange(this.readSelection(), type));
        return;
      }
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        this.replace((this.value.match(/\r\n|\r|\n/) || ['\n'])[0]);
        return;
      }
      if (type === 'insertText' || type === 'insertReplacementText' || type === 'insertFromDrop') {
        event.preventDefault();
        const text = event.data !== null ? event.data : event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
        this.replace(text || '');
        return;
      }
      if (/^format/.test(type)) event.preventDefault();
    }

    /** @brief 吸收输入法或浏览器原生输入，保留原有换行和空白。 @param {boolean} finish 是否完成组合并排版。 */
    absorbDOM(finish = false) {
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

    /** @brief 注册便于销毁的事件监听。 @param {EventTarget} target 目标。 @param {string} type 事件名。 @param {Function} handler 处理函数。 @param {object|boolean} options 事件选项。 */
    listen(target, type, handler, options = false) {
      target.addEventListener(type, handler, options);
      this.listeners.push([target, type, handler, options]);
    }

    /** 绑定真实编辑、纯文本粘贴、输入法与既有输入框事件。 */
    bindEvents() {
      this.listen(this.element, 'focus', () => {
        focusedEditor = this;
        this.activeLine = this.lineAt(this.selection.end);
        this.render(this.selection);
        if (this.textarea) this.textarea.dispatchEvent(new Event('focus'));
      });
      this.listen(this.element, 'blur', () => {
        if (this.composing) { this.composing = false; this.compositionEnding = true; this.absorbDOM(); this.compositionEnding = false; }
        this.selection = this.readSelection();
        this.activeLine = -1;
        this.render();
        if (focusedEditor === this) focusedEditor = null;
        if (this.textarea) this.textarea.dispatchEvent(new Event('blur'));
      });
      this.listen(this.element, 'mousedown', (event) => {
        // 操作待办或图片时保留正文选区，避免光标被装饰节点夺走。
        if (event.target.closest('[data-md-task],[data-action="preview-markdown-image"]') && (event.button === undefined || event.button === 0)) event.preventDefault();
      });
      this.listen(this.element, 'click', (event) => {
        const checkbox = event.target.closest('[data-md-task]');
        if (!checkbox || !this.element.contains(checkbox)) return;
        event.preventDefault();
        event.stopPropagation();
        this.toggleTask(checkbox);
      });
      this.listen(this.element, 'beforeinput', (event) => this.beforeInput(event));
      this.listen(this.element, 'input', (event) => {
        if (event.target === this.element) this.absorbDOM(!this.composing && !event.isComposing);
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
        if (!event.clipboardData) return;
        event.preventDefault();
        if (event.clipboardData.files.length) return;
        this.replace(event.clipboardData.getData('text/plain'));
      });
      this.listen(this.element, 'copy', (event) => {
        const range = this.clipboardRange();
        if (range.start === range.end || !event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', this.value.slice(range.start, range.end));
      });
      this.listen(this.element, 'cut', (event) => {
        const range = this.clipboardRange();
        if (range.start === range.end || !event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', this.value.slice(range.start, range.end));
        this.replace('', range);
      });
      this.listen(this.element, 'drop', (event) => {
        if (!event.dataTransfer || event.defaultPrevented || event.sideNotesDropHandled) return;
        // 文件由应用附件流程处理；独立编辑器只接收纯文本，避免重复插入。
        if (event.dataTransfer.files.length) return;
        const text = event.dataTransfer.getData('text/plain');
        if (!text) return;
        event.preventDefault();
        event.sideNotesDropHandled = true;
        this.replace(text);
      });
      this.listen(this.element, 'keydown', (event) => {
        if (this.composing || event.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          this.setSelectionRange(0, this.value.length, 'forward');
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && /^[zy]$/i.test(event.key)) {
          event.preventDefault();
          this.history(event.key.toLowerCase() === 'y' || event.shiftKey);
        } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          this.replace('  ');
        }
      });
    }
  }

  /* ==================== 公开工厂与共享监听 ==================== */

  /** @brief 创建实时 Markdown 编辑器。 @param {HTMLElement} host 容器或 textarea。 @param {object} options 创建选项。 @return {MarkdownEditor} 控制器。 */
  function create(host, options = {}) {
    if (!host || !host.append) throw new TypeError('实时 Markdown 编辑器需要有效的 DOM 容器。');
    if (host.liveMarkdown) { if (options.value !== undefined) host.liveMarkdown.setValue(options.value); return host.liveMarkdown; }
    return new MarkdownEditor(host, options);
  }

  /** @brief 为既有 textarea 挂载编辑器，保留其输入保存事件。 @param {HTMLTextAreaElement} textarea 原输入框。 @param {object} options 创建选项。 @return {MarkdownEditor} 控制器。 */
  function attach(textarea, options = {}) { return create(textarea, options); }

  document.addEventListener('selectionchange', function scheduleSelectionChange() {
    if (!focusedEditor || selectionFrame) return;
    selectionFrame = window.requestAnimationFrame(function updateSelection() {
      selectionFrame = 0;
      if (focusedEditor && !focusedEditor.element.isConnected) focusedEditor = null;
      if (focusedEditor) focusedEditor.selectionChanged();
    });
  });

  window.LiveMarkdown = Object.freeze({ create: create, attach: attach });
})();
