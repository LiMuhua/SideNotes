/**
 * 动画层（T83，技术决策第 41 条）。
 *
 * 一个盖住当前屏幕工作区、点击穿透、不抢焦点的透明窗口，画一个窗口画不到的东西：
 * - 拖影：卡片拖出侧栏、标签页拖出窗口之后，拖影跟着指针画在这里（来源窗口里的拖影同时藏起来）。
 * - 插入线：拖动经过别的记录窗口时，那个窗口算出的插入线画在这里，叠在拖影与正在拖动的窗口之上。
 * - 形变动画：记录窗口打开时，窗口的副本从拖影或卡片展开到窗口的位置，结束后交给真正的窗口；
 *   关闭时真正的窗口先藏起来，副本缩回卡片（或原地提起淡出）。帧与时长照搬原型 note-window.js 的 morph 与 closeEntry。
 * - 连接带（T100、T114、T122）：附着在卡片旁的全文浮窗开着时，卡片的边与浮窗的边之间一块强调色渐变带，
 *   浮窗一边较浓、往卡片渐淡，重点落在浮窗上；出现时从卡片一边展开，收回时原路收拢。
 * - 虚线框（T105）：按住 Ctrl 拖动时，被别的程序挡住的记录窗口各画一个半透明的虚线框；指针移上去，窗口提到最前，框换成真正的窗口。
 * - 浮现（T119、T130）：被挡住的记录窗口提到最前时，窗口先隐身，这里在窗口的位置播放它的副本淡入、上浮，结束后窗口现身。
 * 位置由后端给出（相对本窗口内容区的物理像素），除以页面像素比得到页面像素；副本的大小与来源窗口相同（同样的界面缩放）。
 */

import { useEffect, useRef } from 'react';
import { IconSprite } from './Icon';
import * as bridge from '../core/bridge';

/** 与拖影（.card-drag-ghost）的倾斜角度一致。 */
const DRAG_TILT = -2.5;
/**
 * 记录窗口浮现（T130）淡入的时长（毫秒），各主题相同：第六轮反馈要求比原来
 * （主题的常规时长，终端只有 110 毫秒）慢一些。缓动用主题的 standard（前后都缓），不用一下子冲出来的 enter。
 */
const SURFACE_FADE = 360;
const EVENTS = bridge.NOTE_WINDOW_EVENTS;

interface GhostPayload {
  /** 开始拖动时给出拖影的 HTML，之后只给位置。 */
  html?: string;
  grab: [number, number];
  x: number;
  y: number;
  visible: boolean;
  /** 卡片拖出了侧栏（拖影放大一点），或标签页拖到窗口外将拆成新窗口。 */
  outside: boolean;
}

/** 连接带两端的竖边（物理像素）：横坐标、上端、下端；卡片一端与全文浮窗一端。 */
interface ConnectorPayload {
  card: [number, number, number];
  panel: [number, number, number];
}

const SVG = 'http://www.w3.org/2000/svg';
/** 连接带渐变的标识（动画层里只有一条连接带）。 */
const BEAM_GRADIENT = 'overlay-beam-fill';

interface MorphPayload {
  id: number;
  html: string;
  from: bridge.PixelRect;
  to: bridge.PixelRect | null;
  mode: 'open-drag' | 'open-expand' | 'close-drag' | 'close-expand' | 'surface';
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function duration(name: string): number {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return 0;
  return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
}

function easing(name: string): string {
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease';
}

/** 物理像素换成本页面的像素。 */
function toPage(rect: bridge.PixelRect): bridge.PixelRect {
  const ratio = window.devicePixelRatio || 1;
  return { x: rect.x / ratio, y: rect.y / ratio, width: rect.width / ratio, height: rect.height / ratio };
}

/** 一段 HTML 的第一个元素。 */
function fromHtml(html: string): HTMLElement | null {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const node = holder.firstElementChild;
  return node instanceof HTMLElement ? node : null;
}

/** 从一个矩形变到元素现在的位置与大小（原型 morph）。 */
function openFrames(from: bridge.PixelRect, to: bridge.PixelRect, rotate: number, opacity: number, settle: boolean): Keyframe[] {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const sx = to.width ? from.width / to.width : 1;
  const sy = to.height ? from.height / to.height : 1;
  const first: Keyframe = {
    transformOrigin: '0 0',
    transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotate(${rotate}deg)`,
    opacity,
  };
  return settle
    ? [
        first,
        { offset: 0.72, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 },
        { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
      ]
    : [first, { transformOrigin: '0 0', transform: 'none', opacity: 1 }];
}

/** 关闭：缩回卡片，或卡片看不见时原地提起淡出（原型 closeEntry）。 */
function closeFrames(from: bridge.PixelRect, to: bridge.PixelRect | null, dragged: boolean): { frames: Keyframe[]; options: KeyframeAnimationOptions } {
  const slow = duration('--sn-duration-slow');
  if (to && from.width && from.height) {
    const shrink = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width}, ${to.height / from.height})`;
    const frames: Keyframe[] = dragged
      ? [
          { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
          { offset: 0.28, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 },
          { offset: 0.85, transformOrigin: '0 0', transform: `${shrink} rotate(${DRAG_TILT}deg)`, opacity: 0.9 },
          { transformOrigin: '0 0', transform: `${shrink} rotate(0deg)`, opacity: 0 },
        ]
      : [
          { transformOrigin: '0 0', transform: 'none', opacity: 1 },
          { offset: 0.8, transformOrigin: '0 0', transform: shrink, opacity: 0.85 },
          { transformOrigin: '0 0', transform: shrink, opacity: 0 },
        ];
    return { frames, options: { duration: slow * (dragged ? 1.6 : 1.3), easing: easing('--sn-ease-standard'), fill: 'forwards' } };
  }
  const frames: Keyframe[] = dragged
    ? [
        { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
        { offset: 0.3, transformOrigin: '50% 50%', transform: 'scale(1.012)', opacity: 1 },
        { transformOrigin: '50% 50%', transform: `rotate(${DRAG_TILT}deg) scale(0.92)`, opacity: 0 },
      ]
    : [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.97)' },
      ];
  return {
    frames,
    options: { duration: dragged ? slow * 1.2 : duration('--sn-duration-fast'), easing: easing('--sn-ease-exit'), fill: 'forwards' },
  };
}

/** 动画层。 */
export function Overlay() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let ghost: HTMLElement | null = null;
    let grab: [number, number] = [0, 0];
    let indicator: HTMLElement | null = null;
    const copies = new Map<number, HTMLElement>();
    const ratio = (): number => window.devicePixelRatio || 1;

    const onGhost = (payload: GhostPayload): void => {
      if (payload.html !== undefined) {
        ghost?.remove();
        ghost = payload.html ? fromHtml(payload.html) : null;
        grab = payload.grab;
        if (ghost) {
          ghost.style.visibility = 'hidden';
          layer.append(ghost);
        }
      }
      if (!ghost) return;
      ghost.style.left = `${payload.x / ratio() - grab[0]}px`;
      ghost.style.top = `${payload.y / ratio() - grab[1]}px`;
      ghost.style.visibility = payload.visible ? '' : 'hidden';
      ghost.classList.toggle(ghost.classList.contains('note-window-tab-ghost') ? 'is-detaching' : 'is-window', payload.outside);
    };

    const onIndicator = (payload: { rect: bridge.PixelRect; horizontal: boolean } | null): void => {
      if (!payload) {
        indicator?.remove();
        return;
      }
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'note-window-tab-drop';
        indicator.setAttribute('aria-hidden', 'true');
      }
      const rect = toPage(payload.rect);
      indicator.classList.toggle('is-horizontal', payload.horizontal);
      indicator.style.left = `${rect.x}px`;
      indicator.style.top = `${rect.y}px`;
      indicator.style.width = payload.horizontal ? `${rect.width}px` : '';
      indicator.style.height = payload.horizontal ? '' : `${rect.height}px`;
      if (!indicator.isConnected) layer.append(indicator);
    };

    // 浮现（T130）：窗口已经隐身提到最前，副本在窗口的位置从下面一点淡入、上浮，结束后窗口现身。拖动还在进行，
    // 拖影不动。
    const onSurface = (payload: MorphPayload): void => {
      const node = fromHtml(payload.html);
      if (!node || reducedMotion() || typeof node.animate !== 'function') {
        void bridge.overlayDone(payload.id);
        return;
      }
      const place = toPage(payload.from);
      node.classList.add('is-overlay-copy');
      Object.assign(node.style, { left: `${place.x}px`, top: `${place.y}px`, width: `${place.width}px`, height: `${place.height}px` });
      layer.append(node);
      copies.set(payload.id, node);
      const rise = window.getComputedStyle(document.documentElement).getPropertyValue('--sn-space-3').trim() || '0px';
      const animation = node.animate([{ opacity: 0, transform: `translateY(${rise})` }, { opacity: 1, transform: 'none' }], {
        duration: SURFACE_FADE,
        easing: easing('--sn-ease-standard'),
        fill: 'forwards',
      });
      const done = (): void => void bridge.overlayDone(payload.id);
      animation.finished.then(done, done);
    };

    const onMorph = (payload: MorphPayload): void => {
      if (payload.mode === 'surface') {
        onSurface(payload);
        return;
      }
      // 窗口从拖影展开：拖影交给窗口的副本。
      ghost?.remove();
      ghost = null;
      const node = fromHtml(payload.html);
      if (!node || reducedMotion() || typeof node.animate !== 'function') {
        void bridge.overlayReady(payload.id);
        void bridge.overlayDone(payload.id);
        return;
      }
      const opening = payload.mode.startsWith('open');
      const dragged = payload.mode.endsWith('drag');
      const from = toPage(payload.from);
      const to = payload.to ? toPage(payload.to) : null;
      // 副本摆在窗口的位置：打开时是终点，关闭时是起点。
      const place = opening && to ? to : from;
      node.classList.add('is-overlay-copy');
      Object.assign(node.style, {
        left: `${place.x}px`,
        top: `${place.y}px`,
        width: `${place.width}px`,
        height: `${place.height}px`,
      });
      layer.append(node);
      copies.set(payload.id, node);
      const animation = opening
        ? node.animate(
            dragged ? openFrames(from, place, DRAG_TILT, 0.9, true) : openFrames(from, place, 0, 0.5, false),
            {
              duration: duration('--sn-duration-slow') * (dragged ? 1.6 : 1.3),
              easing: easing(dragged ? '--sn-ease-standard' : '--sn-ease-enter'),
              fill: 'forwards',
            },
          )
        : (() => {
            const { frames, options } = closeFrames(from, to, dragged);
            return node.animate(frames, options);
          })();
      // 第一帧画出之后：关闭时藏起真正的窗口，由副本代替。
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => void bridge.overlayReady(payload.id)));
      const done = (): void => {
        if (!opening) {
          node.remove();
          copies.delete(payload.id);
        }
        void bridge.overlayDone(payload.id);
      };
      animation.finished.then(done, done);
    };

    const onClear = (id: number): void => {
      copies.get(id)?.remove();
      copies.delete(id);
    };

    // 虚线框按顺序复用：拖动中每一步都会送来，不必每次重建；多出来的淡出后去掉（出现时淡入，见 window.css）。
    const boxes: HTMLElement[] = [];
    const onReveal = (rects: bridge.PixelRect[] | null): void => {
      const list = rects ?? [];
      list.forEach((rect, index) => {
        let box = boxes[index];
        if (!box) {
          box = document.createElement('div');
          box.className = 'overlay-reveal';
          layer.append(box);
          boxes[index] = box;
        }
        const page = toPage(rect);
        Object.assign(box.style, { left: `${page.x}px`, top: `${page.y}px`, width: `${page.width}px`, height: `${page.height}px` });
      });
      boxes.splice(list.length).forEach((box) => {
        if (reducedMotion() || typeof box.animate !== 'function') {
          box.remove();
          return;
        }
        const fade = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration('--sn-duration-fast'), easing: easing('--sn-ease-exit') });
        const done = (): void => box.remove();
        fade.finished.then(done, done);
      });
    };

    // 连接带：一块梯形，浮窗一边较浓、往卡片一边渐淡到没有（T122，方案 B：重点落在浮窗上），不描边。
    // 出现时从卡片那一边横向展开，收回时原路收拢后去掉（关闭是打开的倒放）。
    let connector: SVGSVGElement | null = null;
    let leaving: Animation | null = null;
    const beamFrames = (cardX: number): Keyframe[] => [
      { transformOrigin: `${cardX}px 50%`, transform: 'scaleX(0)', opacity: 0 },
      { transformOrigin: `${cardX}px 50%`, transform: 'none', opacity: 1 },
    ];
    const onConnector = (payload: ConnectorPayload | null): void => {
      if (!payload) {
        const node = connector;
        connector = null;
        if (!node) return;
        const cardX = Number(node.dataset.cardX) || 0;
        if (reducedMotion() || typeof node.animate !== 'function') {
          node.remove();
          return;
        }
        leaving = node.animate([...beamFrames(cardX)].reverse(), {
          duration: duration('--sn-duration-normal'),
          easing: easing('--sn-ease-exit'),
          fill: 'forwards',
        });
        const done = (): void => node.remove();
        leaving.finished.then(done, done);
        return;
      }
      const [cardX, cardTop, cardBottom] = payload.card.map((value) => value / ratio());
      const [panelX, panelTop, panelBottom] = payload.panel.map((value) => value / ratio());
      if (!connector) {
        // 正在收拢的旧连接带直接去掉，换成新的。
        leaving?.cancel();
        layer.querySelectorAll('.overlay-connector').forEach((node) => node.remove());
        connector = document.createElementNS(SVG, 'svg');
        connector.setAttribute('class', 'overlay-connector');
        const defs = document.createElementNS(SVG, 'defs');
        const gradient = document.createElementNS(SVG, 'linearGradient');
        gradient.setAttribute('id', BEAM_GRADIENT);
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        const near = document.createElementNS(SVG, 'stop');
        near.setAttribute('class', 'overlay-beam-near');
        near.setAttribute('offset', '0');
        const far = document.createElementNS(SVG, 'stop');
        far.setAttribute('class', 'overlay-beam-far');
        far.setAttribute('offset', '1');
        gradient.append(near, far);
        defs.append(gradient);
        const body = document.createElementNS(SVG, 'polygon');
        body.setAttribute('class', 'overlay-beam');
        body.setAttribute('fill', `url(#${BEAM_GRADIENT})`);
        connector.append(defs, body);
        layer.append(connector);
        if (!reducedMotion() && typeof connector.animate === 'function') {
          connector.animate(beamFrames(cardX), { duration: duration('--sn-duration-normal'), easing: easing('--sn-ease-enter') });
        }
      }
      connector.dataset.cardX = String(cardX);
      const gradient = connector.querySelector('linearGradient');
      gradient?.setAttribute('x1', `${cardX}`);
      gradient?.setAttribute('x2', `${panelX}`);
      const body = connector.querySelector('polygon');
      body?.setAttribute('points', `${cardX},${cardTop} ${panelX},${panelTop} ${panelX},${panelBottom} ${cardX},${cardBottom}`);
    };

    return bridge.subscribeAll([
      bridge.onWindowEvent<GhostPayload>(EVENTS.ghost, onGhost),
      bridge.onWindowEvent<{ rect: bridge.PixelRect; horizontal: boolean } | null>(EVENTS.indicator, onIndicator),
      bridge.onWindowEvent<MorphPayload>(EVENTS.morph, onMorph),
      bridge.onWindowEvent<number>(EVENTS.clear, onClear),
      bridge.onWindowEvent<ConnectorPayload | null>(EVENTS.connector, onConnector),
      bridge.onWindowEvent<bridge.PixelRect[] | null>(EVENTS.reveal, onReveal),
    ]);
  }, []);

  return (
    <>
      <IconSprite />
      <div ref={layerRef} className="overlay-layer" aria-hidden="true" />
    </>
  );
}
