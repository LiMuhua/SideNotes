/**
 * 多个元素共用一个 ResizeObserver：元素的大小变了，就调用它登记的回调。
 *
 * 侧栏一次挂着上百张卡片，每张各开一个观察器开销不小，共用一个（同 useEditHeight 的做法）。
 * 观察器在排版之后、绘制之前回调，回调里读到的是新的大小。没有 ResizeObserver 的环境（如 jsdom）里什么也不做。
 */

const callbacks = new WeakMap<Element, () => void>();
let observer: ResizeObserver | null = null;

/** 开始观察 `element`，大小变化时调用 `callback`（开始观察时也会先回调一次）。返回停止观察的函数。 */
export function watchResize(element: Element, callback: () => void): () => void {
  if (typeof ResizeObserver !== 'function') return () => {};
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) callbacks.get(entry.target)?.();
  });
  callbacks.set(element, callback);
  observer.observe(element);
  return () => {
    // 同一个元素换了新的回调（effect 重新执行）时，旧的停止函数不再动它。
    if (callbacks.get(element) !== callback) return;
    callbacks.delete(element);
    observer?.unobserve(element);
  };
}
