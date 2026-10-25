/**
 * 状态仓库的 React 接入。
 *
 * 用 `useSyncExternalStore` 订阅模块级仓库：组件只在所关心的切片变化时重渲染，
 * 避免输入时整棵树刷新。
 */

import { useSyncExternalStore } from 'react';
import { getState, subscribe, type StoreState } from '../core/store';

/** 订阅整个仓库状态。 */
export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** 订阅仓库中的一个切片。`selector` 必须返回稳定引用或原始值。 */
export function useStoreSlice<T>(selector: (state: StoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  );
}
