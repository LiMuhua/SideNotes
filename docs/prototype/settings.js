'use strict';

/**
 * @brief SideNotes 设置、回收站及备份演示控制器。
 * @details 目录配置和云服务为交互演示；记录及备份快照保存在当前浏览器。
 * @date 2026-10-20
 * @author LiMuhua
 */
window.SideNotesSettings = (function createSettingsController() {
  /* ==================== 私有状态与基础控件 ==================== */
  const BACKUP_KEY = 'sidenotes.prototype.cloud-backup.v2';
  const FONTS_KEY = 'sidenotes.prototype.fonts.v3';
  const SECTIONS = [
    ['appearance', '外观与交互', 'sun'], ['shortcuts', '快捷键', 'keyboard'],
    ['data', '数据与同步', 'cloud'], ['trash', '回收站', 'trash'], ['about', '关于', 'info']
  ];
  const PROVIDERS = { synology: '群晖 NAS', google: 'Google Drive', onedrive: 'OneDrive' };
  /** 字体候选：「跟随主题」在最前（默认，写出当前主题的字体），「系统默认」在最后，中间是常用字体与五套主题用到的字体。 */
  const FOLLOW_THEME = '跟随主题';
  const SYSTEM_FONT = '系统默认';
  const FONTS = ['Maple Mono NF CN', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI Variable Text', 'Segoe UI', 'SimSun', 'KaiTi', 'Georgia', 'Inter', 'Archivo', 'Cascadia Mono', 'Consolas', 'Noto Sans CJK SC'];
  let currentSection = 'appearance';
  let activeDialog = null;
  let backupTimer = 0;
  let backingUp = false;
  let internalWrite = false;
  let notifiedError = '';
  let installedFonts = [];
  let trashQuery = '';
  let trashTag = '';
  let trashView = 'all';
  let fontsRead = false;
  let fontsReading = false;
  let recording = ''; // 正在录入快捷键的命令。
  let recorder = null; // 录入期间的按键监听。
  let heldKeys = ''; // 录入时正按住的修饰键。
  let activeLocation = ''; // 当前实际使用的存储位置：改了存储位置之后，确认迁移前仍是原来的目录。
  try {
    const cached = JSON.parse(localStorage.getItem(FONTS_KEY) || 'null');
    if (cached && Array.isArray(cached.families)) {
      installedFonts = [...new Set(cached.families.filter(function validFont(value) { return typeof value === 'string' && value.trim() && value.length < 121; }))].slice(0, 4000);
      fontsRead = installedFonts.length > 0;
    }
  } catch (error) { /* 字体缓存异常时继续使用常见字体。 */ }

  /** @brief 创建本地处理按钮。 @param {string} text 文字。 @param {Function} run 动作。 @param {string} glyph 图标。 @param {string} style 样式。 @return {HTMLButtonElement} 按钮。 */
  function action(text, run, glyph = '', style = 'button secondary compact') {
    const node = button(text, '', glyph, style);
    node.addEventListener('click', run);
    return node;
  }

  /** @brief 创建备份服务自身的品牌标识。 @param {string} provider 服务标识。 @return {SVGElement} SVG 图标。 */
  function providerMark(provider) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sync-provider-mark');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('viewBox', provider === 'google' ? '0 0 87.3 78' : '0 0 24 24');
    const marks = {
      synology: '<path fill="#4468ff" d="M3 4h10.2L21 8.8v4.1L11 8H3z"/><path fill="#1e3f9e" d="M21 20H10.8L3 15.2v-4.1l10 4.9h8z"/><path fill="#8097ff" d="M3 8h8l8 4.8H11z"/>',
      google: '<path fill="#0066da" d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.3 9.3 0 000 53h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"/><path fill="#00832d" d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/><path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/><path fill="#ffba00" d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"/>',
      onedrive: '<defs><linearGradient id="onedrive-mark-gradient" x1="4" y1="19" x2="20" y2="5" gradientUnits="userSpaceOnUse"><stop stop-color="#0364b8"/><stop offset="1" stop-color="#28a8ea"/></linearGradient></defs><path fill="url(#onedrive-mark-gradient)" d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A6 6 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/><path fill="#fff" fill-opacity=".24" d="M7.1 16.6h10.3c1.45 0 2.6-1.08 2.6-2.45 0-1.3-1.06-2.37-2.39-2.44a3.73 3.73 0 00-7.12-1.48 3.03 3.03 0 00-3.39 3.02c0 1.53 1.23 2.75 2.78 2.75z"/>'
    };
    svg.innerHTML = marks[provider] || '';
    return svg;
  }

  /**
   * @brief 问号说明：悬停、键盘聚焦或点击问号时显示，移开、失焦或按 Esc 后消失。
   * @details 说明挂在 body 下的浮层中（layer.js），不被设置页裁剪或遮挡；内容只写客观的操作说明。
   * @param {string} title 名称。 @param {string} description 说明。 @return {HTMLElement} 问号。
   */
  function help(title, description) {
    const node = el('span', 'settings-help');
    const trigger = el('button', 'settings-help-button', '?');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', title + '说明');
    trigger.setAttribute('aria-expanded', 'false');
    const message = el('div', 'settings-help-text floating-panel settings-floating', description);
    message.id = 'setting-help-' + createId();
    message.setAttribute('role', 'tooltip');
    let close = null;
    /** @brief 显示或收起说明。 @param {boolean} shown 是否显示。 */
    function show(shown) {
      trigger.setAttribute('aria-expanded', String(shown));
      if (shown && !close) {
        close = window.SideNotesLayer.open(message, trigger, { placement: 'bottom-start' });
        trigger.setAttribute('aria-describedby', message.id);
      } else if (!shown && close) {
        close();
        close = null;
        trigger.removeAttribute('aria-describedby');
      }
    }
    trigger.addEventListener('click', function showHelp() { show(true); });
    trigger.addEventListener('focus', function focusHelp() { show(true); });
    trigger.addEventListener('blur', function blurHelp() { show(false); });
    node.addEventListener('mouseenter', function hoverHelp() { show(true); });
    node.addEventListener('mouseleave', function leaveHelp() { if (document.activeElement !== trigger) show(false); });
    trigger.addEventListener('keydown', function closeHelp(event) { if (event.key === 'Escape' && close) { event.preventDefault(); event.stopPropagation(); show(false); } });
    node.append(trigger);
    return node;
  }

  /** 收起设置窗口的全部浮层：重绘分类或关闭设置窗口时调用。 */
  function closeFloating() {
    document.querySelectorAll('.floating-layer > .settings-floating').forEach(function removeFloating(node) { node.remove(); });
  }

  /** @brief 创建统一标签与控件轨道的设置行。 @param {string} title 名称。 @param {string} description 说明。 @param {HTMLElement} control 控件。 @return {HTMLElement} 设置行。 */
  function row(title, description, control) {
    const node = el('div', 'settings-row setting-row setting-field');
    const copy = el('div', 'settings-row-info setting-copy');
    const label = el('span', 'settings-row-label setting-label', title);
    copy.append(label);
    if (description) copy.append(help(title, description));
    const wrapper = el('div', 'settings-control');
    wrapper.append(control);
    node.append(copy, wrapper);
    return node;
  }

  /** @brief 创建带标题的设置卡。 @param {string} title 标题。 @param {string} description 说明。 @return {HTMLElement} 设置卡。 */
  function group(title, description = '') {
    const node = el('section', 'settings-group settings-card settings-section');
    if (title) {
      const heading = el('h4', 'settings-group-title settings-section-title', title);
      if (description) heading.append(help(title, description));
      node.append(heading);
    }
    return node;
  }

  /**
   * @brief 下拉框（Playground 的 Select）：按钮写出当前项与箭头，列表挂在浮层中。
   * @details 点击或按 ↓、↑、Enter、空格展开；展开后方向键与 Home、End 移动，Enter 或空格选用，Esc 收起（不关闭设置窗口）。
   * @param {string} label 名称。 @param {Array} options [取值, 文字]。 @param {*} value 当前值。 @param {Function} changed 选用后保存，返回 false 时还原。
   * @return {HTMLButtonElement} 下拉框。
   */
  function select(label, options, value, changed) {
    const node = el('button', 'select-box');
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-haspopup', 'listbox');
    node.setAttribute('aria-expanded', 'false');
    const text = el('span', 'select-box-value');
    node.append(text, icon('chevron-down'));
    let current = String(value), close = null, list = null, active = -1;

    /** 写出当前项。 */
    function sync() {
      const item = options.find(function same(option) { return String(option[0]) === current; });
      text.textContent = item ? item[1] : '';
      node.value = current;
    }

    /** @brief 高亮列表中的一项。 @param {number} index 位置。 */
    function highlight(index) {
      if (!list) return;
      const rows = Array.from(list.children);
      active = Math.max(0, Math.min(rows.length - 1, index));
      rows.forEach(function mark(row, position) { row.classList.toggle('is-active', position === active); });
      if (rows[active]) { node.setAttribute('aria-activedescendant', rows[active].id); rows[active].scrollIntoView({ block: 'nearest' }); }
    }

    /** @brief 收起列表。 @param {boolean} focus 是否把焦点还给按钮。 */
    function collapse(focus) {
      if (close) { close(); close = null; }
      list = null;
      active = -1;
      node.setAttribute('aria-expanded', 'false');
      node.removeAttribute('aria-activedescendant');
      if (focus) node.focus();
    }

    /** @brief 选用一项并保存。 @param {string} next 取值。 */
    function choose(next) {
      collapse(true);
      if (next === current) return;
      const previous = current;
      current = next;
      sync();
      if (changed(next) === false) { current = previous; sync(); }
    }

    /** 展开列表：与按钮同宽，放不下时翻到上方。 */
    function expand() {
      list = el('div', 'select-box-list floating-panel settings-floating');
      list.id = 'select-list-' + createId();
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      options.forEach(function option(item, index) {
        const selected = String(item[0]) === current;
        const row = el('div', 'select-box-option' + (selected ? ' is-selected' : ''));
        row.id = list.id + '-' + index;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(selected));
        row.append(el('span', 'select-box-check'), el('span', 'select-box-label', item[1]));
        if (selected) row.firstChild.append(icon('check'));
        row.addEventListener('mousedown', function keepFocus(event) { event.preventDefault(); });
        row.addEventListener('mouseenter', function hoverOption() { highlight(index); });
        row.addEventListener('click', function pickOption() { choose(String(item[0])); });
        list.append(row);
      });
      close = window.SideNotesLayer.open(list, node, { placement: 'bottom-start', offset: 4, matchWidth: true, scroll: true });
      node.setAttribute('aria-expanded', 'true');
      node.setAttribute('aria-controls', list.id);
      highlight(Math.max(0, options.findIndex(function selectedOption(item) { return String(item[0]) === current; })));
    }

    node.addEventListener('click', function toggleList() { if (close) collapse(false); else expand(); });
    node.addEventListener('blur', function leaveSelect() { collapse(false); });
    node.addEventListener('keydown', function selectKeyboard(event) {
      const opened = Boolean(close);
      if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); collapse(true); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!opened) expand(); else highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); }
      else if ((event.key === 'Home' || event.key === 'End') && opened) { event.preventDefault(); highlight(event.key === 'Home' ? 0 : options.length - 1); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (opened && options[active]) choose(String(options[active][0])); else expand(); }
      else if (event.key === 'Tab' && opened) collapse(false);
    });
    sync();
    return node;
  }

  /**
   * @brief 组合框（Playground 的 Combobox）：直接输入数值，也可以从列表中选常用值；回车或失焦提交，Esc 还原，滚轮按步长调整。
   * @param {object} config label 名称、value 当前值、options [取值, 文字]、min、max、step、unit 单位、commit(number) 保存，返回 false 时还原。
   * @return {HTMLElement} 组合框与单位。
   */
  function combobox(config) {
    const wrapper = el('span', 'settings-combobox-wrap');
    const field = el('span', 'settings-combobox');
    const control = el('input', 'settings-combobox-input');
    control.type = 'number';
    control.min = String(config.min);
    control.max = String(config.max);
    control.step = String(config.wheelStep || config.step || 1);
    control.value = String(config.value);
    control.setAttribute('role', 'combobox');
    control.setAttribute('aria-label', config.label);
    control.setAttribute('aria-expanded', 'false');
    const toggle = el('button', 'settings-combobox-toggle');
    toggle.type = 'button';
    toggle.tabIndex = -1;
    toggle.setAttribute('aria-label', config.label + '常用值');
    toggle.append(icon('chevron-down'));
    let saved = config.value, close = null, skipBlur = false;

    /** 收起常用值列表。 */
    function collapse() {
      if (close) { close(); close = null; }
      control.setAttribute('aria-expanded', 'false');
    }

    /** @brief 校验并保存输入，越界时就近校正。 @return {boolean} 是否保存。 */
    function commit() {
      const next = boundedNumber(control.value, config.min, config.max, config.step || 1);
      if (next === null) { control.value = String(saved); toast('请输入 ' + config.min + ' 至 ' + config.max + ' 的数值', null, true); return false; }
      if (next !== saved && config.commit(next) === false) { control.value = String(saved); return false; }
      if (next !== Number(control.value)) toast('已调整为 ' + next + ' ' + config.unit);
      saved = next;
      control.value = String(next);
      return true;
    }

    /** 展开常用值列表。 */
    function expand() {
      const list = el('div', 'select-box-list floating-panel settings-floating');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', config.label + '常用值');
      config.options.forEach(function option(item) {
        const selected = Number(item[0]) === saved;
        const row = el('div', 'select-box-option' + (selected ? ' is-selected' : ''));
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(selected));
        row.append(el('span', 'select-box-check'), el('span', 'select-box-label', item[1]));
        if (selected) row.firstChild.append(icon('check'));
        row.addEventListener('mousedown', function keepFocus(event) { event.preventDefault(); });
        row.addEventListener('click', function pickOption() { control.value = String(item[0]); collapse(); commit(); control.focus(); });
        list.append(row);
      });
      close = window.SideNotesLayer.open(list, field, { placement: 'bottom-start', offset: 4, matchWidth: true, scroll: true });
      control.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('mousedown', function keepFocus(event) { event.preventDefault(); });
    toggle.addEventListener('click', function toggleOptions() { if (close) collapse(); else expand(); control.focus(); });
    control.addEventListener('click', function selectValue() { control.select(); });
    control.addEventListener('change', function wheelCommitted() { if (document.activeElement !== control) commit(); });
    control.addEventListener('blur', function leaveCombobox() { collapse(); if (skipBlur) skipBlur = false; else commit(); });
    control.addEventListener('keydown', function comboboxKeyboard(event) {
      if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); expand(); return; }
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && close) { collapse(); return; }
      if (event.key === 'Escape') control.value = String(saved); else commit();
      collapse();
      skipBlur = true;
      control.blur();
    });
    field.append(control, toggle);
    wrapper.append(field, el('span', 'settings-unit', config.unit));
    return wrapper;
  }

  /** @brief 创建文本设置控件。 @param {string} label 名称。 @param {string} value 当前值。 @param {Function} changed 保存动作。 @param {string} placeholder 占位文字。 @return {HTMLInputElement} 控件。 */
  function input(label, value, changed, placeholder = '') {
    const node = el('input', 'form-control');
    node.type = 'text';
    node.value = value || '';
    node.placeholder = placeholder;
    node.setAttribute('aria-label', label);
    node.addEventListener('change', function textChanged() {
      if (changed(node.value.trim()) === false) node.value = value || '';
      else value = node.value;
    });
    return node;
  }

  /** @brief 创建开关。 @param {string} label 名称。 @param {boolean} checked 当前值。 @param {Function} changed 保存动作。 @return {HTMLInputElement} 开关。 */
  function toggle(label, checked, changed) {
    const node = el('input', 'toggle settings-toggle');
    node.type = 'checkbox';
    node.checked = checked;
    node.setAttribute('aria-label', label);
    node.addEventListener('change', function toggled() {
      if (changed(node.checked) === false) node.checked = !node.checked;
    });
    return node;
  }

  /** @brief 在提交前校正数值到范围与步进。 @param {string|number} raw 输入值。 @param {number} minimum 下限。 @param {number} maximum 上限。 @param {number} step 步进。 @return {number|null} 合法值，空值或非数值返回 null。 */
  function boundedNumber(raw, minimum, maximum, step = 1) {
    if (String(raw).trim() === '') return null;
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    const snapped = minimum + Math.round((number - minimum) / step) * step;
    return Math.max(minimum, Math.min(maximum, Number(snapped.toFixed(6))));
  }

  /** @brief 创建滑动与直接输入共享边界的范围控件。 @param {string} label 名称。 @param {string} key 设置字段。 @param {number} minimum 最小值。 @param {number} maximum 最大值。 @param {number} step 步进。 @param {string} unit 单位。 @return {HTMLElement} 控件。 */
  function range(label, key, minimum, maximum, step, unit) {
    const wrapper = el('div', 'settings-range range-control');
    const control = el('input');
    control.type = 'range';
    control.min = String(minimum);
    control.max = String(maximum);
    control.step = String(step);
    control.value = String(state.settings[key]);
    control.setAttribute('aria-label', label);
    const value = el('input', 'settings-range-value');
    value.type = 'number';
    value.min = String(minimum);
    value.max = String(maximum);
    value.step = String(step);
    value.value = String(state.settings[key]);
    value.dataset.settingKey = key;
    value.setAttribute('aria-label', label + '数值');
    let skipBlur = false;
    const number = el('span', 'settings-range-number');
    number.append(value, el('span', 'settings-range-unit', unit.trim()));

    /** @brief 同步已保存的滑块与数值。 */
    function reset() {
      control.value = String(state.settings[key]);
      value.value = String(state.settings[key]);
      value.removeAttribute('aria-invalid');
    }

    /** @brief 校验手动输入并保存，越界或不符合步进时就近校正。 @return {boolean} 是否保存成功。 */
    function commit() {
      const raw = value.value;
      const next = boundedNumber(raw, minimum, maximum, step);
      if (next === null) { reset(); toast('请输入 ' + minimum + ' 至 ' + maximum + ' 的数值', null, true); return false; }
      if (next !== state.settings[key] && !save({ [key]: next })) { reset(); return false; }
      reset();
      if (next !== Number(raw)) toast('已调整为 ' + next + unit + '（' + minimum + '–' + maximum + '，步进 ' + step + '）');
      return true;
    }

    // 字号是整页缩放，松开滑块或滚轮停下后才应用，拖动途中只改显示的数值；其余滑块拖动即生效。
    const deferred = key === 'fontSize';
    control.addEventListener('input', function rangeChanged() {
      const next = boundedNumber(control.value, minimum, maximum, step);
      if (deferred) { if (next !== null) value.value = String(next); return; }
      if (next !== null && next !== state.settings[key]) save({ [key]: next });
      reset();
    });
    control.addEventListener('change', function rangeCommitted() {
      if (!deferred) return;
      const next = boundedNumber(control.value, minimum, maximum, step);
      if (next !== null && next !== state.settings[key]) save({ [key]: next });
      reset();
    });
    value.addEventListener('click', function selectValue() { value.select(); });
    value.addEventListener('blur', function saveValue() { if (skipBlur) skipBlur = false; else commit(); });
    value.addEventListener('keydown', function editValue(event) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') reset();
      else commit();
      skipBlur = true;
      value.blur();
    });
    wrapper.append(control, number);
    return wrapper;
  }

  /**
   * @brief 滚轮调整数值（本次提出，interactions.md 第九节）。
   * @details 指针停在滑块或数值框上转动滚轮：向上加、向下减，每一格一个步长，按住 Shift 为十个步长，结果限制在取值范围内。
   * 一次滚动手势只交给一个对象：手势开始时指针在控件上，由控件接管，页面不滚动；开始时在别处，整个手势都滚动页面，
   * 中途扫过滑块也不改值。停顿超过 400ms 算新的手势；触控板的小增量累计到约 30px 才算一格；禁用的控件不接管；Ctrl + 滚轮留给缩放。
   * 数值框与字号在滚轮停下 500ms 后才提交，途中只改显示的数值。
   * @param {HTMLElement} root 设置窗口。
   */
  function initializeWheel(root) {
    let owner = null;
    let lastAt = 0;
    let carry = 0;
    root.addEventListener('wheel', function adjustByWheel(event) {
      if (event.ctrlKey) return;
      const now = Date.now();
      if (now - lastAt > 400) { owner = wheelTarget(event.target); carry = 0; }
      lastAt = now;
      if (!owner || !owner.isConnected || owner.disabled) return;
      event.preventDefault();
      let steps = 0;
      if (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50) { steps = Math.sign(event.deltaY); carry = 0; }
      else { carry += event.deltaY; if (Math.abs(carry) >= 30) { steps = Math.trunc(carry / 30); carry -= steps * 30; } }
      if (steps) nudge(owner, -steps * (event.shiftKey ? 10 : 1));
    }, { passive: false });
  }

  /** @brief 滚轮的接管对象：滑块组（滑块与旁边的数值框）或独立的数值框。 @param {Element} target 指针下的元素。 @return {HTMLInputElement|null} 控件。 */
  function wheelTarget(target) {
    if (!target || !target.closest) return null;
    const group = target.closest('.settings-range');
    const control = group ? group.querySelector('input[type="range"]') : target.closest('.settings-combobox') ? target.closest('.settings-combobox').querySelector('input') : target.closest('input[type="number"]');
    return control && !control.disabled ? control : null;
  }

  /** @brief 按步长加减并限制在取值范围内。 @param {HTMLInputElement} control 控件。 @param {number} steps 步数，正数为加。 */
  function nudge(control, steps) {
    const minimum = Number(control.min), maximum = Number(control.max), step = Number(control.step) || 1;
    const current = Number(control.value);
    const next = Math.max(minimum, Math.min(maximum, (Number.isFinite(current) ? current : minimum) + steps * step));
    if (next === current) return;
    control.value = String(next);
    if (control.type === 'range') control.dispatchEvent(new Event('input', { bubbles: true }));
    window.clearTimeout(control.wheelCommit);
    control.wheelCommit = window.setTimeout(function commitWheel() { control.dispatchEvent(new Event('change', { bubbles: true })); }, 500);
  }

  /** @brief 保存设置并刷新必要状态。 @param {object} patch 设置变化。 @return {boolean} 是否成功。 */
  function save(patch) {
    const next = normalizeSettings({ ...state.settings, ...patch });
    if (!persistSnapshot(state.notes, state.draft, next)) {
      toast('设置未保存，请导出备份后重试', null, true);
      return false;
    }
    apply();
    window.dispatchEvent(new CustomEvent('sidenotes:settings-changed', { detail: { patch: patch, settings: next } }));
    return true;
  }

  /** @brief 保存云配置变化。 @param {object} patch 云配置。 @return {boolean} 是否成功。 */
  function saveCloud(patch) {
    return save({ cloud: { ...state.settings.cloud, ...patch } });
  }

  /** @brief 创建图标式外部链接按钮。 @param {string} label 文字。 @param {string} url 地址。 @param {string} glyph 图标。 @return {HTMLElement} 链接。 */
  function externalLink(label, url, glyph = '↗') {
    const node = el('a', 'resource-link settings-external-link');
    node.href = url;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    // 以「i:」开头的是雪碧图中的图标（项目链接），其余是文字符号（开源致谢）。
    const symbol = glyph.startsWith('i:') ? icon(glyph.slice(2)) : el('span', 'resource-icon', glyph);
    symbol.setAttribute('aria-hidden', 'true');
    node.append(symbol, el('span', '', label), icon('arrow-up-right'));
    return node;
  }

  /** @brief 格式化完整本地时间。 @param {number} timestamp 时间。 @return {string} 显示时间。 */
  function fullTime(timestamp) {
    if (!timestamp) return '尚无';
    const date = new Date(timestamp);
    const pad = function pad(value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /* ==================== 外观与交互 ==================== */

  /** @brief 应用已保存的外观及窗口配置。 */
  function apply() {
    const settings = state.settings;
    const root = document.documentElement;
    // 主题与明暗写在根节点上：令牌按 data-sn-surface 与 data-sn-theme 取值，结构样式按 data-sn-dock 等属性选择。
    window.SideNotesSurfaces.applyTo(root, settings.surface, window.SideNotesSurfaces.resolveTheme(settings.theme));
    document.body.dataset.edge = settings.edge;
    // 字体：空值跟随主题；选了具体字体时只替换界面与正文的字体，标题与代码仍跟随主题（adaptation.md 第二节）。
    const family = settings.fontFamily === '系统默认' ? '"Segoe UI", "Microsoft YaHei UI", sans-serif' : settings.fontFamily ? '"' + settings.fontFamily.replace(/["\\\r\n]/g, '') + '", "Microsoft YaHei UI", sans-serif' : '';
    ['--sn-font-ui', '--sn-font-note'].forEach(function font(name) { if (family) root.style.setProperty(name, family); else root.style.removeProperty(name); });
    // 字号是整页缩放：界面按 13px 设计，缩放到「字号 ÷ 13」倍后正文正好是所选字号（layout.md 第一节）。
    root.style.setProperty('--app-zoom', String((settings.fontSize || 12) / 13));
    root.style.setProperty('--sidebar-width', settings.width + 'px');
    // 侧栏滑出与收起的时长、卡片正文的最大高度（按 13px 字号计，随整页缩放）与通知位置。
    root.style.setProperty('--sidebar-motion', settings.animDuration + 'ms');
    root.style.setProperty('--card-max-height', settings.cardMaxHeight + 'px');
    root.dataset.snToast = settings.toastPosition;
    if (elements.sidebar) {
      elements.sidebar.style.width = 'min(' + settings.width + 'px, 100vw)';
      elements.sidebar.dataset.edge = settings.edge;
    }
    if (elements.edgeTrigger) {
      elements.edgeTrigger.style.left = settings.edge === 'left' ? '0' : 'auto';
      elements.edgeTrigger.style.right = settings.edge === 'right' ? '0' : 'auto';
    }
    const close = document.getElementById('sidebar-close');
    if (close && close.querySelector('use')) close.querySelector('use').setAttribute('href', '#i-arrow-' + settings.edge);
    const demo = document.getElementById('demo-open-sidebar');
    if (demo && demo.querySelector('use')) demo.querySelector('use').setAttribute('href', '#i-arrow-' + settings.edge);
    if (demo && demo.querySelector('span')) demo.querySelector('span').textContent = '打开侧栏';
    applyAppIcon();
    if (!dailyChecked) { dailyChecked = true; window.setTimeout(ensureDailySnapshot, 1500); }
  }

  /* ==================== 应用图标 ==================== */

  /** 可以上传的图片：浏览器与 WebView2 都能解码的常见格式，最大 10 MB（components.md 7.2）。 */
  const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/x-icon,.ico';
  const ICON_MAX_BYTES = 10 * 1024 * 1024;
  /** 裁好的图标边长；短边小于 ICON_SHARP_SIZE 的图片，在桌面与资源管理器的大图标里会发虚。 */
  const ICON_OUTPUT_SIZE = 256;
  const ICON_SHARP_SIZE = 256;
  /** 最多放大到刚好铺满时的几倍。 */
  const ICON_MAX_ZOOM = 4;
  /** 预览的三种实际尺寸：托盘、任务栏、桌面（100% 缩放）。 */
  const ICON_PREVIEW_SIZES = [16, 24, 48];

  /** 应用图标作用于网页图标与各处的品牌标记：页面左上角、侧栏标题区与速记浮窗；关于页在渲染时读取。 */
  function applyAppIcon() {
    const current = window.SideNotesAppIcons.resolve(state.settings.appIcon);
    document.querySelectorAll('img.brand-mark').forEach(function mark(node) { if (node.getAttribute('src') !== current.src) node.setAttribute('src', current.src); });
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon && favicon.getAttribute('href') !== current.src) {
      favicon.type = current.type;
      favicon.setAttribute('href', current.src);
    }
  }

  /** @brief 选用应用图标，重绘后焦点留在选中的一格。 @param {string} id 内置图标 id 或 custom。 */
  function chooseAppIcon(id) {
    if (save({ appIcon: id })) { renderPanel(); focusChecked('应用图标'); }
  }

  /**
   * @brief 图标格：单选按钮，图标铺满格子；指针停留或键盘聚焦时在上方显示大图预览（不写名称，本次提出）。
   * @param {string} label 名称。 @param {string} src 图片地址。 @param {boolean} selected 是否选中。 @param {Function} run 选用动作。
   * @return {HTMLButtonElement} 图标格。
   */
  function iconChoice(label, src, selected, run) {
    const node = el('button', 'icon-choice' + (selected ? ' selected' : ''));
    node.type = 'button';
    node.setAttribute('role', 'radio');
    node.setAttribute('aria-checked', String(selected));
    node.setAttribute('aria-label', label);
    node.tabIndex = selected ? 0 : -1;
    const image = el('img');
    image.src = src;
    image.alt = '';
    image.draggable = false;
    node.append(image);
    let closePreview = null;
    /** @brief 显示或收起大图预览。 @param {boolean} shown 是否显示。 */
    function preview(shown) {
      if (shown && !closePreview) {
        const pop = el('div', 'icon-preview-pop floating-panel settings-floating');
        pop.setAttribute('aria-hidden', 'true');
        const large = el('img');
        large.src = src;
        large.alt = '';
        pop.append(large);
        closePreview = window.SideNotesLayer.open(pop, node, { placement: 'top', offset: 8 });
      } else if (!shown && closePreview) { closePreview(); closePreview = null; }
    }
    node.addEventListener('pointerenter', function hoverIcon() { preview(true); });
    node.addEventListener('pointerleave', function leaveIcon() { preview(false); });
    node.addEventListener('focus', function focusIcon() { if (node.matches(':focus-visible')) preview(true); });
    node.addEventListener('blur', function blurIcon() { preview(false); });
    node.addEventListener('click', function chooseIcon() { preview(false); run(); });
    return node;
  }

  /**
   * @brief 应用图标设置：6 个内置图标在前，默认图标排第一，最后是自定义格；单击即换，立即生效（components.md 7.2）。
   * @details 自定义格没有图片时是虚线加号格，点击选择图片；上传后显示裁好的图片，右下角的编辑按钮打开「更换图片…」「移除」。
   * @return {HTMLElement} 图标行。
   */
  function appIconPicker() {
    const icons = window.SideNotesAppIcons;
    const current = icons.resolve(state.settings.appIcon).id;
    const custom = icons.readCustom();
    const picker = el('div', 'icon-picker');
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', '应用图标');
    icons.ICONS.forEach(function builtinIcon(item) {
      const label = item.id === icons.DEFAULT_ICON ? item.name + '（默认）' : item.name;
      picker.append(iconChoice(label, icons.source(item.id), current === item.id, function chooseBuiltin() { chooseAppIcon(item.id); }));
    });
    const input = el('input');
    input.type = 'file';
    input.accept = ICON_ACCEPT;
    input.hidden = true;
    input.addEventListener('change', function pickedIcon() {
      const file = input.files && input.files[0];
      // 清空选择，下次选同一个文件也会触发 change。
      input.value = '';
      if (file) loadIconImage(file);
    });
    if (custom) {
      const slot = el('span', 'icon-custom');
      slot.append(iconChoice('自定义图标', custom, current === icons.CUSTOM_ICON, function chooseCustom() { chooseAppIcon(icons.CUSTOM_ICON); }));
      customIconMenu(slot, input);
      picker.append(slot);
    } else {
      const add = el('button', 'icon-choice is-add');
      add.type = 'button';
      add.setAttribute('aria-label', '上传图片作为应用图标');
      add.append(icon('plus'));
      add.addEventListener('click', function chooseFile() { input.click(); });
      picker.append(add);
    }
    picker.append(input);
    radioKeyboard(picker, '应用图标');
    return picker;
  }

  /** @brief 菜单项。 @param {string} label 名称。 @param {string} glyph 图标。 @param {Function} run 动作。 @param {boolean} danger 是否为删除类操作。 @return {HTMLButtonElement} 菜单项。 */
  function iconMenuItem(label, glyph, run, danger = false) {
    const item = el('button', 'icon-edit-item' + (danger ? ' is-danger' : ''));
    item.type = 'button';
    item.tabIndex = -1;
    item.setAttribute('role', 'menuitem');
    item.append(icon(glyph), el('span', '', label));
    item.addEventListener('click', run);
    return item;
  }

  /**
   * @brief 自定义图标右下角的编辑按钮与菜单：更换图片、移除。方向键在菜单项之间移动，Esc 或焦点离开时收起。
   * @param {HTMLElement} slot 自定义格的容器。 @param {HTMLInputElement} input 选择图片的输入框。
   */
  function customIconMenu(slot, input) {
    const trigger = el('button', 'icon-edit');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', '更换或移除自定义图标');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(icon('edit'));
    const menu = el('div', 'icon-edit-menu');
    menu.id = 'icon-edit-menu-' + createId();
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '自定义图标');
    menu.hidden = true;
    trigger.setAttribute('aria-controls', menu.id);
    /** @brief 收起菜单。 @param {boolean} restore 是否把焦点还给编辑按钮。 */
    function closeMenu(restore) {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (restore) trigger.focus();
    }
    const items = [
      iconMenuItem('更换图片…', 'upload', function replaceImage() { closeMenu(false); input.click(); }),
      iconMenuItem('移除', 'trash', function removeImage() { closeMenu(false); removeCustomIcon(); }, true)
    ];
    menu.append(items[0], el('span', 'icon-edit-separator'), items[1]);
    trigger.addEventListener('click', function toggleMenu() {
      if (!menu.hidden) { closeMenu(true); return; }
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      items[0].focus();
    });
    menu.addEventListener('keydown', function menuKeyboard(event) {
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length].focus(); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1].focus(); }
      else if (event.key === 'Tab') closeMenu(false);
    });
    slot.addEventListener('focusout', function leaveMenu(event) { if (!slot.contains(event.relatedTarget)) closeMenu(false); });
    slot.append(trigger, menu);
  }

  /** 移除上传的图片：正在使用时回到默认图标；提示条可以撤销。 */
  function removeCustomIcon() {
    const icons = window.SideNotesAppIcons;
    const previous = icons.readCustom();
    const using = state.settings.appIcon === icons.CUSTOM_ICON;
    if (!icons.writeCustom('')) { toast('自定义图标未能移除，请重试', null, true); return; }
    if (using) save({ appIcon: icons.DEFAULT_ICON });
    else apply();
    renderPanel();
    const add = activeDialog && activeDialog.modal.querySelector('.icon-choice.is-add');
    if (add) add.focus();
    toast(using ? '已移除自定义图标，换回默认图标' : '已移除自定义图标', { label: '撤销', run: function undoRemove() {
      if (!icons.writeCustom(previous)) { toast('无法恢复自定义图标', null, true); return; }
      if (using) save({ appIcon: icons.CUSTOM_ICON });
      else apply();
      renderPanel();
    } });
  }

  /** @brief 读取选好的图片，成功后打开裁切弹窗；过大或读不出时提示，不做改动。 @param {File} file 图片文件。 */
  function loadIconImage(file) {
    if (file.size > ICON_MAX_BYTES) { toast('图片不能超过 10 MB', null, true); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = function loadedIcon() {
      // 没有固有尺寸的 SVG 按 512 × 512 处理。
      openIconCrop({ url: url, element: image, width: image.naturalWidth || 512, height: image.naturalHeight || 512 });
    };
    image.onerror = function brokenIcon() {
      URL.revokeObjectURL(url);
      toast('无法读取这张图片，请换一张 PNG、JPG 或 SVG 图片', null, true);
    };
    image.src = url;
  }

  /**
   * @brief 「调整应用图标」弹窗：拖动移动，滚轮以指针为中心缩放，方向键微调（Shift 移得更多），加号与减号缩放。
   * @details 视图以裁切框的边长为单位：scale 是每个图片像素占的长度，x、y 是图片左上角相对裁切框的位置。
   * 同一个视图既画大的裁切框，也画 16px 的预览，最后按同样的比例画到 256 × 256 的画布上。
   * 刚打开时图片铺满裁切框并居中；最小缩到完整显示（空出的部分透明），最大放大到铺满时的 4 倍；
   * 图片比裁切框大的方向上不留空边。打开时焦点在「使用」上，「取消」、Esc 或关闭按钮不做改动。
   * @param {{url: string, element: HTMLImageElement, width: number, height: number}} source 选好的图片。
   */
  function openIconCrop(source) {
    const width = source.width;
    const height = source.height;
    const cover = 1 / Math.min(width, height);
    const contain = 1 / Math.max(width, height);
    const maximum = cover * ICON_MAX_ZOOM;
    /** @brief 校正视图：比裁切框大的方向不留空边，比裁切框小时居中。 @param {object} next 视图。 @return {object} 校正后的视图。 */
    function clampView(next) {
      const w = width * next.scale;
      const h = height * next.scale;
      return {
        scale: next.scale,
        x: w >= 1 - 1e-9 ? Math.min(0, Math.max(1 - w, next.x)) : (1 - w) / 2,
        y: h >= 1 - 1e-9 ? Math.min(0, Math.max(1 - h, next.y)) : (1 - h) / 2
      };
    }
    let view = clampView({ scale: cover, x: (1 - width * cover) / 2, y: (1 - height * cover) / 2 });
    let rounded = true;
    let drag = null;
    let close = null;
    const images = [];
    const frames = [];
    /** @return {HTMLImageElement} 按视图摆放的图片，裁切框与各个预览各放一张。 */
    function cropImage() {
      const image = el('img');
      image.src = source.url;
      image.alt = '';
      image.draggable = false;
      images.push(image);
      return image;
    }

    const headingId = 'icon-crop-title-' + createId();
    const dialog = el('section', 'settings-confirm-dialog icon-crop-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', headingId);
    const header = el('header', 'settings-confirm-header');
    const heading = el('h3', '', '调整应用图标');
    heading.id = headingId;
    const closeButton = action('关闭', function closeCrop() { close(); }, 'x', 'icon-button');
    closeButton.setAttribute('aria-label', '关闭');
    header.append(heading, closeButton);

    const stage = el('div', 'icon-crop-stage');
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', '裁切区域：拖动移动图片，滚轮缩放，方向键微调');
    stage.append(cropImage());
    frames.push(stage);
    const zoomOut = action('缩小', function zoomOutIcon() { zoomTo(view.scale / 1.25); }, 'minus', 'icon-button');
    const zoomIn = action('放大', function zoomInIcon() { zoomTo(view.scale * 1.25); }, 'plus', 'icon-button');
    const range = el('input', 'icon-crop-range');
    range.type = 'range';
    range.min = String(contain);
    range.max = String(maximum);
    range.step = 'any';
    range.setAttribute('aria-label', '缩放');
    range.addEventListener('input', function slideZoom() { zoomTo(Number(range.value)); });
    const zoomRow = el('div', 'icon-crop-zoom');
    zoomRow.append(zoomOut, range, zoomIn);
    const main = el('div', 'icon-crop-main');
    main.append(stage, zoomRow);

    const side = el('div', 'icon-crop-side');
    side.append(el('span', 'icon-crop-caption', '托盘、任务栏与桌面'));
    ['light', 'dark'].forEach(function previewRow(tone) {
      const line = el('div', 'icon-crop-previews is-' + tone);
      line.setAttribute('aria-hidden', 'true');
      ICON_PREVIEW_SIZES.forEach(function previewSize(size) {
        const frame = el('span', 'icon-crop-preview is-' + size);
        frame.append(cropImage());
        frames.push(frame);
        line.append(frame);
      });
      side.append(line);
    });
    const roundSwitch = toggle('圆角', true, function roundedChanged(value) { rounded = value; render(); return true; });
    const roundRow = el('label', 'icon-crop-round');
    roundRow.append(el('span', '', '圆角'), roundSwitch);
    side.append(roundRow);
    const body = el('div', 'icon-crop');
    body.append(main, side);
    dialog.append(header, body);
    if (Math.min(width, height) < ICON_SHARP_SIZE) dialog.append(el('p', 'icon-crop-warning', '图片只有 ' + width + ' × ' + height + ' 像素，桌面与资源管理器中的大图标会发虚。'));

    /** @return {string} 按裁切结果画出的 256 × 256 PNG；圆角与内置图标相同，画不出时为空字符串。 */
    function renderIcon() {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_OUTPUT_SIZE;
      canvas.height = ICON_OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) return '';
      if (rounded) {
        context.beginPath();
        context.roundRect(0, 0, ICON_OUTPUT_SIZE, ICON_OUTPUT_SIZE, ICON_OUTPUT_SIZE * window.SideNotesAppIcons.CORNER_RATIO);
        context.clip();
      }
      context.imageSmoothingQuality = 'high';
      context.drawImage(source.element, view.x * ICON_OUTPUT_SIZE, view.y * ICON_OUTPUT_SIZE, width * view.scale * ICON_OUTPUT_SIZE, height * view.scale * ICON_OUTPUT_SIZE);
      try { return canvas.toDataURL('image/png'); } catch (error) { return ''; }
    }
    const footer = el('footer', 'settings-confirm-actions');
    const cancel = action('取消', function cancelCrop() { close(); });
    const use = action('使用', function useIcon() {
      const url = renderIcon();
      if (!url) { toast('无法处理这张图片，请换一张', null, true); return; }
      if (!window.SideNotesAppIcons.writeCustom(url)) { toast('浏览器存储空间不足，图标未保存', null, true); return; }
      close();
      if (save({ appIcon: window.SideNotesAppIcons.CUSTOM_ICON })) {
        renderPanel();
        focusChecked('应用图标');
        toast('已换成自定义图标');
      }
    }, '', 'button primary compact');
    footer.append(cancel, use);
    dialog.append(footer);

    /** 按视图摆放所有图片，同步滑块、缩放按钮与圆角。 */
    function render() {
      images.forEach(function place(image) {
        image.style.left = view.x * 100 + '%';
        image.style.top = view.y * 100 + '%';
        image.style.width = width * view.scale * 100 + '%';
        image.style.height = height * view.scale * 100 + '%';
      });
      frames.forEach(function corner(frame) { frame.classList.toggle('is-rounded', rounded); });
      range.value = String(view.scale);
      const focused = document.activeElement;
      zoomOut.disabled = view.scale <= contain * (1 + 1e-9);
      zoomIn.disabled = view.scale >= maximum * (1 - 1e-9);
      // 按到尽头时按钮被禁用，焦点改放到裁切框上，免得落到页面上、离开这一层。
      if ((focused === zoomOut || focused === zoomIn) && focused.disabled) stage.focus({ preventScroll: true });
    }
    /** @brief 缩放，锚点（以裁切框边长为单位）在屏幕上的位置保持不动。 @param {number} next 目标比例。 @param {number} anchorX 锚点横坐标。 @param {number} anchorY 锚点纵坐标。 */
    function zoomTo(next, anchorX = 0.5, anchorY = 0.5) {
      const scale = Math.min(maximum, Math.max(contain, next));
      const ratio = scale / view.scale;
      view = clampView({ scale: scale, x: anchorX - (anchorX - view.x) * ratio, y: anchorY - (anchorY - view.y) * ratio });
      render();
    }

    stage.addEventListener('pointerdown', function startDrag(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: view };
      stage.setPointerCapture(event.pointerId);
      stage.focus({ preventScroll: true });
    });
    stage.addEventListener('pointermove', function moveDrag(event) {
      if (!drag || drag.pointer !== event.pointerId) return;
      // 位移按裁切框在屏幕上的实际大小换算，整页缩放不影响拖动的手感。
      const rect = stage.getBoundingClientRect();
      view = clampView({ scale: drag.from.scale, x: drag.from.x + (event.clientX - drag.x) / rect.width, y: drag.from.y + (event.clientY - drag.y) / rect.height });
      render();
    });
    ['pointerup', 'pointercancel'].forEach(function endType(type) {
      stage.addEventListener(type, function endDrag(event) { if (drag && drag.pointer === event.pointerId) drag = null; });
    });
    stage.addEventListener('wheel', function wheelZoom(event) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomTo(view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    }, { passive: false });
    stage.addEventListener('keydown', function keyCrop(event) {
      const step = event.shiftKey ? 0.1 : 0.02;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        view = clampView({ scale: view.scale, x: view.x + move[0], y: view.y + move[1] });
        render();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomTo(view.scale * 1.1);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomTo(view.scale / 1.1);
      }
    });

    render();
    close = openLayer(dialog, { initialFocus: use, onClose: function releaseImage() { URL.revokeObjectURL(source.url); } });
    if (!close) URL.revokeObjectURL(source.url);
  }

  /**
   * @brief 迷你侧栏：在元素上写入主题与明暗属性，内部用那一套令牌画出面板、标题区、页签与两张卡片。
   * @param {string} surface 主题。 @param {string} theme light 或 dark。 @return {HTMLElement} 预览。
   */
  function miniSidebar(surface, theme) {
    const mini = el('span', 'mini-sidebar');
    window.SideNotesSurfaces.applyTo(mini, surface, theme);
    const panel = el('span', 'mini-panel');
    /** @brief 迷你卡片：两条线，第二条是短线或强调色线。 @param {boolean} active 是否当前卡片。 @param {string} second 第二条线的样式。 @return {HTMLElement} 卡片。 */
    function miniCard(active, second) {
      const card = el('span', 'mini-card' + (active ? ' is-active' : ''));
      card.append(el('span', 'mini-line'), el('span', 'mini-line ' + second));
      return card;
    }
    panel.append(el('span', 'mini-line is-title'), miniCard(true, 'is-short'), miniCard(false, 'is-accent'));
    mini.append(panel);
    return mini;
  }

  /**
   * @brief 单选组：方向键切换并立即生效，Home、End 到两端；重新渲染后焦点回到新选中的一项。
   * @param {HTMLElement} group 单选组。 @param {string} label 组名，用于渲染后找回同一组。
   */
  function radioKeyboard(group, label) {
    group.addEventListener('keydown', function moveRadio(event) {
      const radios = Array.from(group.querySelectorAll('[role="radio"]')), index = radios.indexOf(event.target);
      if (index < 0) return;
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % radios.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + radios.length) % radios.length : event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      radios[next].click();
      focusChecked(label);
    });
  }

  /** @brief 选择会重绘设置面板，把焦点放回单选组中选中的一项，鼠标点选后也能接着用方向键。 @param {string} label 单选组名称。 */
  function focusChecked(label) {
    const checked = document.querySelector('[role="radiogroup"][aria-label="' + label + '"] [aria-checked="true"]');
    if (checked) checked.focus();
  }

  /** @brief 明暗模式与主题：选项卡片，预览是用对应主题与明暗的令牌画出的迷你侧栏（components.md 第五节）。 @param {HTMLElement} target 容器。 */
  function themeChoices(target) {
    const surfaces = window.SideNotesSurfaces;
    const options = el('div', 'appearance-display-grid');
    const modes = el('div', 'settings-option-block');
    const themes = el('div', 'settings-choice-grid theme-grid');
    themes.setAttribute('role', 'radiogroup');
    themes.setAttribute('aria-label', '明暗模式');
    [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']].forEach(function themeChoice(item) {
      const selected = state.settings.theme === item[0];
      const node = action(item[1], function chooseTheme() { if (save({ theme: item[0] })) { renderPanel(); focusChecked('明暗模式'); } }, '', 'settings-choice theme-option' + (selected ? ' selected active' : ''));
      node.setAttribute('role', 'radio');
      node.setAttribute('aria-checked', String(selected));
      node.tabIndex = selected ? 0 : -1;
      const preview = el('span', 'theme-preview');
      preview.setAttribute('aria-hidden', 'true');
      (item[0] === 'system' ? ['light', 'dark'] : [item[0]]).forEach(function half(theme) { preview.append(miniSidebar(state.settings.surface, theme)); });
      const name = el('span', 'choice-label', item[1]);
      if (item[0] === 'system') name.append(el('span', 'choice-hint', '当前为' + (surfaces.resolveTheme('system') === 'dark' ? '深色' : '浅色')));
      node.replaceChildren(preview, name);
      themes.append(node);
    });
    radioKeyboard(themes, '明暗模式');
    modes.append(row('明暗模式', '', themes));
    const materials = el('div', 'settings-option-block');
    const choices = el('div', 'surface-choice-grid');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', '主题');
    const resolved = surfaces.resolveTheme(state.settings.theme);
    surfaces.SURFACES.forEach(function surfaceChoice(item) {
      const selected = state.settings.surface === item.id;
      const node = action(item.name, function chooseSurface() { if (save({ surface: item.id })) { renderPanel(); focusChecked('主题'); } }, '', 'surface-choice theme-option' + (selected ? ' selected active' : ''));
      node.dataset.surface = item.id;
      node.setAttribute('role', 'radio');
      node.setAttribute('aria-checked', String(selected));
      node.tabIndex = selected ? 0 : -1;
      const preview = el('span', 'theme-preview surface-preview');
      preview.setAttribute('aria-hidden', 'true');
      preview.append(miniSidebar(item.id, resolved));
      node.replaceChildren(preview, el('span', 'choice-label', item.name));
      choices.append(node);
    });
    radioKeyboard(choices, '主题');
    materials.append(row('主题', '', choices));
    // 应用图标排在主题之后（components.md 7.2）。
    const appIcons = el('div', 'settings-option-block');
    appIcons.append(row('应用图标', '标题区、速记浮窗、关于页与网页图标都换成选中的图标', appIconPicker()));
    options.append(modes, materials, appIcons);
    target.append(options);
  }

  /** @brief 读取用户主动授权的字体并缓存名称。 @param {HTMLElement} feedback 提示。 @param {Function} refresh 刷新候选。 @return {Promise<void>} 完成状态。 */
  async function enumerateFonts(feedback, refresh) {
    if (fontsReading || fontsRead) return;
    if (typeof window.queryLocalFonts !== 'function') {
      feedback.textContent = '当前浏览器不支持读取字体，可输入字体名称并回车。';
      return;
    }
    fontsReading = true;
    feedback.textContent = '正在读取系统字体…';
    refresh();
    try {
      const fonts = await window.queryLocalFonts();
      installedFonts = [...new Set(fonts.map(function fontFamily(font) { return font.family; }).filter(Boolean))].sort(function sortFonts(a, b) { return a.localeCompare(b, 'zh-CN'); });
      fontsRead = true;
      try { localStorage.setItem(FONTS_KEY, JSON.stringify({ families: installedFonts })); } catch (error) { /* 本次字体列表仍然可用。 */ }
      feedback.textContent = '已读取 ' + installedFonts.length + ' 个字体族';
    } catch (error) {
      feedback.textContent = '字体权限未开启；可重试，或输入字体名并回车。';
    } finally {
      fontsReading = false;
      refresh();
    }
  }

  /** @brief 创建全量展开并支持手动输入的字体选择框。 @return {HTMLElement} 字体组合框。 */
  /** @brief 字体候选的完整顺序：跟随主题、常用与已读取的字体、当前字体、系统默认。 @return {string[]} 候选。 */
  function fontFamilies() {
    return [FOLLOW_THEME, ...new Set([...FONTS, ...installedFonts, state.settings.fontFamily].filter(function named(family) { return family && family !== FOLLOW_THEME && family !== SYSTEM_FONT; })), SYSTEM_FONT];
  }

  function fontPicker() {
    const picker = el('div', 'font-combobox');
    const field = el('div', 'font-combobox-field');
    const control = el('input', 'form-control');
    control.type = 'text';
    control.autocomplete = 'off';
    control.value = state.settings.fontFamily || FOLLOW_THEME;
    control.placeholder = '选择或输入字体';
    control.setAttribute('aria-label', '字体');
    control.setAttribute('role', 'combobox');
    control.setAttribute('aria-autocomplete', 'list');
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', 'settings-font-options');
    const expand = action('展开字体列表', function toggleFonts() { if (list.hidden) openList(); else closeList(); control.focus(); }, 'chevron-down', 'font-combobox-toggle icon-button');
    expand.setAttribute('aria-label', '展开字体列表');
    expand.tabIndex = -1;
    expand.addEventListener('mousedown', function keepFontFocus(event) { event.preventDefault(); });
    // 候选列表挂在浮层中，不被下面的卡片遮住（layer.js）。
    const list = el('div', 'font-combobox-list floating-panel settings-floating');
    list.id = 'settings-font-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '字体候选');
    list.hidden = true;
    const feedback = el('div', 'font-combobox-status');
    feedback.setAttribute('aria-live', 'polite');
    let activeIndex = -1;
    let choices = [];
    let closeList_ = null;

    /** @brief 保存用户明确选择或输入的字体。 @param {string} family 字体。 */
    function choose(family) {
      const value = family === FOLLOW_THEME ? '' : family.trim().slice(0, 120);
      if (!save({ fontFamily: value })) return;
      control.value = value || FOLLOW_THEME;
      closeList();
      control.focus();
    }

    /** 关闭候选列表。 */
    function closeList() {
      if (closeList_) { closeList_(); closeList_ = null; }
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
      control.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    }

    /** @brief 切换键盘候选。 @param {number} index 候选位置。 */
    function activate(index) {
      activeIndex = index;
      choices.forEach(function highlightChoice(node, position) { node.classList.toggle('is-active', position === activeIndex); });
      const current = choices[activeIndex];
      if (current) { control.setAttribute('aria-activedescendant', current.id); current.scrollIntoView({ block: 'nearest' }); }
    }

    /** @brief 添加字体候选按钮。 @param {string} label 文字。 @param {Function} run 操作。 @param {string} extra 样式。 */
    function appendChoice(label, run, extra = '') {
      const option = action(label, run, '', 'font-combobox-option ' + extra);
      option.id = 'settings-font-option-' + choices.length;
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(label === control.value));
      option.classList.toggle('is-selected', label === (state.settings.fontFamily || FOLLOW_THEME));
      // 候选用各自的字体显示；「跟随主题」写出当前主题与它的界面字体。
      if (label === FOLLOW_THEME) { const surface = window.SideNotesSurfaces.spec(state.settings.surface); option.append(el('span', 'font-option-detail', surface.name + ' · ' + window.SideNotesSurfaces.THEME_FONTS[surface.id])); }
      else if (label !== SYSTEM_FONT && !extra) option.style.fontFamily = '"' + label.replace(/["\\]/g, '') + '"';
      option.addEventListener('mousedown', function retainInput(event) { event.preventDefault(); });
      list.append(option);
      choices.push(option);
    }

    /** @brief 按当前输入更新可选的自定义字体项。 */
    function renderCustomOption() {
      const previous=choices.find(function customChoice(node){return node.classList.contains('font-custom-option');});
      if(previous){previous.remove();choices=choices.filter(function retained(node){return node!==previous;});}
      activeIndex=-1;control.removeAttribute('aria-activedescendant');
      const value=control.value.trim(),families=fontFamilies();
      if(value&&value!==SYSTEM_FONT&&value!==FOLLOW_THEME&&!families.some(function exactFont(family){return family.toLocaleLowerCase()===value.toLocaleLowerCase();}))appendChoice('使用“'+value+'”',function useCustomFont(){choose(value);},'font-custom-option');
    }

    /** 刷新全量字体候选与授权入口。 */
    function renderOptions() {
      list.replaceChildren();
      choices = [];
      activeIndex = -1;
      const families = fontFamilies();
      families.forEach(function fontOption(family) { appendChoice(family, function chooseFont() { choose(family); }); });
      if (!fontsRead) {
        appendChoice(fontsReading ? '正在读取系统字体…' : '读取系统字体…', function readFonts() { enumerateFonts(feedback, renderOptions); }, 'font-permission-option');
        choices[choices.length - 1].disabled = fontsReading;
      }
      renderCustomOption();
    }

    /** 打开字体候选列表。 */
    function openList() {
      renderOptions();
      list.hidden = false;
      if (!closeList_) closeList_ = window.SideNotesLayer.open(list, field, { placement: 'bottom-start', offset: 4, matchWidth: true, scroll: true });
      control.setAttribute('aria-expanded', 'true');
    }

    control.addEventListener('focus', function focusFonts() { openList(); });
    control.addEventListener('input', function inputFonts() { if(list.hidden)openList();else renderCustomOption(); });
    control.addEventListener('keydown', function navigateFonts(event) {
      if (event.key === 'Escape') {
        // 列表已收起、也没有输入时不拦截，Esc 继续交给设置窗口关闭（与现有应用一致）。
        const current = state.settings.fontFamily || FOLLOW_THEME;
        if (list.hidden && control.value === current) return;
        event.preventDefault(); event.stopPropagation(); control.value = current; closeList();
      }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) openList();
        const next = activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
        activate((next + choices.length) % choices.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0 && choices[activeIndex]) choices[activeIndex].click();
        else choose(control.value || FOLLOW_THEME);
      }
    });
    picker.addEventListener('focusout', function leaveFonts() { window.setTimeout(function finishFontsFocus() { if (!picker.contains(document.activeElement)) { control.value = state.settings.fontFamily || FOLLOW_THEME; closeList(); } }, 0); });
    field.append(control, expand);
    picker.append(field, feedback);
    return picker;
  }

  /** @brief 创建交互分类末尾的加载与整理紧凑配置。 @return {HTMLElement} 设置卡。 */
  function runtimeSettings() {
    const card = group('其它');
    card.classList.add('settings-wide', 'settings-runtime-card');
    const grid = el('div', 'settings-runtime-row');

    const loading = el('div', 'settings-runtime-field');
    const loadingName = el('div', 'settings-runtime-name', '列表加载');
    loadingName.append(help('列表加载', '滚动到列表底部时按批加载'));
    const loadingControls = el('div', 'settings-runtime-controls');
    const count = input('每批加载记录数', String(state.settings.pageSize), function batch(value) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 5 || number > 100) { toast('每批加载 5 至 100 条'); return false; }
      return save({ pageSize: number });
    });
    count.type = 'number'; count.min = '5'; count.max = '100'; count.disabled = !state.settings.lazyLoading;
    const loadingToggle = toggle('滚动按需加载', state.settings.lazyLoading, function lazy(value) {
      if (!save({ lazyLoading: value })) return false;
      count.disabled = !value;
      return true;
    });
    const loadingValue = el('label', 'settings-runtime-value');
    loadingValue.append(count, el('span', 'settings-runtime-suffix', '条/批'));
    loadingControls.append(loadingToggle, loadingValue);
    loading.append(loadingName, loadingControls);

    const tidy = el('div', 'settings-runtime-field');
    const tidyName = el('div', 'settings-runtime-name', '整理提醒');
    tidyName.append(help('整理提醒', '记录超过这个数时提醒整理'));
    const tidyControls = el('div', 'settings-runtime-controls');
    let previousLimit = state.settings.tidyLimit || 50;
    const threshold = input('整理提醒阈值', String(state.settings.tidyLimit || previousLimit), function limit(value) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > 100000) { toast('请输入 1 至 100000 的整数'); return false; }
      if (!save({ tidyLimit: number })) return false;
      previousLimit = number;
      return true;
    });
    threshold.type = 'number'; threshold.min = '1'; threshold.max = '100000'; threshold.disabled = !state.settings.tidyLimit;
    const tidyToggle = toggle('启用整理提醒', state.settings.tidyLimit > 0, function reminders(value) {
      const next = value ? previousLimit : 0;
      if (!save({ tidyLimit: next })) return false;
      threshold.disabled = !value;
      threshold.value = String(previousLimit);
      return true;
    });
    const tidyValue = el('label', 'settings-runtime-value');
    tidyValue.append(threshold, el('span', 'settings-runtime-suffix', '条'));
    tidyControls.append(tidyToggle, tidyValue);
    tidy.append(tidyName, tidyControls);

    const toastField = el('div', 'settings-runtime-field');
    const toastControls = el('div', 'settings-runtime-controls');
    toastControls.append(select('通知弹出位置', [['top-center', '顶部正中'], ['top-right', '右上角'], ['bottom-center', '底部正中']], state.settings.toastPosition, function toastPosition(value) { return save({ toastPosition: value }); }));
    toastField.append(el('div', 'settings-runtime-name', '通知位置'), toastControls);
    // 记录窗口的标签页位置（第四次反馈）：顶部横排或左侧竖排；窗口标题栏上的按钮切换的是同一项设置。
    const tabsField = el('div', 'settings-runtime-field');
    const tabsControls = el('div', 'settings-runtime-controls');
    tabsControls.append(select('记录窗口的标签页位置', [['top', '顶部'], ['side', '左侧']], state.settings.windowTabs, function windowTabs(value) { return save({ windowTabs: value }); }));
    tabsField.append(el('div', 'settings-runtime-name', '窗口标签页'), tabsControls);
    grid.append(loading, tidy, toastField, tabsField);
    card.append(grid);
    return card;
  }

  /** @brief 相关字段共享标签与控件轨道，并在末尾提供其它交互选项。 @param {HTMLElement} panel 设置容器。 */
  function renderAppearance(panel) {
    const layout = el('div', 'settings-dashboard appearance-dashboard');
    const display = group('显示');
    display.classList.add('settings-wide', 'appearance-display');
    themeChoices(display);
    layout.append(display);

    const typography = group('文字');
    typography.classList.add('settings-wide');
    const fontRow = el('div', 'settings-field-grid settings-typography');
    // 字号 8–24、步长 0.5，默认 12（本次提出）。
    fontRow.append(row('字体', '默认跟随主题；选了具体字体时替换界面与正文的字体，标题与代码的字体仍跟随主题', fontPicker()), row('字号', '', range('字号', 'fontSize', 8, 24, 0.5, ' px')));
    const preview = el('div', 'settings-font-preview');
    ['随手记下一句话，不打断手头的工作；支持 Markdown 与 #标签。', 'The Quick Brown Fox Jumps Over the Lazy Dog.', '0123456789 · ¥$€ @#%&*?! · 2026-11-08 · -> => != <= >= === //'].forEach(function previewLine(text) { preview.append(el('p', '', text)); });
    typography.append(fontRow, preview);
    layout.append(typography);

    const behavior = group('侧栏');
    behavior.classList.add('settings-wide');
    const fields = el('div', 'sidebar-settings-layout');
    const primary = el('div', 'sidebar-settings-primary');
    primary.append(
      row('显示位置', '', select('触发边缘', [['right', '屏幕右侧'], ['left', '屏幕左侧']], state.settings.edge, function edge(value) { return save({ edge: value }); })),
      // 移出后收起：100–10000 毫秒，下拉列出常用值（与现有应用一致）。
      row('移出后收起', '', combobox({ label: '移出后收起', value: state.settings.hideDelay, options: [[300, '300'], [600, '600'], [1000, '1000']], min: 100, max: 10000, step: 1, wheelStep: 100, unit: 'ms', commit: function delay(value) { return save({ hideDelay: value }); } })),
      // 进入编辑时把卡片滚到列表顶部（本次提出，默认打开）；编辑期间侧栏一律保持展开，不再提供开关。
      row('编辑时滚到顶部', '', toggle('编辑时滚到顶部', state.settings.scrollOnEdit, function scrollOnEdit(value) { return save({ scrollOnEdit: value }); }))
    );
    const widthRow = row('宽度', '随字号等比加宽，也可拖动侧栏边缘调整', range('侧栏宽度', 'width', 360, 720, 4, ' px'));
    widthRow.classList.add('sidebar-width-row');
    const motionRow = row('出入动画', '', range('出入动画', 'animDuration', 0, 600, 20, ' ms'));
    motionRow.classList.add('sidebar-width-row');
    const heightRow = row('卡片高度', '超出的部分渐隐；点「展开全文」或把卡片拖出侧栏，在窗口中查看全文', range('卡片高度', 'cardMaxHeight', 120, 600, 10, ' px'));
    heightRow.classList.add('sidebar-width-row');
    fields.append(primary, widthRow, motionRow, heightRow);
    behavior.append(fields);
    layout.append(behavior);
    layout.append(runtimeSettings());

    panel.append(layout);
  }

  /** 快捷键的三组（同现有应用 0.7.3 与 Playground）：全局与应用内并排，格式占一整行、两列排列，末尾是不能更换的按键。 */
  const SHORTCUT_GROUPS = [
    { group: 'global', title: '全局', help: '在任何程序中都能使用' },
    { group: 'app', title: '应用内', help: '在侧栏与速记浮窗中使用' },
    { group: 'format', title: '格式', help: '只在编辑记录时生效' }
  ];

  /** 结束录入快捷键。 */
  function stopRecording() {
    if (recorder) {
      window.removeEventListener('keydown', recorder, true);
      window.removeEventListener('keyup', recorder, true);
      recorder = null;
    }
    recording = '';
    heldKeys = '';
  }

  /**
   * @brief 把命令改成新的按键：有冲突时在按键旁写出原因，按键不变，可以接着按别的组合（与现有应用一致）。
   * @param {object} command 命令。 @param {string} combo 按键。 @param {HTMLElement} message 原因的位置。 @return {boolean} 是否结束录入。
   */
  function applyShortcut(command, combo, message) {
    const keys = window.SideNotesShortcuts;
    const bindings = state.settings.shortcuts;
    if (combo === keys.bindingOf(bindings, command.id)) return true;
    const problem = keys.shortcutProblem(command.id, combo, bindings);
    if (problem) {
      if (message) { message.textContent = keys.displayCombo(combo) + '：' + problem; message.hidden = false; }
      return false;
    }
    if (save({ shortcuts: keys.withBinding(bindings, command.id, combo) })) toast('「' + command.label + '」改为 ' + keys.displayCombo(combo));
    return true;
  }

  /** @brief 一行快捷键：名称（另有固定按键时问号里写出）、改过时的「恢复默认」与按键。 @param {object} command 命令。 @return {HTMLElement} 设置行。 */
  function shortcutRow(command) {
    const keys = window.SideNotesShortcuts;
    const current = keys.bindingOf(state.settings.shortcuts, command.id);
    const note = command.alias ? '也可按 ' + keys.displayCombo(command.alias) : command.id === 'link' ? '剪贴板中是网址时直接生成链接' : '';
    const cell = el('span', 'shortcut-binding');
    const message = el('span', 'shortcut-message');
    message.hidden = true;
    message.setAttribute('role', 'status');
    const active = recording === command.id;
    const key = el('button', 'shortcut-key' + (active ? ' is-recording' : ''));
    key.type = 'button';
    key.dataset.shortcut = command.id;
    key.setAttribute('aria-pressed', String(active));
    key.setAttribute('aria-label', active ? '正在录入「' + command.label + '」的快捷键，Esc 取消' : '更换「' + command.label + '」的快捷键，当前为 ' + keys.displayCombo(current));
    const label = el('kbd', '', active ? (heldKeys ? keys.displayCombo(heldKeys) + ' + …' : '按下新快捷键') : keys.displayCombo(current));
    key.append(label);
    if (current !== command.defaultKeys && !active) {
      const reset = action('恢复默认 ' + keys.displayCombo(command.defaultKeys), function resetShortcut() {
        stopRecording();
        if (applyShortcut(command, command.defaultKeys, message)) renderPanel();
      }, 'restore', 'icon-button shortcut-reset');
      cell.append(reset);
    }
    cell.append(message, key);

    /** 开始录入：之后的按键只用来录入，不关闭设置窗口，也不触发别的快捷键。 */
    function start() {
      stopRecording();
      recording = command.id;
      renderPanel();
      const target = document.querySelector('.shortcut-key[data-shortcut="' + command.id + '"]');
      if (target) target.focus();
    }
    key.addEventListener('click', function recordShortcut() {
      if (recording === command.id) { stopRecording(); renderPanel(); focusShortcut(command.id); return; }
      start();
      recorder = function recordKeys(event) {
        if (event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        const display = document.querySelector('.shortcut-key[data-shortcut="' + command.id + '"]');
        const output = display && display.parentElement.querySelector('.shortcut-message');
        heldKeys = keys.modifiersOf(event);
        if (event.type === 'keyup') { if (display) display.firstChild.textContent = heldKeys ? keys.displayCombo(heldKeys) + ' + …' : '按下新快捷键'; return; }
        const combo = keys.comboFromEvent(event);
        if (combo === 'Escape') { stopRecording(); renderPanel(); focusShortcut(command.id); return; }
        if (!combo) { if (display) display.firstChild.textContent = heldKeys ? keys.displayCombo(heldKeys) + ' + …' : '按下新快捷键'; return; }
        if (applyShortcut(command, combo, output)) { stopRecording(); renderPanel(); focusShortcut(command.id); }
      };
      window.addEventListener('keydown', recorder, true);
      window.addEventListener('keyup', recorder, true);
    });
    key.addEventListener('blur', function cancelRecording() {
      // 焦点移走即取消录入；重绘分类时按键会被替换，不算移走。
      window.setTimeout(function afterBlur() {
        if (recording !== command.id) return;
        const target = document.querySelector('.shortcut-key[data-shortcut="' + command.id + '"]');
        if (target && document.activeElement === target) return;
        stopRecording();
        renderPanel();
      }, 0);
    });
    return row(command.label, note, cell);
  }

  /** @brief 重绘后把焦点放回同一个命令的按键。 @param {string} id 命令。 */
  function focusShortcut(id) {
    const target = document.querySelector('.shortcut-key[data-shortcut="' + id + '"]');
    if (target) target.focus();
  }

  /** @brief 快捷键页：点击按键后按下新的组合即可更换，标题右侧的「恢复默认」把全部改回默认按键。 @param {HTMLElement} panel 设置容器。 */
  function renderShortcuts(panel) {
    const keys = window.SideNotesShortcuts;
    const heading = panel.querySelector('.settings-panel-heading');
    const changed = Object.keys(state.settings.shortcuts).length > 0;
    const reset = action('恢复默认', function resetAll() {
      stopRecording();
      if (save({ shortcuts: {} })) { toast('已恢复默认快捷键'); renderPanel(); }
    }, 'restore');
    reset.disabled = !changed;
    if (heading) heading.append(reset);
    const layout = el('div', 'settings-dashboard shortcuts-dashboard');
    SHORTCUT_GROUPS.forEach(function shortcutSection(item) {
      const card = group(item.title, item.help);
      card.classList.add('shortcut-section');
      if (item.group === 'format') card.classList.add('shortcut-format', 'settings-wide');
      const grid = el('div', 'shortcut-grid');
      keys.SHORTCUT_COMMANDS.filter(function inGroup(command) { return command.group === item.group; }).forEach(function command(command) { grid.append(shortcutRow(command)); });
      if (item.group === 'format') keys.FIXED_SHORTCUTS.forEach(function fixed(fixed) { grid.append(row(fixed.label, '', el('kbd', 'shortcut-key is-fixed', fixed.display))); });
      card.append(grid);
      layout.append(card);
    });
    panel.append(layout);
  }

  /* ==================== 数据目录与同步 ==================== */

  /** 三种存储位置的示例目录（与 Playground 相同）；自定义目录写用户填的路径。 */
  const LOCATIONS = { appdata: 'C:\\Users\\用户\\AppData\\Roaming\\SideNotes', portable: 'D:\\Apps\\SideNotes\\data', custom: 'D:\\同步盘\\SideNotes' };

  /** @brief 存储位置对应的目录。 @param {string} location 存储位置。 @return {string} 路径。 */
  function locationPath(location) {
    if (location === 'custom') return state.settings.customDirectory || LOCATIONS.custom;
    return LOCATIONS[location] || LOCATIONS.appdata;
  }

  /** @brief 当前数据目录（确认迁移之前仍是原来的目录）。 @return {string} 路径。 */
  function dataDirectory() {
    return locationPath(activeLocation || state.settings.storageLocation);
  }

  /** @brief 快照目录：没有更换时是数据目录下的 snapshots。 @return {string} 路径。 */
  function snapshotDirectory() {
    return state.settings.snapshotDirectory || dataDirectory() + '\\snapshots';
  }

  /** @brief 选择目录：浏览器只给出目录名，不给完整路径。 @return {Promise<string>} 目录名，取消时为空串。 */
  async function pickDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') { toast('当前浏览器不能选择目录，请直接填写路径', null, true); return ''; }
    try { return (await window.showDirectoryPicker({ mode: 'read' })).name; }
    catch (error) { if (error.name !== 'AbortError') toast('无法访问这个目录', null, true); return ''; }
  }

  /** 选择自定义数据目录。 */
  async function chooseDirectory() {
    const name = await pickDirectory();
    if (name && save({ storageLocation: 'custom', customDirectory: name })) renderPanel();
  }

  /** @brief 复制目录路径：浏览器不能打开系统文件夹。 @param {string} path 路径。 */
  async function copyPath(path) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('剪贴板不可用');
      await navigator.clipboard.writeText(path);
      toast('已复制目录路径');
    } catch (error) { toast('无法复制目录路径', null, true); }
  }

  /** 快照的创建原因（与现有应用的 SNAPSHOT_REASON_LABELS 相同）。 */
  const SNAPSHOT_REASONS = { auto: '每天自动', manual: '手动', import: '导入前', delete: '永久删除前', migrate: '迁移前', restore: '恢复前' };
  const SNAPSHOT_KEY = 'sidenotes-prototype-snapshots';
  let dailyChecked = false;

  /** @brief 读取浏览器中保存的快照，新的在前。 @return {Array} 快照。 */
  function readSnapshots() {
    try {
      const list = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
      return (Array.isArray(list) ? list : []).filter(function valid(item) { return item && Array.isArray(item.notes) && Number(item.createdAt) > 0; }).sort(function newest(a, b) { return b.createdAt - a.createdAt; });
    } catch (error) { return []; }
  }

  /**
   * @brief 快照的保留规则（同现有应用）：24 小时内的全部保留，7 天内每天留最新一份，4 周内每周留最新一份。
   * @param {Array} list 新的在前。 @param {number} now 当前时间。 @return {Array} 保留的快照。
   */
  function pruneSnapshots(list, now) {
    const kept = [], days = new Set(), weeks = new Set();
    list.forEach(function keep(item) {
      const age = now - item.createdAt;
      if (age <= 86400000) { kept.push(item); return; }
      if (age <= 7 * 86400000) { const day = new Date(item.createdAt).toDateString(); if (!days.has(day)) { days.add(day); kept.push(item); } return; }
      if (age <= 28 * 86400000) { const week = Math.floor(item.createdAt / (7 * 86400000)); if (!weeks.has(week)) { weeks.add(week); kept.push(item); } }
    });
    return kept;
  }

  /**
   * @brief 创建快照：把全部记录另存一份到浏览器存储；空间不够时先删掉最旧的快照再试。
   * @param {string} reason 原因，见 SNAPSHOT_REASONS。 @return {string} 失败原因，成功时为空串。
   */
  function createSnapshot(reason) {
    const now = Date.now();
    let list = pruneSnapshots([{ id: createId(), reason: reason, createdAt: now, notes: state.notes }].concat(readSnapshots()), now);
    while (list.length) {
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list)); return ''; }
      catch (error) { if (list.length === 1) break; list = list.slice(0, -1); }
    }
    return '浏览器存储空间不足';
  }

  /** 每天自动创建一份快照：页面打开后检查，24 小时内没有快照时创建。 */
  function ensureDailySnapshot() {
    const latest = readSnapshots()[0];
    if (!latest || Date.now() - latest.createdAt > 86400000) createSnapshot('auto');
  }

  /** @brief 快照时间（同现有应用）：今天写「今天 10:05」，昨天写「昨天 10:05」，今年其它日子省略年份。 @param {number} timestamp 时间。 @return {string} 显示。 */
  function snapshotTime(timestamp) {
    const date = new Date(timestamp), now = new Date();
    const pad = function pad(value) { return String(value).padStart(2, '0'); };
    const time = pad(date.getHours()) + ':' + pad(date.getMinutes());
    const startOfDay = function startOfDay(value) { return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime(); };
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (days === 0) return '今天 ' + time;
    if (days === 1) return '昨天 ' + time;
    const day = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    return date.getFullYear() === now.getFullYear() ? day + ' ' + time : date.getFullYear() + '年' + day + ' ' + time;
  }

  /** @brief 字节数的显示写法。 @param {number} bytes 字节。 @return {string} 显示。 */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** @brief 附件的个数与大小：记录中的图片。 @param {Array} notes 记录。 @return {{count:number,bytes:number}} 统计。 */
  function attachmentStats(notes) {
    let count = 0, bytes = 0;
    notes.forEach(function noteImages(note) { (note.images || []).forEach(function image(item) { count += 1; bytes += Math.round(String(item.data || '').length * 0.75); }); });
    return { count: count, bytes: bytes };
  }

  /** @brief 从快照恢复：先为当前记录创建一份快照，再用快照中的记录替换。 @param {object} snapshot 快照。 */
  function restoreSnapshot(snapshot) {
    confirmTrash('从快照恢复', '用' + snapshotTime(snapshot.createdAt) + '的快照替换当前的全部记录？恢复前会先为当前记录创建一份快照。', '恢复', function restoreConfirmed() {
      const failed = createSnapshot('restore');
      if (failed) { toast('恢复前的快照未创建：' + failed, null, true); return false; }
      if (!persistSnapshot(snapshot.notes)) { toast('恢复未完成，当前记录未改动', null, true); return false; }
      if (typeof renderNotes === 'function') renderNotes({ reset: true });
      renderPanel();
      toast('已恢复到' + snapshotTime(snapshot.createdAt) + '的快照');
      return true;
    });
  }

  /** @brief 云端备份的一行：名称单独成列，取值、输入框与操作紧跟在后（Playground 的 DataRow）。 @param {string} title 名称。 @param {...HTMLElement} controls 控件。 @return {HTMLElement} 行。 */
  function dataRow(title, ...controls) {
    const node = el('div', 'data-row');
    node.append(el('span', 'settings-row-label', title));
    const cell = el('div', 'data-row-controls');
    controls.forEach(function appendControl(control) { if (control) cell.append(control); });
    node.append(cell);
    return node;
  }

  /**
   * @brief 路径：等宽小字，只占一行，放不下时末尾省略，不把别的控件挤乱（本次提出）。
   * @details 放不下时悬停显示完整路径；双击复制完整路径（双击不选中文字）。
   * @param {string} label 名称。 @param {string} path 路径。 @return {HTMLElement} 路径。
   */
  function pathText(label, path) {
    const node = el('code', 'settings-path', path);
    node.setAttribute('aria-label', label);
    node.addEventListener('mouseenter', function fullPath() {
      if (node.scrollWidth > node.clientWidth) node.title = path;
      else node.removeAttribute('title');
    });
    node.addEventListener('mousedown', function keepSelection(event) { if (event.detail > 1) event.preventDefault(); });
    node.addEventListener('dblclick', function copyFullPath(event) { event.preventDefault(); copyPath(path); });
    return node;
  }

  /** @brief 校验同步配置。 @return {string} 错误或空串。 */
  function cloudValidation() {
    const cloud = state.settings.cloud;
    if (!cloud.enabled) return '请先启用自动备份';
    if (cloud.provider === 'synology') {
      try {
        const address = new URL(cloud.endpoint);
        if (!['https:', 'http:'].includes(address.protocol)) throw new Error('协议不正确');
      } catch (error) { return '请填写有效的 NAS WebDAV 地址'; }
    }
    if (!cloud.account.trim()) return '请填写同步账户标识';
    if (!cloud.folder.trim()) return '请填写备份文件夹';
    return '';
  }

  /** @brief 向首页和设置广播同步状态。 */
  function publishStatus() {
    window.dispatchEvent(new CustomEvent('sidenotes:sync-status', { detail: status() }));
    const target = document.querySelector('.settings-status[data-cloud-status]');
    if (target) describeCloudStatus(target);
  }

  /** @brief 渲染云状态说明。 @param {HTMLElement} target 状态容器。 */
  function describeCloudStatus(target) {
    const value = status();
    target.classList.toggle('is-error', Boolean(value.lastError));
    target.classList.toggle('is-warning', value.enabled && !value.lastBackup && !value.lastError);
    target.textContent = !value.enabled ? '未启用' : value.busy ? '正在备份…' : value.lastError ? '备份失败：' + value.lastError : value.lastBackup ? '上次备份 ' + fullTime(value.lastBackup) : '已启用';
  }

  /** @brief 用户主动申请系统通知权限。 */
  async function enableNotifications() {
    if (!('Notification' in window)) { toast('当前环境不支持系统通知'); return; }
    try {
      const permission = await Notification.requestPermission();
      toast(permission === 'granted' ? '已允许备份失败系统通知' : '通知未开启，可稍后在系统设置中允许');
      renderPanel();
    } catch (error) { toast('系统通知请求受限，可稍后在系统设置中允许'); }
  }

  /** @brief 发送一次失败系统通知。 @param {string} message 失败原因。 */
  function notifyBackupFailure(message) {
    if (notifiedError === message) return;
    notifiedError = message;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('SideNotes 备份失败', { body: message, tag: 'sidenotes-backup-error', icon: 'assets/favicon.svg' }); } catch (error) { /* 首页提醒始终保留。 */ }
    }
  }

  /** @brief 执行本地云备份模拟并保留真实错误。 @param {object} options 手动执行及失败演示选项。 @return {Promise<boolean>} 是否完成模拟快照。 */
  async function backupNow(options = {}) {
    if (backingUp) { if (options.manual) toast('备份正在处理'); return false; }
    window.clearTimeout(backupTimer);
    if (!state.settings.cloud.enabled) { if (options.manual) toast('请先启用自动备份'); return false; }
    window.clearTimeout(backupTimer);
    backingUp = true;
    publishStatus();
    let failure = '';
    try {
      await new Promise(function allowStatusPaint(resolve) { window.setTimeout(resolve, 450); });
      if (!state.settings.cloud.enabled) return false;
      failure = cloudValidation();
      if (failure) throw new Error(failure);
      if (options.fail || (window.PrototypeFlags && window.PrototypeFlags.demo === true && state.settings.cloud.simulationFailure)) throw new Error('模拟连接中断，请检查同步配置后重试');
      const timestamp = Date.now();
      const snapshot = { version: 2, simulated: true, backedUpAt: timestamp, provider: state.settings.cloud.provider, notes: state.notes, draft: state.draft, settings: state.settings };
      localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
      internalWrite = true;
      const settings = normalizeSettings({ ...state.settings, cloud: { ...state.settings.cloud, lastBackup: timestamp, lastError: '' } });
      if (!persistSnapshot(state.notes, state.draft, settings)) throw new Error('快照已写入，但本地设置保存失败，请导出备份');
      notifiedError = '';
      if (options.manual) toast('备份完成');
      return true;
    } catch (error) {
      const message = error && error.name === 'QuotaExceededError' ? '浏览器存储空间不足，请导出备份或清理附件' : error.message || '备份写入失败';
      internalWrite = true;
      const settings = normalizeSettings({ ...state.settings, cloud: { ...state.settings.cloud, lastError: message } });
      if (!persistSnapshot(state.notes, state.draft, settings)) state.settings = settings;
      notifyBackupFailure(message);
      if (options.manual) toast('备份失败：' + message, null, true);
      return false;
    } finally {
      internalWrite = false;
      backingUp = false;
      publishStatus();
    }
  }

  /** @brief 在记录保存后防抖生成演示备份快照。 */
  function dataChanged() {
    if (internalWrite || !state.settings.cloud || !state.settings.cloud.enabled) return;
    window.clearTimeout(backupTimer);
    backupTimer = window.setTimeout(function backupChangedData() { backupNow(); }, 1200);
  }

  /** @brief 返回同步展示状态。 @return {object} 状态。 */
  function status() {
    const cloud = state && state.settings && state.settings.cloud || {};
    return { enabled: Boolean(cloud.enabled), provider: PROVIDERS[cloud.provider] || '云端', providerKey: cloud.provider || 'synology', busy: backingUp, lastBackup: cloud.lastBackup || 0, lastError: cloud.lastError || '', simulated: true };
  }

  /** @brief 数据与同步（同现有应用 0.7.3 与 Playground）：数据目录、快照、导入与导出、云端自动备份。 @param {HTMLElement} panel 容器。 */
  function renderData(panel) {
    const dashboard = el('div', 'settings-dashboard data-dashboard');
    panel.append(dashboard);
    if (!activeLocation) activeLocation = state.settings.storageLocation;

    // 数据目录：存储位置与附件一行；自定义目录、迁移到、当前目录各一行。
    const directory = group('数据目录');
    directory.classList.add('settings-wide');
    const first = el('div', 'settings-field-grid');
    const stats = attachmentStats(state.notes);
    const attachments = el('span', 'settings-inline-value');
    attachments.append(el('span', 'settings-value', stats.count + ' 个 · ' + formatBytes(stats.bytes)), action('立即清理', function cleanAttachments() { toast('没有未引用的附件'); }, 'trash'));
    first.append(
      row('存储位置', '', select('数据存储位置', [['appdata', '应用数据目录（AppData）'], ['portable', '安装目录（便携模式）'], ['custom', '自定义目录']], state.settings.storageLocation, function storageChanged(value) { if (!save({ storageLocation: value })) return false; renderPanel(); return true; })),
      row('附件', '不再被任何记录引用的附件会自动清理', attachments)
    );
    directory.append(first);
    if (state.settings.storageLocation === 'custom') {
      const custom = el('span', 'settings-inline-value is-grow');
      custom.append(input('自定义数据目录', state.settings.customDirectory, function customDirectoryChanged(value) { if (!save({ customDirectory: value.slice(0, 500) })) return false; renderPanel(); return true; }, '例如 D:\\SideNotes'), action('选择目录', chooseDirectory, 'folder'));
      directory.append(row('自定义目录', '', custom));
    }
    if (state.settings.storageLocation !== activeLocation) {
      const migrate = el('span', 'settings-inline-value is-grow');
      migrate.append(pathText('迁移的目标目录', locationPath(state.settings.storageLocation)), action('迁移到这里', function migrateData() {
        const failed = createSnapshot('migrate');
        if (failed) toast('迁移前的快照未创建：' + failed, null, true);
        activeLocation = state.settings.storageLocation;
        renderPanel();
        toast('已迁移到新目录，原目录保留作为备份');
      }, 'upload', 'button primary compact'));
      directory.append(row('迁移到', '数据库与附件复制到这里，之后的记录保存在这里；原目录保留作为备份', migrate));
    }
    const current = el('span', 'settings-inline-value is-grow');
    current.append(pathText('当前数据目录', dataDirectory()), action('打开目录', function openDirectory() { copyPath(dataDirectory()); }, 'folder', 'icon-button'));
    directory.append(row('当前目录', '', current));
    dashboard.append(directory);

    // 快照（布局同现有应用）：目录一行，已有快照与立即创建一行，下面是带边框的快照列表。
    const snapshots = group('快照', '每天自动创建；导入、永久删除、迁移与恢复之前也会创建');
    snapshots.classList.add('settings-wide', 'snapshot-group');
    const folder = el('span', 'settings-inline-value is-grow');
    folder.append(pathText('快照目录', snapshotDirectory()), action('打开目录', function openSnapshots() { copyPath(snapshotDirectory()); }, 'folder', 'icon-button'), action('更换', async function changeSnapshots() { const name = await pickDirectory(); if (name && save({ snapshotDirectory: name })) { renderPanel(); toast('快照目录已更换，之后的快照保存在这里'); } }, 'edit'));
    if (state.settings.snapshotDirectory) folder.append(action('恢复默认', function resetSnapshots() { if (save({ snapshotDirectory: '' })) { renderPanel(); toast('已改回数据目录下的 snapshots 文件夹'); } }, 'restore'));
    snapshots.append(row('快照目录', '放到另一块硬盘，硬盘损坏时也能找回数据', folder));
    const list = readSnapshots();
    const existing = el('span', 'settings-inline-value');
    existing.append(el('span', 'settings-value', list.length + ' 份 · 附件 ' + stats.count + ' 个，' + formatBytes(stats.bytes)), action('立即创建', function snapshotNow() { const failed = createSnapshot('manual'); if (failed) toast('快照未创建：' + failed, null, true); else { renderPanel(); toast('已创建快照'); } }, 'plus'));
    snapshots.append(row('已有快照', '保留 24 小时内的全部，7 天内每天一份，4 周内每周一份', existing));
    if (list.length) {
      const items = el('ul', 'snapshot-list');
      items.setAttribute('aria-label', '快照列表');
      list.forEach(function snapshotItem(snapshot) {
        const item = el('li', 'snapshot-item');
        const size = new Blob([JSON.stringify(snapshot.notes)]).size;
        item.append(el('span', 'snapshot-time', snapshotTime(snapshot.createdAt)), el('span', 'snapshot-reason', SNAPSHOT_REASONS[snapshot.reason] || snapshot.reason), el('span', 'snapshot-meta', snapshot.notes.length + ' 条 · ' + formatBytes(size)), action('恢复', function restoreItem() { restoreSnapshot(snapshot); }));
        items.append(item);
      });
      snapshots.append(items);
    }
    dashboard.append(snapshots);

    // 导入与导出。
    const backup = group('导入与导出');
    backup.classList.add('settings-wide');
    const localActions = el('span', 'settings-inline-value');
    localActions.append(button('导出备份', 'export-data', 'download', 'button secondary compact'), button('导入备份', 'import-data', 'upload', 'button secondary compact'));
    backup.append(row('本地备份', '导出为一个文件，含图片；导入时合并到现有记录', localActions));
    if (ui.storageError) backup.append(row('本地保存', '', button('重试本地保存', 'retry-storage', 'restore', 'button secondary compact')));
    dashboard.append(backup);

    // 云端自动备份：名称单独成列，各行的输入框对齐。
    const cloud = group('云端自动备份');
    cloud.classList.add('settings-wide');
    const rows = el('div', 'data-rows');
    rows.append(dataRow('自动备份', toggle('启用云端自动备份', state.settings.cloud.enabled, function cloudEnabled(value) { if (!saveCloud({ enabled: value })) return false; renderPanel(); if (value) dataChanged(); else { window.clearTimeout(backupTimer); publishStatus(); } return true; })));
    cloud.append(rows);
    const providers = el('div', 'sync-provider-grid');
    providers.setAttribute('role', 'group');
    providers.setAttribute('aria-label', '备份服务');
    [['synology', '群晖 NAS', 'WebDAV'], ['google', 'Google Drive', 'OAuth'], ['onedrive', 'OneDrive', 'Microsoft']].forEach(function providerOption(item) {
      const choice = action('', function changeProvider() { if (saveCloud({ provider: item[0], lastError: '', lastBackup: 0 })) renderPanel(); }, '', 'sync-provider' + (state.settings.cloud.provider === item[0] ? ' active selected' : ''));
      choice.dataset.provider = item[0];
      choice.setAttribute('aria-label', item[1] + '，' + item[2]);
      choice.setAttribute('aria-pressed', String(state.settings.cloud.provider === item[0]));
      choice.append(providerMark(item[0]), el('span', 'sync-provider-name', item[1]), el('small', '', item[2]));
      providers.append(choice);
    });
    cloud.append(providers);
    const fields = el('div', 'data-rows');
    if (state.settings.cloud.provider === 'synology') fields.append(dataRow('WebDAV 地址', input('NAS WebDAV 地址', state.settings.cloud.endpoint, function endpointChanged(value) { return saveCloud({ endpoint: value.slice(0, 500) }); }, 'https://nas.example.com:5006')));
    fields.append(dataRow('账户', input('同步账户标识', state.settings.cloud.account, function accountChanged(value) { return saveCloud({ account: value.slice(0, 120) }); }, state.settings.cloud.provider === 'synology' ? 'NAS 用户名' : '账户邮箱')));
    fields.append(dataRow('远程文件夹', input('云端备份文件夹', state.settings.cloud.folder, function folderChanged(value) { return saveCloud({ folder: value.slice(0, 240) }); }, 'SideNotes')));
    const statusNode = el('span', 'settings-value sync-status');
    statusNode.dataset.cloudStatus = 'true';
    statusNode.classList.add('settings-status');
    describeCloudStatus(statusNode);
    fields.append(dataRow('状态', statusNode, action('云端备份', function manualCloudBackup() { backupNow({ manual: true }); }, 'cloud')));
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    const notify = action(permission === 'granted' ? '已开启' : '开启通知', enableNotifications, 'bell');
    notify.disabled = permission === 'unsupported';
    fields.append(dataRow('失败通知', notify));
    if (window.PrototypeFlags && window.PrototypeFlags.demo === true) fields.append(dataRow('模拟备份失败', toggle('模拟备份失败', state.settings.cloud.simulationFailure, function simulationChanged(value) { return saveCloud({ simulationFailure: value }); })));
    cloud.append(fields);
    dashboard.append(cloud);
  }

  /* ==================== 回收站 ==================== */

  /** @brief 获取记录标签。 @param {object} note 记录。 @return {Array<string>} 标签。 */
  function tags(note) {
    if (window.NoteContent && typeof window.NoteContent.parse === 'function') {
      const parsed = window.NoteContent.parse(note.text);
      if (parsed && Array.isArray(parsed.tags)) return parsed.tags;
    }
    if (typeof getNoteTags === 'function') return getNoteTags(note);
    return [...new Set(Array.from(note.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-\/]+)/gu), function tagMatch(match) { return match[1]; }))];
  }

  /** @brief 判断记录是否超过保留天数。 @param {object} note 记录。 @return {boolean} 是否到期。 */
  function expired(note) {
    return Boolean(note.deletedAt) && Date.now() - note.deletedAt > (state.settings.trashDays || 30) * 86400000;
  }

  /**
   * @brief 在设置窗口上叠一层对话框：设置窗口暂时不可操作，Esc 或点背景关闭，Tab 只在这一层内循环。
   * @param {HTMLElement} dialog 对话框。 @param {object} options initialFocus 初始焦点，onClose 关闭时的回调。
   * @return {Function|null} 关闭函数；设置窗口没有打开或已经叠了一层时返回 null。
   */
  function openLayer(dialog, options = {}) {
    if (!activeDialog || !activeDialog.modal.isConnected) return null;
    const parent = activeDialog.modal.parentElement;
    if (!parent || parent.querySelector('.settings-confirm-backdrop')) return null;
    const previousFocus = document.activeElement;
    const overlay = el('div', 'settings-confirm-backdrop');
    let closed = false;

    /** 关闭这一层，焦点回到打开前的位置。 */
    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      activeDialog.modal.inert = false;
      activeDialog.modal.removeAttribute('aria-hidden');
      if (options.onClose) options.onClose();
      const fallback = activeDialog.modal.querySelector('.settings-panel input, .settings-nav-button.active');
      const target = previousFocus && previousFocus.isConnected ? previousFocus : fallback;
      if (target) target.focus({ preventScroll: true });
    }

    overlay.append(dialog);
    parent.append(overlay);
    activeDialog.modal.inert = true;
    activeDialog.modal.setAttribute('aria-hidden', 'true');
    overlay.addEventListener('click', function dismissBackdrop(event) { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', function layerKeyboard(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const controls = Array.from(dialog.querySelectorAll('button, input, select, textarea, [tabindex]')).filter(function focusable(node) { return !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0; });
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    if (options.initialFocus) options.initialFocus.focus({ preventScroll: true });
    return close;
  }

  /** @brief 显示保留设置上下文的回收站二次确认弹窗。 @param {string} title 标题。 @param {string} message 提示。 @param {string} confirmLabel 确认按钮。 @param {Function} run 确认动作，返回 false 时保留弹窗。 @param {boolean} danger 是否为不可恢复操作。 */
  function confirmTrash(title, message, confirmLabel, run, danger = false) {
    const dialog = el('section', 'settings-confirm-dialog');
    const headingId = 'trash-confirm-title-' + createId();
    const messageId = 'trash-confirm-message-' + createId();
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', headingId);
    dialog.setAttribute('aria-describedby', messageId);
    const header = el('header', 'settings-confirm-header');
    const heading = el('h3', '', title);
    heading.id = headingId;
    const description = el('p', 'settings-confirm-message', message);
    description.id = messageId;
    const error = el('p', 'settings-confirm-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    let close = null;
    /** 关闭确认并返回回收站原位置。 */
    function dismiss() { if (close) close(); }

    const closeButton = action('取消确认', dismiss, 'x', 'icon-button');
    closeButton.setAttribute('aria-label', '取消确认');
    header.append(heading, closeButton);
    const footer = el('footer', 'settings-confirm-actions');
    const cancel = action('取消', dismiss);
    const confirm = action(confirmLabel, function confirmOperation() {
      confirm.disabled = true;
      if (run() === false) {
        confirm.disabled = false;
        error.textContent = '操作未完成，记录仍保留，请重试。';
        error.hidden = false;
        return;
      }
      dismiss();
    }, danger ? 'trash' : 'restore', danger ? 'button danger compact' : 'button primary compact');
    footer.append(cancel, confirm);
    dialog.append(header, description, error, footer);
    close = openLayer(dialog, { initialFocus: cancel });
  }

  /** @brief 二次确认后永久删除回收站记录。 @param {Array} notes 要删除的记录。 @param {HTMLElement} panel 保留的设置容器。 */
  function confirmDelete(notes, panel) {
    if (!notes.length) return;
    confirmTrash('永久删除', '永久删除这 ' + notes.length + ' 条记录及其附件？删除前会先创建一份快照，需要时可以在「数据与同步 › 快照」中恢复。', '永久删除', function deleteConfirmed() {
      const failed = createSnapshot('delete');
      if (failed) { toast('删除前的快照未创建：' + failed, null, true); return false; }
      const ids = new Set(notes.map(function noteId(note) { return note.id; }));
      const remaining = state.notes.filter(function preserveOtherNotes(note) { return note.status !== 'trash' || !ids.has(note.id); });
      const count = state.notes.length - remaining.length;
      if (!persistSnapshot(remaining)) { toast('删除失败，请重试', null, true); return false; }
      if (typeof renderNotes === 'function') renderNotes();
      renderPanel();
      toast('已永久删除 ' + count + ' 条记录');
      return true;
    }, true);
  }

  /** @brief 二次确认后恢复一个或多个回收站记录。 @param {Array} notes 记录。 */
  function restoreNotes(notes) {
    if (!notes.length) return;
    confirmTrash('恢复记录', '将恢复这 ' + notes.length + ' 条记录至删除前的位置。', '确认恢复', function restoreConfirmed() {
      const ids = new Set(notes.map(function noteId(note) { return note.id; }));
      const restored = state.notes.map(function restoreDeleted(note) { return note.status === 'trash' && ids.has(note.id) ? { ...note, status: note.previousStatus || 'active', deletedAt: null, updatedAt: Date.now() } : note; });
      if (!persistSnapshot(restored)) { toast('恢复失败，请重试', null, true); return false; }
      if (typeof renderNotes === 'function') renderNotes();
      renderPanel();
      toast('已恢复 ' + notes.length + ' 条记录');
      return true;
    });
  }

  /** @brief 回收站（同现有应用 0.7.3 与 Playground）：搜索与筛选一行；条数之后紧跟保留天数，右边是批量操作；下面是列表。 @param {HTMLElement} panel 容器。 */
  function renderTrash(panel) {
    const all = state.notes.filter(function trashed(note) { return note.status === 'trash'; }).sort(function newestDeleted(a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
    const query = el('input', 'form-control');
    query.type = 'search';
    query.placeholder = '搜索回收站';
    query.value = trashQuery;
    query.setAttribute('aria-label', '搜索回收站');
    const tagOptions = [...new Set(all.flatMap(tags))].sort(function sortTags(a, b) { return a.localeCompare(b, 'zh-CN'); });
    if (trashTag && !tagOptions.includes(trashTag)) trashTag = '';
    const toolbar = el('div', 'settings-trash-toolbar');
    const filter = select('回收站标签筛选', [['', '全部标签'], ...tagOptions.map(function tagOption(tag) { return [tag, '#' + tag]; })], trashTag, function filterTag(value) { trashTag = value; renderList(); return true; });
    const view = select('回收站到期筛选', [['all', '全部'], ['expired', '已到期']], trashView, function filterExpiry(value) { trashView = value; renderList(); return true; });
    const search = el('label', 'settings-search');
    search.append(icon('search'), query);
    toolbar.append(search, filter, view);
    panel.append(toolbar);
    const summaryRow = el('div', 'settings-trash-summary');
    const summary = el('span', 'settings-trash-count');
    // 保留天数紧跟在条数之后（本次提出）：两者都在说回收站里的记录，放在一起读。
    const retention = el('span', 'trash-retention');
    retention.append(el('span', 'settings-row-label', '保留'), combobox({ label: '回收站保留天数', value: state.settings.trashDays, options: [7, 30, 60, 90, 180, 365].map(function preset(days) { return [days, days + ' 天']; }), min: 1, max: 365, step: 1, unit: '天', commit: function retained(days) { if (!save({ trashDays: days })) return false; renderList(); return true; } }), help('保留策略', '到期后提示清理，确认前仍可恢复'));
    const restore = action('恢复筛选结果', function restoreFiltered() { restoreNotes(filtered()); }, 'restore');
    const clean = action('清理到期项', function deleteExpired() { const overdue = all.filter(expired); if (overdue.length) confirmDelete(overdue, panel); }, 'trash');
    summaryRow.append(summary, retention, el('span', 'settings-spacer'), restore, clean);
    panel.append(summaryRow);
    const list = el('div', 'settings-trash-list');
    panel.append(list);

    /** @brief 获取搜索和标签共同筛选的记录。 @return {Array} 结果。 */
    function filtered() {
      const keyword = trashQuery.trim().toLocaleLowerCase();
      return all.filter(function matchTrash(note) {
        return (!keyword || (note.text + ' ' + (note.images || []).map(function attachmentName(image) { return image.name; }).join(' ')).toLocaleLowerCase().includes(keyword)) && (!trashTag || tags(note).includes(trashTag)) && (trashView !== 'expired' || expired(note));
      });
    }

    /** 刷新回收站搜索结果。 */
    function renderList() {
      const visible = filtered();
      list.replaceChildren();
      summary.textContent = visible.length + ' / ' + all.length + ' 条';
      restore.disabled = !visible.length;
      clean.disabled = !all.some(expired);
      if (!visible.length) { list.append(el('p', 'settings-empty', all.length ? '没有匹配的记录' : '回收站为空')); return; }
      visible.forEach(function trashCard(note) {
        const card = el('article', 'settings-trash-item');
        const main = el('div', 'trash-item-main');
        main.append(el('h4', 'trash-title', note.text.split('\n').find(function nonEmpty(line) { return line.trim(); }) || '图片记录'));
        main.append(el('p', 'trash-item-meta' + (expired(note) ? ' is-expired' : ''), '删除于 ' + fullTime(note.deletedAt || note.updatedAt) + (expired(note) ? ' · 已到期' : '')));
        const noteTags = tags(note);
        if (noteTags.length) {
          const chips = el('div', 'trash-tags');
          noteTags.slice(0, 4).forEach(function tagChip(tag) { chips.append(el('span', 'trash-tag', '#' + tag)); });
          main.append(chips);
        }
        const controls = el('div', 'trash-item-actions');
        controls.append(action('恢复记录', function restoreOne() { restoreNotes([note]); }, 'restore', 'icon-button'), action('永久删除', function deleteOne() { confirmDelete([note], panel); }, 'trash', 'icon-button'));
        card.append(main, controls);
        list.append(card);
      });
    }
    query.addEventListener('input', function queryTrash() { trashQuery = query.value; renderList(); });
    renderList();
  }

  /* ==================== 关于与设置框架 ==================== */

  /** @brief 关于：图标、名称、一句介绍与版本号；项目入口、开源致谢与调试都是小块按钮。 @param {HTMLElement} panel 容器。 */
  function renderAbout(panel) {
    const hero = el('div', 'about-hero settings-about-logo');
    const logo = el('img');
    logo.src = window.SideNotesAppIcons.resolve(state.settings.appIcon).src;
    logo.alt = '';
    const version = (window.PrototypeFlags && window.PrototypeFlags.version) || '';
    hero.append(logo, el('h3', '', 'SideNotes'), el('span', 'settings-version', '交互原型 ' + version), el('p', 'setting-description', '藏在屏幕边上的速记本'));
    panel.append(hero);
    const project = group('项目');
    const addresses = el('div', 'resource-links about-links settings-about-links');
    addresses.append(externalLink('GitHub', 'https://github.com/', 'i:code'), externalLink('官方网站', 'https://example.com/', 'i:globe'), externalLink('支持项目', 'https://github.com/sponsors', 'i:heart'));
    addresses.append(action('检查更新', function checkAboutUpdate() { checkForUpdates(); }, 'restore', 'resource-link settings-update-button'));
    project.append(addresses);
    panel.append(project);
    const credits = group('开源致谢');
    const list = el('div', 'resource-links settings-credits');
    [['Tauri', 'https://tauri.app/', '◈'], ['React', 'https://react.dev/', '⚛'], ['Vite', 'https://vite.dev/', 'ϟ'], ['SQLite', 'https://sqlite.org/', '▱'], ['Filee', 'https://github.com/KnifeLemon/Filee', '▣'], ['Maple Mono', 'https://github.com/subframe7536/maple-font', 'Aa']].forEach(function credit(item) {
      list.append(externalLink(item[0], item[1], item[2]));
    });
    credits.append(list);
    panel.append(credits);
    // 调试只有一个按钮（本次提出）：桌面端打开侧栏窗口的开发者工具，浏览器中按 F12。
    const debug = group('调试');
    debug.append(action('打开开发者工具', function openDevtools() { toast('按 F12 打开开发者工具'); }, 'code'));
    panel.append(debug);
  }

  /** 渲染当前设置分类。 */
  function renderPanel() {
    if (!activeDialog || !activeDialog.modal.isConnected) return;
    closeFloating();
    if (currentSection !== 'shortcuts') stopRecording();
    const panel = activeDialog.body.querySelector('.settings-panel');
    panel.replaceChildren();
    panel.dataset.section=currentSection;
    const section = SECTIONS.find(function activeSection(item) { return item[0] === currentSection; }) || SECTIONS[0];
    const heading = el('div', 'settings-panel-heading settings-content-header');
    heading.append(el('h3', '', section[1]));
    panel.append(heading);
    panel.setAttribute('aria-labelledby', 'settings-tab-' + currentSection);
    activeDialog.body.querySelectorAll('.settings-nav-button').forEach(function updateNav(node) {
      const active = node.dataset.section === currentSection;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', String(active));
      node.tabIndex = active ? 0 : -1;
    });
    if (currentSection === 'appearance') renderAppearance(panel);
    else if (currentSection === 'shortcuts') renderShortcuts(panel);
    else if (currentSection === 'data') renderData(panel);
    else if (currentSection === 'trash') renderTrash(panel);
    else renderAbout(panel);
    panel.scrollTop = 0;
  }

  /** @brief 打开分类式设置。 @param {string} section 初始分类。 */
  function open(section = 'appearance') {
    if (ui.editing && !flushEdit()) { toast('编辑内容尚未保存，请先导出备份', null, true); return; }
    currentSection = SECTIONS.some(function knownSection(item) { return item[0] === section; }) ? section : 'appearance';
    activeLocation = state.settings.storageLocation;
    stopRecording();
    activeDialog = openModal('设置', 'settings-modal');
    initializeWheel(activeDialog.modal);
    const close = activeDialog.modal.querySelector('.modal-header [data-action="close-modal"]');
    if (close) close.before(button('最小化', 'close-modal', 'minus', 'icon-button settings-minimize'));
    const layout = el('div', 'settings-layout');
    const nav = el('nav', 'settings-nav');
    nav.setAttribute('aria-label', '设置分类');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    SECTIONS.forEach(function addSection(item) {
      const node = action(item[1], function selectSection() { currentSection = item[0]; renderPanel(); }, item[2], 'settings-nav-button settings-nav-item');
      node.dataset.section = item[0];
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-controls', 'settings-panel');
      node.id = 'settings-tab-' + item[0];
      nav.append(node);
    });
    nav.addEventListener('keydown', function navigateSections(event) {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = SECTIONS.findIndex(function selectedSection(item) { return item[0] === currentSection; });
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length;
      currentSection = SECTIONS[next][0];
      renderPanel();
      nav.querySelector('[data-section="' + currentSection + '"]').focus();
    });
    const panel = el('div', 'settings-panel settings-content');
    panel.id = 'settings-panel';
    panel.setAttribute('role', 'tabpanel');
    layout.append(nav, panel);
    activeDialog.body.append(layout);
    activeDialog.footer.remove();
    renderPanel();
  }

  /** 打开独立回收站分类。 */
  function openTrash() { open('trash'); }

  /** @brief 搜索快捷键：回收站页打开时聚焦回收站的搜索框（本次提出）。 @return {boolean} 是否处理。 */
  function focusSearch() {
    if (!activeDialog || currentSection !== 'trash') return false;
    const search = document.querySelector('.settings-modal .settings-trash-toolbar .settings-search input');
    if (!search) return false;
    search.focus();
    search.select();
    return true;
  }

  return { open: open, apply: apply, save: save, openTrash: openTrash, focusSearch: focusSearch, dataChanged: dataChanged, backupNow: backupNow, status: status, createSnapshot: createSnapshot, closeFloating: function close() { stopRecording(); closeFloating(); } };
})();
