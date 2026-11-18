import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as bridge from '../core/bridge';

/** 弹窗发回的一种操作的处理：返回是否完成，弹窗据此关闭或留着。 */
export type DialogHandlers = Record<string, (data: never) => boolean | Promise<boolean>>;

interface ActiveDialog {
  id: number;
  handlers: DialogHandlers;
  onClosed: () => void;
}

/**
 * 打开者一侧的弹窗窗口（T99）：把内容交给弹窗窗口，收它发回的操作、交给对应的处理并回复结果，
 * 弹窗关闭（含被别处新开的弹窗替换）时通知调用方。同一时间只有一个弹窗。
 */
export function useDialogWindow(): {
  open: (kind: string, payload: unknown, handlers: DialogHandlers, onClosed: () => void) => Promise<number>;
  close: (id: number) => void;
} {
  const active = useRef<ActiveDialog | null>(null);

  useEffect(() => {
    const unsubscribe = bridge.subscribeAll([
      bridge.onWindowEvent<bridge.DialogResult>(bridge.DIALOG_EVENTS.result, (result) => {
        void (async () => {
          const current = active.current;
          let ok = false;
          if (current && current.id === result.id) {
            const handler = current.handlers[result.action] as ((data: unknown) => boolean | Promise<boolean>) | undefined;
            try {
              ok = handler ? Boolean(await handler(result.data)) : false;
            } catch (error) {
              console.error('弹窗的操作失败', error);
            }
          }
          const ack: bridge.DialogAck = { id: result.id, seq: result.seq, ok };
          void bridge.emitToWindow(bridge.DIALOG_LABEL, bridge.DIALOG_EVENTS.ack, ack);
        })();
      }),
      bridge.onWindowEvent<number>(bridge.DIALOG_EVENTS.closed, (id) => {
        const current = active.current;
        if (!current || current.id !== id) return;
        active.current = null;
        current.onClosed();
      }),
    ]);
    return unsubscribe;
  }, []);

  const open = useCallback(async (kind: string, payload: unknown, handlers: DialogHandlers, onClosed: () => void) => {
    const id = await bridge.openDialogWindow(kind, payload);
    active.current = { id, handlers, onClosed };
    return id;
  }, []);

  // 打开者这边先结束了（例如弹窗还开着时状态被清空）：弹窗还是这一个时关掉它。
  const close = useCallback((id: number) => {
    if (active.current?.id === id) active.current = null;
    void bridge.closeDialogWindow(id);
  }, []);

  // 返回的对象保持同一个引用：调用方的 effect 依赖它，每次渲染换一个会让弹窗反复重开。
  return useMemo(() => ({ open, close }), [open, close]);
}
