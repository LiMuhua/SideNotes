/**
 * 应用图标设置（T85，原型 settings.js 的 appIconPicker、customIconMenu 与 openIconCrop）。
 *
 * - 6 个内置图标在前，默认图标排第一，最后是自定义格；单击即换，立即生效。
 * - 指针停留或键盘聚焦时在格子上方显示大图预览，不写名称。
 * - 自定义格没有图片时是虚线加号格，点击选择图片；上传后显示裁好的图片，右下角的编辑按钮打开「更换图片…」「移除」。
 *   移除时如果正在使用它，回到默认图标；提示条可以撤销。
 * - 选好图片后先在「调整应用图标」弹窗中裁切：拖动移动，滚轮以指针为中心缩放，方向键微调（Shift 移得更多），加号与减号缩放；
 *   右侧是托盘、任务栏与桌面三种实际尺寸在浅色与深色任务栏上的预览，可以去掉圆角。
 *
 * 裁好的图片由页面画成 512 × 512 的 PNG，并按清单的 ICO 尺寸逐个画出后打包成 ICO，交给后端保存在系统应用数据目录
 * （adaptation.md 第十节）；原型只在浏览器中保存 256 × 256 的 PNG。
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BUILTIN_ICONS, CUSTOM_APP_ICON, DEFAULT_APP_ICON, ICON_CORNER_RATIO, ICO_SIZES, builtinIconSource } from '../../core/appIcons';
import * as bridge from '../../core/bridge';
import { buildIco } from '../../core/iconFile';
import type { Settings } from '../../core/types';
import { refreshCustomAppIcon, useCustomAppIcon } from '../../hooks/useAppIcon';
import { useToast } from '../../hooks/useToast';
import { Floating } from '../Floating';
import { Icon } from '../Icon';
import { ActionButton, Toggle, classes, moveRadio, type SaveSettings } from './controls';

/** 可以上传的图片：WebView2 能解码的常见格式，最大 10 MB（components.md 7.2）。 */
const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/x-icon,.ico';
const ICON_MAX_BYTES = 10 * 1024 * 1024;
/** 保存的 PNG 边长：窗口与托盘的图标取它，由系统按缩放比例缩小。 */
const ICON_OUTPUT_SIZE = 512;
/** 短边小于这个值的图片，在桌面与资源管理器的大图标里会发虚，裁切时提示一句。 */
const ICON_SHARP_SIZE = 256;
/** 最多放大到刚好铺满时的几倍。 */
const ICON_MAX_ZOOM = 4;
/** 预览的三种实际尺寸：托盘、任务栏、桌面（100% 缩放）。 */
const ICON_PREVIEW_SIZES = [16, 24, 48] as const;

/** 选好的图片。 */
interface SourceImage {
  /** 图片的对象地址，弹窗关闭后释放。 */
  url: string;
  element: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * 裁切的视图，以裁切框的边长为单位：scale 是每个图片像素占的长度，x、y 是图片左上角相对裁切框的位置。
 * 同一个视图既画大的裁切框，也画 16px 的预览，最后按同样的比例画到画布上。
 */
interface CropView {
  scale: number;
  x: number;
  y: number;
}

/** 重绘后焦点回到「应用图标」中选中的一格（原型 focusChecked）。 */
function focusChecked(): void {
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="应用图标"] [aria-checked="true"]')?.focus(),
  );
}

/**
 * 图标格：单选按钮，图标铺满格子；指针停留或键盘聚焦时在上方显示大图预览。
 */
function IconChoice({ label, src, selected, onChoose }: { label: string; src: string; selected: boolean; onChoose: () => void }) {
  const node = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(false);
  return (
    <>
      <button
        ref={node}
        type="button"
        className={classes('icon-choice', selected && 'selected')}
        role="radio"
        aria-checked={selected}
        aria-label={label}
        tabIndex={selected ? 0 : -1}
        onPointerEnter={() => setPreview(true)}
        onPointerLeave={() => setPreview(false)}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setPreview(true);
        }}
        onBlur={() => setPreview(false)}
        onClick={() => {
          setPreview(false);
          onChoose();
        }}
      >
        <img src={src} alt="" draggable={false} />
      </button>
      <Floating anchor={node} open={preview} options={{ placement: 'top', offset: 8 }} className="icon-preview-pop settings-floating" aria-hidden="true">
        <img src={src} alt="" />
      </Floating>
    </>
  );
}

/**
 * 自定义图标右下角的编辑按钮与菜单：更换图片、移除。方向键在菜单项之间移动，Esc 收起；
 * 焦点离开自定义格时由外层收起。
 */
function CustomIconMenu({
  open,
  onOpenChange,
  onReplace,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = `icon-edit-menu-${useId()}`;

  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);

  const close = (restore: boolean): void => {
    onOpenChange(false);
    if (restore) trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = items.current.filter((item): item is HTMLButtonElement => Boolean(item));
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index + (event.key === 'ArrowDown' ? 1 : list.length - 1) + list.length) % list.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon-edit"
        aria-label="更换或移除自定义图标"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(true) : onOpenChange(true))}
      >
        <Icon name="edit" />
      </button>
      <div id={menuId} className="icon-edit-menu" role="menu" aria-label="自定义图标" hidden={!open} onKeyDown={onKeyDown}>
        <button
          ref={(node) => {
            items.current[0] = node;
          }}
          type="button"
          className="icon-edit-item"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close(false);
            onReplace();
          }}
        >
          <Icon name="upload" />
          <span>更换图片…</span>
        </button>
        <span className="icon-edit-separator" />
        <button
          ref={(node) => {
            items.current[1] = node;
          }}
          type="button"
          className="icon-edit-item is-danger"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close(false);
            onRemove();
          }}
        >
          <Icon name="trash" />
          <span>移除</span>
        </button>
      </div>
    </>
  );
}

/** 画布转成 PNG 文件内容。 */
function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法生成 PNG'));
        return;
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}

/** 按裁切结果画出一个尺寸的图标；圆角与内置图标相同（64 视图框中的 14）。 */
function renderIcon(source: SourceImage, view: CropView, rounded: boolean, size: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('无法创建画布'));
  if (rounded) {
    context.beginPath();
    context.roundRect(0, 0, size, size, size * ICON_CORNER_RATIO);
    context.clip();
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.element, view.x * size, view.y * size, source.width * view.scale * size, source.height * view.scale * size);
  return canvasPng(canvas);
}

/** 画出要保存的 PNG 与 ICO：ICO 的每个尺寸都从原图直接画，小尺寸不经二次缩小。 */
async function renderIconFiles(source: SourceImage, view: CropView, rounded: boolean): Promise<{ png: Uint8Array; ico: Uint8Array }> {
  const png = await renderIcon(source, view, rounded, ICON_OUTPUT_SIZE);
  const entries = await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: await renderIcon(source, view, rounded, size) })));
  return { png, ico: buildIco(entries) };
}

/** 按视图摆放的图片：裁切框与各个预览共用，容器多大就按多大的比例画。 */
function CropImage({ source, view }: { source: SourceImage; view: CropView }) {
  return (
    <img
      src={source.url}
      alt=""
      draggable={false}
      style={{
        left: `${view.x * 100}%`,
        top: `${view.y * 100}%`,
        width: `${source.width * view.scale * 100}%`,
        height: `${source.height * view.scale * 100}%`,
      }}
    />
  );
}

/**
 * 「调整应用图标」弹窗：叠在设置窗口上（与回收站的确认同一层），设置窗口在此期间不可操作。
 * 刚打开时图片铺满裁切框并居中；最小缩到完整显示（空出的部分透明），最大放大到铺满时的 4 倍；
 * 图片比裁切框大的方向上不留空边。打开时焦点在「使用」上，「取消」、Esc、关闭按钮或点背景不做改动。
 */
function CropDialog({
  source,
  onCancel,
  onConfirm,
}: {
  source: SourceImage;
  onCancel: () => void;
  /** 返回 false 表示没有保存成功，弹窗保留。 */
  onConfirm: (files: { png: Uint8Array; ico: Uint8Array }) => Promise<boolean>;
}) {
  const { width, height } = source;
  const cover = 1 / Math.min(width, height);
  const contain = 1 / Math.max(width, height);
  const maximum = cover * ICON_MAX_ZOOM;
  const headingId = `icon-crop-title-${useId()}`;
  const toast = useToast();
  const dialog = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const use = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; from: CropView } | null>(null);
  const [rounded, setRounded] = useState(true);
  const [busy, setBusy] = useState(false);

  /** 校正视图：比裁切框大的方向不留空边，比裁切框小时居中。 */
  const clampView = (next: CropView): CropView => {
    const w = width * next.scale;
    const h = height * next.scale;
    return {
      scale: next.scale,
      x: w >= 1 - 1e-9 ? Math.min(0, Math.max(1 - w, next.x)) : (1 - w) / 2,
      y: h >= 1 - 1e-9 ? Math.min(0, Math.max(1 - h, next.y)) : (1 - h) / 2,
    };
  };
  const [view, setView] = useState<CropView>(() => clampView({ scale: cover, x: (1 - width * cover) / 2, y: (1 - height * cover) / 2 }));

  /** 缩放后的视图：锚点（以裁切框边长为单位）在屏幕上的位置保持不动。 */
  const zoomed = (from: CropView, next: number, anchorX = 0.5, anchorY = 0.5): CropView => {
    const scale = Math.min(maximum, Math.max(contain, next));
    const ratio = scale / from.scale;
    return clampView({ scale, x: anchorX - (anchorX - from.x) * ratio, y: anchorY - (anchorY - from.y) * ratio });
  };
  const atMinimum = view.scale <= contain * (1 + 1e-9);
  const atMaximum = view.scale >= maximum * (1 - 1e-9);

  /** 加号与减号按钮：按到尽头时按钮被禁用，焦点改放到裁切框上，免得落到页面上、离开这一层。 */
  const zoomStep = (factor: number): void => {
    const next = zoomed(view, view.scale * factor);
    if (next.scale <= contain * (1 + 1e-9) || next.scale >= maximum * (1 - 1e-9)) stage.current?.focus({ preventScroll: true });
    setView(next);
  };

  // 打开时焦点在「使用」上；设置窗口在此期间不可操作（原型 openLayer）。
  useEffect(() => {
    use.current?.focus({ preventScroll: true });
    const modal = document.querySelector<HTMLElement>('.settings-modal');
    if (!modal) return;
    modal.inert = true;
    modal.setAttribute('aria-hidden', 'true');
    return () => {
      modal.inert = false;
      modal.removeAttribute('aria-hidden');
    };
  }, []);

  // 滚轮以指针为中心缩放，要阻止外层滚动；React 的滚轮事件是被动监听，这里改用原生监听。
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const anchorX = (event.clientX - rect.left) / rect.width;
      const anchorY = (event.clientY - rect.top) / rect.height;
      setView((from) => {
        const scale = Math.min(maximum, Math.max(contain, from.scale * factor));
        const ratio = scale / from.scale;
        const w = width * scale;
        const h = height * scale;
        const x = anchorX - (anchorX - from.x) * ratio;
        const y = anchorY - (anchorY - from.y) * ratio;
        return {
          scale,
          x: w >= 1 - 1e-9 ? Math.min(0, Math.max(1 - w, x)) : (1 - w) / 2,
          y: h >= 1 - 1e-9 ? Math.min(0, Math.max(1 - h, y)) : (1 - h) / 2,
        };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [width, height, contain, maximum]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: view };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    // 位移按裁切框在屏幕上的实际大小换算，整页缩放不影响拖动的手感。
    const rect = event.currentTarget.getBoundingClientRect();
    setView(
      clampView({
        scale: current.from.scale,
        x: current.from.x + (event.clientX - current.x) / rect.width,
        y: current.from.y + (event.clientY - current.y) / rect.height,
      }),
    );
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView(clampView({ scale: view.scale, x: view.x + move[0], y: view.y + move[1] }));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setView(zoomed(view, view.scale * 1.1));
    } else if (event.key === '-') {
      event.preventDefault();
      setView(zoomed(view, view.scale / 1.1));
    }
  };

  /** Esc 关闭；Tab 只在弹窗内循环（原型 openLayer）。 */
  const onLayerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    event.stopPropagation();
    const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')).filter(
      (node) => !(node as HTMLButtonElement).disabled && node.tabIndex >= 0 && node.getClientRects().length > 0,
    );
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    let files: { png: Uint8Array; ico: Uint8Array };
    try {
      files = await renderIconFiles(source, view, rounded);
    } catch {
      setBusy(false);
      toast('无法处理这张图片，请换一张', null, true);
      return;
    }
    if (!(await onConfirm(files))) setBusy(false);
  };

  const host = document.querySelector('.settings-modal')?.parentElement ?? document.body;
  return createPortal(
    <div
      className="settings-confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={onLayerKeyDown}
    >
      <section ref={dialog} className="settings-confirm-dialog icon-crop-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="settings-confirm-header">
          <h3 id={headingId}>调整应用图标</h3>
          <ActionButton label="关闭" icon="x" className="icon-button" onClick={onCancel} />
        </header>
        <div className="icon-crop">
          <div className="icon-crop-main">
            <div
              ref={stage}
              className={classes('icon-crop-stage', rounded && 'is-rounded')}
              tabIndex={0}
              role="group"
              aria-label="裁切区域：拖动移动图片，滚轮缩放，方向键微调"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onStageKeyDown}
            >
              <CropImage source={source} view={view} />
            </div>
            <div className="icon-crop-zoom">
              <ActionButton label="缩小" icon="minus" className="icon-button" disabled={atMinimum} onClick={() => zoomStep(1 / 1.25)} />
              <input
                type="range"
                className="icon-crop-range"
                aria-label="缩放"
                min={contain}
                max={maximum}
                step="any"
                value={view.scale}
                onChange={(event) => setView(zoomed(view, Number(event.target.value)))}
              />
              <ActionButton label="放大" icon="plus" className="icon-button" disabled={atMaximum} onClick={() => zoomStep(1.25)} />
            </div>
          </div>
          <div className="icon-crop-side">
            <span className="icon-crop-caption">托盘、任务栏与桌面</span>
            {(['light', 'dark'] as const).map((tone) => (
              <div key={tone} className={`icon-crop-previews is-${tone}`} aria-hidden="true">
                {ICON_PREVIEW_SIZES.map((size) => (
                  <span key={size} className={classes('icon-crop-preview', `is-${size}`, rounded && 'is-rounded')}>
                    <CropImage source={source} view={view} />
                  </span>
                ))}
              </div>
            ))}
            <label className="icon-crop-round">
              <span>圆角</span>
              <Toggle label="圆角" checked={rounded} onChange={setRounded} />
            </label>
          </div>
        </div>
        {Math.min(width, height) < ICON_SHARP_SIZE ? (
          <p className="icon-crop-warning">{`图片只有 ${width} × ${height} 像素，桌面与资源管理器中的大图标会发虚。`}</p>
        ) : null}
        <footer className="settings-confirm-actions">
          <ActionButton label="取消" onClick={onCancel} />
          <ActionButton ref={use} label="使用" className="button primary compact" disabled={busy} onClick={() => void confirm()} />
        </footer>
      </section>
    </div>,
    host,
  );
}

/**
 * 应用图标设置：排在「显示」分组的主题之后（components.md 7.2）。
 */
export function AppIconPicker({ settings, save }: { settings: Settings; save: SaveSettings }) {
  const toast = useToast();
  const custom = useCustomAppIcon();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 打开裁切弹窗前的焦点，取消后还给它。
  const returnFocus = useRef<Element | null>(null);
  const current = settings.appIcon === CUSTOM_APP_ICON && !custom.url ? DEFAULT_APP_ICON : settings.appIcon;

  const choose = (appIcon: string): void => {
    if (appIcon !== settings.appIcon) void save({ appIcon });
  };

  const pick = (): void => input.current?.click();

  /** 读取选好的图片，成功后打开裁切弹窗；过大或读不出时提示，不做改动。 */
  const load = (file: File): void => {
    if (file.size > ICON_MAX_BYTES) {
      toast('图片不能超过 10 MB', null, true);
      return;
    }
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      returnFocus.current = document.activeElement;
      // 没有固有尺寸的 SVG 按 512 × 512 处理。
      setSource({ url, element, width: element.naturalWidth || 512, height: element.naturalHeight || 512 });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      toast('无法读取这张图片，请换一张 PNG、JPG 或 SVG 图片', null, true);
    };
    element.src = url;
  };

  const closeCrop = (): void => {
    if (source) URL.revokeObjectURL(source.url);
    setSource(null);
  };

  const cancelCrop = (): void => {
    closeCrop();
    const target = returnFocus.current;
    returnFocus.current = null;
    // 等设置窗口解除不可操作后再还焦点；原来的位置不在了（例如菜单已收起）时回到选中的一格。
    window.requestAnimationFrame(() => {
      if (target instanceof HTMLElement && target.isConnected && target !== document.body && target.getClientRects().length > 0) {
        target.focus({ preventScroll: true });
      } else {
        document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="应用图标"] [aria-checked="true"]')?.focus();
      }
    });
  };

  const applyCropped = async (files: { png: Uint8Array; ico: Uint8Array }): Promise<boolean> => {
    try {
      await bridge.saveCustomAppIcon(files.png, files.ico);
    } catch {
      toast('图标未能保存，请重试', null, true);
      return false;
    }
    await refreshCustomAppIcon();
    closeCrop();
    returnFocus.current = null;
    if (await save({ appIcon: CUSTOM_APP_ICON })) {
      focusChecked();
      toast('已换成自定义图标');
    }
    return true;
  };

  /** 移除上传的图片：正在使用时回到默认图标；先读出一份，提示条的「撤销」写回。 */
  const remove = async (): Promise<void> => {
    const using = settings.appIcon === CUSTOM_APP_ICON;
    const backup = custom.path ? await bridge.readCustomAppIcon(custom.path) : null;
    try {
      await bridge.removeCustomAppIcon();
    } catch {
      toast('自定义图标未能移除，请重试', null, true);
      return;
    }
    if (using) await save({ appIcon: DEFAULT_APP_ICON });
    await refreshCustomAppIcon();
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.icon-choice.is-add')?.focus());
    toast(
      using ? '已移除自定义图标，换回默认图标' : '已移除自定义图标',
      backup
        ? {
            label: '撤销',
            run: () => {
              void bridge
                .saveCustomAppIcon(backup.png, backup.ico)
                .then(async () => {
                  await refreshCustomAppIcon();
                  if (using) await save({ appIcon: CUSTOM_APP_ICON });
                })
                .catch(() => toast('无法恢复自定义图标', null, true));
            },
          }
        : null,
    );
  };

  return (
    <div className="icon-picker" role="radiogroup" aria-label="应用图标" onKeyDown={moveRadio}>
      {BUILTIN_ICONS.map((item) => (
        <IconChoice
          key={item.id}
          label={item.id === DEFAULT_APP_ICON ? `${item.name}（默认）` : item.name}
          src={builtinIconSource(item.id)}
          selected={current === item.id}
          onChoose={() => choose(item.id)}
        />
      ))}
      {custom.url ? (
        <span
          className="icon-custom"
          onBlur={(event) => {
            // 焦点离开自定义格时收起菜单（原型 customIconMenu 的 focusout）。
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
          }}
        >
          <IconChoice label="自定义图标" src={custom.url} selected={current === CUSTOM_APP_ICON} onChoose={() => choose(CUSTOM_APP_ICON)} />
          <CustomIconMenu open={menuOpen} onOpenChange={setMenuOpen} onReplace={pick} onRemove={() => void remove()} />
        </span>
      ) : (
        <button type="button" className="icon-choice is-add" aria-label="上传图片作为应用图标" onClick={pick}>
          <Icon name="plus" />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ICON_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 清空选择，下次选同一个文件也会触发 change。
          event.target.value = '';
          if (file) load(file);
        }}
      />
      {source ? <CropDialog source={source} onCancel={cancelCrop} onConfirm={applyCropped} /> : null}
    </div>
  );
}
