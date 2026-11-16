/**
 * 侧栏页签栏（第四次反馈，与交互原型相同）：随记、置顶与用户手动固定的标签，最后一格是菜单。
 *
 * - 随记显示没有任何已固定标签的记录（原来的「工作区」改名，去掉了「归档」）；置顶与原来相同；
 *   标签页签显示带这个标签的记录，名称不写 #，超过 4 个字截断。条数只写在随记与当前页签上。
 * - 固定：按标签筛选时筛选行上的「固定为页签」，或最后一格的「新建页签」；不会自动出现页签。
 * - 双击标签页签原地改名（所有记录上的这个标签一起改）；右键「改名」「移出页签栏」，移出只是不再固定，可以撤销。
 * - 最后一格只占一个位置，样子固定（第六次反馈）：页签都放得下、后面还有位置时是「+」，单击新建页签；真放不下时多出来的
 *   页签从右往左收进去，这一格写「N ▾」，单击打开菜单：收起的页签与「新建页签」。页签都放得下、只差「+」时不显示「+」，
 *   不为它收起页签（第七次反馈）。
 * - 末格（第八次反馈）：放不下时，最后一个显示的页签与「N ▾」合成一格。从菜单选页签只换末格里的页签，前面的页签不动；
 *   当前页签本该收起时也换进末格，始终显示名字（第七次反馈）。排法见 src/core/tabLayout.ts。
 *
 * Playground 没有模拟拖动（按住页签排序、把卡片拖到页签或最后一格）与菜单中收起页签的右键菜单，规则见 interactions.md 第十二节。
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isValidTag, tagKey } from '@/core/tags';
import type { Note } from '@/core/types';
import { allTags, findPinned, homeTab, pinnedTagOf, tabLabel, tabOfTag, tabPatch, tagOfTab, TAB_LABELS, useNotes, type SidebarTab, type SidebarView } from '../model/notes';
import { fitTabs, type TabFit } from '@/core/tabLayout';
import { cx, useSurface } from '../ui/context';
import { Icon, type IconName } from '../ui/Icon';
import { Layer, useAnchoredPosition } from '../ui/layer';
import { ContextMenu, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/Tabs';

const FIXED_TABS: ReadonlyArray<{ tab: 'workspace' | 'pinned'; icon: IconName | null }> = [
  { tab: 'workspace', icon: null },
  { tab: 'pinned', icon: 'pin' },
];

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
    view.goToTab(tabOfTag(tag));
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
    // 全局搜索的结果来自各个页签（第五次反馈）：按每条记录自己所在的页签算，已经在目的地的不动。
    const fromOf = (note: Note): SidebarTab => (view.searching ? homeTab(note, data.pinnedTags) : view.tab);
    const from = view.tab;
    if (!view.searching && destination === from) return;
    const now = Date.now();
    const previous: Array<readonly [string, Partial<Note>]> = [];
    const changes: Array<readonly [string, Partial<Note>]> = [];
    const moved: Note[] = [];
    ids.forEach((id) => {
      const note = data.byId.get(id);
      if (!note || note.status !== 'active' || fromOf(note) === destination) return;
      const patch: Partial<Note> = { ...tabPatch(note, fromOf(note), destination), order: null, updatedAt: now };
      previous.push([id, { text: note.text, pinned: note.pinned, order: note.order, updatedAt: note.updatedAt }]);
      changes.push([id, patch]);
      moved.push({ ...note, ...patch });
    });
    if (!changes.length) return;
    data.patchNotes(changes);
    view.clearSelection();
    let message = `已移到${tabLabel(destination)} ${changes.length} 条记录`;
    if (destination === 'workspace') {
      const still = moved.map((note) => pinnedTagOf(note, data.pinnedTags)).filter(Boolean);
      if (still.length) {
        const some = still.length < moved.length ? `${still.length} 条` : '';
        const more = new Set(still.map(tagKey)).size > 1 ? '等页签' : '';
        const origins = new Set(moved.map((note) => fromOf(data.byId.get(note.id) ?? note)));
        const origin = view.searching ? (origins.size === 1 ? tabLabel([...origins][0]) : '原来的页签') : tabLabel(from);
        message = `已移出${origin}，${some}仍在「${still[0]}」${more}`;
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
  // 显示哪些标签页签、最后一格写什么；第一次测量之前全部显示（测量在绘制之前完成）。
  const [fit, setFit] = useState<TabFit | null>(null);
  // 上一次换进末格的页签（第八次反馈）：切到前面的页签后末格仍是它。
  const [swapped, setSwapped] = useState('');
  const [renaming, setRenaming] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tag: string; point: Point } | null>(null);
  const [slotMenu, setSlotMenu] = useState<{ anchor: HTMLElement; point: Point } | null>(null);
  const [creating, setCreating] = useState<HTMLElement | null>(null);

  const tags = view.pinnedTags;
  // 搜索时搜索框盖住页签栏（第六次反馈），页签不标出当前页签；排法仍按当前页签算，结束搜索时页签栏不变。
  const selectedTab = view.searching ? null : view.tab;
  const current = tagOfTab(view.tab);
  const currentIndex = current ? tags.findIndex((tag) => tagKey(tag) === tagKey(current)) : -1;
  const swappedIndex = swapped ? tags.findIndex((tag) => tagKey(tag) === tagKey(swapped)) : -1;
  // 显示的页签按 fit 的顺序：末格的页签在最后（它可能是换进来的，不在本来的位置）。
  const shown = fit ? fit.visible : tags.map((_, index) => index);
  const hidden = tags.filter((_, index) => !shown.includes(index));
  const slot = fit ? fit.slot : 'add';
  const last = fit ? fit.last : -1;
  const countOf = (tab: SidebarTab) => (tab === 'workspace' ? view.countOf('workspace') : tab === view.tab ? view.total : null);
  // 页签栏上的条数：当前页签放不下条数时不写（第八次反馈）；测量行照常写，用来量宽度。
  const shownCount = (tab: SidebarTab) => (tab !== 'workspace' && fit && !fit.counted ? null : countOf(tab));

  /**
   * 量出显示哪些标签页签（规则见 src/core/tabLayout.ts）：都放得下时全部显示，后面还有位置时最后一格是「+」；放不下时按顺序能放几个
   * 放几个，最后一个与「N ▾」合成末格，当前页签或上一次换进来的页签换进末格。宽度取自看不见的测量行（与页签栏同样的页签、
   * 最后一格的「+」与一位、两位数的「N ▾」，以及写着两个字的 probe：末格的页签名字最短留这么宽）。
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
    const fixed = Array.from(box.querySelectorAll('[data-measure="fixed"]')).reduce((sum, node) => sum + width(node) + gap, edges);
    const one = width(box.querySelector('[data-measure="count"]'));
    const two = width(box.querySelector('[data-measure="count-2"]'));
    const probe = width(box.querySelector('[data-measure="probe"]'));
    const measured = Array.from(box.querySelectorAll<HTMLElement>('[data-measure="tag"]'));
    const widths = measured.map(width);
    const labels = measured.map((node) => width(node.querySelector('.sn-side-tab-label')));
    const current = Number(box.dataset.current ?? -1);
    // 当前页签的条数占的宽度（随记的条数一直显示，不算）：显示哪些页签不按它定，切换页签时前面的页签不变。
    const selected = box.querySelector<HTMLElement>('[data-measure="fixed"][aria-selected="true"], [data-measure="tag"][aria-selected="true"]');
    const counter = selected && selected.dataset.tab !== 'workspace' ? selected.querySelector('.sn-side-tab-count') : null;
    const extra = counter ? width(counter) + (parseFloat(getComputedStyle(selected as Element).columnGap) || 0) : 0;
    const next = fitTabs({
      available,
      fixed,
      tags: widths,
      gap,
      add: width(box.querySelector('[data-measure="add"]')),
      count: (hiddenCount) => (hiddenCount >= 10 ? two : one),
      // 末格的页签与「N ▾」紧挨着：「N ▾」的负外边距抵消了页签间距。
      joint: 0,
      current,
      extra,
      swapped: Number(box.dataset.swapped ?? -1),
      // 名字最短留两个字；本来就不到两个字的不再缩。
      shrink: (index) => Math.max(0, labels[index] - probe),
    });
    // 结果不变时保留原来的对象，不再触发渲染。
    setFit((previous) =>
      previous &&
      previous.slot === next.slot &&
      previous.last === next.last &&
      previous.squeezed === next.squeezed &&
      previous.counted === next.counted &&
      previous.visible.join() === next.visible.join()
        ? previous
        : next,
    );
    // 当前页签在末格时记下它：切到前面的页签后末格仍是它。
    const name = current >= 0 && next.last === current ? (measured[current]?.dataset.tag ?? '') : '';
    if (name) setSwapped((previous) => (tagKey(previous) === tagKey(name) ? previous : name));
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
      onSelect: () => view.goToTab(tabOfTag(tag)),
    })),
    { id: 'create', label: '新建页签', icon: 'plus', separatorBefore: hidden.length > 0, onSelect: () => setCreating(slotMenu?.anchor ?? null) },
  ];

  const rowClass = cx('sn-tabs-row', `is-${surface.tabs}`, surface.tabMarks && 'has-marks');
  const fixedTab = (tab: 'workspace' | 'pinned', icon: IconName | null, measured = false): ReactNode =>
    measured ? (
      <span key={tab} className="sn-side-tab" data-measure="fixed" data-tab={tab} aria-selected={view.tab === tab}>
        <TabContent label={TAB_LABELS[tab]} icon={icon} count={countOf(tab)} />
      </span>
    ) : (
      <button key={tab} type="button" role="tab" aria-selected={selectedTab === tab} className="sn-side-tab" data-tab={tab} onClick={() => view.goToTab(tab)}>
        <TabContent label={TAB_LABELS[tab]} icon={icon} count={shownCount(tab)} />
      </button>
    );

  return (
    <>
      <div className={rowClass} role="tablist" aria-label="记录列表">
        {FIXED_TABS.map(({ tab, icon }) => fixedTab(tab, icon))}
        {shown.map((index) => {
          const tag = tags[index];
          if (tag === undefined) return null;
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
              aria-selected={selectedTab === tab}
              className={cx('sn-side-tab', index === last && 'is-slot', index === fit?.squeezed && 'is-squeezed')}
              data-tab={tab}
              onClick={() => view.goToTab(tab)}
              onDoubleClick={() => setRenaming(tag)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTabMenu({ tag, point: { x: event.clientX, y: event.clientY } });
              }}
            >
              <TabContent label={tag} count={shownCount(tab)} />
            </button>
          );
        })}
        {/* 最后一格（第六次反馈）：都放得下时是「+」，直接新建页签；有收起的页签时是「N ▾」，打开菜单，与前面的页签合成末格
            （第八次反馈）。页签都放得下、只差「+」时不显示（第七次反馈）。 */}
        {slot === 'none' ? null : (
          <button
            type="button"
            role="tab"
            aria-selected={false}
            aria-haspopup={hidden.length ? 'menu' : undefined}
            aria-expanded={hidden.length ? Boolean(slotMenu) : Boolean(creating)}
            aria-label={!hidden.length ? '新建页签' : `另有 ${hidden.length} 个收起的页签，新建页签`}
            className={cx('sn-side-tab sn-tab-more', !hidden.length && 'is-add', hidden.length > 0 && last >= 0 && 'is-joined')}
            onClick={(event) => (hidden.length ? openSlotMenu(event.currentTarget) : setCreating(event.currentTarget))}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              if (hidden.length) openSlotMenu(event.currentTarget);
              else setCreating(event.currentTarget);
            }}
          >
            {hidden.length ? (
              <>
                <span className="sn-tab-more-count">{hidden.length}</span>
                <Icon name="chevron-down" />
              </>
            ) : (
              <Icon name="plus" />
            )}
          </button>
        )}
      </div>

      {/* 测量行：与页签栏同样的页签，看不见，只用来量宽度（包括收起的页签与最后一格的「+」和「N ▾」）。 */}
      <div ref={measure} className={cx(rowClass, 'sn-tabs-measure')} data-current={currentIndex} data-swapped={swappedIndex} aria-hidden="true" inert>
        {FIXED_TABS.map(({ tab, icon }) => fixedTab(tab, icon, true))}
        {tags.map((tag) => (
          <span key={tag} className="sn-side-tab" data-measure="tag" data-tag={tag} aria-selected={view.tab === tabOfTag(tag)}>
            <TabContent label={tag} count={countOf(tabOfTag(tag))} />
          </span>
        ))}
        <span className="sn-side-tab-probe" data-measure="probe">
          汉字
        </span>
        <span className="sn-side-tab sn-tab-more is-add" data-measure="add">
          <Icon name="plus" />
        </span>
        <span className="sn-side-tab sn-tab-more" data-measure="count" aria-selected="true">
          <span className="sn-tab-more-count">8</span>
          <Icon name="chevron-down" />
        </span>
        <span className="sn-side-tab sn-tab-more" data-measure="count-2" aria-selected="true">
          <span className="sn-tab-more-count">88</span>
          <Icon name="chevron-down" />
        </span>
      </div>

      {slotMenu ? <ContextMenu label="页签" className="sn-tab-menu" items={slotItems} point={slotMenu.point} onClose={() => setSlotMenu(null)} /> : null}
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
