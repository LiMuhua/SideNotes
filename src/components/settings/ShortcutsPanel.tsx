/**
 * 快捷键。
 *
 * 对应原型 settings.js 的 renderShortcuts：记录与浏览分两栏，动作在左、按键在右。
 * 桌面端额外列出启动时注册失败的全局快捷键，便于排查与其它程序的冲突。
 */

import { Group, Row } from './controls';

const EDITING: ReadonlyArray<readonly [string, string]> = [
  ['新建记录', 'Ctrl + N'],
  ['呼出速记', 'Ctrl + Shift + Space'],
  ['保存并退出编辑', 'Ctrl + Enter'],
];

const BROWSING: ReadonlyArray<readonly [string, string]> = [
  ['搜索记录与标签', 'Ctrl + F'],
  ['呼出侧栏', 'Alt + Shift + S'],
];

function ShortcutGrid({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="shortcut-grid">
      {items.map(([label, keys]) => (
        <Row key={label} title={label}>
          <kbd>{keys}</kbd>
        </Row>
      ))}
    </div>
  );
}

export function ShortcutsPanel({ conflicts }: { conflicts: string[] }) {
  return (
    <>
      {conflicts.length ? (
        <p className="settings-notice is-error">
          以下全局快捷键注册失败，可能已被其他程序占用：{conflicts.join('、')}
        </p>
      ) : null}
      <div className="settings-dashboard shortcuts-dashboard">
        <Group title="记录" className="shortcut-section">
          <ShortcutGrid items={EDITING} />
        </Group>
        <Group title="浏览" className="shortcut-section">
          <ShortcutGrid items={BROWSING} />
        </Group>
      </div>
      <p className="settings-notice">所列快捷键固定生效，无需额外配置；中文选词期间不触发。</p>
    </>
  );
}
