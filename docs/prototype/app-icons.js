'use strict';

/**
 * @brief 应用图标：内置图标的清单、图片地址与上传图片的保存（components.md 第七节）。
 * @details 清单与 src-tauri/icons/builtin/manifest.json 一致，由 docs/design-system/tests/prototype.test.ts 逐项比对。
 * 图片直接引用随应用打包的资源（../../src-tauri/icons/builtin/），原型因此要从仓库根目录起服务，或直接打开文件；
 * 默认图标用设计系统中的副本（../design-system/assets/app-icon.svg），取不到打包资源时标题区等处仍能显示。
 * 上传的图片单独保存在浏览器中，不写进设置，因此不进入导出的备份（桌面版保存在应用数据目录，见 adaptation.md 第十节）。
 */
window.SideNotesAppIcons = (function createAppIcons() {
  /** 内置图标，默认图标排第一；number 是设计稿编号，与资源目录名的前缀相同。 */
  const ICONS = Object.freeze([
    { id: 'door-smile-indigo', number: '211', name: '门缝浅笑 · 靛蓝' },
    { id: 'door-plain-indigo', number: '212', name: '门缝平视 · 靛蓝' },
    { id: 'door-smile-warm', number: '213', name: '门缝浅笑 · 暖' },
    { id: 'door-plain-warm', number: '214', name: '门缝平视 · 暖' },
    { id: 'stack-smile', number: '210', name: '一叠 · 浅笑' },
    { id: 'fan-swish', number: '172', name: '叠纸 · 一掠' }
  ].map(Object.freeze));
  const DEFAULT_ICON = 'door-smile-indigo';
  /** 设置中选用上传的图片时的取值。 */
  const CUSTOM_ICON = 'custom';
  const BUILTIN_ROOT = '../../src-tauri/icons/builtin/';
  const DEFAULT_COPY = '../design-system/assets/app-icon.svg';
  /** 上传的图片：裁好的 256 × 256 PNG，以 data URL 保存在单独的键中。 */
  const CUSTOM_KEY = 'sidenotes-prototype-app-icon';
  /** data URL 的长度上限：裁好的 PNG 通常在 200 KB 以内，留出余量，又不至于占满浏览器存储。 */
  const MAX_CUSTOM_LENGTH = 1500000;
  /** 图标在 64 视图框中的圆角是 14：上传的图片按同样的比例裁圆角，和内置图标放在一起不突兀。 */
  const CORNER_RATIO = 14 / 64;

  /** @brief 校验设置中的取值，找不到的内置图标按默认处理。 @param {*} value 保存的取值。 @return {string} 图标 id 或 custom。 */
  function normalize(value) {
    if (value === CUSTOM_ICON) return CUSTOM_ICON;
    return ICONS.some(function known(icon) { return icon.id === value; }) ? value : DEFAULT_ICON;
  }

  /** @brief 内置图标的图片地址。 @param {string} id 图标 id。 @return {string} 相对于原型页面的地址。 */
  function source(id) {
    const icon = ICONS.find(function same(item) { return item.id === id; }) || ICONS[0];
    return icon.id === DEFAULT_ICON ? DEFAULT_COPY : BUILTIN_ROOT + icon.number + '-' + icon.id + '/icon.svg';
  }

  /** @brief 读取上传的图片。 @return {string} PNG 的 data URL，没有或已损坏时为空字符串。 */
  function readCustom() {
    try {
      const value = localStorage.getItem(CUSTOM_KEY) || '';
      return value.startsWith('data:image/png;base64,') && value.length <= MAX_CUSTOM_LENGTH ? value : '';
    } catch (error) {
      return '';
    }
  }

  /** @brief 保存或移除上传的图片。 @param {string} url PNG 的 data URL，空值表示移除。 @return {boolean} 是否成功。 */
  function writeCustom(url) {
    try {
      if (!url) {
        localStorage.removeItem(CUSTOM_KEY);
        return true;
      }
      if (url.length > MAX_CUSTOM_LENGTH) return false;
      localStorage.setItem(CUSTOM_KEY, url);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * @brief 实际显示的图标。
   * @details 选了自定义图标但图片已不在（被浏览器清理或另一个窗口移除了）时，按默认图标显示，设置不改动。
   * @param {*} value 设置中的取值。 @return {{id: string, src: string, type: string}} 图标 id、图片地址与类型。
   */
  function resolve(value) {
    const id = normalize(value);
    if (id === CUSTOM_ICON) {
      const custom = readCustom();
      if (custom) return { id: CUSTOM_ICON, src: custom, type: 'image/png' };
      return { id: DEFAULT_ICON, src: source(DEFAULT_ICON), type: 'image/svg+xml' };
    }
    return { id: id, src: source(id), type: 'image/svg+xml' };
  }

  return Object.freeze({ ICONS, DEFAULT_ICON, CUSTOM_ICON, CORNER_RATIO, normalize, source, readCustom, writeCustom, resolve });
})();
