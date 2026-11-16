/**
 * 设计规范中由代码生成的表：五套主题文档的附录，以及 design-tokens.md 中的令牌清单、共享令牌与对比度组合。
 *
 * 令牌的名称与含义取自 `tokens/schema.ts`，取值取自令牌文件，对比度组合取自 `tokens/parse.ts`，
 * 文档里不手写这些数值。docs.test.ts 检查文档与这里生成的内容一致；
 * 设置环境变量 SN_UPDATE_DOCS=1 运行该测试时，改为把生成的内容写回文档。
 */

import { KEY_CONTRAST_PAIRS, parseBlocks } from '../tokens/parse';
import { GROUP_LABELS, TOKENS } from '../tokens/schema';
import { readDesignFile, tokensFor } from './token-utils';

export const THEME_DOCS = [
  { id: 'terminal', file: 'tokens/terminal.css' },
  { id: 'magazine', file: 'tokens/magazine.css' },
  { id: 'paper', file: 'tokens/paper.css' },
  { id: 'win11', file: 'tokens/win11.css' },
  { id: 'glass', file: 'tokens/glass.css' },
] as const;

/** 主题文档统一的章节，最后一节由代码生成。 */
export const THEME_SECTIONS = [
  '## 一、定位',
  '## 二、结构',
  '## 三、颜色',
  '## 四、字体与排版',
  '## 五、形状、间距与尺寸',
  '## 六、层次与立体感',
  '## 七、状态',
  '## 八、编辑模式',
  '## 九、动效',
  '## 十、实现与平台',
  '## 十一、已知限制',
  '## 附录：令牌取值',
] as const;

export const APPENDIX_HEADING = THEME_SECTIONS[THEME_SECTIONS.length - 1];

const code = (value: string) => `\`${value}\``;

const lines = (rows: string[]) => `${rows.join('\n')}\n`;

/** 主题文档的附录：这套主题的全部取值。 */
export function themeAppendix(id: string, file: string): string {
  const light = tokensFor(id, file, 'light');
  const dark = tokensFor(id, file, 'dark');
  const rows = [
    APPENDIX_HEADING,
    '',
    `以下是 [${file}](../${file}) 中的全部取值，由令牌文件生成，\`docs/design-system/tests/docs.test.ts\` 检查两者一致。` +
      '共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。',
    '',
    '### 随明暗变化',
    '',
    '| 令牌 | 浅色 | 深色 |',
    '| --- | --- | --- |',
    ...TOKENS.filter((token) => token.themed).map(
      (token) => `| ${code(token.name)} | ${code(light.get(token.name) ?? '')} | ${code(dark.get(token.name) ?? '')} |`,
    ),
    '',
    '### 不随明暗变化',
    '',
    '| 令牌 | 取值 |',
    '| --- | --- |',
    ...TOKENS.filter((token) => !token.themed && !token.shared).map((token) => `| ${code(token.name)} | ${code(light.get(token.name) ?? '')} |`),
  ];
  return lines(rows);
}

/** design-tokens.md：全部令牌的分组、含义与取值位置。 */
export function tokenListTable(): string {
  return lines([
    '| 分组 | 令牌 | 含义 | 随明暗变化 | 取值写在 |',
    '| --- | --- | --- | --- | --- |',
    ...TOKENS.map(
      (token) =>
        `| ${GROUP_LABELS[token.group]} | ${code(token.name)} | ${token.meaning} | ${token.themed ? '是' : '否'} | ${token.shared ? 'base.css' : '各主题的令牌文件'} |`,
    ),
  ]);
}

/** design-tokens.md：共享令牌的取值。 */
export function sharedValuesTable(): string {
  const root = parseBlocks(readDesignFile('tokens/base.css')).find((block) => block.selector === ':root');
  return lines([
    '| 令牌 | 取值 |',
    '| --- | --- |',
    ...TOKENS.filter((token) => token.shared).map((token) => `| ${code(token.name)} | ${code(root?.declarations.get(token.name) ?? '')} |`),
  ]);
}

/** design-tokens.md：Playground 令牌页与测试共用的关键对比度组合。 */
export function contrastPairsTable(): string {
  return lines([
    '| 组合 | 前景 | 叠放的表面（由下到上） | 最低对比度 |',
    '| --- | --- | --- | --- |',
    ...KEY_CONTRAST_PAIRS.map((pair) => `| ${pair.label} | ${code(pair.foreground)} | ${pair.layers.map(code).join(' + ')} | ${pair.minimum}:1 |`),
  ]);
}

/** 替换文档中一对标记之间的内容：`<!-- generated:名称 -->` 与 `<!-- /generated:名称 -->`。 */
export function replaceGenerated(text: string, name: string, content: string): string {
  const start = `<!-- generated:${name} -->`;
  const end = `<!-- /generated:${name} -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`缺少标记：${start}`);
  return `${text.slice(0, from + start.length)}\n${content}${text.slice(to)}`;
}
