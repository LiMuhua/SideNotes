/**
 * 实时 Markdown 编辑面：直接复用现有应用的编辑器（`src/core/editor.ts`）。
 *
 * 与应用中的 `LiveEditor` 相比，只去掉了桌面能力：不读剪贴板、不保存粘贴的文件、不换算本机图片地址；
 * 标签联想改用 Playground 的记录。编辑器自己管理 DOM，组件只负责挂载、同步外部原文与销毁。
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { MarkdownEditor } from '@/core/editor';
import { suggestTags } from '@/core/notes';
import { parse } from '@/core/tags';
import { useNotes } from '../model/notes';

export interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  minHeight?: number;
  maxHeight?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
  onReady?: (editor: MarkdownEditor) => void;
}

export function NoteEditor({ value, onChange, placeholder, ariaLabel, minHeight, maxHeight, autoFocus, onBlur, onReady }: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MarkdownEditor | null>(null);
  const { notes } = useNotes();
  // 回调与记录放在 ref 中，编辑器实例不随它们的身份变化而重建。
  const latest = useRef({ onChange, onBlur, onReady, notes });

  useLayoutEffect(() => {
    latest.current = { onChange, onBlur, onReady, notes };
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
      onChange: (next) => latest.current.onChange(next),
      tagSuggestions: (prefix, text) => suggestTags(latest.current.notes, {}, prefix, parse(text).tags),
    });
    editor.current = instance;
    latest.current.onReady?.(instance);
    const handleBlur = () => latest.current.onBlur?.();
    instance.element.addEventListener('blur', handleBlur);
    if (autoFocus) instance.focus({ preventScroll: true });
    return () => {
      instance.element.removeEventListener('blur', handleBlur);
      instance.destroy();
      editor.current = null;
    };
    // 只在挂载时创建实例；原文与高度由下面的副作用同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部原文变化时同步到编辑器（例如保存后清空草稿）。
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value) editor.current.setValue(value);
  }, [value]);

  useEffect(() => {
    if (editor.current && typeof maxHeight === 'number') editor.current.setMaxHeight(maxHeight);
  }, [maxHeight]);

  return <div ref={host} className="sn-editor-host" />;
}
