import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bridge from '../../core/bridge';
import { normalizeSettings } from '../../core/settings';
import type { Settings } from '../../core/types';
import { ShortcutsPanel } from './ShortcutsPanel';

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => toast }));
// 测试环境没有后端：不由后端录入，全局快捷键的注册结果由各用例指定。
vi.mock('../../core/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/bridge')>()),
  recordShortcut: vi.fn(async () => null),
  setGlobalShortcuts: vi.fn(async () => {}),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('快捷键设置', () => {
  let container: HTMLDivElement;
  let root: Root;
  let save: ReturnType<typeof vi.fn<(patch: Partial<Settings>) => Promise<boolean>>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    save = vi.fn(async () => true);
    toast.mockClear();
    vi.mocked(bridge.setGlobalShortcuts).mockReset();
    act(() => {
      root.render(<ShortcutsPanel settings={normalizeSettings({})} save={save} conflicts={[]} onConflictsChange={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function keyOf(label: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(`.shortcut-key[aria-label*="「${label}」"]`);
    if (!button) throw new Error(`缺少「${label}」的按键`);
    return button;
  }

  /** 点击按键开始录入。 */
  async function record(label: string): Promise<HTMLButtonElement> {
    const button = keyOf(label);
    button.focus();
    await act(async () => button.click());
    return button;
  }

  async function press(init: KeyboardEventInit): Promise<void> {
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    });
  }

  it('冲突时说明原因并保持录入，换一个组合后保存', async () => {
    const bold = await record('加粗');
    await press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(bold.textContent).toBe('Ctrl + …');
    await press({ key: 'i', code: 'KeyI', ctrlKey: true });
    expect(toast).toHaveBeenLastCalledWith('Ctrl + I：与「斜体」冲突', null, true);
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    await press({ key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(save).toHaveBeenCalledWith({ shortcuts: { bold: 'Ctrl+Shift+B' } });
    expect(toast).toHaveBeenLastCalledWith('「加粗」改为 Ctrl + Shift + B');
    expect(bold.getAttribute('aria-pressed')).toBe('false');
  });

  it('Esc 取消录入，按键不变', async () => {
    const italic = await record('斜体');
    await press({ key: 'Escape', code: 'Escape' });
    expect(italic.getAttribute('aria-pressed')).toBe('false');
    expect(italic.textContent).toBe('Ctrl + I');
    expect(save).not.toHaveBeenCalled();
  });

  it('全局快捷键先由后端注册，被其他程序占用时不保存', async () => {
    vi.mocked(bridge.setGlobalShortcuts).mockRejectedValueOnce(new Error('已被其他程序占用，请换一个'));
    const capture = await record('呼出速记');
    await press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    expect(bridge.setGlobalShortcuts).toHaveBeenLastCalledWith({ capture: 'Ctrl+Alt+N' });
    expect(toast).toHaveBeenLastCalledWith('Ctrl + Alt + N：已被其他程序占用，请换一个', null, true);
    expect(save).not.toHaveBeenCalled();
    expect(capture.getAttribute('aria-pressed')).toBe('true');
    await press({ key: 'm', code: 'KeyM', ctrlKey: true, altKey: true });
    expect(bridge.setGlobalShortcuts).toHaveBeenLastCalledWith({ capture: 'Ctrl+Alt+M' });
    expect(save).toHaveBeenCalledWith({ shortcuts: { capture: 'Ctrl+Alt+M' } });
    expect(capture.getAttribute('aria-pressed')).toBe('false');
  });
});
