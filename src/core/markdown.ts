/**
 * Markdown 解析为抽象语法树。
 *
 * 与原型的 `renderMarkdown` 行为一致，但输出 AST 而非 DOM：React 侧据此渲染，
 * 避免把 DOM 操作混进组件，也便于单元测试解析规则本身。
 *
 * 安全约定沿用原型：原生 HTML 一律保留为文字，链接只允许 http/https/mailto，
 * 图片只允许 data:image 与 https，其他地址降级为普通文本。
 * 例外是 Typora 写法的下划线 `<u>…</u>`：只识别这一对不带属性的标签。
 */

import { filePath } from './files';

/* ==================== 行内节点 ==================== */

/** 节点在解析输入中的范围 [start, end)，用于在原文中定位可拖动的图片与文件引用。 */
export interface SourceSpan {
  start: number;
  end: number;
}

/** 行内节点。 */
export type InlineNode =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] }
  | { kind: 'del'; children: InlineNode[] }
  | { kind: 'underline'; children: InlineNode[] }
  | { kind: 'link'; href: string; children: InlineNode[] }
  | ({ kind: 'image'; src: string; alt: string } & SourceSpan)
  | ({ kind: 'file'; path: string; label: string } & SourceSpan);

/* ==================== 块级节点 ==================== */

/** 列表项，`task` 非空表示可交互待办。 */
export interface ListItem {
  children: InlineNode[];
  /** 待办状态字符在原文中的偏移，用于点击后只替换该字符。 */
  taskOffset?: number;
  checked?: boolean;
}

/** 块级节点所占的行 [line, lineEnd)，行号相对解析输入；卡片拖放按它计算插入位置。 */
export interface LineSpan {
  line: number;
  lineEnd: number;
}

/** 块级节点。 */
export type BlockNode = LineSpan &
  (
    | { kind: 'paragraph'; children: InlineNode[] }
    | { kind: 'heading'; level: number; children: InlineNode[] }
    | { kind: 'code'; value: string; language: string }
    | { kind: 'quote'; children: BlockNode[] }
    | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
    | { kind: 'rule' }
    | ({ kind: 'file'; path: string } & SourceSpan)
  );

/** 校验允许打开的网络地址。 */
export function safeLink(value: string): string | null {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** 校验图片来源。 */
export function safeImage(value: string): string | null {
  const source = String(value ?? '').trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)(?:;[^,]*)?,/i.test(source)) return source;
  const link = safeLink(source);
  return link && /^https?:/i.test(link) ? link : null;
}

/** 解析链接括号并提取地址，支持路径空格与 URL 内嵌括号。 */
function linkTarget(text: string, start: number): { target: string; end: number } | null {
  if (text[start] !== '(') return null;
  let depth = 1;
  let quote = '';
  let end = start + 1;
  for (; end < text.length; end += 1) {
    const character = text[end];
    // Windows 路径中的反斜杠不是转义符。
    if (character === '\\' && !/^[a-z]:[\\/]/i.test(text.slice(start + 1))) {
      end += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if ((character === '"' || character === "'") && /\s/.test(text[end - 1] ?? '')) {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  let target = text.slice(start + 1, end).trim();
  // 去掉 Markdown 标题串，如 (url "标题")。
  target = target.replace(/\s+["'][^"']*["']\s*$/, '').trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  return { target, end: end + 1 };
}

/** 查找未转义的链接文字结束位置。 */
function nextLabelEnd(text: string, start: number): number {
  let end = text.indexOf('](', start);
  while (end >= 0) {
    let escapes = 0;
    for (let index = end - 1; index >= 0 && text[index] === '\\'; index -= 1) escapes += 1;
    if (escapes % 2 === 0) return end;
    end = text.indexOf('](', end + 2);
  }
  return -1;
}

/**
 * 解析行内 Markdown。`depth` 限制嵌套层数，避免恶意输入造成深递归；
 * `base` 为 `text` 在整段解析输入中的起点，用于记录图片与文件引用的位置。
 */
export function parseInline(text: string, depth = 0, base = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  if (depth > 8) {
    if (text) nodes.push({ kind: 'text', value: text });
    return nodes;
  }

  const plain: string[] = [];
  const candidates = /[\\`*_~[!<]|https?:\/\/|mailto:/gi;
  const automaticLink = /(?:https?:\/\/|mailto:)[^\s<>]+/iy;
  const underlineClose = /<\/u>/gi;
  const failedClosers = new Map<string, number>();
  let position = 0;

  /** 输出累积的普通文本。 */
  const flush = (): void => {
    if (plain.length) {
      nodes.push({ kind: 'text', value: plain.join('') });
      plain.length = 0;
    }
  };

  /** 查找闭合定界符，缓存已确认无闭合符的后缀以避免重复扫描。 */
  const closingMarker = (marker: string, start: number, exactTicks = false): number => {
    const failed = failedClosers.get(marker);
    if (failed !== undefined && start >= failed) return -1;
    let end = text.indexOf(marker, start);
    while (end >= 0) {
      const valid = exactTicks
        ? text[end - 1] !== '`' && text[end + marker.length] !== '`'
        : end > start && !/\s/.test(text[end - 1] ?? '');
      if (valid) return end;
      end = text.indexOf(marker, end + marker.length);
    }
    failedClosers.set(marker, start);
    return -1;
  };

  while (position < text.length) {
    // 普通文字整段跳过，只在语法标记或 URL 开头进入解析。
    candidates.lastIndex = position;
    const candidate = candidates.exec(text);
    if (!candidate) {
      plain.push(text.slice(position));
      break;
    }
    if (candidate.index > position) plain.push(text.slice(position, candidate.index));
    position = candidate.index;
    const character = text[position];

    if (character === '\\' && /[\\`*_{}[\]()#+.!~>-]/.test(text[position + 1] ?? '')) {
      plain.push(text[position + 1]);
      position += 2;
      continue;
    }

    if (character === '`') {
      let openingEnd = position + 1;
      while (text[openingEnd] === '`') openingEnd += 1;
      const marker = text.slice(position, openingEnd);
      const codeEnd = closingMarker(marker, openingEnd, true);
      if (codeEnd >= 0) {
        flush();
        nodes.push({ kind: 'code', value: text.slice(openingEnd, codeEnd).replace(/\n/g, ' ') });
        position = codeEnd + marker.length;
        continue;
      }
      plain.push(marker);
      position = openingEnd;
      continue;
    }

    if (character === '<' && text.slice(position, position + 3).toLowerCase() === '<u>') {
      underlineClose.lastIndex = position + 3;
      const close = underlineClose.exec(text);
      if (close && close.index > position + 3) {
        flush();
        nodes.push({
          kind: 'underline',
          children: parseInline(text.slice(position + 3, close.index), depth + 1, base + position + 3),
        });
        position = close.index + close[0].length;
        continue;
      }
    }

    const isImage = character === '!' && text[position + 1] === '[';
    if (isImage || character === '[') {
      const labelStart = position + (isImage ? 2 : 1);
      const labelEnd = nextLabelEnd(text, labelStart);
      if (labelEnd >= 0) {
        const destination = linkTarget(text, labelEnd + 1);
        if (destination) {
          const label = text.slice(labelStart, labelEnd);
          const path = filePath(destination.target);
          if (isImage) {
            const address = safeImage(destination.target);
            if (address) {
              flush();
              nodes.push({ kind: 'image', src: address, alt: label, start: base + position, end: base + destination.end });
              position = destination.end;
              continue;
            }
          } else {
            const address = safeLink(destination.target);
            if (path) {
              flush();
              nodes.push({
                kind: 'file',
                path,
                label: label.replace(/\\([\\[\]])/g, '$1'),
                start: base + position,
                end: base + destination.end,
              });
              position = destination.end;
              continue;
            }
            if (address) {
              flush();
              nodes.push({ kind: 'link', href: address, children: parseInline(label, depth + 1, base + labelStart) });
              position = destination.end;
              continue;
            }
          }
        }
      }
    }

    if (character === '*' || character === '_' || character === '~') {
      const doubled = text[position + 1] === character;
      const markers: string[] = doubled ? [character + character] : [];
      if (character !== '~') markers.push(character);
      let consumed = false;
      for (const marker of markers) {
        const start = position + marker.length;
        if (!text[start] || /\s/.test(text[start])) continue;
        const end = closingMarker(marker, start);
        if (end < 0) continue;
        flush();
        const children = parseInline(text.slice(start, end), depth + 1, base + start);
        if (marker === '~~') nodes.push({ kind: 'del', children });
        else if (marker.length === 2) nodes.push({ kind: 'strong', children });
        else nodes.push({ kind: 'em', children });
        position = end + marker.length;
        consumed = true;
        break;
      }
      if (consumed) continue;
    }

    // 裸链接：仅在行首或空白、左括号之后识别，避免切断已有语法。
    automaticLink.lastIndex = position;
    const autoCandidate =
      /[hHmM]/.test(character) && (position === 0 || /[\s(]/.test(text[position - 1] ?? ''))
        ? automaticLink.exec(text)
        : null;
    if (autoCandidate) {
      // 去掉尾随标点，中英文句读都不计入地址。
      const address = autoCandidate[0].replace(/[.,，。；;!?！)]+$/, '');
      const safe = safeLink(address);
      if (safe) {
        flush();
        nodes.push({ kind: 'link', href: safe, children: [{ kind: 'text', value: address }] });
        position += address.length;
        continue;
      }
    }

    plain.push(candidate[0]);
    position += candidate[0].length;
  }

  flush();
  return nodes;
}

/** 判断是否开始新的块结构，用于段落内的软换行合并。 */
function startsBlock(line: string): boolean {
  return (
    /^\s*$|^(?: {4}|\t)|^\s{0,3}(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s)|^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(
      line,
    ) || Boolean(filePath(line))
  );
}

/** 解析选项。 */
interface ParseOptions {
  /** 各行在原文中的起始偏移，引用块递归时由外层提供。 */
  sourceOffsets?: number[];
}

/**
 * 将 Markdown 解析为块级 AST。
 *
 * 待办项记录状态字符在原文中的偏移，使卡片内勾选只替换单个字符，
 * 保留其余原文、换行与标签位置。
 */
export function parseBlocks(text: string, options: ParseOptions = {}): BlockNode[] {
  const source = String(text ?? '');
  const lines = source.split(/\r\n|\r|\n/);
  const blocks: BlockNode[] = [];

  // 计算每行原文偏移，兼容 CRLF。
  let scan = 0;
  const lineOffsets =
    options.sourceOffsets ??
    lines.map((line) => {
      const start = scan;
      const breakLength = source.slice(scan + line.length, scan + line.length + 2) === '\r\n' ? 2 : 1;
      scan += line.length + breakLength;
      return start;
    });

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    // 本块的第一行；各分支先移动 index 再加入块，使 lineEnd 为块后的第一行。
    const first = index;

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      const close = new RegExp(`^\\s{0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      while (index < lines.length && !close.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', value: body.join('\n'), language: fence[2] || '', line: first, lineEnd: index });
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^(?: {4}|\t)/.test(lines[index])) {
        body.push(lines[index++].replace(/^(?: {4}|\t)/, ''));
      }
      blocks.push({ kind: 'code', value: body.join('\n'), language: '', line: first, lineEnd: index });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      const contentStart = (line.match(/^\s{0,3}#{1,6}\s+/) ?? [''])[0].length;
      index += 1;
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2], 0, lineOffsets[first] + contentStart),
        line: first,
        lineEnd: index,
      });
      continue;
    }

    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      index += 1;
      blocks.push({ kind: 'rule', line: first, lineEnd: index });
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      const offsets: number[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        const stripped = lines[index].replace(/^\s{0,3}>\s?/, '');
        offsets.push(lineOffsets[index] + lines[index].length - stripped.length);
        body.push(stripped);
        index += 1;
      }
      blocks.push({
        kind: 'quote',
        children: parseBlocks(body.join('\n'), { sourceOffsets: offsets }),
        line: first,
        lineEnd: index,
      });
      continue;
    }

    const item = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const items: ListItem[] = [];
      const start = ordered ? Number.parseInt(item[1], 10) : 1;
      let next: RegExpMatchArray | null;
      while (
        index < lines.length &&
        (next = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/)) &&
        /^\d/.test(next[1]) === ordered
      ) {
        const task = next[2].match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          // 状态字符位于 "[" 之后一位。
          const taskOffset = lineOffsets[index] + lines[index].length - next[2].length + 1;
          items.push({
            children: parseInline(task[2], 0, lineOffsets[index] + lines[index].length - task[2].length),
            taskOffset,
            checked: task[1].toLowerCase() === 'x',
          });
        } else {
          items.push({ children: parseInline(next[2], 0, lineOffsets[index] + lines[index].length - next[2].length) });
        }
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, start, items, line: first, lineEnd: index });
      continue;
    }

    const path = filePath(line);
    if (path) {
      index += 1;
      blocks.push({
        kind: 'file',
        path,
        start: lineOffsets[first],
        end: lineOffsets[first] + line.length,
        line: first,
        lineEnd: index,
      });
      continue;
    }

    // 段落：连续的非块级行以软换行合并。
    const children = parseInline(line, 0, lineOffsets[first]);
    index += 1;
    while (index < lines.length && !startsBlock(lines[index])) {
      children.push({ kind: 'text', value: '\n' });
      children.push(...parseInline(lines[index], 0, lineOffsets[index]));
      index += 1;
    }
    blocks.push({ kind: 'paragraph', children, line: first, lineEnd: index });
  }

  return blocks;
}

/** 检测记录包含的内容类型，用于卡片的格式标记。 */
export function getFeatures(text: string, hasImages = false): string[] {
  const features: string[] = [];
  if (text.trim()) features.push('文本');
  if (/(?:^|\n)(?:\s{0,3}(?:`{3,}|~{3,})| {4}|\t)|`[^`]+`/.test(text)) features.push('代码');
  if (/https?:\/\/|mailto:/i.test(text)) features.push('链接');
  if (/!\[[^\]]*\]\(/.test(text) || hasImages) features.push('图片');
  if (/sidenotes-file:|file:\/\/|(?:^|\n)\s*[a-z]:[\\/]|\]\(<?[a-z]:[\\/]/i.test(text)) features.push('文件');
  return features.length ? features : ['文本'];
}
