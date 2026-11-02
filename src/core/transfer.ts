/**
 * 卡片之间移动图片附件与正文中的引用（文件引用、内嵌图片）。
 *
 * 引用的位置与落点行号都相对卡片的显示正文，先经 display 换算回记录原文，
 * 再从来源记录取出、插入目标记录。
 */

import { displayLineCount, lineStarts, noteDisplay, sourceOffset } from './display';
import { filePath } from './files';
import type { Note, NoteImage } from './types';

/**
 * 从原文中取出一段。
 *
 * 所在行因此只剩空白或列表、引用标记时整行删去；引用前后各有一个空格时并成一个。
 */
export function removeRange(text: string, start: number, end: number): string {
  const starts = lineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= start) line += 1;
  const lineStart = starts[line];
  const breakMatch = /\r\n|\r|\n/.exec(text.slice(end));
  const lineEnd = breakMatch ? end + breakMatch.index : text.length;
  const rest = text.slice(lineStart, start) + text.slice(end, lineEnd);
  const content = rest.replace(/^\s{0,3}(?:(?:[-+*]|\d+[.)])\s*(?:\[[ xX]\]\s*)?|>\s*)/, '');
  if (!content.trim()) {
    const after = breakMatch ? breakMatch[0] : '';
    if (after) return text.slice(0, lineStart) + text.slice(lineEnd + after.length);
    const before = (text.slice(0, lineStart).match(/(?:\r\n|\r|\n)$/) ?? [''])[0];
    return text.slice(0, lineStart - before.length);
  }
  if (text[start - 1] === ' ' && text[end] === ' ') return text.slice(0, start) + text.slice(end + 1);
  return text.slice(0, start) + text.slice(end);
}

/** 在原文第 `line` 行之前插入一行；超出末尾时接在最后。 */
export function insertLine(text: string, line: number, content: string): string {
  const starts = lineStarts(text);
  const eol = (text.match(/\r\n|\r|\n/) ?? ['\n'])[0];
  if (!text) return content;
  if (line < starts.length) {
    const at = starts[line];
    return text.slice(0, at) + content + eol + text.slice(at);
  }
  return text + eol + content;
}

/** 移动图片附件：从来源记录取出，插到目标记录附件的第 `index` 位。同一条记录或图片已不存在时返回 null。 */
export function moveImage(
  source: Note,
  target: Note,
  imageId: string,
  index: number,
): { sourceImages: NoteImage[]; targetImages: NoteImage[] } | null {
  const image = source.images.find((item) => item.id === imageId);
  if (!image || source.id === target.id) return null;
  const targetImages = [...target.images];
  targetImages.splice(Math.max(0, Math.min(index, targetImages.length)), 0, image);
  return { sourceImages: source.images.filter((item) => item.id !== imageId), targetImages };
}

/**
 * 把一段内容作为单独的行插到记录显示正文第 `line` 行之前，超出时接在正文末尾、标签之前。
 * 卡片之间拖动引用与从资源管理器拖入文件共用。
 */
export function insertAtDisplayLine(target: Note, line: number, content: string): string {
  const display = noteDisplay(target.text);
  const targetLine = Math.max(0, Math.min(line, displayLineCount(display))) + display.lineShift;
  return insertLine(target.text, targetLine, content);
}

/**
 * 移动正文中的引用：按显示正文中的范围 [start, end) 从来源记录取出，
 * 作为单独一行插到目标记录显示正文第 `line` 行之前（超出时接在正文末尾、标签之前）。
 *
 * 换算出的原文片段必须正好是一个引用（`[…](…)`、`![…](…)`）或一个文件路径，
 * 否则说明位置已经失效，返回 null，不做任何改动。
 */
export function moveReference(
  source: Note,
  target: Note,
  start: number,
  end: number,
  line: number,
): { sourceText: string; targetText: string; reference: string } | null {
  if (source.id === target.id || start >= end) return null;
  const from = noteDisplay(source.text);
  const sourceStart = sourceOffset(source.text, from, start);
  const sourceEnd = sourceOffset(source.text, from, end);
  const reference = source.text.slice(sourceStart, sourceEnd).trim();
  if (!/^!?\[[^\r\n]*\]\([^\r\n]*\)$/.test(reference) && !filePath(reference)) return null;
  return {
    sourceText: removeRange(source.text, sourceStart, sourceEnd),
    targetText: insertAtDisplayLine(target, line, reference),
    reference,
  };
}
