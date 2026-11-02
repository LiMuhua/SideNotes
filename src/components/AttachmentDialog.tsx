/**
 * 附件弹窗。
 *
 * 点击卡片或编辑面中的图片、文件引用时打开（按住 Ctrl 点击则直接打开文件，由调用方处理）：
 * 显示预览与引用的 Markdown 原文，可以直接修改原文，把新文件拖进弹窗或点「更换」替换，
 * 也可以用系统程序打开、另存为或删除这个引用。以 data URL 保存在记录里的图片附件没有原文，
 * 只提供更换、另存为与删除。
 *
 * 更换后旧的副本不再被引用，由附件清理在稍后删除（见 bridge.cleanupAttachments），撤销窗口内仍可恢复。
 */

import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import * as bridge from '../core/bridge';
import { bytesToDataUrl, dataUrlToBytes, imageMime, openAttachment, referencesFor } from '../core/attachments';
import { fileLabel, filePath, formatBytes, isLegacyToken } from '../core/files';
import { MAX_IMAGE_BYTES } from '../core/notes';
import { useToast } from '../hooks/useToast';
import type { FileStatus, NoteImage } from '../core/types';

/** 弹窗中的附件：正文里的图片或文件引用，或以 data URL 保存在记录里的图片附件。 */
export type AttachmentSubject =
  | { kind: 'image' | 'file'; source: string; target: string; label: string }
  | { kind: 'embedded'; image: NoteImage };

export interface AttachmentDialogProps {
  subject: AttachmentSubject;
  /** 能否修改；不能修改时只能查看、打开与另存为。 */
  editable?: boolean;
  /** 用新的引用原文替换（正文里的引用），空串表示删除这个引用；返回是否成功。 */
  onReplaceSource?: (source: string) => boolean | Promise<boolean>;
  /** 替换图片附件（data URL），null 表示删除；返回是否成功。 */
  onReplaceImage?: (image: NoteImage | null) => boolean | Promise<boolean>;
  /**
   * 包住系统对话框（选择文件、另存为）的调用。对话框打开期间窗口失焦，
   * 侧栏据此不把失焦当作离开：不保存正在进行的编辑，也不收起。
   */
  withSystemDialog?: <T>(run: () => Promise<T>) => Promise<T>;
  onClose: () => void;
}

const direct = <T,>(run: () => Promise<T>): Promise<T> => run();

export function AttachmentDialog({
  subject,
  editable = true,
  onReplaceSource,
  onReplaceImage,
  withSystemDialog = direct,
  onClose,
}: AttachmentDialogProps) {
  const toast = useToast();
  const embedded = subject.kind === 'embedded' ? subject.image : null;
  const reference = subject.kind === 'embedded' ? null : subject;
  // 本机文件的路径；网络图片与原型遗留的浏览器文件标识没有可用的路径。
  const rawPath = reference ? filePath(reference.target) : null;
  const path = rawPath && !isLegacyToken(rawPath) ? rawPath : null;
  const isImage = Boolean(embedded) || reference?.kind === 'image';
  const name = embedded ? embedded.name : path ? fileLabel(path) : reference?.label || reference?.target || '附件';
  const title = embedded ? embedded.name : reference?.label || name;
  const imageSource = embedded ? embedded.data : path ? bridge.localFileUrl(path) : reference?.target ?? '';

  const [draft, setDraft] = useState(reference?.source ?? '');
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 本机文件：读取是否存在与大小。
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void bridge
      .inspectFile(path)
      .then((result) => {
        if (alive) setStatus(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);

  /** 执行一个操作：进行中禁用按钮，失败时提示原因。 */
  const run = useCallback(
    async (action: () => Promise<void>, failure: string): Promise<void> => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        toast(`${failure}：${bridge.errorText(error)}`, null, true);
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  /** 用一个本机文件替换：正文里的引用复制为新的附件副本并改写引用，图片附件读成 data URL。 */
  const replaceWith = useCallback(
    async (source: string): Promise<void> => {
      if (embedded) {
        const mime = imageMime(source);
        if (!mime) throw new Error('请选择图片文件');
        const bytes = await bridge.readChosenFile(source);
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片附件不能超过 2 MB');
        const image: NoteImage = { ...embedded, name: fileLabel(source), type: mime, data: bytesToDataUrl(bytes, mime) };
        if (await onReplaceImage?.(image)) onClose();
        return;
      }
      const [file] = await bridge.importFiles([source]);
      if (file && (await onReplaceSource?.(referencesFor([file])))) onClose();
    },
    [embedded, onReplaceImage, onReplaceSource, onClose],
  );

  const chooseReplacement = (): Promise<void> =>
    run(async () => {
      const picked = await withSystemDialog(() => bridge.chooseFiles({ multiple: false, images: Boolean(embedded) }));
      if (picked?.[0]) await replaceWith(picked[0]);
    }, '未能更换');

  const open = (): Promise<void> => run(() => openAttachment(reference?.target ?? ''), '无法打开');

  const saveAs = (): Promise<void> =>
    run(async () => {
      const saved = embedded
        ? await withSystemDialog(() => bridge.saveBytesAs(dataUrlToBytes(embedded.data), embedded.name))
        : path
          ? await withSystemDialog(() => bridge.saveAttachmentAs(path, name))
          : false;
      if (saved) toast('已另存');
    }, '未能另存');

  const remove = (): Promise<void> =>
    run(async () => {
      const removed = embedded ? await onReplaceImage?.(null) : await onReplaceSource?.('');
      if (removed) onClose();
    }, '未能删除');

  const apply = (): Promise<void> =>
    run(async () => {
      const next = draft.trim();
      if (next === reference?.source || (await onReplaceSource?.(next))) onClose();
    }, '未能修改');

  /** 用拖进弹窗的文件替换：内容保存为新的附件副本并改写引用，图片附件读成 data URL。 */
  const replaceWithDropped = useCallback(
    async (file: File): Promise<void> => {
      if (embedded) {
        const mime = file.type.startsWith('image/') ? file.type : imageMime(file.name);
        if (!mime) throw new Error('请拖入图片文件');
        if (file.size > MAX_IMAGE_BYTES) throw new Error('图片附件不能超过 2 MB');
        const image: NoteImage = {
          ...embedded,
          name: file.name,
          type: mime,
          data: bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), mime),
        };
        if (await onReplaceImage?.(image)) onClose();
        return;
      }
      const imported = await bridge.importAttachment(file, file.name);
      if (await onReplaceSource?.(referencesFor([imported]))) onClose();
    },
    [embedded, onReplaceImage, onReplaceSource, onClose],
  );

  // 把文件拖进弹窗即替换（WebView2 原生拖放，见 useFileDrop）。
  const canDrop = editable && bridge.isDesktop();
  const isFiles = (event: React.DragEvent): boolean => Array.from(event.dataTransfer.types).includes('Files');
  const dropHandlers = canDrop
    ? {
        onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
          if (!isFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        },
        onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: React.DragEvent<HTMLDivElement>) => {
          if (!isFiles(event)) return;
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void run(() => replaceWithDropped(file), '未能更换');
        },
      }
    : {};

  // Esc 只关闭弹窗，不再传给侧栏（否则会顺带取消正在进行的编辑）。
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const canOpen = Boolean(path) || Boolean(reference && /^https?:/i.test(reference.target));
  const canSave = Boolean(embedded) || Boolean(path);

  return (
    <Modal
      title={title}
      className="attachment-modal"
      onClose={onClose}
      footer={
        <>
          {canOpen ? (
            <button type="button" className="button secondary" disabled={busy} onClick={() => void open()}>
              <Icon name="external" />
              打开
            </button>
          ) : null}
          {editable ? (
            <button type="button" className="button secondary" disabled={busy} onClick={() => void chooseReplacement()}>
              <Icon name="restore" />
              更换
            </button>
          ) : null}
          {canSave ? (
            <button type="button" className="button secondary" disabled={busy} onClick={() => void saveAs()}>
              <Icon name="download" />
              另存为
            </button>
          ) : null}
          {editable ? (
            // 侧栏窗口较窄，删除只放图标，与其它按钮排在一行。
            <button
              type="button"
              className="button secondary danger-text attachment-delete"
              aria-label="删除这个附件"
              title="删除这个附件"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </>
      }
    >
      <div className={dragging ? 'attachment-dialog is-dragging' : 'attachment-dialog'} {...dropHandlers}>
        {isImage ? (
          <img className="attachment-dialog-image" src={imageSource} alt={title} draggable={false} />
        ) : (
          <div className="attachment-dialog-file">
            <Icon name="file" />
            <span>{name}</span>
          </div>
        )}
        {path ? (
          <p className="attachment-dialog-meta">
            {status === null ? '正在读取…' : status.exists ? formatBytes(status.size) : '文件不存在或已移动'}
            <span title={path}>{path}</span>
          </p>
        ) : null}
        {reference ? (
          <label className="attachment-dialog-source">
            <span>Markdown 原文</span>
            <textarea
              value={draft}
              rows={3}
              spellCheck={false}
              readOnly={!editable}
              aria-label="附件引用的 Markdown 原文"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void apply();
                }
              }}
            />
          </label>
        ) : null}
        {editable && (reference || canDrop) ? (
          <div className="attachment-dialog-actions">
            <span className="attachment-dialog-hint">
              {canDrop ? (dragging ? '松开即替换为拖入的文件' : `可把新${embedded ? '图片' : '文件'}拖到这里替换`) : '修改原文后应用'}
            </span>
            {reference ? (
              <button
                type="button"
                className="button primary compact"
                disabled={busy || draft.trim() === reference.source}
                onClick={() => void apply()}
              >
                应用修改
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
