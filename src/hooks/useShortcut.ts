/**
 * 命令当前的快捷键，用于按钮提示、占位文字等写有按键的地方。
 */

import { bindingOf, type ShortcutId } from '../core/shortcuts';
import { useStoreSlice } from './useStore';

/** 命令当前的按键（规范写法，如 Ctrl+Enter）；在设置中更换后随之更新。 */
export function useShortcut(id: ShortcutId): string {
  return useStoreSlice((state) => bindingOf(state.settings.shortcuts, id));
}
