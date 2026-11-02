/**
 * 新建记录入口。
 *
 * 固定在记录列表之上，独占顶部的一块区域：列表滚动时卡片从它下方的边界移出，
 * 不会和它叠在一起；它自身没有矩形底板，圆角外侧直接露出侧栏背景。
 */

import { Icon } from './Icon';
import { LiveEditor } from './LiveEditor';
import type { EditorAttachment, MarkdownEditor } from '../core/editor';
import type { NoteImage } from '../core/types';

export interface ComposerProps {
  text: string;
  images: NoteImage[];
  /** 正在读取附件时禁用保存。 */
  busy: boolean;
  onChange: (text: string) => void;
  onReady: (editor: MarkdownEditor) => void;
  onFocus: () => void;
  onSave: () => void;
  onClose: () => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
  onRemoveImage: (id: string) => void;
  /** 点击编辑面中的附件（图片、文件引用）。 */
  onAttachment: (attachment: EditorAttachment, event: MouseEvent) => void;
  /** 点击以 data URL 保存的图片附件。 */
  onEmbeddedImage: (image: NoteImage) => void;
  /** 编辑面高度上限，随窗口尺寸变化。 */
  maxHeight: number;
}

/** 列表顶部的新建输入卡片。 */
export function Composer(props: ComposerProps) {
  const empty = !props.text.trim() && !props.images.length;
  return (
    <div className="composer-dock">
      {/* 与原型一致：新建卡片始终处于激活外观（实线边框与工具栏），不随焦点切换成虚线占位。 */}
      <section
        id="quick-composer"
        className="sidebar-composer composer-placeholder is-active"
        aria-label="直接记录"
        onFocus={props.onFocus}
      >
        <LiveEditor
          value={props.text}
          placeholder={'记一条… 支持 Markdown、#标签\nCtrl+Enter 保存，侧栏保持展开'}
          ariaLabel="直接输入新记录，Ctrl+Enter 保存"
          minHeight={76}
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
                  title="点击查看详情"
                  onClick={() => props.onEmbeddedImage(image)}
                >
                  <img src={image.data} alt={image.name} />
                </button>
                <button
                  type="button"
                  className="icon-button attachment-remove"
                  aria-label={`移除图片：${image.name}`}
                  title={`移除图片：${image.name}`}
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
            <button
              type="button"
              className="icon-button"
              aria-label="添加图片"
              title="添加图片附件；截图也可直接粘贴到光标处"
              onClick={props.onAttachImage}
            >
              <Icon name="image" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="引用文件"
              title="引用文件（复制一份保存）；也可粘贴复制的文件"
              onClick={props.onAttachFile}
            >
              <Icon name="file" />
            </button>
          </div>
          <div className="composer-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="收起输入"
              title="收起输入"
              onClick={props.onClose}
            >
              <Icon name="x" />
            </button>
            <button
              type="button"
              className="composer-submit icon-button primary"
              aria-label="保存记录，保持侧栏展开"
              title="保存记录，保持侧栏展开"
              disabled={props.busy || empty}
              onClick={props.onSave}
            >
              <Icon name="check" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
