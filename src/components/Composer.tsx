/**
 * 新建记录入口。
 *
 * 粘性固定在记录列表顶部：滚动正文不会带走输入入口，
 * 圆角外侧由不透明底板遮挡，不会透出下方滚动的卡片。
 */

import { Icon } from './Icon';
import { LiveEditor } from './LiveEditor';
import type { MarkdownEditor } from '../core/editor';
import type { NoteImage } from '../core/types';

export interface ComposerProps {
  text: string;
  images: NoteImage[];
  /** 正在读取附件时禁用保存。 */
  busy: boolean;
  active: boolean;
  onChange: (text: string) => void;
  onReady: (editor: MarkdownEditor) => void;
  onFocus: () => void;
  onSave: () => void;
  onClose: () => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
  onRemoveImage: (id: string) => void;
  onPreviewImage: (src: string, alt: string) => void;
  /** 编辑面高度上限，随窗口尺寸变化。 */
  maxHeight: number;
}

/** 列表顶部的新建输入卡片。 */
export function Composer(props: ComposerProps) {
  const empty = !props.text.trim() && !props.images.length;
  return (
    <div className="composer-sticky-slot">
      <section
        id="quick-composer"
        className={props.active ? 'sidebar-composer composer-placeholder is-active' : 'sidebar-composer composer-placeholder'}
        aria-label="直接记录"
        onFocus={props.onFocus}
      >
        <LiveEditor
          value={props.text}
          placeholder={'记一条… 支持 Markdown、#标签\nCtrl+Enter 保存并收起侧栏'}
          ariaLabel="直接输入新记录，Ctrl+Enter 保存并收起侧栏"
          minHeight={76}
          maxHeight={props.maxHeight}
          onChange={props.onChange}
          onReady={props.onReady}
          onPreviewImage={props.onPreviewImage}
        />

        {props.images.length ? (
          <div className="attachment-list" id="sidebar-attachment-list">
            {props.images.map((image) => (
              <div key={image.id} className="attachment-item">
                <button
                  type="button"
                  className="attachment-preview"
                  aria-label={`预览图片：${image.name}`}
                  onClick={() => props.onPreviewImage(image.data, image.name)}
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
              title="添加图片，也可粘贴或拖入"
              onClick={props.onAttachImage}
            >
              <Icon name="image" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="引用文件"
              title="引用文件，也可直接拖入"
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
