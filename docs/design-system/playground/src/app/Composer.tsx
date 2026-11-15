/**
 * 新建卡片：固定在记录列表之上，独占顶部的一块区域，列表滚动时卡片从它下方移出。
 *
 * 草稿与速记浮窗共用（现有应用中两个入口共用同一份草稿）。Ctrl+Enter 保存后侧栏保持展开，
 * 焦点留在新建卡片，可以接着记下一条（T47）。底部的工具栏一直显示，不随焦点收起展开，也没有收起按钮；
 * 点工具栏的空白处时焦点回到输入区（本次提出：此前点工具栏一行时新建卡片会收起）。长文在输入区里滚动。
 * 在标签页签中新建（第四次反馈）：工具栏上有一个「#标签 ×」，保存时写进标签行；点 × 这一条不带。
 */

import { useRef, type MouseEvent } from 'react';
import type { MarkdownEditor } from '@/core/editor';
import type { Note } from '@/core/types';
import { NoteEditor } from '../content/NoteEditor';
import { useNotes, withTag } from '../model/notes';
import { IconButton } from '../ui/Button';
import { useSurface, useFormFactor } from '../ui/context';
import { Keys } from '../ui/Misc';
import { useToast } from '../ui/Tabs';
import { SHORTCUT_KEYS } from './shortcuts';

export interface ComposerProps {
  /** 在标签页签中新建时带上的标签（第四次反馈）；空字符串表示不带。 */
  tag?: string;
  /** 点「#标签」上的 ×：这一条不带页签的标签。 */
  onSkipTag?: () => void;
  /** 保存了一条新记录。 */
  /** 保存之后（第五次反馈）：由侧栏决定提示——新记录不在当前页签时写明记在哪里；没有时提示「已保存」。 */
  onSaved?: (note: Note) => void;
  /** 父组件用来聚焦新建卡片（Ctrl+N）。 */
  onReady?: (editor: MarkdownEditor) => void;
}

export function Composer({ tag = '', onSkipTag, onSaved, onReady }: ComposerProps) {
  const data = useNotes();
  const toast = useToast();
  const surface = useSurface();
  const phone = useFormFactor() === 'phone';
  const editor = useRef<MarkdownEditor | null>(null);
  const empty = !data.draft.trim();
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  const save = () => {
    if (empty) return;
    const note = data.create(tag ? withTag(data.draft, tag) : data.draft);
    data.setDraft('');
    if (onSaved) onSaved(note);
    else toast({ message: '已保存', tone: 'success' });
    editor.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className="sn-composer"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          save();
        }
      }}
    >
      <NoteEditor
        value={data.draft}
        onChange={data.setDraft}
        ariaLabel="直接记录"
        placeholder={phone ? '记一条… 支持 Markdown、#标签' : `记一条… 支持 Markdown、#标签\n${SHORTCUT_KEYS.save} 保存，侧栏保持展开`}
        minHeight={56}
        maxHeight={240}
        onReady={(instance) => {
          editor.current = instance;
          onReady?.(instance);
        }}
      />
      <div
        className="sn-composer-bar"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          editor.current?.focus({ preventScroll: true });
        }}
      >
        <div className="sn-composer-tools">
          <IconButton icon="image" label="添加图片附件；截图也可直接粘贴到光标处" size="sm" onMouseDown={keepFocus} onClick={() => toast({ message: 'Playground 不读取本机文件，附件只作展示' })} />
          <IconButton icon="file" label="引用文件（复制一份保存）；也可粘贴复制的文件" size="sm" onMouseDown={keepFocus} onClick={() => toast({ message: 'Playground 不读取本机文件，附件只作展示' })} />
          {tag ? (
            <span className="sn-composer-tag">
              #{tag}
              <IconButton icon="x" label="不带这个标签" size="sm" onMouseDown={keepFocus} onClick={onSkipTag} />
            </span>
          ) : null}
        </div>
        {surface.inlineShortcuts ? <Keys combo={SHORTCUT_KEYS.save} /> : <span className="sn-composer-count">{Array.from(data.draft).length} 字</span>}
        <IconButton icon="check" label={`保存 · ${SHORTCUT_KEYS.save}`} size="sm" variant="primary" disabled={empty} onMouseDown={keepFocus} onClick={save} />
      </div>
    </div>
  );
}
