/**
 * 附件弹窗（原型第二版，与交互原型 app.js 的 openAttachment 相同）。
 *
 * 点击卡片或编辑面中的图片、文件引用时打开（按住 Ctrl 点击则直接打开文件，由调用方处理）。
 * - 标题是附件名。图片在上方预览；文件不显示预览（文件块看不到内容，只重复了标题中的名称）。
 * - 正文中的引用下面是 Markdown 原文，完整显示在一个随内容加高的输入框里；修改时上方的预览跟着变，
 *   点「应用修改」或按 Ctrl+Enter 才写回。以 data URL 保存在记录里的图片附件没有原文。
 * - 底栏左侧是打开（正文中的引用）、更换、另存为与删除，右侧是「应用修改」，原文没有改动时不可用。
 * - 桌面端另外可以把新文件拖进弹窗替换（拖动时弹窗描边），不写提示文字。
 *
 * 更换后旧的副本不再被引用，由附件清理在稍后删除（见 bridge.cleanupAttachments），撤销窗口内仍可恢复。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { Modal } from './Modal';
import * as bridge from '../core/bridge';
import { bytesToDataUrl, dataUrlToBytes, imageMime, openAttachment, parseAttachmentSource, referencesFor } from '../core/attachments';
import { fileLabel, filePath, isLegacyToken } from '../core/files';
import { MAX_IMAGE_BYTES } from '../core/notes';
import { useLatest } from '../hooks/useLatest';
import { useToast } from '../hooks/useToast';
import type { NoteImage } from '../core/types';

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

/** 预览区的内容：图片、取不到的图片或文件块，或原文不再是单个附件时按卡片排版的 Markdown。 */
type Preview =
  | { kind: 'image'; src: string; label: string }
  | { kind: 'missing' | 'file'; label: string }
  | { kind: 'text'; markdown: string };

/** 本机路径、网络图片与 data 图片可以显示；原型遗留的浏览器文件标识没有可用的地址。 */
function imageUrl(target: string): string {
  const path = filePath(target);
  if (path) return isLegacyToken(path) ? '' : bridge.localFileUrl(path);
  return /^(?:data:image\/|https?:)/i.test(target) ? target : '';
}

/** 原文对应的预览（原型 sourcePreview）。 */
function sourcePreview(markdown: string): Preview {
  const parsed = parseAttachmentSource(markdown);
  if (!parsed) return { kind: 'text', markdown };
  if (parsed.kind === 'file') return { kind: 'file', label: parsed.label || fileLabel(parsed.target) };
  const src = imageUrl(parsed.target);
  return src ? { kind: 'image', src, label: parsed.label } : { kind: 'missing', label: parsed.label || '图片' };
}

function PreviewArea({ preview }: { preview: Preview }) {
  return (
    <div className="attachment-preview-area">
      {preview.kind === 'image' ? (
        <img className="attachment-preview-image" src={preview.src} alt={preview.label || '图片'} draggable={false} />
      ) : preview.kind === 'text' ? (
        <div className="attachment-preview-text markdown-body">{preview.markdown.trim() ? <Markdown text={preview.markdown} /> : null}</div>
      ) : (
        <div className={preview.kind === 'missing' ? 'attachment-file is-missing' : 'attachment-file'}>
          <Icon name={preview.kind === 'missing' ? 'image' : 'file'} />
          <span>{preview.label}</span>
        </div>
      )}
    </div>
  );
}

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
  const name = embedded ? embedded.name : reference?.label || (path ? fileLabel(path) : '') || (isImage ? '图片' : '附件');

  const [draft, setDraft] = useState(reference?.source ?? '');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sourceField = useRef<HTMLTextAreaElement>(null);

  // 原文框随内容增高，完整显示原文，不出现滚动条；窗口宽度变化后重新计算。
  useLayoutEffect(() => {
    const field = sourceField.current;
    if (!field) return;
    const fit = (): void => {
      const style = getComputedStyle(field);
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [draft]);

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
          ? await withSystemDialog(() => bridge.saveAttachmentAs(path, fileLabel(path)))
          : false;
      if (saved) toast('已另存');
    }, '未能另存');

  const remove = (): Promise<void> =>
    run(async () => {
      const removed = embedded ? await onReplaceImage?.(null) : await onReplaceSource?.('');
      if (removed) onClose();
    }, '未能删除');

  // 与原型相同：原文原样比较、原样写回，不去掉首尾空白。
  const changed = Boolean(reference) && draft !== reference?.source;
  const apply = (): Promise<void> =>
    run(async () => {
      if (!changed || (await onReplaceSource?.(draft))) onClose();
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

  // 把文件拖进弹窗即替换（桌面端；WebView2 原生拖放，见 useFileDrop）。拖动经过弹窗时描边，离开或松开后去掉。
  const canDrop = editable && bridge.isDesktop();
  useEffect(() => {
    if (!canDrop) return;
    const over = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files') &&
      event.target instanceof Element &&
      Boolean(event.target.closest('.attachment-modal'));
    const handleOver = (event: DragEvent): void => {
      if (!over(event)) {
        setDragging(false);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const handleLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const handleDrop = (event: DragEvent): void => {
      setDragging(false);
      if (!over(event)) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) void run(() => replaceWithDropped(file), '未能更换');
    };
    document.addEventListener('dragover', handleOver, true);
    document.addEventListener('dragleave', handleLeave, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragover', handleOver, true);
      document.removeEventListener('dragleave', handleLeave, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, [canDrop, run, replaceWithDropped]);

  // Esc 只关闭弹窗，不再传给侧栏（否则会顺带取消正在进行的编辑）。监听器只挂一次（见 useLatest）。
  const closeRef = useLatest(onClose);
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [closeRef]);

  const canOpen = Boolean(path) || Boolean(reference && /^https?:/i.test(reference.target));
  const canSave = Boolean(embedded) || Boolean(path);
  const preview: Preview | null = !isImage
    ? null
    : embedded
      ? { kind: 'image', src: embedded.data, label: name }
      : sourcePreview(draft);

  return (
    <Modal
      title={name}
      icon={isImage ? 'image' : 'file'}
      className={dragging ? 'attachment-modal is-dragging' : 'attachment-modal'}
      bodyClassName={!preview && !reference ? 'is-empty' : undefined}
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
              <Icon name="upload" />
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
            <button
              type="button"
              className="icon-button attachment-delete"
              aria-label="删除这个附件"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="trash" />
            </button>
          ) : null}
          {reference && editable ? (
            <button
              type="button"
              className="button primary attachment-apply"
              disabled={busy || !changed}
              onClick={() => void apply()}
            >
              <Icon name="check" />
              应用修改
            </button>
          ) : null}
        </>
      }
    >
      {preview ? <PreviewArea preview={preview} /> : null}
      {reference ? (
        <label className="attachment-source">
          <span className="attachment-source-label">Markdown 原文</span>
          <textarea
            ref={sourceField}
            className="form-control attachment-source-input"
            value={draft}
            rows={1}
            spellCheck={false}
            readOnly={!editable}
            aria-label="Markdown 原文"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                if (changed && !busy) void apply();
              }
            }}
          />
        </label>
      ) : null}
    </Modal>
  );
}
