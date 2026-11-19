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

/**
 * 名称与输入对得上的程度（T112）：0 完全相同，1 名称开头，2 某个单词开头（如 Cambria Math 的 Math），
 * 3 中间包含（如 Bookman 里的 man），-1 对不上。不分大小写。
 */
export function fontMatchRank(label: string, typed: string): number {
  const key = typed.trim().toLocaleLowerCase();
  const name = label.toLocaleLowerCase();
  if (!key) return 0;
  if (name === key) return 0;
  if (name.startsWith(key)) return 1;
  if (name.split(/[\s\-_]+/).some((word) => word.startsWith(key))) return 2;
  return name.includes(key) ? 3 : -1;
}

/**
 * 筛选字体候选：名称包含输入的文字（不分大小写）；输入为空时全部保留。
 * 对得更上的排在前面（T112，2026-11-19 用户要求：输入 ma 时 Magneto、Malgun Gothic 排在 Bookman Old Style 前面），
 * 同一级按名称的字母顺序。
 */
export function filterFonts<T extends { label: string }>(choices: readonly T[], typed: string): T[] {
  const key = typed.trim();
  if (!key) return [...choices];
  return choices
    .map((choice) => ({ choice, rank: fontMatchRank(choice.label, key) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.choice.label.localeCompare(b.choice.label, 'en', { sensitivity: 'base' }))
    .map((item) => item.choice);
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
