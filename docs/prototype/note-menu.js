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

  /* ==================== 菜单定位与焦点 ==================== */

  /** @brief 获取当前记录，避免菜单打开后使用旧快照。 @return {object|null} 当前记录。 */
  function currentNote() {
    return typeof state !== 'undefined' ? state.notes.find(function matches(note) { return note.id === ownerId; }) || null : null;
  }

  /** @brief 收起菜单并按需恢复焦点。 @param {object} options 焦点选项。 */
  function close(options = {}) {
    if (!menu) return;
    const target = returnTarget;
    menu.remove();
    menu = null;
    ownerId = '';
    returnTarget = null;
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
    menu.style.maxHeight = Math.max(100, viewHeight - padding * 2) + 'px';
    const measured = menu.getBoundingClientRect();
    const width = measured.width || 214;
    const height = measured.height || menu.scrollHeight || 340;
    const point = anchor && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY);
    const rect = !point && anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : null;
    let left = point ? anchor.clientX : rect ? rect.right - width : viewWidth - width - 18;
    let top = point ? anchor.clientY : rect ? rect.bottom + 5 : 80;
    if (point && left + width > viewWidth - padding) left = anchor.clientX - width;
    if (top + height > viewHeight - padding) top = point ? anchor.clientY - height : rect ? rect.top - height - 5 : viewHeight - height - padding;
    menu.style.left = Math.max(padding, Math.min(left, viewWidth - width - padding)) + 'px';
    menu.style.top = Math.max(padding, Math.min(top, viewHeight - height - padding)) + 'px';
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
      pinned: ui.tab === 'pinned', status: ui.tab === 'archive' ? 'archived' : 'active',
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
      ['位置', note.status === 'archived' ? '归档' : note.pinned ? '置顶' : '工作区'], ['标识', note.id]
    ].forEach(function appendInfo(item) {
      const row = el('div', 'info-row');
      row.append(el('span', '', item[0]), el('span', '', item[1]));
      panel.body.append(row);
    });
    panel.footer.remove();
  }

  /** @brief 执行菜单命令。 @param {string} command 命令名。 */
  function runCommand(command) {
    const note = currentNote();
    close({ restoreFocus: false });
    if (!note) return;
    if (command === 'copy') copyNote(note);
    else if (command === 'edit') beginEdit(note.id);
    else if (command === 'collapse') toggleCollapsed(note);
    else if (command === 'pin') updateNote(note.id, { pinned: !note.pinned });
    else if (command === 'archive') archiveNote(note);
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
    const card = Array.from(elements.noteList.querySelectorAll('.note-card')).find(function matchesCard(item) { return item.dataset.noteId === latest.id; }) || null;
    returnTarget = anchor && anchor.nodeType === 1 ? anchor : card;
    menu = el('div', 'note-context-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '记录操作');
    menu.dataset.noteMenu = latest.id;
    appendCommand(menu, 'copy', '复制内容与附件', 'copy', { hint: '双击' });
    appendCommand(menu, 'edit', '编辑内容', 'edit');
    appendCommand(menu, 'collapse', latest.collapsed ? '展开正文' : '收起正文', 'chevron-down', { collapsed: latest.collapsed });
    appendSeparator(menu);
    if (latest.status === 'active') appendCommand(menu, 'pin', latest.pinned ? '移到普通记录' : '置顶记录', latest.pinned ? 'pin-off' : 'pin');
    appendCommand(menu, 'archive', latest.status === 'archived' ? '移回工作区' : '归档记录', latest.status === 'archived' ? 'restore' : 'archive');
    appendSeparator(menu);
    appendCommand(menu, 'duplicate', '创建副本', 'duplicate');
    appendCommand(menu, 'export', '导出 Markdown', 'download');
    appendCommand(menu, 'info', '记录信息', 'info');
    appendSeparator(menu);
    appendCommand(menu, 'trash', '移入回收站', 'trash', { danger: true });
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

  window.NoteMenus = Object.freeze({ initialize, open, close, isOpen, toggleCollapsed });
  initialize();
})();
