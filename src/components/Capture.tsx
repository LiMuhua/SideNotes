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
import { ImagePreview } from './Modal';
import { useStore } from '../hooks/useStore';
import { useToast } from '../hooks/useToast';
import * as store from '../core/store';
import * as bridge from '../core/bridge';
import { chooseAndImportFiles } from '../core/attachments';
import type { NoteImage } from '../core/types';
import type { MarkdownEditor } from '../core/editor';

export function Capture() {
  const state = useStore();
  const toast = useToast();
  const editorRef = useRef<MarkdownEditor | null>(null);
  const [localText, setLocalText] = useState(state.draft.text);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  // 全局热键 Ctrl+Enter 保存并隐藏浮窗。
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
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
                await bridge.showSidebar({ edge: store.getState().settings.edge, width: store.getState().settings.width });
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
            placeholder={'随手记… 支持 Markdown 与 #标签\nCtrl+Enter 保存并收起，Esc 直接收起'}
            ariaLabel="速记输入，Ctrl+Enter 保存并收起"
            autoFocus
            onChange={setLocalText}
            onReady={(editor) => { editorRef.current = editor; }}
            onPreviewImage={(src, alt) => setImagePreview({ src, alt })}
            maxHeight={Math.min(280, Math.max(100, window.innerHeight * 0.4))}
          />

          {state.draft.images.length ? (
            <div className="attachment-list">
              {state.draft.images.map((image) => (
                <div key={image.id} className="attachment-item">
                  <button
                    type="button"
                    className="attachment-preview"
                    aria-label={`预览 ${image.name}`}
                    onClick={() => setImagePreview({ src: image.data, alt: image.name })}
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
                  const reason = error instanceof Error && error.message ? error.message : '请稍后重试';
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

        <ToastRegion />
      </div>

      <input ref={fileInput} type="file" hidden multiple accept="image/*" onChange={handleFileSelected} />

      {imagePreview ? (
        <ImagePreview src={imagePreview.src} name={imagePreview.alt} onClose={() => setImagePreview(null)} />
      ) : null}
    </>
  );
}
