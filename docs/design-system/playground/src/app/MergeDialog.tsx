/**
 * 合并成一条的弹窗（第四次反馈，与交互原型相同）。
 *
 * 一行是「标题」与「格式」（清单、段落），下面是按卡片排版的实时预览，末尾是合并后的标签；底栏左侧「保留原记录」，
 * 右侧「合并」（合并到已有卡片时是「合并到这条」，标题不变）。点按钮或 Ctrl+Enter 才写入。
 * 写入后新卡片放在原来第一条的位置并进入编辑，原记录移到回收站（勾了「保留原记录」时不动），提示条一次撤销全部恢复。
 * 合并的规则见 model/merge.ts。
 */

import { useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { createNote, noteTitle } from '@/core/notes';
import { parse } from '@/core/tags';
import type { Note } from '@/core/types';
import { composeInto, composeNew, defaultFormat, defaultTitle, mergedImages, type MergeFormat } from '../model/merge';
import { useNotes } from '../model/notes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Field';
import { useToast } from '../ui/Tabs';
import { Checkbox, Segmented } from '../ui/Toggle';

export interface MergeRequest {
  /** 来源记录，按列表中的顺序（置顶在前）。 */
  ids: string[];
  /** 合并到这张已有的卡片（多选后右键其中一张「合并到这条」）。 */
  target?: string;
  /** 按标签合并时筛选的标签，标题以它开头。 */
  tag?: string;
}

const FORMATS = [
  { value: 'list', label: '清单' },
  { value: 'text', label: '段落' },
] as const;

export function MergeDialog({ request, onClose, onDone }: { request: MergeRequest | null; onClose: () => void; onDone: (note: Note) => void }) {
  // 每次打开都是新的一份选项（标题、格式与「保留原记录」）。
  return request ? <MergePanel key={`${request.target ?? ''}:${request.ids.join(',')}`} request={request} onClose={onClose} onDone={onDone} /> : null;
}

function MergePanel({ request, onClose, onDone }: { request: MergeRequest; onClose: () => void; onDone: (note: Note) => void }) {
  const data = useNotes();
  const toast = useToast();
  // 打开时取下来源与目标，弹窗打开期间不随数据变化。
  const [{ target, sources }] = useState(() => {
    const into = request.target ? data.byId.get(request.target) : undefined;
    const list = request.ids.map((id) => data.byId.get(id)).filter((note): note is Note => Boolean(note && note.status !== 'trash' && note.id !== into?.id));
    return { target: into, sources: list };
  });
  const [title, setTitle] = useState(() => defaultTitle(target ? [target, ...sources] : sources, request.tag));
  const [format, setFormat] = useState<MergeFormat>(() => defaultFormat(sources));
  const [keep, setKeep] = useState(false);
  const text = target ? composeInto(target, sources, { format, tag: request.tag }) : composeNew(sources, { title, format, tag: request.tag });
  const parsed = parse(text);

  const commit = () => {
    if (!sources.length) return;
    const ids = sources.map((note) => note.id);
    if (target) {
      const before: Partial<Note> = { text: target.text, images: target.images, updatedAt: target.updatedAt };
      const images = mergedImages([target, ...sources]);
      data.patchNotes([[target.id, { images }]]);
      data.update(target.id, text);
      if (!keep) data.setStatus(ids, 'trash');
      toast({
        message: `已合并到这条 ${ids.length} 条${keep ? '' : '，原记录在回收站'}`,
        action: {
          label: '撤销',
          run: () => {
            data.patchNotes([[target.id, before]]);
            if (!keep) data.restore(ids);
          },
        },
      });
      onDone({ ...target, text, images });
    } else {
      const first = sources[0];
      // 排在原来第一条的位置：用它的排序值（没有手动排过序时按创建时间排，换算成同样的值）。
      const note: Note = { ...createNote(text, mergedImages(sources), { pinned: first.pinned, existing: data.notes }), order: first.order ?? -first.createdAt };
      data.insertNote(note);
      if (!keep) data.setStatus(ids, 'trash');
      toast({
        message: `已合并 ${ids.length} 条${keep ? '' : '，原记录在回收站'}`,
        action: {
          label: '撤销',
          run: () => {
            data.removeForever([note.id]);
            if (!keep) data.restore(ids);
          },
        },
      });
      onDone(note);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      icon="merge"
      className="sn-merge-dialog"
      title={target ? `合并到「${noteTitle(target)}」` : `合并 ${sources.length} 条记录`}
      footer={
        <>
          <Checkbox checked={keep} onChange={setKeep} label="保留原记录" />
          <Button variant="primary" icon="check" data-autofocus={target ? '' : undefined} onClick={commit}>
            {target ? '合并到这条' : '合并'}
          </Button>
        </>
      }
    >
      <div
        className="sn-merge"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      >
        <div className="sn-merge-fields">
          {target ? null : (
            <label className="sn-merge-field is-title">
              <span className="sn-merge-label">标题</span>
              <TextInput value={title} aria-label="标题" data-autofocus="" onFocus={(event) => event.currentTarget.select()} onChange={(event) => setTitle(event.target.value)} />
            </label>
          )}
          <div className="sn-merge-field">
            <span className="sn-merge-label">格式</span>
            <Segmented label="格式" size="sm" value={format} options={FORMATS} onChange={setFormat} />
          </div>
        </div>
        <div className="sn-merge-preview" aria-label="合并后的样子">
          <Markdown text={parsed.body} className="sn-note-markdown" />
          {parsed.tags.length ? (
            <div className="sn-merge-tags">
              {parsed.tags.map((tag) => (
                <span key={tag} className="sn-note-tag">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
