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
