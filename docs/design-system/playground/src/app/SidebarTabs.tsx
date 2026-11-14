/**
 * 侧栏页签栏（第四次反馈，与交互原型相同）：随记、置顶与用户手动固定的标签，最后一格是菜单。
 *
 * - 随记显示没有任何已固定标签的记录（原来的「工作区」改名，去掉了「归档」）；置顶与原来相同；
 *   标签页签显示带这个标签的记录，名称不写 #，超过 4 个字截断。条数只写在随记与当前页签上。
 * - 固定：按标签筛选时筛选条上的「固定为页签」，或最后一格菜单中的「新建页签」；不会自动出现页签。
 * - 双击标签页签原地改名（所有记录上的这个标签一起改）；右键「改名」「移出页签栏」，移出只是不再固定，可以撤销。
 * - 放不下时，多出来的页签从右往左收进最后一格「N ▾」。选中收起的页签时前面的页签不动，最后一格显示它的名称并带当前样式
 *   （最后一格按 4 个字的宽度预留，显示哪个名称都不会挤动前面的页签）。单击最后一格打开菜单：收起的页签与「新建页签」。
 *
 * Playground 没有模拟拖动（按住页签排序、把卡片拖到页签或最后一格）与菜单中收起页签的右键菜单，规则见 interactions.md 第十二节。
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isValidTag, tagKey } from '@/core/tags';
import type { Note } from '@/core/types';
import { allTags, findPinned, pinnedTagOf, tabLabel, tabOfTag, tabPatch, tagOfTab, TAB_LABELS, useNotes, type SidebarTab, type SidebarView } from '../model/notes';
import { cx, useSurface } from '../ui/context';
import { Icon, type IconName } from '../ui/Icon';
import { Layer, useAnchoredPosition } from '../ui/layer';
import { ContextMenu, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/Tabs';

const FIXED_TABS: ReadonlyArray<{ tab: 'workspace' | 'pinned'; icon: IconName | null }> = [
  { tab: 'workspace', icon: null },
  { tab: 'pinned', icon: 'pin' },
];

/** 最后一格按 4 个字预留宽度时用的占位文字（看不见）。 */
const NAME_RESERVE = '页签名称';
/** 新建页签时最多列出的已有标签。 */
const MAX_CANDIDATES = 6;
const INVALID_TAG = '标签最多 40 字；使用文字、数字、下划线或短横线';

type Point = { x: number; y: number };

/** 页签的操作：固定、移出、改名与把卡片移到页签。都有提示条，固定、移出与移动可以撤销。 */
export function useTabActions(view: SidebarView) {
  const data = useNotes();
  const toast = useToast();

  /** 把标签固定成页签并切换过去；已经固定的直接切换。与已有标签只差大小写时用已有的写法。 */
  const pin = (name: string): boolean => {
    const raw = name.trim().replace(/^#/, '');
    if (!isValidTag(raw)) {
      toast({ message: INVALID_TAG, tone: 'danger' });
      return false;
    }
    const pinned = findPinned(data.pinnedTags, raw);
    const tag = pinned || allTags(data.notes).find((item) => tagKey(item.tag) === tagKey(raw))?.tag || raw;
    if (!pinned) {
      const previous = data.pinnedTags;
      data.setPinnedTags([...previous, tag]);
      toast({ message: `已固定为页签「${tag}」`, action: { label: '撤销', run: () => data.setPinnedTags(previous) } });
    }
    view.setTab(tabOfTag(tag));
    view.clearFilters();
    return true;
  };

  /** 移出页签栏：只是不再固定，记录与标签都不变；当前在这个页签时回到随记。 */
  const unpin = (tag: string) => {
    const previous = data.pinnedTags;
    const name = findPinned(previous, tag);
    if (!name) return;
    data.setPinnedTags(previous.filter((item) => item !== name));
    if (tagKey(tagOfTab(view.tab)) === tagKey(name)) view.setTab('workspace');
    toast({ message: `已把「${name}」移出页签栏`, action: { label: '撤销', run: () => data.setPinnedTags(previous) } });
  };

  /** 改名：所有记录上的这个标签一起改，与已有标签同名时合并；固定的页签跟着改。 */
  const rename = (tag: string, value: string) => {
    const next = value.trim().replace(/^#/, '');
    if (!next || next === tag) return;
    if (!isValidTag(next)) {
      toast({ message: INVALID_TAG, tone: 'danger' });
      return;
    }
    const current = tagKey(tagOfTab(view.tab)) === tagKey(tag);
    data.renameTag(tag, next);
    if (view.tag && tagKey(view.tag) === tagKey(tag)) view.setTag(next);
    if (current) view.setTab(tabOfTag(next));
    toast({ message: `已改名为「${next}」`, tone: 'success' });
  };

  /**
   * 把卡片移到另一个页签（卡片菜单「移到…」，与拖到页签上相同）：标签页签按标签加减，到置顶只置顶。
   * 移到随记后还在别的固定标签里的，提示写明在哪里。
   */
  const moveTo = (ids: readonly string[], destination: SidebarTab) => {
    const from = view.tab;
    if (destination === from) return;
    const now = Date.now();
    const previous: Array<readonly [string, Partial<Note>]> = [];
    const changes: Array<readonly [string, Partial<Note>]> = [];
    const moved: Note[] = [];
    ids.forEach((id) => {
      const note = data.byId.get(id);
      if (!note || note.status !== 'active') return;
      const patch: Partial<Note> = { ...tabPatch(note, from, destination), order: null, updatedAt: now };
      previous.push([id, { text: note.text, pinned: note.pinned, order: note.order, updatedAt: note.updatedAt }]);
      changes.push([id, patch]);
      moved.push({ ...note, ...patch });
    });
    if (!changes.length) return;
    data.patchNotes(changes);
    view.setChecked(new Set());
    let message = `已移到${tabLabel(destination)} ${changes.length} 条记录`;
    if (destination === 'workspace') {
      const still = moved.map((note) => pinnedTagOf(note, data.pinnedTags)).filter(Boolean);
      if (still.length) {
        const some = still.length < moved.length ? `${still.length} 条` : '';
        const more = new Set(still.map(tagKey)).size > 1 ? '等页签' : '';
        message = `已移出${tabLabel(from)}，${some}仍在「${still[0]}」${more}`;
      }
    }
    toast({ message, action: { label: '撤销', run: () => data.patchNotes(previous) } });
  };

  return { pin, unpin, rename, moveTo };
}

/** 页签里的内容：分区色圆点（磨砂玻璃）、图标、名称与条数。 */
function TabContent({ label, icon, count }: { label: string; icon?: IconName | null; count?: number | null }) {
  return (
    <>
      <span className="sn-side-tab-mark" aria-hidden="true" />
      {icon ? <Icon name={icon} /> : null}
      <span className="sn-side-tab-label">{label}</span>
      {count === null || count === undefined ? null : <span className="sn-side-tab-count">{count}</span>}
    </>
  );
}

/** 页签栏：随记、置顶、固定的标签与最后一格。 */
export function TabsRow({ view }: { view: SidebarView }) {
  const surface = useSurface();
  const actions = useTabActions(view);
  const measure = useRef<HTMLDivElement>(null);
  // 放得下的标签页签个数；第一次测量之前全部显示（测量在绘制之前完成）。
  const [visible, setVisible] = useState(Number.POSITIVE_INFINITY);
  const [renaming, setRenaming] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tag: string; point: Point } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{ anchor: HTMLElement; point: Point } | null>(null);
  const [creating, setCreating] = useState<HTMLElement | null>(null);

  const tags = view.pinnedTags;
  const current = tagOfTab(view.tab);
  const hidden = tags.slice(visible);
  const activeHidden = Boolean(current) && hidden.some((tag) => tagKey(tag) === tagKey(current));
  const mode: 'plain' | 'count' | 'active' = activeHidden ? 'active' : hidden.length ? 'count' : 'plain';
  const countOf = (tab: SidebarTab) => (tab === 'workspace' ? view.countOf('workspace') : tab === view.tab ? view.total : null);

  /**
   * 量出放得下几个标签页签：先按最后一格只有 ▾ 来排；放不下时按它写 4 个字的宽度预留，从右往左收起，
   * 这样选中收起的页签、最后一格换成它的名称时，前面的页签不会被挤动。宽度取自看不见的测量行（与页签栏同样的页签）。
   */
  const layout = useCallback(() => {
    const box = measure.current;
    const nav = box?.parentElement;
    if (!box || !nav) return;
    // 窗口可能按字号缩放：getBoundingClientRect 是缩放后的尺寸，换算回 CSS 像素再与 clientWidth 比较。
    const scale = nav.offsetWidth ? nav.getBoundingClientRect().width / nav.offsetWidth : 1;
    const width = (node: Element | null) => (node ? node.getBoundingClientRect().width / scale : 0);
    const navStyle = getComputedStyle(nav);
    const available = nav.clientWidth - parseFloat(navStyle.paddingLeft) - parseFloat(navStyle.paddingRight);
    const rowStyle = getComputedStyle(box);
    const gap = parseFloat(rowStyle.columnGap) || 0;
    const edges = parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.paddingRight);
    const fixed = Array.from(box.querySelectorAll('[data-measure="fixed"]')).reduce((sum, node) => sum + width(node), 0);
    const widths = Array.from(box.querySelectorAll('[data-measure="tag"]'), width);
    const need = (count: number, slot: number) => edges + fixed + widths.slice(0, count).reduce((sum, value) => sum + value, 0) + slot + gap * (FIXED_TABS.length + count);
    let count = widths.length;
    if (need(count, width(box.querySelector('[data-measure="plain"]'))) > available + 1) {
      const reserve = width(box.querySelector('[data-measure="reserve"]'));
      while (count > 0 && need(count, reserve) > available + 1) count -= 1;
    }
    setVisible(count);
  }, []);

  // 每次渲染后复核（条数、当前页签、字号与主题都会改变页签的宽度）；个数不变时不会再渲染。
  useLayoutEffect(() => {
    // 测量必须在绘制前完成，这是 useLayoutEffect 的典型用途。
    layout();
  });
  // 侧栏宽度变化、字体加载完成时重新测量。
  useEffect(() => {
    const box = measure.current;
    const nav = box?.parentElement;
    if (!box || !nav) return;
    const observer = new ResizeObserver(() => layout());
    observer.observe(nav);
    observer.observe(box);
    return () => observer.disconnect();
  }, [layout]);

  const openSlotMenu = (anchor: HTMLElement) => {
    const box = anchor.getBoundingClientRect();
    setSlotMenu({ anchor, point: { x: box.left, y: box.bottom + 4 } });
  };

  const slotItems: MenuItem[] = [
    ...hidden.map<MenuItem>((tag) => ({
      id: `tab:${tag}`,
      label: tag,
      icon: 'hash',
      checked: Boolean(current) && tagKey(tag) === tagKey(current),
      onSelect: () => view.setTab(tabOfTag(tag)),
    })),
    { id: 'create', label: '新建页签', icon: 'plus', separatorBefore: hidden.length > 0, onSelect: () => setCreating(slotMenu?.anchor ?? null) },
  ];

  const rowClass = cx('sn-tabs-row', `is-${surface.tabs}`, surface.tabMarks && 'has-marks');
  const fixedTab = (tab: 'workspace' | 'pinned', icon: IconName | null, measured = false): ReactNode =>
    measured ? (
      <span key={tab} className="sn-side-tab" data-measure="fixed" aria-selected={view.tab === tab}>
        <TabContent label={TAB_LABELS[tab]} icon={icon} count={countOf(tab)} />
      </span>
    ) : (
      <button key={tab} type="button" role="tab" aria-selected={view.tab === tab} className="sn-side-tab" data-tab={tab} onClick={() => view.setTab(tab)}>
        <TabContent label={TAB_LABELS[tab]} icon={icon} count={countOf(tab)} />
      </button>
    );

  return (
    <>
      <div className={rowClass} role="tablist" aria-label="记录列表" inert={view.searchOpen}>
        {FIXED_TABS.map(({ tab, icon }) => fixedTab(tab, icon))}
        {tags.slice(0, visible).map((tag) => {
          const tab = tabOfTag(tag);
          if (renaming && tagKey(renaming) === tagKey(tag)) {
            return (
              <RenameInput
                key={tab}
                tag={tag}
                onDone={(value) => {
                  setRenaming('');
                  if (value !== null) actions.rename(tag, value);
                }}
              />
            );
          }
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view.tab === tab}
              className="sn-side-tab"
              data-tab={tab}
              onClick={() => view.setTab(tab)}
              onDoubleClick={() => setRenaming(tag)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTabMenu({ tag, point: { x: event.clientX, y: event.clientY } });
              }}
            >
              <TabContent label={tag} count={countOf(tab)} />
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'active'}
          aria-haspopup="menu"
          aria-expanded={Boolean(slotMenu)}
          aria-label={mode === 'active' ? `${current}，另有 ${hidden.length - 1} 个收起的页签` : hidden.length ? `另有 ${hidden.length} 个页签，新建页签` : '新建页签'}
          className="sn-side-tab sn-tab-more"
          data-tab={mode === 'active' ? view.tab : undefined}
          onClick={(event) => openSlotMenu(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            openSlotMenu(event.currentTarget);
          }}
        >
          {mode === 'active' ? (
            <>
              <span className="sn-side-tab-mark" aria-hidden="true" />
              <span className="sn-side-tab-label">{current}</span>
            </>
          ) : null}
          {mode === 'count' ? <span className="sn-tab-more-count">{hidden.length}</span> : null}
          <Icon name="chevron-down" />
        </button>
      </div>

      {/* 测量行：与页签栏同样的页签，看不见，只用来量宽度（包括收起的页签与最后一格的两种宽度）。 */}
      <div ref={measure} className={cx(rowClass, 'sn-tabs-measure')} aria-hidden="true" inert>
        {FIXED_TABS.map(({ tab, icon }) => fixedTab(tab, icon, true))}
        {tags.map((tag) => (
          <span key={tag} className="sn-side-tab" data-measure="tag" aria-selected={view.tab === tabOfTag(tag)}>
            <TabContent label={tag} count={countOf(tabOfTag(tag))} />
          </span>
        ))}
        <span className="sn-side-tab sn-tab-more" data-measure="plain">
          <Icon name="chevron-down" />
        </span>
        <span className="sn-side-tab sn-tab-more" data-measure="reserve" aria-selected="true">
          <span className="sn-side-tab-mark" />
          <span className="sn-side-tab-label">{NAME_RESERVE}</span>
          <Icon name="chevron-down" />
        </span>
      </div>

      {slotMenu ? <ContextMenu label="页签" items={slotItems} point={slotMenu.point} onClose={() => setSlotMenu(null)} /> : null}
      {tabMenu ? (
        <ContextMenu
          label={`页签「${tabMenu.tag}」`}
          items={[
            { id: 'rename', label: '改名', icon: 'edit', shortcut: '双击', onSelect: () => setRenaming(tabMenu.tag) },
            { id: 'unpin', label: '移出页签栏', icon: 'x', separatorBefore: true, onSelect: () => actions.unpin(tabMenu.tag) },
          ]}
          point={tabMenu.point}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
      {creating ? <TabCreatePanel anchor={creating} onPin={actions.pin} onClose={() => setCreating(null)} /> : null}
    </>
  );
}

/** 双击页签原地改名：Enter 或点到别处确认，Esc 取消。 */
function RenameInput({ tag, onDone }: { tag: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(tag);
  const finished = useRef(false);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <input
      className="sn-tab-rename"
      value={value}
      aria-label={`页签「${tag}」的新名称`}
      spellCheck={false}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}

/**
 * 新建页签：最后一格下方的小浮层，一个输入框与还没固定的已有标签（条数多的在前，最多 6 个）。
 * 输入时按名称筛选，↑ ↓ 选择，Enter 固定；输入的名称不是已有标签时得到一个空页签。Esc 或点到外面取消。
 */
function TabCreatePanel({ anchor, onPin, onClose }: { anchor: HTMLElement; onPin: (tag: string) => boolean; onClose: () => void }) {
  const data = useNotes();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { style } = useAnchoredPosition(true, anchor, panel, 'bottom-end', 4);
  const [value, setValue] = useState('');
  const [active, setActive] = useState(-1);
  const query = tagKey(value.trim().replace(/^#/, ''));
  const candidates = allTags(data.notes)
    .filter((item) => !findPinned(data.pinnedTags, item.tag) && (!query || tagKey(item.tag).includes(query)))
    .slice(0, MAX_CANDIDATES);
  const index = candidates.length ? Math.min(active, candidates.length - 1) : -1;

  // 定位完成后再聚焦（隐藏的元素不能获得焦点）。
  const positioned = style.visibility !== 'hidden';
  useEffect(() => {
    if (positioned) input.current?.focus({ preventScroll: true });
  }, [positioned]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [onClose]);

  const choose = (tag: string) => {
    if (tag && onPin(tag)) onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && candidates.length) {
      event.preventDefault();
      setActive((index + (event.key === 'ArrowDown' ? 1 : candidates.length - 1) + candidates.length) % candidates.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(index >= 0 ? candidates[index].tag : value.trim());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.focus();
    }
  };

  return (
    <Layer>
      <div ref={panel} className="sn-tab-create" role="dialog" aria-label="新建页签" style={style}>
        <input
          ref={input}
          className="sn-input is-md"
          value={value}
          placeholder="标签名称"
          aria-label="标签名称"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={candidates.length > 0}
          aria-controls={listId}
          aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setActive(event.target.value.trim() ? 0 : -1);
          }}
          onKeyDown={onKeyDown}
        />
        {candidates.length ? (
          <div id={listId} className="sn-tab-create-list" role="listbox" aria-label="已有标签">
            {candidates.map((item, position) => (
              <button
                key={item.tag}
                id={`${listId}-${position}`}
                type="button"
                role="option"
                aria-selected={position === index}
                tabIndex={-1}
                className={cx('sn-tab-create-option', position === index && 'is-active')}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(item.tag)}
              >
                <Icon name="hash" />
                <span className="sn-tab-create-name">{item.tag}</span>
                <span className="sn-tab-create-count">{item.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Layer>
  );
}
