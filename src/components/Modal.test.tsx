import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, ToastRegion } from './Modal';
import { ToastProvider, useToast, type ShowToast } from '../hooks/useToast';

// 告诉 React 当前在测试环境中，状态更新需包在 act 内完成。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('确认对话框', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** 渲染对话框并返回确认按钮。 */
  function render(onConfirm: () => Promise<boolean>, onCancel: () => void): HTMLButtonElement {
    act(() => {
      root.render(
        <ConfirmDialog title="标题" description="说明" confirmLabel="确认" onConfirm={onConfirm} onCancel={onCancel} />,
      );
    });
    const confirm = container.querySelector<HTMLButtonElement>('.modal-footer .button.danger');
    if (!confirm) throw new Error('缺少确认按钮');
    return confirm;
  }

  it('操作完成后关闭', async () => {
    const onCancel = vi.fn();
    const confirm = render(async () => true, onCancel);
    await act(async () => confirm.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('操作返回 false 时保持打开，并允许再次确认', async () => {
    const onConfirm = vi.fn(async () => false);
    const onCancel = vi.fn();
    const confirm = render(onConfirm, onCancel);
    await act(async () => confirm.click());
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('操作进行中忽略重复点击', async () => {
    let finish: (value: boolean) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const onCancel = vi.fn();
    const confirm = render(onConfirm, onCancel);
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => finish(true));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('提示条', () => {
  let container: HTMLDivElement;
  let root: Root;
  let show: ShowToast = () => {};

  /** 取出 show 的探针组件。 */
  function Probe() {
    show = useToast();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <ToastProvider>
          <Probe />
          <ToastRegion className="capture-toast-region" />
        </ToastProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const texts = (): string[] => Array.from(container.querySelectorAll('.toast > span')).map((node) => node.textContent ?? '');

  it('同一个 key 只留最新的一条，最多同时三条', () => {
    act(() => {
      show('已收起 3 张卡片', null, false, 'collapse-all');
      show('已展开 3 张卡片', null, false, 'collapse-all');
      show('已复制');
    });
    expect(texts()).toEqual(['已展开 3 张卡片', '已复制']);
    act(() => {
      show('一');
      show('二');
    });
    expect(texts()).toEqual(['已复制', '一', '二']);
    expect(container.querySelector('.toast-region')?.className).toBe('toast-region capture-toast-region');
  });

  it('可以带几个操作，点了操作后执行并关闭', () => {
    const view = vi.fn();
    const restore = vi.fn();
    act(() => show('已记在「随记」', [{ label: '查看', run: view }, { label: '放回「开发」', run: restore }]));
    const actions = Array.from(container.querySelectorAll<HTMLButtonElement>('.toast-action'));
    expect(actions.map((node) => node.textContent)).toEqual(['查看', '放回「开发」']);
    act(() => actions[1].click());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(view).not.toHaveBeenCalled();
    expect(texts()).toEqual([]);
  });

  it('6 秒后消失，带操作的 9 秒；指针停留时暂停计时', () => {
    act(() => show('普通'));
    act(() => show('可撤销', { label: '撤销', run: () => {} }));
    act(() => vi.advanceTimersByTime(6100));
    expect(texts()).toEqual(['可撤销']);
    const toast = container.querySelector('.toast');
    act(() => toast?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => vi.advanceTimersByTime(10_000));
    expect(texts()).toEqual(['可撤销']);
    act(() => toast?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
    act(() => vi.advanceTimersByTime(3500));
    expect(texts()).toEqual([]);
  });

  it('出错的提示不自动消失，点关闭才收起', () => {
    act(() => show('没能断开', null, true));
    act(() => show('读取失败', { label: '重试', run: () => {} }, true));
    act(() => vi.advanceTimersByTime(60_000));
    expect(texts()).toEqual(['没能断开', '读取失败']);
    act(() => container.querySelector<HTMLButtonElement>('.toast [aria-label="关闭提示"]')?.click());
    expect(texts()).toEqual(['读取失败']);
  });
});
