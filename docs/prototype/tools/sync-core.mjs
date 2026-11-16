// 把现有应用 src/core 中的纯函数模块转译成交互原型可直接加载的脚本（挂到 window 上），逻辑不改：
// - shortcuts.ts → shortcuts.js（window.SideNotesShortcuts），命令表中加上设计系统提出的「打开设置」与「关闭全部记录窗口」；
// - markdown-commands.ts 与 files.ts 中的三个函数 → markdown-commands.js（window.MarkdownCommands）。
// 用法：在本仓库根目录执行 node docs/prototype/tools/sync-core.mjs <现有应用仓库的根目录>
// 需要本仓库的 node_modules 中有 typescript；应用更新这些模块后重新执行，覆盖生成的两个文件。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prototypeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const designRoot = resolve(prototypeRoot, '../..');
const appRoot = process.argv[2];
if (!appRoot) {
  console.error('用法：node docs/prototype/tools/sync-core.mjs <现有应用仓库的根目录>');
  process.exit(1);
}
const ts = createRequire(join(designRoot, 'package.json'))('typescript');

/** TypeScript 转成 ES2020，保留注释。 */
function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false },
  }).outputText;
}

/** 去掉 export 关键字，收集导出名；还有别的 export 写法时停下来，避免漏掉。 */
function unexport(code) {
  const names = [];
  const out = code.replace(/^export (function|const|let|class) ([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  if (/^export /m.test(out)) throw new Error('还有未处理的 export：' + out.match(/^export .*$/m)[0]);
  return { code: out, names };
}

function indent(code) {
  return code
    .trimEnd()
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n');
}

/** 包成立即执行的函数，导出的函数与常量冻结后挂到 window 上。 */
function wrap(header, globalName, body, names) {
  return `'use strict';\n\n${header}\n(function expose${globalName}() {\n${indent(body)}\n\n  window.${globalName} = Object.freeze({ ${names.join(', ')} });\n})();\n`;
}

// ---------- Markdown 编辑命令 ----------
{
  let source = readFileSync(join(appRoot, 'src/core/markdown-commands.ts'), 'utf-8');
  const files = readFileSync(join(appRoot, 'src/core/files.ts'), 'utf-8');
  const pick = (name) => {
    // 文档注释不能跨过别的「*/」，否则会从文件开头一路连到目标函数。
    const match = files.match(new RegExp(`(/\\*\\*(?:(?!\\*/)[^])*\\*/\\n)?export function ${name}\\b[^]*?\\n}\\n`));
    if (!match) throw new Error('files.ts 中没有 ' + name);
    return match[0].replace(/^export /m, '');
  };
  const helpers = [pick('isLegacyToken'), pick('filePath'), pick('escapeLabel')].join('\n');
  if (!source.includes("import { escapeLabel, filePath } from './files';")) throw new Error('markdown-commands.ts 的引用变了');
  source = source.replace("import { escapeLabel, filePath } from './files';", `/* 以下三个函数取自 src/core/files.ts。 */\n${helpers}`);
  const { code, names } = unexport(transpile(source));
  const header = `/**\n * Markdown 编辑命令：快捷键、回车续写与智能粘贴，只作用于原文与选区。\n * 由现有应用的 src/core/markdown-commands.ts（与 files.ts 中的三个函数）转译而来，逻辑不改；\n * 应用更新这些函数时，重新转译覆盖本文件。\n */`;
  writeFileSync(join(prototypeRoot, 'markdown-commands.js'), wrap(header, 'MarkdownCommands', code, names));
  console.log('markdown-commands.js', names.length);
}

// ---------- 快捷键 ----------
{
  let source = readFileSync(join(appRoot, 'src/core/shortcuts.ts'), 'utf-8');
  const search = "  { id: 'search', label: '搜索记录与标签', group: 'app', defaultKeys: 'Ctrl+F' },\n";
  if (!source.includes(search)) throw new Error('shortcuts.ts 的命令表变了');
  // 「打开设置」与「关闭全部记录窗口」是设计系统提出的应用内快捷键，现有应用 0.7.3 还没有。
  // 关闭全部记录窗口默认 Alt+Shift+W：浏览器保留了 Ctrl+W 与 Ctrl+Shift+W，原型中按不到。
  source = source.replace(
    search,
    search +
      "  // 本次提出：打开设置（Playground 的 shortcuts.ts），现有应用 0.7.3 还没有这一项。\n  { id: 'settings', label: '打开设置', group: 'app', defaultKeys: 'Ctrl+,' },\n" +
      "  // 本次提出：关闭全部记录窗口（原型的记录窗口），现有应用 0.7.3 还没有记录窗口。\n  { id: 'closeWindows', label: '关闭全部记录窗口', group: 'app', defaultKeys: 'Alt+Shift+W' },\n",
  );
  source = source.replace(/\n  \| 'search'\n/, "\n  | 'search'\n  | 'settings'\n  | 'closeWindows'\n");
  const { code, names } = unexport(transpile(source));
  const header = `/**\n * 快捷键：可以重新绑定的命令、按键的规范写法、事件匹配与冲突检查。\n * 由现有应用 0.7.3 的 src/core/shortcuts.ts 转译而来，逻辑不改；只在命令表中加了「打开设置」与「关闭全部记录窗口」（本次提出）。\n * 应用更新快捷键时，重新转译覆盖本文件。\n */`;
  writeFileSync(join(prototypeRoot, 'shortcuts.js'), wrap(header, 'SideNotesShortcuts', code, names));
  console.log('shortcuts.js', names.length);
}
