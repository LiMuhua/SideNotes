/**
 * 新建卡片：固定在记录列表之上，独占顶部的一块区域，列表滚动时卡片从它下方移出。
 *
 * 草稿与速记浮窗共用（现有应用中两个入口共用同一份草稿）。Ctrl+Enter 保存后侧栏保持展开，
 * 焦点留在新建卡片，可以接着记下一条（T47）。工具与操作在聚焦或有内容时才显示，平时只是一行占位。
 */

import { useRef, useState, type MouseEvent } from 'react';
import type { MarkdownEditor } from '@/core/editor';
import { NoteEditor } from '../content/NoteEditor';
import { useNotes } from '../model/notes';
import { IconButton } from '../ui/Button';
import { cx, useDirection, useFormFactor } from '../ui/context';
import { Keys } from '../ui/Misc';
import { useToast } from '../ui/Tabs';
import { SHORTCUT_KEYS } from './shortcuts';

export interface ComposerProps {
  /** 保存了一条新记录。 */
  onSaved?: (id: string) => void;
  /** 父组件用来聚焦新建卡片（Ctrl+N）。 */
  onReady?: (editor: MarkdownEditor) => void;
}

export function Composer({ onSaved, onReady }: ComposerProps) {
  const data = useNotes();
  const toast = useToast();
  const direction = useDirection();
  const phone = useFormFactor() === 'phone';
  const editor = useRef<MarkdownEditor | null>(null);
  const [focused, setFocused] = useState(false);
  const empty = !data.draft.trim();
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  const save = () => {
    if (empty) return;
    const note = data.create(data.draft);
    data.setDraft('');
    toast({ message: '已保存', tone: 'success' });
    onSaved?.(note.id);
    editor.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className={cx('sn-composer', (focused || !empty) && 'is-open')}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
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
      <div className="sn-composer-bar">
        <div className="sn-composer-tools">
          <IconButton icon="image" label="添加图片附件；截图也可直接粘贴到光标处" size="sm" onMouseDown={keepFocus} onClick={() => toast({ message: 'Playground 不读取本机文件，附件只作展示' })} />
          <IconButton icon="file" label="引用文件（复制一份保存）；也可粘贴复制的文件" size="sm" onMouseDown={keepFocus} onClick={() => toast({ message: 'Playground 不读取本机文件，附件只作展示' })} />
        </div>
        {direction.inlineShortcuts ? <Keys combo={SHORTCUT_KEYS.save} /> : <span className="sn-composer-count">{Array.from(data.draft).length} 字</span>}
        <IconButton
          icon="x"
          label="收起输入"
          size="sm"
          onMouseDown={keepFocus}
          onClick={() => {
            editor.current?.element.blur();
            setFocused(false);
          }}
        />
        <IconButton icon="check" label={`保存 · ${SHORTCUT_KEYS.save}`} size="sm" variant="primary" disabled={empty} onMouseDown={keepFocus} onClick={save} />
      </div>
    </div>
  );
}
