import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * 总是指向最近一次渲染传入的值。
 *
 * 长期挂着的文档监听器用它取回调，回调变了也不重新订阅。重新订阅会丢事件：前面的捕获监听器
 * （例如卡片的按下处理）改了状态时，浏览器在两个监听器之间执行微任务，React 随即重新渲染；
 * 依赖回调的 effect 这时换掉监听器，正在派发的这次按下送不到新的监听器，点到别处菜单也不关。
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
