/**
 * 图标。
 *
 * 沿用现有应用的 SVG sprite（`src/components/Icon.tsx`）：24 网格、线性、圆端点。
 * 片段库需要而现有 sprite 没有的图形，按同一规格补在这里；正式重构时并入 `src/components/Icon.tsx`，
 * 不引入第二套图标库。描边宽度由令牌 `--sn-icon-stroke` 控制。
 */

import { IconSprite, type IconName as BaseIconName } from '@/components/Icon';

type ExtraIconName =
  | 'star'
  | 'clock'
  | 'tag'
  | 'layers'
  | 'folder-open'
  | 'folder-move'
  | 'grid'
  | 'list'
  | 'sidebar'
  | 'filter'
  | 'sort'
  | 'braces'
  | 'template'
  | 'markdown'
  | 'text'
  | 'globe'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'command'
  | 'enter'
  | 'wrap'
  | 'eye'
  | 'columns'
  | 'monitor'
  | 'sliders'
  | 'terminal'
  | 'square'
  | 'check-square'
  | 'arrow-up'
  | 'arrow-down'
  | 'refresh'
  | 'maximize'
  | 'restore-window'
  | 'menu';

export type IconName = BaseIconName | ExtraIconName;

/** 补充图形，规格与现有 sprite 一致。 */
function ExtraSprite() {
  return (
    <svg className="svg-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <symbol id="i-star" viewBox="0 0 24 24">
        <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </symbol>
      <symbol id="i-tag" viewBox="0 0 24 24">
        <path d="M3.5 12.1V4.5a1 1 0 0 1 1-1h7.6l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z" />
        <circle cx="8" cy="8" r="1.4" />
      </symbol>
      <symbol id="i-layers" viewBox="0 0 24 24">
        <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
        <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
      </symbol>
      <symbol id="i-folder-open" viewBox="0 0 24 24">
        <path d="M3 18.5V6a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V10" />
        <path d="M3 18.5 6 10.5h15l-3 8z" />
      </symbol>
      <symbol id="i-folder-move" viewBox="0 0 24 24">
        <path d="M3 19V6a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V19z" />
        <path d="M8.5 13.5h7m0 0L13 11m2.5 2.5L13 16" />
      </symbol>
      <symbol id="i-grid" viewBox="0 0 24 24">
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      </symbol>
      <symbol id="i-sidebar" viewBox="0 0 24 24">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M9.5 4.5v15" />
      </symbol>
      <symbol id="i-filter" viewBox="0 0 24 24">
        <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
      </symbol>
      <symbol id="i-sort" viewBox="0 0 24 24">
        <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
      </symbol>
      <symbol id="i-braces" viewBox="0 0 24 24">
        <path d="M8 4.5c-1.8 0-2.5 1-2.5 2.6v2.2c0 1.2-.6 2-1.8 2.7 1.2.7 1.8 1.5 1.8 2.7v2.2c0 1.6.7 2.6 2.5 2.6M16 4.5c1.8 0 2.5 1 2.5 2.6v2.2c0 1.2.6 2 1.8 2.7-1.2.7-1.8 1.5-1.8 2.7v2.2c0 1.6-.7 2.6-2.5 2.6M12 9.5h.01M12 14.5h.01" />
      </symbol>
      <symbol id="i-template" viewBox="0 0 24 24">
        <path d="M7.5 4.5C5.8 4.5 5 5.5 5 7.1v2.2c0 1.2-.6 2-1.6 2.7 1 .7 1.6 1.5 1.6 2.7v2.2c0 1.6.8 2.6 2.5 2.6M16.5 4.5c1.7 0 2.5 1 2.5 2.6v2.2c0 1.2.6 2 1.6 2.7-1 .7-1.6 1.5-1.6 2.7v2.2c0 1.6-.8 2.6-2.5 2.6M9 12h.01M12 12h.01M15 12h.01" />
      </symbol>
      <symbol id="i-markdown" viewBox="0 0 24 24">
        <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
        <path d="M6 15V9l2.5 3L11 9v6M15.5 9v6m0 0-2-2m2 2 2-2" />
      </symbol>
      <symbol id="i-text" viewBox="0 0 24 24">
        <path d="M4 6h16M4 10.5h12M4 15h16M4 19.5h9" />
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z" />
      </symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24">
        <path d="m9 6 6 6-6 6" />
      </symbol>
      <symbol id="i-chevron-left" viewBox="0 0 24 24">
        <path d="m15 6-6 6 6 6" />
      </symbol>
      <symbol id="i-chevron-up" viewBox="0 0 24 24">
        <path d="m6 15 6-6 6 6" />
      </symbol>
      <symbol id="i-command" viewBox="0 0 24 24">
        <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
      </symbol>
      <symbol id="i-enter" viewBox="0 0 24 24">
        <path d="M19 5v6.5a3 3 0 0 1-3 3H5m0 0 4-4m-4 4 4 4" />
      </symbol>
      <symbol id="i-wrap" viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h12.5a3 3 0 0 1 0 6H13m0 0 2-2m-2 2 2 2M4 18h5" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </symbol>
      <symbol id="i-columns" viewBox="0 0 24 24">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M12 4.5v15" />
      </symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="12.5" rx="2" />
        <path d="M8.5 20h7M12 16.5V20" />
      </symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="10" cy="17" r="2" />
      </symbol>
      <symbol id="i-terminal" viewBox="0 0 24 24">
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" />
      </symbol>
      <symbol id="i-square" viewBox="0 0 24 24">
        <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      </symbol>
      <symbol id="i-check-square" viewBox="0 0 24 24">
        <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </symbol>
      <symbol id="i-arrow-up" viewBox="0 0 24 24">
        <path d="M12 19V5m-6 6 6-6 6 6" />
      </symbol>
      <symbol id="i-arrow-down" viewBox="0 0 24 24">
        <path d="M12 5v14m-6-6 6 6 6-6" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" />
      </symbol>
      <symbol id="i-maximize" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </symbol>
      <symbol id="i-restore-window" viewBox="0 0 24 24">
        <rect x="5.5" y="8.5" width="10" height="10" rx="1" />
        <path d="M8.5 8.5V6.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2" />
      </symbol>
      <symbol id="i-menu" viewBox="0 0 24 24">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </symbol>
    </svg>
  );
}

/** 现有 sprite 与补充图形，挂在 Playground 根节点一次。 */
export function PlaygroundSprite() {
  return (
    <>
      <IconSprite />
      <ExtraSprite />
    </>
  );
}

/** 单个图标；装饰性图标对辅助技术隐藏，含义由相邻文字或 aria-label 提供。 */
export function Icon({ name, className, filled = false }: { name: IconName; className?: string; filled?: boolean }) {
  const classes = ['sn-icon', filled ? 'is-filled' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg className={classes} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
