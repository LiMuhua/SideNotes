/**
 * 应用图标：内置图标的清单与资源地址（本次提出）。
 *
 * 清单与资源就是随安装包打包的那一份（`src-tauri/icons/builtin/`，由 `pnpm icons` 生成），Playground 直接引用，
 * 设置页的选项、图标页的预览与真实应用附带的文件因此完全一致。当前选用哪个图标属于设置，保存在记录仓库中
 * （`model/notes.tsx` 的 appIcon 与 customIcon）。
 */

import manifest from '../../../../../src-tauri/icons/builtin/manifest.json';

/** 设置中选用上传的图片时的取值。 */
export const CUSTOM_APP_ICON = 'custom';

export interface BuiltinAppIcon {
  id: string;
  /** 设计稿编号，与设计决策、任务记录和图标演进页中的编号对应。 */
  number: string;
  name: string;
  /** 母版 SVG（64 × 64 视图框）。 */
  svg: string;
  /** Windows 用的 ICO，含清单 icoSizes 中的全部尺寸。 */
  ico: string;
  /** 各尺寸的 PNG，按尺寸从小到大。 */
  png: ReadonlyArray<{ size: number; url: string }>;
}

const svgs = import.meta.glob<string>('/src-tauri/icons/builtin/*/icon.svg', { eager: true, query: '?url', import: 'default' });
const icos = import.meta.glob<string>('/src-tauri/icons/builtin/*/icon.ico', { eager: true, query: '?url', import: 'default' });
const pngs = import.meta.glob<string>('/src-tauri/icons/builtin/*/png/*.png', { eager: true, query: '?url', import: 'default' });

/** 缺文件说明清单与资源不同步，直接报错，提示重新生成。 */
function asset(table: Record<string, string>, path: string): string {
  const url = table[path];
  if (!url) throw new Error(`缺少应用图标资源 ${path}，请运行 pnpm icons`);
  return url;
}

export const PNG_SIZES: readonly number[] = manifest.pngSizes;
export const ICO_SIZES: readonly number[] = manifest.icoSizes;

export const APP_ICONS: readonly BuiltinAppIcon[] = manifest.icons.map((icon) => {
  const folder = `/src-tauri/icons/builtin/${icon.number}-${icon.id}`;
  return {
    ...icon,
    svg: asset(svgs, `${folder}/icon.svg`),
    ico: asset(icos, `${folder}/icon.ico`),
    png: PNG_SIZES.map((size) => ({ size, url: asset(pngs, `${folder}/png/${size}.png`) })),
  };
});

/** 默认图标：211 门缝浅笑 · 靛蓝。 */
export const DEFAULT_APP_ICON: string = manifest.default;

/** 按 id 取内置图标；找不到时退回默认图标（例如清单删掉了用户选过的图标）。 */
export function builtinAppIcon(id: string): BuiltinAppIcon {
  return APP_ICONS.find((icon) => icon.id === id) ?? APP_ICONS.find((icon) => icon.id === DEFAULT_APP_ICON) ?? APP_ICONS[0];
}

/** 图标在 64 视图框中的圆角是 14：上传的图片按同样的比例裁圆角，和内置图标放在一起不突兀。 */
export const ICON_CORNER_RATIO = 14 / 64;
