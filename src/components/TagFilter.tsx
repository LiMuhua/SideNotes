/**
 * 标签筛选菜单。
 *
 * 结构与行为对应原型 app.js 的 renderTagMenu、rankedTags 与 selectTag：
 * 「全部标签」清除筛选；随后列出评分最高的六个标签，点击即按该标签筛选记录；
 * 排在首位且命中搜索或已被选中的标签移到最上方，并提供「管理」入口；
 * 底部提示剩余标签数量，可转到 #标签 搜索。
 * 展开状态由侧栏统一管理：点击按钮展开，切换页签或按 Esc 时收起。
 * 搜索框输入 # 时不再展开菜单，改为在输入框中以灰字联想标签（见 TagInput）。
 */

import { useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { rankTags } from '../core/notes';
import { belongsTo } from '../core/tabs';
import { useStoreSlice } from '../hooks/useStore';
import type { TabKey } from '../core/types';

/** 菜单中最多展示的候选数，与原型一致。 */
const MAX_CANDIDATES = 6;
/** 候选标签的悬停说明，列出评分权重。 */
const SCORE_HINT = '访问频率 40 · 近期访问 30 · 条数 4 · 置顶 3';

export interface TagFilterProps {
  tab: TabKey;
  query: string;
  selectedTag: string;
  /** 当前页签内的记录总数，显示在「全部标签」一行。 */
  total: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (tag: string) => void;
  onClear: () => void;
  onManage: (tag: string) => void;
  onSearch: () => void;
}

export function TagFilter({
  tab,
  query,
  selectedTag,
  total,
  open,
  onOpenChange,
  onSelect,
  onClear,
  onManage,
  onSearch,
}: TagFilterProps) {
  const notes = useStoreSlice((state) => state.notes);
  const tagUsage = useStoreSlice((state) => state.tagUsage);
  const pinnedTags = useStoreSlice((state) => state.settings.pinnedTags);
  // 候选是当前页签中的标签（与原型 rankedTags 相同）：随记与标签页签按固定的标签划分，rankTags 只区分置顶。
  const candidates = useMemo(
    () => rankTags(notes.filter((note) => belongsTo(note, tab, pinnedTags)), tab, tagUsage, query, selectedTag),
    [notes, tab, pinnedTags, tagUsage, query, selectedTag],
  );
  const shown = candidates.slice(0, MAX_CANDIDATES);
  // 首个候选命中搜索或已被选中时，移到「全部标签」之前并提供管理入口。
  const priority = shown.length > 0 && (shown[0].match || shown[0].selected) ? shown[0] : null;
  const others = priority ? shown.slice(1) : shown;

  // 点击菜单以外的位置收起，与原型的文档级点击处理一致。
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      if (!(event.target as Element | null)?.closest?.('.tag-filter-wrap')) onOpenChange(false);
    };
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [open, onOpenChange]);

  const option = (tag: string, count: number) => (
    <button
      type="button"
      className="tag-option"
      data-action="filter-tag"
      aria-label={`#${tag}`}
      title={SCORE_HINT}
      data-tag={tag}
      role="menuitem"
      onClick={() => onSelect(tag)}
    >
      {`#${tag}`}
      <span className="tag-option-count">{count}</span>
    </button>
  );

  return (
    <div className="tag-filter-wrap">
      <button
        id="tag-filter-button"
        type="button"
        className="tag-filter-button"
        data-action="toggle-tag-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="hash" />
        <span>{selectedTag ? `#${selectedTag}` : '全部标签'}</span>
        <Icon name="chevron-down" />
      </button>
      <div id="tag-dropdown" className="tag-dropdown" role="menu" aria-label="标签筛选" hidden={!open}>
        {priority ? (
          <div className="tag-option-row current-tag-row">
            {option(priority.tag, priority.count)}
            <button
              type="button"
              className="icon-button"
              data-action="manage-tag"
              aria-label={`管理 #${priority.tag}`}
              title={`管理 #${priority.tag}`}
              data-tag={priority.tag}
              onClick={() => onManage(priority.tag)}
            >
              <Icon name="more" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="tag-option"
          data-action="clear-tag"
          aria-label="全部标签"
          title="全部标签"
          onClick={onClear}
        >
          全部标签
          <span className="tag-option-count">{total}</span>
        </button>
        {others.map((item) => (
          <div key={item.tag} className="tag-option-row">
            {option(item.tag, item.count)}
          </div>
        ))}
        {candidates.length === 0 ? (
          <p className="tag-menu-empty">{query ? '没有匹配的标签' : '输入 #标签 创建分组'}</p>
        ) : null}
        <div className="tag-menu-footer">
          <span>
            {candidates.length > MAX_CANDIDATES
              ? `另有 ${candidates.length - MAX_CANDIDATES} 个标签，使用搜索查找`
              : '搜索 #标签 可快速定位'}
          </span>
          <button
            type="button"
            className="tag-search-button"
            data-action="focus-tag-search"
            aria-label="搜索"
            title="搜索"
            onClick={onSearch}
          >
            <Icon name="search" />
            搜索
          </button>
        </div>
      </div>
    </div>
  );
}
