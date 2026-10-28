/**
 * Markdown 编辑命令。
 *
 * 快捷键、回车续写与智能粘贴都只作用于原文和选区：输入原文与选区，返回新的原文与选区，
 * 由编辑器统一写回、重新排版并记入撤销历史。命令只增删必要的标记，其余原文（包括换行符种类）保持不变。
 *
 * 快捷键参照 Typora：Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+K 链接、Ctrl+Shift+` 或 Alt+C 行内代码、
 * Alt+Shift+5 删除线、Ctrl+1–6 标题、Ctrl+0 正文、Ctrl+Shift+Q 引用、Ctrl+Shift+[ 有序列表、
 * Ctrl+Shift+] 无序列表、Ctrl+Shift+K 代码块；列表与引用中回车自动续写，空项回车结束。
 */

import { escapeLabel, filePath } from './files';

/** 命令结果：新的原文与选区。 */
export interface EditResult {
  value: string;
  start: number;
  end: number;
}

/** 剪贴板内容：纯文本、网页格式，以及代码编辑器附带的语言（VS Code）。 */
export interface ClipboardContent {
  text: string;
  html?: string;
  /** 代码块语言，经 codeLanguage 换算；为字符串（含空串）表示内容来自代码编辑器。 */
  codeLanguage?: string | null;
}

/** 原文中的一行，`end` 不含换行符。 */
interface Line {
  start: number;
  end: number;
  text: string;
}

/** 行首的一处替换：删去 `remove` 个字符后插入 `insert`。 */
interface PrefixEdit {
  at: number;
  remove: number;
  insert: string;
}

/** 列表项：缩进、项头、间隔、待办框与正文。 */
const LIST_ITEM = /^(\s{0,3})([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;
/** 代码围栏行。 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** 分隔线，形如 ---、* * *。 */
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
/** 可直接作为链接地址的文本。 */
const URL_PATTERN = /^(?:https?:\/\/|mailto:)[^\s<>]+$/i;

function splitLines(value: string): Line[] {
  const lines: Line[] = [];
  const endings = /\r\n|\r|\n/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = endings.exec(value))) {
    lines.push({ start, end: match.index, text: value.slice(start, match.index) });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: value.length, text: value.slice(start) });
  return lines;
}

/** 原文使用的换行符，沿用第一处换行的写法。 */
function lineBreak(value: string): string {
  return (value.match(/\r\n|\r|\n/) ?? ['\n'])[0];
}

/** 位置所在的行号。 */
function lineIndexAt(lines: Line[], offset: number): number {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (offset < lines[index + 1].start) return index;
  }
  return lines.length - 1;
}

/** 选区覆盖的行号；选区恰好止于下一行行首时不包括该行。 */
function touchedLines(lines: Line[], start: number, end: number): number[] {
  const first = lineIndexAt(lines, start);
  let last = lineIndexAt(lines, end);
  if (last > first && end === lines[last].start) last -= 1;
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

/** 一次应用多处行首替换，并把选区端点映射到新原文。落在被删除部分中的端点移到新前缀之后。 */
function applyEdits(value: string, edits: PrefixEdit[], start: number, end: number): EditResult {
  const sorted = [...edits].sort((left, right) => left.at - right.at);
  let result = '';
  let cursor = 0;
  for (const edit of sorted) {
    result += value.slice(cursor, edit.at) + edit.insert;
    cursor = edit.at + edit.remove;
  }
  result += value.slice(cursor);
  const map = (position: number): number => {
    let shift = 0;
    for (const edit of sorted) {
      if (position < edit.at) break;
      if (position < edit.at + edit.remove) return edit.at + shift + edit.insert.length;
      shift += edit.insert.length - edit.remove;
    }
    return position + shift;
  };
  return { value: result, start: map(start), end: map(end) };
}

/** 用文本替换一段原文，选区落在插入文本的 `selectFrom`–`selectTo` 处。 */
function replaceRange(
  value: string,
  start: number,
  end: number,
  text: string,
  selectFrom = text.length,
  selectTo = selectFrom,
): EditResult {
  return {
    value: value.slice(0, start) + text + value.slice(end),
    start: start + selectFrom,
    end: start + selectTo,
  };
}

/** 一行在围栏代码块中的角色：左围栏、右围栏、代码内容，或不在代码块中（null）。 */
function fenceRole(lines: Line[], index: number): 'open' | 'close' | 'code' | null {
  let fence: { character: string; length: number } | null = null;
  for (let current = 0; current < index; current += 1) {
    const marker = lines[current].text.match(FENCE);
    if (!marker) continue;
    if (!fence) fence = { character: marker[1][0], length: marker[1].length };
    else if (marker[1][0] === fence.character && marker[1].length >= fence.length) fence = null;
  }
  const marker = lines[index].text.match(FENCE);
  if (!fence) return marker ? 'open' : null;
  return marker && marker[1][0] === fence.character && marker[1].length >= fence.length ? 'close' : 'code';
}

/** 行内某一列是否位于行内代码之中（左侧有未闭合的反引号）。 */
function insideInlineCode(text: string, column: number): boolean {
  let open = '';
  let index = 0;
  while (index < column) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '`') {
      const run = (text.slice(index).match(/^`+/) ?? ['`'])[0];
      if (!open) open = run;
      else if (run === open) open = '';
      index += run.length;
      continue;
    }
    index += 1;
  }
  return Boolean(open);
}

/* ==================== 行内格式 ==================== */

/** 从某位置起向一个方向数连续的同一字符。 */
function runLength(text: string, index: number, step: 1 | -1, character: string): number {
  let count = 0;
  for (let position = index; position >= 0 && position < text.length && text[position] === character; position += step) {
    count += 1;
  }
  return count;
}

/** 两侧连续的标记字符是否构成一对：单字符标记要求奇数个（排除 ** 中的 *），双字符标记至少两个。 */
function pairs(before: number, after: number, marker: string): boolean {
  if (marker.length === 1) return before % 2 === 1 && after % 2 === 1;
  return before >= marker.length && after >= marker.length;
}

/** 给单行文字加上或去掉标记，标记紧贴文字，不包住首尾空白。 */
function toggleLineSpan(value: string, start: number, end: number, marker: string): EditResult {
  const text = value.slice(start, end);
  const lead = (text.match(/^\s*/) ?? [''])[0].length;
  const trail = text.trim() ? (text.match(/\s*$/) ?? [''])[0].length : 0;
  const from = start + lead;
  const to = end - trail;
  if (from >= to) return { value, start, end };
  const character = marker[0];
  // 选中的文字本身带着标记：去掉。
  const innerBefore = runLength(value, from, 1, character);
  const innerAfter = runLength(value, to - 1, -1, character);
  if (to - from > marker.length * 2 && pairs(innerBefore, innerAfter, marker)) {
    const inner = value.slice(from + marker.length, to - marker.length);
    return { value: value.slice(0, from) + inner + value.slice(to), start: from, end: from + inner.length };
  }
  // 标记在选区两侧：去掉两侧的标记。
  const outerBefore = runLength(value, from - 1, -1, character);
  const outerAfter = runLength(value, to, 1, character);
  if (pairs(outerBefore, outerAfter, marker)) {
    const inner = value.slice(from, to);
    const at = from - marker.length;
    return { value: value.slice(0, at) + inner + value.slice(to + marker.length), start: at, end: at + inner.length };
  }
  // 行内代码中含反引号时改用双反引号并留出空格。
  let open = marker;
  let close = marker;
  if (marker === '`' && value.slice(from, to).includes('`')) {
    open = '`` ';
    close = ' ``';
  }
  return {
    value: value.slice(0, from) + open + value.slice(from, to) + close + value.slice(to),
    start: from + open.length,
    end: to + open.length,
  };
}

/**
 * 切换行内格式（加粗、斜体、删除线、行内代码）。
 *
 * 没有选中文字时插入一对标记并把光标放在中间；光标恰在一对空标记之间时撤掉这对标记；
 * 光标紧挨闭合标记时跳到标记之后，继续输入不再带格式。选中多行时逐行处理。
 */
export function toggleInline(value: string, start: number, end: number, marker: string): EditResult {
  const size = marker.length;
  const lines = splitLines(value);
  if (start === end) {
    if (value.slice(start - size, start + size) === marker + marker) {
      return { value: value.slice(0, start - size) + value.slice(start + size), start: start - size, end: start - size };
    }
    const line = lines[lineIndexAt(lines, start)];
    if (
      value.slice(start, start + size) === marker &&
      value[start + size] !== marker[0] &&
      value.slice(line.start, start).includes(marker)
    ) {
      return { value, start: start + size, end: start + size };
    }
    return replaceRange(value, start, end, marker + marker, size);
  }
  const indexes = touchedLines(lines, start, end);
  if (indexes.length === 1) return toggleLineSpan(value, start, end, marker);
  // 多行：从后往前逐行处理，前面各行的位置不受影响。
  let result = value;
  let selectionEnd = end;
  for (const index of [...indexes].reverse()) {
    const line = lines[index];
    const from = Math.max(start, line.start);
    const to = Math.min(end, line.end);
    if (!value.slice(from, to).trim()) continue;
    const before = result.length;
    result = toggleLineSpan(result, from, to, marker).value;
    selectionEnd += result.length - before;
  }
  return { value: result, start, end: selectionEnd };
}

/**
 * 插入或去掉链接。
 *
 * 选中的是网址或文件路径时生成 `[](地址)` 并把光标放进链接文字；选中普通文字时生成
 * `[文字]()` 并把光标放进地址；选中的正好是一个链接时去掉链接只留文字。
 */
export function toggleLink(value: string, start: number, end: number): EditResult {
  const text = value.slice(start, end);
  const link = text.match(/^\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)$/);
  if (link) {
    const label = link[1].replace(/\\([\\[\]])/g, '$1');
    return replaceRange(value, start, end, label, 0, label.length);
  }
  if (!text) return replaceRange(value, start, end, '[]()', 1);
  const target = text.trim();
  if (!/[\r\n]/.test(target) && (URL_PATTERN.test(target) || filePath(target))) {
    return replaceRange(value, start, end, `[](${target})`, 1);
  }
  const label = escapeLabel(text);
  return replaceRange(value, start, end, `[${label}]()`, label.length + 3);
}

/* ==================== 块级格式 ==================== */

/** 选区内的非空行；都为空时取第一行。 */
function contentLines(value: string, start: number, end: number): Line[] {
  const lines = splitLines(value);
  const touched = touchedLines(lines, start, end).map((index) => lines[index]);
  const filled = touched.filter((line) => line.text.trim());
  return filled.length ? filled : touched.slice(0, 1);
}

/** 设为指定级别的标题；0 恢复为正文。所选各行已是该级标题时取消标题。 */
export function setHeading(value: string, start: number, end: number, level: number): EditResult {
  const lines = contentLines(value, start, end);
  const headingOf = (text: string): RegExpMatchArray | null => text.match(/^\s{0,3}(#{1,6})(?:[ \t]+|$)/);
  const all = level > 0 && lines.every((line) => headingOf(line.text)?.[1].length === level);
  const edits = lines.map((line) => {
    const heading = headingOf(line.text);
    return {
      at: line.start,
      remove: heading ? heading[0].length : 0,
      insert: level > 0 && !all ? `${'#'.repeat(level)} ` : '',
    };
  });
  return applyEdits(value, edits, start, end);
}

/** 切换引用：所选各行都已是引用时去掉引用标记，否则逐行加上。 */
export function toggleQuote(value: string, start: number, end: number): EditResult {
  const lines = splitLines(value);
  const touched = touchedLines(lines, start, end).map((index) => lines[index]);
  const filled = touched.filter((line) => line.text.trim());
  const quoted = (filled.length ? filled : touched).every((line) => /^\s{0,3}>/.test(line.text));
  const edits = touched.map((line) => {
    if (quoted) {
      const marker = line.text.match(/^\s{0,3}>[ \t]?/);
      return { at: line.start, remove: marker ? marker[0].length : 0, insert: '' };
    }
    return { at: line.start, remove: 0, insert: line.text.trim() ? '> ' : '>' };
  });
  return applyEdits(value, edits, start, end);
}

/**
 * 切换有序或无序列表：所选各行都已是该类列表时去掉项头（连同待办框），
 * 否则统一换成该类项头，待办框保留。
 */
export function toggleList(value: string, start: number, end: number, ordered: boolean): EditResult {
  const lines = contentLines(value, start, end).filter((line) => !RULE.test(line.text));
  const items = lines.map((line) => line.text.match(LIST_ITEM));
  const all = items.length > 0 && items.every((item) => item && /^\d/.test(item[2]) === ordered);
  let number = 1;
  const edits = lines.map((line, index) => {
    const item = items[index];
    if (item) {
      const remove = item[2].length + item[3].length + (all ? (item[4]?.length ?? 0) : 0);
      return { at: line.start + item[1].length, remove, insert: all ? '' : ordered ? `${number++}. ` : '- ' };
    }
    const indent = (line.text.match(/^ {0,3}/) ?? [''])[0].length;
    return { at: line.start + indent, remove: 0, insert: ordered ? `${number++}. ` : '- ' };
  });
  return applyEdits(value, edits, start, end);
}

/** 把所选各行包进代码围栏；光标停在空行时插入一对围栏，光标放在中间。 */
export function wrapCodeBlock(value: string, start: number, end: number): EditResult {
  const lines = splitLines(value);
  const indexes = touchedLines(lines, start, end);
  const first = lines[indexes[0]];
  const last = lines[indexes[indexes.length - 1]];
  const eol = lineBreak(value);
  const body = value.slice(first.start, last.end);
  const open = 3 + eol.length;
  if (!body.trim()) return replaceRange(value, first.start, last.end, `\`\`\`${eol}${eol}\`\`\``, open);
  return replaceRange(value, first.start, last.end, `\`\`\`${eol}${body}${eol}\`\`\``, open, open + body.length);
}

/**
 * Tab 与 Shift+Tab：列表项与代码块中的行整体缩进或减少缩进两个空格。
 *
 * 列表项最多缩进两个空格（一级嵌套），再多就会被识别为缩进代码块。
 * 光标停在单行普通文字中按 Tab 返回 null，由编辑器插入两个空格；
 * 选中多行普通文字时不做改动。
 */
export function indentLines(value: string, start: number, end: number, outdent: boolean): EditResult | null {
  const lines = splitLines(value);
  const indexes = touchedLines(lines, start, end);
  const isItem = (text: string): boolean => LIST_ITEM.test(text) && !RULE.test(text);
  const code = indexes.every((index) => fenceRole(lines, index) === 'code');
  const listed = indexes.some((index) => isItem(lines[index].text));
  if (!outdent && !listed && !code) return indexes.length === 1 ? null : { value, start, end };
  const edits: PrefixEdit[] = [];
  for (const index of indexes) {
    const line = lines[index];
    if (!line.text.trim()) continue;
    if (outdent) {
      const lead = line.text.match(/^(?: {1,2}|\t)/);
      if (lead) edits.push({ at: line.start, remove: lead[0].length, insert: '' });
      continue;
    }
    const item = line.text.match(LIST_ITEM);
    if (!code && (!item || !isItem(line.text) || item[1].length >= 2)) continue;
    edits.push({ at: line.start, remove: 0, insert: '  ' });
  }
  return applyEdits(value, edits, start, end);
}

/** 新列表项之后的同级有序项依次重新编号，保持序号连续。 */
function renumber(value: string, fromLine: number, indent: string, previous: number): string {
  const lines = splitLines(value);
  const edits: PrefixEdit[] = [];
  let number = previous;
  for (let index = fromLine; index < lines.length; index += 1) {
    const item = lines[index].text.match(LIST_ITEM);
    if (!item || item[1] !== indent || !/^\d/.test(item[2])) break;
    number += 1;
    const digits = item[2].slice(0, -1);
    if (Number(digits) !== number) {
      edits.push({ at: lines[index].start + indent.length, remove: digits.length, insert: String(number) });
    }
  }
  return applyEdits(value, edits, 0, 0).value;
}

/**
 * 回车续写，参照 Typora。返回 null 时编辑器按普通换行处理。
 *
 * - 列表项回车生成同级新项：有序项序号加一并顺延后续序号，待办项生成未勾选的待办；
 *   空项回车时缩进的项减少一级，未缩进的项去掉项头、结束列表。
 * - 引用中回车延续引用标记，空引用行回车结束引用。
 * - 代码块内回车保留当前行缩进；左围栏行末回车且之后没有右围栏时补上右围栏。
 */
export function continueBlock(value: string, start: number, end: number): EditResult | null {
  if (start !== end) return null;
  const lines = splitLines(value);
  const index = lineIndexAt(lines, start);
  const line = lines[index];
  const column = start - line.start;
  const eol = lineBreak(value);

  const role = fenceRole(lines, index);
  if (role === 'open') {
    const fence = (line.text.match(FENCE) as RegExpMatchArray)[1];
    if (column !== line.text.length) return null;
    const closed = lines.slice(index + 1).some((other) => {
      const marker = other.text.match(FENCE);
      return marker && marker[1][0] === fence[0] && marker[1].length >= fence.length;
    });
    if (closed) return null;
    return replaceRange(value, start, end, `${eol}${eol}${fence}`, eol.length);
  }
  if (role === 'code') {
    const indent = (line.text.match(/^[ \t]*/) ?? [''])[0];
    return replaceRange(value, start, end, eol + (column >= indent.length ? indent : ''));
  }
  if (role === 'close' || RULE.test(line.text)) return null;

  const item = line.text.match(LIST_ITEM);
  if (item) {
    const prefix = item[1].length + item[2].length + item[3].length + (item[4]?.length ?? 0);
    if (column < prefix) return null;
    if (!item[5].trim()) {
      if (item[1].length) {
        return applyEdits(value, [{ at: line.start, remove: Math.min(2, item[1].length), insert: '' }], start, end);
      }
      return replaceRange(value, line.start, line.end, '', 0);
    }
    const ordered = /^\d/.test(item[2]);
    const number = ordered ? Number.parseInt(item[2], 10) + 1 : 0;
    const marker = ordered ? `${number}${item[2].slice(-1)}` : item[2];
    const next = `${item[1]}${marker}${item[3]}${item[4] ? '[ ] ' : ''}`;
    const inserted = replaceRange(value, start, end, eol + next);
    if (!ordered) return inserted;
    return { value: renumber(inserted.value, index + 2, item[1], number), start: inserted.start, end: inserted.end };
  }

  const quote = line.text.match(/^(\s{0,3}>[ \t]?)(.*)$/);
  if (quote) {
    if (column < quote[1].length) return null;
    if (!quote[2].trim()) return replaceRange(value, line.start, line.end, '', 0);
    return replaceRange(value, start, end, eol + quote[1]);
  }
  return null;
}

/* ==================== 智能粘贴 ==================== */

/** 等宽字体，用于判断网页格式的剪贴板内容是否来自代码。 */
const MONOSPACE =
  /monospace|consolas|courier|menlo|monaco|cascadia|jetbrains mono|fira code|source code|sf mono|lucida console|ubuntu mono|hack\b/i;

/**
 * 代码编辑器的语言标识换成代码块常用的写法。
 *
 * 返回 null 表示内容不是代码（Markdown 或纯文本文件），按普通文字粘贴。
 */
export function codeLanguage(mode: string): string | null {
  const name = mode.trim().toLowerCase();
  if (!name || name === 'markdown' || name === 'plaintext') return null;
  const aliases: Record<string, string> = {
    typescriptreact: 'tsx',
    javascriptreact: 'jsx',
    shellscript: 'bash',
    jsonc: 'json',
  };
  if (name in aliases) return aliases[name];
  return /^[a-z0-9#+_-]{1,20}$/.test(name) ? name : '';
}

/** 解析网页格式的剪贴板内容；没有内容或解析失败返回 null。 */
function parseHtml(html: string): Document | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  try {
    return new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
}

/** 网页格式的内容是否来自代码：主体是 pre 元素，或最外层元素使用等宽字体（代码编辑器复制时的写法）。 */
function htmlLooksLikeCode(document: Document | null, text: string): boolean {
  if (!document) return false;
  const pre = document.body.querySelector('pre');
  if (pre && (pre.textContent ?? '').trim().length >= text.trim().length * 0.8) return true;
  const first = document.body.querySelector('[style]');
  return Boolean(first && first.parentElement === document.body && MONOSPACE.test(first.getAttribute('style') ?? ''));
}

/** 网页代码块在类名中标注的语言，如 language-js、lang-python。 */
function htmlLanguage(document: Document | null): string {
  const node = document?.body.querySelector('pre code[class], pre[class]');
  const match = (node?.getAttribute('class') ?? '').match(/(?:^|\s)(?:language|lang)-([\w#+-]{1,20})/i);
  return match ? match[1].toLowerCase() : '';
}

/** 网页格式的内容是否只是一个链接（如从浏览器地址栏复制），是则返回链接文字与地址。 */
function singleLink(document: Document | null, text: string): { label: string; href: string } | null {
  if (!document) return null;
  const anchors = document.body.querySelectorAll('a[href]');
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  const label = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
  const href = anchor.getAttribute('href') ?? '';
  if (!label || !URL_PATTERN.test(href) || label === href) return null;
  // 链接之外不能还有别的文字，否则是含链接的段落，按纯文本粘贴。
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain === label || plain === href ? { label, href } : null;
}

/** 多行纯文本是否像代码：多数行带有代码特征，且至少有一行缩进或含花括号。 */
function textLooksLikeCode(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim());
  if (lines.length < 2) return false;
  // 像 Markdown 的内容不当作代码。
  if (lines.some((line) => /^\s{0,3}(?:[-+*]\s|\d+[.)]\s|#{1,6}\s|>)/.test(line))) return false;
  const signal =
    /[;{}]\s*$|^\s*[{}]\s*$|^\s*(?:import|export|from|def|class|function|fn|pub|let|const|var|return|if|for|while|#include|using|package|public|private|protected|static|SELECT|INSERT|UPDATE|DELETE)\b|=>|->|::|==|!=|&&|\|\|/;
  const matched = lines.filter((line) => signal.test(line)).length;
  const shaped = lines.some((line) => /^(?: {2,}|\t)\S/.test(line) || /[{}]/.test(line));
  return shaped && matched / lines.length >= 0.6;
}

/**
 * 智能粘贴。返回 null 时编辑器按纯文本粘贴。
 *
 * - 选中文字后粘贴网址：生成 `[文字](网址)`。
 * - 从浏览器地址栏或网页复制的单个链接：保留链接文字与地址。
 * - 来自代码编辑器或看起来像代码的多行文字：包进代码块，能得知语言时一并写上；
 *   来自代码编辑器的单行文字包成行内代码。
 * - 光标在代码块或行内代码中时一律按纯文本粘贴。
 */
export function smartPaste(value: string, start: number, end: number, clip: ClipboardContent): EditResult | null {
  const text = clip.text;
  if (!text) return null;
  const lines = splitLines(value);
  const index = lineIndexAt(lines, start);
  const line = lines[index];
  if (fenceRole(lines, index) || insideInlineCode(line.text, start - line.start)) return null;

  const selected = value.slice(start, end);
  const trimmed = text.trim();
  if (selected.trim() && !/[\r\n]/.test(selected) && URL_PATTERN.test(trimmed)) {
    return replaceRange(value, start, end, `[${escapeLabel(selected)}](${trimmed})`);
  }

  const document = parseHtml(clip.html ?? '');
  const link = singleLink(document, text);
  if (link && !/[\r\n]/.test(trimmed)) {
    return replaceRange(value, start, end, `[${escapeLabel(link.label)}](${link.href})`);
  }

  const fromEditor = typeof clip.codeLanguage === 'string';
  const code = fromEditor || htmlLooksLikeCode(document, text);
  const multiline = /[\r\n]/.test(trimmed);
  if (multiline && (code || textLooksLikeCode(text)) && !FENCE.test(trimmed)) {
    const eol = lineBreak(value);
    const body = text.replace(/\r\n|\r|\n/g, eol).replace(/\s+$/, '');
    const lastLine = lines[lineIndexAt(lines, end)];
    const lead = value.slice(line.start, start).trim() ? eol : '';
    const tail = value.slice(end, lastLine.end).trim() ? eol : '';
    const fence = `\`\`\`${fromEditor ? clip.codeLanguage : htmlLanguage(document)}`;
    const block = `${lead}${fence}${eol}${body}${eol}\`\`\``;
    return replaceRange(value, start, end, block + tail, block.length);
  }
  if (!multiline && code && trimmed && !trimmed.includes('`')) {
    return replaceRange(value, start, end, `\`${trimmed}\``);
  }
  return null;
}
