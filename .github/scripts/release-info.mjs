/* global process, console */
/**
 * 发布前核对版本号，并取出这一版的更新日志：「发布应用」工作流（.github/workflows/release.yml）在构建前运行，本地也能跑。
 *
 * 版本号写在五处：package.json、src-tauri/tauri.conf.json、src-tauri/Cargo.toml、src-tauri/Cargo.lock（应用自己那一项）
 * 与 src/core/changelog.ts 的第一条。五处不一致，或与推送的标签（去掉开头的 v）不同，就报错退出，不构建也不发布。
 * 更新日志新版本在前，第一条的概述就是这一版 Release 的正文。
 *
 * 用法：node .github/scripts/release-info.mjs [标签]，例如 v0.8.2；不带标签时（手动运行）只核对五处彼此一致。
 * 在 GitHub Actions 中运行时，把 version 与 notes 写进步骤的输出。只用 Node 自带的模块，安装依赖之前就能运行。
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** 报错退出；在 GitHub Actions 中显示为这次运行的错误注释。 */
function fail(message) {
  console.error(process.env.GITHUB_ACTIONS === 'true' ? `::error::${message}` : message);
  process.exit(1);
}

/** 取正则的第一个分组；取不到说明文件的写法变了，报错而不是猜。 */
function pick(file, text, pattern, what) {
  const found = text.match(pattern)?.[1];
  if (found == null) fail(`${file} 里找不到${what}，写法与预期不同`);
  return found;
}

const ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/** 把字符串字面量里的转义还原成字符，规则同 JavaScript；反斜杠加换行是续行，去掉。 */
function decodeEscapes(text) {
  return text.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\s\S]))/g, (_, braced, unicode, hex, other) => {
    const code = braced ?? unicode ?? hex;
    if (code) return String.fromCodePoint(parseInt(code, 16));
    if (other === '\r\n' || other === '\n' || other === '\r') return '';
    return ESCAPES[other] ?? other;
  });
}

// 第一条更新日志：{ version: '0.8.2', summary: '……' }。从第一处 { version: '…' 开始整条匹配，不跳到后面的条目；
// 概述要是一个完整的字符串字面量，拼接或模板字符串都算写法变了。
const changelog = read('src/core/changelog.ts');
const entryPattern = /\{\s*version:\s*(['"])([^'"\\]*)\1,\s*summary:\s*(['"])((?:(?!\3)[^\\\r\n]|\\[\s\S])*)\3,?\s*\}/y;
const entryStart = changelog.search(/\{\s*version:\s*['"]/);
entryPattern.lastIndex = entryStart;
const entry = entryStart >= 0 ? entryPattern.exec(changelog) : null;
if (!entry) fail('src/core/changelog.ts 的第一条更新日志写法与预期不同');

const cargoToml = read('src-tauri/Cargo.toml');
const cargoPackage = pick('src-tauri/Cargo.toml', cargoToml, /^\[package\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m, ' [package]');
const crate = pick('src-tauri/Cargo.toml', cargoPackage, /^name\s*=\s*"([^"]+)"/m, '包名');
const lockPattern = new RegExp(`^\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = "([^"]*)"`, 'm');

const versions = {
  'package.json': JSON.parse(read('package.json')).version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': pick('src-tauri/Cargo.toml', cargoPackage, /^version\s*=\s*"([^"]*)"/m, '版本号'),
  'src-tauri/Cargo.lock': pick('src-tauri/Cargo.lock', read('src-tauri/Cargo.lock'), lockPattern, ` ${crate} 的版本号`),
  'src/core/changelog.ts': entry[2],
};

const version = versions['package.json'];
const tag = process.argv[2] ?? '';
for (const [file, value] of Object.entries(versions)) console.log(`${value === version ? '  ' : '× '}${file}: ${value}`);

const mismatched = Object.keys(versions).filter((file) => versions[file] !== version);
if (mismatched.length) fail(`版本号不一致：${mismatched.join('、')} 与 package.json 的 ${version} 不同`);
if (tag && tag !== `v${version}`) fail(`标签 ${tag} 与应用的版本 ${version} 不符，应为 v${version}`);

const notes = decodeEscapes(entry[4]).trim();
if (!notes) fail(`src/core/changelog.ts 里 ${version} 的概述是空的`);
console.log(`\n版本 ${version}${tag ? `（标签 ${tag}）` : ''}的更新日志：\n${notes}`);

// 多行的输出值用随机的结束标记，概述里不可能出现同样的一行。
const output = process.env.GITHUB_OUTPUT;
if (output) {
  const delimiter = `EOF_${randomUUID()}`;
  appendFileSync(output, `version=${version}\nnotes<<${delimiter}\n${notes}\n${delimiter}\n`);
}
