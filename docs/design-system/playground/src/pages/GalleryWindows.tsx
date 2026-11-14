/**
 * 组件页：记录窗口（第三、四次反馈）。
 *
 * 卡片拖出侧栏或点「展开全文」时打开的窗口只在交互原型中实现（拖出、合并标签页、缩放与关闭动画，见 interactions.md 第四节）；
 * 这里是静态的样式示例：外框与获得焦点时的边框、标题栏、顶部与左侧两种标签页、截断标题的全名提示。
 * 标题栏上的按钮切换标签页的位置，与设置「外观与交互 › 其它 › 窗口标签页」是同一项。
 */

import { useEffect, useRef, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { noteTitle } from '@/core/notes';
import { parse } from '@/core/tags';
import type { Note } from '@/core/types';
import { notesInTab, useNotes } from '../model/notes';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/context';
import { Layer, useAnchoredPosition } from '../ui/layer';
import { Demo, PageSection, StateCell } from './common';

/** 标题被截断时，指针停留 0.4 秒显示全名（与交互原型相同）；没有截断时不提示。 */
const TIP_DELAY = 400;

function TabTitle({ text }: { text: string }) {
  const title = useRef<HTMLSpanElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { style } = useAnchoredPosition(open, title, floating, 'bottom-start', 6);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span
      ref={title}
      className="sn-note-window-tab-title"
      onPointerEnter={(event) => {
        const element = event.currentTarget;
        window.clearTimeout(timer.current);
        if (element.scrollWidth > element.clientWidth + 1) timer.current = window.setTimeout(() => setOpen(true), TIP_DELAY);
      }}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setOpen(false);
      }}
    >
      {text}
      {open ? (
        <Layer>
          <div ref={floating} role="tooltip" className="sn-tooltip" style={style}>
            {text}
          </div>
        </Layer>
      ) : null}
    </span>
  );
}

/** 一个记录窗口：两个以上的记录时是标签页，side 为标签页在左侧。 */
function NoteWindowSample({ notes, initialSide, focused = false }: { notes: Note[]; initialSide: boolean; focused?: boolean }) {
  const [side, setSide] = useState(initialSide);
  const [activeId, setActiveId] = useState(notes[0]?.id ?? '');
  const [pinned, setPinned] = useState(true);
  const current = notes.find((note) => note.id === activeId) ?? notes[0];
  if (!current) return null;
  const parsed = parse(current.text);
  const tabs = (
    <div className="sn-note-window-tabs" role="tablist" aria-orientation={side ? 'vertical' : 'horizontal'}>
      {notes.map((note) => {
        const active = note.id === current.id;
        return (
          <div
            key={note.id}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            className={cx('sn-note-window-tab', active && 'is-active')}
            onClick={() => setActiveId(note.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveId(note.id);
              }
            }}
          >
            <span className="sn-note-window-tab-emoji" aria-hidden="true">
              {note.emoji}
            </span>
            <TabTitle text={noteTitle(note)} />
            <IconButton icon="x" label={`关闭标签页：${noteTitle(note)}`} size="sm" className="sn-note-window-tab-close" tabIndex={-1} />
          </div>
        );
      })}
    </div>
  );
  return (
    <section className={cx('sn-note-window', 'has-tabs', side && 'is-side-tabs', focused && 'is-focused')} aria-label={noteTitle(current)}>
      <header className="sn-note-window-head">
        <span className="sn-note-window-emoji" aria-hidden="true">
          {current.emoji}
        </span>
        <h3 className="sn-note-window-title">{noteTitle(current)}</h3>
        {side ? null : tabs}
        {side ? null : <div className="sn-note-window-grip" aria-hidden="true" />}
        <div className="sn-note-window-actions">
          <IconButton icon={side ? 'panel-top' : 'panel-left'} label={side ? '标签页放到顶部' : '标签页放到左侧'} size="sm" className="sn-note-window-layout" pressed={side} onClick={() => setSide((value) => !value)} />
          <IconButton icon="pin" label={pinned ? '取消置顶窗口' : '置顶窗口'} size="sm" className="sn-note-window-pin" pressed={pinned} fillWhenPressed onClick={() => setPinned((value) => !value)} />
          <IconButton icon="x" label="关闭窗口" size="sm" />
        </div>
      </header>
      <div className="sn-note-window-main">
        {side ? tabs : null}
        <div className="sn-note-window-body" role="tabpanel">
          <Markdown text={parsed.body} className="sn-note-markdown" />
          {parsed.tags.length ? (
            <div className="sn-note-window-tags">
              {parsed.tags.map((tag) => (
                <span key={tag} className="sn-note-tag">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function WindowsSection() {
  const data = useNotes();
  const notes = notesInTab(data.notes, 'workspace', data.pinnedTags);
  // 三个标签页：其中一个标题较长，演示截断与全名提示。
  const long = notes.find((note) => noteTitle(note).length > 10);
  const picked = [notes[0], long, notes[1], notes[2]].filter((note, index, list): note is Note => Boolean(note) && list.indexOf(note) === index).slice(0, 3);
  if (picked.length < 2) return null;
  return (
    <PageSection
      id="gallery-windows"
      title="记录窗口"
      description="卡片拖出侧栏或点「展开全文」时打开。拖出、合并标签页、缩放与关闭动画只在交互原型中实现，这里是静态的样式示例。"
    >
      <Demo
        title="标签页在顶部与左侧"
        note="两个以上的记录合在一个窗口时是标签页。标题栏上的按钮切换位置，与设置「窗口标签页」是同一项；标题被截断时悬停片刻显示全名。获得焦点的窗口边框带一点强调色，置顶时图钉是实心的。"
        wide
      >
        <div className="sn-window-matrix">
          <StateCell label="顶部（默认）">
            <div className="sn-window-sample">
              <NoteWindowSample notes={picked} initialSide={false} focused />
            </div>
          </StateCell>
          <StateCell label="左侧">
            <div className="sn-window-sample is-side">
              <NoteWindowSample notes={picked} initialSide />
            </div>
          </StateCell>
        </div>
      </Demo>
    </PageSection>
  );
}
