/**
 * 标签解析与序列化。
 *
 * 规则沿用原型：标签以 `#名称` 声明，解析后统一移到正文末尾的独立行。
 * 行内代码、转义字符、代码围栏与缩进代码块内的 `#` 不视为标签；
 * 十六进制色值（如 `#45694e`）也排除，避免 CSS 片段被识别成分组。
 */

/** 标签匹配键：忽略大小写与全角差异。 */
export function tagKey(tag: string): string {
  return String(tag ?? '')
    .replace(/^#/, '')
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase();
}

/** 标记行内代码与转义字符占用的位置，避免误识别标签。 */
function protectedPositions(line: string): boolean[] {
  const flags = Array<boolean>(line.length).fill(false);
  const pattern = /(`+)([\s\S]*?)\1|\\./g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    for (let index = match.index; index < match.index + match[0].length; index += 1) {
      flags[index] = true;
    }
  }
  return flags;
}

/** 判断标签是否与常见十六进制颜色冲突。 */
function isHexColor(tag: string): boolean {
  return /^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(tag) && /[a-f]/i.test(tag);
}

/** 正文与标签的解析结果。 */
export interface ParsedNote {
  body: string;
  tags: string[];
}

/**
 * 标签行的起点（原型 content.js 的 tagLineStart）：原文末尾只有标签（#a #b）的那一行从哪里开始；没有标签行时为 -1。
 */
export function tagLineStart(source: string): number {
  const match = /(?:^|\n)([\t ]*#[\p{L}\p{N}_-]+(?:[\t ]+#[\p{L}\p{N}_-]+)*[\t ]*)\s*$/u.exec(String(source ?? ''));
  return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : -1;
}

/**
 * 正文末尾（原型 bodyEnd）：标签行之前最后一个非空字符之后。进入编辑时光标放在这里，接着写正文，而不是落在标签行末尾；
 * 只有标签、没有正文时放在全文末尾，免得输入的文字并进标签行。
 */
export function bodyEnd(source: string): number {
  const text = String(source ?? '');
  const tags = tagLineStart(text);
  const body = (tags < 0 ? text : text.slice(0, tags)).replace(/\s+$/, '');
  return body ? body.length : text.length;
}

/**
 * 解析正文末尾或独立行声明的标签。
 *
 * 保留 Markdown 代码块与标题；返回去重后的标签原文（保持用户书写的大小写）。
 */
export function parse(text: string): ParsedNote {
  const tags: string[] = [];
  const seen = new Set<string>();
  let fence: { character: string; length: number } | null = null;

  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!fence) fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        else if (fence.character === fenceMatch[1][0] && fenceMatch[1].length >= fence.length) fence = null;
        return line;
      }
      if (fence || /^ {4}|^\t/.test(line)) return line;

      const flags = protectedPositions(line);
      const suffix = line.match(/(?:^|[\t ])((?:#[\p{L}\p{N}_-]+[\t ]*)+)$/u);
      if (!suffix || suffix.index === undefined) return line;

      const start = suffix.index + suffix[0].indexOf(suffix[1]);
      const tokenPattern = /#([\p{L}\p{N}_-]+)/gu;
      const removals: Array<[number, number]> = [];
      let token: RegExpExecArray | null;
      while ((token = tokenPattern.exec(suffix[1]))) {
        const position = start + token.index;
        if (flags[position] || isHexColor(token[1])) continue;
        const key = tagKey(token[1]);
        if (!seen.has(key)) {
          seen.add(key);
          tags.push(token[1]);
        }
        removals.push([position, position + token[0].length]);
      }
      if (!removals.length) return line;

      let result = line;
      removals.reverse().forEach(([from, to]) => {
        result = result.slice(0, from) + result.slice(to);
      });
      return result.trimEnd();
    });

  return {
    body: tags.length ? lines.join('\n').replace(/\n+$/, '') : String(text ?? ''),
    tags,
  };
}

/** 将标签统一写入正文末尾的独立行。 */
export function compose(body: string, tags: string[] = []): string {
  const unique = new Map<string, string>();
  tags.forEach((tag) => {
    const name = String(tag ?? '')
      .replace(/^#/, '')
      .trim();
    if (/^[\p{L}\p{N}_-]+$/u.test(name) && !unique.has(tagKey(name))) unique.set(tagKey(name), name);
  });
  const content = String(body ?? '');
  const suffix = Array.from(unique.values())
    .map((tag) => `#${tag}`)
    .join(' ');
  if (!suffix) return content;
  const trimmed = content.replace(/\n+$/, '');
  return trimmed ? `${trimmed}\n\n${suffix}` : suffix;
}

/** 规范正文与标签的位置，保存前调用。 */
export function canonicalize(text: string): string {
  const content = parse(text);
  return content.tags.length ? compose(content.body, content.tags) : String(text ?? '');
}

/** 从一条记录移除指定标签，不影响其他记录。 */
export function removeTag(text: string, tag: string): string {
  const content = parse(text);
  return compose(
    content.body,
    content.tags.filter((value) => tagKey(value) !== tagKey(tag)),
  );
}

/** 校验标签：最多 40 字，限文字、数字、下划线与短横线，且能被解析器识别。 */
export function isValidTag(tag: string): boolean {
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(tag)) return false;
  return parse(`#${tag}`).tags.some((item) => tagKey(item) === tagKey(tag));
}

/** 检查记录是否包含指定标签。 */
export function hasTag(text: string, tag: string): boolean {
  return parse(text).tags.some((item) => tagKey(item) === tagKey(tag));
}

/** 给原文带上一个标签；已经带着（不分大小写）时不变。 */
export function withTag(text: string, tag: string): string {
  const parsed = parse(text);
  return parsed.tags.some((item) => tagKey(item) === tagKey(tag)) ? text : compose(parsed.body, [...parsed.tags, tag]);
}
