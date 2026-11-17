/**
 * 筛选行左边的标签下拉（原型第二版，与交互原型 app.js 的 renderFilterRow、renderTagMenu、rankedTags 与 selectTag 相同）。
 *
 * - 按钮平时写「# 全部标签」；按标签筛选时写「# 产品 · 2 条」，后面的 × 清除筛选（条数已经写在当前页签上，平时不再写）。
 * - 菜单：「全部标签」清除筛选，随后是当前页签中评分最高的六个标签，点击即按这个标签筛选；选中的标签移到最上面，
 *   带「管理」入口。底部只有「搜索标签」（在全部记录中搜），候选之外还有标签时写「另有 N 个」。
 * - 搜索时筛选行左边换成结果条数，这里不显示（见侧栏）。按钮与选项不加悬停提示，名称只写在 aria-label 中。
 * 展开状态由侧栏统一管理：点击按钮展开，切换页签或按 Esc 时收起。
 */

import { useEffect, useMemo, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { rankTags } from '../core/notes';
import { belongsTo } from '../core/tabs';
import { useStoreSlice } from '../hooks/useStore';
import type { TabKey } from '../core/types';

/** 菜单中最多展示的候选数，与原型一致。 */
const MAX_CANDIDATES = 6;

export interface TagFilterProps {
  tab: TabKey;
  selectedTag: string;
  /** 当前页签内的记录总数，显示在「全部标签」一行。 */
  total: number;
  /** 按标签筛出的条数，写在按钮上。 */
  filteredCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (tag: string) => void;
  onClear: () => void;
  onManage: (tag: string) => void;
  onSearch: () => void;
  /** 菜单挂在筛选行（.list-topline）下，与原型的 #tag-dropdown 位置相同；为空时挂在按钮旁边。 */
  menuHost?: HTMLElement | null;
}

export function TagFilter({
  tab,
  selectedTag,
  total,
  filteredCount,
  open,
  onOpenChange,
  onSelect,
  onClear,
  onManage,
  onSearch,
  menuHost,
}: TagFilterProps) {
  const notes = useStoreSlice((state) => state.notes);
  const tagUsage = useStoreSlice((state) => state.tagUsage);
  const pinnedTags = useStoreSlice((state) => state.settings.pinnedTags);
  // 候选是当前页签中的标签（与原型 rankedTags 相同）：随记与标签页签按固定的标签划分，rankTags 只区分置顶。
  const candidates = useMemo(
    () => rankTags(notes.filter((note) => belongsTo(note, tab, pinnedTags)), tab, tagUsage, '', selectedTag),
    [notes, tab, pinnedTags, tagUsage, selectedTag],
  );
  const shown = candidates.slice(0, MAX_CANDIDATES);
  // 选中的标签排在首位时移到「全部标签」之前，并提供管理入口。
  const priority = shown.length > 0 && shown[0].selected ? shown[0] : null;
  const others = priority ? shown.slice(1) : shown;
  const filtered = Boolean(selectedTag);

  // 点击菜单以外的位置收起，与原型的文档级点击处理一致。
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      if (!(event.target as Element | null)?.closest?.('.tag-filter-wrap, #tag-dropdown')) onOpenChange(false);
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [open, onOpenChange]);

  /** 菜单里 ↑ ↓ 在选项之间移动焦点（原型 moveInMenu）。 */
  const moveInMenu = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.tag-option'));
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  };

  const renderMenu = (menu: React.ReactElement) => (menuHost ? createPortal(menu, menuHost) : menu);

  const option = (tag: string, count: number) => (
    <button
      type="button"
      className="tag-option"
      data-action="filter-tag"
      aria-label={`#${tag}`}
      data-tag={tag}
      role="menuitem"
      onClick={() => onSelect(tag)}
    >
      {`#${tag}`}
      <span className="tag-option-count">{count}</span>
    </button>
  );

  return (
    <div className={filtered ? 'tag-filter-wrap is-filtered' : 'tag-filter-wrap'}>
      <button
        id="tag-filter-button"
        type="button"
        className={filtered ? 'tag-filter-button is-filtered' : 'tag-filter-button'}
        data-action="toggle-tag-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="tag-dropdown"
        aria-label={filtered ? `标签 #${selectedTag}，${filteredCount} 条，更换标签` : '按标签筛选'}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="hash" />
        <span className="tag-filter-label">{filtered ? selectedTag : '全部标签'}</span>
        <span className="tag-filter-count" hidden={!filtered}>
          {filtered ? `· ${filteredCount} 条` : ''}
        </span>
        <Icon name="chevron-down" />
      </button>
      <button
        id="tag-filter-clear"
        type="button"
        className="icon-button tag-filter-clear"
        data-action="clear-tag"
        aria-label="清除标签筛选"
        hidden={!filtered}
        onClick={onClear}
      >
        <Icon name="x" />
      </button>
      {renderMenu(
      <div id="tag-dropdown" className="tag-dropdown" role="menu" aria-label="标签筛选" hidden={!open} onKeyDown={moveInMenu}>
        {priority ? (
          <div className="tag-option-row current-tag-row">
            {option(priority.tag, priority.count)}
            <button
              type="button"
              className="icon-button"
              data-action="manage-tag"
              aria-label={`管理 #${priority.tag}`}
              data-tag={priority.tag}
              onClick={() => onManage(priority.tag)}
            >
              <Icon name="more" />
            </button>
          </div>
        ) : null}
        <button type="button" className="tag-option" data-action="clear-tag" aria-label="全部标签" role="menuitem" onClick={onClear}>
          全部标签
          <span className="tag-option-count">{total}</span>
        </button>
        {others.map((item) => (
          <div key={item.tag} className="tag-option-row">
            {option(item.tag, item.count)}
          </div>
        ))}
        {candidates.length === 0 ? <p className="tag-menu-empty">输入 #标签 创建分组</p> : null}
        <div className="tag-menu-footer">
          <button
            type="button"
            className="tag-option tag-search-button"
            data-action="focus-tag-search"
            aria-label="搜索标签"
            role="menuitem"
            onClick={onSearch}
          >
            <Icon name="search" />
            搜索标签
            {candidates.length > MAX_CANDIDATES ? (
              <span className="tag-option-count">{`另有 ${candidates.length - MAX_CANDIDATES} 个`}</span>
            ) : null}
          </button>
        </div>
      </div>,
      )}
    </div>
  );
}
