/**
 * 标签筛选下拉菜单。
 *
 * 按评分排序展示当前页签内的标签，输入 `#` 前缀时进入筛选模式；
 * 与原型一致，评分综合访问频率、近期访问、记录条数与置顶情况。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { rankTags } from '../core/notes';
import { tagKey } from '../core/tags';
import { useStoreSlice } from '../hooks/useStore';
import type { TabKey } from '../core/types';

export interface TagFilterProps {
  tab: TabKey;
  selectedTag: string;
  query: string;
  onSelect: (tag: string) => void;
  onClear: () => void;
}

/** 标签筛选按钮与下拉菜单。 */
export function TagFilter({ tab, selectedTag, query, onSelect, onClear }: TagFilterProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const notes = useStoreSlice((state) => state.notes);
  const tagUsage = useStoreSlice((state) => state.tagUsage);

  // 输入 # 前缀时展开菜单并按后续文字过滤。
  const tagQuery = useMemo(() => {
    const match = query.match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u);
    return match ? match[1] : '';
  }, [query]);

  // 进入 # 输入时自动展开：直接在渲染期根据 tagQuery 派生，而非写入 effect。
  const effectiveOpen = open || tagQuery !== '';

  const ranked = useMemo(
    () => rankTags(notes, tab, tagUsage, query, selectedTag),
    [notes, tab, tagUsage, query, selectedTag],
  );

  // 进入 # 输入时自动展开。
  // （effectiveOpen 已在上方由 tagQuery 派生，无需 effect）

  // 点击外部收起。
  useEffect(() => {
    if (!effectiveOpen) return;
    const handle = (event: PointerEvent): void => {
      if (menu.current && !menu.current.contains(event.target as Node) && !button.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handle, true);
    return () => document.removeEventListener('pointerdown', handle, true);
  }, [effectiveOpen]);

  const filtered = tagQuery ? ranked.filter((item) => item.match) : ranked;
  const hasFilter = Boolean(selectedTag);

  return (
    <div className="tag-filter-wrap">
      <button
        ref={button}
        type="button"
        className={`tag-filter-button${effectiveOpen ? ' is-open' : ''}${hasFilter ? ' is-filtered' : ''}`}
        aria-expanded={effectiveOpen}
        aria-haspopup="listbox"
        aria-label="按标签筛选记录"
        title={selectedTag ? `当前筛选：#${selectedTag}` : '按标签筛选'}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="hash" />
        <span>{selectedTag ? `#${selectedTag}` : '标签'}</span>
        <Icon name="chevron-down" />
      </button>
      {effectiveOpen ? (
        <div ref={menu} className="tag-dropdown" role="listbox" aria-label="标签候选">
          <div className="tag-dropdown-heading">
            {tagQuery ? `匹配 #${tagQuery} 的标签` : '按使用频率排序'}
          </div>
          {selectedTag ? (
            <div className="current-tag-row">
              <button
                type="button"
                role="option"
                className="tag-option is-selected"
                aria-selected="true"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                <Icon name="check" />
                <span>#{selectedTag}</span>
                <Icon name="x" />
              </button>
            </div>
          ) : null}
          {filtered.slice(0, 50).map((item) => (
            <button
              key={item.tag}
              type="button"
              role="option"
              className={`tag-option${item.selected ? ' is-selected' : ''}${item.exact ? ' is-exact' : ''}`}
              aria-selected={item.selected}
              title={`共 ${item.count} 条${item.pinned ? ` · ${item.pinned} 条置顶` : ''}`}
              onClick={() => {
                onSelect(tagKey(item.tag) === tagKey(selectedTag) ? '' : item.tag);
                setOpen(false);
              }}
            >
              <Icon name="hash" />
              <span>{`#${item.tag}`}</span>
              <small>{item.count}</small>
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="tag-menu-footer">
              {tagQuery ? `没有匹配 #${tagQuery} 的标签` : '当前页签暂无标签'}
            </div>
          ) : (
            <div className="tag-menu-footer">点击标签筛选，再次点击取消</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
