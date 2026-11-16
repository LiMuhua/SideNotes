/**
 * 样式检查共用的规则：取出样式文件中的声明，判断其中是否写死颜色、长度与时长。
 *
 * 产品样式（styles.test.ts）与交互原型（prototype.test.ts）使用同一套规则：
 * 确需固定的数值在同一行行尾注明「固定：原因」；组件内部（--local-*）与 Markdown 编辑器运行时（--md-*）的变量不算令牌。
 */

export const LOCAL_PREFIXES = ['--local-', '--md-'];

// color-mix() 用来把令牌调成半透明，不算写死颜色；其中若混入原始颜色，仍会被十六进制与 rgb() 等规则查出。
export const RAW_VALUES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: '颜色', pattern: /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i },
  { label: '长度', pattern: /(?<![\w-])\d*\.?\d+(?:px|rem)\b/i },
  { label: '时长', pattern: /(?<![\w-])\d*\.?\d+m?s\b/i },
];

export interface Declaration {
  line: number;
  property: string;
  value: string;
  /** 声明所在的行注明了「固定：原因」。 */
  fixed: boolean;
}

/**
 * 取出样式文件中的全部声明。
 *
 * 注释先换成等长的空白，保留换行以便定位行号；遇到 `{` 丢弃前面的选择器或 @ 规则，
 * 遇到 `;` 或 `}` 时前面的文字就是一条声明。@keyframes 的帧选择器同样被丢弃，只检查其中的声明。
 */
export function declarations(css: string): Declaration[] {
  const fixedLines = new Set(
    css
      .split('\n')
      .map((text, index) => (text.includes('固定：') ? index + 1 : 0))
      .filter(Boolean),
  );
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const result: Declaration[] = [];
  let start = 0;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char !== '{' && char !== ';' && char !== '}') continue;
    const segment = code.slice(start, index);
    if (char !== '{' && segment.trim()) {
      const colon = segment.indexOf(':');
      const offset = start + segment.length - segment.trimStart().length;
      const first = code.slice(0, offset).split('\n').length;
      const last = code.slice(0, index).split('\n').length;
      let fixed = false;
      for (let line = first; line <= last; line += 1) fixed ||= fixedLines.has(line);
      result.push({
        line: first,
        property: segment.slice(0, colon).trim(),
        value: segment.slice(colon + 1).trim(),
        fixed,
      });
    }
    start = index + 1;
  }
  return result;
}
