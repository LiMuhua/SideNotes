/**
 * 搜索命中的高亮（第七次反馈，与交互原型相同）：规则与实现搬进了 src/core/searchHighlight（实现桌面端时，T79），
 * 这里按 Playground 的类名引用。样式见 base.css 的 ::highlight。
 */

import { listHits as coreListHits, type HitSelectors } from '@/core/searchHighlight';

export { findHits, setSearchHits } from '@/core/searchHighlight';
export { searchNeedles } from '@/core/search';

/** Playground 列表中的标题与正文、标签。 */
const SELECTORS: HitSelectors = { text: '.sn-note-title, .sn-note-markdown', tag: '.sn-note-tag' };

/** 侧栏列表中的命中：标题与正文按文字，标签按「#标签」。 */
export function listHits(list: Element, terms: string, known: ReadonlySet<string>): Range[] {
  return coreListHits(list, terms, known, SELECTORS);
}
