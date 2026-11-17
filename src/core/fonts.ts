/**
 * 字体的选用（设置页的字体组合框，原型第二版 settings.js 的 fontPicker）。
 *
 * 候选最前是「跟随主题」（默认，保存为空字符串），最后是「系统默认」。可以从候选中选，也可以输入任意名称：
 * 名称与候选只差大小写时用候选的写法；不在候选中时，列表末尾多一项「使用“名称”」，回车或点它就用这个名称。
 */

/** 字体「跟随主题」的显示文字，保存为空字符串。 */
export const FOLLOW_THEME_LABEL = '跟随主题';
/** 字体「系统默认」：Segoe UI 与微软雅黑 UI，按名称保存。 */
export const SYSTEM_FONT_LABEL = '系统默认';
/** 保存的字体名最长 120 个字符。 */
const MAX_FAMILY_LENGTH = 120;

/**
 * 输入的字体名。
 * @returns family 是要保存的值（空输入或「跟随主题」为空字符串）；known 表示是否是候选中已有的一项。
 */
export function typedFont(families: readonly string[], typed: string): { family: string; known: boolean } {
  const value = typed.trim().slice(0, MAX_FAMILY_LENGTH);
  if (!value || value === FOLLOW_THEME_LABEL) return { family: '', known: true };
  const key = value.toLocaleLowerCase();
  const match = [...families, SYSTEM_FONT_LABEL].find((family) => family.toLocaleLowerCase() === key);
  return { family: match ?? value, known: match !== undefined };
}
