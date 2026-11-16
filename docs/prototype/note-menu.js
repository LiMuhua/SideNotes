/**
 * @brief 卡片上下文菜单，统一处理更多按钮和鼠标右键入口。
 * @details 菜单使用固定定位并保护视口边界，不接管正文编辑器的原生右键。
 * @date 2026-10-21
 * @author LiMuhua
 */
(function noteMenusModule() {
  'use strict';

  let menu = null; // 当前菜单容器
  let ownerId = ''; // 当前记录标识
  let returnTarget = null; // 关闭后返回的焦点
  let installed = false; // 防止重复绑定
  let listHandlers = null; // 通用菜单（openList）：命令 → 回调
  let closeHook = null; // 通用菜单关闭时的回调
  let lastAnchor = null; // 卡片菜单的位置，二级菜单（移到页签）沿用

  /* ==================== 菜单定位与焦点 ==================== */

  /** @brief 获取当前记录，避免菜单打开后使用旧快照。 @return {object|null} 当前记录。 */
  function currentNote() {
    return typeof state !== 'undefined' ? state.notes.find(function matches(note) { return note.id === ownerId; }) || null : null;
  }

  /** @brief 收起菜单并按需恢复焦点。 @param {object} options 焦点选项。 */
  function close(options = {}) {
    if (!menu) return;
    const target = returnTarget, hook = closeHook;
    menu.remove();
    menu = null;
    ownerId = '';
    returnTarget = null;
    listHandlers = null;
    closeHook = null;
    if (hook) hook();
    if (options.restoreFocus === false) return;
    const replacement = target && target.isConnected ? target : null;
    if (replacement && typeof replacement.focus === 'function') replacement.focus({ preventScroll: true });
  }

  /** @brief 查询菜单是否已打开。 @return {boolean} 打开状态。 */
  function isOpen() { return Boolean(menu); }

  /** @brief 移动菜单焦点。 @param {number|string} direction 位移或边界。 */
  function moveFocus(direction) {
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(function enabled(item) { return !item.disabled; });
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = direction === 'first' ? 0 : direction === 'last' ? items.length - 1 : (index + direction + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  /** @brief 将菜单限制在视口内，必要时向左或向上展开。 @param {HTMLElement|Event|null} anchor 触发位置。 */
  function positionMenu(anchor) {
    if (!menu) return;
    const padding = 8;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    // 菜单随字号整页缩放（zoom），位置与高度按视口坐标算好后除以缩放倍数再写入。
    const zoom = parseFloat(window.getComputedStyle(menu).zoom) || 1;
    menu.style.maxHeight = Math.max(100, viewHeight - padding * 2) / zoom + 'px';
    const measured = menu.getBoundingClientRect();
    const width = measured.width || 214;
    const height = measured.height || menu.scrollHeight || 340;
    const point = anchor && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY);
    const rect = !point && anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null;
    let left = point ? anchor.clientX : rect ? rect.right - width : viewWidth - width - 18;
    let top = point ? anchor.clientY : rect ? rect.bottom + 5 : 80;
    if (point && left + width > viewWidth - padding) left = anchor.clientX - width;
    if (top + height > viewHeight - padding) top = point ? anchor.clientY - height : rect ? rect.top - height - 5 : viewHeight - height - padding;
    menu.style.left = Math.max(padding, Math.min(left, viewWidth - width - padding)) / zoom + 'px';
    menu.style.top = Math.max(padding, Math.min(top, viewHeight - height - padding)) / zoom + 'px';
  }

  /* ==================== 记录操作 ==================== */

  /** @brief 切换正文折叠状态，编辑中的内容先保存。 @param {object} note 目标记录。 @return {boolean} 操作是否完成。 */
  function toggleCollapsed(note) {
    if (!note) return false;
    if (ui.editing && !finishEdit()) return false;
    const latest = state.notes.find(function matches(item) { return item.id === note.id; });
    if (!latest) return false;
    return updateNote(latest.id, { collapsed: !latest.collapsed });
  }

  /** @brief 创建副本并归属当前页签。 @param {object} note 来源记录。 */
  function duplicateNote(note) {
    const now = Date.now();
    const duplicate = {
      ...note, id: createId(), order: null, collapsed: false,
      emoji: window.NoteEmoji.pick(state.notes.map(function used(item) { return item.emoji; })),
      images: note.images.map(function imageCopy(image) { return { ...image }; }),
      pinned: ui.tab === 'pinned', status: 'active',
      deletedAt: null, previousStatus: 'active', createdAt: now, updatedAt: now
    };
    if (!persistSnapshot([duplicate, ...state.notes])) { toast('副本未创建，浏览器存储空间不足', null, true); return; }
    renderNotes();
    toast('已创建副本');
  }

  /** @brief 展示记录信息；只读详情仍使用对话框。 @param {object} note 当前记录。 */
  function showInfo(note) {
    const panel = openModal('记录信息', 'note-info-modal');
    [
      ['创建时间', new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false })],
      ['修改时间', new Date(note.updatedAt).toLocaleString('zh-CN', { hour12: false })],
      ['正文长度', note.text.length + ' 字'], ['图片附件', note.images.length + ' 张'],
      ['位置', place(note)], ['标识', note.id]
    ].forEach(function appendInfo(item) {
      const row = el('div', 'info-row');
      row.append(el('span', '', item[0]), el('span', '', item[1]));
      panel.body.append(row);
    });
    panel.footer.remove();
  }

  /** @brief 记录所在的位置（记录信息）：置顶、固定的标签页签或随记。 @param {object} note 记录。 @return {string} 位置。 */
  function place(note) {
    const tag = window.SidebarTabs ? window.SidebarTabs.pinnedTagOf(note) : '';
    return [note.pinned ? '置顶' : '', tag ? '页签「' + tag + '」' : note.pinned ? '' : '随记'].filter(Boolean).join('、');
  }

  /** @brief 菜单操作的对象：这张卡片在多选之中时是全部选中的记录，否则是它自己。 @param {object} note 记录。 @return {Array<string>} 记录。 */
  function targetIds(note) {
    const selection = window.NoteInteractions && window.NoteInteractions.hasSelection() ? window.NoteInteractions.selectedIds() : [];
    return selection.length > 1 && selection.includes(note.id) ? selection : [note.id];
  }

  /**
   * @return {Array<string>} 「移到…」可去的页签：随记与固定的标签页签，当前页签除外（搜索时是这条记录所在的页签除外）；置顶有自己的菜单项。
   * @param {object} note 记录。
   */
  function moveDestinations(note) {
    const tabs = window.SidebarTabs, here = searching() && note ? tabs.homeOf(note) : ui.tab;
    return tabs ? ['workspace'].concat(tabs.pinnedTags().map(tabs.tabOf)).filter(function other(tab) { return tab !== here; }) : [];
  }

  /** @return {boolean} 是否在全局搜索（app.js）。 */
  function searching() { return typeof isSearching === 'function' && isSearching(); }

  /** @brief 菜单里写的记录标题：超过 10 个字截断。 @param {object} note 记录。 @return {string} 标题。 */
  function shortTitle(note) { const chars = Array.from(noteTitle(note)); return chars.length > 10 ? chars.slice(0, 10).join('') + '…' : chars.join(''); }

  /**
   * @brief 「移到…」的二级菜单（第四次反馈）：随记与固定的标签页签（当前页签除外），与把卡片拖到页签上相同。
   * @param {object} note 记录。
   */
  function openMoveMenu(note) {
    const tabs = window.SidebarTabs, ids = targetIds(note);
    openList(moveDestinations(note).map(function item(tab) {
      return { label: tab === 'workspace' ? '随记' : tabs.tagOf(tab), icon: tab === 'workspace' ? 'note' : 'hash', run: function move() { window.NoteInteractions.moveTo(ids, tab); } };
    }), lastAnchor, { label: '移到页签' });
  }

  /** @brief 执行菜单命令。 @param {string} command 命令名。 */
  function runCommand(command) {
    if (command && command.startsWith('list:')) {
      const run = listHandlers && listHandlers.get(command);
      close({ restoreFocus: false });
      if (run) run();
      return;
    }
    const note = currentNote();
    close({ restoreFocus: false });
    if (!note) return;
    if (command === 'copy') copyNote(note);
    else if (command === 'edit') beginEdit(note.id);
    else if (command === 'collapse') toggleCollapsed(note);
    else if (command === 'pin') updateNote(note.id, { pinned: !note.pinned });
    else if (command === 'move') openMoveMenu(note);
    else if (command === 'locate') goToTab(window.SidebarTabs.homeOf(note), { noteId: note.id });
    else if (command === 'merge') window.NoteMerge.open({ ids: targetIds(note) });
    else if (command === 'merge-into') window.NoteMerge.open({ ids: targetIds(note).filter(function others(id) { return id !== note.id; }), target: note.id });
    else if (command === 'duplicate') duplicateNote(note);
    else if (command === 'export') exportNote(note);
    else if (command === 'info') showInfo(note);
    else if (command === 'trash') requestDelete(note);
  }

  /** @brief 添加命令项。 @param {HTMLElement} container 菜单。 @param {string} command 命令。 @param {string} label 名称。 @param {string} symbol 图标。 @param {object} options 展示选项。 */
  function appendCommand(container, command, label, symbol, options = {}) {
    const item = el('button', 'note-context-item' + (options.danger ? ' is-danger' : ''));
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.menuCommand = command;
    item.append(icon(symbol), el('span', 'note-context-label', label));
    if (options.hint) item.append(el('span', 'note-context-hint', options.hint));
    if (command === 'collapse') item.classList.toggle('is-expanded', !options.collapsed);
    container.append(item);
  }

  /** @brief 添加操作组分割线。 @param {HTMLElement} container 菜单。 */
  function appendSeparator(container) {
    const separator = el('div', 'note-context-separator');
    separator.setAttribute('role', 'separator');
    container.append(separator);
  }

  /** @brief 打开卡片菜单。 @param {object} note 记录。 @param {HTMLElement|Event|null} anchor 按钮或鼠标事件。 @return {boolean} 是否打开。 */
  function open(note, anchor = null) {
    if (!note || ui.modal) return false;
    if (ui.editing && !finishEdit()) return false;
    const latest = state.notes.find(function matches(item) { return item.id === note.id; });
    if (!latest) return false;
    close({ restoreFocus: false });
    ownerId = latest.id;
    lastAnchor = anchor && Number.isFinite(anchor.clientX) ? { clientX: anchor.clientX, clientY: anchor.clientY } : anchor;
    const card = Array.from(elements.noteList.querySelectorAll('.note-card')).find(function matchesCard(item) { return item.dataset.noteId === latest.id; }) || null;
    returnTarget = anchor && anchor.nodeType === 1 ? anchor : card;
    menu = el('div', 'note-context-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '记录操作');
    menu.dataset.noteMenu = latest.id;
    // 全局搜索的结果（第五次反馈）：最上面是「转到」这条记录所在的页签，滚到它并高亮。
    if (searching()) {
      appendCommand(menu, 'locate', '转到' + window.SidebarTabs.label(window.SidebarTabs.homeOf(latest)), 'arrow-right');
      appendSeparator(menu);
    }
    // 多选之中的卡片（第四次反馈）：最上面是合并成一条，或把其余选中的合并到这一条（第五次反馈：写出这一条的标题）。
    if (targetIds(latest).length > 1) {
      appendCommand(menu, 'merge', '合并成一条…', 'merge', { hint: targetIds(latest).length + ' 条' });
      appendCommand(menu, 'merge-into', '合并到「' + shortTitle(latest) + '」', 'merge');
      appendSeparator(menu);
    }
    appendCommand(menu, 'copy', '复制内容与附件', 'copy', { hint: 'Ctrl+C' });
    appendCommand(menu, 'edit', '编辑内容', 'edit', { hint: '双击' });
    appendCommand(menu, 'collapse', latest.collapsed ? '展开正文' : '收起正文', 'chevron-down', { collapsed: latest.collapsed });
    appendSeparator(menu);
    if (latest.status === 'active') appendCommand(menu, 'pin', latest.pinned ? '移到普通记录' : '置顶记录', latest.pinned ? 'pin-off' : 'pin');
    // 去掉了「归档」（第四次反馈）；换成移到随记或固定的标签页签。
    if (moveDestinations(latest).length) appendCommand(menu, 'move', '移到…', 'arrow-right');
    appendSeparator(menu);
    appendCommand(menu, 'duplicate', '创建副本', 'duplicate');
    appendCommand(menu, 'export', '导出 Markdown', 'download');
    appendCommand(menu, 'info', '记录信息', 'info');
    appendSeparator(menu);
    appendCommand(menu, 'trash', '移入回收站', 'trash', { danger: true, hint: 'Delete' });
    menu.addEventListener('click', function activateItem(event) {
      const item = event.target.closest('[data-menu-command]');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      runCommand(item.dataset.menuCommand);
    });
    document.body.append(menu);
    positionMenu(anchor);
    moveFocus('first');
    return true;
  }

  /**
   * @brief 通用菜单（第四次反馈：页签菜单、移到页签等），样子与卡片菜单相同。
   * 条目是 'separator'，或 { label, icon, hint, danger, disabled, checked, tab, run, context }：tab 写进 data-tab（拖动卡片时作为落点），
   * context 是右键这一项时的处理。
   * @param {Array} items 条目。 @param {HTMLElement|Event|object|null} anchor 按钮、鼠标事件或 {clientX, clientY}。
   * @param {object} options label、className、focus（默认移到第一项）、returnFocus、onClose。 @return {boolean} 是否打开。
   */
  function openList(items, anchor, options = {}) {
    close({ restoreFocus: false });
    listHandlers = new Map();
    closeHook = options.onClose || null;
    returnTarget = options.returnFocus || (anchor && anchor.nodeType === 1 ? anchor : null);
    menu = el('div', 'note-context-menu' + (options.className ? ' ' + options.className : ''));
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', options.label || '菜单');
    items.forEach(function add(item, index) {
      if (item === 'separator') { appendSeparator(menu); return; }
      const command = 'list:' + index;
      appendCommand(menu, command, item.label, item.icon || 'arrow-right', { hint: item.hint, danger: item.danger });
      const node = menu.lastElementChild;
      if (item.checked) { node.classList.add('is-checked'); node.append(icon('check')); }
      if (item.tab) node.dataset.tab = item.tab;
      if (item.disabled) node.disabled = true;
      if (item.context) node.addEventListener('contextmenu', function contextMenu(event) { item.context(event); });
      listHandlers.set(command, item.run);
    });
    menu.addEventListener('click', function activateItem(event) {
      const item = event.target.closest('[data-menu-command]');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      runCommand(item.dataset.menuCommand);
    });
    document.body.append(menu);
    positionMenu(anchor);
    if (options.focus !== false) moveFocus('first');
    return true;
  }

  /* ==================== 全局入口与生命周期 ==================== */

  /** @brief 处理卡片右键，编辑文本区域保留系统菜单。 @param {MouseEvent} event 鼠标事件。 */
  function handleContextMenu(event) {
    if (menu && menu.contains(event.target)) { event.preventDefault(); return; }
    const card = event.target.closest('.note-card');
    if (!card || ui.modal || event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const note = state.notes.find(function matches(item) { return item.id === card.dataset.noteId; });
    if (!note) return;
    event.preventDefault();
    if (typeof invalidateCardClick === 'function') invalidateCardClick();
    if (typeof cancelCardSort === 'function') cancelCardSort();
    if (ui.expandedTags && ui.expandedTags.size) return;
    open(note, event);
  }

  /** @brief 点击外部时关闭菜单，不占用下一次正常点击。 @param {PointerEvent} event 指针事件。 */
  function handleOutsidePointer(event) {
    if (menu && !menu.contains(event.target)) close({ restoreFocus: false });
  }

  /** @brief 在菜单内导航，退出时优先关闭菜单。 @param {KeyboardEvent} event 键盘事件。 */
  function handleMenuKeyboard(event) {
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key === 'Tab') { close(); return; }
    const moves = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (Object.prototype.hasOwnProperty.call(moves, event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFocus(moves[event.key]);
    } else if ((event.key === 'Enter' || event.key === ' ') && menu.contains(document.activeElement)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runCommand(document.activeElement.dataset.menuCommand);
    }
  }

  /** 初始化一次监听；固定菜单在窗口尺寸或列表滚动变化时关闭。 */
  function initialize() {
    if (installed) return;
    installed = true;
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    document.addEventListener('keydown', handleMenuKeyboard, true);
    window.addEventListener('resize', function closeOnResize() { close({ restoreFocus: false }); });
    document.addEventListener('scroll', function closeOnScroll(event) {
      if (menu && !menu.contains(event.target)) close({ restoreFocus: false });
    }, true);
  }

  window.NoteMenus = Object.freeze({ initialize, open, openList, close, isOpen, toggleCollapsed });
  initialize();
})();
