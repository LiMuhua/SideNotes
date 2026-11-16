/**
 * 字体候选的过滤与选用。
 *
 * 设置页的字体下拉框按输入过滤候选，回车选用排在第一位的候选：名称完全相同的在前，
 * 其次是以输入开头的，再次是包含输入的，同类之间保持原有顺序（常用字体在前，系统字体按名称）。
 * 没有任何候选时不选用，避免把不存在的字体名写进设置后静默回落到系统默认字体。
 * 候选最前是「跟随主题」（默认，保存为空字符串），最后是「系统默认」。
 */

/** 按输入过滤字体，不区分大小写；输入为空时原样返回。 */
export function matchFonts(families: readonly string[], query: string): string[] {
  const key = query.trim().toLocaleLowerCase();
  if (!key) return [...families];
  const rank = (family: string): number => {
    const name = family.toLocaleLowerCase();
    if (name === key) return 0;
    if (name.startsWith(key)) return 1;
    return name.includes(key) ? 2 : -1;
  };
  return families
    .map((family, index) => ({ family, index, rank: rank(family) }))
    .filter((item) => item.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.family);
}

/** 字体「跟随主题」的显示文字，保存为空字符串。 */
export const FOLLOW_THEME_LABEL = '跟随主题';
/** 字体「系统默认」：Segoe UI 与微软雅黑 UI，按名称保存。 */
export const SYSTEM_FONT_LABEL = '系统默认';

/**
 * 回车时选用的字体：输入为空或是「跟随主题」中的文字时返回空串（跟随主题）；
 * 否则返回排在第一位的候选，「系统默认」也参与匹配；没有候选时返回 null，表示不允许设置。
 */
export function resolveFont(families: readonly string[], typed: string): string | null {
  const query = typed.trim();
  const key = query.toLocaleLowerCase();
  if (!query || FOLLOW_THEME_LABEL.includes(query)) return '';
  const first = matchFonts(families, query)[0];
  if (first !== undefined) return first;
  return SYSTEM_FONT_LABEL.toLocaleLowerCase().includes(key) ? SYSTEM_FONT_LABEL : null;
}
