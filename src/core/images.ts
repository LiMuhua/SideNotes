/**
 * 图片的显示（T115，技术决策第 48 条）：附件文件夹里的大图显示缩小的副本，滚出视野闲置一段时间的图片释放内存。
 *
 * - 副本由后端生成（src-tauri 的 thumbnails.rs），两档：侧栏卡片一档，记录窗口与弹窗窗口一档（按窗口角色区分）。
 *   拿到之前先不设地址，免得先把原图加载一遍；拿到后连同尺寸一起设上，尺寸先占好位置。
 * - 闲置释放：图片离开视野（滚出列表、所在的卡片收起）RELEASE_AFTER 之后换成一张 1 像素的空白图，
 *   换之前按当时的大小固定住，列表不跳；回到视野附近（NEAR 之内）再换回来、解除固定。
 *   WebView 不会主动丢掉看不见的大图的解码数据，这里替它丢。
 */

import * as bridge from './bridge';
import { filePath, isLegacyToken } from './files';

/** 离开视野多久之后释放（毫秒）。 */
export const RELEASE_AFTER = 30_000;
/** 离视野这么近时就换回来，滚到眼前时已经加载好。 */
const NEAR = '400px';
/** 释放后的空白图。 */
export const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 显示用的地址与像素尺寸（不知道尺寸时为空）。 */
export interface ShownImage {
  url: string;
  width?: number;
  height?: number;
}

/** 副本的档位：记录窗口与弹窗窗口里大一档。 */
function currentTier(): 'card' | 'window' {
  const role = document.body.dataset.window;
  return role === 'note' || role === 'dialog' ? 'window' : 'card';
}

const resolved = new Map<string, Promise<ShownImage>>();
/** 已经拿到的地址：同一张图再次出现（编辑器重画、卡片重新渲染）时直接用，不空一下。 */
const ready = new Map<string, ShownImage>();

/** 不是本机附件、或在浏览器预览里时直接得出的地址；本机附件返回 null（要问后端）。 */
function direct(src: string): { shown: ShownImage } | { path: string } {
  const path = filePath(src);
  if (!path) return { shown: { url: src } };
  if (isLegacyToken(path)) return { shown: { url: '' } };
  if (!bridge.isDesktop()) return { shown: { url: bridge.localFileUrl(path) } };
  return { path };
}

/** 已经知道的显示地址（同步），还没问过后端时为 undefined。 */
export function peekImage(src: string): ShownImage | undefined {
  const known = direct(src);
  return 'shown' in known ? known.shown : ready.get(`${currentTier()}|${known.path}`);
}

/**
 * 图片的显示地址：本机附件的大图换成副本（同一张图只问后端一次）；网络图片、data 图片与浏览器预览原样，
 * 原型遗留的浏览器文件标识没有可用的地址（空）。
 */
export function resolveImage(src: string): Promise<ShownImage> {
  const known = direct(src);
  if ('shown' in known) return Promise.resolve(known.shown);
  const { path } = known;
  const tier = currentTier();
  const key = `${tier}|${path}`;
  let found = resolved.get(key);
  if (!found) {
    found = bridge
      .displayImage(path, tier)
      .then((image): ShownImage =>
        image ? { url: bridge.localFileUrl(image.path), width: image.width, height: image.height } : { url: bridge.localFileUrl(path) },
      )
      .catch((): ShownImage => ({ url: bridge.localFileUrl(path) }))
      .then((shown) => {
        ready.set(key, shown);
        return shown;
      });
    resolved.set(key, found);
  }
  return found;
}

/* ==================== 闲置释放 ==================== */

/** 每张图片该显示的地址（释放后换回来用）。 */
const sources = new WeakMap<HTMLImageElement, string>();
const timers = new WeakMap<HTMLImageElement, number>();
let observer: IntersectionObserver | null = null;

function release(image: HTMLImageElement): void {
  timers.delete(image);
  if (!image.isConnected || image.getAttribute('src') === BLANK_IMAGE) return;
  const box = image.getBoundingClientRect();
  // 收起的卡片里图片没有大小：不用固定，展开时按原图重新排。
  if (box.width && box.height) {
    image.style.width = `${box.width}px`;
    image.style.height = `${box.height}px`;
  }
  image.dataset.released = '';
  image.src = BLANK_IMAGE;
}

function restore(image: HTMLImageElement): void {
  const timer = timers.get(image);
  if (timer) window.clearTimeout(timer);
  timers.delete(image);
  const source = sources.get(image);
  if (image.dataset.released === undefined || !source) return;
  delete image.dataset.released;
  image.src = source;
  image.style.width = '';
  image.style.height = '';
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const image = entry.target as HTMLImageElement;
    if (entry.isIntersecting) restore(image);
    else if (!timers.has(image)) timers.set(image, window.setTimeout(() => release(image), RELEASE_AFTER));
  }
}

/**
 * 盯住一张图片：离开视野闲置 RELEASE_AFTER 后释放，回到视野附近再加载。`source` 为它该显示的地址。
 * 返回取消函数（元素移除时调用）。没有 IntersectionObserver 的环境（测试）什么也不做。
 */
export function watchImage(image: HTMLImageElement, source: string): () => void {
  if (typeof IntersectionObserver !== 'function' || !source) return () => undefined;
  sources.set(image, source);
  observer ??= new IntersectionObserver(onIntersect, { rootMargin: NEAR });
  observer.observe(image);
  return () => {
    observer?.unobserve(image);
    const timer = timers.get(image);
    if (timer) window.clearTimeout(timer);
    timers.delete(image);
    sources.delete(image);
  };
}

/**
 * 给页面脚本自己创建的图片（编辑器里的图片）设地址：等副本地址出来再设上，并盯住它闲置释放。
 * 图片已经换成别的地址（编辑器重画）时不再改它。
 */
export function showImage(image: HTMLImageElement, src: string): void {
  const apply = (shown: ShownImage): void => {
    delete image.dataset.imagePending;
    if (shown.width && shown.height) {
      image.width = shown.width;
      image.height = shown.height;
    }
    image.src = shown.url;
    if (shown.url) watchImage(image, shown.url);
    image.dispatchEvent(new CustomEvent('sidenotes:image-ready', { bubbles: true }));
  };
  const known = peekImage(src);
  if (known) {
    apply(known);
    return;
  }
  image.dataset.imagePending = '';
  void resolveImage(src).then(apply);
}
