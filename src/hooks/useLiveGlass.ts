/**
 * 磨砂玻璃的实时模糊（T118）：侧栏每一帧看一下各块的位置，变了才告诉后端（glass_live.rs），
 * 后端在侧栏窗口的合成树里给每一块摆一个用系统实时模糊填充的圆角矩形，页面上各块半透明的底色盖在上面。
 *
 * 各块：标题区与页签行（玻璃主题里是同一块，合成一个矩形）、筛选行、整理提醒、同步提示、新建卡片、底栏，
 * 以及列表里的记录卡片（连同列表的可见范围，后端按它裁掉滚出列表的部分）。坐标换算成物理像素。
 */

import { useEffect } from 'react';
import * as bridge from '../core/bridge';

/** 列表之外、各自成块的元素（与 window.css 中磨砂玻璃的各块相同）。 */
const BLOCKS = ['.sidebar > .list-topline', '.sidebar > .workspace-nudge', '.sidebar > .sync-warning', '.sidebar > #quick-composer', '.sidebar > .sidebar-footer'];

function block(rect: DOMRect, radius: number, ratio: number): bridge.GlassBlock {
  return {
    x: Math.round(rect.left * ratio),
    y: Math.round(rect.top * ratio),
    width: Math.round(rect.width * ratio),
    height: Math.round(rect.height * ratio),
    radius: Math.round(radius * ratio * 10) / 10,
  };
}

function radiusOf(element: Element): number {
  return parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
}

/** 量出各块现在的位置；侧栏还没渲染出来时为 null。 */
export function measureGlass(): bridge.GlassLayout | null {
  const ratio = window.devicePixelRatio || 1;
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return null;
  const blocks: bridge.GlassBlock[] = [];
  const header = sidebar.querySelector(':scope > .sidebar-header');
  const navigation = sidebar.querySelector(':scope > .sidebar-navigation');
  if (header) {
    const top = header.getBoundingClientRect();
    const bottom = (navigation ?? header).getBoundingClientRect();
    blocks.push(block(new DOMRect(top.left, top.top, top.width, bottom.bottom - top.top), radiusOf(header), ratio));
  }
  BLOCKS.forEach((selector) => {
    const element = document.querySelector(selector);
    const rect = element?.getBoundingClientRect();
    if (element && rect && rect.width > 0 && rect.height > 0) blocks.push(block(rect, radiusOf(element), ratio));
  });
  const list = sidebar.querySelector<HTMLElement>(':scope > .note-list');
  const bounds = list?.getBoundingClientRect();
  const cards: bridge.GlassBlock[] = [];
  if (list && bounds) {
    list.querySelectorAll<HTMLElement>('.note-card').forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom) cards.push(block(rect, radiusOf(card), ratio));
    });
  }
  return { blocks, cards, viewport: bounds ? block(bounds, 0, ratio) : null };
}

/**
 * 磨砂玻璃的记录窗口（第八轮反馈 2）：整个窗口就是一块，按记录窗口外框的圆角模糊。窗口隐藏时也照常报告，
 * 显示出来时模糊已经摆好。
 */
export function measureWindowGlass(): bridge.GlassLayout | null {
  const ratio = window.devicePixelRatio || 1;
  const panel = document.querySelector('.note-window');
  const rect = panel?.getBoundingClientRect();
  if (!panel || !rect || rect.width <= 0 || rect.height <= 0) return null;
  return { blocks: [block(rect, radiusOf(panel), ratio)], cards: [], viewport: null };
}

/** 打开实时模糊后（`enabled`）每一帧量一次（默认量侧栏的各块），变了才报告。 */
export function useLiveGlass(enabled: boolean, measure: () => bridge.GlassLayout | null = measureGlass): void {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let last = '';
    const tick = (): void => {
      frame = window.requestAnimationFrame(tick);
      const layout = measure();
      if (!layout) return;
      const key = JSON.stringify(layout);
      if (key === last) return;
      last = key;
      void bridge.glassBlocks(layout);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, measure]);
}
