'use strict';

/**
 * @brief 记录窗口（本次提出）：卡片拖出侧栏或点「展开全文」时，在桌面上打开一个可以移动、缩放与置顶的窗口，显示完整的记录。
 * @details 两个入口共用这一个组件，只是出场动画不同：
 * - 拖出侧栏：窗口从松开处倾斜的拖影展开到窗口大小，同时摆正，最后轻轻落定；拖出的窗口（包括从窗口拖出的标签页）默认置顶；
 * - 展开全文：窗口从卡片在侧栏中的位置向桌面一侧滑出并放大。
 * 关闭时与打开呼应：拖出的窗口先轻轻提起，再倾斜着缩回侧栏中原来的卡片，落下时摆正淡出，卡片轻轻一顿；展开全文的窗口原路滑回。
 * 卡片看不见时原地提起、倾斜着淡出。窗口大小按内容决定（宽高都是），四周留白，长文不超过视口的六成高。
 * 一个窗口可以有多个标签页，每条记录只在一个标签页中打开：多选拖出时放进同一个窗口；把卡片拖到已开的窗口上、
 * 把窗口的标题栏拖到另一个窗口的标题栏上、或把标签页拖到另一个窗口，都会合并成标签页；标签页拖到窗口外则拆成新窗口。
 * 拖动时目标窗口的标题栏换成浅强调色，标签栏里一条竖线标出松开后的位置；标签栏右侧留一块空白，按住可以拖动窗口。
 * 「关闭全部记录窗口」有快捷键（默认 Alt+Shift+W，可在设置中更换）。
 * 标题栏拖动窗口，四边与四角缩放；双击正文编辑，Ctrl+Enter（保存快捷键）或点到窗口外保存，Esc 取消编辑；
 * 不在编辑时 Esc 关闭当前标签页，只剩一个时关闭窗口。
 * 置顶的窗口叠在侧栏与速记浮窗之上；没有置顶的窗口在它们之下，点击时提到其余窗口之前。
 * 窗口随字号整页缩放（样式中带 zoom），位置与尺寸按视口坐标保存，写入样式时除以缩放倍数。
 */
window.NoteWindows = (function createNoteWindows() {
  const MIN_WIDTH = 320;
  const MIN_HEIGHT = 140;
  const MARGIN = 12;
  const FIT_WIDTH = [280, 560]; // 按内容定宽的上下限（按 13px 字号计，乘以缩放倍数）。
  const FIT_TABS_WIDTH = 720; // 顶部有标签页时按标签页定宽的上限（第四次反馈：标题不过早省略），同上。
  const FIT_HEIGHT = 600; // 按内容定高的上限（同上），同时不超过视口的六成。
  const DRAG_TILT = -2.5; // 与拖影（.card-drag-ghost）的倾斜角度一致。
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const windows = new Map(); // 窗口标识 → 窗口。
  let order = 0;
  let sequence = 0;
  let gesture = null;
  let tip = null; // 标签页全名的悬停提示。
  let tipTimer = 0;
  let tabDrop = null; // 标签栏里的插入线（拖动标签页、窗口或卡片到标签栏时）。
  let hinted = null; // 从侧栏拖来的卡片正落在其上的窗口。

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

  /** @brief 查找记录。 @param {string} id 记录。 @return {object|null} 记录。 */
  function noteOf(id) { return state.notes.find(function same(item) { return item.id === id; }) || null; }

  /** @brief 打开了这条记录的窗口。 @param {string} id 记录。 @return {object|null} 窗口。 */
  function windowOf(id) { return Array.from(windows.values()).find(function has(entry) { return entry.tabs.includes(id); }) || null; }

  /** @return {Array} 窗口，最前面的在前。 */
  function frontToBack() { return Array.from(windows.values()).sort(function byOrder(a, b) { return b.order - a.order; }); }

  /** @brief 指针下面的窗口（可以排除一个）。 @param {{x:number,y:number}} point 视口坐标。 @param {object|null} except 排除的窗口。 @param {boolean} headerOnly 只认标题栏。 @return {object|null} 窗口。 */
  function windowAt(point, except = null, headerOnly = false) {
    return frontToBack().find(function hit(entry) {
      if (entry === except || entry.closing) return false;
      // 只认标题栏时，竖排的标签栏也算（第四次反馈）：标签页拖到那里同样合并。
      const parts = headerOnly ? [entry.header].concat(entry.node.classList.contains('is-side-tabs') ? [entry.strip] : []) : [entry.node];
      return parts.some(function inside(part) { const box = part.getBoundingClientRect(); return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom; });
    }) || null;
  }

  /** @brief 侧栏列表中看得见的卡片：展开与关闭的动画从这里出发、回到这里。 @param {string} id 记录。 @return {HTMLElement|null} 卡片。 */
  function cardElement(id) {
    if (!elements.sidebar || !elements.sidebar.classList.contains('open') || elements.sidebar.inert) return null;
    const card = Array.from(elements.noteList.querySelectorAll('.note-card')).find(function same(node) { return node.dataset.noteId === id; });
    if (!card) return null;
    const rect = card.getBoundingClientRect(), list = elements.noteList.getBoundingClientRect();
    return rect.width && rect.bottom > list.top && rect.top < list.bottom ? card : null;
  }

  /** @brief 卡片在侧栏列表中看得见的位置。 @param {string} id 记录。 @return {DOMRect|null} 矩形。 */
  function cardRect(id) {
    const card = cardElement(id);
    return card ? card.getBoundingClientRect() : null;
  }

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

  /** @brief 轻轻放大一下，表示窗口已经开着或刚收下了标签页。 @param {object} entry 窗口。 */
  function pulse(entry) {
    if (reducedMotion() || typeof entry.node.animate !== 'function') return;
    entry.node.animate([{ transform: 'none' }, { transform: 'scale(1.015)' }, { transform: 'none' }], { duration: duration('--sn-duration-normal'), easing: easing('--sn-ease-standard') });
  }

  /** @brief 置顶或取消置顶，按钮的按下状态同步。 @param {object} entry 窗口。 @param {boolean} pinned 是否置顶。 */
  function setPinned(entry, pinned) {
    entry.pinned = pinned;
    entry.pin.setAttribute('aria-pressed', String(pinned));
    entry.pin.setAttribute('aria-label', pinned ? '取消置顶窗口' : '置顶窗口');
    entry.node.classList.toggle('is-pinned', pinned);
    restack();
  }

  /** @brief 创建窗口的结构与事件（还没有标签页）。 @return {object} 窗口。 */
  function create() {
    const node = el('section', 'note-window');
    node.setAttribute('role', 'dialog');
    node.tabIndex = -1;
    const header = el('header', 'note-window-header');
    const emoji = el('span', 'note-window-emoji');
    emoji.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'note-window-title');
    const strip = el('div', 'note-window-tabs');
    strip.setAttribute('role', 'tablist');
    // 标签栏右侧留一块空白：标签页再多也有地方按住拖动窗口（本次提出）。
    const grip = el('div', 'note-window-grip');
    grip.setAttribute('aria-hidden', 'true');
    const actions = el('div', 'window-actions');
    // 标签页放在顶部还是左侧（第四次反馈）：有标签页时才显示，切换的是设置中的同一项。
    const layout = button('标签页放到左侧', '', 'panel-left', 'icon-button note-window-layout');
    layout.setAttribute('aria-pressed', 'false');
    const pin = button('置顶窗口', '', 'pin', 'icon-button note-window-pin');
    pin.setAttribute('aria-pressed', 'false');
    const close = button('关闭窗口', '', 'x', 'icon-button');
    close.setAttribute('aria-keyshortcuts', 'Shift+Escape');
    actions.append(layout, pin, close);
    header.append(emoji, title, strip, grip, actions);
    // 正文外面一层横排的容器：标签页放在左侧时，标签栏挪到这里、排在正文之前。
    const main = el('div', 'note-window-main');
    const body = el('div', 'note-window-body');
    body.setAttribute('role', 'tabpanel');
    main.append(body);
    node.append(header, main);
    EDGES.forEach(function handle(edge) {
      const grip = el('div', 'note-window-resize');
      grip.dataset.edge = edge;
      grip.setAttribute('aria-hidden', 'true');
      node.append(grip);
    });
    const entry = { id: 'window-' + (++sequence), node: node, header: header, emoji: emoji, titleNode: title, strip: strip, grip: grip, main: main, body: body, layout: layout, pin: pin, tabs: [], active: '', x: 0, y: 0, width: 0, height: 0, pinned: false, editing: null, closing: false, order: ++order };
    node.dataset.windowId = entry.id;

    pin.addEventListener('click', function togglePin() { setPinned(entry, !entry.pinned); bringToFront(entry); });
    layout.addEventListener('click', function toggleLayout() { if (window.SideNotesSettings.save({ windowTabs: sideLayout() ? 'top' : 'side' })) entry.node.focus({ preventScroll: true }); });
    close.addEventListener('click', function closeWindow() { closeEntry(entry); });
    node.addEventListener('pointerdown', function activate() { if (!entry.node.classList.contains('is-front')) bringToFront(entry); }, true);
    header.addEventListener('pointerdown', function startMove(event) { if (!event.target.closest('button,.note-window-tab')) startGesture(entry, event, 'move'); });
    header.addEventListener('dblclick', function toggleSize(event) { if (!event.target.closest('button,.note-window-tab')) maximize(entry); });
    // 标签页放不下时横向滚动：滚轮的上下滚动换成左右。
    strip.addEventListener('scroll', hideTip, { passive: true });
    strip.addEventListener('wheel', function scrollTabs(event) {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    }, { passive: false });
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
        // Shift+Esc 关闭整个窗口（第五次反馈：Esc 只能一页一页地关），编辑中的内容与单击 × 一样先保存。
        // 桌面端另有 Ctrl+W 关闭当前页、Ctrl+Shift+W 与 Alt+F4 关闭窗口，浏览器中这些组合键被浏览器占用，原型做不了。
        if (event.shiftKey) closeEntry(entry);
        else if (entry.editing) finishEditing(entry, false); else closeTab(entry, entry.active);
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

  /** @brief 写出标签页：两个以上时标题栏换成标签页，只有一个时仍写标题。 @param {object} entry 窗口。 */
  function renderTabs(entry) {
    const many = entry.tabs.length > 1;
    entry.node.classList.toggle('has-tabs', many);
    const note = noteOf(entry.active);
    const title = note ? noteTitle(note) : '';
    entry.emoji.textContent = note ? note.emoji || '📝' : '';
    entry.titleNode.textContent = title;
    entry.node.setAttribute('aria-label', many ? entry.tabs.length + ' 条记录' : title);
    hideTip();
    placeStrip(entry);
    if (!many) { entry.strip.replaceChildren(); return; }
    entry.strip.replaceChildren(...entry.tabs.map(function tab(id) {
      const item = noteOf(id), name = item ? noteTitle(item) : '';
      const node = el('div', 'note-window-tab' + (id === entry.active ? ' is-active' : ''));
      node.dataset.noteId = id;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(id === entry.active));
      node.setAttribute('aria-label', name);
      node.tabIndex = id === entry.active ? 0 : -1;
      const mark = el('span', 'note-window-tab-emoji', item ? item.emoji || '📝' : '');
      mark.setAttribute('aria-hidden', 'true');
      const close = button('关闭标签页：' + name, '', 'x', 'icon-button note-window-tab-close');
      close.tabIndex = -1;
      close.addEventListener('click', function closeThis(event) { event.stopPropagation(); closeTab(entry, id); });
      node.append(mark, el('span', 'note-window-tab-title', name), close);
      node.addEventListener('click', function choose() { activate(entry, id); });
      node.addEventListener('auxclick', function middle(event) { if (event.button === 1) { event.preventDefault(); closeTab(entry, id); } });
      node.addEventListener('pointerdown', function startTabDrag(event) { hideTip(); if (!event.target.closest('button')) startGesture(entry, event, 'tab', id); });
      node.addEventListener('pointerenter', function hoverTab() { showTip(node); });
      node.addEventListener('pointerleave', hideTip);
      node.addEventListener('keydown', function tabKeys(event) {
        // 竖排时上下方向键同样切换（第四次反馈）。
        const side = entry.node.classList.contains('is-side-tabs'), forward = event.key === 'ArrowRight' || (side && event.key === 'ArrowDown'), backward = event.key === 'ArrowLeft' || (side && event.key === 'ArrowUp');
        const index = entry.tabs.indexOf(id), next = forward ? entry.tabs[(index + 1) % entry.tabs.length] : backward ? entry.tabs[(index - 1 + entry.tabs.length) % entry.tabs.length] : '';
        if (next) { event.preventDefault(); activate(entry, next); const target = entry.strip.querySelector('.note-window-tab.is-active'); if (target) target.focus(); }
        else if (event.key === 'Delete') { event.preventDefault(); closeTab(entry, id); }
      });
      return node;
    }));
    const current = entry.strip.querySelector('.note-window-tab.is-active');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** @brief 写出当前标签页的内容：正文与标签；编辑中不重绘正文。记录被删除或移入回收站时关掉它的标签页。 @param {object} entry 窗口。 */
  function render(entry) {
    const gone = entry.tabs.filter(function missing(id) { const note = noteOf(id); return !note || note.status === 'trash'; });
    if (gone.length) {
      entry.tabs = entry.tabs.filter(function keep(id) { return !gone.includes(id); });
      if (!entry.tabs.length) { closeEntry(entry, { animate: false }); return; }
      if (!entry.tabs.includes(entry.active)) { entry.active = entry.tabs[0]; entry.editing = null; entry.node.classList.remove('is-editing'); }
    }
    renderTabs(entry);
    if (entry.editing) return;
    const note = noteOf(entry.active);
    if (!note) return;
    const parts = noteParts(note), display = noteDisplay(note);
    const content = el('div', 'note-window-content markdown-body');
    // 标题已经写在标题栏或标签页里，正文不再重复首行（与卡片相同）。
    window.NoteContent.renderMarkdown(display.body, content, { onTaskToggle: function toggleTask(index, checked) {
      const changed = display.body.slice(0, index) + (checked ? 'x' : ' ') + display.body.slice(index + 1);
      return updateNote(note.id, { text: window.NoteContent.compose(display.prefix + changed, parts.tags) });
    } });
    stripImages(note).forEach(function attachment(image) {
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
    const keep = entry.body.dataset.noteId === note.id ? entry.body.scrollTop : 0;
    entry.body.replaceChildren(...nodes);
    entry.body.dataset.noteId = note.id;
    entry.body.scrollTop = keep;
  }

  /** @brief 切换到一个标签页；正在编辑的先保存。 @param {object} entry 窗口。 @param {string} id 记录。 @return {boolean} 是否切换。 */
  function activate(entry, id) {
    if (!entry.tabs.includes(id)) return false;
    if (entry.active === id) { renderTabs(entry); return true; }
    if (entry.editing && !finishEditing(entry, true)) return false;
    entry.active = id;
    render(entry);
    return true;
  }

  /**
   * @brief 把记录放进窗口的标签页：已经在别的窗口中的先从那里移出（那个窗口空了就收起），最后一条成为当前标签页。
   * @param {object} entry 窗口。 @param {Array<string>} ids 记录。 @param {number} at 插入位置，默认放在最后。
   */
  function addTabs(entry, ids, at = -1) {
    const valid = ids.filter(function usable(id) { const note = noteOf(id); return note && note.status !== 'trash'; });
    if (!valid.length) return;
    valid.forEach(function move(id) {
      const owner = windowOf(id);
      if (owner && owner !== entry) detachTab(owner, id);
      if (owner === entry) entry.tabs.splice(entry.tabs.indexOf(id), 1);
    });
    const index = at < 0 || at > entry.tabs.length ? entry.tabs.length : at;
    entry.tabs.splice(index, 0, ...valid);
    if (entry.editing && !finishEditing(entry, true)) { renderTabs(entry); return; }
    entry.active = valid[valid.length - 1];
    render(entry);
  }

  /** @brief 从窗口中拿走一个标签页（合并到别处时）；窗口空了就直接收起，不播放关闭动画。 @param {object} entry 窗口。 @param {string} id 记录。 */
  function detachTab(entry, id) {
    if (entry.editing && entry.active === id && !finishEditing(entry, true)) return;
    entry.tabs = entry.tabs.filter(function keep(item) { return item !== id; });
    if (!entry.tabs.length) { closeEntry(entry, { animate: false }); return; }
    if (entry.active === id) entry.active = entry.tabs[0];
    render(entry);
  }

  /** @brief 关闭一个标签页：只剩它时关闭整个窗口。 @param {object} entry 窗口。 @param {string} id 记录。 */
  function closeTab(entry, id) {
    if (entry.tabs.length <= 1) { closeEntry(entry); return; }
    if (entry.editing && entry.active === id && !finishEditing(entry, true)) return;
    const index = entry.tabs.indexOf(id);
    entry.tabs.splice(index, 1);
    if (entry.active === id) entry.active = entry.tabs[Math.min(index, entry.tabs.length - 1)];
    render(entry);
    const current = entry.strip.querySelector('.note-window-tab.is-active');
    if (current && entry.node.contains(document.activeElement)) current.focus({ preventScroll: true });
    else entry.node.focus({ preventScroll: true });
  }

  /** @brief 在窗口中编辑当前标签页：正文换成实时 Markdown 编辑器，填满窗口。 @param {object} entry 窗口。 */
  function beginEditing(entry) {
    const note = noteOf(entry.active);
    if (!note) return;
    // 同一条记录正在侧栏中编辑时，先保存那边的修改。
    if (ui.editing && ui.editing.id === note.id && !finishEdit()) return;
    entry.editing = { id: note.id, text: note.text, original: note.text };
    const input = el('textarea', 'note-window-input');
    input.value = note.text;
    input.setAttribute('aria-label', '编辑记录');
    entry.body.replaceChildren(input);
    delete entry.body.dataset.noteId;
    entry.node.classList.add('is-editing');
    if (window.LiveMarkdown) window.LiveMarkdown.attach(input, { value: note.text, minHeight: 0, maxHeight: 'none' });
    input.addEventListener('input', function track() { entry.editing.text = input.liveMarkdown ? input.liveMarkdown.getValue() : input.value; });
    input.focus({ preventScroll: true });
    // 与卡片编辑一致，光标放在正文末尾（标签行之前）。
    const end = window.NoteContent.bodyEnd(input.liveMarkdown ? input.liveMarkdown.getValue() : input.value);
    input.setSelectionRange(end, end);
  }

  /**
   * @brief 结束窗口中的编辑：保存时内容没变不写库，清空正文时恢复原文（与卡片编辑一致）。
   * @param {object} entry 窗口。 @param {boolean} commit 是否保存。 @return {boolean} 是否结束。
   */
  function finishEditing(entry, commit) {
    if (!entry.editing) return true;
    const editing = entry.editing;
    if (commit && editing.text.trim() && editing.text !== editing.original && !updateNote(editing.id, { text: window.NoteContent.canonicalize(editing.text) })) return false;
    const input = entry.body.querySelector('textarea');
    if (input && input.liveMarkdown) input.liveMarkdown.destroy();
    entry.editing = null;
    entry.node.classList.remove('is-editing');
    render(entry);
    if (entry.node.isConnected && !entry.closing) entry.node.focus({ preventScroll: true });
    return true;
  }

  /**
   * @brief 开始移动、缩放或拖动标签页。
   * @param {object} entry 窗口。 @param {PointerEvent} event 按下。 @param {string} mode move、tab 或缩放的边。 @param {string} tab 拖动的标签页。
   */
  function startGesture(entry, event, mode, tab = '') {
    if (event.button !== 0 || gesture) return;
    if (mode !== 'tab') event.preventDefault();
    bringToFront(entry);
    gesture = { entry: entry, mode: mode, tab: tab, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { x: entry.x, y: entry.y, width: entry.width, height: entry.height }, target: event.currentTarget, active: mode !== 'tab', merge: null };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* 指针失效时由 pointercancel 收尾。 */ }
    if (mode !== 'tab') entry.node.classList.add(mode === 'move' ? 'is-moving' : 'is-resizing');
    if (typeof cancelHide === 'function') cancelHide();
  }

  /** @brief 标记合并的目标窗口（标题栏换成浅强调色）。 @param {object|null} target 窗口。 */
  function markMerge(target) {
    if (gesture.merge === target) return;
    if (gesture.merge) gesture.merge.node.classList.remove('is-merge-target');
    gesture.merge = target;
    if (target) target.node.classList.add('is-merge-target');
  }

  /** @brief 跟随指针移动、缩放或拖动标签页；标题栏始终留在视口内。 @param {PointerEvent} event 移动。 */
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y, start = gesture.start, entry = gesture.entry, view = viewport(), point = { x: event.clientX, y: event.clientY };
    if (gesture.mode === 'tab') {
      if (!gesture.active) {
        if (Math.hypot(dx, dy) < 5) return;
        gesture.active = true;
        const source = gesture.target.getBoundingClientRect();
        gesture.ghost = el('div', 'note-window-tab-ghost');
        gesture.ghost.setAttribute('aria-hidden', 'true');
        gesture.ghost.append(gesture.target.cloneNode(true));
        gesture.grab = { x: event.clientX - source.left, y: event.clientY - source.top };
        document.body.append(gesture.ghost);
        entry.node.classList.add('is-dragging-tab');
        gesture.target.classList.add('is-drag-source');
      }
      const z = zoom();
      gesture.ghost.style.left = (point.x - gesture.grab.x) / z + 'px';
      gesture.ghost.style.top = (point.y - gesture.grab.y) / z + 'px';
      const target = windowAt(point, entry, true), own = inTabBand(entry, point);
      markMerge(target);
      // 插入线标出松开后的位置：别的窗口的标签栏里，或本窗口的标签栏里（调整顺序）；拖到窗口外时拖影放大一点，表示拆成新窗口。
      if (target) showTabDrop(target, point);
      else if (own) showTabDrop(entry, point, gesture.tab);
      else hideTabDrop();
      gesture.ghost.classList.toggle('is-detaching', !target && !own && entry.tabs.length > 1);
      return;
    }
    if (gesture.mode === 'move') {
      entry.x = clamp(start.x + dx, 80 - start.width, view.width - 80);
      entry.y = clamp(start.y + dy, 0, view.height - 40);
      // 标题栏拖到另一个窗口的标题栏上：松开后合并成标签页，插入线标出位置。
      const target = windowAt(point, entry, true);
      markMerge(target);
      if (target) showTabDrop(target, point); else hideTabDrop();
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

  /** @return {boolean} 标签页是否放在左侧（设置中的「窗口标签页」）。 */
  function sideLayout() { return state.settings.windowTabs === 'side'; }

  /**
   * @brief 标签栏放在标题栏里（顶部横排）或正文左侧（竖排，第四次反馈）；只有一个标签页时标题栏照常写标题。
   * 竖排时标题栏写当前标签页的标题，标签页的名称有一整列的宽度。按钮的图标与名称随之切换。
   * @param {object} entry 窗口。
   */
  function placeStrip(entry) {
    const side = sideLayout() && entry.tabs.length > 1;
    entry.node.classList.toggle('is-side-tabs', side);
    if (side && entry.strip.parentNode !== entry.main) entry.main.prepend(entry.strip);
    else if (!side && entry.strip.parentNode !== entry.header) entry.header.insertBefore(entry.strip, entry.grip);
    entry.strip.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
    entry.layout.setAttribute('aria-pressed', String(side));
    entry.layout.setAttribute('aria-label', side ? '标签页放到顶部' : '标签页放到左侧');
    entry.layout.replaceChildren(icon(side ? 'panel-top' : 'panel-left'));
  }

  /**
   * @brief 标签页的标题被截断时，悬停片刻显示全名（第四次反馈）。提示挂在 body 上，不被标签栏裁掉；
   * 横排时在标签页下方，竖排时在右侧；拖动、滚动或离开时收起。
   * @param {HTMLElement} tab 标签页。
   */
  function showTip(tab) {
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(function reveal() {
      const name = tab.querySelector('.note-window-tab-title');
      if (gesture || !tab.isConnected || !name || name.scrollWidth <= name.clientWidth + 1) return;
      if (!tip) { tip = el('div', 'note-window-tooltip'); tip.setAttribute('role', 'tooltip'); }
      tip.textContent = name.textContent;
      document.body.append(tip);
      const z = zoom(), view = viewport(), box = tab.getBoundingClientRect(), size = tip.getBoundingClientRect(), side = Boolean(tab.closest('.is-side-tabs'));
      const left = side ? box.right + MARGIN / 2 : clamp(box.left, MARGIN / 2, view.width - size.width - MARGIN / 2);
      const top = side ? clamp(box.top + (box.height - size.height) / 2, MARGIN / 2, view.height - size.height - MARGIN / 2) : box.bottom + MARGIN / 3;
      tip.style.left = left / z + 'px';
      tip.style.top = top / z + 'px';
    }, 400);
  }

  /** 收起标签页的全名提示。 */
  function hideTip() { window.clearTimeout(tipTimer); if (tip) tip.remove(); }

  /**
   * @brief 标签页在窗口标签栏里的落点：横排看横坐标，竖排看纵坐标；只有一个标签页（标题栏写标题）的窗口接在最后。
   * @param {object} entry 窗口。 @param {{x:number,y:number}} point 指针。 @return {number} 插入位置。
   */
  function tabIndexAt(entry, point) {
    const tabs = Array.from(entry.strip.querySelectorAll('.note-window-tab'));
    if (!tabs.length) return entry.tabs.length;
    const side = entry.node.classList.contains('is-side-tabs');
    const index = tabs.findIndex(function before(tab) { const box = tab.getBoundingClientRect(); return side ? point.y < box.top + box.height / 2 : point.x < box.left + box.width / 2; });
    return index < 0 ? tabs.length : index;
  }

  /**
   * @brief 指针在窗口的标签栏一带（放宽一点）：在这里松开是调整顺序。横排是标题栏，竖排是左侧的标签栏。
   * @param {object} entry 窗口。 @param {{x:number,y:number}} point 指针。 @return {boolean} 是否。
   */
  function inTabBand(entry, point) {
    if (entry.node.classList.contains('is-side-tabs')) {
      const strip = entry.strip.getBoundingClientRect();
      return point.x >= strip.left - MARGIN && point.x <= strip.right + MARGIN && point.y >= strip.top && point.y <= strip.bottom;
    }
    const header = entry.header.getBoundingClientRect();
    return point.y >= header.top - MARGIN && point.y <= header.bottom + MARGIN && point.x >= header.left && point.x <= header.right;
  }

  /**
   * @brief 标签栏里的插入线（本次提出）：一条强调色的竖线，上端一个小圆点，与卡片排序的插入线同一种样子。
   * 插入线挂在 body 上、叠在拖影之上，拖影盖在落点上时也看得见。落点与松开时的计算（tabIndexAt）一致；
   * 在本窗口里放回原处等于没动，不显示。指针靠近标签栏两端时滚动。竖排时是一条横线，左端一个小圆点（第四次反馈）。
   * @param {object} target 窗口。 @param {{x:number,y:number}} point 指针。 @param {string} dragged 本窗口里正在拖动的标签页。
   */
  function showTabDrop(target, point, dragged = '') {
    const tabs = Array.from(target.strip.querySelectorAll('.note-window-tab'));
    if (!target.node.classList.contains('has-tabs') || !tabs.length) { hideTabDrop(); return; }
    const side = target.node.classList.contains('is-side-tabs');
    const z = zoom(), strip = target.strip.getBoundingClientRect(), edge = MARGIN * 2 * z;
    if (side && target.strip.scrollHeight > target.strip.clientHeight) {
      if (point.y < strip.top + edge) target.strip.scrollTop -= MARGIN;
      else if (point.y > strip.bottom - edge) target.strip.scrollTop += MARGIN;
    } else if (!side && target.strip.scrollWidth > target.strip.clientWidth) {
      if (point.x < strip.left + edge) target.strip.scrollLeft -= MARGIN;
      else if (point.x > strip.right - edge) target.strip.scrollLeft += MARGIN;
    }
    const index = tabIndexAt(target, point), from = dragged ? target.tabs.indexOf(dragged) : -1;
    if (from >= 0 && (index === from || index === from + 1)) { hideTabDrop(); return; }
    const style = window.getComputedStyle(target.strip), gap = (parseFloat(side ? style.rowGap : style.columnGap) || 0) * z;
    const box = tabs[Math.min(index, tabs.length - 1)].getBoundingClientRect();
    if (!tabDrop) { tabDrop = el('span', 'note-window-tab-drop'); tabDrop.setAttribute('aria-hidden', 'true'); }
    if (!tabDrop.isConnected) document.body.append(tabDrop);
    tabDrop.classList.toggle('is-horizontal', side);
    if (side) {
      tabDrop.style.left = box.left + 'px';
      tabDrop.style.width = box.width + 'px';
      tabDrop.style.top = clamp(index < tabs.length ? box.top - gap / 2 : box.bottom + gap / 2, strip.top, strip.bottom) + 'px';
      tabDrop.style.height = '';
    } else {
      tabDrop.style.left = clamp(index < tabs.length ? box.left - gap / 2 : box.right + gap / 2, strip.left, strip.right) + 'px';
      tabDrop.style.top = box.top + 'px';
      tabDrop.style.height = box.height + 'px';
      tabDrop.style.width = '';
    }
  }

  /** 收起标签栏里的插入线。 */
  function hideTabDrop() { if (tabDrop) tabDrop.remove(); }

  /**
   * @brief 从侧栏拖来的卡片经过窗口时（interactions.js 调用）：那个窗口的标题栏换成浅强调色，有标签页时标出插入位置；point 为空时清除。
   * @param {{x:number,y:number}|null} point 指针。
   */
  function hint(point) {
    const target = point ? windowAt(point) : null;
    if (hinted !== target) {
      if (hinted) hinted.node.classList.remove('is-merge-target');
      hinted = target;
      if (target) target.node.classList.add('is-merge-target');
    }
    if (target) showTabDrop(target, point); else hideTabDrop();
  }

  /** @brief 结束移动、缩放或拖动标签页：落在别的窗口标题栏上时合并，标签页拖到窗口外时拆成新窗口。 @param {PointerEvent} event 松开。 */
  function endGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const done = gesture, entry = done.entry, point = { x: event.clientX, y: event.clientY };
    const ghost = done.ghost ? done.ghost.getBoundingClientRect() : null;
    try { if (done.target.hasPointerCapture(event.pointerId)) done.target.releasePointerCapture(event.pointerId); } catch (error) { /* 已经释放。 */ }
    entry.node.classList.remove('is-moving', 'is-resizing', 'is-dragging-tab');
    if (done.merge) done.merge.node.classList.remove('is-merge-target');
    if (done.ghost) done.ghost.remove();
    if (done.mode === 'tab') done.target.classList.remove('is-drag-source');
    hideTabDrop();
    gesture = null;
    if (event.type === 'pointercancel') return;
    if (done.mode === 'move' && done.merge) {
      const target = done.merge, ids = entry.tabs.slice();
      if (entry.editing && !finishEditing(entry, true)) return;
      addTabs(target, ids, tabIndexAt(target, point));
      bringToFront(target);
      pulse(target);
      target.node.focus({ preventScroll: true });
      return;
    }
    if (done.mode !== 'tab' || !done.active) return;
    if (done.merge) {
      addTabs(done.merge, [done.tab], tabIndexAt(done.merge, point));
      bringToFront(done.merge);
      pulse(done.merge);
      return;
    }
    if (inTabBand(entry, point)) {
      // 在本窗口的标签栏里松开：调整标签页的顺序。
      const from = entry.tabs.indexOf(done.tab);
      let to = tabIndexAt(entry, point);
      if (to > from) to -= 1;
      entry.tabs.splice(from, 1);
      entry.tabs.splice(to, 0, done.tab);
      renderTabs(entry);
      return;
    }
    // 拖到窗口外：拆成新窗口，标题栏落在松开处；与从侧栏拖出的窗口一样从拖影展开，默认置顶。
    if (entry.tabs.length < 2) return;
    if (entry.editing && entry.active === done.tab && !finishEditing(entry, true)) return;
    detachTab(entry, done.tab);
    open(done.tab, { kind: 'detach', point: point, ghost: ghost, pinned: true });
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
   * @brief 新窗口的大小按内容决定（本次提出）：先按内容的自然宽度排一次（短的记录窗口就窄一些，长段落折到上限），再按这个宽度量高度；
   * 四周的留白在样式里（.note-window-body 的内边距）。宽 280–560、高不超过 600（按 13px 字号计）与视口的六成，长文在窗口里滚动。
   * @param {object} entry 窗口（内容已经写好）。
   */
  function fitSize(entry) {
    const view = viewport(), z = zoom(), style = entry.node.style;
    // 竖排的标签栏另占一列，上下限都加上它的宽度，正文仍按 280–560 定宽。
    // 顶部的标签页按各自标题的宽度排开，上限放宽到 720，放不下时再省略（悬停显示全名）。
    const side = entry.node.classList.contains('is-side-tabs'), extra = side ? entry.strip.getBoundingClientRect().width : 0;
    const cap = entry.node.classList.contains('has-tabs') && !side ? FIT_TABS_WIDTH : FIT_WIDTH[1];
    const maxWidth = Math.max(Math.min(MIN_WIDTH, view.width - MARGIN * 2), Math.min(cap * z + extra, view.width - MARGIN * 2));
    style.width = 'max-content';
    style.maxWidth = maxWidth / z + 'px';
    style.height = 'auto';
    entry.width = clamp(Math.ceil(entry.node.getBoundingClientRect().width), Math.min(FIT_WIDTH[0] * z + extra, maxWidth), maxWidth);
    style.maxWidth = '';
    style.width = entry.width / z + 'px';
    entry.height = clamp(Math.ceil(entry.node.getBoundingClientRect().height), MIN_HEIGHT, Math.max(MIN_HEIGHT, Math.min(view.height * 0.6, FIT_HEIGHT * z)));
  }

  /**
   * @brief 新窗口的位置：拖出时标题栏在松开处；展开全文时放在侧栏旁边、与卡片同高。
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

  /**
   * @brief 打开记录窗口；已经在某个窗口中时切到它的标签页并提到最前。
   * @param {string} id 记录。 @param {object} options kind（expand、drop、detach），from 来源矩形（展开全文时是卡片），point 松开处，
   * ghost 拖影矩形，tabs 一起放进这个窗口的其它记录，pinned 是否置顶。
   * @return {object|null} 窗口。
   */
  function open(id, options = {}) {
    const note = noteOf(id);
    if (!note) return null;
    const existing = windowOf(id);
    if (existing && !options.tabs) {
      activate(existing, id);
      bringToFront(existing);
      existing.node.focus({ preventScroll: true });
      pulse(existing);
      return existing;
    }
    const entry = create();
    // 怎么打开的决定关闭时怎么回去：拖出的（drop、detach）倾斜着缩回卡片，展开全文的原路滑回。
    entry.origin = options.kind === 'drop' || options.kind === 'detach' ? 'drag' : 'expand';
    windows.set(entry.id, entry);
    entry.tabs = [];
    document.body.append(entry.node);
    addTabs(entry, [id].concat(options.tabs || []).filter(function unique(item, index, list) { return list.indexOf(item) === index; }));
    activate(entry, id);
    setPinned(entry, Boolean(options.pinned));
    fitSize(entry);
    position(entry, options);
    apply(entry);
    restack();
    if (entry.origin === 'drag' && options.ghost) morph(entry, options.ghost, { duration: duration('--sn-duration-slow') * 1.6, easing: easing('--sn-ease-standard'), rotate: DRAG_TILT, opacity: 0.9, settle: true });
    else if (options.kind === 'expand') morph(entry, options.from, { duration: duration('--sn-duration-slow') * 1.3, easing: easing('--sn-ease-enter'), opacity: 0.5 });
    entry.node.focus({ preventScroll: true });
    return entry;
  }

  /**
   * @brief 拖出侧栏松开后打开窗口（拖出的窗口默认置顶）：落在已开的窗口上时放进它的标签页（插入线标出的位置），否则多选的几条放进同一个新窗口。
   * @param {Iterable<string>} ids 记录。 @param {{x:number,y:number}} point 松开处。 @param {DOMRect|null} ghost 拖影矩形。
   */
  function openFromDrag(ids, point, ghost) {
    hint(null);
    const list = Array.from(ids).filter(function usable(id) { return noteOf(id); }).slice(0, 12);
    if (!list.length) return;
    const target = windowAt(point);
    if (target) {
      addTabs(target, list, tabIndexAt(target, point));
      bringToFront(target);
      pulse(target);
      target.node.focus({ preventScroll: true });
      return;
    }
    open(list[0], { kind: 'drop', point: point, ghost: ghost, tabs: list.slice(1), pinned: true });
  }

  /** @brief 窗口收回卡片后，卡片轻轻一顿，表示记录回到了这里。 @param {string} id 记录。 */
  function land(id) {
    const card = cardElement(id);
    if (!card || reducedMotion() || typeof card.animate !== 'function') return;
    card.animate([{ transform: 'none' }, { offset: 0.4, transform: 'scale(1.015)' }, { transform: 'none' }], { duration: duration('--sn-duration-normal') * 2, easing: easing('--sn-ease-standard') });
  }

  /**
   * @brief 关闭窗口：先结束编辑（保存），再收回侧栏中当前标签页的卡片（本次提出：与打开呼应）。
   * @details 拖出的窗口是打开的倒放：先轻轻提起，再缩到卡片的大小、倾斜成拖影的样子落向卡片，落下时摆正淡出，卡片轻轻一顿；
   * 时长与缓动与打开相同。展开全文的窗口原路滑回卡片。卡片看不见时原地提起、倾斜着缩小淡出。
   * @param {object} entry 窗口。 @param {object} options animate 是否播放关闭动画。
   */
  function closeEntry(entry, options = {}) {
    if (!windows.has(entry.id) || entry.closing) return;
    if (entry.editing && options.animate !== false && !finishEditing(entry, true)) return;
    entry.closing = true;
    windows.delete(entry.id);
    restack();
    const remove = function remove() { entry.node.remove(); };
    if (options.animate === false || reducedMotion() || typeof entry.node.animate !== 'function') { remove(); return; }
    const from = entry.node.getBoundingClientRect(), to = cardRect(entry.active), z = zoom(), id = entry.active, dragged = entry.origin === 'drag';
    entry.node.style.pointerEvents = 'none';
    if (to && from.width && from.height) {
      const shrink = 'translate(' + (to.left - from.left) / z + 'px, ' + (to.top - from.top) / z + 'px) scale(' + to.width / from.width + ', ' + to.height / from.height + ')';
      const frames = dragged ? [
        { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
        { offset: 0.28, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 },
        { offset: 0.85, transformOrigin: '0 0', transform: shrink + ' rotate(' + DRAG_TILT + 'deg)', opacity: 0.9 },
        { transformOrigin: '0 0', transform: shrink + ' rotate(0deg)', opacity: 0 }
      ] : [
        { transformOrigin: '0 0', transform: 'none', opacity: 1 },
        { offset: 0.8, transformOrigin: '0 0', transform: shrink, opacity: 0.85 },
        { transformOrigin: '0 0', transform: shrink, opacity: 0 }
      ];
      entry.node.animate(frames, { duration: duration('--sn-duration-slow') * (dragged ? 1.6 : 1.3), easing: easing('--sn-ease-standard') }).finished.then(function landed() { remove(); land(id); }, remove);
      return;
    }
    const away = dragged ? [
      { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
      { offset: 0.3, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 },
      { transformOrigin: '50% 50%', transform: 'rotate(' + DRAG_TILT + 'deg) scale(0.92)', opacity: 0 }
    ] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.97)' }];
    entry.node.animate(away, { duration: dragged ? duration('--sn-duration-slow') * 1.2 : duration('--sn-duration-fast'), easing: easing('--sn-ease-exit') }).finished.then(remove, remove);
  }

  /** @brief 关闭全部记录窗口（快捷键「关闭全部记录窗口」）。 @return {boolean} 是否有窗口被关闭。 */
  function closeAll() {
    const list = Array.from(windows.values());
    list.forEach(function close(entry) { closeEntry(entry); });
    return list.length > 0;
  }

  /** 记录变化后重绘打开的窗口（app.js 的 renderNotes 末尾调用）。 */
  function refresh() { Array.from(windows.values()).forEach(render); }

  /** 字号或窗口大小变化后，按保存的视口坐标重新写入样式。 */
  function relayout() { windows.forEach(apply); }

  /**
   * @brief 切换标签页的位置后（第四次反馈），已开的窗口重新排列标签栏：竖排的标签栏另占一列，窗口加宽这一列，正文宽度不变；
   * 改回顶部时再减掉。窗口仍留在视口内。
   * @param {CustomEvent} event 设置变化。
   */
  function changeTabLayout(event) {
    const patch = event.detail && event.detail.patch;
    if (!patch || !('windowTabs' in patch)) return;
    const view = viewport();
    windows.forEach(function arrange(entry) {
      if (entry.closing) return;
      const before = entry.node.classList.contains('is-side-tabs') ? entry.strip.getBoundingClientRect().width : 0;
      renderTabs(entry);
      const after = entry.node.classList.contains('is-side-tabs') ? entry.strip.getBoundingClientRect().width : 0;
      if (after === before) return;
      entry.width = clamp(entry.width + after - before, Math.min(MIN_WIDTH, view.width - MARGIN * 2), view.width - MARGIN * 2);
      entry.x = clamp(entry.x, MARGIN, Math.max(MARGIN, view.width - entry.width - MARGIN));
      entry.maximized = null;
      apply(entry);
    });
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('sidenotes:settings-changed', relayout);
  window.addEventListener('sidenotes:settings-changed', changeTabLayout);

  return Object.freeze({
    open: open,
    openFromDrag: openFromDrag,
    hint: hint,
    closeAll: closeAll,
    refresh: refresh,
    count: function count() { return windows.size; },
    isDragging: function isDragging() { return Boolean(gesture); },
    owns: function owns(target) { return Boolean(target && target.closest && target.closest('.note-window')); }
  });
})();
