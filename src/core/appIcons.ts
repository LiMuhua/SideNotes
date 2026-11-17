/**
 * 应用图标：内置图标的清单与设置项 `appIcon` 的校验。
 *
 * 内置图标的资源随应用打包（`src-tauri/icons/builtin/`，由 `pnpm icons` 生成），清单只有
 * `manifest.json` 一份，这里直接读取，不另写一份列表。取值是内置图标的 id，或 `custom` 表示上传的图片；
 * 在清单中找不到的取值（例如以后删掉的图标）按默认处理，见 docs/design-system/adaptation.md 第十节。
 */

import manifest from '../../src-tauri/icons/builtin/manifest.json';

/** 一个内置图标。 */
export interface BuiltinIcon {
  /** 设置中保存的标识，也是资源目录名的后半段。 */
  id: string;
  /** 设计稿编号，资源目录名的前半段。 */
  number: string;
  /** 中文名。 */
  name: string;
}

/** 内置图标，按清单顺序排列，默认图标在最前。 */
export const BUILTIN_ICONS: readonly BuiltinIcon[] = manifest.icons;

/** 默认图标：211「门缝浅笑 · 靛蓝」。 */
export const DEFAULT_APP_ICON: string = manifest.default;

/** 使用上传的图片。 */
export const CUSTOM_APP_ICON = 'custom';

/** 校验设置中的应用图标，无法识别时回到默认图标。 */
export function normalizeAppIcon(value: unknown): string {
  if (value === CUSTOM_APP_ICON) return CUSTOM_APP_ICON;
  return BUILTIN_ICONS.some((icon) => icon.id === value) ? (value as string) : DEFAULT_APP_ICON;
}

/** 内置图标的资源目录名，例如 `211-door-smile-indigo`。 */
export function builtinIconFolder(id: string): string {
  const icon = BUILTIN_ICONS.find((item) => item.id === id) ?? BUILTIN_ICONS[0];
  return `${icon.number}-${icon.id}`;
}

/** ICO 中的各个尺寸（清单的 icoSizes）：上传的图片按这些尺寸生成 `custom.ico`。 */
export const ICO_SIZES: readonly number[] = manifest.icoSizes;

/** 图标在 64 视图框中的圆角是 14：上传的图片按同样的比例裁圆角，和内置图标放在一起不突兀。 */
export const ICON_CORNER_RATIO = 14 / 64;

/** 内置图标的母版 SVG：由 Vite 按资源处理，打包后进入产物，各窗口的品牌标记与设置中的选项都用它。 */
const SOURCES = import.meta.glob<string>('../../src-tauri/icons/builtin/*/icon.svg', { eager: true, query: '?url', import: 'default' });

/** 内置图标的图片地址；找不到的 id 按默认图标。 */
export function builtinIconSource(id: string): string {
  return SOURCES[`../../src-tauri/icons/builtin/${builtinIconFolder(id)}/icon.svg`] ?? '';
}

/**
 * 品牌标记（标题区、速记浮窗、关于页与网页图标）显示的图片。
 * 选了自定义图标但图片已不在（被移除或读不到）时按默认图标显示，设置不改动。
 * @param custom 上传的图片的地址，没有时为空字符串。
 */
export function appIconSource(appIcon: string, custom: string): string {
  if (appIcon === CUSTOM_APP_ICON && custom) return custom;
  return builtinIconSource(appIcon === CUSTOM_APP_ICON ? DEFAULT_APP_ICON : appIcon);
}

/**
 * 窗口与托盘用的图标：内置图标的目录名；null 表示上传的图片。
 * 选了自定义图标但图片不在时用默认图标，与品牌标记一致。
 */
export function appIconFolder(appIcon: string, hasCustom: boolean): string | null {
  if (appIcon === CUSTOM_APP_ICON) return hasCustom ? null : builtinIconFolder(DEFAULT_APP_ICON);
  return builtinIconFolder(appIcon);
}
