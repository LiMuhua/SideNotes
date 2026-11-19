/**
 * Markdown 渲染组件。
 *
 * 由 `core/markdown` 解析出的 AST 渲染为 React 元素：不使用
 * `dangerouslySetInnerHTML`，原生 HTML 一律作为文字输出。
 * 打开 `sourceMap` 时为顶层块标出所占的行、为图片与文件引用标出原文位置，
 * 供卡片之间拖动引用时定位落点与来源。本机图片（应用数据目录中的附件副本）经本地文件协议显示，
 * 大图显示缩小的副本、滚出视野闲置后释放（AttachmentImage，T115）。
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { parseBlocks, type BlockNode, type InlineNode, type SourceSpan } from '../core/markdown';
import { fileLabel, filePath } from '../core/files';
import { localFileUrl } from '../core/bridge';
import { AttachmentImage } from './AttachmentImage';
import { Icon } from './Icon';

/** 预览中被点击的附件：图片或文件引用在解析输入中的范围、地址与显示文字。 */
export interface PreviewAttachment {
  kind: 'image' | 'file';
  start: number;
  end: number;
  target: string;
  label: string;
}

/** 渲染回调。 */
export interface MarkdownHandlers {
  /** 点击待办：传入状态字符在原文中的偏移与新状态。返回 false 表示撤销。 */
  onTaskToggle?: (offset: number, checked: boolean) => boolean | void | Promise<boolean | void>;
  /** 点击图片预览；提供了 onAttachment 时不再使用。 */
  onPreviewImage?: (src: string, alt: string) => void;
  /** 点击文件引用；提供了 onAttachment 时不再使用。 */
  onOpenFile?: (path: string) => void;
  /** 点击图片或文件引用：打开附件弹窗，按住 Ctrl 时直接打开（由调用方按 event 判断）。 */
  onAttachment?: (attachment: PreviewAttachment, event: React.MouseEvent) => void;
}

/** 图片的显示地址：本机图片换成本地文件协议的地址，其余原样使用。 */
function imageSource(src: string): string {
  return filePath(src) ? localFileUrl(src) : src;
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
            aria-label={`图片：${node.alt || '图片'}`}
            {...spanAttributes(node, map)}
            onClick={(event) => {
              event.stopPropagation();
              if (handlers.onAttachment) {
                handlers.onAttachment({ kind: 'image', start: node.start, end: node.end, target: node.src, label: node.alt }, event);
              } else {
                handlers.onPreviewImage?.(imageSource(node.src), node.alt);
              }
            }}
          >
            <AttachmentImage className="markdown-image" src={node.src} alt={node.alt} />
          </button>
        );
      case 'file':
        return (
          <button
            key={key}
            type="button"
            className="file-reference"
            {...spanAttributes(node, map)}
            onClick={(event) => {
              event.stopPropagation();
              const label = node.label || fileLabel(node.path);
              if (handlers.onAttachment) {
                handlers.onAttachment({ kind: 'file', start: node.start, end: node.end, target: node.path, label }, event);
              } else {
                handlers.onOpenFile?.(node.path);
              }
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
              {...spanAttributes(block, map)}
              onClick={(event) => {
                event.stopPropagation();
                if (handlers.onAttachment) {
                  const attachment = { start: block.start, end: block.end, target: block.path, label: fileLabel(block.path) };
                  handlers.onAttachment({ kind: 'file', ...attachment }, event);
                } else {
                  handlers.onOpenFile?.(block.path);
                }
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
        // 有序列表的序号在内容左侧，按最大序号的位数留出缩进，等宽或较大的字体下序号也不会被卡片裁掉。
        const digits = String(Math.max(1, block.start + block.items.length - 1)).length;
        return block.ordered ? (
          <ol key={key} start={block.start} style={{ '--md-ol-digits': digits } as CSSProperties} {...lines}>
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

/** 只渲染一行行内 Markdown，用于卡片标题；`handlers` 让标题中的图片与文件引用同样可以点击。 */
export function MarkdownInline({ text, handlers = {} }: { text: string; handlers?: MarkdownHandlers }) {
  const blocks = parseBlocks(text);
  const first = blocks[0];
  if (!first) return null;
  if (first.kind === 'paragraph' || first.kind === 'heading') {
    return <>{renderInline(first.children, handlers)}</>;
  }
  return <>{text}</>;
}
