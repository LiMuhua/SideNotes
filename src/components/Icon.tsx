/**
 * 图标 sprite。
 *
 * 图形取自原型的内联 SVG sprite，桌面端沿用同一组线条与粗细，
 * 保证卡片、设置页与托盘提示的视觉一致。
 */

/** 可用的图标名称。 */
export type IconName =
  | 'alert'
  | 'archive'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'bell'
  | 'check'
  | 'check-circle'
  | 'chevron-down'
  | 'cloud'
  | 'cloud-off'
  | 'code'
  | 'copy'
  | 'download'
  | 'duplicate'
  | 'edit'
  | 'expand'
  | 'external'
  | 'file'
  | 'file-text'
  | 'folder'
  | 'hash'
  | 'heart'
  | 'image'
  | 'info'
  | 'keyboard'
  | 'link'
  | 'loader'
  | 'lock'
  | 'moon'
  | 'more'
  | 'note'
  | 'pin'
  | 'pin-off'
  | 'plus'
  | 'restore'
  | 'search'
  | 'settings'
  | 'sun'
  | 'trash'
  | 'unlock'
  | 'upload'
  | 'x';

/** sprite 定义，挂在应用根节点一次。 */
export function IconSprite() {
  return (
    <svg className="svg-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <symbol id="i-plus" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14"/>
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="m6 6 12 12M18 6 6 18"/>
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>
      </symbol>
      <symbol id="i-pin" viewBox="0 0 24 24">
        <path d="m15 3 6 6-4 1-4 5-1 4-7-7 4-1 5-4zM3 21l5-5"/>
      </symbol>
      <symbol id="i-pin-off" viewBox="0 0 24 24">
        <path d="m3 3 18 18M15 3l6 6-4 1-1.3 1.6M9 11l-4 1 7 7 1-4M3 21l5-5"/>
      </symbol>
      <symbol id="i-archive" viewBox="0 0 24 24">
        <path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>
      </symbol>
      <symbol id="i-restore" viewBox="0 0 24 24">
        <path d="M3 10a9 9 0 1 1 1.3 7M3 4v6h6"/>
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>
      </symbol>
      <symbol id="i-more" viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>
      </symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24">
        <path d="M4 12h16m-6-6 6 6-6 6"/>
      </symbol>
      <symbol id="i-arrow-left" viewBox="0 0 24 24">
        <path d="M20 12H4m6-6-6 6 6 6"/>
      </symbol>
      <symbol id="i-arrow-up-right" viewBox="0 0 24 24">
        <path d="M6 18 18 6M6 6h12v12"/>
      </symbol>
      <symbol id="i-chevron-down" viewBox="0 0 24 24">
        <path d="m6 9 6 6 6-6"/>
      </symbol>
      <symbol id="i-image" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 6"/>
      </symbol>
      <symbol id="i-settings" viewBox="0 0 24 24">
        <path d="m9.5 3-.7 3-2.7 1L3.5 6 2 9l2 2v3l-2 2 1.5 3 2.6-1 2.7 1 .7 3h5l.7-3 2.7-1 2.6 1 1.5-3-2-2v-3l2-2-1.5-3-2.6 1-2.7-1-.7-3z"/><circle cx="12" cy="12" r="3"/>
      </symbol>
      <symbol id="i-keyboard" viewBox="0 0 24 24">
        <rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M7 15h10"/>
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="m5 12 4 4L19 6"/>
      </symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>
      </symbol>
      <symbol id="i-file-text" viewBox="0 0 24 24">
        <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>
      </symbol>
      <symbol id="i-code" viewBox="0 0 24 24">
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>
      </symbol>
      <symbol id="i-link" viewBox="0 0 24 24">
        <path d="m10 13 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0m2 2 2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0" transform="translate(1 0)"/>
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>
      </symbol>
      <symbol id="i-moon" viewBox="0 0 24 24">
        <path d="M20 15.5A9 9 0 0 1 8.5 4a9 9 0 1 0 11.5 11.5z"/>
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>
      </symbol>
      <symbol id="i-upload" viewBox="0 0 24 24">
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>
      </symbol>
      <symbol id="i-external" viewBox="0 0 24 24">
        <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24">
        <rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>
      </symbol>
      <symbol id="i-unlock" viewBox="0 0 24 24">
        <rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7-2M12 14v3"/>
      </symbol>
      <symbol id="i-expand" viewBox="0 0 24 24">
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>
      </symbol>
      <symbol id="i-note" viewBox="0 0 24 24">
        <path d="M5 3h14v14l-4 4H5zM15 21v-4h4M8 8h8M8 12h6"/>
      </symbol>
      <symbol id="i-folder" viewBox="0 0 24 24">
        <path d="M3 6h7l2 3h9v12H3z"/>
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>
      </symbol>
      <symbol id="i-loader" viewBox="0 0 24 24">
        <path d="M21 12a9 9 0 1 1-9-9"/>
      </symbol>
      <symbol id="i-hash" viewBox="0 0 24 24">
        <path d="m9 3-2 18M17 3l-2 18M4 8h17M3 16h17"/>
      </symbol>
      <symbol id="i-cloud" viewBox="0 0 24 24">
        <path d="M7 19h11a4 4 0 0 0 0-8 6 6 0 0 0-11.5-2A5 5 0 0 0 7 19z"/>
      </symbol>
      <symbol id="i-cloud-off" viewBox="0 0 24 24">
        <path d="m3 3 18 18M7 19h7M18 19a4 4 0 0 0 0-8 6 6 0 0 0-9-5M6 9a5 5 0 0 0 1 10"/>
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="m16 3 5 5-12 12H4v-5zM13 6l5 5"/>
      </symbol>
      <symbol id="i-duplicate" viewBox="0 0 24 24">
        <rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5M12 14h5M14.5 11.5v5"/>
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M14 3H5v18h14V8zM14 3v5h5"/>
      </symbol>
      <symbol id="i-heart" viewBox="0 0 24 24">
        <path d="M20.5 4.5a5 5 0 0 0-7 0L12 6l-1.5-1.5a5 5 0 0 0-7 7L12 20l8.5-8.5a5 5 0 0 0 0-7z"/>
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path d="M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3zM10 21h4"/>
      </symbol>
    </svg>
  );
}

/** 单个图标。 */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
