/**
 * 预览区与等比缩放。
 *
 * 选定固定视口（如 1920 × 1080）时，窗口按真实尺寸布局，再整体缩小到可用空间之内；
 * 应用窗口用 offsetWidth 判断尺寸分级，浮层定位也换算了缩放比例，所以缩放不影响布局结论。
 */

import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Viewport } from './state';

/** 观察元素的内容尺寸；元素换成另一个时重新观察，初次测量也来自 ResizeObserver 的回调。 */
function useContentSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}

/** 把固定尺寸的内容缩放到容器宽度（以及可选的高度）之内，最大不放大。 */
export function Scaled({ width, height, fitHeight = false, children }: { width: number; height: number; fitHeight?: boolean; children: ReactNode }) {
  const [ref, available] = useContentSize<HTMLDivElement>();
  const byWidth = available.width ? available.width / width : 1;
  const byHeight = fitHeight && available.height ? available.height / height : 1;
  const scale = Math.min(1, byWidth, byHeight);
  return (
    <div ref={ref} className="pg-scaled">
      <div className="pg-scaled-box" style={{ width: width * scale, height: height * scale }}>
        <div className="pg-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** 预览区：适应窗口时内容填满；固定视口时居中显示并标出实际尺寸与缩放比例。 */
export function Stage({ viewport, bare, children }: { viewport: Viewport; bare: boolean; children: ReactNode }) {
  const [ref, available] = useContentSize<HTMLDivElement>();
  if (!viewport.width || !viewport.height) {
    return (
      <div className="pg-stage is-fit" ref={ref}>
        <div className="pg-stage-fill">{children}</div>
      </div>
    );
  }
  // 截图模式按真实尺寸显示，不缩放。
  const scale = bare ? 1 : Math.min(1, available.width / viewport.width || 1, (available.height - 28) / viewport.height || 1);
  return (
    <div className="pg-stage" ref={ref}>
      <div className="pg-viewport" style={{ width: viewport.width * scale, height: viewport.height * scale }}>
        <div className="pg-viewport-inner" style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
      {bare ? null : (
        <p className="pg-viewport-label">
          {viewport.label} · 显示比例 {Math.round(scale * 100)}%
        </p>
      )}
    </div>
  );
}
