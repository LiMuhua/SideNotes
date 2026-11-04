import { describe, expect, it } from 'vitest';
import {
  bindingOf,
  comboFromEvent,
  commandFor,
  displayCombo,
  isGlobalShortcut,
  matches,
  modifiersOf,
  normalizeBindings,
  normalizeCombo,
  shortcutProblem,
  withBinding,
  type KeyInput,
} from './shortcuts';

/** 构造按键事件需要的字段。 */
function key(code: string, modifiers: Partial<Pick<KeyInput, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}, keyCode = 0): KeyInput {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code, keyCode, ...modifiers };
}

describe('快捷键', () => {
  it('按键事件写成规范写法：修饰键固定顺序，键名取物理按键', () => {
    expect(comboFromEvent(key('Space', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+Space');
    expect(comboFromEvent(key('KeyS', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+S');
    expect(comboFromEvent(key('BracketLeft', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+[');
    expect(comboFromEvent(key('NumpadEnter', { ctrlKey: true }))).toBe('Ctrl+Enter');
    expect(comboFromEvent(key('F5'))).toBe('F5');
    // 只按下修饰键、按下不支持的键时没有结果；没有扫描码时按虚拟键码换算。
    expect(comboFromEvent(key('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(key('Numpad1', { ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(key('', { ctrlKey: true }, 75))).toBe('Ctrl+K');
    expect(comboFromEvent(key('', { altKey: true }, 219))).toBe('Alt+[');
    // 录入时显示正按住的修饰键。
    expect(modifiersOf(key('ShiftLeft', { shiftKey: true, metaKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+Win');
    expect(modifiersOf(key('KeyA'))).toBe('');
  });

  it('整理保存的写法与绑定：大小写与顺序不限，无法识别的与和默认相同的不保存', () => {
    expect(normalizeCombo('shift+ctrl+space')).toBe('Ctrl+Shift+Space');
    expect(normalizeCombo('alt+f12')).toBe('Alt+F12');
    expect(normalizeCombo('Ctrl+Ctrl+A')).toBeNull();
    expect(normalizeCombo('Hyper+A')).toBeNull();
    expect(normalizeCombo('Ctrl+')).toBeNull();
    expect(normalizeBindings({ bold: 'ctrl+shift+b', italic: 'Ctrl+I', unknown: 'Ctrl+J', link: 3 })).toEqual({ bold: 'Ctrl+Shift+B' });
    expect(normalizeBindings(null)).toEqual({});
  });

  it('按当前绑定匹配事件，没有改过的用默认按键', () => {
    const bindings = { bold: 'Ctrl+Shift+B' };
    expect(bindingOf(bindings, 'bold')).toBe('Ctrl+Shift+B');
    expect(bindingOf(bindings, 'italic')).toBe('Ctrl+I');
    expect(matches(key('KeyB', { ctrlKey: true, shiftKey: true }), bindings, 'bold')).toBe(true);
    expect(matches(key('KeyB', { ctrlKey: true }), bindings, 'bold')).toBe(false);
    expect(commandFor(key('KeyI', { ctrlKey: true }), bindings, ['format'])).toBe('italic');
    expect(commandFor(key('KeyN', { ctrlKey: true }), bindings, ['format'])).toBeNull();
    expect(displayCombo('Ctrl+Shift+Space')).toBe('Ctrl + Shift + Space');
  });

  it('更换一项后的绑定只保存与默认不同的按键', () => {
    expect(withBinding({}, 'bold', 'Ctrl+Shift+B')).toEqual({ bold: 'Ctrl+Shift+B' });
    expect(withBinding({ bold: 'Ctrl+Shift+B', italic: 'Alt+I' }, 'bold', 'Ctrl+B')).toEqual({ italic: 'Alt+I' });
    expect(isGlobalShortcut('capture')).toBe(true);
    expect(isGlobalShortcut('save')).toBe(false);
  });

  it('检查冲突：与其它命令、固定快捷键、编辑通用按键相同时说明原因', () => {
    expect(shortcutProblem('bold', 'Ctrl+I', {})).toBe('与「斜体」冲突');
    expect(shortcutProblem('bold', 'Ctrl+3', {})).toBe('与「标题 / 正文」冲突');
    expect(shortcutProblem('bold', 'Ctrl+Z', {})).toBe('与「撤销」冲突');
    expect(shortcutProblem('bold', 'Alt+Shift+5', {})).toBe('与「删除线」冲突');
    expect(shortcutProblem('strike', 'Alt+Shift+5', {})).toBeNull();
    expect(shortcutProblem('bold', 'Ctrl+Shift+B', {})).toBeNull();
    // 改过的按键让出原来的位置：斜体改走后，Ctrl+I 可以给加粗。
    expect(shortcutProblem('bold', 'Ctrl+I', { italic: 'Ctrl+Shift+I' })).toBeNull();
    // 应用内快捷键要带 Ctrl 或 Alt，功能键除外；Win 键只用于全局快捷键。
    expect(shortcutProblem('search', 'Shift+F', {})).toBe('需要按住 Ctrl 或 Alt，以免影响打字');
    expect(shortcutProblem('search', 'F3', {})).toBeNull();
    expect(shortcutProblem('bold', 'Ctrl+Win+B', {})).toBe('Win 键只能用于全局快捷键');
  });

  it('全局快捷键至少两个修饰键，不能占用 Windows 的组合键与应用内的按键', () => {
    expect(shortcutProblem('capture', 'Ctrl+J', {})).toBe('至少按住两个修饰键，或一个修饰键加功能键');
    expect(shortcutProblem('capture', 'Ctrl+F9', {})).toBeNull();
    expect(shortcutProblem('capture', 'Ctrl+Alt+Delete', {})).toBe('已被 Windows 使用');
    expect(shortcutProblem('capture', 'Shift+Win+S', {})).toBe('已被 Windows 使用');
    expect(shortcutProblem('capture', 'Ctrl+Win+N', {})).toBeNull();
    expect(shortcutProblem('capture', 'Alt+Shift+S', {})).toBe('与「呼出侧栏」冲突');
    expect(shortcutProblem('capture', 'Ctrl+Shift+K', {})).toBe('与「代码块」冲突');
    expect(shortcutProblem('capture', 'Ctrl+Alt+N', {})).toBeNull();
  });
});
