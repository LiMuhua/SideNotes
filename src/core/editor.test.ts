import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor, type EditorOptions } from './editor';

/** 建立挂载点，每个用例独立 DOM。 */
function mount(value = ''): { editor: MarkdownEditor; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new MarkdownEditor(host, { value });
  return { editor, host };
}

/** 把光标放到原文指定偏移并触发排版复核。 */
function caretAt(editor: MarkdownEditor, offset: number): void {
  editor.element.focus();
  editor.setSelectionRange(offset, offset);
}

/** jsdom 没有 Selection.modify：按整行模拟浏览器移到显示行的开头或末尾。返回还原函数。 */
function fakeLineBoundary(): () => void {
  const proto = Selection.prototype as unknown as {
    modify?: (alter: string, direction: string, granularity: string) => void;
  };
  const original = proto.modify;
  proto.modify = function (this: Selection, _alter: string, direction: string) {
    const node = this.focusNode;
    const line = (node instanceof Element ? node : node?.parentElement)?.closest('.md-editor-line');
    if (line) this.collapse(line, direction === 'backward' ? 0 : line.childNodes.length);
  };
  return () => {
    proto.modify = original;
  };
}

/** 在编辑面上按下一个键，返回编辑器是否接管（阻止了默认行为）。 */
function pressKey(editor: MarkdownEditor, key: string, shiftKey = false): boolean {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  editor.element.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('实时 Markdown 编辑器', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('按行渲染并保留原文', () => {
    const { editor } = mount('第一行\n第二行');
    expect(editor.element.children).toHaveLength(2);
    expect(editor.getValue()).toBe('第一行\n第二行');
  });

  it('未聚焦时隐藏标记但保留原文字符', () => {
    const { editor } = mount('**加粗**');
    const markers = Array.from(editor.element.querySelectorAll<HTMLElement>('.md-syntax'));
    expect(markers).toHaveLength(2);
    expect(markers.every((node) => node.hidden)).toBe(true);
    // 隐藏节点仍包含原文，复制与偏移映射不受影响。
    expect(markers.map((node) => node.textContent).join('')).toBe('****');
    expect(editor.element.querySelector('strong')?.textContent).toBe('加粗');
  });

  it('光标进入标记范围时展开原始标记', () => {
    const { editor } = mount('**加粗**');
    caretAt(editor, 3);
    const markers = Array.from(editor.element.querySelectorAll<HTMLElement>('.md-syntax'));
    expect(markers.some((node) => !node.hidden)).toBe(true);
  });

  it('渲染标题并标记层级', () => {
    const { editor } = mount('## 二级标题');
    const line = editor.element.firstElementChild as HTMLElement;
    expect(line.classList.contains('md-heading')).toBe(true);
    expect(line.classList.contains('md-heading-2')).toBe(true);
  });

  it('渲染代码围栏内的内容为代码行', () => {
    const { editor } = mount('```bash\nnpm run dev\n```');
    const lines = Array.from(editor.element.children) as HTMLElement[];
    expect(lines[0].classList.contains('md-fence-marker')).toBe(true);
    expect(lines[1].classList.contains('md-fenced-code')).toBe(true);
    expect(lines[2].classList.contains('md-fence-marker')).toBe(true);
  });

  it('列表项显示项目符号装饰', () => {
    const { editor } = mount('- 甲');
    const bullet = editor.element.querySelector('.md-list-bullet');
    expect(bullet).not.toBeNull();
    // 装饰节点不参与原文映射。
    expect(bullet?.getAttribute('data-md-decoration')).toBe('');
  });

  it('光标在列表项正文开头或空项末尾时放在项头元素之外；落在项头上时移到正文开头', () => {
    const { editor } = mount('- 内容\n- ');
    for (const offset of [2, 7]) {
      caretAt(editor, offset);
      const anchor = window.getSelection()?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      expect(element?.closest('.md-list-marker') ?? null).toBeNull();
      expect(editor.readSelection()).toEqual({ start: offset, end: offset, direction: 'none' });
    }
    // 项头一直隐藏（原型第二版）：光标落在行首等项头里的位置时，选区变化后移到正文开头。
    caretAt(editor, 0);
    editor.selectionChanged();
    expect(editor.readSelection()).toEqual({ start: 2, end: 2, direction: 'none' });
    expect(editor.element.querySelector('.md-list-marker')?.hasAttribute('hidden')).toBe(true);
  });

  it('列表项与待办正文开头按退格删去整个项头，缩进保留，这一行变回普通文字', () => {
    const { editor } = mount('  - 子项\n- [ ] 待办');
    caretAt(editor, 4);
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe('  子项\n- [ ] 待办');
    caretAt(editor, 11);
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe('  子项\n待办');
    // 正文中间的退格照常只删一个字。
    caretAt(editor, 3);
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe('  项\n待办');
  });

  it('列表项中 Home 回到正文开头，正文开头按 End 到达行尾，按住 Shift 时扩选', () => {
    const restore = fakeLineBoundary();
    try {
      const { editor } = mount('- [ ] 待办内容');
      caretAt(editor, 8);
      expect(pressKey(editor, 'Home')).toBe(true);
      expect(editor.readSelection()).toEqual({ start: 6, end: 6, direction: 'none' });
      expect(pressKey(editor, 'End')).toBe(true);
      expect(editor.readSelection()).toEqual({ start: 10, end: 10, direction: 'none' });
      // 已在正文之中时 End 交给浏览器，折行时按显示的行移动。
      expect(pressKey(editor, 'End')).toBe(false);
      expect(pressKey(editor, 'Home', true)).toBe(true);
      expect(editor.readSelection()).toEqual({ start: 6, end: 10, direction: 'backward' });
      // 没有项头的普通段落不处理。
      const plain = mount('普通文字').editor;
      caretAt(plain, 2);
      expect(pressKey(plain, 'Home')).toBe(false);
    } finally {
      restore();
    }
  });

  it('以加粗开头的列表项：光标在项头上时 End 到达行尾，Home 停在加粗文字开头', () => {
    const restore = fakeLineBoundary();
    try {
      const { editor } = mount('- **v0.7 数据导入导出**');
      // 光标在「-」上：正文开头是隐藏的 **，End 不能再停回项头之后。
      caretAt(editor, 1);
      expect(pressKey(editor, 'End')).toBe(true);
      expect(editor.readSelection().end).toBe(17);
      caretAt(editor, 0);
      expect(pressKey(editor, 'Home')).toBe(true);
      expect(editor.readSelection()).toEqual({ start: 4, end: 4, direction: 'none' });
      caretAt(editor, 9);
      expect(pressKey(editor, 'Home')).toBe(true);
      expect(editor.readSelection().start).toBe(4);
      // 普通段落以加粗开头时，Home 同样停在文字开头。
      const plain = mount('**粗体**开头').editor;
      caretAt(plain, 5);
      expect(pressKey(plain, 'Home')).toBe(true);
      expect(plain.readSelection().start).toBe(2);
    } finally {
      restore();
    }
  });

  it('待办渲染为可点击复选框', () => {
    const { editor } = mount('- [ ] 待办');
    const checkbox = editor.element.querySelector<HTMLElement>('[data-md-task]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
  });

  it('点击待办只替换状态字符', () => {
    const { editor } = mount('- [ ] 待办\n- [ ] 其它');
    // 每次切换都会重排，必须重新取节点而不能复用旧引用。
    const checkbox = (): HTMLElement | null => editor.element.querySelector<HTMLElement>('[data-md-task]');
    checkbox()?.click();
    expect(editor.getValue()).toBe('- [x] 待办\n- [ ] 其它');
    checkbox()?.click();
    expect(editor.getValue()).toBe('- [ ] 待办\n- [ ] 其它');
  });

  it('切换第二个待办不影响其余原文', () => {
    const { editor } = mount('- [ ] 甲\n- [ ] 乙');
    const boxes = editor.element.querySelectorAll<HTMLElement>('[data-md-task]');
    expect(boxes).toHaveLength(2);
    boxes[1].click();
    expect(editor.getValue()).toBe('- [ ] 甲\n- [x] 乙');
  });

  it('替换选区更新原文与光标', () => {
    const { editor } = mount('原内容');
    editor.replace('新', { start: 0, end: 2, direction: 'none' });
    expect(editor.getValue()).toBe('新容');
  });

  it('撤销与重做恢复历史原文', () => {
    const { editor } = mount('起点');
    editor.replace('插入', { start: 2, end: 2, direction: 'none' });
    expect(editor.getValue()).toBe('起点插入');
    editor.element.focus();
    editor.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(editor.getValue()).toBe('起点');
    editor.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(editor.getValue()).toBe('起点插入');
  });

  it('setValue 默认不派发变更回调', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let changes = 0;
    const editor = new MarkdownEditor(host, {
      value: '甲',
      onChange: () => {
        changes += 1;
      },
    });
    editor.setValue('乙');
    expect(editor.getValue()).toBe('乙');
    expect(changes).toBe(0);
    editor.setValue('丙', { emit: true });
    expect(changes).toBe(1);
  });

  it('Tab 插入两个空格而非切换焦点', () => {
    const { editor } = mount('');
    editor.element.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    editor.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getValue()).toBe('  ');
  });

  it('格式快捷键按物理按键识别，缺少按键位置时按虚拟键码识别', () => {
    const { editor } = mount('重点');
    editor.element.focus();
    editor.setSelectionRange(0, 2);
    editor.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(editor.getValue()).toBe('**重点**');
    // 自动化工具与部分远程输入不带扫描码：code 为空，只有虚拟键码。
    editor.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', keyCode: 66, ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(editor.getValue()).toBe('重点');
  });

  it('保留 CRLF 换行', () => {
    const { editor } = mount('甲\r\n乙');
    expect(editor.getValue()).toBe('甲\r\n乙');
    expect(editor.element.children).toHaveLength(2);
    expect((editor.element.firstElementChild as HTMLElement).dataset.eol).toBe('\r\n');
  });

  it('空行渲染占位换行节点', () => {
    const { editor } = mount('甲\n\n乙');
    const placeholder = editor.element.querySelector('[data-md-placeholder]');
    expect(placeholder).not.toBeNull();
  });

  it('链接标记带有分组信息，供完整复制补齐', () => {
    const { editor } = mount('[文档](https://example.com)');
    const grouped = editor.element.querySelectorAll('[data-md-group-start]');
    expect(grouped.length).toBeGreaterThanOrEqual(2);
  });

  it('销毁后移除元素', () => {
    const { editor, host } = mount('内容');
    editor.destroy();
    expect(host.contains(editor.element)).toBe(false);
  });

  it('空原文标记为空状态，供占位文字显示', () => {
    const { editor } = mount('');
    expect(editor.element.classList.contains('is-empty')).toBe(true);
    editor.setValue('有内容');
    expect(editor.element.classList.contains('is-empty')).toBe(false);
  });
});

/** 派发一次输入前事件，模拟删除或输入。 */
function input(editor: MarkdownEditor, inputType: string, data: string | null = null): void {
  editor.element.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
}

/** 派发复制或剪切事件，返回写入剪贴板的文字。 */
function clip(editor: MarkdownEditor, type: 'copy' | 'cut'): string {
  let written = '';
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (_format: string, value: string) => {
        written = value;
      },
    },
  });
  editor.element.dispatchEvent(event);
  return written;
}

/** 当前隐藏的格式标记数。 */
function hiddenMarkers(editor: MarkdownEditor): number {
  return editor.element.querySelectorAll('.md-syntax.is-hidden[data-md-group-start]').length;
}

describe('选区与链接原文', () => {
  // 0:看 1:空格 2:[ 3:文 4:档 5:] 6:( 7–25:地址 26:) 27:空格 28:结 29:束
  const linked = '看 [文档](https://example.com) 结束';

  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('在展开的链接原文里扩选或选词时，标记保持展开', () => {
    const { editor } = mount(linked);
    caretAt(editor, 12);
    expect(hiddenMarkers(editor)).toBe(0);
    editor.setSelectionRange(12, 20, 'forward');
    expect(hiddenMarkers(editor)).toBe(0);
    editor.setSelectionRange(8, 12, 'backward');
    expect(hiddenMarkers(editor)).toBe(0);
  });

  it('从链接之外开始的选区与全选保持渲染效果', () => {
    const { editor } = mount(linked);
    editor.element.focus();
    editor.setSelectionRange(0, 4, 'forward');
    expect(hiddenMarkers(editor)).toBe(2);
    editor.setSelectionRange(0, linked.length, 'forward');
    expect(hiddenMarkers(editor)).toBe(2);
  });

  it('选中整个链接（含渲染出的文字）删除时，链接原文一起删除', () => {
    const { editor } = mount(linked);
    editor.element.focus();
    editor.setSelectionRange(1, 5, 'forward');
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe('看 结束');
  });

  it('只选中链接的一部分时保留隐藏的标记，只删除看得见的文字', () => {
    const { editor } = mount(linked);
    editor.element.focus();
    editor.setSelectionRange(4, 28, 'backward');
    input(editor, 'deleteContentForward');
    expect(editor.getValue()).toBe('看 [文](https://example.com)结束');
  });

  it('选区拆开隐藏标记时输入只替换看得见的文字', () => {
    const { editor } = mount(linked);
    editor.element.focus();
    editor.setSelectionRange(4, 28, 'backward');
    input(editor, 'insertText', '本');
    expect(editor.getValue()).toBe('看 [文本](https://example.com)结束');
  });

  it('复制与剪切按所见内容：完整选中的链接保留原文，部分选中时不带隐藏标记', () => {
    const { editor } = mount(linked);
    editor.element.focus();
    editor.setSelectionRange(1, 5, 'forward');
    expect(clip(editor, 'copy')).toBe(' [文档](https://example.com)');
    editor.setSelectionRange(4, 28, 'backward');
    expect(clip(editor, 'cut')).toBe('档 ');
    expect(editor.getValue()).toBe('看 [文](https://example.com)结束');
  });

  it('展开的标记按原文删除', () => {
    const { editor } = mount(linked);
    caretAt(editor, 12);
    editor.setSelectionRange(7, 26, 'backward');
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe('看 [文档]() 结束');
  });
});

/** 在编辑器上按下快捷键。 */
function press(editor: MarkdownEditor, init: KeyboardEventInit): void {
  editor.element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('格式快捷键', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('按设置中的按键生效，改走后原来的按键不再触发', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = new MarkdownEditor(host, { value: '重点', shortcuts: () => ({ bold: 'Ctrl+Shift+B' }) });
    editor.element.focus();
    editor.setSelectionRange(0, 2);
    press(editor, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(editor.getValue()).toBe('重点');
    press(editor, { key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(editor.getValue()).toBe('**重点**');
  });

  it('Ctrl+U 下划线，Alt+S 与 Alt+Shift+5 删除线', () => {
    const { editor } = mount('重点');
    editor.element.focus();
    editor.setSelectionRange(0, 2);
    press(editor, { key: 'u', code: 'KeyU', ctrlKey: true });
    expect(editor.getValue()).toBe('<u>重点</u>');
    expect(editor.element.querySelector('u')?.textContent).toBe('重点');
    editor.setValue('重点');
    editor.setSelectionRange(0, 2);
    press(editor, { key: 's', code: 'KeyS', altKey: true });
    expect(editor.getValue()).toBe('~~重点~~');
    editor.setSelectionRange(2, 4);
    press(editor, { key: '%', code: 'Digit5', altKey: true, shiftKey: true });
    expect(editor.getValue()).toBe('重点');
  });

  it('Ctrl+K 读取剪贴板中的网址生成链接，剪贴板不是网址时插入空地址', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let clipboard = 'https://example.com';
    const editor = new MarkdownEditor(host, { value: '官网', readClipboard: async () => clipboard });
    editor.element.focus();
    editor.setSelectionRange(0, 2);
    press(editor, { key: 'k', code: 'KeyK', ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getValue()).toBe('[官网](https://example.com)');
    clipboard = '一段文字';
    editor.setValue('官网');
    editor.setSelectionRange(0, 2);
    press(editor, { key: 'k', code: 'KeyK', ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getValue()).toBe('[官网]()');
  });
});

describe('粘贴截图与本机图片', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('粘贴文件时交给应用保存，返回的引用按插入规则插在粘贴时的光标处', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const received: string[] = [];
    const editor = new MarkdownEditor(host, {
      value: '标题\n前后',
      pasteFiles: async (files) => {
        received.push(...files.map((file) => file.name));
        return '![截图](C:/Data/attachments/1-0/截图.png)';
      },
    });
    editor.element.focus();
    editor.setSelectionRange(4, 4);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], getData: () => '' } });
    editor.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(['image.png']);
    expect(editor.getValue()).toBe('标题\n前![截图](C:/Data/attachments/1-0/截图.png)后');
    // 光标在卡片的标题行上时，附件作为单独一行插在标题之后，标题原样保留（原型第二版）。
    editor.setSelectionRange(1, 1);
    editor.element.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getValue().split('\n').slice(0, 2)).toEqual(['标题', '![截图](C:/Data/attachments/1-0/截图.png)']);
  });

  it('本机图片经换算后的地址预览，没有换算方法时只显示原文', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = new MarkdownEditor(host, {
      value: '![图](C:/a/图.png)',
      resolveImage: (path) => `asset://${path}`,
    });
    expect(editor.element.querySelector('img')?.getAttribute('src')).toBe('asset://C:/a/图.png');
    const plain = mount('![图](C:/a/图.png)').editor;
    expect(plain.element.querySelector('img')).toBeNull();
  });
});

describe('附件整块显示', () => {
  const image = '![图](C:/Data/attachments/1-0/图.png)';
  const file = '[报告.pdf](<C:/Data/attachments/2-0/报 告.pdf>)';
  const value = `看${image}和${file}完`;
  const imageStart = value.indexOf(image);
  const imageEnd = imageStart + image.length;
  const fileStart = value.indexOf(file);
  const fileEnd = fileStart + file.length;

  /** 挂载带图片换算与附件回调的编辑器。 */
  function mountWithAttachments(onAttachment?: EditorOptions['onAttachment']): MarkdownEditor {
    const host = document.createElement('div');
    document.body.append(host);
    return new MarkdownEditor(host, { value, resolveImage: (path) => `asset://${path}`, onAttachment });
  }

  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('原文始终隐藏，显示为图片块与文件块，光标靠近也不展开', () => {
    const editor = mountWithAttachments();
    const sources = (): HTMLElement[] => Array.from(editor.element.querySelectorAll<HTMLElement>('.md-attachment-source'));
    expect(sources().map((node) => node.textContent)).toEqual([image, file]);
    expect(sources().every((node) => node.hidden)).toBe(true);
    const chips = Array.from(editor.element.querySelectorAll<HTMLElement>('[data-md-attachment]'));
    expect(chips.map((chip) => chip.dataset.mdAttachment)).toEqual(['image', 'file']);
    expect(chips[0].querySelector('img')?.getAttribute('src')).toBe('asset://C:/Data/attachments/1-0/图.png');
    expect(chips[1].textContent).toBe('报告.pdf');
    caretAt(editor, imageEnd);
    expect(sources().every((node) => node.hidden)).toBe(true);
    caretAt(editor, fileStart);
    expect(sources().every((node) => node.hidden)).toBe(true);
    expect(editor.getValue()).toBe(value);
  });

  it('退格、删除与选中删除都按整个引用处理', () => {
    const editor = mountWithAttachments();
    caretAt(editor, imageEnd);
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe(`看和${file}完`);
    caretAt(editor, 2);
    input(editor, 'deleteContentForward');
    expect(editor.getValue()).toBe('看和完');
    editor.setValue(value);
    editor.element.focus();
    // 选区一端落在引用之中：整个引用连同选中的文字一起删除。
    editor.setSelectionRange(0, imageStart + 4, 'forward');
    input(editor, 'deleteContentBackward');
    expect(editor.getValue()).toBe(`和${file}完`);
  });

  it('复制含附件的选区时带上完整原文', () => {
    const editor = mountWithAttachments();
    editor.element.focus();
    editor.setSelectionRange(0, imageEnd + 1, 'forward');
    expect(clip(editor, 'copy')).toBe(`看${image}和`);
  });

  it('点击附件交给应用，带上原文范围与地址', () => {
    const received: Array<{ kind: string; start: number; end: number; source: string; target: string; label: string }> = [];
    const editor = mountWithAttachments((attachment) => received.push(attachment));
    editor.element.querySelectorAll<HTMLElement>('[data-md-attachment]').forEach((chip) => chip.click());
    expect(received).toEqual([
      { kind: 'image', start: imageStart, end: imageEnd, source: image, target: 'C:/Data/attachments/1-0/图.png', label: '图' },
      { kind: 'file', start: fileStart, end: fileEnd, source: file, target: 'C:/Data/attachments/2-0/报 告.pdf', label: '报告.pdf' },
    ]);
  });

  it('网页链接照常在光标进入时展开原文', () => {
    const { editor } = mount('[官网](https://example.com)');
    expect(editor.element.querySelector('[data-md-attachment]')).toBeNull();
    caretAt(editor, 3);
    expect(Array.from(editor.element.querySelectorAll<HTMLElement>('.md-syntax')).some((node) => !node.hidden)).toBe(true);
  });
});

describe('编辑面中移动原文（拖动选中的文字与附件）', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /** 拖动附件松开时的移动（私有方法，拖动的指针与布局在桌面端验证）。 */
  function moveAttachment(editor: MarkdownEditor, start: number, end: number, target: number): boolean {
    return (editor as unknown as { moveAttachment: (a: number, b: number, c: number) => boolean }).moveAttachment(start, end, target);
  }

  it('选中的文字移到落点，可以撤销；落点在原文之内时不动', () => {
    const { editor } = mount('甲乙丙丁');
    editor.element.focus();
    expect(editor.moveText(0, 1, 3)).toBe(true);
    expect(editor.getValue()).toBe('乙丙甲丁');
    expect(editor.moveText(1, 3, 2)).toBe(false);
    expect(editor.getValue()).toBe('乙丙甲丁');
    editor.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }));
    expect(editor.getValue()).toBe('甲乙丙丁');
  });

  it('附件移到字符之间，原来独占的一行整行去掉', () => {
    const image = '![图](C:/a/图.png)';
    const value = `标题\n第一段\n${image}\n第二段`;
    const { editor } = mount(value);
    const start = value.indexOf(image);
    // 放到「第二段」的「二」之后。
    const target = value.indexOf('二') + 1;
    expect(moveAttachment(editor, start, start + image.length, target)).toBe(true);
    expect(editor.getValue()).toBe(`标题\n第一段\n第二${image}段`);
  });

  it('夹在两个空格之间的附件移走后只留一个空格；落点在标题行时另起一行', () => {
    const file = '[报告.pdf](<C:/a/报告.pdf>)';
    const value = `标题\n前 ${file} 后`;
    const { editor } = mount(value);
    const start = value.indexOf(file);
    expect(moveAttachment(editor, start, start + file.length, 1)).toBe(true);
    expect(editor.getValue()).toBe(`标题\n${file}\n前 后`);
  });
});
