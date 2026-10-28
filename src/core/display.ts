/**
 * 卡片的标题行与显示正文。
 *
 * 卡片把首个非空行用作标题，正文从下一行起显示，末尾的标签单独成行显示；
 * 解析器给出的位置与行号都相对显示正文。标签只会从行尾去掉，标题只占开头的行，
 * 所以换算回记录原文时行号加上标题所占的行、列保持不变。
 * 卡片勾选待办与卡片之间拖动引用都依赖这一换算。
 */

import { parse } from './tags';

/** 卡片显示的标题行与正文，NoteCard 渲染与拖放换算共用。 */
export interface NoteDisplay {
  /** 首个非空行，用作标题。 */
  firstLine: string;
  /** 首行是代码、列表、引用、图片等结构化内容时为 true：标题另取，正文从头显示。 */
  structured: boolean;
  /** 正文显示的 Markdown。 */
  body: string;
  /** 正文第 0 行对应原文的行号。 */
  lineShift: number;
}

/** 首行为结构化内容（代码、列表、引用、图片、分隔线等）时，标题不复用该行文本。 */
const STRUCTURED =
  /^\s*(?:`{3,}|~{3,}|!\[|>|(?:-\s*){3,}$|(?:_\s*){3,}$|(?:\*\s*){3,}$)|^(?: {4}|\t)|^\s*[-*+]\s|^\s*\d+[.)]\s/;

/** 拆出卡片的标题行与显示正文。 */
export function noteDisplay(text: string): NoteDisplay {
  const parsed = parse(text);
  const lines = parsed.body.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim());
  const firstLine = firstIndex < 0 ? '' : lines[firstIndex];
  const structured = firstLine.length > 120 || STRUCTURED.test(firstLine);
  if (firstIndex < 0) return { firstLine, structured, body: '', lineShift: 0 };
  if (structured) return { firstLine, structured, body: parsed.body, lineShift: 0 };
  return { firstLine, structured, body: lines.slice(firstIndex + 1).join('\n'), lineShift: firstIndex + 1 };
}

/** 各行的起始位置，兼容各种换行符。 */
export function lineStarts(text: string): number[] {
  const starts = [0];
  const pattern = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) starts.push(match.index + match[0].length);
  return starts;
}

/** 显示正文的行数；正文为空时为 0。 */
export function displayLineCount(display: NoteDisplay): number {
  return display.body ? lineStarts(display.body).length : 0;
}

/** 把显示正文中的位置换算为原文位置。 */
export function sourceOffset(text: string, display: NoteDisplay, offset: number): number {
  const starts = lineStarts(display.body);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
  const column = offset - starts[line];
  const source = lineStarts(text);
  return (source[line + display.lineShift] ?? text.length) + column;
}
