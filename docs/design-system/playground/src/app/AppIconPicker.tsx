/**
 * 应用图标设置（本次提出）：参照常见的头像设置，内置图标与自定义图标排成一行，单击即换。
 *
 * - 内置图标：单选，选中的一格带强调色边框；悬停显示名称，默认图标注明「默认」。
 * - 自定义图标：还没有上传时是一个虚线加号格，点击选择图片；上传后变成一格图片，和内置图标一样单击选用，
 *   右下角的编辑按钮打开菜单：更换图片、移除。移除时如果正在使用它，回到默认图标，提示条可以撤销。
 * - 选好图片后先在裁切弹窗里调整：拖动移动，滚轮或滑块缩放，方向键微调；右侧是托盘、任务栏与桌面三种实际尺寸的预览。
 *
 * Playground 只在内存中保存裁好的 256 × 256 PNG；桌面端如何保存与替换系统图标见 adaptation.md。
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { APP_ICONS, CUSTOM_APP_ICON, DEFAULT_APP_ICON, ICON_CORNER_RATIO } from '../model/appIcons';
import { useNotes } from '../model/notes';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { DropdownMenu } from '../ui/Menu';
import { useToast } from '../ui/Tabs';
import { Switch } from '../ui/Toggle';
import { Tooltip } from '../ui/Tooltip';

/** 可以上传的图片：浏览器与 WebView2 都能解码的常见格式。 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/x-icon,.ico';
const MAX_BYTES = 10 * 1024 * 1024;
/** 裁好的图标边长：Playground 中最大只显示到关于页的五十多像素，256 足够；桌面端另按 ICO 的各个尺寸生成。 */
const OUTPUT_SIZE = 256;
/** 边长小于这个值的图片，在桌面与资源管理器的大图标里会发虚，裁切时提示一句。 */
const SHARP_SIZE = 256;
/** 最多放大到刚好铺满时的几倍。 */
const MAX_ZOOM = 4;
/** 预览的三种实际尺寸：托盘、任务栏、桌面（100% 缩放）。 */
const PREVIEW_SIZES = [16, 24, 48] as const;

interface SourceImage {
  /** 图片的对象地址，弹窗关闭后释放。 */
  url: string;
  element: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * 裁切的视图，以裁切框的边长为单位：scale 是每个图片像素占的长度，x、y 是图片左上角相对裁切框的位置。
 * 用相对单位，同一个视图既能画大的裁切框，也能画 16px 的预览，最后按同样的比例画到画布上。
 */
interface CropView {
  scale: number;
  x: number;
  y: number;
}

/** 图片比裁切框大的方向上不留空边；比裁切框小（缩小到完整显示）时居中。 */
function clamp(view: CropView, width: number, height: number): CropView {
  const w = width * view.scale;
  const h = height * view.scale;
  return {
    scale: view.scale,
    x: w >= 1 ? Math.min(0, Math.max(1 - w, view.x)) : (1 - w) / 2,
    y: h >= 1 ? Math.min(0, Math.max(1 - h, view.y)) : (1 - h) / 2,
  };
}

/** 按裁切结果画出图标；圆角与内置图标相同（64 视图框中的 14）。 */
function renderIcon(source: SourceImage, view: CropView, rounded: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  if (rounded) {
    context.beginPath();
    context.roundRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE, OUTPUT_SIZE * ICON_CORNER_RATIO);
    context.clip();
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.element, view.x * OUTPUT_SIZE, view.y * OUTPUT_SIZE, source.width * view.scale * OUTPUT_SIZE, source.height * view.scale * OUTPUT_SIZE);
  return canvas.toDataURL('image/png');
}

export function AppIconPicker() {
  const { appIcon, customIcon, setAppIcon, setCustomIcon } = useNotes();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  // 单选组的名称每个实例不同：组件页与设置窗口可以各放一个，互不牵连。
  const group = useId();

  const pick = () => input.current?.click();

  const load = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast({ message: '图片不能超过 10 MB', tone: 'danger' });
      return;
    }
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      // 没有固有尺寸的 SVG 按 512 × 512 处理。
      setSource({ url, element, width: element.naturalWidth || 512, height: element.naturalHeight || 512 });
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      toast({ message: '无法读取这张图片，请换一张 PNG、JPG 或 SVG 图片', tone: 'danger' });
    };
    element.src = url;
  };

  const close = () => {
    if (source) URL.revokeObjectURL(source.url);
    setSource(null);
  };

  const remove = () => {
    const previous = { url: customIcon, icon: appIcon };
    setCustomIcon(null);
    toast({
      message: previous.icon === CUSTOM_APP_ICON ? '已移除自定义图标，换回默认图标' : '已移除自定义图标',
      action: {
        label: '撤销',
        run: () => {
          setCustomIcon(previous.url);
          if (previous.icon !== CUSTOM_APP_ICON) setAppIcon(previous.icon);
        },
      },
    });
  };

  return (
    <div className="sn-icon-picker" role="radiogroup" aria-label="应用图标">
      {APP_ICONS.map((icon) => {
        const label = icon.id === DEFAULT_APP_ICON ? `${icon.name}（默认）` : icon.name;
        return (
          <Tooltip key={icon.id} placement="top" content={<img className="sn-icon-preview" src={icon.svg} alt="" />}>
            <label className={cx('sn-icon-choice', appIcon === icon.id && 'is-selected')}>
              <input type="radio" name={group} className="sn-sr-only" aria-label={label} checked={appIcon === icon.id} onChange={() => setAppIcon(icon.id)} />
              <img src={icon.svg} alt="" draggable={false} />
            </label>
          </Tooltip>
        );
      })}
      {customIcon ? (
        <span className="sn-icon-custom">
          <Tooltip placement="top" content={<img className="sn-icon-preview" src={customIcon} alt="" />}>
            <label className={cx('sn-icon-choice', appIcon === CUSTOM_APP_ICON && 'is-selected')}>
              <input
                type="radio"
                name={group}
                className="sn-sr-only"
                aria-label="自定义图标"
                checked={appIcon === CUSTOM_APP_ICON}
                onChange={() => setAppIcon(CUSTOM_APP_ICON)}
              />
              <img src={customIcon} alt="" draggable={false} />
            </label>
          </Tooltip>
          <DropdownMenu
            label="自定义图标"
            items={[
              { id: 'replace', label: '更换图片…', icon: 'upload', onSelect: pick },
              { id: 'remove', label: '移除', icon: 'trash', danger: true, separatorBefore: true, onSelect: remove },
            ]}
            trigger={(props) => (
              <button {...props} type="button" className="sn-icon-edit" aria-label="更换或移除自定义图标">
                <Icon name="edit" />
              </button>
            )}
          />
        </span>
      ) : (
        <button type="button" className="sn-icon-choice is-add" aria-label="上传图片作为应用图标" onClick={pick}>
          <Icon name="plus" />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 清空选择，下次选同一个文件也会触发 change。
          event.target.value = '';
          if (file) load(file);
        }}
      />
      {source ? (
        <CropDialog
          source={source}
          onCancel={close}
          onConfirm={(url) => {
            setCustomIcon(url);
            close();
            toast({ message: '已换成自定义图标', tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}

/** 按视图显示图片：裁切框与各个预览共用，容器多大就按多大的比例画。 */
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
 * 裁切弹窗：裁切框里拖动移动，滚轮以指针为中心缩放，方向键微调（按住 Shift 移得更多），加号与减号缩放。
 * 刚打开时图片铺满裁切框并居中；最小可以缩到完整显示（空出的部分透明），最大放大到铺满时的 4 倍。
 */
function CropDialog({ source, onCancel, onConfirm }: { source: SourceImage; onCancel: () => void; onConfirm: (url: string) => void }) {
  const { width, height } = source;
  const cover = 1 / Math.min(width, height);
  const contain = 1 / Math.max(width, height);
  const [view, setView] = useState<CropView>(() => clamp({ scale: cover, x: (1 - width * cover) / 2, y: (1 - height * cover) / 2 }, width, height));
  const [rounded, setRounded] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; from: CropView } | null>(null);

  /** 缩放到 scale，锚点（以裁切框边长为单位）在屏幕上的位置保持不动。 */
  const zoom = useCallback(
    (next: (current: number) => number, anchorX = 0.5, anchorY = 0.5) =>
      setView((current) => {
        const scale = Math.min(cover * MAX_ZOOM, Math.max(contain, next(current.scale)));
        const ratio = scale / current.scale;
        return clamp({ scale, x: anchorX - (anchorX - current.x) * ratio, y: anchorY - (anchorY - current.y) * ratio }, width, height);
      }),
    [cover, contain, width, height],
  );

  // 滚轮缩放要阻止外层滚动，React 的滚轮事件是被动监听，这里改用原生监听。
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom((scale) => scale * factor, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoom]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    // 位移按裁切框在屏幕上的实际大小换算，舞台缩放与字号缩放都不影响拖动的手感。
    const rect = event.currentTarget.getBoundingClientRect();
    setView(clamp({ ...current.from, x: current.from.x + (event.clientX - current.x) / rect.width, y: current.from.y + (event.clientY - current.y) / rect.height }, width, height));
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setView((current) => clamp({ ...current, x: current.x + move[0], y: current.y + move[1] }, width, height));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoom((scale) => scale * 1.1);
    } else if (event.key === '-') {
      event.preventDefault();
      zoom((scale) => scale / 1.1);
    }
  };

  return (
    <Dialog
      open
      title="调整应用图标"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" data-autofocus onClick={() => onConfirm(renderIcon(source, view, rounded))}>
            使用
          </Button>
        </>
      }
    >
      <div className="sn-crop">
        <div className="sn-crop-main">
          <div
            ref={stage}
            className={cx('sn-crop-stage', rounded && 'is-rounded')}
            tabIndex={0}
            role="group"
            aria-label="裁切区域：拖动移动图片，滚轮缩放，方向键微调"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
          >
            <CropImage source={source} view={view} />
          </div>
          <div className="sn-crop-zoom">
            <IconButton icon="minus" label="缩小" size="sm" disabled={view.scale <= contain} onClick={() => zoom((scale) => scale / 1.25)} />
            <input
              type="range"
              className="sn-range"
              aria-label="缩放"
              min={contain}
              max={cover * MAX_ZOOM}
              step="any"
              value={view.scale}
              onChange={(event) => zoom(() => Number(event.target.value))}
            />
            <IconButton icon="plus" label="放大" size="sm" disabled={view.scale >= cover * MAX_ZOOM} onClick={() => zoom((scale) => scale * 1.25)} />
          </div>
        </div>
        <div className="sn-crop-side">
          <span className="sn-crop-caption">托盘、任务栏与桌面</span>
          {(['light', 'dark'] as const).map((tone) => (
            <div key={tone} className={cx('sn-crop-previews', `is-${tone}`)} aria-hidden="true">
              {PREVIEW_SIZES.map((size) => (
                <span key={size} className={cx('sn-crop-preview', `is-${size}`, rounded && 'is-rounded')}>
                  <CropImage source={source} view={view} />
                </span>
              ))}
            </div>
          ))}
          <Switch label="圆角" checked={rounded} onChange={setRounded} />
        </div>
      </div>
      {Math.min(width, height) < SHARP_SIZE ? (
        <p className="sn-crop-warning">
          图片只有 {width} × {height} 像素，桌面与资源管理器中的大图标会发虚。
        </p>
      ) : null}
    </Dialog>
  );
}
