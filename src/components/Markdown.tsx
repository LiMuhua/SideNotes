/**
 * Markdown 渲染组件。
 *
 * 由 `core/markdown` 解析出的 AST 渲染为 React 元素：不使用
 * `dangerouslySetInnerHTML`，原生 HTML 一律作为文字输出。
 * 打开 `sourceMap` 时为顶层块标出所占的行、为图片与文件引用标出原文位置，
 * 供卡片之间拖动引用时定位落点与来源。
 */

import { Fragment, type ReactNode } from 'react';
import { parseBlocks, type BlockNode, type InlineNode, type SourceSpan } from '../core/markdown';
import { fileLabel } from '../core/files';
import { Icon } from './Icon';

/** 渲染回调。 */
export interface MarkdownHandlers {
  /** 点击待办：传入状态字符在原文中的偏移与新状态。返回 false 表示撤销。 */
  onTaskToggle?: (offset: number, checked: boolean) => boolean | void | Promise<boolean | void>;
  /** 点击图片预览。 */
  onPreviewImage?: (src: string, alt: string) => void;
  /** 点击文件引用。 */
  onOpenFile?: (path: string) => void;
}

/** 可拖动引用的位置标记；未开启 sourceMap 时不输出。 */
function spanAttributes(span: SourceSpan, map: boolean): Record<string, string | number> {
  return map ? { 'data-drag-item': 'text', 'data-src-start': span.start, 'data-src-end': span.end } : {};
}

/** 渲染行内节点。 */
function renderInline(nodes: InlineNode[], handlers: MarkdownHandlers, keyPrefix = '', map = false): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.kind) {
      case 'text':
        // 软换行用 \n 表示，由 white-space 控制换行呈现。
        return <Fragment key={key}>{node.value}</Fragment>;
      case 'code':
        return <code key={key}>{node.value}</code>;
      case 'strong':
        return <strong key={key}>{renderInline(node.children, handlers, `${key}-`, map)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, handlers, `${key}-`, map)}</em>;
      case 'del':
        return <del key={key}>{renderInline(node.children, handlers, `${key}-`, map)}</del>;
      case 'underline':
        return <u key={key}>{renderInline(node.children, handlers, `${key}-`, map)}</u>;
      case 'link':
        return (
          <a key={key} className="markdown-link" href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children, handlers, `${key}-`, map)}
          </a>
        );
      case 'image':
        return (
          <button
            key={key}
            type="button"
            className="markdown-image-button"
            aria-label={`放大图片：${node.alt || '图片'}`}
            {...spanAttributes(node, map)}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onPreviewImage?.(node.src, node.alt);
            }}
          >
            <img className="markdown-image" src={node.src} alt={node.alt} loading="lazy" draggable={false} />
          </button>
        );
      case 'file':
        return (
          <button
            key={key}
            type="button"
            className="file-reference"
            title={`${node.path}\n点击校验并打开文件`}
            {...spanAttributes(node, map)}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onOpenFile?.(node.path);
            }}
          >
            <Icon name="file" />
            <span>{node.label || fileLabel(node.path)}</span>
          </button>
        );
      default:
        return null;
    }
  });
}

/** 渲染块级节点；`top` 为顶层时才标出所占的行。 */
function renderBlocks(
  blocks: BlockNode[],
  handlers: MarkdownHandlers,
  keyPrefix = '',
  map = false,
  top = true,
): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}${index}`;
    const lines = map && top ? { 'data-line-start': block.line, 'data-line-end': block.lineEnd } : {};
    switch (block.kind) {
      case 'paragraph':
        return (
          <p key={key} {...lines}>
            {renderInline(block.children, handlers, `${key}-`, map)}
          </p>
        );
      case 'heading': {
        const Tag = `h${Math.min(6, Math.max(1, block.level))}` as 'h1';
        return (
          <Tag key={key} {...lines}>
            {renderInline(block.children, handlers, `${key}-`, map)}
          </Tag>
        );
      }
      case 'code':
        return (
          <pre key={key} className="markdown-code" {...lines}>
            <code data-language={block.language || undefined}>{block.value}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={key} {...lines}>
            {renderBlocks(block.children, handlers, `${key}-`, map, false)}
          </blockquote>
        );
      case 'rule':
        return <hr key={key} {...lines} />;
      case 'file':
        return (
          <p key={key} {...lines}>
            <button
              type="button"
              className="file-reference"
              title={`${block.path}\n点击校验并打开文件`}
              {...spanAttributes(block, map)}
              onClick={(event) => {
                event.stopPropagation();
                handlers.onOpenFile?.(block.path);
              }}
            >
              <Icon name="file" />
              <span>{fileLabel(block.path)}</span>
            </button>
          </p>
        );
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li
            key={`${key}-${itemIndex}`}
            className={item.taskOffset !== undefined ? 'markdown-task' : undefined}
          >
            {item.taskOffset !== undefined ? (
              <input
                type="checkbox"
                className="md-task-toggle"
                checked={Boolean(item.checked)}
                disabled={!handlers.onTaskToggle}
                aria-label={item.checked ? '已完成' : '未完成'}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  // 状态由原文决定：回调失败时下一次渲染会还原显示。
                  void handlers.onTaskToggle?.(item.taskOffset as number, next);
                }}
              />
            ) : null}
            {renderInline(item.children, handlers, `${key}-${itemIndex}-`, map)}
          </li>
        ));
        return block.ordered ? (
          <ol key={key} start={block.start} {...lines}>
            {items}
          </ol>
        ) : (
          <ul key={key} {...lines}>
            {items}
          </ul>
        );
      }
      default:
        return null;
    }
  });
}

/** Markdown 正文。 */
export function Markdown({
  text,
  className,
  handlers = {},
  sourceMap = false,
}: {
  text: string;
  className?: string;
  handlers?: MarkdownHandlers;
  /** 标出顶层块所占的行与引用的原文位置，用于拖动引用。 */
  sourceMap?: boolean;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      {renderBlocks(blocks, handlers, '', sourceMap)}
    </div>
  );
}

/** 只渲染一行行内 Markdown，用于卡片标题。 */
export function MarkdownInline({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  const first = blocks[0];
  if (!first) return null;
  if (first.kind === 'paragraph' || first.kind === 'heading') {
    return <>{renderInline(first.children, {})}</>;
  }
  return <>{text}</>;
}
