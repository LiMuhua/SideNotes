'use strict';

/** 记录正文、Markdown 与本地文件引用工具。 */
(function exposeNoteContent() {
  const files = new Map(); // 用户主动绑定的本地文件；不把普通路径视为已验证。

  /* ==================== 标签解析与序列化 ==================== */

  /** @brief 获取忽略大小写的标签键。 @param {string} tag 标签。 @return {string} 比较键。 */
  function tagKey(tag) {
    return String(tag || '').replace(/^#/, '').trim().toLocaleLowerCase();
  }

  /** @brief 标记行内代码与转义字符，避免误识别标签。 @param {string} line 原文。 @return {boolean[]} 保护位置。 */
  function protectedPositions(line) {
    const protectedIndexes = Array(line.length).fill(false);
    const pattern = /(`+)([\s\S]*?)\1|\\./g;
    let match;
    while ((match = pattern.exec(line))) {
      for (let index = match.index; index < match.index + match[0].length; index += 1) protectedIndexes[index] = true;
    }
    return protectedIndexes;
  }

  /** @brief 判断标签是否与常见十六进制颜色冲突。 @param {string} tag 标签。 @return {boolean} 是否为颜色。 */
  function isHexColor(tag) {
    return /^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(tag) && /[a-f]/i.test(tag);
  }

  /** @brief 解析正文末尾或独立行声明的标签，保留 Markdown 代码和标题。 @param {string} text 原文。 @return {{body:string,tags:string[]}} 正文和去重标签。 */
  function parse(text) {
    const tags = [];
    const seen = new Set();
    let fence = null;
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(function parseLine(line) {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!fence) fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        else if (fence.character === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = null;
        return line;
      }
      if (fence || /^ {4}|^\t/.test(line)) return line;
      const protectedIndexes = protectedPositions(line);
      const suffix = line.match(/(?:^|[\t ])((?:#[\p{L}\p{N}_-]+[\t ]*)+)$/u);
      if (!suffix) return line;
      const start = suffix.index + suffix[0].indexOf(suffix[1]);
      const tokenPattern = /#([\p{L}\p{N}_-]+)/gu;
      const removals = [];
      let token;
      while ((token = tokenPattern.exec(suffix[1]))) {
        const position = start + token.index;
        if (protectedIndexes[position] || isHexColor(token[1])) continue;
        const key = tagKey(token[1]);
        if (!seen.has(key)) {
          seen.add(key);
          tags.push(token[1]);
        }
        removals.push([position, position + token[0].length]);
      }
      if (!removals.length) return line;
      let result = line;
      removals.reverse().forEach(function removeToken(range) { result = result.slice(0, range[0]) + result.slice(range[1]); });
      return result.trimEnd();
    });
    return { body: tags.length ? lines.join('\n').replace(/\n+$/, '') : String(text || ''), tags: tags };
  }

  /** @brief 将标签原文统一写入正文末尾的独立行。 @param {string} body 正文。 @param {string[]} tags 标签。 @return {string} 可编辑原文。 */
  function compose(body, tags = []) {
    const unique = new Map();
    tags.forEach(function collectTag(tag) {
      const name = String(tag || '').replace(/^#/, '').trim();
      if (/^[\p{L}\p{N}_-]+$/u.test(name) && !unique.has(tagKey(name))) unique.set(tagKey(name), name);
    });
    const content = String(body || '');
    const suffix = Array.from(unique.values()).map(function prefixTag(tag) { return '#' + tag; }).join(' ');
    return suffix ? content.replace(/\n+$/, '') + (content.replace(/\n+$/, '') ? '\n\n' : '') + suffix : content;
  }

  /** @brief 规范正文和标签的位置。 @param {string} text 原文。 @return {string} 规范原文。 */
  function canonicalize(text) {
    const content = parse(text);
    return content.tags.length ? compose(content.body, content.tags) : String(text || '');
  }

  /** @brief 从指定记录移除一个标签，不影响其他记录。 @param {string} text 原文。 @param {string} tag 标签。 @return {string} 更新原文。 */
  function removeTag(text, tag) {
    const content = parse(text);
    return compose(content.body, content.tags.filter(function keepTag(value) { return tagKey(value) !== tagKey(tag); }));
  }

  /* ==================== 正文结构：标题行、标签行与正文末尾 ==================== */

  /** @brief 末尾标签行的起点：最后一个非空行只有 #标签 时就是标签行。 @param {string} source 原文。 @return {number} 起点，没有标签行时为 -1。 */
  function tagLineStart(source) {
    const match = /(?:^|\n)([\t ]*#[\p{L}\p{N}_-]+(?:[\t ]+#[\p{L}\p{N}_-]+)*[\t ]*)\s*$/u.exec(String(source || ''));
    return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : -1;
  }

  /** @brief 这一行只有一个图片或文件引用（附件整块占一行）。 @param {string} line 一行原文。 @return {boolean} 是否附件行。 */
  function isAttachmentLine(line) {
    return /^\s*!?\[(?:\\.|[^\]\\])*\]\([^)\r\n]*\)\s*$/.test(String(line || ''));
  }

  /**
   * @brief 卡片标题所在的行：第一个非空行是普通文字或 Markdown 标题时才算，与卡片标题行的取法一致；
   * 第一行是代码、列表、引用、附件、分隔线或只有标签时，卡片整段显示正文，没有单独的标题行。
   * @param {string} source 原文。 @return {{start:number,end:number}|null} 这一行的起止（不含换行）。
   */
  function titleLine(source) {
    const text = String(source || '');
    const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    let match;
    while ((match = lines.exec(text)) && match[0]) {
      const line = match[0].replace(/[\r\n]+$/, '');
      if (!line.trim()) continue;
      const structured = /^\s*(?:`{3,}|~{3,}|>|(?:-\s*){3,}$|(?:_\s*){3,}$|(?:\*\s*){3,}$)|^(?: {4}|\t)|^\s*[-*+]\s|^\s*\d+[.)]\s/.test(line);
      if (structured || isAttachmentLine(line) || filePath(line) || tagLineStart(line) === 0) return null;
      return { start: match.index, end: match.index + line.length };
    }
    return null;
  }

  /**
   * @brief 正文末尾：标签行之前最后一个非空字符之后（本次提出：进入编辑时光标放在这里，接着写正文，而不是落在标签行末尾）。
   * 只有标签、没有正文时放在全文末尾，免得输入的文字并进标签行。
   * @param {string} source 原文。 @return {number} 原文偏移。
   */
  function bodyEnd(source) {
    const text = String(source || ''), tags = tagLineStart(text);
    const body = (tags < 0 ? text : text.slice(0, tags)).replace(/\s+$/, '');
    return body ? body.length : text.length;
  }

  /* ==================== 文件引用与真实校验 ==================== */

  /** @brief 判断引用是否为浏览器所选文件的持久标识。 @param {string} value 引用。 @return {boolean} 是否为文件标识。 */
  function isFileToken(value) {
    return /^sidenotes-file:[a-z0-9-]+\?name=(?:[a-z0-9_.~-]|%[\da-f]{2})+$/i.test(String(value || '').trim());
  }

  /** @brief 获取绝对文件路径或文件标识，兼容 file URL。 @param {string} value 引用。 @return {string|null} 可登记引用。 */
  function filePath(value) {
    const source = String(value || '').trim();
    if (isFileToken(source) || /^[a-z]:[\\/]/i.test(source) || /^\\\\[^\\]+\\/.test(source)) return source;
    if (!/^file:\/\//i.test(source)) return null;
    try {
      const url = new URL(source);
      const pathname = decodeURIComponent(url.pathname);
      return url.hostname ? '\\\\' + url.hostname + pathname.replace(/\//g, '\\') : pathname.replace(/^\/([a-z]:)/i, '$1').replace(/\//g, '\\');
    } catch (error) { return null; }
  }

  /** @brief 获取文件引用中持久保存的名称。 @param {string} value 引用。 @return {string} 名称或路径。 */
  function fileLabel(value) {
    const source = String(value || '').trim();
    if (isFileToken(source)) {
      try { return decodeURIComponent(source.slice(source.indexOf('?name=') + 6)); }
      catch (error) { return '所选文件'; }
    }
    return (filePath(source) || source).split(/[\\/]/).pop() || source;
  }

  /** @brief 获取文件注册键，文件标识不按磁盘路径改写。 @param {string} path 文件路径或标识。 @return {string} 注册键。 */
  function fileKey(path) {
    const source = filePath(path) || String(path || '');
    return isFileToken(source) ? source.toLocaleLowerCase() : source.replace(/\//g, '\\').toLocaleLowerCase();
  }

  /** @brief 为所选文件建立引用；浏览器未提供原路径时只保存文件标识。 @param {File} file 所选文件。 @param {FileSystemFileHandle|null} handle 文件句柄。 @return {string} 可写入 Markdown 的引用。 */
  function createFileReference(file, handle = null) {
    if (!file || typeof file.slice !== 'function') throw new Error('文件无法读取，请重新拖入');
    const originalPath = typeof file.path === 'string' ? filePath(file.path) : null;
    const id = window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const name = encodeURIComponent(file.name || '未命名文件').replace(/[!'()*]/g, function encodePunctuation(character) { return '%' + character.charCodeAt(0).toString(16).toUpperCase(); });
    const reference = originalPath || 'sidenotes-file:' + id + '?name=' + name;
    registerFile(reference, file, handle);
    return reference;
  }

  /** @brief 绑定用户选择的真实文件或句柄。 @param {string} path 原引用路径。 @param {File|null} file 文件。 @param {FileSystemFileHandle|null} handle 可持续校验的句柄。 @return {object} 注册项。 */
  function registerFile(path, file, handle = null) {
    const entry = { path: filePath(path) || String(path), file: file || null, handle: handle || null, status: 'unknown', verifiedBy: null, checkedAt: 0 };
    files.set(fileKey(path), entry);
    return entry;
  }

  /** @brief 校验已绑定文件，未获访问授权的路径保持未知。 @param {string} path 文件路径。 @return {Promise<'unknown'|'valid'|'missing'>} 校验结果。 */
  async function checkFile(path) {
    const entry = files.get(fileKey(path)) || files.get(path);
    if (!entry) return 'unknown';
    try {
      if (entry.handle && typeof entry.handle.getFile === 'function') entry.file = await entry.handle.getFile();
      if (!entry.file || typeof entry.file.slice !== 'function') return 'unknown';
      await entry.file.slice(0, 1).arrayBuffer();
      entry.status = 'valid';
      entry.verifiedBy = entry.handle ? 'handle' : 'copy';
    } catch (error) {
      entry.status = error.name === 'NotFoundError' ? 'missing' : 'unknown';
      entry.verifiedBy = null;
    }
    entry.checkedAt = Date.now();
    return entry.status;
  }

  /* ==================== 安全 Markdown 渲染 ==================== */

  /** @brief 创建安全文本节点容器。 @param {string} tag 元素名。 @param {string} text 文本。 @param {string} className 样式名。 @return {HTMLElement} 元素。 */
  function element(tag, text, className = '') {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** @brief 验证允许打开的网络地址。 @param {string} value 地址。 @return {string|null} 安全地址。 */
  function safeLink(value) {
    try {
      const url = new URL(String(value).trim());
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch (error) { return null; }
  }

  /** @brief 验证图片来源，图片仅作为 img 内容加载。 @param {string} value 图片地址。 @return {string|null} 安全地址。 */
  function safeImage(value) {
    const source = String(value || '').trim();
    // 正文中的图片引用 sidenotes-image:（app.js 的 SideNotesImages）：换成随记录保存的图片内容。
    if (/^sidenotes-image:/i.test(source)) return window.SideNotesImages ? window.SideNotesImages.resolve(source) || null : null;
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)(?:;[^,]*)?,/i.test(source)) return source;
    const link = safeLink(source);
    return link && /^https?:/i.test(link) ? link : null;
  }

  /** @brief 创建需要实际校验的文件引用按钮。 @param {string} path 文件路径。 @param {string} label 按钮文字。 @return {HTMLButtonElement} 文件引用。 */
  function fileReference(path, label) {
    const node = element('button', label && !(isFileToken(path) && label === path) ? String(label).replace(/\\([\\\[\]])/g, '$1') : fileLabel(path), 'file-reference');
    node.type = 'button';
    node.dataset.action = 'open-file-reference';
    node.dataset.filePath = path;
    node.dataset.fileStatus = 'unknown';
    // 文件胶囊：文件图标加链接文字，不加悬停提示（与现有应用一致）。
    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'icon');
    glyph.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-file');
    glyph.append(use);
    node.prepend(glyph);
    return node;
  }

  /** @brief 解析链接括号并提取地址，支持路径空格和 URL 内嵌括号。 @param {string} text 原文。 @param {number} start 左括号下标。 @return {{target:string,end:number}|null} 地址与结束下标。 */
  function linkTarget(text, start) {
    if (text[start] !== '(') return null;
    let depth = 1;
    let quote = '';
    let end = start + 1;
    for (; end < text.length; end += 1) {
      const character = text[end];
      if (character === '\\' && !/^[a-z]:[\\/]/i.test(text.slice(start + 1))) { end += 1; continue; }
      if (quote) { if (character === quote) quote = ''; continue; }
      if ((character === '"' || character === "'") && /\s/.test(text[end - 1])) { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')') { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    let target = text.slice(start + 1, end).trim();
    target = target.replace(/\s+["'][^"']*["']\s*$/, '').trim();
    if (target[0] === '<' && target[target.length - 1] === '>') target = target.slice(1, -1);
    return { target: target, end: end + 1 };
  }

  /** @brief 查找未转义的链接文字结束位置。 @param {string} text 原文。 @param {number} start 查找起点。 @return {number} 下标或 -1。 */
  function nextLabelEnd(text, start) {
    let end = text.indexOf('](', start);
    while (end >= 0) {
      let escapes = 0;
      for (let index = end - 1; index >= 0 && text[index] === '\\'; index -= 1) escapes += 1;
      if (escapes % 2 === 0) return end;
      end = text.indexOf('](', end + 2);
    }
    return -1;
  }

  /** @brief 安全渲染行内 Markdown，原生 HTML 保留为文字。 @param {string} text 原文。 @param {HTMLElement} container 容器。 @param {number} depth 递归深度。 */
  function renderInline(text, container, depth = 0) {
    if (depth > 8) { container.append(document.createTextNode(text)); return; }
    const plain = [];
    const candidates = /[\\`*_~\[!<]|https?:\/\/|mailto:/gi;
    const automaticLink = /(?:https?:\/\/|mailto:)[^\s<>]+/iy;
    const failedClosers = new Map();
    const linkCache = new Map();
    let position = 0;
    let labelEnd = nextLabelEnd(text, 0);
    /** 输出累计的普通文本。 */
    function flushText() {
      if (plain.length) container.append(document.createTextNode(plain.join('')));
      plain.length = 0;
    }
    /** @brief 查找闭合定界符，缓存已确认没有闭合符的后缀。 @param {string} marker 定界符。 @param {number} start 查找位置。 @param {boolean} exactTicks 是否要求等长反引号。 @return {number} 闭合位置。 */
    function closingMarker(marker, start, exactTicks = false) {
      if (failedClosers.has(marker) && start >= failedClosers.get(marker)) return -1;
      let end = text.indexOf(marker, start);
      while (end >= 0) {
        const valid = exactTicks ? text[end - 1] !== '`' && text[end + marker.length] !== '`' : end > start && !/\s/.test(text[end - 1]);
        if (valid) return end;
        end = text.indexOf(marker, end + marker.length);
      }
      failedClosers.set(marker, start);
      return -1;
    }
    while (position < text.length) {
      // 普通文字整段跳过，只在语法标记或 URL 开头进入解析。
      candidates.lastIndex = position;
      const candidate = candidates.exec(text);
      if (!candidate) { plain.push(text.slice(position)); break; }
      if (candidate.index > position) plain.push(text.slice(position, candidate.index));
      position = candidate.index;
      const character = text[position];
      if (character === '\\' && /[\\`*_{}\[\]()#+.!~>-]/.test(text[position + 1] || '')) { plain.push(text[position + 1]); position += 2; continue; }
      if (character === '`') {
        let openingEnd = position + 1;
        while (text[openingEnd] === '`') openingEnd += 1;
        const marker = text.slice(position, openingEnd);
        const codeEnd = closingMarker(marker, openingEnd, true);
        if (codeEnd >= 0) {
          flushText();
          container.append(element('code', text.slice(openingEnd, codeEnd).replace(/\n/g, ' ')));
          position = codeEnd + marker.length;
          continue;
        }
        plain.push(marker);
        position = openingEnd;
        continue;
      }
      // Typora 写法的下划线 <u>…</u>（与现有应用一致）：只识别这一对不带属性的标签，其余 HTML 仍按文字显示。
      if (character === '<') {
        if (text.slice(position, position + 3).toLowerCase() === '<u>') {
          const close = text.toLowerCase().indexOf('</u>', position + 3);
          if (close > position + 3) {
            flushText();
            const underline = element('u');
            renderInline(text.slice(position + 3, close), underline, depth + 1);
            container.append(underline);
            position = close + 4;
            continue;
          }
        }
        plain.push('<');
        position += 1;
        continue;
      }
      const image = character === '!' && text[position + 1] === '[';
      if (image || character === '[') {
        const labelStart = position + (image ? 2 : 1);
        // 闭括号指针始终向前，未闭合的多个 '[' 不重复搜索整个后缀。
        while (labelEnd >= 0 && labelEnd < labelStart) labelEnd = nextLabelEnd(text, labelEnd + 2);
        if (labelEnd >= 0 && !linkCache.has(labelEnd)) {
          const target = linkTarget(text, labelEnd + 1);
          linkCache.set(labelEnd, target ? { target: target, path: filePath(target.target) } : null);
        }
        const destination = labelEnd >= 0 ? linkCache.get(labelEnd) : null;
        if (destination) {
          const target = destination.target;
          const path = destination.path;
          const type = image ? 'image' : 'link';
          if (!Object.prototype.hasOwnProperty.call(destination, type)) destination[type] = image ? safeImage(target.target) : safeLink(target.target);
          const address = destination[type];
          if (image && address) {
            flushText();
            const label = text.slice(labelStart, labelEnd);
            const preview = element('button', undefined, 'markdown-image-button');
            preview.type = 'button';
            preview.dataset.action = 'preview-markdown-image';
            // 记下正文中的原地址，附件弹窗据此找到这一段 Markdown；显示的是缩略图，点开弹窗才加载原图。
            preview.dataset.src = target.target;
            preview.dataset.alt = label;
            preview.setAttribute('aria-label', '放大图片：' + (label || '图片'));
            const picture = element('img', undefined, 'markdown-image');
            if (window.SideNotesImages) window.SideNotesImages.show(picture, address); else picture.src = address;
            picture.alt = label;
            picture.loading = 'lazy';
            preview.append(picture);
            container.append(preview);
            position = target.end;
            continue;
          }
          if (!image && (path || address)) {
            flushText();
            const label = text.slice(labelStart, labelEnd);
            if (path) container.append(fileReference(path, label));
            else {
              const link = element('a', undefined, 'markdown-link');
              link.href = address;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              renderInline(label, link, depth + 1);
              container.append(link);
            }
            position = target.end;
            continue;
          }
        }
      }
      if (character === '*' || character === '_' || character === '~') {
        const doubled = text[position + 1] === character;
        const markers = doubled ? [character + character] : [];
        if (character !== '~') markers.push(character);
        let consumed = false;
        for (const marker of markers) {
          const start = position + marker.length;
          if (!text[start] || /\s/.test(text[start])) continue;
          const end = closingMarker(marker, start);
          if (end < 0) continue;
          flushText();
          const node = element(marker === '~~' ? 'del' : marker.length === 2 ? 'strong' : 'em');
          renderInline(text.slice(start, end), node, depth + 1);
          container.append(node);
          position = end + marker.length;
          consumed = true;
          break;
        }
        if (consumed) continue;
      }
      automaticLink.lastIndex = position;
      const autoLink = (character === 'h' || character === 'H' || character === 'm' || character === 'M') && (position === 0 || /[\s(]/.test(text[position - 1])) ? automaticLink.exec(text) : null;
      if (autoLink) {
        const address = autoLink[0].replace(/[.,，。；;!?！)]+$/, '');
        const safe = safeLink(address);
        if (safe) {
          flushText();
          const link = element('a', address, 'markdown-link');
          link.href = safe;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          container.append(link);
          position += address.length;
          continue;
        }
      }
      plain.push(candidate[0]);
      position += candidate[0].length;
    }
    flushText();
  }

  /** @brief 判断是否开始新的块结构。 @param {string} line 一行原文。 @return {boolean} 是否为块。 */
  function startsBlock(line) {
    return /^\s*$|^(?: {4}|\t)|^\s{0,3}(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s)|^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) || Boolean(filePath(line));
  }

  /** @brief 将 Markdown 以安全 DOM 渲染，支持混合内容、图片预览和任务交互。 @param {string} text 正文。 @param {HTMLElement} container 目标容器。 @param {object} options 可选 onTaskToggle(源文字框字符位置,勾选状态) 回调；返回 false 撤销。 @return {HTMLElement} 目标容器。 */
  function renderMarkdown(text, container, options = {}) {
    container.replaceChildren();
    container.classList.add('markdown-body');
    const source = String(text || '');
    const lines = source.split(/\r\n|\r|\n/);
    let sourceOffset = 0;
    const lineOffsets = options.sourceOffsets || lines.map(function lineOffset(line) { const start = sourceOffset; sourceOffset += line.length + (source.slice(sourceOffset + line.length, sourceOffset + line.length + 2) === '\r\n' ? 2 : 1); return start; });
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
      if (fence) {
        const body = [];
        index += 1;
        const close = new RegExp('^\\s{0,3}' + (fence[1][0] === '`' ? '`' : '~') + '{' + fence[1].length + ',}\\s*$');
        while (index < lines.length && !close.test(lines[index])) body.push(lines[index++]);
        if (index < lines.length) index += 1;
        const pre = element('pre', undefined, 'markdown-code');
        const code = element('code', body.join('\n'));
        if (fence[2]) code.dataset.language = fence[2];
        pre.append(code);
        container.append(pre);
        continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        const body = [];
        while (index < lines.length && /^(?: {4}|\t)/.test(lines[index])) body.push(lines[index++].replace(/^(?: {4}|\t)/, ''));
        const pre = element('pre', undefined, 'markdown-code');
        pre.append(element('code', body.join('\n')));
        container.append(pre);
        continue;
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (heading) {
        const node = element('h' + heading[1].length);
        renderInline(heading[2], node);
        container.append(node);
        index += 1;
        continue;
      }
      if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) { container.append(element('hr')); index += 1; continue; }
      if (/^\s{0,3}>/.test(line)) {
        const body = [], offsets = [];
        while (index < lines.length && /^\s{0,3}>/.test(lines[index])) { const stripped = lines[index].replace(/^\s{0,3}>\s?/, ''); offsets.push(lineOffsets[index] + lines[index].length - stripped.length); body.push(stripped); index += 1; }
        const quote = element('blockquote');
        renderMarkdown(body.join('\n'), quote, { onTaskToggle: options.onTaskToggle, sourceOffsets: offsets });
        container.append(quote);
        continue;
      }
      const item = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/);
      if (item) {
        const ordered = /^\d/.test(item[1]);
        const list = element(ordered ? 'ol' : 'ul');
        if (ordered) list.start = parseInt(item[1], 10);
        let next;
        while (index < lines.length && (next = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/)) && /^\d/.test(next[1]) === ordered) {
          const entry = element('li');
          const task = next[2].match(/^\[([ xX])\]\s+(.*)$/);
          if (task) {
            entry.className = 'markdown-task';
            const checkbox = element('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'md-task-toggle';
            checkbox.checked = task[1].toLowerCase() === 'x';
            checkbox.disabled = typeof options.onTaskToggle !== 'function';
            checkbox.setAttribute('aria-label', checkbox.checked ? '已完成' : '未完成');
            if (!checkbox.disabled) {
              const taskOffset = lineOffsets[index] + lines[index].length - next[2].length + 1;
              let committed = checkbox.checked;
              checkbox.dataset.taskOffset = String(taskOffset);
              checkbox.addEventListener('click', function keepTaskInteraction(event) { event.stopPropagation(); });
              checkbox.addEventListener('change', function toggleTask() {
                if (options.onTaskToggle(taskOffset, checkbox.checked) === false) checkbox.checked = committed;
                else committed = checkbox.checked;
                checkbox.setAttribute('aria-label', checkbox.checked ? '已完成' : '未完成');
              });
            }
            entry.append(checkbox);
            renderInline(task[2], entry);
          } else renderInline(next[2], entry);
          list.append(entry);
          index += 1;
        }
        container.append(list);
        continue;
      }
      const path = filePath(line);
      if (path) { const paragraph = element('p'); paragraph.append(fileReference(path, path)); container.append(paragraph); index += 1; continue; }
      const paragraph = element('p');
      renderInline(line, paragraph);
      index += 1;
      while (index < lines.length && !startsBlock(lines[index])) { paragraph.append(element('br')); renderInline(lines[index++], paragraph); }
      container.append(paragraph);
    }
    return container;
  }

  /** @brief 检测记录所含内容能力，允许文字、链接和图片同时出现。 @param {object|string} note 记录或原文。 @return {string[]} 内容类型。 */
  function getFeatures(note) {
    const text = typeof note === 'string' ? note : String(note && note.text || '');
    const body = parse(text).body;
    const features = [];
    if (body.trim()) features.push('文本');
    if (/(?:^|\n)(?:\s{0,3}(?:`{3,}|~{3,})| {4}|\t)|`[^`]+`/.test(body)) features.push('代码');
    if (/https?:\/\/|mailto:/i.test(body)) features.push('链接');
    if (/!\[[^\]]*\]\(/.test(body) || note && Array.isArray(note.images) && note.images.length) features.push('图片');
    if (/sidenotes-file:|file:\/\/|(?:^|\n)\s*[a-z]:[\\/]|\]\(<?[a-z]:[\\/]/i.test(body)) features.push('文件');
    return features.length ? features : ['文本'];
  }

  window.NoteContent = Object.freeze({ parse: parse, compose: compose, canonicalize: canonicalize, removeTag: removeTag, tagLineStart: tagLineStart, isAttachmentLine: isAttachmentLine, titleLine: titleLine, bodyEnd: bodyEnd, renderMarkdown: renderMarkdown, renderInline: renderInline, getFeatures: getFeatures, files: files, isFileToken: isFileToken, fileLabel: fileLabel, createFileReference: createFileReference, registerFile: registerFile, checkFile: checkFile, filePath: filePath, fileKey: fileKey, tagKey: tagKey });
})();
