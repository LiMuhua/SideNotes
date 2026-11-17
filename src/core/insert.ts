/**
 * 附件插入的位置（原型第二版，与交互原型 app.js 的 insertDroppedText、headingLineAt 与 content.js 的 titleLine 相同）。
 *
 * - 标签固定在最后一行：插入位置落在标签行或它之后时，改为标签行之前的单独一段。
 * - 附件不插进标题：光标或选区在卡片的标题行、Markdown 标题行（# 开头）上时，作为单独一行插在这一行之后，标题原样保留。
 * - 其余插在光标处（替换选中的文字）；没有位置时接在末尾，作为单独一段。
 * 工具栏的「添加图片」「引用文件」、粘贴截图或文件、从资源管理器拖入都按这条规则插入。
 */

import { filePath } from './files';
import { tagLineStart } from './tags';

/** 插入的范围（原文偏移）。 */
export interface InsertRange {
  start: number;
  end: number;
}

/** 这一行只有一个图片或文件引用（附件整块占一行）。 */
function isAttachmentLine(line: string): boolean {
  return /^\s*!?\[(?:\\.|[^\]\\])*\]\([^)\r\n]*\)\s*$/.test(line);
}

/**
 * 卡片标题所在的行（原型 titleLine）：第一个非空行是普通文字或 Markdown 标题时才算；
 * 第一行是代码、列表、引用、附件、分隔线、文件路径或只有标签时，卡片整段显示正文，没有单独的标题行。
 */
export function titleLine(source: string): InsertRange | null {
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) && match[0]) {
    const line = match[0].replace(/[\r\n]+$/, '');
    if (!line.trim()) continue;
    const structured =
      /^\s*(?:`{3,}|~{3,}|>|(?:-\s*){3,}$|(?:_\s*){3,}$|(?:\*\s*){3,}$)|^(?: {4}|\t)|^\s*[-*+]\s|^\s*\d+[.)]\s/.test(line);
    if (structured || isAttachmentLine(line) || filePath(line) || tagLineStart(line) === 0) return null;
    return { start: match.index, end: match.index + line.length };
  }
  return null;
}

/** 范围碰到的标题行：卡片的标题行，或光标所在的 Markdown 标题行；不在标题行上时为 null。 */
function headingLineAt(source: string, range: InsertRange): InsertRange | null {
  const title = titleLine(source);
  if (title && range.start <= title.end && range.end >= title.start) return title;
  const start = source.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  const breakAt = source.slice(start).search(/\r\n|\r|\n/);
  const end = breakAt < 0 ? source.length : start + breakAt;
  return /^\s{0,3}#{1,6}[\t ]+\S/.test(source.slice(start, end)) ? { start, end } : null;
}

/**
 * 把附件的 Markdown 插进原文，返回新的原文与插入后的光标位置。`range` 为空时接在末尾。
 */
export function placeAttachment(source: string, text: string, range: InsertRange | null): { text: string; caret: number } {
  if (!text) return { text: source, caret: range ? range.end : source.length };
  const tags = tagLineStart(source);
  if (tags >= 0 && (!range || range.start >= tags)) {
    const before = source.slice(0, tags);
    const prefix = !before || before.endsWith('\n\n') ? '' : '\n';
    return { text: `${before}${prefix}${text}\n\n${source.slice(tags)}`, caret: before.length + prefix.length + text.length };
  }
  if (range) {
    const heading = headingLineAt(source, range);
    if (heading) {
      const eol = (source.match(/\r\n|\r|\n/) ?? ['\n'])[0];
      return { text: source.slice(0, heading.end) + eol + text + source.slice(heading.end), caret: heading.end + eol.length + text.length };
    }
    const start = Math.max(0, Math.min(source.length, range.start));
    const end = Math.max(start, Math.min(source.length, range.end));
    return { text: source.slice(0, start) + text + source.slice(end), caret: start + text.length };
  }
  const prefix = source ? (source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n') : '';
  return { text: source + prefix + text, caret: source.length + prefix.length + text.length };
}
