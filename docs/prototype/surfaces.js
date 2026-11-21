'use strict';

/**
 * @brief 五套主题的结构差异、设置迁移与根节点属性。
 * @details 颜色、字体、尺寸、材质等数值差异写在令牌文件（../design-system/tokens/*.css），原型直接引用；
 * 这里只保留令牌表达不了的 6 项结构差异，取值与 docs/design-system/playground/src/surfaces.ts 一致，
 * 由 docs/design-system/tests/prototype.test.ts 逐项比对。结构差异写到根节点的数据属性上，
 * 样式按属性选择，组件本身不区分主题。
 */
window.SideNotesSurfaces = (function createSurfaces() {
  /** 五套主题：dock 与屏幕边缘的关系，entries 记录的组织方式，tabs 页签形态，translucent 是否半透明，
   *  inlineShortcuts 是否把快捷键写在界面上，tabMarks 页签前是否有分区色点。 */
  const SURFACES = Object.freeze([
    { id: 'terminal', name: '终端', dock: 'flush', entries: 'panes', tabs: 'underline', translucent: false, inlineShortcuts: true, tabMarks: false },
    { id: 'magazine', name: '杂志', dock: 'floating', entries: 'cards', tabs: 'segmented', translucent: false, inlineShortcuts: false, tabMarks: false },
    { id: 'paper', name: '记录纸', dock: 'floating', entries: 'cards', tabs: 'underline', translucent: false, inlineShortcuts: false, tabMarks: false },
    { id: 'win11', name: 'Windows 11', dock: 'floating', entries: 'cards', tabs: 'underline', translucent: true, inlineShortcuts: false, tabMarks: false },
    { id: 'glass', name: '磨砂玻璃', dock: 'blocks', entries: 'tiles', tabs: 'segmented', translucent: true, inlineShortcuts: false, tabMarks: true }
  ].map(Object.freeze));
  const DEFAULT_SURFACE = 'terminal';
  /** 旧的「界面材质」取值：标准改为终端，记录纸、磨砂玻璃、Windows 11 沿用同名取值。 */
  const LEGACY_SURFACES = Object.freeze({ standard: 'terminal' });
  /** 设置的结构版本：3 起字体默认跟随主题，见 adaptation.md 第八节。 */
  const SETTINGS_VERSION = 3;
  /** 版本 3 之前的默认字体：原型的 Segoe UI 与现有应用的 Maple Mono NF CN，迁移时改为跟随主题。 */
  const LEGACY_DEFAULT_FONTS = Object.freeze(['Segoe UI', 'Maple Mono NF CN']);
  /** 各主题界面字体的第一项，用于字体组合框里「跟随主题」的说明。 */
  const THEME_FONTS = Object.freeze({ terminal: 'Maple Mono NF CN', magazine: 'Segoe UI Variable Text', paper: 'Archivo', win11: 'Segoe UI Variable Text', glass: 'Inter' });

  /** @brief 读取主题的结构差异。 @param {string} id 主题标识。 @return {object} 结构差异。 */
  function spec(id) {
    return SURFACES.find(function matches(item) { return item.id === id; }) || SURFACES[0];
  }

  /** @brief 迁移并校验主题取值，无法识别时回退到终端。 @param {*} value 保存的取值。 @return {string} 主题标识。 */
  function normalizeSurface(value) {
    const id = Object.prototype.hasOwnProperty.call(LEGACY_SURFACES, value) ? LEGACY_SURFACES[value] : value;
    return SURFACES.some(function known(item) { return item.id === id; }) ? id : DEFAULT_SURFACE;
  }

  /**
   * @brief 迁移字体设置：空值表示跟随主题，「系统默认」与其他字体名原样保存。
   * @details 版本 3 之前：空值是用户选的「系统默认」，保留为「系统默认」；旧默认字体（Segoe UI、Maple Mono NF CN）
   * 改为跟随主题；其余字体是用户的显式选择，保留。版本 3 起原样保留，之后再显式选择 Segoe UI 也不会被改回。
   * @param {*} value 保存的字体。 @param {number} version 保存时的设置版本。 @return {string} 字体名，空值为跟随主题。
   */
  function normalizeFontFamily(value, version) {
    const font = typeof value === 'string' ? value.trim().slice(0, 120) : '';
    if (font === '跟随主题') return '';
    if (!(Number(version) >= SETTINGS_VERSION)) {
      if (!font && typeof value === 'string') return '系统默认';
      if (LEGACY_DEFAULT_FONTS.includes(font)) return '';
    }
    return font;
  }

  /** @brief 按「跟随系统」解析当前明暗。 @param {string} theme 设置中的明暗模式。 @return {string} light 或 dark。 */
  function resolveTheme(theme) {
    if (theme === 'dark' || theme === 'light') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * @brief 把主题、明暗与结构差异写到元素上。
   * @details 令牌按 data-sn-surface 与 data-sn-theme 取值，结构样式按 data-sn-dock 等属性选择；
   * 设置页的迷你预览用同一个函数，在预览元素上写入对应主题的属性即可得到那套令牌。
   * @param {HTMLElement} node 元素。 @param {string} surface 主题。 @param {string} theme light 或 dark。
   */
  function applyTo(node, surface, theme) {
    const item = spec(normalizeSurface(surface));
    node.dataset.snSurface = item.id;
    node.dataset.snTheme = theme === 'dark' ? 'dark' : 'light';
    node.dataset.snDock = item.dock;
    node.dataset.snEntries = item.entries;
    node.dataset.snTabs = item.tabs;
    node.dataset.snTranslucent = String(item.translucent);
    node.dataset.snShortcuts = item.inlineShortcuts ? 'inline' : 'tooltip';
    node.dataset.snTabMarks = String(item.tabMarks);
  }

  return Object.freeze({ SURFACES, DEFAULT_SURFACE, SETTINGS_VERSION, THEME_FONTS, spec, normalizeSurface, normalizeFontFamily, resolveTheme, applyTo });
})();
