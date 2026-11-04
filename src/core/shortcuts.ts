/**
 * 快捷键：可以重新绑定的命令、按键的规范写法、事件匹配与冲突检查。
 *
 * 按键写成「Ctrl+Alt+Shift+Win+键」，修饰键按这个顺序，键名取物理按键（KeyboardEvent.code），
 * 不受输入法与键盘布局影响，如 Ctrl+Shift+Space、Alt+S、Ctrl+Shift+[。设置中只保存改过的命令，
 * 没有保存的使用默认按键。全局快捷键（呼出速记、呼出侧栏）由后端注册为系统热键，
 * 其余在应用窗口内生效；格式快捷键只在编辑记录时生效。
 */

/** 可以重新绑定的命令。 */
export type ShortcutId =
  | 'capture'
  | 'sidebar'
  | 'newNote'
  | 'search'
  | 'save'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'inlineCode'
  | 'codeBlock'
  | 'quote'
  | 'orderedList'
  | 'bulletList';

/** 全局快捷键：在任何程序中都能呼出 SideNotes。 */
export type GlobalShortcutId = Extract<ShortcutId, 'capture' | 'sidebar'>;

/** 命令所在的分组：全局、侧栏，或只在编辑时生效的格式。 */
export type ShortcutGroup = 'global' | 'app' | 'format';

export interface ShortcutCommand {
  id: ShortcutId;
  label: string;
  group: ShortcutGroup;
  defaultKeys: string;
  /** 另外固定可用、不能更换的按键（兼容 Typora 的写法）。 */
  alias?: string;
}

/** 改过的按键；没有出现的命令使用默认按键。 */
export type ShortcutBindings = Partial<Record<ShortcutId, string>>;

export const SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  { id: 'capture', label: '呼出速记', group: 'global', defaultKeys: 'Ctrl+Shift+Space' },
  { id: 'sidebar', label: '呼出侧栏', group: 'global', defaultKeys: 'Alt+Shift+S' },
  { id: 'newNote', label: '新建记录', group: 'app', defaultKeys: 'Ctrl+N' },
  { id: 'search', label: '搜索记录与标签', group: 'app', defaultKeys: 'Ctrl+F' },
  { id: 'save', label: '保存记录', group: 'app', defaultKeys: 'Ctrl+Enter' },
  { id: 'bold', label: '加粗', group: 'format', defaultKeys: 'Ctrl+B' },
  { id: 'italic', label: '斜体', group: 'format', defaultKeys: 'Ctrl+I' },
  { id: 'underline', label: '下划线', group: 'format', defaultKeys: 'Ctrl+U' },
  { id: 'strike', label: '删除线', group: 'format', defaultKeys: 'Alt+S', alias: 'Alt+Shift+5' },
  { id: 'link', label: '链接', group: 'format', defaultKeys: 'Ctrl+K' },
  { id: 'inlineCode', label: '行内代码', group: 'format', defaultKeys: 'Alt+C', alias: 'Ctrl+Shift+`' },
  { id: 'codeBlock', label: '代码块', group: 'format', defaultKeys: 'Ctrl+Shift+K' },
  { id: 'quote', label: '引用', group: 'format', defaultKeys: 'Ctrl+Shift+Q' },
  { id: 'orderedList', label: '有序列表', group: 'format', defaultKeys: 'Ctrl+Shift+[' },
  { id: 'bulletList', label: '无序列表', group: 'format', defaultKeys: 'Ctrl+Shift+]' },
];

/** 不能更换、只在设置页列出的快捷键，以及它们占用的按键。 */
export const FIXED_SHORTCUTS: ReadonlyArray<{ label: string; display: string; keys: readonly string[] }> = [
  { label: '标题 / 正文', display: 'Ctrl + 1–6 / 0', keys: ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+0'] },
  { label: '缩进 / 减少缩进', display: 'Tab / Shift + Tab', keys: ['Tab', 'Shift+Tab'] },
  { label: '粘贴为纯文本', display: 'Ctrl + Shift + V', keys: ['Ctrl+Shift+V'] },
];

/** 编辑中通用、也不能占用的按键。 */
const EDITING_KEYS: Readonly<Record<string, string>> = {
  'Ctrl+Z': '撤销',
  'Ctrl+Y': '重做',
  'Ctrl+Shift+Z': '重做',
  'Ctrl+A': '全选',
  'Ctrl+C': '复制',
  'Ctrl+X': '剪切',
  'Ctrl+V': '粘贴',
  Enter: '换行',
  'Shift+Enter': '换行',
  Escape: '退出编辑',
};

/** Windows 自己使用的组合键（含输入法切换与打开右键菜单），全局快捷键不能占用。 */
const SYSTEM_KEYS: ReadonlySet<string> = new Set([
  'Alt+Tab',
  'Alt+F4',
  'Alt+Escape',
  'Alt+Space',
  'Shift+F10',
  'Ctrl+Escape',
  'Ctrl+Alt+Delete',
  'Ctrl+Shift+Escape',
  'Ctrl+Space',
  'Shift+Space',
  'Ctrl+Alt+Tab',
  ...['A', 'D', 'E', 'G', 'H', 'I', 'K', 'L', 'M', 'P', 'R', 'S', 'U', 'V', 'X', '.', 'Tab', 'Space'].map((key) => `Win+${key}`),
  'Shift+Win+S',
]);

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Win'] as const;

/** 物理按键对应的键名。 */
const CODE_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** 可以写进快捷键的键名。 */
const KEY_NAMES: ReadonlySet<string> = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ...Object.values(CODE_NAMES),
]);

/** 虚拟键码对应的物理按键，用于没有扫描码的输入来源。 */
const VIRTUAL_CODES: Readonly<Record<number, string>> = {
  8: 'Backspace',
  9: 'Tab',
  13: 'Enter',
  27: 'Escape',
  32: 'Space',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  45: 'Insert',
  46: 'Delete',
  186: 'Semicolon',
  187: 'Equal',
  188: 'Comma',
  189: 'Minus',
  190: 'Period',
  191: 'Slash',
  192: 'Backquote',
  219: 'BracketLeft',
  220: 'Backslash',
  221: 'BracketRight',
  222: 'Quote',
};

/** 按键事件中用到的字段。 */
export type KeyInput = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'code' | 'keyCode'>;

/**
 * 按键的物理位置（KeyboardEvent.code），不受输入法与键盘布局影响。
 *
 * 部分输入来源（自动化工具、远程桌面、按键映射软件）不带扫描码，code 为空，
 * 这时按虚拟键码换算字母、数字、功能键与常用符号键。
 */
export function physicalKey(event: Pick<KeyboardEvent, 'code' | 'keyCode'>): string {
  if (event.code) return event.code;
  const vk = event.keyCode;
  if (vk >= 65 && vk <= 90) return `Key${String.fromCharCode(vk)}`;
  if (vk >= 48 && vk <= 57) return `Digit${vk - 48}`;
  if (vk >= 112 && vk <= 135) return `F${vk - 111}`;
  return VIRTUAL_CODES[vk] ?? '';
}

/** 物理按键对应的键名；修饰键本身与不支持的按键（如小键盘数字）返回 null。 */
function keyName(code: string): string | null {
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return letter[1];
  const digit = code.match(/^Digit([0-9])$/);
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_NAMES[code] ?? null;
}

function compose(modifiers: readonly string[], key: string): string {
  return [...MODIFIERS.filter((modifier) => modifiers.includes(modifier)), key].join('+');
}

/** 按键事件中按住的修饰键，按 Ctrl、Alt、Shift、Win 的顺序。 */
function heldModifiers(event: Pick<KeyInput, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string[] {
  const held = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey];
  return MODIFIERS.filter((_, index) => held[index]);
}

/** 按住的修饰键写成「Ctrl+Shift」，录入快捷键时显示；没有按住时为空字符串。 */
export function modifiersOf(event: Pick<KeyInput, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  return heldModifiers(event).join('+');
}

/** 按键事件写成规范的快捷键；只按下修饰键或按下不支持的键时返回 null。 */
export function comboFromEvent(event: KeyInput): string | null {
  const key = keyName(physicalKey(event));
  return key ? compose(heldModifiers(event), key) : null;
}

/** 把保存的写法整理为规范写法（修饰键大小写与顺序不限）；无法识别时返回 null。 */
export function normalizeCombo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((part) => part.trim());
  // 「Ctrl++」这样以加号为键的写法不支持；空段说明写法有误。
  if (parts.some((part) => !part)) return null;
  const key = parts.pop() ?? '';
  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS.find((name) => name.toLowerCase() === part.toLowerCase());
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  const name = key.length === 1 ? key.toUpperCase() : [...KEY_NAMES].find((item) => item.toLowerCase() === key.toLowerCase());
  return name && KEY_NAMES.has(name) ? compose(modifiers, name) : null;
}

/** 整理设置中保存的按键：只留认识的命令与能识别的写法，与默认按键相同的不保存。 */
export function normalizeBindings(value: unknown): ShortcutBindings {
  const bindings: ShortcutBindings = {};
  if (typeof value !== 'object' || value === null) return bindings;
  for (const command of SHORTCUT_COMMANDS) {
    const combo = normalizeCombo((value as Record<string, unknown>)[command.id]);
    if (combo && combo !== command.defaultKeys) bindings[command.id] = combo;
  }
  return bindings;
}

/** 命令当前的按键。 */
export function bindingOf(bindings: ShortcutBindings, id: ShortcutId): string {
  return bindings[id] ?? SHORTCUT_COMMANDS.find((command) => command.id === id)?.defaultKeys ?? '';
}

/** 把命令 `id` 改成按键 `combo` 之后要保存的绑定：改回默认按键的不再保存。 */
export function withBinding(bindings: ShortcutBindings, id: ShortcutId, combo: string): ShortcutBindings {
  return normalizeBindings({ ...bindings, [id]: combo });
}

/** 是否为全局快捷键（由后端注册为系统热键）。 */
export function isGlobalShortcut(id: ShortcutId): id is GlobalShortcutId {
  return SHORTCUT_COMMANDS.some((command) => command.id === id && command.group === 'global');
}

/** 按键事件是否就是这个命令的快捷键。 */
export function matches(event: KeyInput, bindings: ShortcutBindings, id: ShortcutId): boolean {
  const combo = comboFromEvent(event);
  return combo !== null && combo === bindingOf(bindings, id);
}

/** 按键事件对应的命令（只在给定分组中查找），没有时返回 null。 */
export function commandFor(event: KeyInput, bindings: ShortcutBindings, groups: readonly ShortcutGroup[]): ShortcutId | null {
  const combo = comboFromEvent(event);
  if (!combo) return null;
  const command = SHORTCUT_COMMANDS.find((item) => groups.includes(item.group) && bindingOf(bindings, item.id) === combo);
  return command?.id ?? null;
}

/** 显示用的写法，如 Ctrl + Shift + Space。 */
export function displayCombo(combo: string): string {
  return combo.split('+').join(' + ');
}

/**
 * 把命令 `id` 改成按键 `combo` 是否可以：不可以时返回原因。
 * 全局快捷键至少要两个修饰键（或一个修饰键加功能键），不能占用 Windows 自己的组合键；
 * 其余快捷键要带 Ctrl 或 Alt（功能键除外），以免影响打字，也不能带 Win 键：窗口内的 Win 组合多半先被系统截走。
 * 任何命令都不能与其它命令或固定快捷键相同。
 * 全局快捷键是否已被其他程序占用，要由后端实际注册一次才能知道（见 bridge.setGlobalShortcuts）。
 */
export function shortcutProblem(id: ShortcutId, combo: string, bindings: ShortcutBindings): string | null {
  const command = SHORTCUT_COMMANDS.find((item) => item.id === id);
  if (!command) return '未知的快捷键';
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  const functionKey = /^F\d+$/.test(key);
  if (command.group === 'global') {
    if (modifiers.length < 2 && !(functionKey && modifiers.length >= 1)) {
      return '至少按住两个修饰键，或一个修饰键加功能键';
    }
    if (SYSTEM_KEYS.has(combo)) return '已被 Windows 使用';
  } else if (modifiers.includes('Win')) {
    return 'Win 键只能用于全局快捷键';
  } else if (!functionKey && !modifiers.some((modifier) => modifier !== 'Shift')) {
    return '需要按住 Ctrl 或 Alt，以免影响打字';
  }
  for (const other of SHORTCUT_COMMANDS) {
    if (other.id === id) continue;
    if (bindingOf(bindings, other.id) === combo || other.alias === combo) return `与「${other.label}」冲突`;
  }
  if (command.alias === combo) return null;
  for (const fixed of FIXED_SHORTCUTS) {
    if (fixed.keys.includes(combo)) return `与「${fixed.label}」冲突`;
  }
  if (EDITING_KEYS[combo]) return `与「${EDITING_KEYS[combo]}」冲突`;
  return null;
}
