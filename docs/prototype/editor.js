'use strict';

/** 实时 Markdown 编辑器：保留原文，以可编辑 DOM 显示排版和插入光标附近的标记。 */
(function exposeLiveMarkdown() {
  let focusedEditor = null; // 当前正在编辑的实例，避免为每张卡片保留全局监听器。
  let selectionFrame = 0; // 合并同一帧中的选区变化。
  let activeDrag = null; // 从编辑面中拖出的一段选中文字：落在同一个编辑面时移动，不是复制。
  let attachmentDrag = null; // 正在拖动的附件块（同一时间只有一个，见 pressAttachment）。
  let editorSequence = 0; // 无 id 输入框的关联编号。

  /** @return {number} 整页缩放倍数（字号 ÷ 13）：侧栏、速记浮窗与记录窗口都按它缩放。 */
  function appZoom() { return parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) || 1; }

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
    // 正文中的图片引用 sidenotes-image:（app.js 的 SideNotesImages）：换成随记录保存的图片内容。
    if (/^sidenotes-image:/i.test(value)) return window.SideNotesImages ? window.SideNotesImages.resolve(value) || null : null;
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

  /**
   * @brief 为原文标记生成可折叠节点。
   * @param {HTMLElement} parent 父节点。 @param {string} text 标记原文。 @param {number|null} caret 原文插入位置。 @param {number} start 标记起点。 @param {object|null} range 包裹结构范围。
   * @param {boolean} locked 一直隐藏、不随光标展开（列表项头与待办标记，由圆点、序号与复选框代替）。
   */
  function syntax(parent, text, caret, start = 0, range = null, locked = false) {
    if (!text) return;
    const revealed = !locked && (range ? markerVisible(caret, range.start, range.end-range.start) : markerVisible(caret,start,text.length));
    const node = element('span', 'md-syntax ' + (revealed ? 'is-revealed' : 'is-hidden'), text);
    node.dataset.mdStart = String(start);
    node.dataset.mdEnd = String(start + text.length);
    node.dataset.mdRevealStart=String(range?range.start:start);
    node.dataset.mdRevealEnd=String(range?range.end:start+text.length);
    if (range) { node.dataset.mdGroupStart = String(range.start); node.dataset.mdGroupEnd = String(range.end); }
    if (locked) node.dataset.mdLocked = '';
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
      // Typora 写法的下划线 <u>…</u>（与现有应用的 editor.ts 一致）：只识别这一对不带属性的标签，其余 HTML 仍按文字显示。
      if (character === '<' && text.slice(index, index + 3).toLowerCase() === '<u>') {
        const close = text.toLowerCase().indexOf('</u>', index + 3);
        if (close > index + 3) {
          flush();
          const group = { start: start + index, end: start + close + 4 };
          syntax(parent, text.slice(index, index + 3), caret, start + index, group);
          const underline = element('u');
          renderInline(text.slice(index + 3, close), underline, caret, start + index + 3, depth + 1);
          parent.append(underline);
          syntax(parent, text.slice(close, close + 4), caret, start + close, group);
          index = close + 4;
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
              // 图片整块显示（与现有应用一致）：原文锁定隐藏，不随光标展开；退格与删除按整个引用删除，点击打开附件弹窗。
              const address = imageAddress(target);
              if (address) {
                syntax(parent, text.slice(index, end), caret, start + index, null, true);
                parent.lastChild.dataset.mdAtomic = '';
                const preview = element('button', 'md-editor-image');
                preview.type = 'button';
                preview.tabIndex = -1;
                // 不用原生拖放：按住移动由 pressAttachment 处理，在编辑面中调整位置。
                preview.draggable = false;
                preview.contentEditable = 'false';
                preview.dataset.mdDecoration = '';
                preview.dataset.mdAttachment = 'image';
                preview.dataset.mdStart = String(start + index);
                preview.dataset.mdEnd = String(start + end);
                preview.dataset.src = target;
                preview.dataset.alt = label;
                preview.setAttribute('aria-label', '图片：' + (label || '图片'));
                parent.append(preview);
                const picture = element('img', 'markdown-image');
                if (window.SideNotesImages) window.SideNotesImages.show(picture, address); else picture.src = address;
                picture.alt = label;
                picture.loading = 'lazy';
                picture.draggable = false;
                preview.append(picture);
                index = end;
                continue;
              }
            } else if (window.NoteContent && (window.NoteContent.isFileToken(target) || window.NoteContent.filePath(target))) {
              // 文件引用整块显示为胶囊：文件图标加名称，原文锁定隐藏，点击打开附件弹窗（与现有应用一致）。
              syntax(parent, text.slice(index, end), caret, start + index, null, true);
              parent.lastChild.dataset.mdAtomic = '';
              const chip = element('button', 'md-attachment-chip');
              chip.type = 'button';
              chip.tabIndex = -1;
              chip.draggable = false;
              chip.contentEditable = 'false';
              chip.dataset.mdDecoration = '';
              chip.dataset.mdAttachment = 'file';
              chip.dataset.mdStart = String(start + index);
              chip.dataset.mdEnd = String(start + end);
              chip.dataset.path = target;
              const name = label.replace(/\\([\\[\]])/g, '$1') || window.NoteContent.fileLabel(target);
              chip.setAttribute('aria-label', '文件：' + name);
              const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              glyph.setAttribute('class', 'icon');
              glyph.setAttribute('aria-hidden', 'true');
              const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
              use.setAttribute('href', '#i-file');
              glyph.append(use);
              chip.append(glyph, element('span', '', name));
              parent.append(chip);
              index = end;
              continue;
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
      this.plainPaste = false; // 按下 Ctrl+Shift+V 时只粘贴纯文本，松开按键后复位。
      this.suppressClick = false; // 拖动附件松开后的那一次单击不打开附件弹窗。
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

    /**
     * @brief 读取原文选区。编辑区获得焦点时从页面选区换算；失焦后编辑区会重新排版，页面选区随之落到编辑区开头，
     * 这时以失焦时记下的选区为准（本次提出：此前点工具栏的图片、文件按钮，附件总插在开头）。
     * @return {object} 起止偏移与方向。
     */
    readSelection() {
      return this.hasFocus() ? this.domSelection() : this.selection;
    }

    /** @brief 从页面选区换算原文选区；页面选区不在编辑区内时返回记下的选区。 @return {object} 起止偏移与方向。 */
    domSelection() {
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
      let fallback = null;
      while ((node = walker.nextNode())) {
        last = node;
        // 隐藏的标记（列表项头、待办标记等）里放不了光标：落在它的边界上时放到后面第一段可见文字的开头。
        if (node.parentElement && node.parentElement.closest('.md-syntax[hidden]')) {
          if (remaining > 0 && remaining < node.length) return { node: node, offset: remaining };
          if (!fallback && remaining <= node.length) fallback = { node: node, offset: remaining };
          remaining = Math.max(0, remaining - node.length);
          continue;
        }
        if (remaining <= node.length) return { node: node, offset: remaining };
        remaining -= node.length;
      }
      if (fallback) return fallback;
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

    /**
     * @brief 光标落在列表项或待办的项头上（圆点、序号或复选框之前）时移到正文开头：项头不能编辑，只能整体删去（本次提出）。
     * @details 从正文开头往左移时跳到上一行末尾；选中一段文字时不处理。
     * @param {object} next 新的选区。 @param {object} previous 之前的选区。 @return {object|null} 改过的选区，不用改时为 null。
     */
    clampToContent(next, previous) {
      if (next.start !== next.end) return null;
      const lines = splitLines(this.value), index = this.lineAt(next.end), line = lines[index];
      const item = line && line.text.match(/^(\s{0,3})([-+*]|\d+[.)])([\t ]+)(\[[ xX]\][\t ]+)?/);
      if (!item || (window.MarkdownCommands && window.MarkdownCommands.inCode(this.value, line.start))) return null;
      const content = line.start + item[0].length;
      if (next.end >= content) return null;
      const leaving = previous && previous.start === previous.end && previous.end === content && index > 0;
      const caret = leaving ? lines[index - 1].end : content;
      return { start: caret, end: caret, direction: 'none' };
    }

    /** 同步原文选区，仅在标记边界或所在行变化时重排。 */
    selectionChanged() {
      if (this.destroyed || this.rendering || this.composing || !this.hasFocus()) return;
      const previous = this.selection;
      this.selection = this.readSelection();
      const clamped = this.clampToContent(this.selection, previous);
      if (clamped) { this.selection = clamped; this.restoreSelection(clamped); }
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
      for (const node of this.element.querySelectorAll('.md-syntax:not([data-md-locked])')) {
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
            if (item[1].length) line.style.setProperty('--md-list-indent', String(item[1].length));
            const prefix = item[1] + item[2] + item[3];
            const task = item[4].match(/^(\[[ xX]\][\t ]+)(.*)$/);
            // 列表与待办的项头不随光标显示原文（本次提出）：一直显示圆点、序号或复选框；
            // 光标在正文开头按退格删去项头，这一行变回普通文字（见 removeListPrefix）。
            if (!task) decoration(line, 'md-list-bullet', /^\d/.test(item[2]) ? item[2] + ' ' : '• ');
            syntax(line, prefix, caret, model.start, null, true);
            if (task) {
              this.renderTask(line, model.start + prefix.length + 1, /[xX]/.test(task[1]));
              syntax(line, task[1], caret, model.start + prefix.length, null, true);
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

    /** @brief 写回编辑命令的结果并记入撤销历史。 @param {object|null} result 新原文与选区。 @param {object} range 命令之前的选区。 @return {boolean} 是否写回。 */
    applyEdit(result, range) {
      if (!result) return false;
      this.remember(range);
      this.value = result.value;
      this.selection = { start: result.start, end: result.end, direction: result.start === result.end ? 'none' : 'forward' };
      this.activeLine = this.lineAt(result.end);
      this.render(this.selection);
      this.notify();
      return true;
    }

    /** @brief 光标在列表项或待办的正文开头时，退格删去项头（保留缩进），这一行变回普通文字。 @param {number} caret 光标。 @return {boolean} 是否处理。 */
    removeListPrefix(caret) {
      const commands = window.MarkdownCommands;
      if (commands && commands.inCode(this.value, caret)) return false;
      const line = splitLines(this.value)[this.lineAt(caret)];
      const item = line && line.text.match(/^(\s{0,3})([-+*]|\d+[.)])([\t ]+)(\[[ xX]\][\t ]+)?/);
      if (!item || caret !== line.start + item[0].length) return false;
      this.replace('', { start: line.start + item[1].length, end: caret, direction: 'none' });
      return true;
    }

    /** @brief 删除范围碰到整块显示的附件引用时，扩大到整个引用。 @param {object} range 删除范围。 @return {object} 范围。 */
    atomicRange(range) {
      let start = range.start, end = range.end;
      this.element.querySelectorAll('.md-syntax[data-md-atomic]').forEach(function cover(node) {
        const from = Number(node.dataset.mdStart), to = Number(node.dataset.mdEnd);
        if (start < to && end > from) { start = Math.min(start, from); end = Math.max(end, to); }
      });
      return { start: start, end: end, direction: range.direction };
    }

    /** @brief 设置中改过的快捷键（没改过的用默认按键）。 @return {object} 绑定。 */
    bindings() {
      if (typeof this.options.shortcuts === 'function') return this.options.shortcuts() || {};
      return (typeof state !== 'undefined' && state && state.settings && state.settings.shortcuts) || {};
    }

    /**
     * @brief 格式快捷键：先按设置中的按键找命令，再看固定的按键：Ctrl+0–6 设为正文与标题，兼容 Alt+Shift+5 删除线与 Ctrl+Shift+` 行内代码（与现有应用的 editor.ts 一致）。
     * @param {KeyboardEvent} event 按键。
     */
    formatShortcut(event) {
      const shortcuts = window.SideNotesShortcuts, commands = window.MarkdownCommands;
      if (!shortcuts || !commands) return;
      const bound = shortcuts.commandFor(event, this.bindings(), ['format']);
      const range = this.readSelection();
      if (bound === 'link') { event.preventDefault(); this.insertLink(range); return; }
      const inline = function inline(marker) { return function wrap(value, start, end) { return commands.toggleInline(value, start, end, marker); }; };
      const table = {
        bold: inline('**'), italic: inline('*'), strike: inline('~~'), inlineCode: inline('`'),
        underline: function underline(value, start, end) { return commands.toggleTag(value, start, end, 'u'); },
        codeBlock: commands.wrapCodeBlock, quote: commands.toggleQuote,
        orderedList: function ordered(value, start, end) { return commands.toggleList(value, start, end, true); },
        bulletList: function bullet(value, start, end) { return commands.toggleList(value, start, end, false); }
      };
      let command = bound ? table[bound] : null;
      if (!command) {
        const combo = shortcuts.comboFromEvent(event);
        const heading = combo && combo.match(/^Ctrl\+([0-6])$/);
        if (heading) command = function setHeading(value, start, end) { return commands.setHeading(value, start, end, Number(heading[1])); };
        else if (combo === 'Alt+Shift+5') command = table.strike;
        else if (combo === 'Ctrl+Shift+`') command = table.inlineCode;
      }
      if (!command) return;
      event.preventDefault();
      this.applyEdit(command(this.value, range.start, range.end), range);
    }

    /** @brief Ctrl+K：剪贴板中是网址时直接生成链接，否则插入或去掉链接；读剪贴板期间原文变了就放弃。 @param {object} range 选区。 */
    insertLink(range) {
      const commands = window.MarkdownCommands, before = this.value;
      const apply = (clipboard) => {
        if (this.destroyed || this.value !== before) return;
        this.applyEdit(commands.linkWithAddress(before, range.start, range.end, clipboard) || commands.toggleLink(before, range.start, range.end), range);
      };
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') { apply(''); return; }
      navigator.clipboard.readText().catch(function denied() { return ''; }).then(function read(text) { apply(String(text || '')); });
    }

    /** @brief 视口坐标处的原文位置（拖放的落点）。 @param {number} x 横坐标。 @param {number} y 纵坐标。 @return {number} 原文偏移，取不到时是末尾。 */
    offsetAt(x, y) {
      const point = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
      const range = !point && document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      const offset = point ? this.sourceOffset(point.offsetNode, point.offset) : range ? this.sourceOffset(range.startContainer, range.startOffset) : null;
      return offset === null ? this.value.length : offset;
    }

    /**
     * @brief 把一段原文移到另一个位置（编辑面中拖动附件或文字），记入撤销历史；落点在这段原文之内时不动。
     * @param {number} start 起点。 @param {number} end 终点。 @param {number} target 落点（按移动前的原文计）。 @return {boolean} 是否移动。
     */
    moveText(start, end, target) {
      if (!(end > start) || target >= start && target <= end || this.value.slice(start, end) === '') return false;
      const text = this.value.slice(start, end);
      this.remember({ start: start, end: end, direction: 'none' });
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

    /* ==================== 拖动附件调整位置（本次提出） ==================== */

    /**
     * @brief 按住编辑面中的图片或文件块：移动 4 像素后开始拖动，松开时移到插入光标处；没有移动就是单击，照常打开附件弹窗。
     * @details 不用浏览器的原生拖放：按下附件时要阻止默认行为，光标与焦点才不会被附件夺走（见 mousedown），原生拖放因此无法开始。
     * Esc 取消拖动，不退出编辑。
     * @param {PointerEvent} event 按下。
     */
    pressAttachment(event) {
      const node = event.target.closest ? event.target.closest('[data-md-attachment]') : null;
      if (!node || !this.element.contains(node) || event.button !== 0 || attachmentDrag || this.composing || this.element.contentEditable === 'false') return;
      const start = Number(node.dataset.mdStart), end = Number(node.dataset.mdEnd);
      if (!(end > start) || !this.value.slice(start, end).trim()) return;
      const drag = attachmentDrag = { node: node, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: start, end: end, active: false, target: -1 };
      const move = (next) => { if (next.pointerId === drag.pointerId) this.moveAttachmentDrag(drag, next); };
      const stop = (last) => {
        if (last.type === 'keydown') {
          if (last.key !== 'Escape') return;
          if (drag.active) { last.preventDefault(); last.stopPropagation(); }
        } else if (last.pointerId !== drag.pointerId) return;
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
     * @brief 拖动中：拖影跟随指针（与卡片拖影同样倾斜），插入光标落在指针处的字符之间（第四次反馈：不再只按行）；
     * 指针靠近编辑区上下边缘时滚动。
     * @param {object} drag 拖动。 @param {PointerEvent} event 移动。
     */
    moveAttachmentDrag(drag, event) {
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 || !drag.node.isConnected) return;
        drag.active = true;
        const box = drag.node.getBoundingClientRect();
        drag.zoom = appZoom();
        drag.grab = { x: drag.x - box.left, y: drag.y - box.top };
        drag.bounds = this.attachmentBounds(drag);
        drag.ghost = element('div', 'md-drag-ghost');
        drag.ghost.setAttribute('aria-hidden', 'true');
        drag.ghost.append(drag.node.cloneNode(true));
        // 插入光标：一条强调色的竖线，上端一个小圆点（与标签页的插入线同一种样子），落在字符之间。
        drag.guide = element('div', 'md-drop-caret');
        drag.guide.hidden = true;
        document.body.append(drag.ghost, drag.guide);
        drag.node.classList.add('is-drag-source');
        document.body.classList.add('is-dragging-attachment');
      }
      event.preventDefault();
      drag.ghost.style.left = (event.clientX - drag.grab.x) / drag.zoom + 'px';
      drag.ghost.style.top = (event.clientY - drag.grab.y) / drag.zoom + 'px';
      const box = this.element.getBoundingClientRect(), edge = 24;
      if (this.element.scrollHeight > this.element.clientHeight) {
        if (event.clientY < box.top + edge) this.element.scrollTop -= Math.ceil((box.top + edge - event.clientY) / 3);
        else if (event.clientY > box.bottom - edge) this.element.scrollTop += Math.ceil((event.clientY - box.bottom + edge) / 3);
      }
      // 指针处的原文位置，限制在标题行之后、正文末尾之前；落在附件自身（含紧挨着的两端）等于没动，不显示插入光标。
      const target = Math.max(drag.bounds.min, Math.min(drag.bounds.max, this.offsetAt(event.clientX, event.clientY)));
      drag.target = target >= drag.bounds.own.start && target <= drag.bounds.own.end ? -1 : target;
      const caret = drag.target < 0 ? null : this.caretRect(drag.target);
      if (!caret) { drag.guide.hidden = true; return; }
      drag.guide.hidden = caret.top + caret.height < box.top - 1 || caret.top > box.bottom + 1;
      drag.guide.style.left = caret.left + 'px';
      drag.guide.style.top = caret.top + 'px';
      drag.guide.style.height = caret.height + 'px';
    }

    /**
     * @brief 原文偏移在屏幕上的位置（拖动附件时的插入光标）：取这个位置的文字矩形；紧挨着图片、文件块或空行时，取它们的边缘。
     * @param {number} offset 原文偏移。 @return {{left:number,top:number,height:number}|null} 视口坐标。
     */
    caretRect(offset) {
      const line = this.element.children[this.lineAt(offset)];
      if (!line) return null;
      const widget = Array.from(line.querySelectorAll('[data-md-attachment]')).find(function adjacent(node) { return Number(node.dataset.mdStart) === offset || Number(node.dataset.mdEnd) === offset; });
      if (widget) {
        const box = widget.getBoundingClientRect();
        return { left: Number(widget.dataset.mdStart) === offset ? box.left : box.right, top: box.top, height: box.height };
      }
      const point = this.domPoint(offset), range = document.createRange();
      try { range.setStart(point.node, point.offset); range.collapse(true); } catch (error) { return null; }
      const rect = Array.from(range.getClientRects()).find(function visible(item) { return item.height > 0; });
      if (rect) return { left: rect.left, top: rect.top, height: rect.height };
      const box = line.getBoundingClientRect();
      return { left: box.left, top: box.top, height: box.height };
    }

    /**
     * @brief 附件可以放的范围（按移动前的原文偏移计）：标题行之后、正文末尾之前，标题与标签不变（与插入附件的规则一致）；
     * 附件自身连同紧挨着的空白算作原处。标题与正文末尾按去掉附件后的原文找，再换回移动前的偏移。
     * @param {object} drag 拖动。 @return {{min:number,max:number,own:{start:number,end:number}}} 落点的上下限与原处的范围。
     */
    attachmentBounds(drag) {
      const length = drag.end - drag.start, remaining = this.value.slice(0, drag.start) + this.value.slice(drag.end);
      const original = function original(offset) { return offset < drag.start ? offset : offset + length; };
      const content = window.NoteContent, title = content ? content.titleLine(remaining) : null;
      // 标题行之后：下一行的开头；标题后面没有换行时（只有标题一行）是标题行末尾，松开时另起一行。
      const next = title ? /^(?:\r\n|\r|\n)/.exec(remaining.slice(title.end)) : null;
      const min = title ? title.end + (next ? next[0].length : 0) : 0;
      const max = content ? content.bodyEnd(remaining) : remaining.length;
      let ownStart = drag.start, ownEnd = drag.end;
      while (ownStart > 0 && /[\t ]/.test(this.value[ownStart - 1])) ownStart -= 1;
      while (ownEnd < this.value.length && /[\t ]/.test(this.value[ownEnd])) ownEnd += 1;
      return { min: original(min), max: Math.max(original(min), original(max)), own: { start: ownStart, end: ownEnd } };
    }

    /** @brief 结束拖动：松开时移动附件，取消或没有落点时不改动。 @param {object} drag 拖动。 @param {boolean} commit 是否松开在落点上。 */
    endAttachmentDrag(drag, commit) {
      attachmentDrag = null;
      if (!drag.active) return;
      drag.ghost.remove();
      drag.guide.remove();
      drag.node.classList.remove('is-drag-source');
      document.body.classList.remove('is-dragging-attachment');
      // 松开后浏览器还会派发一次单击，不能当作点开附件。
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 0);
      if (!commit || drag.target < 0 || this.destroyed) return;
      if (!this.hasFocus()) this.element.focus({ preventScroll: true });
      this.moveAttachment(drag.start, drag.end, drag.target);
    }

    /**
     * @brief 把一段原文（附件引用）移到字符位置 target（第四次反馈：落点精确到字符），记入撤销历史。
     * 原来那一行只剩空白或列表、引用标记时整行删掉；夹在两个空格之间时去掉一个，免得留下双空格。
     * 落点在标题行末尾（只有标题一行）时另起一行，标题不变。
     * @param {number} start 起点。 @param {number} end 终点。 @param {number} target 落点（按移动前的原文偏移计）。
     * @return {boolean} 是否移动。
     */
    moveAttachment(start, end, target) {
      const text = this.value.slice(start, end).trim();
      if (!text) return false;
      const lines = splitLines(this.value), eol = (this.value.match(/\r\n|\r|\n/) || ['\n'])[0];
      const index = this.lineAt(start), line = lines[index];
      const rest = line.text.slice(0, start - line.start) + line.text.slice(end - line.start);
      let cutStart = start, cutEnd = end;
      if (!rest.replace(/^\s{0,3}(?:(?:[-+*]|\d+[.)])\s*(?:\[[ xX]\]\s*)?|>\s*)/, '').trim()) {
        cutStart = line.start;
        cutEnd = line.end + line.eol.length;
        if (!line.eol && index > 0) cutStart -= lines[index - 1].eol.length;
        // 这一行前后都是空行时一并去掉后面那个，免得留下连着的两行空白。
        const previous = lines[index - 1], following = lines[index + 1];
        if (line.eol && previous && !previous.text.trim() && following && !following.text.trim()) cutEnd = following.end + following.eol.length;
      } else if (this.value[start - 1] === ' ' && this.value[end] === ' ') cutEnd += 1;
      if (target > cutStart && target < cutEnd) return false;
      const remaining = this.value.slice(0, cutStart) + this.value.slice(cutEnd);
      const position = Math.min(remaining.length, target >= cutEnd ? target - (cutEnd - cutStart) : target);
      const content = window.NoteContent, title = content ? content.titleLine(remaining) : null;
      const insert = title && position <= title.end ? eol + text : text;
      const at = title && position <= title.end ? title.end : position;
      this.remember({ start: start, end: end, direction: 'none' });
      this.value = remaining.slice(0, at) + insert + remaining.slice(at);
      const caret = at + insert.length;
      this.selection = { start: caret, end: caret, direction: 'none' };
      this.activeLine = this.lineAt(caret);
      this.render(this.selection);
      this.notify();
      return true;
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
        const range = this.readSelection();
        if (type === 'deleteContentBackward' && range.start === range.end && this.removeListPrefix(range.start)) return;
        this.replace('', this.atomicRange(this.deletionRange(range, type)));
        return;
      }
      if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        // 回车在列表、引用与代码块中续写，空项回车结束；Shift+Enter 只换行（与现有应用一致）。
        const range = this.readSelection();
        if (type === 'insertParagraph' && window.MarkdownCommands && this.applyEdit(window.MarkdownCommands.continueBlock(this.value, range.start, range.end), range)) return;
        this.replace((this.value.match(/\r\n|\r|\n/) || ['\n'])[0], range);
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
      this.selection = this.domSelection();
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
        // 失焦时页面选区还在编辑区里，这里记下的就是之后插入附件的位置。
        this.selection = this.domSelection();
        this.activeLine = -1;
        this.render();
        if (focusedEditor === this) focusedEditor = null;
        if (this.textarea) this.textarea.dispatchEvent(new Event('blur'));
      });
      this.listen(this.element, 'mousedown', (event) => {
        // 操作待办或图片时保留正文选区，避免光标被装饰节点夺走。
        if (event.target.closest('[data-md-task],[data-md-attachment]') && (event.button === undefined || event.button === 0)) event.preventDefault();
      });
      // 按住附件拖动调整位置（本次提出），见 pressAttachment。
      this.listen(this.element, 'pointerdown', (event) => this.pressAttachment(event));
      this.listen(this.element, 'click', (event) => {
        if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); return; }
        const attachment = event.target.closest('[data-md-attachment]');
        if (attachment && this.element.contains(attachment)) {
          event.preventDefault();
          event.stopPropagation();
          const start = Number(attachment.dataset.mdStart), end = Number(attachment.dataset.mdEnd);
          if (typeof window.SideNotesOpenAttachment === 'function') window.SideNotesOpenAttachment(event, { editor: this, kind: attachment.dataset.mdAttachment, start: start, end: end, markdown: this.value.slice(start, end), src: attachment.dataset.src || '', path: attachment.dataset.path || '', label: attachment.dataset.alt || attachment.textContent.trim() });
          return;
        }
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
        const text = event.clipboardData.getData('text/plain');
        const range = this.readSelection();
        const commands = window.MarkdownCommands;
        // 网址贴在选中的文字上变成链接、代码编辑器复制的内容变成代码块；Ctrl+Shift+V 只粘贴纯文本（与现有应用一致）。
        if (!this.plainPaste && commands) {
          let language = null;
          try {
            const data = JSON.parse(event.clipboardData.getData('vscode-editor-data') || 'null');
            if (data && typeof data.mode === 'string') language = commands.codeLanguage(data.mode);
          } catch (error) { /* 不是代码编辑器写入的内容。 */ }
          if (this.applyEdit(commands.smartPaste(this.value, range.start, range.end, { text: text, html: event.clipboardData.getData('text/html'), codeLanguage: language }), range)) return;
        }
        this.replace(text, range);
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
      // 从编辑面中拖动选中的文字：记下原文范围，落在同一个编辑面时移到落点（不是复制一份）。附件块的拖动见 pressAttachment。
      this.listen(this.element, 'dragstart', (event) => {
        if (!event.dataTransfer) return;
        const range = this.clipboardRange();
        if (!(range.end > range.start)) return;
        activeDrag = { editor: this, start: range.start, end: range.end, text: this.value.slice(range.start, range.end) };
        event.dataTransfer.setData('text/plain', activeDrag.text);
        event.dataTransfer.effectAllowed = 'copyMove';
      });
      this.listen(this.element, 'dragend', () => { window.setTimeout(function clearDrag() { activeDrag = null; }, 0); });
      this.listen(this.element, 'drop', (event) => {
        if (!event.dataTransfer || event.defaultPrevented || event.sideNotesDropHandled) return;
        if (activeDrag && activeDrag.editor === this) {
          event.preventDefault();
          event.sideNotesDropHandled = true;
          this.moveText(activeDrag.start, activeDrag.end, this.offsetAt(event.clientX, event.clientY));
          activeDrag = null;
          return;
        }
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
        const modifier = event.ctrlKey || event.metaKey;
        this.plainPaste = modifier && event.shiftKey && Boolean(window.SideNotesShortcuts) && window.SideNotesShortcuts.physicalKey(event) === 'KeyV';
        if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          this.setSelectionRange(0, this.value.length, 'forward');
        } else if (modifier && !event.altKey && /^[zy]$/i.test(event.key)) {
          event.preventDefault();
          this.history(event.key.toLowerCase() === 'y' || event.shiftKey);
        } else if (event.key === 'Tab' && !modifier && !event.altKey) {
          // Tab 不移出编辑区；列表与引用中缩进或减少缩进，其余位置 Tab 插入两个空格（与现有应用一致）。
          event.preventDefault();
          const range = this.readSelection();
          if (!(window.MarkdownCommands && this.applyEdit(window.MarkdownCommands.indentLines(this.value, range.start, range.end, event.shiftKey), range)) && !event.shiftKey) this.replace('  ', range);
        } else this.formatShortcut(event);
      });
      this.listen(this.element, 'keyup', () => { this.plainPaste = false; });
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

  window.LiveMarkdown = Object.freeze({ create: create, attach: attach, dragSource: function dragSource() { return activeDrag; }, endDrag: function endDrag() { activeDrag = null; } });
})();
