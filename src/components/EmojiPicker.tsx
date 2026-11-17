/**
 * Emoji 选择器。
 *
 * 与原型一致：分类切换、关键词搜索、已被其他记录占用的 Emoji 禁用，
 * 提供「随机分配」入口；保留当前 Emoji 高亮，便于撤销。
 */

import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { EMOJI_GROUPS, searchEmoji, pickEmoji } from '../core/emoji';
import type { Note } from '../core/types';

export interface EmojiPickerProps {
  note: Note;
  notes: Note[];
  onClose: () => void;
  onChoose: (emoji: string) => void;
}

/** 分类选择器。 */
function CategoryTabs({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (category: string) => void;
}) {
  const tabs = [{ id: 'all', label: '全部' }, ...EMOJI_GROUPS];
  return (
    <div className="emoji-categories" role="tablist" aria-label="Emoji 分类">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className={`emoji-category${selected === tab.id ? ' active' : ''}`}
          aria-pressed={selected === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Emoji 选择对话框。 */
export function EmojiPicker({ note, notes, onClose, onChoose }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  // 已被其他记录占用的 Emoji 不允许重复。
  const used = useMemo(
    () => new Set(notes.filter((item) => item.id !== note.id).map((item) => item.emoji)),
    [notes, note.id],
  );

  const matches = useMemo(() => searchEmoji(query, category), [query, category]);

  return (
    <Modal title="选择 Emoji" className="emoji-modal" onClose={onClose} footer={null}>
      <input
        type="search"
        className="emoji-search form-control"
        placeholder="搜索表情、物品或英文关键词"
        aria-label="搜索 Emoji"
        value={query}
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          // 输入关键词时自动回到「全部」分类，避免空结果。
          if (event.target.value.trim()) setCategory('all');
        }}
      />
      <CategoryTabs
        selected={category}
        onSelect={setCategory}
      />
      <div className="emoji-grid" aria-label="Emoji 候选">
        {matches.map((item) => {
          const occupied = used.has(item.emoji);
          return (
            <button
              key={`${item.emoji}-${item.category}`}
              type="button"
              className={`emoji-choice${item.emoji === note.emoji ? ' is-current' : ''}`}
              aria-label={item.label}
              disabled={occupied}
              onClick={() => onChoose(item.emoji)}
            >
              {item.emoji}
            </button>
          );
        })}
        {matches.length === 0 ? <p className="emoji-empty">没有匹配的 Emoji</p> : null}
      </div>
      <div className="emoji-actions">
        <button
          type="button"
          className="button secondary emoji-random"
          onClick={() => {
            const emoji = pickEmoji(notes.map((item) => item.emoji));
            onChoose(emoji);
          }}
        >
          随机分配
        </button>
      </div>
    </Modal>
  );
}
