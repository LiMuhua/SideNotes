/**
 * 搜索命中的高亮（第七次反馈，与交互原型相同）：搜索词在标题与正文中加上高亮底色（令牌见 base.css 的 ::highlight）；
 * 「#标签」只标在标签上（写完整的已有标签只标这个标签，没写完的按前缀）。文字不再标在标签上（第八次反馈：文字与标签分开搜）。
 *
 * 用 CSS 自定义高亮（CSS.highlights）标出文字范围，不改动 React 管理的节点：正文由桌面应用的 Markdown 组件渲染，
 * Playground 不往里面插入元素。同一页面上可能有好几个侧栏（组件页的示例），按实例分别登记，合成一个高亮。
 * 浏览器不支持这个接口时只是没有高亮；桌面端的 WebView2 支持。命中跨过格式（如一半加粗）时不标，匹配本身不受影响。
 */

import { tagKey } from '@/core/tags';

const HIGHLIGHT = 'sn-search-hit';
const owners = new Map<string, Range[]>();

/** 搜索词拆成文字与标签，规则与 model/notes.tsx 的 matchesSearch 相同。文字是小写的。 */
export function searchNeedles(terms: string): { words: string[]; tags: string[] } {
  const tags: string[] = [];
  const words = terms
    .replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu, (_match, tag: string) => {
      tags.push(tagKey(tag));
      return ' ';
    })
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return { words, tags };
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
 * 侧栏列表中的命中：标题与正文按文字，标签按「#标签」。
 * @param known 已有标签的 tagKey，「#标签」写完整的已有标签时只标这个标签。
 */
export function listHits(list: Element, terms: string, known: ReadonlySet<string>): Range[] {
  const { words, tags } = searchNeedles(terms);
  const ranges: Range[] = [];
  list.querySelectorAll('.sn-note-title, .sn-note-markdown').forEach((element) => ranges.push(...findHits(element, words)));
  list.querySelectorAll<HTMLElement>('.sn-note-tag').forEach((chip) => {
    const key = tagKey(chip.dataset.tag ?? '');
    if (!tags.some((tag) => (known.has(tag) ? key === tag : key.startsWith(tag)))) return;
    const range = document.createRange();
    range.selectNodeContents(chip);
    ranges.push(range);
  });
  return ranges;
}

/** 登记一个侧栏的命中，ranges 为空时去掉。 */
export function setSearchHits(owner: string, ranges: readonly Range[]): void {
  if (ranges.length) owners.set(owner, [...ranges]);
  else if (!owners.delete(owner)) return;
  const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
  if (!registry || typeof Highlight === 'undefined') return;
  const all = Array.from(owners.values()).flat();
  if (all.length) registry.set(HIGHLIGHT, new Highlight(...all));
  else registry.delete(HIGHLIGHT);
}
