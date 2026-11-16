/**
 * 合并成一条的弹窗（原型第二版，与交互原型 merge.js 的 open 相同，类名沿用原型以取得同样的样式）。
 *
 * - 新建：标题默认是共同标签（没有时用第一条的标题），可以改；合并到已有卡片：标题不变，只有格式。
 * - 格式：清单（每条记录一个待办，多出来的行缩进在待办下面）或段落（每条整段放入）；来源都只有一行时默认清单。
 * - 实时预览合并后的正文与标签行；「保留原记录」不勾时原记录移到回收站。点「合并」或按 Ctrl+Enter 才写入。
 * 合并的规则见 core/merge。
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { composeInto, composeNew, defaultFormat, defaultTitle, mergedImages, type MergeFormat } from '../core/merge';
import { noteTitle } from '../core/notes';
import { parse } from '../core/tags';
import type { Note, NoteImage } from '../core/types';

export interface MergeDialogProps {
  /** 来源记录，按列表中的顺序；不含 target。 */
  notes: readonly Note[];
  /** 合并到的已有卡片；新建时为 null。 */
  target: Note | null;
  /** 按标签合并时筛选的标签：排在标题的最前。 */
  tag?: string;
  /** 写入合并结果；返回是否完成（失败时弹窗留着）。 */
  onConfirm: (text: string, images: NoteImage[], keep: boolean) => Promise<boolean>;
  onClose: () => void;
}

const FORMATS: ReadonlyArray<readonly [MergeFormat, string]> = [
  ['list', '清单'],
  ['text', '段落'],
];

export function MergeDialog({ notes, target, tag, onConfirm, onClose }: MergeDialogProps) {
  const [title, setTitle] = useState(() => defaultTitle(target ? [target, ...notes] : notes, tag));
  const [format, setFormat] = useState<MergeFormat>(() => defaultFormat(notes));
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const text = target ? composeInto(target, notes, { format, tag }) : composeNew(notes, { title, format, tag });
  const parts = parse(text);

  // 打开后聚焦标题并全选（合并到已有卡片时聚焦「合并到这条」），与原型相同。Modal 在 30 毫秒后把焦点交给第一个控件，
  // 这里稍晚一点再设，免得被它盖掉。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (titleRef.current) {
        titleRef.current.focus({ preventScroll: true });
        titleRef.current.select();
      } else applyRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);

  const apply = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const done = await onConfirm(text, mergedImages(target ? [target, ...notes] : notes), keep);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Modal
      title={target ? `合并到「${noteTitle(target)}」` : `合并 ${notes.length} 条记录`}
      icon="merge"
      className="merge-modal"
      onClose={onClose}
      footer={
        <>
          <label className="merge-keep">
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
            <span>保留原记录</span>
          </label>
          <button ref={applyRef} type="button" className="button primary merge-apply" disabled={busy} onClick={() => void apply()}>
            <Icon name="check" />
            {target ? '合并到这条' : '合并'}
          </button>
        </>
      }
    >
      <div
        className="merge-body"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void apply();
          }
        }}
      >
        <div className="merge-fields">
          {target ? null : (
            <label className="merge-field">
              <span className="merge-field-label">标题</span>
              <input
                ref={titleRef}
                className="form-control merge-title"
                type="text"
                value={title}
                aria-label="标题"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          )}
          <div className="merge-field">
            <span className="merge-field-label">格式</span>
            <div className="merge-format" role="group" aria-label="格式">
              {FORMATS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="merge-format-option"
                  data-format={value}
                  aria-pressed={format === value}
                  onClick={() => setFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="merge-preview-box">
          <div className="merge-preview markdown-body" aria-label="合并后的样子">
            <Markdown text={parts.body} />
          </div>
          <div className="merge-preview-tags">
            {parts.tags.map((item) => (
              <span key={item} className="tag-chip">{`#${item}`}</span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
