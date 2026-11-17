/**
 * 应用图标（T85）：上传的图片在各窗口中的显示地址。
 *
 * 上传的图片只有一份，保存在系统应用数据目录（见 src-tauri/src/app_icon.rs），经本地文件协议显示。
 * 地址在模块级缓存，第一次使用时读取；任一窗口上传或移除后，后端广播 APP_ICON_CHANGED，各窗口重新读取。
 */

import { useSyncExternalStore } from 'react';
import { appIconSource } from '../core/appIcons';
import * as bridge from '../core/bridge';

/** 上传的图片的状态。 */
export interface CustomIconState {
  /** 已经读取过一次：在此之前不更换窗口与托盘的图标，免得先换成默认图标再换回来。 */
  loaded: boolean;
  /** PNG 的完整路径，没有时为空字符串。 */
  path: string;
  /** 显示地址（带修改时间，换了图片不读缓存），没有时为空字符串。 */
  url: string;
}

let current: CustomIconState = { loaded: false, path: '', url: '' };
const listeners = new Set<() => void>();
let started = false;

function publish(next: CustomIconState): void {
  current = next;
  listeners.forEach((listener) => listener());
}

/** 重新读取上传的图片。 */
export async function refreshCustomAppIcon(): Promise<void> {
  try {
    const icon = await bridge.customAppIcon();
    publish(
      icon
        ? { loaded: true, path: icon.path, url: `${bridge.localFileUrl(icon.path)}?v=${icon.modified}` }
        : { loaded: true, path: '', url: '' },
    );
  } catch {
    publish({ loaded: true, path: '', url: '' });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!started) {
    // 订阅跟随窗口的整个生命周期，不随组件卸载取消。
    started = true;
    void refreshCustomAppIcon();
    void bridge.onAppIconChanged(() => void refreshCustomAppIcon());
  }
  return () => listeners.delete(listener);
}

const snapshot = (): CustomIconState => current;

/** 上传的图片。 */
export function useCustomAppIcon(): CustomIconState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 品牌标记显示的图片：设置中的应用图标，选了自定义图标但图片不在时为默认图标。 */
export function useAppIconSource(appIcon: string): string {
  return appIconSource(appIcon, useCustomAppIcon().url);
}
