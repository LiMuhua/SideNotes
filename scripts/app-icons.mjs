/**
 * 生成应用图标资源：内置图标的多分辨率 PNG 与 ICO，以及默认图标的全套桌面图标。
 *
 * 清单是 src-tauri/icons/builtin/manifest.json，每个内置图标的母版是 `<编号>-<id>/icon.svg`（64 × 64 视图框）。
 * 栅格化交给 Tauri CLI 的 `tauri icon`（resvg），与打包桌面图标用同一个渲染器；每个尺寸都从母版直接渲染，
 * 不由大图缩小，小尺寸因此不发虚。
 *
 * 生成内容：
 * - 每个内置图标：`png/<尺寸>.png`（清单的 pngSizes）与 `icon.ico`（清单的 icoSizes，覆盖 Windows 各缩放比例下的
 *   托盘、任务栏与资源管理器）。这些文件由 tauri.conf.json 的 bundle.resources 随应用打包到安装目录的 app-icons/。
 * - 默认图标：`tauri icon` 生成 src-tauri/icons/ 下的全套平台图标（安装包、窗口、托盘、Android、iOS），
 *   其中 icon.ico 换成上面尺寸更全的版本；母版另复制到设计系统（docs/design-system/assets/app-icon.svg）
 *   与应用的网页图标（src/assets/favicon.svg）。
 *
 * 运行：pnpm icons。除 macOS 用的 icon.icns（每次编码的字节略有不同）外，输出是确定的，重复运行不会改动其它文件。
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'src-tauri', 'icons');
const BUILTIN = join(ICONS, 'builtin');
const TAURI_CLI = join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/** 母版副本：设计系统与原型引用前者，应用的关于页与网页图标引用后者。 */
const MASTER_COPIES = [join(ROOT, 'docs', 'design-system', 'assets', 'app-icon.svg'), join(ROOT, 'src', 'assets', 'favicon.svg')];

const manifest = JSON.parse(readFileSync(join(BUILTIN, 'manifest.json'), 'utf8'));

/** 调用 Tauri CLI；失败时直接退出，避免留下半套资源。 */
function tauriIcon(args) {
  const result = spawnSync(process.execPath, [TAURI_CLI, 'icon', ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) {
    console.error(`tauri icon ${args.join(' ')} 失败`);
    process.exit(result.status ?? 1);
  }
}

/**
 * 把几张 PNG 拼成 ICO：每个尺寸一项，图像数据直接用 PNG（Windows Vista 起支持，`tauri icon` 生成的 ICO 也是这种格式）。
 * 目录项的宽高只有一个字节，256 记为 0。
 */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map((image) => image.data)]);
}

const sizes = [...new Set([...manifest.pngSizes, ...manifest.icoSizes])].sort((a, b) => a - b);
const work = mkdtempSync(join(tmpdir(), 'sidenotes-icons-'));

try {
  for (const icon of manifest.icons) {
    const folder = join(BUILTIN, `${icon.number}-${icon.id}`);
    const rendered = join(work, icon.id);
    tauriIcon([join(folder, 'icon.svg'), '-o', rendered, '-p', sizes.join(',')]);
    const png = (size) => readFileSync(join(rendered, `${size}x${size}.png`));

    // 先清空 png/，清单删掉的尺寸不会残留。
    rmSync(join(folder, 'png'), { recursive: true, force: true });
    mkdirSync(join(folder, 'png'));
    for (const size of manifest.pngSizes) writeFileSync(join(folder, 'png', `${size}.png`), png(size));
    writeFileSync(join(folder, 'icon.ico'), encodeIco(manifest.icoSizes.map((size) => ({ size, data: png(size) }))));
    console.log(`内置图标 ${icon.number} ${icon.name}：${manifest.pngSizes.length} 个 PNG，ICO ${manifest.icoSizes.length} 个尺寸`);
  }

  const fallback = manifest.icons.find((icon) => icon.id === manifest.default);
  if (!fallback) throw new Error(`清单中没有默认图标 ${manifest.default}`);
  const folder = join(BUILTIN, `${fallback.number}-${fallback.id}`);
  tauriIcon([join(folder, 'icon.svg'), '-o', ICONS]);
  copyFileSync(join(folder, 'icon.ico'), join(ICONS, 'icon.ico'));
  for (const target of MASTER_COPIES) copyFileSync(join(folder, 'icon.svg'), target);
  console.log(`默认图标 ${fallback.number} ${fallback.name}：已生成 src-tauri/icons/，并更新设计系统与应用的网页图标`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
