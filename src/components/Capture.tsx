/**
 * 速记浮窗（原型第二版，与交互原型 index.html 的 #capture 与 app.js 的速记部分相同）。
 *
 * 独占一个 Tauri 窗口；草稿与侧栏共享同一数据库，保存后侧栏列表刷新时自动拾取新记录。
 * - 标题区：应用图标、「速记」与问号，快捷键与 Markdown 的说明收在问号里；右边是「在侧栏继续」与收起。
 * - 编辑区填满标题区与底栏之间；底栏是附件工具、字数（按字符计）与收起、保存。不显示草稿状态。
 * - 保存快捷键保存并收起；空草稿不收起，附件还在读取时只提示。附件弹窗与问号说明打开时，按键先交给它们。
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon, IconSprite } from './Icon';
import { Floating, comboKeys } from './Floating';
import { LiveEditor } from './LiveEditor';
import { ToastRegion } from './Modal';
import { AttachmentDialog, type AttachmentSubject } from './AttachmentDialog';
import type { AttachmentPayload } from './DialogWindow';
import { useDialogWindow } from '../hooks/useDialogWindow';
import { useStore } from '../hooks/useStore';
import { useShortcut } from '../hooks/useShortcut';
import { matches } from '../core/shortcuts';
import { useToast } from '../hooks/useToast';
import * as store from '../core/store';
import * as bridge from '../core/bridge';
import { importPastedFiles, openAttachment, referencesFor, replaceReference } from '../core/attachments';
import { placeAttachment } from '../core/insert';
import { caretFromPoint, isFileDrag } from '../hooks/useFileDrop';
import { useAppIconSource } from '../hooks/useAppIcon';
import type { NoteImage } from '../core/types';
import type { EditorAttachment, MarkdownEditor } from '../core/editor';

export function Capture() {
  const state = useStore();
  const appIcon = useAppIconSource(state.settings.appIcon);
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

  // 附件弹窗交给弹窗窗口（T99，桌面端），与侧栏相同：修改发回这里写入，弹窗关闭后清空状态。
  const dialogWindow = useDialogWindow();
  useEffect(() => {
    if (!attachmentDialog || !bridge.isDesktop()) return;
    const dialog = attachmentDialog;
    const payload: AttachmentPayload = {
      subject: dialog.subject,
      canReplaceSource: Boolean(dialog.replaceSource),
      canReplaceImage: Boolean(dialog.replaceImage),
    };
    let id = 0;
    let alive = true;
    void dialogWindow
      .open(
        'attachment',
        payload,
        {
          'replace-source': (data: { source: string }) => (dialog.replaceSource ? dialog.replaceSource(data.source) : false),
          'replace-image': (data: { image: NoteImage | null }) => (dialog.replaceImage ? dialog.replaceImage(data.image) : false),
        },
        () => setAttachmentDialog((current) => (current === dialog ? null : current)),
      )
      .then((opened) => {
        id = opened;
        if (!alive) dialogWindow.close(opened);
      });
    return () => {
      alive = false;
      if (id) dialogWindow.close(id);
    };
  }, [attachmentDialog, dialogWindow]);

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
          editor.insertAttachment(markdown, { start: offset, end: offset, direction: 'none' });
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

  /**
   * 保存草稿为记录。与原型相同：空草稿不保存也不收起，附件还在读取时只提示；
   * 按保存键时保存并收起，点保存按钮时浮窗保持展开，焦点回到编辑区。
   */
  const saveDraft = useCallback(async (hideWindow: boolean): Promise<void> => {
    if (store.getState().pendingAttachments > 0) {
      toast('内容正在读取，请稍候');
      return;
    }
    if (!localText.trim() && !state.draft.images.length) return;
    // 速记浮窗的记录进入随记（不带页签的标签）。
    const note = await store.saveDraftAsNote();
    if (!note) { toast('保存失败', null, true); return; }
    setLocalText('');
    if (hideWindow) {
      void bridge.hideCapture();
      return;
    }
    toast('记录已保存');
    window.setTimeout(() => editorRef.current?.focus({ preventScroll: true }), 0);
  }, [localText, state.draft.images.length, toast]);

  // 保存记录的快捷键（默认 Ctrl+Enter）保存并隐藏浮窗，Esc 收起。输入法组字时不处理；
  // 附件弹窗打开时按键交给弹窗（弹窗里的 Ctrl+Enter 是「应用修改」），问号说明自己处理 Esc。
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (matches(event, store.getState().settings.shortcuts, 'save')) {
        event.preventDefault();
        void saveDraft(true);
        return;
      }
      if (event.key === 'Escape') void bridge.hideCapture();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [saveDraft]);

  /** 在光标处插入附件的 Markdown；编辑器还没就绪时接在末尾。 */
  const insertMarkdown = useCallback((markdown: string): void => {
    const editor = editorRef.current;
    if (editor) {
      editor.focus({ preventScroll: true });
      editor.insertAttachment(markdown);
    } else {
      setLocalText((prev) => placeAttachment(prev, markdown, null).text);
    }
  }, []);

  /** 添加图片或引用文件：复制一份到数据目录，在光标处插入引用（与原型相同，图片也写进正文）。 */
  const attachFiles = useCallback(
    async (images: boolean): Promise<void> => {
      try {
        const paths = await bridge.chooseFiles({ images });
        if (!paths?.length) return;
        store.setPendingAttachments(1);
        try {
          insertMarkdown(referencesFor(await bridge.importFiles(paths)));
        } finally {
          store.setPendingAttachments(-1);
        }
      } catch (error) {
        toast(`${images ? '图片' : '文件'}未能插入：${bridge.errorText(error, '请稍后重试')}`, null, true);
      }
    },
    [insertMarkdown, toast],
  );

  const empty = !localText.trim() && !state.draft.images.length;
  /** 字数按字符计：一个 Emoji 算一个字（与原型 Array.from 相同）。 */
  const charCount = Array.from(localText).length;

  return (
    <>
      <IconSprite />
      <section className="capture open" aria-labelledby="capture-title">
        <header className="capture-header">
          <div className="capture-heading">
            <img className="brand-mark is-small" src={appIcon} alt="" aria-hidden="true" />
            <h2 id="capture-title">速记</h2>
            <CaptureHelp saveKeys={saveKeys} />
          </div>
          <div className="window-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="在侧栏继续"
              onClick={async () => {
                // 把当前浮窗草稿带到侧栏：先确保侧栏可见，再聚焦侧栏输入入口。
                await bridge.hideCapture();
                await bridge.showSidebar(bridge.sidebarLayout(store.getState().settings));
                window.dispatchEvent(new CustomEvent('sidenotes:focus-composer'));
              }}
            >
              <Icon name="arrow-up-right" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="保留草稿并收起速记"
              aria-keyshortcuts="Escape"
              onClick={() => void bridge.hideCapture()}
            >
              <Icon name="x" />
            </button>
          </div>
        </header>

        <div className="capture-body">
          <LiveEditor
            value={localText}
            placeholder="随手记… 支持 Markdown 与 #标签"
            ariaLabel="速记内容"
            autoFocus
            onChange={setLocalText}
            onReady={(editor) => { editorRef.current = editor; }}
            onAttachment={handleAttachment}
            maxHeight={null}
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

        <footer className="capture-footer">
          <div className="composer-tools">
            <button type="button" className="icon-button" aria-label="添加图片" onClick={() => void attachFiles(true)}>
              <Icon name="image" />
            </button>
            <button type="button" className="icon-button" aria-label="引用文件" onClick={() => void attachFiles(false)}>
              <Icon name="file" />
            </button>
          </div>
          <span id="capture-char-count" className="composer-count">{`${charCount} 字`}</span>
          <div className="composer-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="保留草稿并收起"
              aria-keyshortcuts="Escape"
              onClick={() => void bridge.hideCapture()}
            >
              <Icon name="x" />
            </button>
            <button
              type="button"
              className="icon-button primary"
              aria-label="保存记录，保持浮窗展开"
              disabled={empty || state.pendingAttachments > 0}
              onClick={() => void saveDraft(false)}
            >
              <Icon name="check" />
            </button>
          </div>
        </footer>

        <ToastRegion className="capture-toast-region" />
      </section>

      {attachmentDialog && !bridge.isDesktop() ? (
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

/**
 * 标题旁的问号：悬停、获得焦点或点击时显示快捷键与 Markdown 的说明，Esc 只关说明（原型 initializeHelp）。
 * 说明挂在 body 下的浮层中，不被浮窗裁剪；按键随设置中的绑定变化。
 */
function CaptureHelp({ saveKeys }: { saveKeys: string }) {
  const id = `capture-help-${useId()}`;
  const [shown, setShown] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <span
      className="help-anchor"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => {
        if (document.activeElement !== trigger.current) setShown(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="help-button"
        aria-label="速记说明"
        aria-expanded={shown}
        aria-describedby={id}
        onClick={() => setShown((value) => !value)}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && shown) {
            event.preventDefault();
            event.stopPropagation();
            setShown(false);
          }
        }}
      >
        ?
      </button>
      <Floating anchor={trigger} open={shown} options={{ placement: 'bottom-start' }} id={id} role="tooltip" className="help-text">
        <span className="help-line shortcut-line">
          {comboKeys(saveKeys).map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}{' '}
          保存并收起
        </span>
        <span className="help-line shortcut-line">
          <kbd>Esc</kbd> 收起，草稿保留
        </span>
        <span className="help-line">支持 Markdown 与 #标签</span>
      </Floating>
    </span>
  );
}
