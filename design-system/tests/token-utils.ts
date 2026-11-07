/**
 * 设计系统测试用的文件读写。解析、层叠与颜色计算在 `tokens/parse.ts`，与 Playground 的令牌页共用。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTokens, type Theme } from '../tokens/parse';

export { composite, contrast, parseBlocks, parseColor, resolve, type CssBlock, type Rgba, type Theme } from '../tokens/parse';

/** design-system 目录。jsdom 环境下的全局 URL 不是 Node 的实现，这里只用字符串换算路径。 */
const DESIGN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** design-system 下某个文件的绝对路径。 */
export function designPath(relative: string): string {
  return resolvePath(DESIGN_ROOT, relative);
}

/** 读取 design-system 下的文件。 */
export function readDesignFile(relative: string): string {
  return readFileSync(designPath(relative), 'utf-8');
}

/** 写回 design-system 下的文件（只在更新文档中的令牌表时使用），统一用 LF 换行。 */
export function writeDesignFile(relative: string, content: string): void {
  writeFileSync(designPath(relative), content.replace(/\r\n/g, '\n'), 'utf-8');
}

/** 某主题某明暗模式下全部令牌的原始值。 */
export function tokensFor(surface: string, file: string, theme: Theme): Map<string, string> {
  return mergeTokens(readDesignFile('tokens/base.css'), readDesignFile(file), surface, theme);
}
