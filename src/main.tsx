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
import './styles/prototype.css';
import './styles/desktop.css';

/** 当前窗口承担的角色。 */
export type WindowRole = 'sidebar' | 'capture' | 'settings';

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
    return 'sidebar';
  } catch {
    return 'sidebar';
  }
}

const role = resolveRole();
// 供样式按窗口切换布局，避免在组件里判断窗口类型。
document.body.dataset.window = role;

const container = document.getElementById('root');
if (!container) throw new Error('缺少应用挂载点 #root');

createRoot(container).render(
  <StrictMode>
    <App role={role} />
  </StrictMode>,
);
