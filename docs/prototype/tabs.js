'use strict';

/**
 * @brief 侧栏页签（第四次反馈）：随记、置顶与手动固定的标签。
 * @details
 * - 随记显示没有任何已固定标签的记录（原来的「工作区」改名，去掉了「归档」）；置顶显示置顶的记录，与原来相同。
 * - 标签页签只由用户手动固定：按标签筛选时筛选条上的「固定为页签」，或最后一格菜单中的「新建页签」，不会自动出现。
 *   页签上写标签名（不写 #，超过 4 个字截断），显示带这个标签的记录；顺序保存在设置的 pinnedTags 中。
 * - 管理：双击页签原地改名（所有记录上的这个标签一起改）；按住拖动页签排序，插入线标出位置；
 *   右键「改名」「移出页签栏」，移出只是不再固定，记录与标签都不变，可以撤销。
 * - 放不下时，多出来的页签从右往左收进最后一格「N ▾」。选中收起的页签时前面的页签不动，最后一格显示它的名称并带当前样式
 *   （最后一格按 4 个字的宽度预留，显示哪个名称都不会挤动前面的页签）。单击最后一格总是打开菜单：收起的页签与「新建页签」。
 * - 条数只写在随记与当前页签上，省出页签栏的宽度。
 * - 在标签页签里新建记录时，新建卡片的工具栏上有一个「#标签」，保存时写进标签行；点它的 × 可以不带。
 * 依赖 app.js 的全局状态与函数（state、ui、elements、el、icon、button、renderNotes、toast、tagKey、hasTag、noteParts、
 * persistSnapshot、normalizeSettings、isValidTag、finishEdit、closeTagMenu、renameTagEverywhere、manageTag），只在调用时使用。
 */
window.SidebarTabs = (function createSidebarTabs() {
  const PREFIX = 'tag:';
  const NAME_RESERVE = '页签名称'; // 最后一格按 4 个字预留宽度时用的占位文字（看不见）。
  let nav = null; // 页签栏（.sidebar-tabs）
  let more = null; // 最后一格
  let observer = null;
  let hidden = []; // 收起的标签页签（标签名，按页签栏的顺序）
  let panel = null; // 新建页签的输入面板
  let chip = null; // 新建卡片工具栏上的「#标签」
  let skipTag = ''; // 新建卡片中去掉了的页签标签
  let press = null; // 按住标签页签，移动后拖动排序
  let dropLine = null; // 拖动排序的插入线
  let suppressClick = false;
  let installed = false;

  /* ==================== 页签与记录 ==================== */

  /** @brief 页签对应的标签；随记与置顶返回空字符串。 @param {string} tab 页签。 @return {string} 标签。 */
  function tagOf(tab) { return typeof tab === 'string' && tab.startsWith(PREFIX) ? tab.slice(PREFIX.length) : ''; }

  /** @brief 标签页签的标识。 @param {string} tag 标签。 @return {string} 页签。 */
  function tabOf(tag) { return PREFIX + tag; }

  /** @return {Array<string>} 固定为页签的标签，按页签栏的顺序。 */
  function pinnedTags() { return (typeof state !== 'undefined' && state && state.settings && state.settings.pinnedTags) || []; }

  /** @brief 已固定的同名标签（不分大小写）。 @param {string} tag 标签。 @return {string} 固定时的写法，没有时为空。 */
  function findPinned(tag) { return pinnedTags().find(function same(item) { return tagKey(item) === tagKey(tag); }) || ''; }

  /** @brief 记录所在的第一个标签页签。 @param {object} note 记录。 @return {string} 标签，没有时为空。 */
  function pinnedTagOf(note) { return pinnedTags().find(function owns(tag) { return hasTag(note, tag); }) || ''; }

  /** @brief 页签是否还在（标签页签被移出页签栏后不在）。 @param {string} tab 页签。 @return {boolean} 是否。 */
  function exists(tab) { return tab === 'workspace' || tab === 'pinned' || Boolean(tagOf(tab) && findPinned(tagOf(tab))); }

  /**
   * @brief 记录是否显示在这个页签里：随记是没有任何已固定标签的记录，置顶是置顶的记录，标签页签是带这个标签的记录。
   * @param {object} note 记录。 @param {string} tab 页签。 @return {boolean} 是否。
   */
  function belongs(note, tab) {
    if (!note || note.status !== 'active') return false;
    if (tab === 'pinned') return Boolean(note.pinned);
    const tag = tagOf(tab);
    return tag ? hasTag(note, tag) : !pinnedTagOf(note);
  }

  /** @return {Array<string>} 页签栏的顺序：随记、置顶与固定的标签（全局搜索的结果按这个顺序分组）。 */
  function order() { return ['workspace', 'pinned'].concat(pinnedTags().map(tabOf)); }

  /** @brief 页签显示的名称（不带引号）。 @param {string} tab 页签。 @return {string} 名称。 */
  function name(tab) { return tab === 'pinned' ? '置顶' : tagOf(tab) || '随记'; }

  /**
   * @brief 记录在页签栏中第一个出现的页签：没有已固定标签的在随记，否则置顶的在置顶，其余在它的第一个固定标签。
   * 全局搜索的结果按它分组，「转到」也去这里。 @param {object} note 记录。 @return {string} 页签。
   */
  function homeOf(note) { return order().find(function owns(tab) { return belongs(note, tab); }) || 'workspace'; }

  /** @brief 页签在提示中的名称。 @param {string} tab 页签。 @return {string} 名称。 */
  function label(tab) { const tag = tagOf(tab); return tab === 'pinned' ? '置顶' : tag ? '「' + tag + '」' : '随记'; }

  /** @brief 切换页签，与单击页签相同：结束搜索，清除标签筛选，回到列表顶部（app.js 的 goToTab）。 @param {string} tab 页签。 @return {boolean} 是否切换。 */
  function select(tab) {
    return exists(tab) && goToTab(tab, { reset: true });
  }

  /** @brief 保存固定的标签与顺序。 @param {Array<string>} list 标签。 @return {boolean} 是否成功。 */
  function savePinned(list) {
    const settings = normalizeSettings({ ...state.settings, pinnedTags: list });
    if (!persistSnapshot(state.notes, state.draft, settings)) { toast('页签未保存，请重试', null, true); return false; }
    return true;
  }

  /**
   * @brief 把标签固定成页签并切换过去；已经固定的直接切换。与已有标签只差大小写时用已有的写法。
   * @param {string} name 标签。 @return {boolean} 是否完成。
   */
  function pin(name) {
    const raw = String(name || '').trim().replace(/^#/, '');
    if (!isValidTag(raw)) { toast('标签最多 40 字；使用文字、数字、下划线或短横线', null, true); return false; }
    const known = allTags().find(function same(item) { return tagKey(item.tag) === tagKey(raw); });
    const tag = findPinned(raw) || (known ? known.tag : raw);
    if (!findPinned(tag)) {
      if (!savePinned(pinnedTags().concat(tag))) return false;
      toast('已固定为页签「' + tag + '」', { label: '撤销', run: function undoPin() { unpin(tag, { silent: true }); } });
    }
    return select(tabOf(tag)) || (renderNotes(), true);
  }

  /**
   * @brief 移出页签栏：只是不再固定，记录与标签都不变；当前在这个页签时回到随记。提示条可以撤销，放回原来的位置。
   * @param {string} tag 标签。 @param {object} options silent：不提示（撤销固定时）。 @return {boolean} 是否完成。
   */
  function unpin(tag, options = {}) {
    const list = pinnedTags(), index = list.findIndex(function same(item) { return tagKey(item) === tagKey(tag); });
    if (index < 0) return false;
    const name = list[index];
    if (!savePinned(list.filter(function keep(item, position) { return position !== index; }))) return false;
    if (tagKey(tagOf(ui.tab)) === tagKey(name)) select('workspace'); else renderNotes();
    if (!options.silent) toast('已把「' + name + '」移出页签栏', { label: '撤销', run: function undoUnpin() { const restored = pinnedTags().slice(); restored.splice(Math.min(index, restored.length), 0, name); if (savePinned(restored)) renderNotes(); } });
    return true;
  }

  /** @brief 收起的页签放回页签栏：换到页签栏的最后一个位置，原来那个收进菜单。 @param {string} tag 标签。 */
  function promote(tag) {
    const list = pinnedTags().slice(), from = list.findIndex(function same(item) { return tagKey(item) === tagKey(tag); });
    const visible = list.length - hidden.length;
    if (from < visible || from < 0) return;
    list.splice(from, 1);
    list.splice(Math.max(0, visible - 1), 0, tag);
    if (savePinned(list)) renderNotes();
  }

  /** @return {Array<{tag:string,count:number}>} 未删除记录中的全部标签与条数，条数多的在前。 */
  function allTags() {
    const grouped = new Map();
    state.notes.forEach(function collect(note) {
      if (note.status !== 'active') return;
      noteParts(note).tags.forEach(function count(tag) { const key = tagKey(tag); if (!grouped.has(key)) grouped.set(key, { tag: tag, count: 0 }); grouped.get(key).count += 1; });
    });
    return Array.from(grouped.values()).sort(function order(a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'); });
  }

  /* ==================== 页签栏 ==================== */

  /** @brief 标签页签：名称、条数。 @param {string} tag 标签。 @return {HTMLButtonElement} 页签。 */
  function createTab(tag) {
    const node = el('button', 'tab is-tag-tab');
    node.type = 'button';
    node.dataset.tab = tabOf(tag);
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', 'note-list');
    const mark = el('span', 'tab-mark');
    mark.setAttribute('aria-hidden', 'true');
    const count = el('span', 'tab-count');
    count.dataset.count = '';
    node.append(mark, el('span', 'tab-name', tag), count);
    return node;
  }

  /** @return {HTMLButtonElement} 最后一格：收起的页签与「新建页签」的菜单。 */
  function createMore() {
    const node = el('button', 'tab tab-more');
    node.type = 'button';
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-haspopup', 'menu');
    node.setAttribute('aria-expanded', 'false');
    node.setAttribute('aria-controls', 'note-list');
    node.addEventListener('click', function openFromClick(event) { event.preventDefault(); event.stopPropagation(); openMenu(); });
    node.addEventListener('keydown', function openFromKey(event) { if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(); } });
    return node;
  }

  /**
   * @brief 最后一格的样子：plain 只有 ▾；count 写收起的个数；active 写当前的收起页签并带当前样式；reserve 按 4 个字预留宽度（量宽时用）。
   * @param {string} mode 样子。 @param {string} tag 当前的收起页签。 @param {number} count 收起的个数。
   */
  function setMore(mode, tag = '', count = 0) {
    more.replaceChildren();
    const named = mode === 'active' || mode === 'reserve';
    more.classList.toggle('active', mode === 'active');
    more.classList.toggle('has-name', named);
    if (named) { const name = el('span', 'tab-name', mode === 'reserve' ? NAME_RESERVE : tag); if (mode === 'reserve') name.classList.add('is-reserve'); more.append(name); }
    if (mode === 'count') more.append(el('span', 'tab-more-count', String(count)));
    more.append(icon('chevron-down'));
    if (mode === 'active') {
      more.dataset.tab = tabOf(tag);
      more.setAttribute('aria-selected', 'true');
      more.setAttribute('aria-label', tag + '，另有 ' + Math.max(0, count - 1) + ' 个收起的页签');
    } else {
      delete more.dataset.tab;
      more.setAttribute('aria-selected', 'false');
      more.setAttribute('aria-label', count ? '另有 ' + count + ' 个页签，新建页签' : '新建页签');
    }
    more.tabIndex = mode === 'active' ? 0 : -1;
  }

  /** 写出页签栏：随记、置顶之后是固定的标签，最后一格是菜单；只有随记与当前页签写条数。 */
  function render() {
    install();
    nav = document.querySelector('.sidebar-tabs');
    if (!nav) return;
    if (!exists(ui.tab)) ui.tab = 'workspace';
    const focused = document.activeElement && nav.contains(document.activeElement) ? document.activeElement.dataset.tab || (document.activeElement === more ? 'more' : '') : '';
    nav.querySelectorAll('.tab.is-tag-tab, .tab-rename-input').forEach(function remove(node) { node.remove(); });
    if (!more) more = createMore();
    if (!more.isConnected) nav.append(more);
    pinnedTags().forEach(function add(tag) { nav.insertBefore(createTab(tag), more); });
    const counts = { workspace: count('workspace') };
    if (ui.tab !== 'workspace') counts[ui.tab] = count(ui.tab);
    nav.querySelectorAll('.tab[data-tab]:not(.tab-more)').forEach(function mark(node) {
      const tab = node.dataset.tab, selected = tab === ui.tab, number = node.querySelector('[data-count]');
      node.classList.toggle('active', selected);
      node.setAttribute('aria-selected', String(selected));
      node.tabIndex = selected ? 0 : -1;
      if (!number) return;
      const shown = Object.prototype.hasOwnProperty.call(counts, tab);
      number.hidden = !shown;
      if (shown) number.textContent = String(counts[tab]);
    });
    layout();
    syncComposerTag();
    if (focused) {
      const target = focused === 'more' ? more : Array.from(nav.querySelectorAll('[data-tab]')).find(function same(node) { return node.dataset.tab === focused && !node.hidden; });
      if (target) target.focus({ preventScroll: true });
    }
  }

  /** @brief 页签里的记录条数。 @param {string} tab 页签。 @return {number} 条数。 */
  function count(tab) { return state.notes.filter(function inTab(note) { return belongs(note, tab); }).length; }

  /**
   * 放不下的标签页签从右往左收进最后一格。先按最后一格只有 ▾ 来排；放不下时按它写 4 个字的宽度预留，
   * 这样选中收起的页签、最后一格换成它的名称时，前面的页签不会被挤动。搜索在下面的筛选行（第五次反馈），页签栏占满整行。
   */
  function layout() {
    if (!nav || !more || !nav.isConnected) return;
    const tabs = Array.from(nav.querySelectorAll('.tab.is-tag-tab'));
    tabs.forEach(function show(node) { node.hidden = false; });
    setMore('plain');
    if (nav.scrollWidth > nav.clientWidth + 1) {
      setMore('reserve');
      for (let index = tabs.length - 1; index >= 0 && nav.scrollWidth > nav.clientWidth + 1; index -= 1) tabs[index].hidden = true;
    }
    hidden = tabs.filter(function collapsed(node) { return node.hidden; }).map(function name(node) { return tagOf(node.dataset.tab); });
    const current = tagOf(ui.tab), activeHidden = Boolean(current) && hidden.some(function same(tag) { return tagKey(tag) === tagKey(current); });
    setMore(activeHidden ? 'active' : hidden.length ? 'count' : 'plain', current, hidden.length);
  }

  /* ==================== 最后一格的菜单与新建页签 ==================== */

  /**
   * @brief 最后一格的菜单：收起的页签（当前的打勾，右键可以放回页签栏或移出）与「新建页签」。拖动卡片时停在最后一格上也会打开，
   * 菜单中的页签可以作为落点（data-tab）。
   * @param {object} options dragging：拖动卡片时打开，焦点不移进菜单。
   */
  function openMenu(options = {}) {
    if (!more || !window.NoteMenus || !window.NoteMenus.openList) return;
    const current = tagOf(ui.tab);
    const items = hidden.map(function entry(tag) {
      return { label: tag, icon: 'hash', checked: Boolean(current) && tagKey(tag) === tagKey(current), tab: tabOf(tag), run: function choose() { if (select(tabOf(tag)) && more && more.isConnected) more.focus({ preventScroll: true }); }, context: function contextMenu(event) { openTabMenu(tag, event, true); } };
    });
    if (items.length) items.push('separator');
    items.push({ label: '新建页签', icon: 'plus', run: function create() { startCreate(); } });
    more.setAttribute('aria-expanded', 'true');
    window.NoteMenus.openList(items, more, { label: '页签', className: 'tab-menu', focus: !options.dragging, returnFocus: more, onClose: function closed() { if (more) more.setAttribute('aria-expanded', 'false'); } });
  }

  /**
   * @brief 页签的右键菜单：改名、移出页签栏；菜单中收起的页签多一项「放到页签栏」。
   * @param {string} tag 标签。 @param {MouseEvent} event 右键。 @param {boolean} collapsed 是否是收起的页签。
   */
  function openTabMenu(tag, event, collapsed) {
    event.preventDefault();
    event.stopPropagation();
    const items = [];
    if (collapsed) items.push({ label: '放到页签栏', icon: 'arrow-up', run: function promoteTab() { promote(tag); } });
    items.push({ label: '改名', icon: 'edit', hint: collapsed ? '' : '双击', run: function renameTab() { if (collapsed) manageTag(tag); else startRename(tag); } });
    items.push('separator');
    items.push({ label: '移出页签栏', icon: 'x', run: function removeTab() { unpin(tag); } });
    window.NoteMenus.openList(items, event, { label: '页签「' + tag + '」' });
  }

  /**
   * 新建页签：最后一格下方弹出一个输入框，输入时列出还没固定的已有标签（条数多的在前），↑ ↓ 选择、Enter 固定，Esc 或点到外面取消。
   * 输入的名称不是已有标签时，先得到一个空页签，在里面新建或拖进来的记录带上这个标签。
   */
  function startCreate() {
    closeCreate();
    panel = el('div', 'floating-panel tab-create-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '新建页签');
    const input = el('input', 'form-control tab-create-input');
    input.type = 'text';
    input.placeholder = '标签名称';
    input.setAttribute('aria-label', '标签名称');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const list = el('div', 'tab-create-list');
    list.setAttribute('role', 'listbox');
    list.id = 'tab-create-list';
    input.setAttribute('aria-controls', list.id);
    panel.append(input, list);
    document.body.append(panel);
    let active = -1;
    const options = function options() { return Array.from(list.querySelectorAll('[role="option"]')); };
    const highlight = function highlight(index) {
      const items = options();
      active = items.length ? (index + items.length) % items.length : -1;
      items.forEach(function mark(item, position) { item.classList.toggle('is-active', position === active); item.setAttribute('aria-selected', String(position === active)); });
      if (active >= 0) input.setAttribute('aria-activedescendant', items[active].id); else input.removeAttribute('aria-activedescendant');
    };
    const refresh = function refresh() {
      const query = tagKey(input.value.trim().replace(/^#/, ''));
      const candidates = allTags().filter(function free(item) { return !findPinned(item.tag) && (!query || tagKey(item.tag).includes(query)); }).slice(0, 6);
      list.replaceChildren(...candidates.map(function option(item, index) {
        const node = el('button', 'tab-create-option');
        node.type = 'button';
        node.id = 'tab-create-option-' + index;
        node.setAttribute('role', 'option');
        node.dataset.tag = item.tag;
        node.append(icon('hash'), el('span', 'tab-create-option-name', item.tag), el('span', 'tab-create-option-count', String(item.count)));
        node.addEventListener('pointerdown', function keepFocus(event) { event.preventDefault(); });
        node.addEventListener('click', function choose() { if (pin(item.tag)) closeCreate(); });
        return node;
      }));
      input.setAttribute('aria-expanded', String(candidates.length > 0));
      highlight(query && candidates.length ? 0 : -1);
    };
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function keys(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = active >= 0 ? options()[active] : null, name = chosen ? chosen.dataset.tag : input.value.trim();
        if (name && pin(name)) closeCreate();
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCreate(); if (more && more.isConnected) more.focus({ preventScroll: true }); }
    });
    refresh();
    place(panel, more);
    input.focus({ preventScroll: true });
    window.setTimeout(function listen() { document.addEventListener('pointerdown', outsideCreate, true); }, 0);
  }

  /** @brief 点到新建面板外面时取消。 @param {PointerEvent} event 按下。 */
  function outsideCreate(event) { if (panel && !panel.contains(event.target)) closeCreate(); }

  /** 收起新建页签的面板。 */
  function closeCreate() {
    document.removeEventListener('pointerdown', outsideCreate, true);
    if (panel) panel.remove();
    panel = null;
  }

  /**
   * @brief 浮层放在按钮下方、右边对齐，限制在视口内；浮层随字号缩放，坐标除以缩放倍数再写入。
   * @param {HTMLElement} node 浮层。 @param {HTMLElement} anchor 按钮。
   */
  function place(node, anchor) {
    const zoom = parseFloat(window.getComputedStyle(node).zoom) || 1, view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const box = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : { left: view.width / 2, right: view.width / 2, bottom: 80 };
    const size = node.getBoundingClientRect(), margin = 8;
    const left = Math.max(margin, Math.min(box.right - size.width, view.width - size.width - margin));
    const top = Math.max(margin, Math.min(box.bottom + 4, view.height - size.height - margin));
    node.style.left = left / zoom + 'px';
    node.style.top = top / zoom + 'px';
  }

  /* ==================== 改名与拖动排序 ==================== */

  /**
   * @brief 双击标签页签原地改名：页签换成一个输入框，Enter 或点到别处确认，Esc 取消；所有记录上的这个标签一起改
   * （与「管理 #标签」的重命名相同，和已有标签同名时合并）。收起的页签打开「管理 #标签」。
   * @param {string} tag 标签。
   */
  function startRename(tag) {
    const node = nav && Array.from(nav.querySelectorAll('.tab.is-tag-tab')).find(function same(item) { return item.dataset.tab === tabOf(tag); });
    if (!node || node.hidden) { manageTag(tag); return; }
    const input = el('input', 'tab-rename-input');
    input.type = 'text';
    input.value = tag;
    input.size = Math.max(2, Array.from(tag).length + 1);
    input.setAttribute('aria-label', '页签名称');
    node.hidden = true;
    node.before(input);
    input.focus();
    input.select();
    let done = false;
    const finish = function finish(commit) {
      if (done) return;
      done = true;
      const next = input.value.trim().replace(/^#/, '');
      if (commit && next && next !== tag && renameTagEverywhere(tag, next)) toast('标签已改名，所有记录一起更新');
      renderNotes();
    };
    input.addEventListener('input', function grow() { input.size = Math.max(2, Array.from(input.value).length + 1); });
    input.addEventListener('keydown', function keys(event) {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function leave() { finish(true); });
  }

  /**
   * @brief 按住标签页签，或最后一格菜单中收起的页签（第五次反馈）：移动 5 像素后开始拖动排序，没移动就是单击。
   * @param {PointerEvent} event 按下。
   */
  function pressTab(event) {
    const node = event.target.closest ? event.target.closest('.tab.is-tag-tab, .tab-menu .note-context-item[data-tab]') : null;
    if (!node || event.button !== 0 || !nav || press) return;
    const fromMenu = Boolean(node.closest('.tab-menu'));
    if (!fromMenu && !nav.contains(node)) return;
    press = { node: node, tag: tagOf(node.dataset.tab), x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false, index: -1, region: '', timer: 0 };
    window.addEventListener('pointermove', movePress, true);
    window.addEventListener('pointerup', endPress, true);
    window.addEventListener('pointercancel', endPress, true);
  }

  /** @return {Array<HTMLElement>} 页签栏中显示着的标签页签。 */
  function visibleTabs() { return nav ? Array.from(nav.querySelectorAll('.tab.is-tag-tab')).filter(function shown(node) { return !node.hidden; }) : []; }

  /** @return {Array<HTMLElement>} 打开着的最后一格菜单中收起的页签。 */
  function menuTabs() { return Array.from(document.querySelectorAll('.tab-menu .note-context-item[data-tab]')); }

  /**
   * @brief 指针处的插入位置（按页签栏的顺序计）：页签栏中按横向位置落在显示着的页签之间，菜单中按纵向位置落在收起的页签之间。
   * @param {number} x 横坐标。 @param {number} y 纵坐标。 @return {{index:number,region:string}} 位置与所在的区域；不在两处时 index 为 -1。
   */
  function dropAt(x, y) {
    const items = menuTabs(), list = items.length ? items[0].closest('.tab-menu') : null;
    if (list) {
      const box = list.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        let row = items.findIndex(function below(node) { const rect = node.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
        if (row < 0) row = items.length;
        return { index: visibleTabs().length + row, region: 'menu' };
      }
    }
    const bar = nav.getBoundingClientRect(), tabs = visibleTabs();
    if (y < bar.top - 8 || y > bar.bottom + 8 || x < bar.left || x > bar.right) return { index: -1, region: '' };
    let index = tabs.findIndex(function before(node) { const rect = node.getBoundingClientRect(); return x < rect.left + rect.width / 2; });
    if (index < 0) index = tabs.length;
    return { index: index, region: 'bar' };
  }

  /** @brief 画出插入线：页签栏中是竖线，菜单中是横线（小圆点在左端）。 @param {number} index 位置。 @param {string} region 区域。 */
  function paintDrop(index, region) {
    if (index < 0) { if (dropLine) dropLine.remove(); return; }
    if (!dropLine) { dropLine = el('span', 'sidebar-tab-drop'); dropLine.setAttribute('aria-hidden', 'true'); }
    if (!dropLine.isConnected) document.body.append(dropLine);
    dropLine.classList.toggle('is-horizontal', region === 'menu');
    if (region === 'menu') {
      const items = menuTabs(), row = index - visibleTabs().length, box = items[Math.min(row, items.length - 1)].getBoundingClientRect();
      dropLine.style.left = box.left + 'px';
      dropLine.style.top = (row < items.length ? box.top : box.bottom) + 'px';
      dropLine.style.width = box.width + 'px';
      dropLine.style.height = '';
      return;
    }
    const tabs = visibleTabs(), anchor = tabs.length ? tabs[Math.min(index, tabs.length - 1)].getBoundingClientRect() : more.getBoundingClientRect();
    dropLine.style.left = (tabs.length && index >= tabs.length ? anchor.right : anchor.left) + 'px';
    dropLine.style.top = anchor.top + 'px';
    dropLine.style.width = '';
    dropLine.style.height = anchor.height + 'px';
  }

  /**
   * @brief 拖动中：插入线落在页签栏或菜单中；放回原处不显示。拖到最后一格上停 0.6 秒展开菜单（与拖动卡片相同），可以放进收起的页签之间。
   * @param {PointerEvent} event 移动。
   */
  function movePress(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.active) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
      press.active = true;
      press.node.classList.add('is-drag-source');
      document.body.classList.add('is-dragging-tab');
    }
    event.preventDefault();
    const box = more && more.isConnected ? more.getBoundingClientRect() : null;
    const overMore = Boolean(box) && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (overMore && !menuTabs().length && !press.timer) press.timer = window.setTimeout(function expand() { if (press && press.active) openMenu({ dragging: true }); if (press) press.timer = 0; }, 600);
    else if (!overMore && press.timer) { window.clearTimeout(press.timer); press.timer = 0; }
    const at = dropAt(event.clientX, event.clientY), from = pinnedTags().findIndex(function same(item) { return tagKey(item) === tagKey(press.tag); });
    press.index = at.index < 0 || at.index === from || at.index === from + 1 ? -1 : at.index;
    press.region = at.region;
    paintDrop(press.index, press.region);
  }

  /** @brief 松开：排到插入线处并保存，放进菜单时菜单留着显示新的顺序；没拖动就是单击。 @param {PointerEvent} event 松开或取消。 */
  function endPress(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    window.removeEventListener('pointermove', movePress, true);
    window.removeEventListener('pointerup', endPress, true);
    window.removeEventListener('pointercancel', endPress, true);
    const done = press;
    press = null;
    window.clearTimeout(done.timer);
    if (dropLine) dropLine.remove();
    if (!done.active) return;
    done.node.classList.remove('is-drag-source');
    document.body.classList.remove('is-dragging-tab');
    suppressClick = true;
    window.setTimeout(function release() { suppressClick = false; }, 0);
    if (event.type !== 'pointerup' || done.index < 0) return;
    const list = pinnedTags().slice(), from = list.findIndex(function same(item) { return tagKey(item) === tagKey(done.tag); });
    if (from < 0) return;
    let to = done.index;
    if (to > from) to -= 1;
    list.splice(from, 1);
    list.splice(to, 0, done.tag);
    if (menuTabs().length && window.NoteMenus) window.NoteMenus.close({ restoreFocus: false });
    if (!savePinned(list)) return;
    renderNotes();
    if (done.region === 'menu') openMenu({ dragging: true });
  }

  /* ==================== 新建卡片带上页签的标签 ==================== */

  /** 新建卡片的工具栏：在标签页签中显示「#标签 ×」，保存时写进标签行；点 × 这条记录不带，换页签后恢复。 */
  function syncComposerTag() {
    const composer = elements.sidebarComposer, tools = composer ? composer.querySelector('.composer-tools') : null;
    const tag = draftTag();
    if (!tagOf(ui.tab)) skipTag = '';
    if (!tools || !tag) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = el('span', 'composer-tab-tag');
      const remove = button('不带这个标签', '', 'x', 'icon-button');
      remove.addEventListener('click', function skip(event) { event.preventDefault(); event.stopPropagation(); skipTag = tagOf(ui.tab); syncComposerTag(); });
      chip.append(el('span', 'composer-tab-tag-name'), remove);
    }
    chip.querySelector('.composer-tab-tag-name').textContent = '#' + tag;
    if (chip.parentElement !== tools) tools.append(chip);
  }

  /** @return {string} 新建记录要带上的页签标签；不在标签页签或已经去掉时为空。 */
  function draftTag() {
    const tag = tagOf(ui.tab);
    return tag && !(skipTag && tagKey(skipTag) === tagKey(tag)) ? tag : '';
  }

  /** @return {string} 新建卡片上去掉了的当前页签的标签（保存后提示「放回」，第五次反馈）；没有去掉时为空。 */
  function skippedTag() {
    const tag = tagOf(ui.tab);
    return tag && skipTag && tagKey(skipTag) === tagKey(tag) ? tag : '';
  }

  /** 保存新建记录之后恢复默认（下一条照常带上页签的标签）。 */
  function resetDraftTag() { skipTag = ''; syncComposerTag(); }

  /* ==================== 事件 ==================== */

  /** 安装一次：拖动排序、双击改名、右键菜单、尺寸变化时重排。 */
  function install() {
    if (installed) return;
    const target = document.querySelector('.sidebar-tabs');
    if (!target) return;
    installed = true;
    target.addEventListener('pointerdown', pressTab);
    // 菜单中收起的页签也可以拖动（菜单挂在 body 下）；拖动松开后的那次单击不切换页签，也不触发菜单项。
    document.addEventListener('pointerdown', function pressMenuTab(event) { if (event.target.closest && event.target.closest('.tab-menu .note-context-item[data-tab]')) pressTab(event); });
    document.addEventListener('click', function swallow(event) { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    target.addEventListener('dblclick', function rename(event) { const node = event.target.closest('.tab.is-tag-tab'); if (node) { event.preventDefault(); startRename(tagOf(node.dataset.tab)); } });
    target.addEventListener('contextmenu', function contextMenu(event) { const node = event.target.closest('.tab.is-tag-tab'); if (node) openTabMenu(tagOf(node.dataset.tab), event, false); });
    if (window.ResizeObserver) { observer = new ResizeObserver(function resized() { layout(); }); observer.observe(target.parentElement || target); }
    window.addEventListener('sidenotes:settings-changed', function settingsChanged() { window.requestAnimationFrame(layout); });
  }

  return Object.freeze({ tagOf: tagOf, tabOf: tabOf, pinnedTags: pinnedTags, pinnedTagOf: pinnedTagOf, findPinned: findPinned, allTags: allTags, order: order, name: name, homeOf: homeOf, exists: exists, belongs: belongs, label: label, select: select, pin: pin, unpin: unpin, render: render, layout: layout, openMenu: openMenu, draftTag: draftTag, skippedTag: skippedTag, resetDraftTag: resetDraftTag });
})();
