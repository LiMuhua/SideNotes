/**
 * 快捷键。
 *
 * 点击按键后按下新的组合即可更换；与其它快捷键冲突、全局快捷键被其他程序占用时提示原因，按键保持不变，
 * 可以接着按别的组合，Esc 取消。分组即生效范围：全局（任何程序中）、应用内（侧栏与速记浮窗）、
 * 格式（编辑记录时）；标题、缩进与粘贴为纯文本的按键固定，只列出不能更换。
 *
 * 录入时 Windows 上由后端接管键盘（见 bridge.recordShortcut），被其他程序占用的组合也能录到；
 * 其它环境用网页的按键事件。全局快捷键录到后由后端实际注册一次，注册成功才保存到设置。
 */

import { useEffect, useRef, useState } from 'react';
import * as bridge from '../../core/bridge';
import {
  FIXED_SHORTCUTS,
  SHORTCUT_COMMANDS,
  bindingOf,
  comboFromEvent,
  displayCombo,
  isGlobalShortcut,
  modifiersOf,
  shortcutProblem,
  withBinding,
  type GlobalShortcutId,
  type ShortcutCommand,
  type ShortcutGroup,
  type ShortcutId,
} from '../../core/shortcuts';
import type { Settings } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { ActionButton, Group, Row, classes, type SaveSettings } from './controls';

/** 分组：生效范围与问号中的说明。 */
const GROUPS: ReadonlyArray<{ group: ShortcutGroup; title: string; help: string }> = [
  { group: 'global', title: '全局', help: '在任何程序中都能使用' },
  { group: 'app', title: '应用内', help: '在侧栏与速记浮窗中使用' },
  { group: 'format', title: '格式', help: '只在编辑记录时生效' },
];

/** 问号中的补充说明：另外固定可用的按键，以及链接读取剪贴板的用法。 */
function noteOf(command: ShortcutCommand): string | undefined {
  if (command.alias) return `也可按 ${displayCombo(command.alias)}`;
  if (command.id === 'link') return '剪贴板中是网址时直接生成链接';
  return undefined;
}

function labelOf(id: ShortcutId): string {
  return SHORTCUT_COMMANDS.find((command) => command.id === id)?.label ?? id;
}

/** 更换全局快捷键：交给后端实际注册，被占用时抛出原因。 */
function registerGlobal(id: GlobalShortcutId, combo: string): Promise<void> {
  const update: Partial<Record<GlobalShortcutId, string>> = {};
  update[id] = combo;
  return bridge.setGlobalShortcuts(update);
}

/** 一行快捷键：名称、改过时的「恢复默认」与按键。 */
function ShortcutRow({
  command,
  keys,
  recording,
  held,
  failed,
  message,
  onRecord,
  onCancel,
  onReset,
}: {
  command: ShortcutCommand;
  keys: string;
  recording: boolean;
  /** 录入时正按住的修饰键。 */
  held: string;
  /** 全局快捷键注册失败（多半被其他程序占用）。 */
  failed: boolean;
  /** 按下的组合不能用时的原因，写在按键左侧（原型 shortcut-message）；按键不变，可以接着按别的组合。 */
  message: string;
  onRecord: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const text = recording ? (held ? `${displayCombo(held)} + …` : '按下新快捷键') : displayCombo(keys);
  return (
    <Row title={command.label} description={noteOf(command)}>
      <span className="shortcut-binding">
        <span className="shortcut-message" role="status" hidden={!message}>
          {message}
        </span>
        {keys !== command.defaultKeys && !recording ? (
          <ActionButton
            label={`恢复默认 ${displayCombo(command.defaultKeys)}`}
            icon="restore"
            className="icon-button shortcut-reset"
            onClick={onReset}
          />
        ) : null}
        <button
          type="button"
          className={classes('shortcut-key', recording && 'is-recording', failed && 'is-error')}
          aria-label={
            recording ? `正在录入「${command.label}」的快捷键，Esc 取消` : `更换「${command.label}」的快捷键，当前为 ${displayCombo(keys)}`
          }
          aria-pressed={recording}
          onClick={onRecord}
          onBlur={onCancel}
        >
          <kbd>{text}</kbd>
        </button>
      </span>
    </Row>
  );
}

export interface ShortcutsPanelProps {
  settings: Settings;
  save: SaveSettings;
  /** 注册失败（多半被其他程序占用）的全局快捷键。 */
  conflicts: GlobalShortcutId[];
  /** 全局快捷键变化后重新读取注册失败的列表。 */
  onConflictsChange: () => void;
}

export function ShortcutsPanel({ settings, save, conflicts, onConflictsChange }: ShortcutsPanelProps) {
  const toast = useToast();
  const bindings = settings.shortcuts;
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [held, setHeld] = useState('');
  /** 不能用的组合与原因，写在那一行的按键左侧；开始录入别的命令或换成功后清除。 */
  const [message, setMessage] = useState<{ id: ShortcutId; text: string } | null>(null);
  // 正在注册或保存时不处理新的组合，避免同一次更换提交两遍。
  const busy = useRef(false);
  // 录入回调读取最新的设置与冲突列表；录入本身只随正在录入的命令开始与结束。
  const onKeys = useRef<(keys: bridge.RecordedKeys) => void>(() => {});

  // 打开快捷键页时重试注册失败的全局快捷键：占用它的程序可能已经退出。逐个重试，互不连累。
  const [initialConflicts] = useState(conflicts);
  const [initialBindings] = useState(bindings);
  useEffect(() => {
    if (!initialConflicts.length) return;
    let alive = true;
    void (async () => {
      for (const id of initialConflicts) {
        await registerGlobal(id, bindingOf(initialBindings, id)).catch(() => {});
      }
      if (alive) onConflictsChange();
    })();
    return () => {
      alive = false;
    };
  }, [initialConflicts, initialBindings, onConflictsChange]);

  /**
   * 把命令改成按键 `combo`。冲突或被占用时提示原因并返回 false，按键不变；
   * 已经生效（含与原来相同）或保存失败（已提示）时返回 true，结束录入。
   */
  const apply = async (command: ShortcutCommand, combo: string): Promise<boolean> => {
    const current = bindingOf(bindings, command.id);
    const global = isGlobalShortcut(command.id) ? command.id : null;
    // 与原来相同时不必更换；全局快捷键注册失败过的，再注册一次。
    if (combo === current && !(global && conflicts.includes(global))) return true;
    const problem = shortcutProblem(command.id, combo, bindings);
    if (problem) {
      setMessage({ id: command.id, text: `${displayCombo(combo)}：${problem}` });
      return false;
    }
    if (busy.current) return false;
    busy.current = true;
    try {
      if (global) {
        try {
          await registerGlobal(global, combo);
        } catch (error) {
          setMessage({ id: command.id, text: `${displayCombo(combo)}：${bridge.errorText(error, '无法设为全局快捷键')}` });
          return false;
        } finally {
          onConflictsChange();
        }
      }
      if (await save({ shortcuts: withBinding(bindings, command.id, combo) })) {
        setMessage(null);
        toast(`「${command.label}」改为 ${displayCombo(combo)}`);
      } else if (global) {
        // 设置没有保存（已提示）：全局快捷键换回原来的按键，与保存的设置一致。
        await registerGlobal(global, current).catch(() => {});
        onConflictsChange();
      }
      return true;
    } finally {
      busy.current = false;
    }
  };

  const handleKeys = (keys: bridge.RecordedKeys): void => {
    const command = SHORTCUT_COMMANDS.find((item) => item.id === recording);
    if (!command) return;
    if (keys.ended) {
      setRecording(null);
      return;
    }
    if (!keys.combo) {
      setHeld(keys.modifiers);
      return;
    }
    // 组合被拒绝时修饰键可能还按着，继续显示。
    setHeld(keys.modifiers);
    if (keys.combo === 'Escape') {
      setRecording(null);
      return;
    }
    void apply(command, keys.combo).then((done) => {
      if (done) setRecording((value) => (value === command.id ? null : value));
    });
  };

  useEffect(() => {
    onKeys.current = handleKeys;
  });

  /* 录入：后端录入就绪之前、或不支持后端录入时，用网页的按键事件。后端录入期间按下被它吞掉，
   * 网页只收到松开与不认识的按键，这些只拦下，不再当作录入。 */
  useEffect(() => {
    if (!recording) return;
    let active = true;
    let stopNative: (() => void) | null = null;
    const deliver = (keys: bridge.RecordedKeys): void => {
      if (active) onKeys.current(keys);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      // 录入期间的按键只用来录入：不关闭设置窗口，也不触发别的快捷键。
      event.preventDefault();
      event.stopPropagation();
      if (stopNative) return;
      deliver({
        modifiers: modifiersOf(event),
        combo: event.type === 'keydown' ? comboFromEvent(event) : null,
        ended: false,
      });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    void bridge.recordShortcut(deliver).then((stop) => {
      if (active) stopNative = stop;
      else stop?.();
    });
    return () => {
      active = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      stopNative?.();
    };
  }, [recording]);

  const record = (id: ShortcutId): void => {
    setHeld('');
    setMessage((value) => (value?.id === id ? value : null));
    // 再点一次正在录入的按键即取消。
    setRecording((value) => (value === id ? null : id));
  };

  const reset = (command: ShortcutCommand): void => {
    setRecording(null);
    void apply(command, command.defaultKeys);
  };

  return (
    <>
      {conflicts.length ? (
        <p className="settings-notice is-error">
          {`${conflicts.map((id) => `「${labelOf(id)}」${displayCombo(bindingOf(bindings, id))}`).join('、')} 被其他程序占用，没有生效，请点击按键换一个`}
        </p>
      ) : null}
      <div className="settings-dashboard shortcuts-dashboard">
        {GROUPS.map(({ group, title, help }) => (
          <Group
            key={group}
            title={title}
            description={help}
            className={classes('shortcut-section', group === 'format' && 'shortcut-format')}
          >
            <div className="shortcut-grid">
              {SHORTCUT_COMMANDS.filter((command) => command.group === group).map((command) => (
                <ShortcutRow
                  key={command.id}
                  command={command}
                  keys={bindingOf(bindings, command.id)}
                  recording={recording === command.id}
                  held={held}
                  failed={isGlobalShortcut(command.id) && conflicts.includes(command.id)}
                  message={message?.id === command.id ? message.text : ''}
                  onRecord={() => record(command.id)}
                  onCancel={() => setRecording((value) => (value === command.id ? null : value))}
                  onReset={() => reset(command)}
                />
              ))}
              {group === 'format'
                ? FIXED_SHORTCUTS.map((fixed) => (
                    <Row key={fixed.label} title={fixed.label}>
                      <kbd className="shortcut-key is-fixed">{fixed.display}</kbd>
                    </Row>
                  ))
                : null}
            </div>
          </Group>
        ))}
      </div>
    </>
  );
}

/** 标题栏右侧的「恢复默认」：全部快捷键改回默认按键。全局快捷键恢复失败时整体不变。 */
export function ShortcutsReset({
  settings,
  save,
  onConflictsChange,
}: {
  settings: Settings;
  save: SaveSettings;
  onConflictsChange: () => void;
}) {
  const toast = useToast();
  const changed = Object.keys(settings.shortcuts).length > 0;

  const resetAll = async (): Promise<void> => {
    const globals: Partial<Record<GlobalShortcutId, string>> = {};
    for (const command of SHORTCUT_COMMANDS) {
      if (isGlobalShortcut(command.id) && settings.shortcuts[command.id]) globals[command.id] = command.defaultKeys;
    }
    if (Object.keys(globals).length) {
      try {
        await bridge.setGlobalShortcuts(globals);
      } catch (error) {
        toast(`没有恢复默认：全局快捷键${bridge.errorText(error, '无法注册')}`, null, true);
        return;
      } finally {
        onConflictsChange();
      }
    }
    if (await save({ shortcuts: {} })) toast('已恢复默认快捷键');
  };

  return (
    <ActionButton
      label="恢复默认"
      icon="restore"
      disabled={!changed}
      onClick={() => void resetAll()}
    />
  );
}
