/**
 * 附件副本。
 *
 * 粘贴的截图与引用的文件都复制一份到应用数据目录中维护，记录只引用这份副本，
 * 原始文件移动、改名或删除后引用仍然有效。图片插入为内嵌图片，其它文件插入为文件引用。
 */

import * as bridge from './bridge';
import { isImageName, toMarkdownImage, toMarkdownReference } from './files';

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
