import { describe, expect, it, vi } from 'vitest';
import { subscribeAll } from './bridge';

/** 一个可以由测试决定何时完成的订阅。 */
function pending() {
  let resolve: (unlisten: () => void) => void = () => {};
  const promise = new Promise<() => void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('subscribeAll', () => {
  it('清理先于订阅建立完成时，迟到的订阅建立后立即取消（StrictMode 挂载、卸载再挂载）', async () => {
    const first = pending();
    const unlisten = vi.fn();
    const cleanup = subscribeAll([first.promise]);
    cleanup();
    first.resolve(unlisten);
    await first.promise;
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('订阅建立后清理时逐个取消，只取消一次', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const cleanup = subscribeAll([Promise.resolve(a), Promise.resolve(b)]);
    await Promise.resolve();
    await Promise.resolve();
    expect(a).not.toHaveBeenCalled();
    cleanup();
    cleanup();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('订阅失败时不影响其它订阅', async () => {
    const ok = vi.fn();
    const cleanup = subscribeAll([Promise.reject(new Error('失败')), Promise.resolve(ok)]);
    await Promise.resolve();
    await Promise.resolve();
    cleanup();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
