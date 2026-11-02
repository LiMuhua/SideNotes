/**
 * Markdown 编辑命令的单元测试：快捷键格式、回车续写、Tab 缩进与智能粘贴。
 * 选区以 `|` 标出光标、`«`…`»` 标出选中范围，便于阅读。
 */

import { describe, expect, it } from 'vitest';
import {
  codeLanguage,
  continueBlock,
  indentLines,
  linkWithAddress,
  setHeading,
  smartPaste,
  toggleInline,
  toggleLink,
  toggleList,
  toggleQuote,
  toggleTag,
  wrapCodeBlock,
  type EditResult,
} from './markdown-commands';

/** 把带标记的文本拆成原文与选区：`|` 为光标，`«`…`»` 为选区。 */
function parse(marked: string): { value: string; start: number; end: number } {
  const caret = marked.indexOf('|');
  if (caret >= 0) return { value: marked.replace('|', ''), start: caret, end: caret };
  const start = marked.indexOf('«');
  const end = marked.indexOf('»') - 1;
  return { value: marked.replace('«', '').replace('»', ''), start, end };
}

/** 把结果还原为带标记的文本。 */
function show(result: EditResult | null): string | null {
  if (!result) return null;
  const { value, start, end } = result;
  if (start === end) return `${value.slice(0, start)}|${value.slice(start)}`;
  return `${value.slice(0, start)}«${value.slice(start, end)}»${value.slice(end)}`;
}

type Command = (value: string, start: number, end: number) => EditResult | null;

function run(command: Command, marked: string): string | null {
  const { value, start, end } = parse(marked);
  return show(command(value, start, end));
}

const bold: Command = (value, start, end) => toggleInline(value, start, end, '**');
const italic: Command = (value, start, end) => toggleInline(value, start, end, '*');
const code: Command = (value, start, end) => toggleInline(value, start, end, '`');

describe('行内格式', () => {
  it('加粗选中的文字，标记紧贴文字不包住空白', () => {
    expect(run(bold, '说«重点 »内容')).toBe('说**«重点»** 内容');
  });

  it('再按一次取消加粗：选中带标记的文字或只选中文字都可以', () => {
    expect(run(bold, '说«**重点**»内容')).toBe('说«重点»内容');
    expect(run(bold, '说**«重点»**内容')).toBe('说«重点»内容');
  });

  it('加粗中的文字加斜体时不会误删加粗标记', () => {
    expect(run(italic, '**«重点»**')).toBe('***«重点»***');
    expect(run(italic, '***«重点»***')).toBe('**«重点»**');
  });

  it('没有选中时插入一对标记，光标在中间；空标记中再按一次撤掉', () => {
    expect(run(bold, '开始|')).toBe('开始**|**');
    expect(run(bold, '开始**|**')).toBe('开始|');
  });

  it('光标紧挨闭合标记时跳出格式', () => {
    expect(run(bold, '**加粗|**后文')).toBe('**加粗**|后文');
  });

  it('选中多行时逐行加标记，跳过空行', () => {
    expect(run(bold, '«第一行\n\n第二行»')).toBe('«**第一行**\n\n**第二行**»');
  });

  it('行内代码中含反引号时改用双反引号', () => {
    expect(run(code, '«a`b»')).toBe('`` «a`b» ``');
  });

  it('列表、待办、引用与标题中只包住块级标记之后的文字，列表不会失效', () => {
    const strike: Command = (value, start, end) => toggleInline(value, start, end, '~~');
    const underline: Command = (value, start, end) => toggleTag(value, start, end, 'u');
    expect(run(bold, '«- v0.6 桌面端稳定版»')).toBe('- **«v0.6 桌面端稳定版»**');
    expect(run(bold, '«- 甲\n- 乙»')).toBe('«- **甲**\n- **乙**»');
    expect(run(strike, '«- [ ] 待办\n  2. 第二»')).toBe('«- [ ] ~~待办~~\n  2. ~~第二~~»');
    expect(run(underline, '«> 引用\n## 标题»')).toBe('«> <u>引用</u>\n## <u>标题</u>»');
    // 再按一次取消：选中整行也只去掉文字两侧的标记；只选中项头时不处理。
    expect(run(bold, '«- **甲**»')).toBe('- «甲»');
    expect(run(bold, '«- »甲')).toBe('«- »甲');
    // 不是列表项头的写法照常包住。
    expect(run(bold, '«-5 度»')).toBe('**«-5 度»**');
  });
});

describe('链接', () => {
  it('没有选中时插入空链接，光标在链接文字处', () => {
    expect(run(toggleLink, '见|')).toBe('见[|]()');
  });

  it('选中文字时光标落在地址处，选中网址时光标落在文字处', () => {
    expect(run(toggleLink, '«官网»')).toBe('[官网](|)');
    expect(run(toggleLink, '«https://example.com»')).toBe('[|](https://example.com)');
  });

  it('选中整个链接时去掉链接只留文字', () => {
    expect(run(toggleLink, '«[官网](https://example.com)»')).toBe('«官网»');
  });

  it('剪贴板中是网址时直接生成链接，首尾空白留在链接之外', () => {
    const fromClipboard = (clip: string): Command => (value, start, end) => linkWithAddress(value, start, end, clip);
    expect(run(fromClipboard('https://example.com/a?b=1\n'), '看«官网»吧')).toBe('看[官网](https://example.com/a?b=1)|吧');
    expect(run(fromClipboard('https://example.com'), '«官网 »')).toBe('[官网](https://example.com) |');
    expect(run(fromClipboard('https://example.com'), '见|')).toBe('见[|](https://example.com)');
    expect(run(fromClipboard('https://example.com'), '«a[b]»')).toBe('[a\\[b\\]](https://example.com)|');
  });

  it('剪贴板不是网址，或选中的已是链接、网址或跨行时交给普通链接处理', () => {
    const fromClipboard = (clip: string): Command => (value, start, end) => linkWithAddress(value, start, end, clip);
    expect(run(fromClipboard('普通文字'), '«官网»')).toBeNull();
    expect(run(fromClipboard('https://example.com'), '«[官网](https://a.com)»')).toBeNull();
    expect(run(fromClipboard('https://example.com'), '«https://b.com»')).toBeNull();
    expect(run(fromClipboard('https://example.com'), '«第一行\n第二行»')).toBeNull();
  });
});

describe('下划线', () => {
  const underline: Command = (value, start, end) => toggleTag(value, start, end, 'u');

  it('选中文字包上 <u> 标签，标签紧贴文字', () => {
    expect(run(underline, '说«重点 »内容')).toBe('说<u>«重点»</u> 内容');
  });

  it('再按一次去掉标签：选中带标签的文字或只选中文字都可以', () => {
    expect(run(underline, '«<u>重点</u>»')).toBe('«重点»');
    expect(run(underline, '<u>«重点»</u>')).toBe('«重点»');
  });

  it('没有选中时插入一对标签；空标签中再按撤掉，紧挨闭合标签时跳出', () => {
    expect(run(underline, '开始|')).toBe('开始<u>|</u>');
    expect(run(underline, '开始<u>|</u>')).toBe('开始|');
    expect(run(underline, '<u>下划线|</u>后文')).toBe('<u>下划线</u>|后文');
  });

  it('选中多行时逐行处理', () => {
    expect(run(underline, '«甲\n乙»')).toBe('«<u>甲</u>\n<u>乙</u>»');
  });
});

describe('块级格式', () => {
  it('设置、切换与取消标题', () => {
    expect(run((v, s, e) => setHeading(v, s, e, 2), '标|题')).toBe('## 标|题');
    expect(run((v, s, e) => setHeading(v, s, e, 3), '## 标|题')).toBe('### 标|题');
    expect(run((v, s, e) => setHeading(v, s, e, 2), '## 标|题')).toBe('标|题');
    expect(run((v, s, e) => setHeading(v, s, e, 0), '# 标|题')).toBe('标|题');
  });

  it('切换引用', () => {
    expect(run(toggleQuote, '«甲\n乙»')).toBe('> «甲\n> 乙»');
    expect(run(toggleQuote, '«> 甲\n> 乙»')).toBe('«甲\n乙»');
  });

  it('切换无序与有序列表，转换时保留待办框', () => {
    expect(run((v, s, e) => toggleList(v, s, e, false), '«甲\n乙»')).toBe('- «甲\n- 乙»');
    expect(run((v, s, e) => toggleList(v, s, e, true), '«- 甲\n- [ ] 乙»')).toBe('1. «甲\n2. [ ] 乙»');
    expect(run((v, s, e) => toggleList(v, s, e, true), '«1. 甲\n2. 乙»')).toBe('«甲\n乙»');
  });

  it('代码块：空行插入一对围栏，选中多行时包进围栏', () => {
    expect(run(wrapCodeBlock, '|')).toBe('```\n|\n```');
    expect(run(wrapCodeBlock, '«a\nb»')).toBe('```\n«a\nb»\n```');
  });
});

describe('Tab 缩进', () => {
  const indent: Command = (v, s, e) => indentLines(v, s, e, false);
  const outdent: Command = (v, s, e) => indentLines(v, s, e, true);

  it('列表项整体缩进一级，最多两个空格', () => {
    expect(run(indent, '- 甲\n- 乙|')).toBe('- 甲\n  - 乙|');
    expect(run(indent, '- 甲\n  - 乙|')).toBe('- 甲\n  - 乙|');
  });

  it('Shift+Tab 减少缩进', () => {
    expect(run(outdent, '- 甲\n  - 乙|')).toBe('- 甲\n- 乙|');
  });

  it('普通文字中按 Tab 交给编辑器插入空格', () => {
    expect(run(indent, '正文|')).toBeNull();
  });

  it('代码块中的多行整体缩进', () => {
    expect(run(indent, '```\n«a\nb»\n```')).toBe('```\n  «a\n  b»\n```');
  });
});

describe('回车续写', () => {
  it('无序列表与待办续写新项', () => {
    expect(run(continueBlock, '- 甲|')).toBe('- 甲\n- |');
    expect(run(continueBlock, '- [x] 已完成|')).toBe('- [x] 已完成\n- [ ] |');
  });

  it('光标在项中间时把后半句带到新项', () => {
    expect(run(continueBlock, '- 甲|乙')).toBe('- 甲\n- |乙');
  });

  it('有序列表序号加一，并顺延后面的序号', () => {
    expect(run(continueBlock, '1. 甲|\n2. 乙\n3. 丙')).toBe('1. 甲\n2. |\n3. 乙\n4. 丙');
  });

  it('空项回车：缩进的项减少一级，否则结束列表', () => {
    expect(run(continueBlock, '- 甲\n  - |')).toBe('- 甲\n- |');
    expect(run(continueBlock, '- 甲\n- |')).toBe('- 甲\n|');
  });

  it('引用续写与结束', () => {
    expect(run(continueBlock, '> 甲|')).toBe('> 甲\n> |');
    expect(run(continueBlock, '> 甲\n> |')).toBe('> 甲\n|');
  });

  it('左围栏行末回车补全右围栏，代码块内保留缩进', () => {
    expect(run(continueBlock, '```js|')).toBe('```js\n|\n```');
    expect(run(continueBlock, '```js|\n```')).toBeNull();
    expect(run(continueBlock, '```\n  a|\n```')).toBe('```\n  a\n  |\n```');
  });

  it('沿用原文的换行符', () => {
    expect(run(continueBlock, '- 甲\r\n- 乙|')).toBe('- 甲\r\n- 乙\r\n- |');
  });

  it('普通段落、光标在项头之内或有选区时不处理', () => {
    expect(run(continueBlock, '正文|')).toBeNull();
    expect(run(continueBlock, '-| 甲')).toBeNull();
    expect(run(continueBlock, '- «甲»')).toBeNull();
    expect(run(continueBlock, '---|')).toBeNull();
  });
});

describe('智能粘贴', () => {
  const paste =
    (text: string, html?: string, language?: string | null): Command =>
    (v, s, e) =>
      smartPaste(v, s, e, { text, html, codeLanguage: language });

  it('选中文字后粘贴网址生成链接', () => {
    expect(run(paste('https://example.com/a'), '看«官网»')).toBe('看[官网](https://example.com/a)|');
  });

  it('没有选中时粘贴网址按原样粘贴', () => {
    expect(run(paste('https://example.com/a'), '看|')).toBeNull();
  });

  it('从网页复制的单个链接保留文字与地址', () => {
    const html = '<meta charset="utf-8"><a href="https://example.com/doc">接口文档</a>';
    expect(run(paste('接口文档', html), '|')).toBe('[接口文档](https://example.com/doc)|');
  });

  it('含链接的段落按纯文本粘贴', () => {
    const html = '<p>详见 <a href="https://example.com">这里</a> 的说明</p>';
    expect(run(paste('详见 这里 的说明', html), '|')).toBeNull();
  });

  it('来自 VS Code 的多行代码包进代码块并写上语言，前后补换行', () => {
    expect(run(paste('const a = 1;\nconsole.log(a);\n', undefined, 'ts'), '说明|')).toBe(
      '说明\n```ts\nconst a = 1;\nconsole.log(a);\n```|',
    );
  });

  it('来自代码编辑器的单行文字包成行内代码', () => {
    expect(run(paste('useCardInteractions', undefined, 'typescript'), '调用 |')).toBe('调用 `useCardInteractions`|');
  });

  it('网页格式为等宽字体或 pre 时识别为代码，并读取类名中的语言', () => {
    const vscode =
      '<div style="color: #333;font-family: Consolas, \'Courier New\', monospace;"><div>a();</div><div>b();</div></div>';
    expect(run(paste('a();\nb();', vscode), '|')).toBe('```\na();\nb();\n```|');
    const github = '<pre><code class="language-python">def f():\n    return 1</code></pre>';
    expect(run(paste('def f():\n    return 1', github), '|')).toBe('```python\ndef f():\n    return 1\n```|');
  });

  it('纯文本中像代码的多行文字包进代码块，普通文字与 Markdown 不处理', () => {
    expect(run(paste('if (a) {\n  b();\n}'), '|')).toBe('```\nif (a) {\n  b();\n}\n```|');
    expect(run(paste('第一段话。\n第二段话（补充）'), '|')).toBeNull();
    expect(run(paste('- 甲 {a}\n- 乙;'), '|')).toBeNull();
  });

  it('光标在代码块或行内代码中时按纯文本粘贴', () => {
    expect(run(paste('a();\nb();', undefined, 'js'), '```\n|\n```')).toBeNull();
    expect(run(paste('https://x.com'), '`co«d»e`')).toBeNull();
  });

  it('Markdown 与纯文本文件不当作代码', () => {
    expect(codeLanguage('markdown')).toBeNull();
    expect(codeLanguage('plaintext')).toBeNull();
    expect(codeLanguage('typescriptreact')).toBe('tsx');
  });
});
