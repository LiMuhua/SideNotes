import { describe, expect, it } from 'vitest';
import { getFeatures, parseBlocks, parseInline, safeImage, safeLink } from './markdown';
import type { BlockNode, InlineNode } from './markdown';

/** 把行内节点还原为纯文字，便于断言内容而不关心结构细节。 */
function flatten(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.value;
        case 'image':
          return node.alt;
        case 'file':
          return node.label;
        default:
          return flatten(node.children);
      }
    })
    .join('');
}

describe('行内 Markdown', () => {
  it('解析加粗、斜体与删除线', () => {
    const nodes = parseInline('**粗** *斜* ~~删~~');
    expect(nodes.map((node) => node.kind)).toContain('strong');
    expect(nodes.map((node) => node.kind)).toContain('em');
    expect(nodes.map((node) => node.kind)).toContain('del');
  });

  it('解析行内代码并保留内容', () => {
    const nodes = parseInline('执行 `npm run dev` 启动');
    const code = nodes.find((node) => node.kind === 'code');
    expect(code).toBeDefined();
    expect(code && code.kind === 'code' && code.value).toBe('npm run dev');
  });

  it('未闭合的标记保留为普通文字', () => {
    expect(flatten(parseInline('一个 *未闭合'))).toBe('一个 *未闭合');
  });

  it('转义字符输出原字符', () => {
    expect(flatten(parseInline('\\*不是斜体\\*'))).toBe('*不是斜体*');
  });

  it('解析链接并保留文字', () => {
    const nodes = parseInline('[文档](https://v2.tauri.app/)');
    const link = nodes.find((node) => node.kind === 'link');
    expect(link && link.kind === 'link' && link.href).toBe('https://v2.tauri.app/');
    expect(flatten(nodes)).toBe('文档');
  });

  it('拒绝 javascript 协议链接', () => {
    const nodes = parseInline('[点我](javascript:alert(1))');
    expect(nodes.every((node) => node.kind !== 'link')).toBe(true);
    expect(flatten(nodes)).toContain('点我');
  });

  it('识别裸链接并去掉尾随标点', () => {
    const nodes = parseInline('见 https://example.com/page。');
    const link = nodes.find((node) => node.kind === 'link');
    expect(link && link.kind === 'link' && link.href).toBe('https://example.com/page');
  });

  it('解析图片为预览节点', () => {
    const nodes = parseInline('![配色](data:image/png;base64,AAAA)');
    const image = nodes.find((node) => node.kind === 'image');
    expect(image && image.kind === 'image' && image.alt).toBe('配色');
  });

  it('把本地绝对路径识别为文件引用', () => {
    const nodes = parseInline('[设计稿.pdf](C:\\Projects\\设计稿.pdf)');
    const file = nodes.find((node) => node.kind === 'file');
    expect(file && file.kind === 'file' && file.path).toBe('C:\\Projects\\设计稿.pdf');
    expect(file && file.kind === 'file' && file.label).toBe('设计稿.pdf');
  });

  it('原生 HTML 保留为文字', () => {
    expect(flatten(parseInline('<script>alert(1)</script>'))).toBe('<script>alert(1)</script>');
  });

  it('链接地址可包含括号', () => {
    const nodes = parseInline('[条目](https://example.com/a_(b))');
    const link = nodes.find((node) => node.kind === 'link');
    expect(link && link.kind === 'link' && link.href).toBe('https://example.com/a_(b)');
  });
});

describe('块级 Markdown', () => {
  it('解析各级标题', () => {
    const blocks = parseBlocks('# 一级\n## 二级');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'heading']);
    expect(blocks[0].kind === 'heading' && blocks[0].level).toBe(1);
    expect(blocks[1].kind === 'heading' && blocks[1].level).toBe(2);
  });

  it('解析围栏代码块与语言标记', () => {
    const blocks = parseBlocks('```bash\nnpm run dev\n```');
    const code = blocks[0];
    expect(code.kind).toBe('code');
    expect(code.kind === 'code' && code.language).toBe('bash');
    expect(code.kind === 'code' && code.value).toBe('npm run dev');
  });

  it('解析无序与有序列表', () => {
    const blocks = parseBlocks('- 甲\n- 乙\n\n3. 丙\n4. 丁');
    const lists = blocks.filter((block): block is Extract<BlockNode, { kind: 'list' }> => block.kind === 'list');
    expect(lists).toHaveLength(2);
    expect(lists[0].ordered).toBe(false);
    expect(lists[0].items).toHaveLength(2);
    expect(lists[1].ordered).toBe(true);
    expect(lists[1].start).toBe(3);
  });

  it('待办项记录状态字符在原文中的偏移', () => {
    const source = '- [x] 完成\n- [ ] 待办';
    const blocks = parseBlocks(source);
    const list = blocks[0];
    expect(list.kind).toBe('list');
    if (list.kind !== 'list') return;
    expect(list.items[0].checked).toBe(true);
    expect(list.items[1].checked).toBe(false);
    // 偏移处应正好是状态字符本身。
    expect(source[list.items[0].taskOffset ?? -1]).toBe('x');
    expect(source[list.items[1].taskOffset ?? -1]).toBe(' ');
  });

  it('CRLF 原文的待办偏移同样准确', () => {
    const source = '标题\r\n\r\n- [ ] 待办';
    const blocks = parseBlocks(source);
    const list = blocks.find((block) => block.kind === 'list');
    expect(list?.kind).toBe('list');
    if (list?.kind !== 'list') return;
    expect(source[list.items[0].taskOffset ?? -1]).toBe(' ');
  });

  it('解析引用块并递归其中的结构', () => {
    const blocks = parseBlocks('> 先记录，再整理。\n> - 甲');
    expect(blocks[0].kind).toBe('quote');
    if (blocks[0].kind !== 'quote') return;
    expect(blocks[0].children.some((child) => child.kind === 'list')).toBe(true);
  });

  it('解析分隔线', () => {
    expect(parseBlocks('---').map((block) => block.kind)).toEqual(['rule']);
  });

  it('段落内的软换行合并为同一块', () => {
    const blocks = parseBlocks('第一行\n第二行');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('独立行的本地路径成为文件块', () => {
    const blocks = parseBlocks('C:\\Projects\\设计稿.pdf');
    expect(blocks[0].kind).toBe('file');
  });

  it('空正文返回空列表', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n  \n')).toEqual([]);
  });
});

describe('地址校验', () => {
  it('只允许 http、https 与 mailto', () => {
    expect(safeLink('https://example.com')).toBeTruthy();
    expect(safeLink('mailto:a@b.com')).toBeTruthy();
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('file:///C:/x')).toBeNull();
    expect(safeLink('不是地址')).toBeNull();
  });

  it('图片只允许 data:image 与 https', () => {
    expect(safeImage('data:image/png;base64,AAAA')).toBeTruthy();
    expect(safeImage('https://example.com/a.png')).toBeTruthy();
    expect(safeImage('data:text/html,<script>')).toBeNull();
  });
});

describe('内容类型', () => {
  it('同时识别文本、代码、链接与图片', () => {
    const features = getFeatures('说明\n\n`code`\n\nhttps://example.com', true);
    expect(features).toContain('文本');
    expect(features).toContain('代码');
    expect(features).toContain('链接');
    expect(features).toContain('图片');
  });

  it('空内容回落为文本', () => {
    expect(getFeatures('')).toEqual(['文本']);
  });
});
