import { afterEach, describe, expect, it, vi } from 'vitest';

/** 假的 ResizeObserver：记下建了几个、观察着哪些元素，测试里手动报告大小变化。 */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly report: (entries: { target: Element }[]) => void) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /** 报告这些元素的大小变了（只报还在观察的）。 */
  resize(...elements: Element[]): void {
    this.report(elements.filter((element) => this.observed.has(element)).map((target) => ({ target })));
  }
}

/** 每个测试重新载入模块：模块里的观察器是共用的，要从头建。 */
async function load(): Promise<typeof import('./resizeWatch')> {
  vi.resetModules();
  FakeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeObserver);
  return import('./resizeWatch');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watchResize', () => {
  it('所有元素共用一个观察器，大小变了只调用那个元素的回调', async () => {
    const { watchResize } = await load();
    const first = document.createElement('div');
    const second = document.createElement('div');
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    watchResize(first, onFirst);
    watchResize(second, onSecond);
    expect(FakeObserver.instances).toHaveLength(1);
    FakeObserver.instances[0].resize(second);
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledTimes(1);
  });

  it('停止观察之后不再回调；同一个元素换了新的回调时，旧的停止函数不影响新的', async () => {
    const { watchResize } = await load();
    const element = document.createElement('div');
    const old = vi.fn();
    const fresh = vi.fn();
    const stopOld = watchResize(element, old);
    stopOld();
    FakeObserver.instances[0].resize(element);
    expect(old).not.toHaveBeenCalled();

    const stopFresh = watchResize(element, fresh);
    stopOld();
    FakeObserver.instances[0].resize(element);
    expect(fresh).toHaveBeenCalledTimes(1);
    stopFresh();
    FakeObserver.instances[0].resize(element);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('没有 ResizeObserver 时什么也不做', async () => {
    vi.resetModules();
    vi.stubGlobal('ResizeObserver', undefined);
    const { watchResize } = await import('./resizeWatch');
    const callback = vi.fn();
    const stop = watchResize(document.createElement('div'), callback);
    expect(() => stop()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});
