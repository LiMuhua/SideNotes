/**
 * 附件图片（T115）：显示缩小的副本（core/images 的 resolveImage），滚出视野闲置一段时间后释放内存。
 *
 * 地址出来之前不设 src（不先加载原图），拿到后连同尺寸一起设上，尺寸先占好位置；地址出来后在元素上发出
 * sidenotes:image-ready（冒泡），记录窗口据此按内容重新定大小。
 */

import { useEffect, useRef, useState } from 'react';
import { peekImage, resolveImage, watchImage, type ShownImage } from '../core/images';

export function AttachmentImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // 已经问过的图片直接显示，不空一下（卡片重新渲染、窗口切换标签页时）；没问过的等后端给出地址。
  const [fetched, setFetched] = useState<{ src: string; shown: ShownImage } | null>(null);
  const shown = peekImage(src) ?? (fetched?.src === src ? fetched.shown : null);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (peekImage(src)) return;
    let alive = true;
    void resolveImage(src).then((next) => {
      if (alive) setFetched({ src, shown: next });
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // 只跟着地址变：没有副本的图片每次渲染都会得出一个新的对象，按对象比较会每次都重新通知、重新盯住。
  const url = shown?.url ?? '';
  useEffect(() => {
    const image = ref.current;
    if (!image || !url) return;
    image.dispatchEvent(new CustomEvent('sidenotes:image-ready', { bubbles: true }));
    return watchImage(image, url);
  }, [url]);

  return (
    <img
      ref={ref}
      className={className}
      src={shown?.url || undefined}
      width={shown?.width}
      height={shown?.height}
      alt={alt}
      loading="lazy"
      draggable={false}
      data-image-pending={shown ? undefined : ''}
    />
  );
}
