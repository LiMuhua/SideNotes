/**
 * 附件副本。
 *
 * 粘贴的截图与引用的文件都复制一份到应用数据目录中维护，记录只引用这份副本，
 * 原始文件移动、改名或删除后引用仍然有效。图片插入为内嵌图片，其它文件插入为文件引用。
 */

import * as bridge from './bridge';
import { filePath, isImageName, isLegacyToken, toMarkdownImage, toMarkdownReference } from './files';
import { removeRange } from './transfer';

/** 一组导入后的附件写成 Markdown：图片为内嵌图片，其它为文件引用，多个时每个一行。 */
export function referencesFor(files: ReadonlyArray<bridge.ImportedFile>): string {
  return files
    .map((file) => (isImageName(file.name) ? toMarkdownImage(file.path, file.name) : toMarkdownReference(file.path, file.name)))
    .join('\n');
}

/**
 * 粘贴内容的文件名。剪贴板中的截图没有文件名（浏览器统一叫 image.png），改用粘贴时间命名，
 * 便于在附件文件夹中辨认；资源管理器中复制的文件保留原名。
 */
export function pastedName(file: { name: string; type: string }, index: number, now = new Date()): string {
  if (file.name && !/^image\.(?:png|jpe?g|gif|bmp|webp)$/i.test(file.name)) return file.name;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
  const extension = ((file.type.split('/')[1] ?? '') || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
  return `截图-${stamp}${index ? `-${index + 1}` : ''}.${extension}`;
}

/** 保存粘贴的截图或文件，返回插入编辑器的 Markdown。 */
export async function importPastedFiles(files: ReadonlyArray<File>): Promise<string> {
  const imported: bridge.ImportedFile[] = [];
  for (const [index, file] of files.entries()) {
    imported.push(await bridge.importAttachment(file, pastedName(file, index)));
  }
  return referencesFor(imported);
}

/** 用系统对话框选择文件并复制为副本，返回插入的 Markdown；取消选择时返回 null。 */
export async function chooseAndImportFiles(): Promise<string | null> {
  const paths = await bridge.chooseFiles();
  if (!paths?.length) return null;
  return referencesFor(await bridge.importFiles(paths));
}

/**
 * 附件的 Markdown 原文拆成种类、名称与地址（原型 parseAttachmentMarkdown）：图片 `![名称](地址)`，文件 `[名称](地址)`，
 * 文件的地址要是本机路径；不是单个附件引用时返回 null。附件弹窗据此让预览跟着原文变。
 */
export function parseAttachmentSource(markdown: string): { kind: 'image' | 'file'; label: string; target: string } | null {
  const match = /^(!?)\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)>]*?)>?\s*\)$/.exec(String(markdown ?? '').trim());
  if (!match || !match[3]) return null;
  const label = match[2].replace(/\\([\\[\]])/g, '$1');
  const target = match[3].trim();
  if (match[1]) return { kind: 'image', label, target };
  return filePath(target) ? { kind: 'file', label, target } : null;
}

/** 原文中的一个附件引用：范围 [start, end) 与当时的原文。 */
export interface ReferenceSpan {
  start: number;
  end: number;
  source: string;
}

/** 被点击的附件引用：图片或文件、在原文中的位置、地址（路径或网址）与显示文字。 */
export interface AttachmentReference extends ReferenceSpan {
  kind: 'image' | 'file';
  target: string;
  label: string;
}

/**
 * 用新的引用原文替换原文中的一个附件引用；`next` 为空串时删除这个引用（所在行只剩空白或列表标记时整行删去）。
 * 位置对不上（原文已变化）时按原引用文字重新查找，仍找不到返回 null，不做改动。
 * 返回新的原文与替换后的范围，供编辑器恢复光标。
 */
export function replaceReference(text: string, reference: ReferenceSpan, next: string): { text: string; start: number; end: number } | null {
  let { start, end } = reference;
  if (text.slice(start, end) !== reference.source) {
    const at = reference.source ? text.indexOf(reference.source) : -1;
    if (at < 0) return null;
    start = at;
    end = at + reference.source.length;
  }
  if (!next) {
    const result = removeRange(text, start, end);
    const caret = Math.min(start, result.length);
    return { text: result, start: caret, end: caret };
  }
  return { text: text.slice(0, start) + next + text.slice(end), start, end: start + next.length };
}

/** 文件名对应的图片 MIME 类型；不是常见图片时返回空串。 */
export function imageMime(name: string): string {
  const extension = (String(name).match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
  };
  return types[extension] ?? '';
}

/** 把字节写成 data URL，用于更换以 data URL 保存在记录里的图片附件。 */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  // 分段拼接，避免大图一次展开参数时超过调用栈上限。
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 取出 data URL 中的字节，用于把图片附件另存为文件；不是 base64 的 data URL 按文字编码。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(header)) return new TextEncoder().encode(decodeURIComponent(body));
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * 直接打开附件（按住 Ctrl 点击，或附件弹窗中的「打开」）：本机文件先确认仍然存在，再用系统程序打开；
 * 网络图片在浏览器中打开。不能打开时抛出原因，由调用方提示。
 */
export async function openAttachment(target: string): Promise<void> {
  const path = filePath(target);
  if (path && !isLegacyToken(path)) {
    const status = await bridge.inspectFile(path);
    if (!status.exists) throw new Error('文件不存在或已移动');
    await bridge.openFile(path);
  } else if (/^https?:/i.test(target)) {
    await bridge.openExternal(target);
  } else {
    throw new Error('这个附件不能直接打开');
  }
}
