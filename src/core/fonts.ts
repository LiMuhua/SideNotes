/**
 * 字体的选用（设置页的字体组合框）。
 *
 * 候选最前是「跟随主题」（默认，保存为空字符串），最后是「系统默认」。输入时按名称筛选候选（不分大小写）；
 * 没有一项对得上时，列表第一项提示这个名称不可用（不能选），第二项是「使用系统默认字体」。
 * 只能用候选中的字体：本机没有的字体名保存下来也显示不出来（2026-11-18 用户要求，与原型第二版的「使用“名称”」不同）。
 */

/** 字体「跟随主题」的显示文字，保存为空字符串。 */
export const FOLLOW_THEME_LABEL = '跟随主题';
/** 字体「系统默认」：Segoe UI 与微软雅黑 UI，按名称保存。 */
export const SYSTEM_FONT_LABEL = '系统默认';
/** 保存的字体名最长 120 个字符。 */
const MAX_FAMILY_LENGTH = 120;

/** 筛选字体候选：名称包含输入的文字（不分大小写）；输入为空时全部保留。 */
export function filterFonts<T extends { label: string }>(choices: readonly T[], typed: string): T[] {
  const key = typed.trim().toLocaleLowerCase();
  if (!key) return [...choices];
  return choices.filter((choice) => choice.label.toLocaleLowerCase().includes(key));
}

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
