/**
 * 侧栏的各个部件：标题区、页签与搜索、整理提醒、列表顶栏与标签筛选、筛选条、底栏。
 *
 * 结构与文字沿用现有应用（`src/components/Sidebar.tsx`）；外观由主题的令牌与结构说明决定。
 */

import { useRef, useState, type KeyboardEvent } from 'react';
import { suggestTags } from '@/core/notes';
import type { EdgeSide, TabKey } from '@/core/types';
import { TAB_LABELS, TAB_ORDER, tagsInTab, useNotes, type SidebarView } from '../model/notes';
import { IconButton } from '../ui/Button';
import { cx, useSurface, useFormFactor } from '../ui/context';
import { Icon, type IconName } from '../ui/Icon';
import { DropdownMenu } from '../ui/Menu';
import { Keys } from '../ui/Misc';
import { SHORTCUT_KEYS } from './shortcuts';

/** 品牌标记：三根竖条，与现有应用一致。 */
export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={cx('sn-brand-mark', small && 'is-small')} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export interface HeaderProps {
  pinned: boolean;
  /** 设置窗口打开期间侧栏保持展开，固定按钮显示为联动状态（T31）。 */
  linked: boolean;
  edge: EdgeSide;
  onTogglePinned: () => void;
  onHide: () => void;
  onVersion: () => void;
}

export function SidebarHeader({ pinned, linked, edge, onTogglePinned, onHide, onVersion }: HeaderProps) {
  // 手机上侧栏就是整个应用，没有屏幕边缘可以收起，也就不需要固定与收起。
  const phone = useFormFactor() === 'phone';
  return (
    <header className="sn-side-head">
      <div className="sn-side-brand">
        <BrandMark />
        <div className="sn-side-brand-text">
          <h2 className="sn-side-title">SideNotes</h2>
          <button type="button" className="sn-side-version" aria-label="版本与更新" title="版本与更新日志" onClick={onVersion}>
            {__APP_VERSION__} PREVIEW
          </button>
        </div>
      </div>
      {phone ? null : (
        <div className="sn-side-actions">
          <IconButton
            icon={pinned || linked ? 'pin' : 'pin-off'}
            label={pinned ? '取消固定侧栏' : linked ? '设置窗口打开期间侧栏保持展开；点击可一直固定' : '固定侧栏保持展开'}
            pressed={pinned || linked}
            className={cx(linked && !pinned && 'is-linked')}
            onClick={onTogglePinned}
          />
          <IconButton icon={edge === 'left' ? 'arrow-left' : 'arrow-right'} label="收起侧栏" shortcut="Esc" onClick={onHide} />
        </div>
      )}
    </header>
  );
}

const TAB_ICONS: Record<TabKey, IconName | null> = { workspace: null, pinned: 'pin', archive: 'archive' };

export function SidebarNav({ view, onSearchInput }: { view: SidebarView; onSearchInput?: (element: HTMLInputElement | null) => void }) {
  const surface = useSurface();
  return (
    <div className={cx('sn-side-nav', view.searchOpen && 'is-searching')}>
      <div className={cx('sn-tabs-row', `is-${surface.tabs}`, surface.tabMarks && 'has-marks')} role="tablist" aria-label="记录列表">
        {TAB_ORDER.map((tab) => {
          const icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view.tab === tab}
              className="sn-side-tab"
              data-tab={tab}
              onClick={() => view.setTab(tab)}
            >
              <span className="sn-side-tab-mark" aria-hidden="true" />
              {icon ? <Icon name={icon} /> : null}
              <span className="sn-side-tab-label">{TAB_LABELS[tab]}</span>
              <span className="sn-side-tab-count">{view.counts[tab]}</span>
            </button>
          );
        })}
      </div>
      <SearchBox view={view} onInput={onSearchInput} />
    </div>
  );
}

/**
 * 搜索：图标按钮展开为输入框；输入 #标签 时以灰字联想已有标签，Tab 选用（T41）；
 * 失焦且没有内容时自动收起。
 */
function SearchBox({ view, onInput }: { view: SidebarView; onInput?: (element: HTMLInputElement | null) => void }) {
  const data = useNotes();
  const surface = useSurface();
  const match = view.query.match(/(?:^|\s)#([\p{L}\p{N}_-]+)$/u);
  const prefix = match?.[1] ?? '';
  const ghost = prefix ? (suggestTags(data.notes, {}, prefix)[0] ?? '').slice(prefix.length) : '';

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab' && ghost) {
      event.preventDefault();
      view.setQuery(`${view.query}${ghost}`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (view.query) view.setQuery('');
      else view.setSearchOpen(false);
    }
  };

  if (!view.searchOpen) {
    return (
      <IconButton
        icon="search"
        label="搜索记录与标签"
        shortcut={SHORTCUT_KEYS.search}
        className="sn-search-toggle"
        onClick={() => view.setSearchOpen(true)}
      />
    );
  }

  return (
    <div className={cx('sn-side-search', view.query && 'has-query')}>
      <Icon name="search" />
      <div className="sn-side-search-field">
        {ghost ? (
          <span className="sn-side-search-ghost" aria-hidden="true">
            <span className="sn-side-search-typed">{view.query}</span>
            {ghost}
          </span>
        ) : null}
        <input
          ref={onInput}
          // 由用户展开搜索时挂载，挂载即聚焦。
          autoFocus
          type="search"
          value={view.query}
          placeholder="搜索记录、#标签…"
          aria-label="搜索记录与标签"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => view.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (!view.query && !event.currentTarget.closest('.sn-side-search')?.contains(event.relatedTarget as Node | null)) view.setSearchOpen(false);
          }}
        />
      </div>
      {ghost ? <Keys combo="Tab" /> : surface.inlineShortcuts && !view.query ? <Keys combo="Esc" /> : null}
      {view.query ? <IconButton icon="x" label="清空搜索" size="sm" onClick={() => view.setQuery('')} /> : null}
    </div>
  );
}

/** 整理提醒：工作区记录超过阈值时出现（T 系列「整理提醒」）。 */
export function TidyNudge({ onArchive, onSnooze, onClose }: { onArchive: () => void; onSnooze: () => void; onClose: () => void }) {
  return (
    <div className="sn-nudge" role="status">
      <Icon name="alert" />
      <p className="sn-nudge-text">
        <strong>工作区记录较多</strong>
        <button type="button" className="sn-nudge-link" onClick={onArchive}>
          归档旧记录
        </button>
        可以让工作区保持整洁
        <button type="button" className="sn-nudge-link" onClick={onSnooze}>
          七天后再说
        </button>
      </p>
      <IconButton icon="x" label="关闭提醒" size="sm" onClick={onClose} />
    </div>
  );
}

/** 列表顶栏：条数与标签筛选菜单。 */
export function ListTopline({ view }: { view: SidebarView }) {
  const data = useNotes();
  const tags = tagsInTab(data.notes, view.tab);
  return (
    <div className="sn-topline">
      <p className="sn-topline-count">
        {view.items.length} 条{view.tag ? ` · #${view.tag}` : ''}
      </p>
      <DropdownMenu
        label="按标签筛选"
        placement="bottom-end"
        items={
          tags.length
            ? [
                ...tags.map((entry) => ({
                  id: entry.tag,
                  label: `#${entry.tag}`,
                  kind: 'radio' as const,
                  checked: view.tag === entry.tag,
                  shortcut: String(entry.count),
                  onSelect: () => view.setTag(view.tag === entry.tag ? '' : entry.tag),
                })),
                { id: 'clear', label: '清除标签筛选', icon: 'x' as const, separatorBefore: true, disabled: !view.tag, onSelect: () => view.setTag('') },
              ]
            : [{ id: 'empty', label: '这个页签里还没有标签', disabled: true, onSelect: () => {} }]
        }
        trigger={(props) => (
          <button {...props} type="button" className={cx('sn-topline-tag', view.tag && 'is-engaged')}>
            <Icon name="hash" />
            <span>{view.tag ? view.tag : '标签'}</span>
            <Icon name="chevron-down" />
          </button>
        )}
      />
    </div>
  );
}

/** 筛选条：搜索或按标签筛选时显示条件、条数与「显示全部」（T67）。 */
export function FilterBanner({ view }: { view: SidebarView }) {
  const query = view.query.trim();
  return (
    <div className="sn-filter-banner" role="status">
      <Icon name={view.tag && !query ? 'hash' : 'search'} />
      <p className="sn-filter-banner-text">
        {query ? `搜索「${query}」` : null}
        {query && view.tag ? ' · ' : null}
        {view.tag ? `标签 #${view.tag}` : null}
      </p>
      <span className="sn-filter-banner-count">
        {view.items.length} / {view.counts[view.tab]} 条
      </span>
      <button type="button" className="sn-filter-banner-clear" onClick={view.clearFilters}>
        显示全部
      </button>
    </div>
  );
}

/** 底栏：存储状态与设置；终端主题改为常驻的状态栏，加上快捷键提示，编辑时显示编辑状态与保存、取消的按键。 */
export function SidebarFooter({ view, onSettings }: { view: SidebarView; onSettings: () => void }) {
  const surface = useSurface();
  if (surface.statusLine) {
    const editing = Boolean(view.editingId);
    const keys = editing
      ? [
          { combo: SHORTCUT_KEYS.save, label: '保存' },
          { combo: 'Esc', label: '取消' },
        ]
      : [
          { combo: SHORTCUT_KEYS.newNote, label: '新建' },
          { combo: SHORTCUT_KEYS.search, label: '搜索' },
        ];
    return (
      <footer className="sn-side-foot is-status">
        {editing ? (
          <span className="sn-status-mode">编辑中</span>
        ) : (
          <span className="sn-status-item">
            <span className="sn-status-dot" />
            已保存
          </span>
        )}
        <span className="sn-status-item">{TAB_LABELS[view.tab]} {view.counts[view.tab]} 条</span>
        {/* 放不下的快捷键提示折到第二行并被裁掉：侧栏调窄时整项消失，不会只剩半个。 */}
        <span className="sn-status-keys">
          {surface.inlineShortcuts
            ? keys.map((key) => (
                <span key={key.combo} className="sn-status-item is-keys">
                  <Keys combo={key.combo} /> {key.label}
                </span>
              ))
            : null}
        </span>
        <IconButton icon="settings" label="偏好设置与数据" size="sm" onClick={onSettings} />
      </footer>
    );
  }
  return (
    <footer className="sn-side-foot">
      <span className="sn-storage" title="数据保存在本机">
        <span className="sn-status-dot" />
        已保存到本地
      </span>
      <IconButton icon="settings" label="偏好设置与数据" onClick={onSettings} />
    </footer>
  );
}

/** 拖动调整侧栏宽度的手柄，放在侧栏朝向屏幕内侧的一边。 */
export function Resizer({ edge, width, min, max, onChange }: { edge: EdgeSide; width: number; min: number; max: number; onChange: (width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={cx('sn-resizer', dragging && 'is-dragging')}
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        // 预览区可能缩放显示，按元素的实际缩放换算指针位移。
        const box = event.currentTarget.getBoundingClientRect();
        const scale = box.width / (event.currentTarget.offsetWidth || 1) || 1;
        const delta = (event.clientX - start.current.x) / scale;
        const next = start.current.width + (edge === 'right' ? -delta : delta);
        onChange(Math.round(Math.min(max, Math.max(min, next)) / 4) * 4);
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 8;
        const grow = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
        const shrink = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
        if (event.key === grow) onChange(Math.min(max, width + step));
        else if (event.key === shrink) onChange(Math.max(min, width - step));
        else return;
        event.preventDefault();
      }}
    />
  );
}
