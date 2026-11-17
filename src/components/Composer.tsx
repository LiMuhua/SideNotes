/**
 * 新建卡片（原型第二版，components.md 1.3）。
 *
 * 固定在列表之上，不随列表滚动；工具栏一直显示：左边是添加图片与引用文件，右边是字数、
 * 保存的快捷键（终端主题写在界面上）与保存按钮。有内容时 Esc 让新建卡片失去焦点，草稿保留；
 * 点工具栏的空白处或卡片边缘时焦点留在编辑区（原型 createComposer）。
 */

import { Icon } from './Icon';
import { KeyHint } from './KeyHint';
import { LiveEditor } from './LiveEditor';
import type { EditorAttachment, MarkdownEditor } from '../core/editor';
import type { NoteImage } from '../core/types';
import { useShortcut } from '../hooks/useShortcut';

export interface ComposerProps {
  text: string;
  images: NoteImage[];
  /** 正在读取附件时禁用保存。 */
  busy: boolean;
  onChange: (text: string) => void;
  onReady: (editor: MarkdownEditor) => void;
  onFocus: () => void;
  onSave: () => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
  onRemoveImage: (id: string) => void;
  /** 点击编辑面中的附件（图片、文件引用）。 */
  onAttachment: (attachment: EditorAttachment, event: MouseEvent) => void;
  /** 点击以 data URL 保存的图片附件。 */
  onEmbeddedImage: (image: NoteImage) => void;
  /** 编辑面高度上限，随窗口尺寸变化。 */
  maxHeight: number;
  /** 在标签页签中新建时带上的标签（工具栏上的「#标签 ×」）；为空时不显示。 */
  tabTag?: string;
  /** 点「#标签」的 ×：这条记录不带这个标签。 */
  onSkipTag?: () => void;
}

/** 列表顶部的新建输入卡片。 */
export function Composer(props: ComposerProps) {
  const saveKeys = useShortcut('save');
  const empty = !props.text.trim() && !props.images.length;
  return (
    <section
      id="quick-composer"
      className="sidebar-composer composer-placeholder is-active"
      aria-label="直接记录"
      onFocus={props.onFocus}
      onMouseDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest('button,a,input,textarea,[contenteditable="true"]')) return;
        event.preventDefault();
        event.currentTarget.querySelector<HTMLElement>('.live-editor-host [contenteditable]')?.focus({ preventScroll: true });
      }}
    >
      <LiveEditor
        value={props.text}
        placeholder={`记一条… 支持 Markdown、#标签\n${saveKeys} 保存，侧栏保持展开`}
        ariaLabel={`直接输入新记录，${saveKeys} 保存，侧栏保持展开`}
        minHeight={56}
        maxHeight={props.maxHeight}
        onChange={props.onChange}
        onReady={props.onReady}
        onAttachment={props.onAttachment}
      />

      {props.images.length ? (
        <div className="attachment-list" id="sidebar-attachment-list">
          {props.images.map((image) => (
            <div key={image.id} className="attachment-item">
              <button
                type="button"
                className="attachment-preview"
                aria-label={`图片：${image.name}`}
                onClick={() => props.onEmbeddedImage(image)}
              >
                <img src={image.data} alt={image.name} />
              </button>
              <button
                type="button"
                className="icon-button attachment-remove"
                aria-label={`移除图片：${image.name}`}
                onClick={() => props.onRemoveImage(image.id)}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-footer">
        <div className="composer-tools">
          <button type="button" className="icon-button" data-action="attach-image" aria-label="添加图片" onClick={props.onAttachImage}>
            <Icon name="image" />
          </button>
          <button type="button" className="icon-button" data-action="attach-file" aria-label="引用文件" onClick={props.onAttachFile}>
            <Icon name="file" />
          </button>
          {props.tabTag ? (
            <span className="composer-tab-tag">
              <span className="composer-tab-tag-name">{`#${props.tabTag}`}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="不带这个标签"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onSkipTag?.();
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          ) : null}
        </div>
        <span className="composer-count">{`${Array.from(props.text).length} 字`}</span>
        <div className="composer-actions">
          <KeyHint combo={saveKeys} />
          <button
            type="button"
            className="composer-submit icon-button primary"
            data-action="save-sidebar-note"
            aria-label="保存记录，保持侧栏展开"
            disabled={props.busy || empty}
            onClick={props.onSave}
          >
            <Icon name="check" />
          </button>
        </div>
      </div>
    </section>
  );
}
