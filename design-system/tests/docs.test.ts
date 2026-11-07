/**
 * 设计规范文档的检查：
 * - 五份主题文档的附录、design-tokens.md 中由代码生成的表，与令牌文件、令牌清单一致；
 * - 五份主题文档使用同一套章节；
 * - design-system 中各文档的相对链接都指向存在的文件。
 *
 * 修改令牌后，设置环境变量 SN_UPDATE_DOCS=1 运行本测试，把生成的表写回文档，再检查差异后提交。
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPENDIX_HEADING,
  contrastPairsTable,
  replaceGenerated,
  sharedValuesTable,
  THEME_DOCS,
  THEME_SECTIONS,
  themeAppendix,
  tokenListTable,
} from './doc-tables';
import { designPath, readDesignFile, writeDesignFile } from './token-utils';

const UPDATE = process.env.SN_UPDATE_DOCS === '1';

/** 文档与期望内容一致；更新模式下写回文档。 */
function expectDocument(path: string, expected: string): void {
  const actual = readDesignFile(path);
  if (UPDATE && actual !== expected) writeDesignFile(path, expected);
  else expect(actual).toBe(expected);
}

/** design-system 下的全部 Markdown 文档（相对路径）。 */
function markdownFiles(dir = designPath('.')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [relative(designPath('.'), path)] : [];
  });
}

describe('主题文档', () => {
  it.each(THEME_DOCS)('主题 $id 的文档附录与令牌文件一致', ({ id, file }) => {
    const path = `themes/${id}.md`;
    const text = readDesignFile(path);
    expect(text).toContain(APPENDIX_HEADING);
    expectDocument(path, text.slice(0, text.indexOf(APPENDIX_HEADING)) + themeAppendix(id, file));
  });

  it.each(THEME_DOCS)('主题 $id 的文档使用统一的章节', ({ id }) => {
    const headings = readDesignFile(`themes/${id}.md`)
      .split('\n')
      .filter((line) => line.startsWith('## '));
    expect(headings).toEqual([...THEME_SECTIONS]);
  });
});

describe('design-tokens.md', () => {
  it('令牌清单、共享令牌与对比度组合与代码一致', () => {
    let text = readDesignFile('design-tokens.md');
    text = replaceGenerated(text, 'token-list', tokenListTable());
    text = replaceGenerated(text, 'shared-values', sharedValuesTable());
    text = replaceGenerated(text, 'contrast-pairs', contrastPairsTable());
    expectDocument('design-tokens.md', text);
  });
});

describe('文档链接', () => {
  it('相对链接都指向存在的文件', () => {
    // 代码块与行内代码中的 `[文字](地址)` 是示例，不是链接。
    const withoutCode = (text: string) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const missing = markdownFiles().flatMap((file) =>
      [...withoutCode(readDesignFile(file)).matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1])
        .filter((target) => !/^(?:[a-z]+:|#)/i.test(target))
        .filter((target) => !existsSync(resolve(dirname(designPath(file)), decodeURI(target.split('#')[0]))))
        .map((target) => `${file} -> ${target}`),
    );
    expect(missing).toEqual([]);
  });
});
