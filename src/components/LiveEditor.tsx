/**
 * 实时 Markdown 编辑面的 React 封装。
 *
 * 编辑器实例由 `core/editor` 管理 DOM，组件只负责挂载、同步外部原文与销毁；
 * 原文变化通过 `onChange` 上报，避免受控输入在每次按键时重建 DOM。
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { MarkdownEditor } from '../core/editor';
import * as store from '../core/store';

export interface LiveEditorProps {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number;
  maxHeight?: number;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onPreviewImage?: (src: string, alt: string) => void;
  onBlur?: () => void;
  /** 实例就绪回调，供外部插入附件或移动光标。 */
  onReady?: (editor: MarkdownEditor) => void;
  /** 标签联想候选，默认取全部记录中的标签；传 null 关闭联想。 */
  tagSuggestions?: ((prefix: string, text: string) => string[]) | null;
}

/** 可编辑的实时 Markdown 面板。 */
export function LiveEditor({
  value,
  placeholder,
  ariaLabel,
  minHeight,
  maxHeight,
  autoFocus,
  onChange,
  onPreviewImage,
  onBlur,
  onReady,
  tagSuggestions = store.tagSuggestions,
}: LiveEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MarkdownEditor | null>(null);
  // 回调放在 ref 中，使编辑器实例不随回调身份变化而重建。
  const callbacks = useRef({ onChange, onPreviewImage, onBlur, onReady, tagSuggestions });
  // 在 layout effect 中同步回调，避免在渲染阶段直接写 ref。
  useLayoutEffect(() => {
    callbacks.current = { onChange, onPreviewImage, onBlur, onReady, tagSuggestions };
  });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const instance = new MarkdownEditor(container, {
      value,
      placeholder,
      ariaLabel,
      minHeight,
      maxHeight,
      onChange: (next) => callbacks.current.onChange(next),
      onPreviewImage: (src, alt) => callbacks.current.onPreviewImage?.(src, alt),
      tagSuggestions: (prefix, text) => callbacks.current.tagSuggestions?.(prefix, text) ?? [],
    });
    editor.current = instance;
    callbacks.current.onReady?.(instance);

    const handleBlur = (): void => callbacks.current.onBlur?.();
    instance.element.addEventListener('blur', handleBlur);
    if (autoFocus) instance.focus({ preventScroll: true });

    return () => {
      instance.element.removeEventListener('blur', handleBlur);
      instance.destroy();
      editor.current = null;
    };
    // 仅在挂载时创建实例；原文与高度通过下方副作用同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部原文变化时同步到编辑器（例如保存后清空草稿、拖入内容）。
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
  }, [value]);

  // 字号或窗口尺寸变化时更新高度上限。
  useEffect(() => {
    if (editor.current && typeof maxHeight === 'number') editor.current.setMaxHeight(maxHeight);
  }, [maxHeight]);

  return <div ref={host} className="live-editor-host" />;
}
