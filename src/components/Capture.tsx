/**
 * 速记浮窗。
 *
 * 独占一个 Tauri 窗口；草稿与侧栏共享同一数据库，
 * 保存后侧栏列表刷新时自动拾取新记录。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, IconSprite } from './Icon';
import { LiveEditor } from './LiveEditor';
import { ToastRegion } from './Modal';
import { AttachmentDialog, type AttachmentSubject } from './AttachmentDialog';
import { useStore } from '../hooks/useStore';
import { useShortcut } from '../hooks/useShortcut';
import { matches } from '../core/shortcuts';
import { useToast } from '../hooks/useToast';
import * as store from '../core/store';
import * as bridge from '../core/bridge';
import { chooseAndImportFiles, importPastedFiles, openAttachment, replaceReference } from '../core/attachments';
import { caretFromPoint, isFileDrag } from '../hooks/useFileDrop';
import type { NoteImage } from '../core/types';
import type { EditorAttachment, MarkdownEditor } from '../core/editor';

export function Capture() {
  const state = useStore();
  const saveKeys = useShortcut('save');
  const toast = useToast();
  const editorRef = useRef<MarkdownEditor | null>(null);
  const [localText, setLocalText] = useState(state.draft.text);
  /** 附件弹窗：与侧栏相同，修改写回编辑器或草稿中的图片附件。 */
  const [attachmentDialog, setAttachmentDialog] = useState<{
    subject: AttachmentSubject;
    replaceSource?: (source: string) => boolean;
    replaceImage?: (image: NoteImage | null) => boolean;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** 点击编辑面中的附件：按住 Ctrl 直接打开，否则打开附件弹窗，修改写回编辑器。 */
  const handleAttachment = useCallback(
    (reference: EditorAttachment, event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey) {
        void openAttachment(reference.target).catch((error: unknown) =>
          toast(bridge.errorText(error, '无法打开文件'), null, true),
        );
        return;
      }
      setAttachmentDialog({
        subject: { kind: reference.kind, source: reference.source, target: reference.target, label: reference.label },
        replaceSource: (next) => {
          const editor = editorRef.current;
          const result = editor ? replaceReference(editor.getValue(), reference, next) : null;
          if (!editor || !result) {
            toast('内容已变化，未能修改附件', null, true);
            return false;
          }
          return editor.applyEdit(
            { value: result.text, start: result.end, end: result.end },
            { start: reference.start, end: reference.end, direction: 'none' },
          );
        },
      });
    },
    [toast],
  );

  /** 点击草稿中的图片附件（data URL）。 */
  const handleEmbeddedImage = useCallback((image: NoteImage) => {
    setAttachmentDialog({
      subject: { kind: 'embedded', image },
      replaceImage: (next) => {
        if (next) store.replaceDraftImage(image.id, next);
        else store.removeDraftImage(image.id);
        return true;
      },
    });
  }, []);

  // 从资源管理器拖入文件：保存为附件副本，插在指针所指的位置（指针不在文字上时接在末尾）。
  // 附件弹窗开着时交给弹窗处理。文件放到正获得焦点的编辑面上时 WebView2 不派发 drop 事件，
  // 拖入期间先取消编辑面的焦点，拖出窗口时还回去（与侧栏的 useFileDrop 相同）。
  useEffect(() => {
    let blurred: HTMLElement | null = null;
    const accepts = (event: DragEvent): boolean => isFileDrag(event) && !document.querySelector('.modal-backdrop');
    const handleOver = (event: DragEvent): void => {
      if (!accepts(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      const active = document.activeElement;
      if (!blurred && active instanceof HTMLElement && active.isContentEditable) {
        blurred = active;
        active.blur();
      }
    };
    const handleLeave = (event: DragEvent): void => {
      if (!blurred || event.relatedTarget !== null) return;
      if (blurred.isConnected) blurred.focus({ preventScroll: true });
      blurred = null;
    };
    const handleDrop = (event: DragEvent): void => {
      if (!accepts(event)) return;
      event.preventDefault();
      blurred = null;
      const editor = editorRef.current;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!editor || !files.length) return;
      const point = caretFromPoint(event.clientX, event.clientY);
      const offset = (point && editor.sourceOffset(point.node, point.offset)) ?? editor.getValue().length;
      store.setPendingAttachments(1);
      void importPastedFiles(files)
        .then((markdown) => {
          editor.focus({ preventScroll: true });
          editor.replace(markdown, { start: offset, end: offset, direction: 'none' });
        })
        .catch((error: unknown) =>
          toast(`文件未能插入：${bridge.errorText(error, '请稍后重试')}`, null, true),
        )
        .finally(() => store.setPendingAttachments(-1));
    };
    document.addEventListener('dragenter', handleOver, true);
    document.addEventListener('dragover', handleOver, true);
    document.addEventListener('dragleave', handleLeave, true);
    document.addEventListener('drop', handleDrop, true);
    return () => {
      document.removeEventListener('dragenter', handleOver, true);
      document.removeEventListener('dragover', handleOver, true);
      document.removeEventListener('dragleave', handleLeave, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, [toast]);

  // 同步到共享草稿（防抖写盘由外层 persistDraft 处理）。
  useEffect(() => {
    store.changeDraft(localText);
  }, [localText]);

  // 浮窗获焦时重新读取草稿（例如侧栏输入了一半再切到浮窗）。
  useEffect(() => {
    const handler = (): void => {
      const current = store.getState().draft.text;
      setLocalText(current);
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, []);

  const saveDraft = useCallback(async (hideWindow: boolean): Promise<void> => {
    if (!localText.trim() && !state.draft.images.length) {
      if (hideWindow) void bridge.hideCapture();
      return;
    }
    const note = await store.saveDraftAsNote('workspace');
    if (!note) { toast('保存失败', null, true); return; }
    setLocalText('');
    if (hideWindow) void bridge.hideCapture();
    else toast('记录已保存');
  }, [localText, state.draft.images.length, toast]);

  // 保存记录的快捷键（默认 Ctrl+Enter）保存并隐藏浮窗。
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (matches(event, store.getState().settings.shortcuts, 'save')) {
        event.preventDefault();
        void saveDraft(true);
      }
      if (event.key === 'Escape') void bridge.hideCapture();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [saveDraft]);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    store.setPendingAttachments(files.length);
    const images: NoteImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) { toast(`${file.name} 不是图片`, null, true); store.setPendingAttachments(-1); continue; }
      if (file.size > 2 * 1024 * 1024) { toast(`${file.name} 超过 2 MB`, null, true); store.setPendingAttachments(-1); continue; }
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          images.push({ id: crypto.randomUUID(), name: file.name, type: file.type, data: String(reader.result) });
          store.setPendingAttachments(-1);
          resolve();
        };
        reader.onerror = () => { toast(`读取失败`, null, true); store.setPendingAttachments(-1); resolve(); };
        reader.readAsDataURL(file);
      });
    }
    store.addDraftImages(images);
  };

  const empty = !localText.trim() && !state.draft.images.length;

  return (
    <>
      <IconSprite />
      <div className="capture open">
        <header className="capture-header">
          <div className="capture-heading">
            <div className="capture-mark">
              <div className="brand-mark small"><i /><i /><i /></div>
            </div>
            <div>
              <h2>速记</h2>
              <p>Markdown · #标签</p>
            </div>
          </div>
          <div className="window-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="在侧栏继续"
              title="在侧栏继续"
              onClick={async () => {
                // 把当前浮窗草稿带到侧栏：先确保侧栏可见，再聚焦侧栏输入入口。
                await bridge.hideCapture();
                await bridge.showSidebar(bridge.sidebarLayout(store.getState().settings));
                window.dispatchEvent(new CustomEvent('sidenotes:focus-composer'));
              }}
            >
              <Icon name="expand" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="保留草稿并收起速记浮窗"
              title="保留草稿并收起 · Esc"
              onClick={() => void bridge.hideCapture()}
            >
              <Icon name="x" />
            </button>
          </div>
        </header>

        <div className="capture-body">
          <LiveEditor
            value={localText}
            placeholder={`随手记… 支持 Markdown 与 #标签\n${saveKeys} 保存并收起，Esc 直接收起`}
            ariaLabel={`速记输入，${saveKeys} 保存并收起`}
            autoFocus
            onChange={setLocalText}
            onReady={(editor) => { editorRef.current = editor; }}
            onAttachment={handleAttachment}
            maxHeight={Math.min(280, Math.max(100, window.innerHeight * 0.4))}
          />

          {state.draft.images.length ? (
            <div className="attachment-list">
              {state.draft.images.map((image) => (
                <div key={image.id} className="attachment-item">
                  <button
                    type="button"
                    className="attachment-preview"
                    aria-label={`图片：${image.name}`}
                    onClick={() => handleEmbeddedImage(image)}
                  >
                    <img src={image.data} alt={image.name} />
                  </button>
                  <button
                    type="button"
                    className="icon-button attachment-remove"
                    aria-label={`移除 ${image.name}`}
                    onClick={() => store.removeDraftImage(image.id)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="capture-meta">
          <span id="draft-status">
            <span className="small-dot" />
            {state.draftDirty ? ' 草稿未保存' : ' 草稿已同步'}
          </span>
          <span id="capture-char-count">{localText.length} 字</span>
        </div>

        <footer className="capture-footer">
          <div className="composer-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="添加图片附件；截图也可直接粘贴到光标处"
              title="添加图片附件；截图也可直接粘贴到光标处"
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="image" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="引用文件（复制一份保存）；也可粘贴复制的文件"
              title="引用文件（复制一份保存）；也可粘贴复制的文件"
              onClick={async () => {
                // 文件引用：复制到应用数据目录中维护，在光标处插入引用（图片为内嵌图片）。
                try {
                  const markdown = await chooseAndImportFiles();
                  if (!markdown) return;
                  if (editorRef.current) {
                    editorRef.current.focus({ preventScroll: true });
                    editorRef.current.replace(markdown);
                  } else {
                    setLocalText((prev) => prev + (prev ? '\n' : '') + markdown);
                  }
                } catch (error) {
                  const reason = bridge.errorText(error, '请稍后重试');
                  toast(`文件未能引用：${reason}`, null, true);
                }
              }}
            >
              <Icon name="file" />
            </button>
          </div>
          <div className="composer-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="保留草稿并收起"
              title="保留草稿并收起 · Esc"
              onClick={() => void bridge.hideCapture()}
            >
              <Icon name="x" />
            </button>
            <button
              type="button"
              className="icon-button primary"
              aria-label="保存记录，保持浮窗展开"
              title="保存记录，保持浮窗展开"
              disabled={empty || state.pendingAttachments > 0}
              onClick={() => void saveDraft(false)}
            >
              <Icon name="check" />
            </button>
          </div>
        </footer>

        <ToastRegion className="capture-toast-region" />
      </div>

      <input ref={fileInput} type="file" hidden multiple accept="image/*" onChange={handleFileSelected} />

      {attachmentDialog ? (
        <AttachmentDialog
          subject={attachmentDialog.subject}
          onReplaceSource={attachmentDialog.replaceSource}
          onReplaceImage={attachmentDialog.replaceImage}
          onClose={() => setAttachmentDialog(null)}
        />
      ) : null}
    </>
  );
}
