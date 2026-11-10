'use strict';

/**
 * @brief 记录窗口（本次提出）：卡片拖出侧栏或点「展开全文」时，在桌面上打开一个可以移动、缩放与置顶的窗口，显示完整的记录。
 * @details 两个入口共用这一个组件，只是出场动画不同：
 * - 拖出侧栏：窗口从松开处的拖影（微微倾斜的卡片）展开到窗口大小，同时摆正，最后轻轻落定；
 * - 展开全文：窗口从卡片在侧栏中的位置向桌面一侧滑出并放大。
 * 每条记录只开一个窗口，再次打开时把它提到最前。标题栏拖动窗口，四边与四角缩放；双击正文编辑，
 * Ctrl+Enter（保存快捷键）或点到窗口外保存，Esc 取消编辑；不在编辑时 Esc 关闭窗口。
 * 置顶的窗口叠在侧栏与速记浮窗之上；没有置顶的窗口在它们之下，点击时提到其余窗口之前。
 * 窗口随字号整页缩放（样式中带 zoom），位置与尺寸按视口坐标保存，写入样式时除以缩放倍数。
 */
window.NoteWindows = (function createNoteWindows() {
  const MIN_WIDTH = 320;
  const MIN_HEIGHT = 220;
  const MARGIN = 12;
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const windows = new Map();
  let order = 0;
  let gesture = null;

  /** @return {number} 整页缩放倍数（字号 ÷ 13）。 */
  function zoom() { return parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) || 1; }

  /** @brief 读取令牌中的时长（毫秒）。 @param {string} name 令牌。 @return {number} 时长。 */
  function duration(name) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) return 0;
    return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
  }

  /** @brief 读取令牌中的缓动曲线。 @param {string} name 令牌。 @return {string} 缓动。 */
  function easing(name) { return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease'; }

  /** @return {boolean} 系统要求减少动态效果。 */
  function reducedMotion() { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  /** @return {{width:number,height:number}} 视口大小。 */
  function viewport() { return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }; }

  /** @brief 把数值限制在范围内。 @param {number} value 数值。 @param {number} min 下限。 @param {number} max 上限。 @return {number} 结果。 */
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  /** @brief 窗口的位置与尺寸写入样式。 @param {object} entry 窗口。 */
  function apply(entry) {
    const z = zoom();
    entry.node.style.left = entry.x / z + 'px';
    entry.node.style.top = entry.y / z + 'px';
    entry.node.style.width = entry.width / z + 'px';
    entry.node.style.height = entry.height / z + 'px';
  }

  /** 按点击顺序排列层级：没有置顶的窗口在侧栏与速记浮窗之下，置顶的窗口在它们之上、弹窗之下。 */
  function restack() {
    const sorted = Array.from(windows.values()).sort(function byOrder(a, b) { return a.order - b.order; });
    let normal = 0, pinned = 0;
    sorted.forEach(function layer(entry) {
      entry.node.style.zIndex = String(entry.pinned ? 50 + Math.min(40, pinned++) : 10 + Math.min(9, normal++));
      entry.node.classList.toggle('is-front', entry === sorted[sorted.length - 1]);
    });
  }

  /** @brief 提到最前。 @param {object} entry 窗口。 */
  function bringToFront(entry) {
    entry.order = ++order;
    restack();
  }

  /** @brief 新窗口的默认大小：适合长文，按视口限制。 @return {{width:number,height:number}} 尺寸。 */
  function defaultSize() {
    const view = viewport();
    return { width: clamp(Math.round(view.width * 0.42), MIN_WIDTH, 640), height: clamp(Math.round(view.height * 0.72), MIN_HEIGHT, 760) };
  }

  /**
   * @brief 新窗口的位置：拖出时以松开处为中心，标题栏在指针下；展开全文时放在侧栏旁边、与卡片同高。
   * 都限制在视口内，并尽量不压住侧栏；与已开的窗口重叠时错开一点。
   * @param {object} entry 窗口。 @param {object} options point 松开处，from 来源矩形。
   */
  function position(entry, options) {
    const view = viewport(), sidebar = elements.sidebar && elements.sidebar.classList.contains('open') ? elements.sidebar.getBoundingClientRect() : null;
    const rightEdge = !state.settings || state.settings.edge !== 'left';
    let x, y;
    if (options.point) {
      x = options.point.x - entry.width / 2;
      y = options.point.y - 20;
    } else {
      const from = options.from || { top: view.height / 4 };
      x = sidebar ? (rightEdge ? sidebar.left - entry.width - MARGIN * 2 : sidebar.right + MARGIN * 2) : (view.width - entry.width) / 2;
      y = from.top - MARGIN * 3;
    }
    if (sidebar) {
      if (rightEdge && x + entry.width > sidebar.left - MARGIN) x = Math.max(MARGIN, sidebar.left - MARGIN - entry.width);
      if (!rightEdge && x < sidebar.right + MARGIN) x = Math.min(view.width - entry.width - MARGIN, sidebar.right + MARGIN);
    }
    // 与已开的窗口左上角太近时错开。
    for (let step = 0; step < 8 && Array.from(windows.values()).some(function near(other) { return other !== entry && Math.abs(other.x - x) < 16 && Math.abs(other.y - y) < 16; }); step += 1) { x += 24; y += 24; }
    entry.x = clamp(x, MARGIN, Math.max(MARGIN, view.width - entry.width - MARGIN));
    entry.y = clamp(y, MARGIN, Math.max(MARGIN, view.height - entry.height - MARGIN));
  }

  /** @brief 创建窗口的结构与事件。 @param {object} note 记录。 @return {object} 窗口。 */
  function create(note) {
    const node = el('section', 'note-window');
    node.dataset.noteId = note.id;
    node.setAttribute('role', 'dialog');
    node.tabIndex = -1;
    const header = el('header', 'note-window-header');
    const emoji = el('span', 'note-window-emoji');
    emoji.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'note-window-title');
    const actions = el('div', 'window-actions');
    const pin = button('置顶窗口', '', 'pin', 'icon-button note-window-pin');
    pin.setAttribute('aria-pressed', 'false');
    const close = button('关闭窗口', '', 'x', 'icon-button');
    actions.append(pin, close);
    header.append(emoji, title, actions);
    const body = el('div', 'note-window-body');
    node.append(header, body);
    EDGES.forEach(function handle(edge) {
      const grip = el('div', 'note-window-resize');
      grip.dataset.edge = edge;
      grip.setAttribute('aria-hidden', 'true');
      node.append(grip);
    });
    const entry = { id: note.id, node: node, header: header, emoji: emoji, titleNode: title, body: body, pin: pin, x: 0, y: 0, width: 0, height: 0, pinned: false, editing: null, order: ++order };

    pin.addEventListener('click', function togglePin() {
      entry.pinned = !entry.pinned;
      pin.setAttribute('aria-pressed', String(entry.pinned));
      pin.setAttribute('aria-label', entry.pinned ? '取消置顶窗口' : '置顶窗口');
      node.classList.toggle('is-pinned', entry.pinned);
      bringToFront(entry);
    });
    close.addEventListener('click', function closeWindow() { closeEntry(entry); });
    node.addEventListener('pointerdown', function activate() { if (!entry.node.classList.contains('is-front')) bringToFront(entry); }, true);
    header.addEventListener('pointerdown', function startMove(event) { if (!event.target.closest('button')) startGesture(entry, event, 'move'); });
    header.addEventListener('dblclick', function toggleSize(event) { if (!event.target.closest('button')) maximize(entry); });
    node.querySelectorAll('.note-window-resize').forEach(function grip(handle) { handle.addEventListener('pointerdown', function startResize(event) { startGesture(entry, event, handle.dataset.edge); }); });
    node.addEventListener('pointermove', moveGesture);
    node.addEventListener('pointerup', endGesture);
    node.addEventListener('pointercancel', endGesture);
    body.addEventListener('dblclick', function editInWindow(event) {
      if (entry.editing || event.target.closest('button,a,input,textarea,[contenteditable="true"]')) return;
      event.preventDefault();
      beginEditing(entry);
    });
    node.addEventListener('keydown', function windowKeys(event) {
      if (event.isComposing || event.defaultPrevented) return;
      const save = window.SideNotesShortcuts && window.SideNotesShortcuts.matches(event, state.settings.shortcuts, 'save');
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (entry.editing) finishEditing(entry, false); else closeEntry(entry);
      } else if (save && entry.editing) {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(entry, true);
      }
    });
    node.addEventListener('focusout', function leaveWindow() {
      window.setTimeout(function afterFocus() { if (entry.editing && !node.contains(document.activeElement) && !ui.modal) finishEditing(entry, true); }, 0);
    });
    return entry;
  }

  /** @brief 写出窗口内容：标题、正文与标签；编辑中不重绘正文。记录被删除或移入回收站时关闭窗口。 @param {object} entry 窗口。 */
  function render(entry) {
    const note = state.notes.find(function same(item) { return item.id === entry.id; });
    if (!note || note.status === 'trash') { closeEntry(entry, { animate: false }); return; }
    const title = noteTitle(note);
    entry.emoji.textContent = note.emoji || '📝';
    entry.titleNode.textContent = title;
    entry.node.setAttribute('aria-label', title);
    if (entry.editing) return;
    const parts = noteParts(note), display = noteDisplay(note);
    const content = el('div', 'note-window-content markdown-body');
    // 标题已经写在标题栏里，正文不再重复首行（与卡片相同）。
    window.NoteContent.renderMarkdown(display.body, content, { onTaskToggle: function toggleTask(index, checked) {
      const changed = display.body.slice(0, index) + (checked ? 'x' : ' ') + display.body.slice(index + 1);
      return updateNote(note.id, { text: window.NoteContent.compose(display.prefix + changed, parts.tags) });
    } });
    note.images.forEach(function attachment(image) {
      const preview = button('预览图片：' + image.name, 'preview-image', '', 'note-image-button');
      preview.dataset.imageId = image.id;
      const picture = el('img', 'note-image');
      picture.src = image.data;
      picture.alt = image.name;
      preview.append(picture);
      content.append(preview);
    });
    const nodes = [content];
    if (parts.tags.length) {
      const tags = el('div', 'note-window-tags');
      parts.tags.forEach(function tag(name) { const chip = button('#' + name, 'filter-tag', '', 'tag-chip'); chip.dataset.tag = name; tags.append(chip); });
      nodes.push(tags);
    }
    const scroll = entry.body.scrollTop;
    entry.body.replaceChildren(...nodes);
    entry.body.scrollTop = scroll;
  }

  /** @brief 在窗口中编辑：正文换成实时 Markdown 编辑器，填满窗口。 @param {object} entry 窗口。 */
  function beginEditing(entry) {
    const note = state.notes.find(function same(item) { return item.id === entry.id; });
    if (!note) return;
    // 同一条记录正在侧栏中编辑时，先保存那边的修改。
    if (ui.editing && ui.editing.id === entry.id && !finishEdit()) return;
    entry.editing = { text: note.text, original: note.text };
    const input = el('textarea', 'note-window-input');
    input.value = note.text;
    input.setAttribute('aria-label', '编辑记录');
    entry.body.replaceChildren(input);
    entry.node.classList.add('is-editing');
    if (window.LiveMarkdown) window.LiveMarkdown.attach(input, { value: note.text, minHeight: 0, maxHeight: 'none' });
    input.addEventListener('input', function track() { entry.editing.text = input.liveMarkdown ? input.liveMarkdown.getValue() : input.value; });
    input.focus({ preventScroll: true });
    const end = input.liveMarkdown ? input.liveMarkdown.getValue().length : input.value.length;
    input.setSelectionRange(end, end);
  }

  /**
   * @brief 结束窗口中的编辑：保存时内容没变不写库，清空正文时恢复原文（与卡片编辑一致）。
   * @param {object} entry 窗口。 @param {boolean} commit 是否保存。 @return {boolean} 是否结束。
   */
  function finishEditing(entry, commit) {
    if (!entry.editing) return true;
    const editing = entry.editing;
    if (commit && editing.text.trim() && editing.text !== editing.original && !updateNote(entry.id, { text: window.NoteContent.canonicalize(editing.text) })) return false;
    const input = entry.body.querySelector('textarea');
    if (input && input.liveMarkdown) input.liveMarkdown.destroy();
    entry.editing = null;
    entry.node.classList.remove('is-editing');
    render(entry);
    if (entry.node.isConnected) entry.node.focus({ preventScroll: true });
    return true;
  }

  /** @brief 开始移动或缩放。 @param {object} entry 窗口。 @param {PointerEvent} event 按下。 @param {string} mode move 或缩放的边。 */
  function startGesture(entry, event, mode) {
    if (event.button !== 0 || gesture) return;
    event.preventDefault();
    bringToFront(entry);
    gesture = { entry: entry, mode: mode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { x: entry.x, y: entry.y, width: entry.width, height: entry.height }, target: event.currentTarget };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* 指针失效时由 pointercancel 收尾。 */ }
    entry.node.classList.add(mode === 'move' ? 'is-moving' : 'is-resizing');
    if (typeof cancelHide === 'function') cancelHide();
  }

  /** @brief 跟随指针移动或缩放，标题栏始终留在视口内。 @param {PointerEvent} event 移动。 */
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, start = gesture.start, entry = gesture.entry, view = viewport();
    if (gesture.mode === 'move') {
      entry.x = clamp(start.x + dx, 80 - start.width, view.width - 80);
      entry.y = clamp(start.y + dy, 0, view.height - 40);
    } else {
      const mode = gesture.mode;
      if (mode.includes('e')) entry.width = clamp(start.width + dx, MIN_WIDTH, view.width - start.x);
      if (mode.includes('s')) entry.height = clamp(start.height + dy, MIN_HEIGHT, view.height - start.y);
      if (mode.includes('w')) { const width = clamp(start.width - dx, MIN_WIDTH, start.x + start.width); entry.x = start.x + start.width - width; entry.width = width; }
      if (mode.includes('n')) { const height = clamp(start.height - dy, MIN_HEIGHT, start.y + start.height); entry.y = start.y + start.height - height; entry.height = height; }
    }
    entry.maximized = null;
    apply(entry);
  }

  /** @brief 结束移动或缩放。 @param {PointerEvent} event 松开。 */
  function endGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    try { if (gesture.target.hasPointerCapture(event.pointerId)) gesture.target.releasePointerCapture(event.pointerId); } catch (error) { /* 已经释放。 */ }
    gesture.entry.node.classList.remove('is-moving', 'is-resizing');
    gesture = null;
  }

  /** @brief 双击标题栏：放大到视口（侧栏之外），再双击还原。 @param {object} entry 窗口。 */
  function maximize(entry) {
    if (entry.maximized) {
      Object.assign(entry, entry.maximized);
      entry.maximized = null;
    } else {
      entry.maximized = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      const view = viewport(), sidebar = elements.sidebar.classList.contains('open') ? elements.sidebar.getBoundingClientRect() : null, rightEdge = state.settings.edge !== 'left';
      const left = sidebar && !rightEdge ? sidebar.right + MARGIN : MARGIN, right = sidebar && rightEdge ? sidebar.left - MARGIN : view.width - MARGIN;
      entry.x = left;
      entry.y = MARGIN;
      entry.width = Math.max(MIN_WIDTH, right - left);
      entry.height = Math.max(MIN_HEIGHT, view.height - MARGIN * 2);
    }
    if (reducedMotion()) { apply(entry); return; }
    const before = entry.node.getBoundingClientRect();
    apply(entry);
    morph(entry, before, { duration: duration('--sn-duration-normal'), easing: easing('--sn-ease-standard') });
  }

  /**
   * @brief 从一个矩形变到窗口现在的位置与大小（transform 与 opacity，不改布局）。
   * @param {object} entry 窗口。 @param {DOMRect} from 起始矩形。 @param {object} options duration、easing、rotate 起始角度、settle 落定时的轻微放大、opacity 起始不透明度。
   * @return {Animation|null} 动画。
   */
  function morph(entry, from, options) {
    if (!from || reducedMotion() || typeof entry.node.animate !== 'function') return null;
    const to = entry.node.getBoundingClientRect(), z = zoom();
    if (!to.width || !to.height) return null;
    const dx = (from.left - to.left) / z, dy = (from.top - to.top) / z, sx = from.width / to.width, sy = from.height / to.height;
    const first = { transformOrigin: '0 0', transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ') rotate(' + (options.rotate || 0) + 'deg)', opacity: options.opacity === undefined ? 1 : options.opacity };
    const frames = options.settle ? [first, { offset: 0.72, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 }, { transformOrigin: '50% 50%', transform: 'none', opacity: 1 }] : [first, { transformOrigin: '0 0', transform: 'none', opacity: 1 }];
    return entry.node.animate(frames, { duration: options.duration, easing: options.easing });
  }

  /**
   * @brief 打开记录窗口；已经开着时提到最前。
   * @param {string} id 记录。 @param {object} options from 来源矩形（展开全文时是卡片），point 松开处（拖出时），ghost 拖影矩形，kind expand 或 drop。
   * @return {object|null} 窗口。
   */
  function open(id, options = {}) {
    const note = state.notes.find(function same(item) { return item.id === id; });
    if (!note) return null;
    let entry = windows.get(id);
    if (entry) {
      bringToFront(entry);
      entry.node.focus({ preventScroll: true });
      if (!reducedMotion() && typeof entry.node.animate === 'function') entry.node.animate([{ transform: 'none' }, { transform: 'scale(1.015)' }, { transform: 'none' }], { duration: duration('--sn-duration-normal'), easing: easing('--sn-ease-standard') });
      return entry;
    }
    entry = create(note);
    windows.set(id, entry);
    const size = defaultSize();
    entry.width = size.width;
    entry.height = size.height;
    position(entry, options);
    document.body.append(entry.node);
    apply(entry);
    restack();
    render(entry);
    if (options.kind === 'drop') morph(entry, options.ghost, { duration: duration('--sn-duration-slow') * 1.6, easing: easing('--sn-ease-standard'), rotate: -1, opacity: 0.9, settle: true });
    else morph(entry, options.from, { duration: duration('--sn-duration-slow') * 1.3, easing: easing('--sn-ease-enter'), opacity: 0.5 });
    entry.node.focus({ preventScroll: true });
    return entry;
  }

  /**
   * @brief 拖出侧栏松开后打开窗口：多选时每条一个，依次错开。
   * @param {Iterable<string>} ids 记录。 @param {{x:number,y:number}} point 松开处。 @param {DOMRect|null} ghost 拖影矩形。
   */
  function openFromDrag(ids, point, ghost) {
    Array.from(ids).slice(0, 6).forEach(function each(id, index) {
      open(id, { kind: 'drop', point: { x: point.x + index * 24, y: point.y + index * 24 }, ghost: ghost });
    });
  }

  /** @brief 关闭窗口：先结束编辑（保存），再淡出。 @param {object} entry 窗口。 @param {object} options animate 是否播放关闭动画。 */
  function closeEntry(entry, options = {}) {
    if (!windows.has(entry.id)) return;
    if (entry.editing && options.animate !== false && !finishEditing(entry, true)) return;
    windows.delete(entry.id);
    const remove = function remove() { entry.node.remove(); };
    if (options.animate === false || reducedMotion() || typeof entry.node.animate !== 'function') remove();
    else entry.node.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }], { duration: duration('--sn-duration-fast'), easing: easing('--sn-ease-exit') }).finished.then(remove, remove);
    restack();
  }

  /** 记录变化后重绘打开的窗口（app.js 的 renderNotes 末尾调用）。 */
  function refresh() { Array.from(windows.values()).forEach(render); }

  /** 字号或窗口大小变化后，按保存的视口坐标重新写入样式。 */
  function relayout() { windows.forEach(apply); }
  window.addEventListener('resize', relayout);
  window.addEventListener('sidenotes:settings-changed', relayout);

  return Object.freeze({
    open: open,
    openFromDrag: openFromDrag,
    refresh: refresh,
    isDragging: function isDragging() { return Boolean(gesture); },
    owns: function owns(target) { return Boolean(target && target.closest && target.closest('.note-window')); }
  });
})();
