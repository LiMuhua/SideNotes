/**
 * 组件页：侧栏专有的组件与状态。卡片的各种状态都用真实的 NoteCard 渲染，只是把回调换成空操作。
 */

import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Note } from '@/core/types';
import { notesInTab, useNotes, useSidebarView } from '../model/notes';
import { Composer } from '../app/Composer';
import { ChangelogDialog, EmojiDialog, GuideDialog, NoteInfoDialog, noteMenuItems, sidebarMenuItems, TrashConfirm } from '../app/menus';
import { NoteCard, type NoteCardProps } from '../app/NoteCard';
import { FilterBanner, ListTopline, SidebarFooter, SidebarNav, TidyNudge } from '../app/SidebarParts';
import { Button } from '../ui/Button';
import { cx, useSurface } from '../ui/context';
import { Icon } from '../ui/Icon';
import { ContextMenu } from '../ui/Menu';
import { useToast } from '../ui/Tabs';
import { Demo, DemoRow, PageSection, StateCell } from './common';

const noop = () => {};

/** 侧栏面板的一小块：示例放在真实的面板底色上，宽度与侧栏一致；记录卡片放在与侧栏相同的列表容器里。 */
export function PanelSample({ children, className, list = false }: { children: ReactNode; className?: string; list?: boolean }) {
  const surface = useSurface();
  return (
    <div className={cx('sn-panel-sample', 'sn-sidebar', `is-${surface.dock}`, `has-${surface.entries}`, className)}>
      {list ? <div className={cx('sn-note-list', `is-${surface.entries}`)}>{children}</div> : children}
    </div>
  );
}

export function StaticCard({ note, ...overrides }: { note: Note } & Partial<NoteCardProps>) {
  return (
    <NoteCard
      note={note}
      tab="workspace"
      active={false}
      checked={false}
      editing={false}
      dimmed={false}
      maxHeight={220}
      tabIndex={-1}
      onHover={noop}
      onSelect={noop}
      onEdit={noop}
      onSave={noop}
      onCancel={noop}
      onMenu={noop}
      onCopy={noop}
      onTogglePin={noop}
      onToggleArchive={noop}
      onToggleCollapse={noop}
      onTag={noop}
      onEmoji={noop}
      onTextChange={noop}
      onKeyDown={noop}
      {...overrides}
    />
  );
}

export function NotesSection() {
  const data = useNotes();
  const workspace = notesInTab(data.notes, 'workspace');
  const archived = notesInTab(data.notes, 'archive');
  const [editing, setEditing] = useState(false);
  const pick = (index: number) => workspace[index % Math.max(1, workspace.length)];
  if (!workspace.length) return null;
  const collapsed = { ...pick(2), collapsed: true };
  const pinned = workspace.find((note) => note.pinned) ?? pick(1);

  return (
    <PageSection id="gallery-cards" title="记录卡片" description="同一张卡片的各种状态。悬停与单击共用一个高亮；编辑中的卡片成为视觉焦点，其余卡片变淡（T21）。">
      <Demo title="默认、高亮与多选" note="高亮时显示操作按钮；多选的卡片用强调色浅底。" wide>
        <div className="sn-card-matrix">
          <StateCell label="默认">
            <PanelSample list>
              <StaticCard note={pick(0)} />
            </PanelSample>
          </StateCell>
          <StateCell label="高亮（悬停或单击）">
            <PanelSample list>
              <StaticCard note={pick(0)} active />
            </PanelSample>
          </StateCell>
          <StateCell label="多选">
            <PanelSample list>
              <StaticCard note={pick(0)} checked />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
      <Demo title="编辑中与变淡" note="双击进入编辑；Ctrl+Enter 保存，Esc 取消，点到卡片之外即保存。" wide>
        <div className="sn-card-matrix">
          <StateCell label="编辑中（可以直接输入）">
            <PanelSample list>
              {editing ? (
                <StaticCard note={pick(3)} editing onSave={() => setEditing(false)} onCancel={() => setEditing(false)} />
              ) : (
                <StaticCard note={pick(3)} active onEdit={() => setEditing(true)} />
              )}
              {editing ? null : (
                <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)}>
                  进入编辑
                </Button>
              )}
            </PanelSample>
          </StateCell>
          <StateCell label="其它卡片正在编辑">
            <PanelSample list>
              <StaticCard note={pick(4)} dimmed />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
      <Demo title="折叠、置顶与归档" note="点时间收起正文，只留标题行；置顶的记录在工作区显示图钉。" wide>
        <div className="sn-card-matrix">
          <StateCell label="收起正文">
            <PanelSample list>
              <StaticCard note={collapsed} />
            </PanelSample>
          </StateCell>
          <StateCell label="置顶">
            <PanelSample list>
              <StaticCard note={pinned} />
            </PanelSample>
          </StateCell>
          {archived[0] ? (
            <StateCell label="归档">
              <PanelSample list>
                <StaticCard note={archived[0]} tab="archive" />
              </PanelSample>
            </StateCell>
          ) : null}
        </div>
      </Demo>
      <Demo title="拖动排序（示意）" note="按住卡片拖动：插入线标出落点，拖到页签移过去，拖到底部的回收站区域删除，都可以撤销。" wide>
        <PanelSample list className="is-dragging-demo">
          <StaticCard note={pick(5)} />
          <div className="sn-drop-line" aria-hidden="true" />
          <div className="sn-drag-ghost" aria-hidden="true">
            <StaticCard note={pick(6)} active />
          </div>
          <StaticCard note={pick(7)} />
          <div className="sn-trash-zone is-over" aria-hidden="true">
            <Icon name="trash" />
            移入回收站
          </div>
        </PanelSample>
      </Demo>
    </PageSection>
  );
}

export function PartsSection() {
  const plain = useSidebarView();
  const searching = useSidebarView({ searchOpen: true, query: '#工' });
  const filtered = useSidebarView({ query: '代码' });

  return (
    <PageSection id="gallery-parts" title="侧栏部件" description="页签、搜索、列表顶栏、筛选条、整理提醒、新建卡片与底栏，都是侧栏中真实的组件。">
      <Demo title="页签" note="工作区、置顶、归档三个页签，带条数；搜索图标展开为输入框。">
        <PanelSample>
          <SidebarNav view={plain} />
        </PanelSample>
      </Demo>
      <Demo title="搜索与标签联想" note="输入 # 时以灰字联想已有标签，Tab 选用（T41）。">
        <PanelSample>
          <SidebarNav view={searching} />
        </PanelSample>
      </Demo>
      <Demo title="列表顶栏与筛选条" note="搜索或按标签筛选时，列表上方出现筛选条，显示条件与条数（T67）。">
        <PanelSample>
          <ListTopline view={filtered} />
          <FilterBanner view={filtered} />
        </PanelSample>
      </Demo>
      <Demo title="整理提醒" note="工作区记录超过阈值时出现，可以归档旧记录或七天后再提醒。">
        <PanelSample>
          <TidyNudge onArchive={noop} onSnooze={noop} onClose={noop} />
        </PanelSample>
      </Demo>
      <Demo title="新建卡片" note="可以直接输入；Ctrl+Enter 保存，保存后焦点留在这里，可以接着记下一条。">
        <PanelSample>
          <Composer />
        </PanelSample>
      </Demo>
      <Demo title="底栏" note="存储状态与设置入口；终端主题改为常驻状态栏。">
        <PanelSample>
          <SidebarFooter view={plain} onSettings={noop} />
        </PanelSample>
      </Demo>
    </PageSection>
  );
}

export function OverlaySection() {
  const data = useNotes();
  const toast = useToast();
  const note = notesInTab(data.notes, 'workspace')[0] ?? null;
  const [menu, setMenu] = useState<{ type: 'note' | 'sidebar'; point: { x: number; y: number } } | null>(null);
  const [dialog, setDialog] = useState<'trash' | 'changelog' | 'info' | 'guide' | 'emoji' | null>(null);
  const open = (type: 'note' | 'sidebar') => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ type, point: { x: box.left, y: box.bottom + 4 } });
  };

  return (
    <PageSection id="gallery-overlays" title="菜单、弹窗与提示" description="菜单项的名称、顺序与提示键沿用现有应用；移入回收站先确认，确认后的提示条可以撤销。">
      <Demo title="菜单" note="右键卡片打开卡片菜单，右键空白处打开侧栏菜单。">
        <DemoRow>
          <Button variant="secondary" trailingIcon="chevron-down" onClick={open('note')}>
            卡片菜单
          </Button>
          <Button variant="secondary" trailingIcon="chevron-down" onClick={open('sidebar')}>
            侧栏菜单
          </Button>
        </DemoRow>
        {menu && note ? (
          <ContextMenu
            label={menu.type === 'note' ? '记录操作' : '侧栏操作'}
            items={menu.type === 'note' ? noteMenuItems(note, noop) : sidebarMenuItems({ count: 3, hasExpanded: true, pinned: false, edge: 'right' }, noop)}
            point={menu.point}
            onClose={() => setMenu(null)}
          />
        ) : null}
      </Demo>
      <Demo title="弹窗" note="打开时焦点移入，Tab 在弹窗内循环，Esc 关闭，关闭后焦点回到打开前的位置。">
        <DemoRow>
          <Button variant="danger" onClick={() => setDialog('trash')}>
            移入回收站
          </Button>
          <Button variant="secondary" onClick={() => setDialog('changelog')}>
            版本与更新
          </Button>
          <Button variant="secondary" onClick={() => setDialog('info')}>
            记录信息
          </Button>
          <Button variant="secondary" onClick={() => setDialog('emoji')}>
            更换 Emoji
          </Button>
          <Button variant="secondary" onClick={() => setDialog('guide')}>
            使用指南
          </Button>
        </DemoRow>
        <TrashConfirm notes={dialog === 'trash' && note ? [note] : null} onCancel={() => setDialog(null)} onConfirm={() => setDialog(null)} />
        <ChangelogDialog open={dialog === 'changelog'} onClose={() => setDialog(null)} />
        <NoteInfoDialog note={dialog === 'info' ? note : null} onClose={() => setDialog(null)} />
        <EmojiDialog note={dialog === 'emoji' ? note : null} onPick={() => setDialog(null)} onClose={() => setDialog(null)} />
        <GuideDialog open={dialog === 'guide'} onClose={() => setDialog(null)} />
      </Demo>
      <Demo title="提示条" note="反色，默认在窗口顶部正中（T57、T63）；可撤销的操作带「撤销」。">
        <DemoRow>
          <Button onClick={() => toast({ message: '已复制-欢迎使用 SideNotes', tone: 'success' })}>复制</Button>
          <Button onClick={() => toast({ message: '已移入回收站', action: { label: '撤销', run: noop } })}>带撤销</Button>
          <Button onClick={() => toast({ message: '剪贴板写入失败，请重试', tone: 'danger' })}>失败</Button>
        </DemoRow>
      </Demo>
    </PageSection>
  );
}
