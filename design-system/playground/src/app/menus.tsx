/**
 * 菜单与弹窗：卡片菜单、侧栏菜单、移入回收站的确认、版本与更新、记录信息、更换 Emoji、管理标签、使用指南。
 *
 * 菜单项的名称、顺序与提示键沿用现有应用（`src/components/NoteMenu.tsx`、`SidebarMenu.tsx`）；
 * 使用指南的文字取自 `src/components/UsageGuide.tsx`，版本说明取自 `src/core/changelog.ts`。
 */

import { useMemo, useState } from 'react';
import { CHANGELOG } from '@/core/changelog';
import { EMOJI_GROUPS, searchEmoji } from '@/core/emoji';
import { formatFullTime, noteTitle } from '@/core/notes';
import { isValidTag, parse } from '@/core/tags';
import type { EdgeSide, Note } from '@/core/types';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { SearchInput, TextInput } from '../ui/Field';
import type { MenuItem } from '../ui/Menu';
import { cx } from '../ui/context';
import { useToast } from '../ui/Tabs';
import { useNotes } from '../model/notes';
import { SHORTCUT_KEYS } from './shortcuts';

export type NoteCommand = 'copy' | 'edit' | 'collapse' | 'pin' | 'archive' | 'duplicate' | 'export' | 'info' | 'trash' | 'restore';

/** 卡片菜单：按记录状态生成。 */
export function noteMenuItems(note: Note, run: (command: NoteCommand) => void): MenuItem[] {
  const items: MenuItem[] = [
    { id: 'copy', label: '复制内容与附件', icon: 'copy', shortcut: 'Ctrl+C', onSelect: () => run('copy') },
    { id: 'edit', label: '编辑内容', icon: 'edit', shortcut: '双击', onSelect: () => run('edit') },
    { id: 'collapse', label: note.collapsed ? '展开正文' : '收起正文', icon: 'chevron-down', onSelect: () => run('collapse') },
  ];
  if (note.status === 'active') {
    items.push({
      id: 'pin',
      label: note.pinned ? '移到普通记录' : '置顶记录',
      icon: note.pinned ? 'pin-off' : 'pin',
      separatorBefore: true,
      onSelect: () => run('pin'),
    });
  }
  items.push(
    {
      id: 'archive',
      label: note.status === 'archived' ? '移回工作区' : '归档记录',
      icon: note.status === 'archived' ? 'restore' : 'archive',
      separatorBefore: note.status !== 'active',
      onSelect: () => run('archive'),
    },
    { id: 'duplicate', label: '创建副本', icon: 'duplicate', separatorBefore: true, onSelect: () => run('duplicate') },
    { id: 'export', label: '导出 Markdown', icon: 'download', onSelect: () => run('export') },
    { id: 'info', label: '记录信息', icon: 'info', onSelect: () => run('info') },
    { id: 'trash', label: '移入回收站', icon: 'trash', danger: true, separatorBefore: true, shortcut: 'Delete', onSelect: () => run('trash') },
  );
  return items;
}

export type SidebarCommand = 'new' | 'search' | 'collapse-all' | 'expand-all' | 'select-all' | 'pin' | 'edge' | 'settings' | 'guide' | 'hide';

/** 侧栏菜单：空白处或标题栏右键打开。 */
export function sidebarMenuItems(
  state: { count: number; hasExpanded: boolean; pinned: boolean; edge: EdgeSide },
  run: (command: SidebarCommand) => void,
): MenuItem[] {
  const items: MenuItem[] = [
    { id: 'new', label: '新建记录', icon: 'plus', shortcut: SHORTCUT_KEYS.newNote, onSelect: () => run('new') },
    { id: 'search', label: '搜索记录', icon: 'search', shortcut: SHORTCUT_KEYS.search, onSelect: () => run('search') },
  ];
  if (state.count > 0) {
    items.push(
      state.hasExpanded
        ? { id: 'collapse-all', label: '收起全部卡片', icon: 'chevron-up', shortcut: '双击空白处', separatorBefore: true, onSelect: () => run('collapse-all') }
        : { id: 'expand-all', label: '展开全部卡片', icon: 'chevron-down', shortcut: '双击空白处', separatorBefore: true, onSelect: () => run('expand-all') },
      { id: 'select-all', label: '选择全部记录', icon: 'check-circle', onSelect: () => run('select-all') },
    );
  }
  items.push(
    { id: 'pin', label: state.pinned ? '取消固定侧栏' : '固定侧栏', icon: state.pinned ? 'pin-off' : 'pin', separatorBefore: true, onSelect: () => run('pin') },
    {
      id: 'edge',
      label: state.edge === 'left' ? '停靠到屏幕右侧' : '停靠到屏幕左侧',
      icon: state.edge === 'left' ? 'arrow-right' : 'arrow-left',
      onSelect: () => run('edge'),
    },
    { id: 'settings', label: '设置', icon: 'settings', onSelect: () => run('settings') },
    { id: 'guide', label: '使用指南', icon: 'info', onSelect: () => run('guide') },
    {
      id: 'hide',
      label: '收起侧栏',
      icon: state.edge === 'left' ? 'arrow-left' : 'arrow-right',
      shortcut: 'Esc',
      separatorBefore: true,
      onSelect: () => run('hide'),
    },
  );
  return items;
}

/** 移入回收站的确认：说明只取第一行，最多 70 字（与现有应用一致）。 */
export function TrashConfirm({ notes, onCancel, onConfirm }: { notes: Note[] | null; onCancel: () => void; onConfirm: () => void }) {
  const first = notes?.[0];
  const line = first ? parse(first.text).body.split('\n').find((item) => item.trim()) ?? '' : '';
  return (
    <ConfirmDialog
      open={Boolean(notes?.length)}
      title={notes && notes.length > 1 ? `将这 ${notes.length} 条记录移入回收站？` : '将这条记录移入回收站？'}
      description={notes && notes.length > 1 ? '可以在设置的「回收站」中恢复。' : line.slice(0, 70)}
      confirmLabel="移入回收站"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** 版本与更新：只列当前版本，按分号拆成要点。 */
export function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = CHANGELOG[0];
  const points = current.summary.split(/[；;]/).map((item) => item.trim()).filter(Boolean);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="版本与更新"
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          知道了
        </Button>
      }
    >
      <p className="sn-changelog-version">{current.version} 预览版</p>
      <ul className="sn-changelog-list">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </Dialog>
  );
}

/** 记录信息：创建与修改时间、字数、标签与位置。 */
export function NoteInfoDialog({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const parsed = note ? parse(note.text) : null;
  const rows: Array<[string, string]> = note && parsed
    ? [
        ['标题', noteTitle(note)],
        ['位置', note.status === 'archived' ? '归档' : note.status === 'trash' ? '回收站' : note.pinned ? '工作区 · 置顶' : '工作区'],
        ['创建', formatFullTime(note.createdAt)],
        ['修改', formatFullTime(note.updatedAt)],
        ['字数', `${Array.from(parsed.body).length} 字 · ${parsed.body.split('\n').length} 行`],
        ['标签', parsed.tags.length ? parsed.tags.map((tag) => `#${tag}`).join(' ') : '无'],
      ]
    : [];
  return (
    <Dialog open={Boolean(note)} onClose={onClose} title="记录信息" size="sm">
      <dl className="sn-info-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/** 更换 Emoji：按分类浏览或搜索。 */
export function EmojiDialog({ note, onPick, onClose }: { note: Note | null; onPick: (emoji: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const items = useMemo(() => searchEmoji(query, group).slice(0, 120), [query, group]);
  return (
    <Dialog open={Boolean(note)} onClose={onClose} title="更换 Emoji" size="sm">
      <div className="sn-emoji-picker">
        <SearchInput value={query} onValueChange={setQuery} placeholder="搜索 Emoji" aria-label="搜索 Emoji" inputSize="sm" data-autofocus />
        <div className="sn-emoji-groups" role="group" aria-label="分类">
          {[{ id: 'all', label: '全部' }, ...EMOJI_GROUPS].map((item) => (
            <button key={item.id} type="button" className={cx('sn-emoji-group', group === item.id && 'is-active')} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="sn-emoji-grid">
          {items.map((item) => (
            <button
              key={item.emoji}
              type="button"
              className={cx('sn-emoji-cell', note?.emoji === item.emoji && 'is-current')}
              aria-label={item.label}
              title={item.label}
              onClick={() => onPick(item.emoji)}
            >
              {item.emoji}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * 管理标签（沿用现有应用的 TagManageDialog）：只修改标签、保留记录内容；
 * 可以在所有记录中重命名（与已有标签同名时合并），或经二次确认后从所有记录中移除。
 */
export function TagManageDialog({
  tag,
  onClose,
  onRenamed,
  onRemoved,
}: {
  tag: string | null;
  onClose: () => void;
  onRenamed: (next: string) => void;
  onRemoved: () => void;
}) {
  // 每次打开都以当前标签为输入框的初始值。
  return tag ? <TagManageBody key={tag} tag={tag} onClose={onClose} onRenamed={onRenamed} onRemoved={onRemoved} /> : null;
}

function TagManageBody({ tag, onClose, onRenamed, onRemoved }: { tag: string; onClose: () => void; onRenamed: (next: string) => void; onRemoved: () => void }) {
  const data = useNotes();
  const toast = useToast();
  const [name, setName] = useState(tag);
  const [confirming, setConfirming] = useState(false);

  const rename = () => {
    const next = name.trim().replace(/^#/, '');
    if (!isValidTag(next)) {
      toast({ message: '标签最多40字；使用文字、数字、下划线或短横线，避免十六进制色值', tone: 'danger' });
      return;
    }
    data.renameTag(tag, next);
    onRenamed(next);
    toast({ message: '标签已更新，相同标签已合并', tone: 'success' });
  };

  if (confirming) {
    return (
      <ConfirmDialog
        open
        title={`移除 #${tag}？`}
        description="从所有记录中移除此标签；记录正文与附件保留。"
        confirmLabel="移除标签"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          data.removeTagEverywhere(tag);
          onRemoved();
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`管理 #${tag}`}
      description="只修改标签，保留记录内容。"
      size="sm"
      footer={
        <>
          <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>
            移除此标签
          </Button>
          <Button variant="primary" icon="edit" onClick={rename}>
            重命名 / 合并
          </Button>
        </>
      }
    >
      <TextInput
        aria-label="标签名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          rename();
        }}
        data-autofocus
      />
    </Dialog>
  );
}

/** 使用指南：文字取自现有应用，快捷键按当前设置。 */
const GUIDE: ReadonlyArray<{ title: string; tips: readonly string[] }> = [
  {
    title: '卡片',
    tips: [
      '指针移到卡片上或单击即选中，按 Ctrl+C 复制；双击进入编辑。',
      '右键卡片打开更多操作；按住卡片拖动可以排序，拖到页签或回收站即移动过去。',
      '正文较长时渐隐显示，双击卡片查看全文；最大高度可在设置中调整。',
    ],
  },
  {
    title: '编辑',
    tips: [
      `${SHORTCUT_KEYS.save} 保存，Esc 取消。新建卡片保存后侧栏保持展开，可以接着记下一条。`,
      '支持 Markdown 快捷键与 #标签；粘贴截图或文件会保存一份副本，插入到光标处。',
      '点击图片或文件查看详情，可以修改引用、更换文件或另存为；按住 Ctrl 点击直接打开。',
    ],
  },
  {
    title: '侧栏',
    tips: [
      '鼠标移到屏幕边缘呼出侧栏，移开后自动收起；固定按钮可以让它保持展开。',
      `${SHORTCUT_KEYS.search} 搜索，输入 # 按标签查找。`,
      '空白处右键打开侧栏菜单，双击空白处收起或展开全部卡片。',
    ],
  },
];

export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="使用指南"
      footer={
        <Button variant="primary" onClick={onClose}>
          知道了
        </Button>
      }
    >
      {GUIDE.map((section) => (
        <section key={section.title} className="sn-guide-section">
          <h3 className="sn-guide-title">{section.title}</h3>
          <ul className="sn-guide-list">
            {section.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ))}
    </Dialog>
  );
}
