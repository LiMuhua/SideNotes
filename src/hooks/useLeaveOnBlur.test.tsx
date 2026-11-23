import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../core/bridge';
import { POPUP_GRACE, POPUP_RETURN, useLeaveOnBlur } from './useLeaveOnBlur';

// 后端认出的小窗：开着没有由用例指定，开着、关掉的事件由用例发出。
let emit: (open: boolean) => void = () => {};
vi.mock('../core/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/bridge')>()),
  externalPopupOpen: vi.fn(async () => false),
  onExternalPopup: vi.fn(async (handler: (open: boolean) => void) => {
    emit = handler;
    return () => {};
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('窗口失焦后判断是不是离开了', () => {
  let container: HTMLDivElement;
  let root: Root;
  let focused = false;
  const onLeave = vi.fn();

  function Probe() {
    useLeaveOnBlur(onLeave);
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    onLeave.mockClear();
    vi.mocked(bridge.externalPopupOpen).mockResolvedValue(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 窗口失焦（焦点去了别处）。 */
  const blur = (): void => {
    focused = false;
    window.dispatchEvent(new Event('blur'));
  };
  const wait = async (ms: number): Promise<void> => {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  };

  it('点到别处：稍等一会儿后离开', async () => {
    blur();
    await wait(POPUP_GRACE - 10);
    expect(onLeave).not.toHaveBeenCalled();
    await wait(20);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('焦点很快又回来了：不算离开', async () => {
    blur();
    focused = true;
    window.dispatchEvent(new Event('focus'));
    await wait(POPUP_GRACE * 2);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('别的程序从这里唤出小窗：不算离开；小窗关掉、焦点回来后也不算', async () => {
    vi.mocked(bridge.externalPopupOpen).mockResolvedValue(true);
    blur();
    await wait(POPUP_GRACE * 4);
    expect(onLeave).not.toHaveBeenCalled();
    // Ditto 先藏起小窗，再把前台交回来粘贴。
    act(() => emit(false));
    focused = true;
    await wait(POPUP_RETURN * 2);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('小窗关掉后焦点去了别处：离开', async () => {
    blur();
    act(() => emit(true));
    await wait(POPUP_GRACE * 4);
    expect(onLeave).not.toHaveBeenCalled();
    act(() => emit(false));
    await wait(POPUP_RETURN - 10);
    expect(onLeave).not.toHaveBeenCalled();
    await wait(20);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
