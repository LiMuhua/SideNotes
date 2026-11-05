/**
 * 设计系统测试用的文件读取。解析、层叠与颜色计算在 `tokens/parse.ts`，与 Playground 的令牌页共用。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTokens, type Theme } from '../tokens/parse';

export { composite, contrast, parseBlocks, parseColor, resolve, type CssBlock, type Rgba, type Theme } from '../tokens/parse';

/** design-system 目录。jsdom 环境下的全局 URL 不是 Node 的实现，这里只用字符串换算路径。 */
const DESIGN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** 读取 design-system 下的文件。 */
export function readDesignFile(relative: string): string {
  return readFileSync(resolvePath(DESIGN_ROOT, relative), 'utf-8');
}

/** 某方向某主题下全部令牌的原始值。 */
export function tokensFor(direction: string, file: string, theme: Theme): Map<string, string> {
  return mergeTokens(readDesignFile('tokens/base.css'), readDesignFile(file), direction, theme);
}
