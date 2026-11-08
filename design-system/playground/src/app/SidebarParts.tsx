/**
 * 侧栏的各个部件：标题区、页签与搜索、整理提醒、列表顶栏与标签筛选、筛选条、底栏。
 *
 * 结构与文字沿用现有应用（`src/components/Sidebar.tsx`）；外观由主题的令牌与结构说明决定。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { rankTags, suggestTags } from '@/core/notes';
import { tagKey } from '@/core/tags';
import type { EdgeSide, TabKey } from '@/core/types';
import { TAB_LABELS, TAB_ORDER, useNotes, type SidebarView } from '../model/notes';
import { IconButton } from '../ui/Button';
import { cx, useSurface, useFormFactor } from '../ui/context';
import { Icon, type IconName } from '../ui/Icon';
import { Layer, useAnchoredPosition } from '../ui/layer';
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
}

/** 标题区：品牌与窗口操作。版本号移到底栏左下角（本次提出），标题区只留品牌名。 */
export function SidebarHeader({ pinned, linked, edge, onTogglePinned, onHide }: HeaderProps) {
  // 手机上侧栏就是整个应用，没有屏幕边缘可以收起，也就不需要固定与收起。
  const phone = useFormFactor() === 'phone';
  return (
    <header className="sn-side-head">
      <div className="sn-side-brand">
        <BrandMark />
        <h2 className="sn-side-title">SideNotes</h2>
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
      <div className={cx('sn-tabs-row', `is-${surface.tabs}`, surface.tabMarks && 'has-marks')} role="tablist" aria-label="记录列表" inert={view.searchOpen}>
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
 * 搜索（沿用现有应用）：放大镜在页签行的最右边，点击后搜索框从右向左展开，盖住页签；再点放大镜收起并清空搜索词，标签筛选保留。
 * 末尾正在输入 #标签 时以灰字联想已有标签，Tab 选用，↑ ↓ 切换候选，Esc 先关闭联想，再按 Esc 收起搜索框并清空搜索词；
 * 清空按钮同时清除搜索词与标签筛选；失焦且没有内容时自动收起。
 * 搜索框一直在页面里，展开与收起靠宽度的过渡（与现有应用一样有动画）；收起时输入框不可聚焦，展开后自动获得焦点。
 */
function SearchBox({ view, onInput }: { view: SidebarView; onInput?: (element: HTMLInputElement | null) => void }) {
  const data = useNotes();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = view.searchOpen;
  const setInput = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      onInput?.(element);
    },
    [onInput],
  );

  // 展开时把焦点放进输入框；输入框在收起时不可聚焦，所以等展开之后再聚焦。
  useEffect(() => {
    if (open && document.activeElement !== inputRef.current) inputRef.current?.focus({ preventScroll: true });
  }, [open]);
  // 关闭过联想的标签开头：Esc 关闭、Tab 选用之后，同一个开头不再提示。
  const [dismissed, setDismissed] = useState('');
  const [cycle, setCycle] = useState({ prefix: '', index: 0 });
  const prefix = view.query.match(/(?:^|\s)#([\p{L}\p{N}_-]+)$/u)?.[1] ?? '';
  // 查询中已经写过的其它标签不再提示（现有应用 TagInput 的 search 模式）。
  const written = Array.from(view.query.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu), (match) => match[1]).slice(0, -1);
  const candidates = prefix && tagKey(prefix) !== dismissed ? suggestTags(data.notes, data.tagUsage, prefix, written) : [];
  const index = cycle.prefix === prefix ? cycle.index : 0;
  const current = candidates.length ? candidates[index % candidates.length] : '';
  const ghost = current.slice(prefix.length);

  const close = () => {
    view.setSearchOpen(false);
    view.setQuery('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Tab' && !event.shiftKey && ghost) {
      event.preventDefault();
      view.setQuery(`${view.query.slice(0, view.query.length - prefix.length)}${current}`);
      setDismissed(tagKey(current));
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && candidates.length > 1) {
      event.preventDefault();
      setCycle({ prefix, index: (index + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (ghost) setDismissed(tagKey(prefix));
      else {
        close();
        toggleRef.current?.focus();
      }
    }
  };

  return (
    <div className={cx('sn-side-search', open && 'is-open', open && view.query && 'has-query')}>
      <IconButton
        ref={toggleRef}
        icon="search"
        label={open ? '收起搜索' : '搜索记录与标签'}
        shortcut={SHORTCUT_KEYS.search}
        className="sn-search-toggle"
        onClick={() => (open ? close() : view.setSearchOpen(true))}
      />
      <div className="sn-side-search-field" inert={!open} aria-hidden={open ? undefined : true}>
        {open && ghost ? (
          <span className="sn-side-search-ghost" aria-hidden="true">
            <span className="sn-side-search-typed">{view.query}</span>
            {ghost}
          </span>
        ) : null}
        <input
          ref={setInput}
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
      {open && ghost ? <Keys combo="Tab" /> : null}
      {open && view.query ? (
        <IconButton
          icon="x"
          label="清空搜索"
          size="sm"
          onClick={() => {
            view.setQuery('');
            view.setTag('');
          }}
        />
      ) : null}
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

/** 标签菜单中最多列出的候选数，与现有应用一致。 */
const MAX_TAG_CANDIDATES = 6;
/** 候选标签的悬停说明：评分权重与现有应用一致。 */
const TAG_SCORE_HINT = '访问频率 40 · 近期访问 30 · 条数 4 · 置顶 3';

export interface ListToplineProps {
  view: SidebarView;
  /** 「管理」：重命名、合并或全局移除这个标签。 */
  onManageTag: (tag: string) => void;
  /** 菜单底部的「搜索」：打开搜索框并预填 #。 */
  onSearchTags: () => void;
}

/** 列表顶栏：条数（筛选标签时带上标签）与标签筛选菜单。 */
export function ListTopline({ view, onManageTag, onSearchTags }: ListToplineProps) {
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="sn-topline">
      <p className="sn-topline-count">
        {view.items.length} 条{view.tag ? ` · #${view.tag}` : ''}
      </p>
      <button
        ref={setButton}
        type="button"
        className={cx('sn-topline-tag', view.tag && 'is-engaged')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="hash" />
        <span>{view.tag ? `#${view.tag}` : '全部标签'}</span>
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <TagMenu
          view={view}
          anchor={button}
          onClose={(restore) => {
            setOpen(false);
            if (restore) button?.focus();
          }}
          onManage={onManageTag}
          onSearch={onSearchTags}
        />
      ) : null}
    </div>
  );
}

/**
 * 标签筛选菜单（沿用现有应用的 TagFilter）：「全部标签」清除筛选；随后是评分最高的六个标签，点击即按该标签筛选；
 * 排在首位且命中搜索或已被选中的标签移到最上方，旁边是「管理」；底部是「搜索标签」，转到 #标签 搜索，右边写剩余的标签数。
 * 键盘按 WAI-ARIA 菜单模式：↑ ↓ 移动，Esc 关闭并回到触发按钮，Tab 关闭。
 */
function TagMenu({
  view,
  anchor,
  onClose,
  onManage,
  onSearch,
}: {
  view: SidebarView;
  anchor: HTMLElement | null;
  onClose: (restore: boolean) => void;
  onManage: (tag: string) => void;
  onSearch: () => void;
}) {
  const data = useNotes();
  const menu = useRef<HTMLDivElement>(null);
  const { style } = useAnchoredPosition(true, anchor, menu, 'bottom-end', 4);
  const candidates = rankTags(data.notes, view.tab, data.tagUsage, view.query, view.tag);
  const shown = candidates.slice(0, MAX_TAG_CANDIDATES);
  const priority = shown.length > 0 && (shown[0].match || shown[0].selected) ? shown[0] : null;
  const others = priority ? shown.slice(1) : shown;

  const itemsIn = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // 打开时聚焦第一项。菜单在第一次定位之前是隐藏的（隐藏的元素不能获得焦点），所以等定位完成再聚焦。
  const positioned = style.visibility !== 'hidden';
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!positioned || focused.current) return;
    focused.current = true;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [positioned]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !anchor?.contains(target)) onClose(false);
    };
    const blur = () => onClose(false);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [anchor, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemsIn();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') focusAt(at + 1);
    else if (event.key === 'ArrowUp') focusAt(at - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(items.length - 1);
    else if (event.key === 'Escape') {
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') onClose(false);
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  };

  const choose = (tag: string) => {
    view.selectTag(tag);
    onClose(true);
  };

  const option = (tag: string, count: number) => (
    <button type="button" role="menuitem" tabIndex={-1} className="sn-menu-item sn-tag-option" title={TAG_SCORE_HINT} onClick={() => choose(tag)}>
      <span className="sn-menu-label">#{tag}</span>
      <span className="sn-tag-count">{count}</span>
    </button>
  );

  return (
    <Layer>
      <div ref={menu} role="menu" aria-label="标签筛选" className="sn-menu sn-tag-menu" style={style} onKeyDown={onKeyDown}>
        {priority ? (
          <div role="none" className="sn-tag-row">
            {option(priority.tag, priority.count)}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="sn-menu-item sn-tag-manage"
              aria-label={`管理 #${priority.tag}`}
              title={`管理 #${priority.tag}`}
              onClick={() => {
                onClose(false);
                onManage(priority.tag);
              }}
            >
              <Icon name="more" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="sn-menu-item sn-tag-option"
          onClick={() => {
            view.setTag('');
            onClose(true);
          }}
        >
          <span className="sn-menu-label">全部标签</span>
          <span className="sn-tag-count">{view.counts[view.tab]}</span>
        </button>
        {others.map((item) => (
          <div key={item.tag} role="none" className="sn-tag-row">
            {option(item.tag, item.count)}
          </div>
        ))}
        {candidates.length === 0 ? <p className="sn-tag-menu-empty">{view.query ? '没有匹配的标签' : '输入 #标签 创建分组'}</p> : null}
        {/* 底部只有「搜索标签」一项（本次提出）：现有应用在按钮旁写一句提示，文字太长，会把菜单撑宽；剩余的个数写在右边，与条数同一列。 */}
        <div role="none" className="sn-tag-menu-foot">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="sn-menu-item sn-tag-menu-search"
            onClick={() => {
              onClose(false);
              onSearch();
            }}
          >
            <Icon name="search" />
            <span className="sn-menu-label">搜索标签</span>
            {candidates.length > MAX_TAG_CANDIDATES ? <span className="sn-tag-count">另有 {candidates.length - MAX_TAG_CANDIDATES} 个</span> : null}
          </button>
        </div>
      </div>
    </Layer>
  );
}

/** 筛选条：搜索或按标签筛选时显示条件、条数与「显示全部」（T67）。 */
export function FilterBanner({ view }: { view: SidebarView }) {
  const query = view.query.trim();
  return (
    <div className="sn-filter-banner" role="status">
      <Icon name="search" />
      <p className="sn-filter-banner-text">
        {query ? `搜索「${query}」` : null}
        {query && view.tag ? '，' : null}
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

export interface FooterProps {
  /** 检查到的新版本号；没有新版本时为 null。 */
  update: string | null;
  /** 点版本号：有新版本时打开「发现新版本」，否则打开当前版本的更新日志。 */
  onVersion: () => void;
  onSettings: () => void;
}

/**
 * 底栏（本次提出）：左下角是缩小的版本号，检查到新版本时右上角带一个更新角标；右边是设置。
 * 现有应用在这里放一个表示本地存储状态的绿色圆点，版本号在标题区；圆点取消，改为更新提示。
 * 存储出错时版本号左边出现警告图标（现有行为保留，Playground 不会出错）。
 */
export function SidebarFooter({ update, onVersion, onSettings }: FooterProps) {
  const label = update ? `发现新版本 ${update}，点击查看更新内容` : `版本 ${__APP_VERSION__} 预览版，点击查看更新日志`;
  return (
    <footer className="sn-side-foot">
      <button type="button" className={cx('sn-side-version', update && 'has-update')} aria-label={label} title={label} onClick={onVersion}>
        v{__APP_VERSION__}
        {update ? (
          <span className="sn-update-badge" aria-hidden="true">
            <Icon name="arrow-up" />
          </span>
        ) : null}
      </button>
      <IconButton icon="settings" label="偏好设置与数据" shortcut={SHORTCUT_KEYS.settings} size="sm" onClick={onSettings} />
    </footer>
  );
}

/**
 * 指针停在宽度手柄上这么久（毫秒）之后才高亮、换成调整宽度的指针（本次提出）：
 * 只是从桌面移进侧栏时划过手柄，不会闪一下强调色（与 Windows 默认的悬停时间相同）。
 */
const RESIZER_HOVER_DELAY = 400;

/**
 * 拖动调整侧栏宽度的手柄，放在侧栏朝向屏幕内侧的一边。
 * 指针停留 400ms 后才高亮并换成左右箭头；按下即可拖动，不必等高亮；键盘聚焦时立即高亮。
 */
export function Resizer({ edge, width, min, max, onChange }: { edge: EdgeSide; width: number; min: number; max: number; onChange: (width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div
      className={cx('sn-resizer', armed && 'is-armed', dragging && 'is-dragging')}
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setArmed(true), RESIZER_HOVER_DELAY);
      }}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setArmed(false);
      }}
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
