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

  /** @brief 创建可聚焦的字段说明提示。 @param {string} title 名称。 @param {string} description 说明。 @return {HTMLElement} 提示容器。 */
  function help(title, description) {
    const node = el('span', 'settings-help');
    const trigger = el('button', 'settings-help-button', '?');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', title + '说明');
    trigger.setAttribute('aria-expanded', 'false');
    const message = el('span', 'settings-help-text', description);
    message.id = 'setting-help-' + createId();
    message.setAttribute('role', 'tooltip');
    message.hidden = true;
    trigger.setAttribute('aria-describedby', message.id);
    /** @brief 显示或收起说明。 @param {boolean} shown 是否显示。 */
    function show(shown) {
      message.hidden = !shown;
      trigger.setAttribute('aria-expanded', String(shown));
      if (!shown) return;
      message.style.transform = '';
      const panel = node.closest('.settings-panel');
      if (!panel) return;
      const bounds = panel.getBoundingClientRect();
      message.style.maxWidth = Math.max(100, bounds.width - 16) + 'px';
      const rect = message.getBoundingClientRect();
      const offset = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
      if (offset) message.style.transform = 'translateX(' + offset + 'px)';
    }
    trigger.addEventListener('click', function showHelp() { show(true); });
    trigger.addEventListener('focus', function focusHelp() { show(true); });
    trigger.addEventListener('blur', function blurHelp() { show(false); });
    node.addEventListener('mouseenter', function hoverHelp() { show(true); });
    node.addEventListener('mouseleave', function leaveHelp() { if (document.activeElement !== trigger) show(false); });
    trigger.addEventListener('keydown', function closeHelp(event) { if (event.key === 'Escape' && !message.hidden) { event.preventDefault(); event.stopPropagation(); show(false); } });
    node.append(trigger, message);
    return node;
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

  /** @brief 创建设置下拉框。 @param {string} label 名称。 @param {Array} options 选项。 @param {*} value 当前值。 @param {Function} changed 保存动作。 @return {HTMLSelectElement} 控件。 */
  function select(label, options, value, changed) {
    const node = el('select', 'form-control');
    node.setAttribute('aria-label', label);
    options.forEach(function addOption(item) {
      const option = el('option', '', item[1]);
      option.value = String(item[0]);
      option.selected = String(item[0]) === String(value);
      node.append(option);
    });
    node.addEventListener('change', function selectChanged() {
      if (changed(node.value) === false) node.value = String(value);
      else value = node.value;
    });
    return node;
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
    value.title = '输入 ' + minimum + '–' + maximum + '，步进 ' + step;
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
    const control = group ? group.querySelector('input[type="range"]') : target.closest('input[type="number"]');
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

  /** @brief 创建图标式外部链接按钮。 @param {string} label 文字。 @param {string} url 地址。 @param {string} glyph 图标。 @param {string} description 说明。 @return {HTMLElement} 链接。 */
  function externalLink(label, url, glyph = '↗', description = '') {
    const node = el('a', 'resource-link settings-external-link');
    node.href = url;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
    node.title = description || label;
    const symbol = el('span', 'resource-icon', glyph);
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
    root.style.setProperty('--app-zoom', String((settings.fontSize || 16) / 13));
    root.style.setProperty('--sidebar-width', settings.width + 'px');
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
   * @brief 图标格：单选按钮，图标铺满格子；名称用工具提示显示，格子本身不写字。
   * @param {string} label 名称。 @param {string} src 图片地址。 @param {boolean} selected 是否选中。 @param {Function} run 选用动作。
   * @return {HTMLButtonElement} 图标格。
   */
  function iconChoice(label, src, selected, run) {
    const node = el('button', 'icon-choice' + (selected ? ' selected' : ''));
    node.type = 'button';
    node.setAttribute('role', 'radio');
    node.setAttribute('aria-checked', String(selected));
    node.setAttribute('aria-label', label);
    node.dataset.tooltip = label;
    node.tabIndex = selected ? 0 : -1;
    const image = el('img');
    image.src = src;
    image.alt = '';
    image.draggable = false;
    node.append(image);
    node.addEventListener('click', run);
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
      add.dataset.tooltip = '上传图片';
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
    trigger.title = '更换或移除';
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
    mini.append(el('span', 'mini-head'), el('span', 'mini-tab'), el('span', 'mini-card is-active'), el('span', 'mini-card'));
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
      node.prepend(preview);
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
      node.prepend(preview);
      choices.append(node);
    });
    radioKeyboard(choices, '主题');
    materials.append(row('主题', '', choices));
    // 应用图标排在主题之后（components.md 7.2）。
    const appIcons = el('div', 'settings-option-block');
    appIcons.append(row('应用图标', '', appIconPicker()));
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
    const list = el('div', 'font-combobox-list');
    list.id = 'settings-font-options';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '字体候选');
    list.hidden = true;
    const feedback = el('div', 'font-combobox-status');
    feedback.setAttribute('aria-live', 'polite');
    let activeIndex = -1;
    let choices = [];

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
    picker.append(field, list, feedback);
    return picker;
  }

  /** @brief 创建交互分类末尾的加载与整理紧凑配置。 @return {HTMLElement} 设置卡。 */
  function runtimeSettings() {
    const card = group('其它');
    card.classList.add('settings-wide', 'settings-runtime-card');
    const grid = el('div', 'settings-runtime-row');

    const loading = el('div', 'settings-runtime-field');
    const loadingName = el('div', 'settings-runtime-name', '列表加载');
    loadingName.title = '滚动到列表底部时按批追加记录，每批可设置 5 至 100 条。';
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
    loadingToggle.title = '滚动按需加载';
    const loadingValue = el('label', 'settings-runtime-value');
    loadingValue.append(count, el('span', 'settings-runtime-suffix', '条/批'));
    loadingControls.append(loadingToggle, loadingValue);
    loading.append(loadingName, loadingControls);

    const tidy = el('div', 'settings-runtime-field');
    const tidyName = el('div', 'settings-runtime-name', '整理提醒');
    tidyName.append(help('整理提醒', '工作区记录超过阈值时在列表上方提醒整理，只提醒，不会自动归档或删除；关闭后不再提示。'));
    const tidyControls = el('div', 'settings-runtime-controls');
    let previousLimit = state.settings.tidyLimit || 50;
    const threshold = input('工作区整理提醒阈值', String(state.settings.tidyLimit || previousLimit), function limit(value) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > 100000) { toast('请输入 1 至 100000 的整数'); return false; }
      if (!save({ tidyLimit: number })) return false;
      previousLimit = number;
      return true;
    });
    threshold.type = 'number'; threshold.min = '1'; threshold.max = '100000'; threshold.disabled = !state.settings.tidyLimit;
    const tidyToggle = toggle('启用工作区整理提醒', state.settings.tidyLimit > 0, function reminders(value) {
      const next = value ? previousLimit : 0;
      if (!save({ tidyLimit: next })) return false;
      threshold.disabled = !value;
      threshold.value = String(previousLimit);
      return true;
    });
    tidyToggle.title = '启用工作区整理提醒';
    const tidyValue = el('label', 'settings-runtime-value');
    tidyValue.append(threshold, el('span', 'settings-runtime-suffix', '条'));
    tidyControls.append(tidyToggle, tidyValue);
    tidy.append(tidyName, tidyControls);

    grid.append(loading, tidy);
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
    fontRow.append(row('字体', '默认跟随主题；选了具体字体时替换界面与正文的字体，标题与代码的字体仍跟随主题。', fontPicker()), row('字号', '', range('字号', 'fontSize', 12, 20, 1, ' px')));
    typography.append(fontRow, el('div', 'settings-font-preview', '随手记录。 The quick brown fox · 0123456789'));
    layout.append(typography);

    const behavior = group('侧栏');
    behavior.classList.add('settings-wide');
    const fields = el('div', 'sidebar-settings-layout');
    const primary = el('div', 'sidebar-settings-primary');
    primary.append(
      row('显示位置', '', select('触发边缘', [['right', '屏幕右侧'], ['left', '屏幕左侧']], state.settings.edge, function edge(value) { return save({ edge: value }); })),
      row('移出后收起', '', select('移出后收起', [[300, '300 毫秒'], [600, '600 毫秒'], [1000, '1 秒']], state.settings.hideDelay, function delay(value) { return save({ hideDelay: Number(value) }); })),
      row('编辑时保持展开', '', toggle('编辑时保持展开', state.settings.protectEditing, function protect(value) { return save({ protectEditing: value }); }))
    );
    const widthRow = row('宽度', '按 13px 字号计；窗口实际宽度是「宽度 × 字号 ÷ 13」。也可以拖动侧栏朝屏幕内侧的边调整，按 4px 取整。', range('侧栏宽度', 'width', 360, 720, 4, ' px'));
    widthRow.classList.add('sidebar-width-row');
    fields.append(primary, widthRow);
    behavior.append(fields);
    layout.append(behavior);
    layout.append(runtimeSettings());

    panel.append(layout);
  }

  /** @brief 分栏呈现记录与浏览快捷键，动作和按键左右对齐。 @param {HTMLElement} panel 设置容器。 */
  function renderShortcuts(panel) {
    const layout = el('div', 'settings-dashboard shortcuts-dashboard');
    const editing = group('记录');
    const browse = group('浏览');
    editing.classList.add('shortcut-section');
    browse.classList.add('shortcut-section');
    const actions = el('div', 'shortcut-grid');
    const navigation = el('div', 'shortcut-grid');
    // 全局快捷键带说明适用范围的问号：桌面端在任何程序中生效，浏览器原型只在页面获得焦点时生效（模拟）。
    const globalScope = '全局快捷键：桌面端注册为系统热键，在任何程序中生效；浏览器原型中只在页面获得焦点时生效。';
    [['新建记录', 'Ctrl + N', ''], ['呼出速记', 'Ctrl + Shift + Space', globalScope], ['保存并退出编辑', 'Ctrl + Enter', '']].forEach(function entry(item) { actions.append(row(item[0], item[2], el('kbd', '', item[1]))); });
    [['搜索记录与标签', 'Ctrl + F', ''], ['呼出侧栏', 'Alt + Shift + S', globalScope], ['打开设置', 'Ctrl + ,', '']].forEach(function entry(item) { navigation.append(row(item[0], item[2], el('kbd', '', item[1]))); });
    editing.append(actions);
    browse.append(navigation);
    layout.append(editing, browse);
    panel.append(layout, el('p', 'settings-notice', '所列快捷键固定生效，无需额外配置；中文选词期间不触发。'));
  }

  /* ==================== 数据目录与同步 ==================== */

  /** @brief 获取桌面版目标数据路径。 @return {string} 路径。 */
  function dataDirectory() {
    const settings = state.settings;
    if (settings.storageLocation === 'custom') return settings.customDirectory || '尚未指定自定义目录';
    return settings.storageLocation === 'portable' ? '.\\data\\SideNotes（安装目录）' : '%APPDATA%\\SideNotes';
  }

  /** @brief 选择可访问目录并保存目标配置。 */
  async function chooseDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      toast('当前浏览器不支持目录选择，请直接填写目标目录；记录仍保存在浏览器中');
      const field = document.querySelector('[aria-label="自定义数据目录"]');
      if (field) field.focus();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      if (save({ storageLocation: 'custom', customDirectory: handle.name + '（已选择；浏览器不提供完整路径）' })) {
        renderPanel();
        toast('已记录目标目录，原型不会迁移浏览器数据');
      }
    } catch (error) {
      if (error.name !== 'AbortError') toast('目录访问被拒绝，可手动填写目标目录', null, true);
    }
  }

  /** @brief 复制目录路径，受限时选中路径文本。 */
  async function openDirectory() {
    const path = dataDirectory();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('剪贴板不可用');
      await navigator.clipboard.writeText(path);
      toast('浏览器不能打开系统文件夹，目标路径已复制');
    } catch (error) {
      const pathNode = document.querySelector('.settings-path');
      if (pathNode) {
        const range = document.createRange();
        range.selectNodeContents(pathNode);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      toast('浏览器不能打开系统文件夹，路径已选中，可按 Ctrl + C 复制');
    }
  }

  /** @brief 校验同步配置。 @return {string} 错误或空串。 */
  function cloudValidation() {
    const cloud = state.settings.cloud;
    if (!cloud.enabled) return '请先启用自动备份演示';
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
    target.textContent = !value.enabled ? '未启用 · 云服务连接模拟' : value.busy ? '正在写入本地模拟备份…' : value.lastError ? '备份失败：' + value.lastError : value.lastBackup ? '模拟备份快照：' + fullTime(value.lastBackup) + ' · 未上传云端' : '已启用模拟 · 等待备份';
  }

  /** @brief 用户主动申请系统通知权限。 */
  async function enableNotifications() {
    if (!('Notification' in window)) { toast('当前浏览器不支持系统通知'); return; }
    try {
      const permission = await Notification.requestPermission();
      toast(permission === 'granted' ? '已允许备份失败系统通知' : '通知未开启，失败时仍会在首页提示');
      renderPanel();
    } catch (error) { toast('系统通知请求受限，失败时仍会在首页提示'); }
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
    if (!state.settings.cloud.enabled) { if (options.manual) toast('请先启用自动备份演示'); return false; }
    if(hasUnsavedEdit()&&options.manual)toast('本次备份包含已保存记录，当前编辑确认后再备份');
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
      if (options.manual) toast('本地模拟快照已更新，未上传云端');
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

  /** @brief 渲染数据目录、备份和同步配置。 @param {HTMLElement} panel 容器。 */
  function renderData(panel) {
    panel.append(el('p', 'settings-notice', '网页原型：数据与模拟备份保存在当前浏览器。以下目录为桌面版配置预览；云服务尚未连接，不会上传数据。'));
    const dashboard=el('div','settings-dashboard data-dashboard');panel.append(dashboard);
    const directory = group('数据目录');directory.classList.add('settings-wide');
    directory.append(row('存储位置', '', select('数据存储位置', [['appdata', '应用数据目录（AppData）'], ['portable', '安装目录（便携模式）'], ['custom', '自定义目录']], state.settings.storageLocation, function storageChanged(value) { if (!save({ storageLocation: value })) return false; renderPanel(); return true; })));
    if (state.settings.storageLocation === 'custom') {
      const custom = el('div', 'settings-inline');
      custom.append(input('自定义数据目录', state.settings.customDirectory, function customDirectoryChanged(value) { if (!save({ customDirectory: value.slice(0, 500) })) return false; const path = document.querySelector('.settings-path'); if (path) path.textContent = dataDirectory(); return true; }, '例如 D:\\SideNotes'), action('选择目录', chooseDirectory, 'folder'));
      directory.append(custom);
    }
    const path = el('div', 'settings-inline current-directory');
    const output = el('code', 'settings-path directory-field', dataDirectory());
    output.setAttribute('aria-label', '当前目标数据目录');
    path.append(output, action('打开目录', openDirectory, 'folder', 'icon-button'));
    directory.append(path);
    dashboard.append(directory);
    const cloud = group('云端自动备份');cloud.classList.add('settings-wide');
    const backupToggle = toggle('启用云端自动备份演示', state.settings.cloud.enabled, function cloudEnabled(value) { if (!saveCloud({ enabled: value })) return false; renderPanel(); if (value) dataChanged(); else { window.clearTimeout(backupTimer); publishStatus(); } return true; });
    const backupRow = el('div', 'settings-row setting-row settings-inline-toggle');
    const backupCopy = el('div', 'settings-row-info setting-copy');
    backupCopy.append(el('span', 'settings-row-label setting-label', '自动备份'), help('自动备份', '本地保存后生成备份快照，当前为连接模拟。'));
    const backupControl = el('div', 'settings-control');
    backupControl.append(backupToggle);
    backupRow.append(backupCopy, backupControl);
    cloud.append(backupRow);
    const providers = el('div', 'sync-provider-grid');
    [['synology', '群晖 NAS', 'WebDAV'], ['google', 'Google Drive', 'OAuth'], ['onedrive', 'OneDrive', 'Microsoft']].forEach(function providerOption(item) {
      const choice = action('', function changeProvider() { if (saveCloud({ provider: item[0], lastError: '', lastBackup: 0 })) renderPanel(); }, '', 'sync-provider' + (state.settings.cloud.provider === item[0] ? ' active selected' : ''));
      choice.dataset.provider = item[0];
      choice.setAttribute('aria-label', item[1] + '，' + item[2]);
      choice.setAttribute('aria-pressed', String(state.settings.cloud.provider === item[0]));
      choice.append(providerMark(item[0]), el('span', 'sync-provider-name', item[1]), el('small', '', item[2]));
      providers.append(choice);
    });
    cloud.append(providers);
    if (state.settings.cloud.provider === 'synology') cloud.append(row('WebDAV 地址', '', input('NAS WebDAV 地址', state.settings.cloud.endpoint, function endpointChanged(value) { return saveCloud({ endpoint: value.slice(0, 500) }); }, 'https://nas.example.com:5006')));
    const cloudFields=el('div','settings-field-grid');
    cloudFields.append(row('账户', '', input('同步账户标识', state.settings.cloud.account, function accountChanged(value) { return saveCloud({ account: value.slice(0, 120) }); }, state.settings.cloud.provider === 'synology' ? 'NAS 用户名' : '账户邮箱')));
    cloudFields.append(row('远程文件夹', '', input('云端备份文件夹', state.settings.cloud.folder, function folderChanged(value) { return saveCloud({ folder: value.slice(0, 240) }); }, 'SideNotes')));
    cloud.append(cloudFields);
    const statusNode = el('p', 'settings-status sync-status');
    statusNode.dataset.cloudStatus = 'true';
    describeCloudStatus(statusNode);
    cloud.append(statusNode);
    const actions = el('div', 'settings-actions data-actions');
    actions.append(action('云端备份', function manualCloudBackup() { backupNow({ manual: true }); }, 'cloud'));
    if (window.PrototypeFlags && window.PrototypeFlags.demo === true) {
      actions.append(action('测试连接模拟', function testCloud() {
        const error = cloudValidation();
        if (error) { toast(error, null, true); return; }
        if (state.settings.cloud.simulationFailure) { toast('模拟连接失败，关闭故障开关后可重试', null, true); return; }
        toast('模拟配置校验通过；未连接真实云服务');
      }, 'check'));
      cloud.append(row('模拟备份失败', '', toggle('模拟备份失败', state.settings.cloud.simulationFailure, function simulationChanged(value) { return saveCloud({ simulationFailure: value }); })));
    }
    cloud.append(actions);
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    cloud.append(row('备份失败系统通知', permission === 'granted' ? '已允许；仅在备份失败时提醒。' : permission === 'denied' ? '浏览器已阻止；可在站点权限中调整。' : '经你允许后，备份失败时发送系统通知。', action(permission === 'granted' ? '已开启' : '开启通知', enableNotifications, 'bell')));
    dashboard.append(cloud);
    const backup = group('导入与导出');backup.classList.add('settings-wide');
    const localActions = el('div', 'settings-actions data-actions');
    localActions.append(button('导出备份', 'export-data', 'download', 'button secondary compact'), button('导入备份', 'import-data', 'upload', 'button secondary compact'));
    backup.append(localActions);
    if (ui.storageError) backup.append(el('p', 'settings-notice is-error', '本地存储受限，请先导出备份。'), button('重试本地保存', 'retry-storage', 'restore', 'button secondary compact'));
    dashboard.prepend(backup);
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
    confirmTrash('永久删除', '永久删除这 ' + notes.length + ' 条记录及其附件？此操作无法撤销。', '永久删除', function deleteConfirmed() {
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

  /** @brief 创建可输入自定义天数的紧凑预设组合框。 @param {Function} changed 保存后刷新结果。 @return {HTMLElement} 保留策略控件。 */
  function retentionPicker(changed) {
    const wrapper = el('div', 'trash-retention-control');
    const control = el('input', 'trash-retention-days');
    control.type = 'number';
    control.min = '1';
    control.max = '365';
    control.step = '1';
    control.value = String(state.settings.trashDays);
    control.title = '保留 1–365 天';
    control.setAttribute('aria-label', '回收站保留天数');
    const menu = el('div', 'trash-retention-options');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '保留天数预设');
    menu.id = 'trash-retention-options-' + createId();
    menu.hidden = true;
    let skipBlur = false;

    /** 收起预设列表。 */
    function closeMenu() { menu.hidden = true; expand.setAttribute('aria-expanded', 'false'); }

    /** @brief 验证并提交自定义保留天数。 @return {boolean} 是否保存成功。 */
    function commit() {
      const raw = control.value;
      const before = state.settings.trashDays;
      const days = boundedNumber(raw, 1, 365);
      if (days === null) { control.value = String(state.settings.trashDays); toast('请输入 1 至 365 的保留天数', null, true); return false; }
      if (days !== state.settings.trashDays && !save({ trashDays: days })) { control.value = String(state.settings.trashDays); return false; }
      control.value = String(state.settings.trashDays);
      syncSelection();
      if (before !== days && changed) changed();
      if (days !== Number(raw)) toast('保留天数已调整为 ' + days + ' 天（1–365 天）');
      return true;
    }

    const expand = action('选择预设天数', function toggleDays() { const opened = menu.hidden; menu.hidden = !opened; expand.setAttribute('aria-expanded', String(opened)); }, 'chevron-down', 'icon-button trash-retention-toggle');
    expand.setAttribute('aria-label', '选择保留天数预设');
    expand.setAttribute('aria-expanded', 'false');
    expand.setAttribute('aria-controls', menu.id);
    expand.addEventListener('mousedown', function keepValue(event) { event.preventDefault(); });
    /** 同步预设选中标记。 */
    function syncSelection() { menu.querySelectorAll('[data-days]').forEach(function selectPreset(node) { node.setAttribute('aria-selected', String(Number(node.dataset.days) === state.settings.trashDays)); }); }

    [7, 30, 60, 90, 180, 365].forEach(function preset(days) {
      const option = action(days + ' 天', function chooseDays() { if (save({ trashDays: days })) { control.value = String(days); syncSelection(); closeMenu(); if (changed) changed(); control.focus(); } }, '', 'trash-retention-option');
      option.dataset.days = String(days);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(days === state.settings.trashDays));
      option.addEventListener('mousedown', function keepInput(event) { event.preventDefault(); });
      menu.append(option);
    });
    const custom = action('自定义…', function customDays() { closeMenu(); control.focus(); control.select(); }, '', 'trash-retention-option');
    custom.setAttribute('role', 'option');
    custom.addEventListener('mousedown', function keepInput(event) { event.preventDefault(); });
    menu.append(custom);
    control.addEventListener('blur', function commitDays() { if (skipBlur) skipBlur = false; else commit(); });
    control.addEventListener('keydown', function editDays(event) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter') commit();
      else control.value = String(state.settings.trashDays);
      closeMenu();
      skipBlur = true;
      control.blur();
    });
    wrapper.addEventListener('keydown', function closePreset(event) { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); closeMenu(); control.focus(); } });
    wrapper.addEventListener('focusout', function leavePreset(event) { if (!wrapper.contains(event.relatedTarget)) closeMenu(); });
    wrapper.append(control, el('span', 'trash-retention-unit', '天'), expand, menu);
    return wrapper;
  }

  /** @brief 渲染独立回收站及快速筛选。 @param {HTMLElement} panel 容器。 */
  function renderTrash(panel) {
    const all = state.notes.filter(function trashed(note) { return note.status === 'trash'; }).sort(function newestDeleted(a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
    const retention = el('div', 'trash-retention-inline');
    const label = el('span', 'trash-retention-label', '保留');
    const days = retentionPicker(function retainedDaysChanged() { renderList(); });
    retention.append(label, days, help('保留策略', '默认 30 天；到期后提示清理，确认前仍可恢复。'));
    const query = el('input', 'form-control');
    query.type = 'search';
    query.placeholder = '搜索回收站';
    query.value = trashQuery;
    query.setAttribute('aria-label', '搜索回收站');
    const tagOptions = [...new Set(all.flatMap(tags))].sort(function sortTags(a, b) { return a.localeCompare(b, 'zh-CN'); });
    if (trashTag && !tagOptions.includes(trashTag)) trashTag = '';
    const toolbar = el('div', 'settings-trash-toolbar settings-search-row');
    const filter = select('回收站标签筛选', [['', '全部标签'], ...tagOptions.map(function tagOption(tag) { return [tag, '#' + tag]; })], trashTag, function filterTag(value) { trashTag = value; renderList(); return true; });
    const view = select('回收站到期筛选', [['all', '全部'], ['expired', '已到期']], trashView, function filterExpiry(value) { trashView = value; renderList(); return true; });
    toolbar.append(query, filter, view);
    panel.append(toolbar);
    const bulk = el('div', 'trash-toolbar settings-inline');
    const summary = el('span', 'settings-trash-summary setting-description');
    const restore = action('恢复筛选结果', function restoreFiltered() { restoreNotes(filtered()); }, 'restore');
    const clean = action('清理到期项', function deleteExpired() { const overdue = all.filter(expired); if (overdue.length) confirmDelete(overdue, panel); }, 'trash');
    clean.disabled = !all.some(expired);
    // 条数之后紧跟保留天数，右边是「恢复筛选结果」「清理到期项」（本次提出：此前在页面标题右侧）。
    bulk.append(summary, retention, restore, clean);
    panel.append(bulk);
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
      if (!visible.length) { list.append(el('div', 'empty-state', all.length ? '没有匹配的记录' : '回收站为空')); return; }
      visible.forEach(function trashCard(note) {
        const card = el('article', 'settings-trash-item trash-card');
        const main = el('div', 'trash-item-main');
        main.append(el('h4', 'trash-title', note.text.split('\n').find(function nonEmpty(line) { return line.trim(); }) || '图片记录'));
        const meta = el('p', 'trash-item-meta', '删除于 ' + fullTime(note.deletedAt || note.updatedAt) + (expired(note) ? ' · 已到期' : ''));
        main.append(meta);
        const chips = el('div', 'trash-tags');
        tags(note).slice(0, 4).forEach(function tagChip(tag) { chips.append(el('span', 'trash-tag', '#' + tag)); });
        main.append(chips);
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

  /** @brief 渲染版本、项目入口与开源致谢。 @param {HTMLElement} panel 容器。 */
  function renderAbout(panel) {
    const hero = el('div', 'about-hero settings-about-logo');
    const logo = el('img');
    logo.src = window.SideNotesAppIcons.resolve(state.settings.appIcon).src;
    logo.alt = '';
    hero.append(logo, el('h3', '', 'SideNotes'), el('span', 'settings-version', '交互原型 0.5.0'), el('p', 'setting-description', '本地速记 · 置顶取用 · 用后归档'));
    panel.append(hero);
    const project = group('项目');
    const addresses = el('div', 'resource-links about-links settings-about-links');
    addresses.append(externalLink('GitHub', 'https://github.com/', '⌘', '项目地址占位：GitHub 首页'), externalLink('官方网站', 'https://example.com/', '🌐', '官网地址占位：example.com'));
    const sponsor = action('支持项目', function showSponsor() {
      const previous = project.querySelector('.sponsor-note');
      if (previous) { previous.remove(); return; }
      project.append(el('p', 'setting-description sponsor-note', '赞助入口暂未开放，也欢迎通过反馈与代码贡献支持项目。'));
    }, '', 'resource-link sponsor-button');
    const heart = el('span', 'resource-icon', '♡');
    heart.setAttribute('aria-hidden', 'true');
    sponsor.prepend(heart);
    addresses.append(sponsor, action('检查更新', function checkAboutUpdate() { checkForUpdates(); }, 'restore', 'resource-link settings-update-button'));
    project.append(addresses);
    panel.append(project);
    const credits = group('开源致谢');
    credits.append(el('p', 'setting-description', '感谢开源项目与社区的支持。'));
    const list = el('div', 'resource-links settings-credits');
    [['Tauri', 'https://tauri.app/', '◈', '桌面与跨平台运行时'], ['React', 'https://react.dev/', '⚛', '界面方案参考'], ['Vite', 'https://vite.dev/', 'ϟ', '开发与构建工具'], ['SQLite', 'https://sqlite.org/', '▱', '本地数据方案参考'], ['Filee', 'https://github.com/KnifeLemon/Filee', '▣', '桌面外观与交互参考']].forEach(function credit(item) {
      list.append(externalLink(item[0], item[1], item[2], item[3]));
    });
    credits.append(list);
    panel.append(credits);
    // 调试只有一个按钮（本次提出）：桌面端打开侧栏窗口的开发者工具，浏览器原型中提示按 F12。
    const debug = group('调试');
    debug.append(action('打开开发者工具', function openDevtools() { toast('浏览器原型请按 F12 打开开发者工具'); }, 'code'));
    panel.append(debug);
  }

  /** 渲染当前设置分类。 */
  function renderPanel() {
    if (!activeDialog || !activeDialog.modal.isConnected) return;
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
    activeDialog = openModal('设置', 'settings-modal');
    initializeWheel(activeDialog.modal);
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

  return { open: open, apply: apply, openTrash: openTrash, dataChanged: dataChanged, backupNow: backupNow, status: status };
})();
