/**
 * 窗口现在的材质（根节点的 data-sn-window，App.tsx 按主题写入）：acrylic、opaque 由系统画外框（小圆角、细边框与投影），
 * clear 由页面自己画。记录窗口按它决定系统边框的颜色，并在副本上标出外框由谁画（第八轮反馈 2）。
 *
 * 读根节点而不是按主题自己算：磨砂玻璃的记录窗口要等实时模糊打开成功才是 clear，失败时退回亚克力。
 */

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sn-window'] });
  return () => observer.disconnect();
}

function read(): string | undefined {
  return document.documentElement.dataset.snWindow;
}

/** 窗口的材质；App 还没写入时为 undefined。 */
export function useWindowMaterial(): string | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
