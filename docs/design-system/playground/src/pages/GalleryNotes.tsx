/**
 * 组件页：侧栏专有的组件与状态。卡片的各种状态都用真实的 NoteCard 渲染，只是把回调换成空操作。
 */

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Note } from '@/core/types';
import { notesInTab, tabOfTag, useNotes, useSidebarView } from '../model/notes';
import { Composer } from '../app/Composer';
import { MergeDialog, type MergeRequest } from '../app/MergeDialog';
import { AVAILABLE_UPDATE, ChangelogDialog, EmojiDialog, GuideDialog, NoteInfoDialog, noteMenuItems, sidebarMenuItems, TrashConfirm, UpdateDialog } from '../app/menus';
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
  const workspace = notesInTab(data.notes, 'workspace', data.pinnedTags);
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
      <Demo title="折叠与置顶" note="点时间收起正文，只留标题行；置顶的记录在随记与标签页签中显示图钉。第四次反馈去掉了归档，原来的归档记录回到随记，带上 #归档。" wide>
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
        </div>
      </Demo>
      <Demo
        title="拖动排序（示意）"
        note="按住卡片拖动：插入线标出落点，拖到页签移过去（标签页签按标签加减），拖到底部的回收站区域删除，都可以撤销。多选拖动时拖影是一叠真实的卡片：后面两层是另外两张选中卡片的副本，往右上错开、转开一点，露出标题栏，右上角写条数。"
        wide
      >
        <PanelSample list className="is-dragging-demo">
          <StaticCard note={pick(5)} />
          <div className="sn-drop-line" aria-hidden="true" />
          <div className="sn-drag-ghost" aria-hidden="true">
            <div className="sn-drag-layer" style={{ '--local-layer': 2 } as CSSProperties}>
              <StaticCard note={pick(8)} />
            </div>
            <div className="sn-drag-layer" style={{ '--local-layer': 1 } as CSSProperties}>
              <StaticCard note={pick(9)} />
            </div>
            <StaticCard note={pick(6)} active />
            <span className="sn-drag-count">3</span>
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
  const narrow = useSidebarView();
  const narrowHidden = useSidebarView({ tab: tabOfTag('生活') });
  const searching = useSidebarView({ searchOpen: true, query: '#工' });
  const filtered = useSidebarView({ query: '代码' });
  const tagged = useSidebarView({ tag: '阅读' });

  return (
    <PageSection id="gallery-parts" title="侧栏部件" description="页签、搜索、列表顶栏、筛选条、整理提醒、新建卡片与底栏，都是侧栏中真实的组件。">
      <Demo
        title="页签"
        note="随记、置顶与手动固定的标签（第四次反馈），最后一格是菜单：收起的页签与「新建页签」。条数只写在随记与当前页签上；双击标签页签改名，右键可以移出页签栏。放大镜展开搜索框，盖住页签。"
      >
        <PanelSample>
          <SidebarNav view={plain} />
        </PanelSample>
      </Demo>
      <Demo title="页签放不下" note="多出来的页签从右往左收进最后一格「N ▾」。选中收起的页签时前面的页签不动，最后一格写它的名称并带当前样式。">
        <div className="sn-card-matrix">
          <StateCell label="放不下时">
            <PanelSample className="is-narrow">
              <SidebarNav view={narrow} />
            </PanelSample>
          </StateCell>
          <StateCell label="当前是收起的页签">
            <PanelSample className="is-narrow">
              <SidebarNav view={narrowHidden} />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
      <Demo title="搜索与标签联想" note="输入 # 时以灰字联想已有标签，Tab 选用，↑ ↓ 切换候选（T41）；再点放大镜收起并清空搜索词。">
        <PanelSample>
          <SidebarNav view={searching} />
        </PanelSample>
      </Demo>
      <Demo
        title="列表顶栏与筛选条"
        note="标签菜单列出评分最高的六个标签，可以管理标签或转到 #标签 搜索；筛选时列表上方出现筛选条（T67）。按标签筛选时筛选条上还有「固定为页签」与「合并」（第四次反馈）。"
      >
        <PanelSample>
          <ListTopline view={filtered} onManageTag={noop} onSearchTags={noop} />
          <FilterBanner view={filtered} />
          <FilterBanner view={tagged} onPin={noop} onMerge={noop} />
        </PanelSample>
      </Demo>
      <Demo title="整理提醒" note="记录超过阈值时出现，建议把同一类的记录固定为页签或合并成一条，可以七天后再提醒。">
        <PanelSample>
          <TidyNudge onSnooze={noop} onClose={noop} />
        </PanelSample>
      </Demo>
      <Demo
        title="新建卡片"
        note="可以直接输入；获得焦点时与编辑中的卡片一样换成编辑底色并浮起。Ctrl+Enter 保存，保存后焦点留在这里，可以接着记下一条。在标签页签中新建时，工具栏上有一个「#标签 ×」，保存时带上这个标签。"
      >
        <div className="sn-card-matrix">
          <StateCell label="随记">
            <PanelSample>
              <Composer />
            </PanelSample>
          </StateCell>
          <StateCell label="在标签页签「工作」中">
            <PanelSample>
              <Composer tag="工作" onSkipTag={noop} />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
      <Demo title="底栏" note="左下角是缩小的版本号，检查到新版本时右上角带一个更新角标，点开列出即将更新的内容；右边是设置（Ctrl+,）。">
        <div className="sn-card-matrix">
          <StateCell label="发现新版本">
            <PanelSample>
              <SidebarFooter update={AVAILABLE_UPDATE?.version ?? null} onVersion={noop} onSettings={noop} />
            </PanelSample>
          </StateCell>
          <StateCell label="已是最新版本">
            <PanelSample>
              <SidebarFooter update={null} onVersion={noop} onSettings={noop} />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
    </PageSection>
  );
}

export function OverlaySection() {
  const data = useNotes();
  const toast = useToast();
  const list = notesInTab(data.notes, 'workspace', data.pinnedTags);
  const note = list[0] ?? null;
  const [menu, setMenu] = useState<{ type: 'note' | 'selected' | 'sidebar'; point: { x: number; y: number } } | null>(null);
  const [dialog, setDialog] = useState<'trash' | 'changelog' | 'update' | 'info' | 'guide' | 'emoji' | null>(null);
  const [merging, setMerging] = useState<MergeRequest | null>(null);
  // 合并的示例：示例数据中带 #生活 的记录（会真的写入 Playground 的示例数据，可以撤销）。
  const living = notesInTab(data.notes, tabOfTag('生活'), data.pinnedTags).map((item) => item.id);
  const open = (type: 'note' | 'selected' | 'sidebar') => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ type, point: { x: box.left, y: box.bottom + 4 } });
  };

  return (
    <PageSection id="gallery-overlays" title="菜单、弹窗与提示" description="菜单项的名称、顺序与提示键沿用现有应用；移入回收站先确认，确认后的提示条可以撤销。">
      <Demo title="菜单" note="右键卡片打开卡片菜单，右键空白处打开侧栏菜单。卡片菜单去掉了归档，换成「移到…」；多选之中的卡片最上面是「合并成一条…」与「合并到这条」（第四次反馈）。">
        <DemoRow>
          <Button variant="secondary" trailingIcon="chevron-down" onClick={open('note')}>
            卡片菜单
          </Button>
          <Button variant="secondary" trailingIcon="chevron-down" onClick={open('selected')}>
            多选中的卡片菜单
          </Button>
          <Button variant="secondary" trailingIcon="chevron-down" onClick={open('sidebar')}>
            侧栏菜单
          </Button>
        </DemoRow>
        {menu && note ? (
          <ContextMenu
            label={menu.type === 'sidebar' ? '侧栏操作' : '记录操作'}
            items={
              menu.type === 'sidebar'
                ? sidebarMenuItems({ count: 3, hasExpanded: true, pinned: false, edge: 'right' }, noop)
                : noteMenuItems(note, noop, { selected: menu.type === 'selected' ? 3 : 0, canMove: true })
            }
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
          <Button variant="secondary" onClick={() => setDialog('update')}>
            发现新版本
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
          <Button variant="secondary" icon="merge" disabled={living.length < 2} onClick={() => setMerging({ ids: living, tag: '生活' })}>
            合并成一条
          </Button>
        </DemoRow>
        <TrashConfirm notes={dialog === 'trash' && note ? [note] : null} onCancel={() => setDialog(null)} onConfirm={() => setDialog(null)} />
        <ChangelogDialog open={dialog === 'changelog'} onClose={() => setDialog(null)} />
        <UpdateDialog update={AVAILABLE_UPDATE} open={dialog === 'update'} onClose={() => setDialog(null)} />
        <NoteInfoDialog note={dialog === 'info' ? note : null} onClose={() => setDialog(null)} />
        <EmojiDialog note={dialog === 'emoji' ? note : null} onPick={() => setDialog(null)} onClose={() => setDialog(null)} />
        <GuideDialog open={dialog === 'guide'} onClose={() => setDialog(null)} />
        <MergeDialog request={merging} onClose={() => setMerging(null)} onDone={() => setMerging(null)} />
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
