import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './Modal';

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
