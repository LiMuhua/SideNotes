/**
 * 速记浮窗：用全局快捷键呼出，随手记下就回到原来的工作。
 *
 * 结构与文字沿用现有应用（`src/components/Capture.tsx`）：标题区（在侧栏继续、收起），编辑区，
 * 底栏（附件工具与字数、收起、保存）。草稿与侧栏的新建卡片共用。
 * Ctrl+Enter 保存并收起，Esc 保留草稿并收起；底栏的保存按钮保存后保持浮窗展开。
 *
 * 本次提出：草稿状态一行去掉；快捷键与 Markdown 的说明收进标题旁的问号，界面上不常驻；
 * 字数放在附件工具的右边。编辑区填满标题区与底栏之间的空间，内容超出时只在编辑器里滚动，编辑区里不画边框或强调线。
 * 磨砂玻璃主题中，浮窗是一整块玻璃，编辑器直接写在玻璃上（见 windows.css）。
 * 标题区标为拖动区域（data-drag-region）：Playground 中按住标题区可以移动浮窗，便于把它放到不同的背景上检查材质；
 * 现有应用的速记浮窗不能拖动。
 */

import { useRef } from 'react';
import type { MarkdownEditor } from '@/core/editor';
import { NoteEditor } from '../content/NoteEditor';
import { useNotes } from '../model/notes';
import { IconButton } from '../ui/Button';
import { cx, useSurface, useFormFactor } from '../ui/context';
import { Keys } from '../ui/Misc';
import { useToast } from '../ui/Tabs';
import { HelpTip } from '../ui/Tooltip';
import { BrandMark } from './SidebarParts';
import { SHORTCUT_KEYS } from './shortcuts';

export interface CaptureWindowProps {
  /** 收起浮窗（保留草稿）。 */
  onClose: () => void;
  /** 在侧栏继续：收起浮窗、展开侧栏，草稿出现在新建卡片中。 */
  onContinue: () => void;
}

export function CaptureWindow({ onClose, onContinue }: CaptureWindowProps) {
  const data = useNotes();
  const toast = useToast();
  const surface = useSurface();
  const phone = useFormFactor() === 'phone';
  const editor = useRef<MarkdownEditor | null>(null);
  const empty = !data.draft.trim();
  const attachmentHint = () => toast({ message: 'Playground 不读取本机文件，附件只作展示' });

  const save = (close: boolean) => {
    if (empty) return;
    data.create(data.draft);
    data.setDraft('');
    toast({ message: '已保存', tone: 'success' });
    if (close) onClose();
    else editor.current?.focus({ preventScroll: true });
  };

  return (
    <section
      className={cx('sn-capture', surface.dock === 'blocks' && 'is-blocks')}
      role="dialog"
      aria-label="速记"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          save(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="sn-capture-head" data-drag-region="">
        <div className="sn-capture-heading">
          <BrandMark small />
          <h2 className="sn-capture-title">速记</h2>
          <HelpTip label="速记">
            {phone ? null : (
              <>
                <span className="sn-help-line">
                  <Keys combo={SHORTCUT_KEYS.save} /> 保存并收起
                </span>
                <span className="sn-help-line">
                  <Keys combo="Esc" /> 收起，草稿保留
                </span>
              </>
            )}
            <span className="sn-help-line">支持 Markdown 与 #标签，草稿与侧栏的新建卡片共用</span>
          </HelpTip>
        </div>
        <div className="sn-capture-actions">
          <IconButton icon="arrow-up-right" label="在侧栏继续" onClick={onContinue} />
          <IconButton icon="x" label="保留草稿并收起" shortcut="Esc" onClick={onClose} />
        </div>
      </header>
      <div className="sn-capture-body">
        <NoteEditor
          value={data.draft}
          onChange={data.setDraft}
          autoFocus
          ariaLabel="速记内容"
          placeholder="随手记… 支持 Markdown 与 #标签"
          onReady={(instance) => {
            editor.current = instance;
          }}
        />
      </div>
      <footer className="sn-capture-foot">
        <div className="sn-composer-tools">
          <IconButton icon="image" label="添加图片附件；截图也可直接粘贴到光标处" size="sm" onClick={attachmentHint} />
          <IconButton icon="file" label="引用文件（复制一份保存）；也可粘贴复制的文件" size="sm" onClick={attachmentHint} />
        </div>
        <span className="sn-capture-count" aria-live="off">
          {Array.from(data.draft).length} 字
        </span>
        <span className="sn-spacer" />
        <IconButton icon="x" label="保留草稿并收起" shortcut="Esc" onClick={onClose} />
        <IconButton icon="check" label="保存记录，保持浮窗展开" variant="primary" disabled={empty} onClick={() => save(false)} />
      </footer>
    </section>
  );
}
