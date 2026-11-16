/**
 * 搜索命中的高亮（原型第二版第七、八次反馈）：搜索词在标题与正文中加上高亮底色；「#标签」只标在标签上
 * （写完整的已有标签只标这个标签，没写完的按前缀）。文字不标在标签上（文字与标签分开搜）。
 *
 * 用 CSS 自定义高亮（CSS.highlights）标出文字范围，不改动 React 管理的节点；交互原型直接把命中包进 mark，
 * 那样会与 React 的渲染冲突。样式是 `::highlight(sn-search-hit)`。同一页面上可能有好几个列表（Playground 的组件页），
 * 按实例分别登记，合成一个高亮。不支持这个接口时只是没有高亮；桌面端的 WebView2 支持。命中跨过格式（如一半加粗）时不标，
 * 匹配本身不受影响。
 *
 * 原在 Playground 的 ui/searchHighlight.ts，实现桌面端时搬进 src/core（T79）。
 */

import { searchNeedles, tagMatches } from './search';
import { tagKey } from './tags';

const HIGHLIGHT = 'sn-search-hit';
const owners = new Map<string, Range[]>();

/** 列表中要标的元素：text 按文字标（标题、正文），tag 是标签按钮（带 data-tag）。 */
export interface HitSelectors {
  text: string;
  tag: string;
}

/** 元素中文字节点里的命中（不分大小写）。 */
export function findHits(root: Node, words: readonly string[]): Range[] {
  if (!words.length) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    const lower = text.toLocaleLowerCase();
    // 大小写转换改变了长度（极少数字符）时位置对不上，这一段不标。
    if (lower.length !== text.length) continue;
    for (const word of words) {
      for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/**
 * 列表中的命中：标题与正文按文字，标签按「#标签」。
 * @param known 已有标签的 tagKey，「#标签」写完整的已有标签时只标这个标签。
 */
export function listHits(list: Element, terms: string, known: ReadonlySet<string>, selectors: HitSelectors): Range[] {
  const { words, tags } = searchNeedles(terms);
  const ranges: Range[] = [];
  list.querySelectorAll(selectors.text).forEach((element) => ranges.push(...findHits(element, words)));
  list.querySelectorAll<HTMLElement>(selectors.tag).forEach((chip) => {
    const key = tagKey(chip.dataset.tag ?? '');
    if (!tags.some((tag) => tagMatches(key, tag, known))) return;
    const range = document.createRange();
    range.selectNodeContents(chip);
    ranges.push(range);
  });
  return ranges;
}

/** 登记一个列表的命中，ranges 为空时去掉。 */
export function setSearchHits(owner: string, ranges: readonly Range[]): void {
  if (ranges.length) owners.set(owner, [...ranges]);
  else if (!owners.delete(owner)) return;
  const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
  if (!registry || typeof Highlight === 'undefined') return;
  const all = Array.from(owners.values()).flat();
  if (all.length) registry.set(HIGHLIGHT, new Highlight(...all));
  else registry.delete(HIGHLIGHT);
}
