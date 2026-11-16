/**
 * 应用图标资源检查：内置图标的清单、母版、PNG、ICO 与打包配置互相一致（本次提出）。
 *
 * 资源由 `pnpm icons` 生成（scripts/app-icons.mjs）。改了母版或清单却忘了重新生成，或者生成后漏提交某个文件，
 * 这里会指出是哪一个；默认图标的母版副本（设计系统与应用的网页图标）和桌面图标也一并核对。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { designPath } from './token-utils';

const root = (relative: string) => designPath(`../../${relative}`);
const BUILTIN = 'src-tauri/icons/builtin';

interface Manifest {
  default: string;
  pngSizes: number[];
  icoSizes: number[];
  icons: Array<{ id: string; number: string; name: string }>;
}

const manifest = JSON.parse(readFileSync(root(`${BUILTIN}/manifest.json`), 'utf-8')) as Manifest;
const PNG_SIGNATURE = '89504e470d0a1a0a';

/** PNG 的宽高写在 IHDR 中（第 16 至 23 字节）。 */
function pngSize(data: Buffer): [number, number] {
  expect(data.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

/** ICO 目录中每一项的尺寸，并核对图像数据是同尺寸的 PNG。 */
function icoSizes(data: Buffer): number[] {
  expect(data.readUInt16LE(2)).toBe(1);
  const sizes: number[] = [];
  for (let index = 0; index < data.readUInt16LE(4); index += 1) {
    const at = 6 + index * 16;
    const size = data.readUInt8(at) || 256;
    const offset = data.readUInt32LE(at + 12);
    expect(pngSize(data.subarray(offset, offset + data.readUInt32LE(at + 8)))).toEqual([size, size]);
    sizes.push(size);
  }
  return sizes;
}

describe('应用图标清单', () => {
  it('默认图标在清单中，id 与编号不重复', () => {
    const ids = manifest.icons.map((icon) => icon.id);
    expect(ids).toContain(manifest.default);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(manifest.icons.map((icon) => icon.number)).size).toBe(ids.length);
  });

  it('目录与清单一一对应', () => {
    const folders = readdirSync(root(BUILTIN), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual(manifest.icons.map((icon) => `${icon.number}-${icon.id}`).sort());
  });
});

describe.each(manifest.icons)('内置图标 $number $name', (icon) => {
  const folder = `${BUILTIN}/${icon.number}-${icon.id}`;

  it('母版是 64 × 64 视图框的 SVG', () => {
    expect(readFileSync(root(`${folder}/icon.svg`), 'utf-8')).toMatch(/<svg[^>]*viewBox="0 0 64 64"/);
  });

  it('PNG 齐全，尺寸与文件名一致，没有多余的尺寸', () => {
    const files = readdirSync(root(`${folder}/png`)).sort();
    expect(files).toEqual(manifest.pngSizes.map((size) => `${size}.png`).sort());
    for (const size of manifest.pngSizes) {
      expect(pngSize(readFileSync(root(`${folder}/png/${size}.png`)))).toEqual([size, size]);
    }
  });

  it('ICO 含清单中的全部尺寸', () => {
    expect(icoSizes(readFileSync(root(`${folder}/icon.ico`)))).toEqual(manifest.icoSizes);
  });
});

describe('默认图标', () => {
  const fallback = manifest.icons.find((icon) => icon.id === manifest.default);
  const folder = `${BUILTIN}/${fallback?.number}-${fallback?.id}`;

  it('设计系统与应用的网页图标是默认图标的母版', () => {
    const master = readFileSync(root(`${folder}/icon.svg`), 'utf-8');
    expect(readFileSync(root('docs/design-system/assets/app-icon.svg'), 'utf-8')).toBe(master);
    expect(readFileSync(root('src/assets/favicon.svg'), 'utf-8')).toBe(master);
  });

  it('桌面图标的 ICO 与默认图标的 ICO 相同', () => {
    expect(readFileSync(root('src-tauri/icons/icon.ico')).equals(readFileSync(root(`${folder}/icon.ico`)))).toBe(true);
  });

  it('内置图标随应用打包到 app-icons/', () => {
    const config = JSON.parse(readFileSync(root('src-tauri/tauri.conf.json'), 'utf-8')) as { bundle: { resources?: Record<string, string> } };
    expect(config.bundle.resources?.['icons/builtin/']).toBe('app-icons/');
    expect(existsSync(root('src-tauri/icons/32x32.png'))).toBe(true);
  });
});
