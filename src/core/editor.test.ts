import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor } from './editor';

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
