/**
 * 导出与导入备份。
 *
 * 导出为一个文件夹：记录、草稿与设置写成 JSON，附件由后端一并复制到旁边的 attachments 文件夹
 * （见 bridge.exportBackup），便于全量导出后自行处理。JSON 中记下导出时的数据目录，
 * 导入时先把附件拷回当前数据目录，再据此把记录里的附件路径改写过来，换一台电脑导入附件也不会失效。
 */

import { normalizeDraft, normalizeNote } from './notes';
import type { Draft, Note } from './types';

/** 备份 JSON 旁边存放附件的文件夹名，与数据目录中的附件文件夹同名。 */
export const BACKUP_ATTACHMENTS = 'attachments';

/** 备份的名称：SideNotes-备份-年-月-日（本地日期），同时用作文件夹名与 JSON 文件名。 */
export function backupName(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `SideNotes-备份-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 读出的备份。 */
export interface ParsedBackup {
  notes: Note[];
  draft: Draft | null;
  /** 导出时的数据目录；旧版备份没有，为空。 */
  dataDirectory: string;
  /** 附件所在的文件夹名（相对 JSON 文件）；旧版备份只有 JSON，为空。 */
  attachmentsDirectory: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析备份 JSON，校验规则与原型 inspectImport 一致：兼容只有记录数组的旧格式，有一条无效记录即整体拒绝。 */
export function parseBackup(text: string): ParsedBackup {
  const parsed: unknown = JSON.parse(text);
  const rawNotes = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.notes : null;
  if (!Array.isArray(rawNotes) || rawNotes.length > 10000) throw new Error('未找到有效的记录列表');
  const notes = rawNotes.map(normalizeNote);
  if (notes.some((note) => !note)) throw new Error('备份含有无效记录，未导入任何内容');
  const rawDraft = isRecord(parsed) ? parsed.draft : null;
  const draft =
    isRecord(rawDraft) && typeof rawDraft.text === 'string' ? { ...normalizeDraft(rawDraft), updatedAt: Date.now() } : null;
  const field = (key: string): string => (isRecord(parsed) && typeof parsed[key] === 'string' ? String(parsed[key]) : '');
  return {
    notes: notes as Note[],
    draft,
    dataDirectory: field('dataDirectory'),
    attachmentsDirectory: field('attachmentsDirectory'),
  };
}

/**
 * 把原文中指向 `from` 数据目录附件文件夹的路径改写为 `to` 中的同一位置，反斜杠与斜杠两种写法各改一次，
 * 与后端更换存储位置时的改写一致。两个目录相同或有一个为空时原样返回。
 */
export function rewriteAttachmentPaths(text: string, from: string, to: string): string {
  if (!from || !to || from === to) return text;
  const prefix = (directory: string, separator: string): string =>
    `${directory.replace(/[\\/]+$/, '').replace(/[\\/]/g, separator)}${separator}${BACKUP_ATTACHMENTS}${separator}`;
  return ['\\', '/'].reduce((result, separator) => result.split(prefix(from, separator)).join(prefix(to, separator)), text);
}
