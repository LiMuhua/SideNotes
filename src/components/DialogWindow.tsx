/**
 * 弹窗窗口（T99）：合并成一条与附件弹窗在这个独立的窗口里显示，像原型一样盖在桌面上，而不是挤在侧栏里。
 *
 * - 内容由打开者（侧栏或速记浮窗）经后端送来（启动时取一次，之后用事件送达）。
 * - 画好后按弹窗自己的宽度与内容的高度量出尺寸，请后端在打开者所在屏幕居中显示并获得焦点；
 *   内容变高变矮（预览随格式变化、原文框加高）时再量一次，窗口跟着调整，中心不动。
 * - 合并、应用修改、更换与删除以事件发回打开者，由打开者写入（编辑中的卡片、撤销提示都在那边），
 *   等打开者回复是否完成；完成后弹窗照常关闭。Esc 与关闭按钮关闭弹窗，焦点回到打开者。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AttachmentDialog, type AttachmentSubject } from './AttachmentDialog';
import { IconSprite } from './Icon';
import { MergeDialog } from './MergeDialog';
import { ToastRegion } from './Modal';
import * as bridge from '../core/bridge';
import type { Note, NoteImage } from '../core/types';

/** 合并成一条：来源、合并到的已有卡片与按标签合并时的标签（与侧栏的 mergeRequest 相同）。 */
export interface MergePayload {
  notes: Note[];
  target: Note | null;
  tag?: string;
}

/** 附件弹窗：附件本身，以及打开者能不能改原文、能不能换图片附件。 */
export interface AttachmentPayload {
  subject: AttachmentSubject;
  canReplaceSource: boolean;
  canReplaceImage: boolean;
}

/** 等打开者回复一次操作的最长时间；超时按没有完成处理，弹窗留着。 */
const ACK_TIMEOUT = 15000;
/** 第一次量尺寸前最多等图片加载这么久（毫秒）：窗口还没显示，等一会儿看不出来。 */
const IMAGE_WAIT = 800;

/**
 * 屏幕的可用高度（页面像素）。原型里合并预览最高为页面高度的一半（50dvh），弹窗窗口的高度却跟着内容变，
 * 按窗口算会越量越矮，所以改按屏幕算（window.css 的 --screen-height）。
 * screen 的尺寸是窗口逻辑像素，不含界面缩放；无边框窗口的外高与内高之比就是界面缩放。
 */
function screenHeight(): number {
  const zoom = window.outerHeight > 0 && window.innerHeight > 0 ? window.outerHeight / window.innerHeight : 1;
  return Math.round(window.screen.availHeight / zoom);
}

/** 按弹窗自己的宽度与内容的高度量出尺寸（页面像素）。 */
function measure(): { width: number; height: number } | null {
  const modal = document.querySelector<HTMLElement>('.modal');
  if (!modal) return null;
  document.documentElement.style.setProperty('--screen-height', `${screenHeight()}px`);
  document.body.classList.add('is-measuring');
  const rect = modal.getBoundingClientRect();
  document.body.classList.remove('is-measuring');
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

/** 等弹窗里的图片加载好（最多 `timeout` 毫秒），量出的高度才包含预览图。 */
async function settleImages(timeout: number): Promise<void> {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('.modal img'));
  if (!images.length) return;
  await Promise.race([
    Promise.all(images.map((image) => image.decode().catch(() => undefined))),
    new Promise((resolve) => window.setTimeout(resolve, timeout)),
  ]);
}

export function DialogWindow() {
  const [request, setRequest] = useState<bridge.DialogRequest | null>(null);
  const requestRef = useRef<bridge.DialogRequest | null>(null);
  const seq = useRef(0);
  const waiters = useRef(new Map<number, (ok: boolean) => void>());
  const presented = useRef({ width: 0, height: 0 });

  useLayoutEffect(() => {
    requestRef.current = request;
  });

  // 打开请求：启动时取一次，之后用事件送达；打开者的回复按 seq 交给等着的操作。
  useEffect(() => {
    let alive = true;
    void bridge.dialogInit().then((pending) => {
      if (alive && pending) setRequest(pending);
    });
    const unsubscribe = bridge.subscribeAll([
      bridge.onWindowEvent<bridge.DialogRequest>(bridge.DIALOG_EVENTS.open, (next) => setRequest(next)),
      bridge.onWindowEvent<bridge.DialogAck>(bridge.DIALOG_EVENTS.ack, (ack) => {
        if (ack.id !== requestRef.current?.id) return;
        waiters.current.get(ack.seq)?.(ack.ok);
        waiters.current.delete(ack.seq);
      }),
      // 后端关闭了弹窗（Alt+F4、打开者撤回）：清空内容，等着的操作按没有完成处理。
      bridge.onWindowEvent<number>(bridge.DIALOG_EVENTS.closed, (id) => {
        if (id !== requestRef.current?.id) return;
        setRequest(null);
        waiters.current.forEach((resolve) => resolve(false));
        waiters.current.clear();
      }),
    ]);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // 新的请求：等图片加载后量尺寸，请后端居中显示；之后内容变化时重新量，窗口跟着调整。
  useEffect(() => {
    if (!request) return;
    let alive = true;
    presented.current = { width: 0, height: 0 };
    const present = (center: boolean): void => {
      const size = measure();
      if (!size || !alive) return;
      const last = presented.current;
      if (!center && Math.abs(size.width - last.width) < 2 && Math.abs(size.height - last.height) < 2) return;
      presented.current = size;
      void bridge.presentDialog(request.id, size.width, size.height, center);
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!presented.current.width) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => present(false));
    });
    void settleImages(IMAGE_WAIT).then(() => {
      if (!alive) return;
      present(true);
      document.querySelectorAll('.modal .modal-header, .modal .modal-body > *, .modal .modal-footer').forEach((node) => observer.observe(node));
    });
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [request]);

  const close = useCallback(() => {
    const id = requestRef.current?.id;
    setRequest(null);
    waiters.current.forEach((resolve) => resolve(false));
    waiters.current.clear();
    void bridge.closeDialogWindow(id);
  }, []);

  // Esc 关闭弹窗（附件弹窗自己处理 Esc，并且不再往外传）。
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, close]);

  /** 把一次操作发回打开者，等它回复是否完成。 */
  const send = useCallback((action: string, data: unknown): Promise<boolean> => {
    const current = requestRef.current;
    if (!current) return Promise.resolve(false);
    seq.current += 1;
    const id = seq.current;
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        waiters.current.delete(id);
        resolve(false);
      }, ACK_TIMEOUT);
      waiters.current.set(id, (ok) => {
        window.clearTimeout(timer);
        resolve(ok);
      });
      const result: bridge.DialogResult = { id: current.id, seq: id, action, data };
      void bridge.emitToWindow(current.opener, bridge.DIALOG_EVENTS.result, result);
    });
  }, []);

  // 图标定义挂在弹窗窗口的根上（关闭按钮、附件弹窗的按钮都用它）。
  if (!request) return <IconSprite />;
  if (request.kind === 'merge') {
    const payload = request.payload as MergePayload;
    return (
      <>
        <IconSprite />
        <MergeDialog
          key={request.id}
          notes={payload.notes}
          target={payload.target}
          tag={payload.tag}
          onConfirm={(text, images, keep) => send('merge', { text, images, keep })}
          onClose={close}
        />
        <ToastRegion className="dialog-toast-region" />
      </>
    );
  }
  if (request.kind === 'attachment') {
    const payload = request.payload as AttachmentPayload;
    return (
      <>
        <IconSprite />
        <AttachmentDialog
          key={request.id}
          subject={payload.subject}
          editable={payload.canReplaceSource || payload.canReplaceImage}
          onReplaceSource={payload.canReplaceSource ? (source) => send('replace-source', { source }) : undefined}
          onReplaceImage={payload.canReplaceImage ? (image: NoteImage | null) => send('replace-image', { image }) : undefined}
          onClose={close}
        />
        <ToastRegion className="dialog-toast-region" />
      </>
    );
  }
  return <IconSprite />;
}
