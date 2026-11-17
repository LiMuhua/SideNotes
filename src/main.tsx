/**
 * 应用入口。
 *
 * 侧栏与速记浮窗是两个独立窗口，但共用同一份前端代码与状态仓库：
 * 按窗口标签决定渲染哪个界面，草稿与记录通过同一数据库保持同步。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { App } from './App';
import { isDesktop } from './core/bridge';
// 样式的层次：内置字体 → 设计令牌（直接引用 docs/design-system/tokens/，与原型、Playground 共用一份）
// → 旧样式层 legacy（prototype.css、desktop.css）→ 原型第二版的 theme.css → 桌面窗口适配 window.css。
import './styles/fonts.css';
import '../docs/design-system/tokens/base.css';
import '../docs/design-system/tokens/terminal.css';
import '../docs/design-system/tokens/magazine.css';
import '../docs/design-system/tokens/paper.css';
import '../docs/design-system/tokens/win11.css';
import '../docs/design-system/tokens/glass.css';
import './styles/prototype.css';
import './styles/desktop.css';
import './styles/theme.css';
import './styles/window.css';

/** 当前窗口承担的角色：记录窗口（标签 note-1、note-2…）与动画层见 T83。 */
export type WindowRole = 'sidebar' | 'capture' | 'settings' | 'note' | 'overlay';

/** 读取窗口角色；浏览器预览可用 `?window=capture|settings` 指定，默认显示侧栏。 */
function resolveRole(): WindowRole {
  if (!isDesktop()) {
    const requested = new URLSearchParams(window.location.search).get('window');
    return requested === 'capture' || requested === 'settings' ? requested : 'sidebar';
  }
  try {
    const label = getCurrentWindow().label;
    if (label === 'capture') return 'capture';
    if (label === 'settings') return 'settings';
    if (label === 'overlay') return 'overlay';
    if (label.startsWith('note-')) return 'note';
    return 'sidebar';
  } catch {
    return 'sidebar';
  }
}

const role = resolveRole();
// 供样式按窗口切换布局，避免在组件里判断窗口类型。
document.body.dataset.window = role;

// 桌面端不弹出浏览器的右键菜单（后退、刷新、另存为等对本应用没有意义）。
// 卡片右键由侧栏换成记录菜单；输入框、编辑区与选中的文字保留系统菜单，便于剪切、复制、粘贴。
// 浏览器预览仍保留原生菜单，方便检查元素。
if (isDesktop()) {
  document.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('缺少应用挂载点 #root');

createRoot(container).render(
  <StrictMode>
    <App role={role} />
  </StrictMode>,
);
