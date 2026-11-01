/**
 * 快捷键。
 *
 * 对应原型 settings.js 的 renderShortcuts：记录与浏览分两栏，动作在左、按键在右。
 * 桌面端额外列出启动时注册失败的全局快捷键，便于排查与其它程序的冲突，
 * 并新增编辑记录时的 Markdown 格式快捷键（见 core/markdown-commands）。
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

const FORMATTING: ReadonlyArray<readonly [string, string]> = [
  ['加粗', 'Ctrl + B'],
  ['斜体', 'Ctrl + I'],
  ['下划线', 'Ctrl + U'],
  ['删除线', 'Alt + S'],
  ['链接', 'Ctrl + K'],
  ['行内代码', 'Alt + C'],
  ['代码块', 'Ctrl + Shift + K'],
  ['标题 / 正文', 'Ctrl + 1–6 / 0'],
  ['引用', 'Ctrl + Shift + Q'],
  ['有序 / 无序列表', 'Ctrl + Shift + [ / ]'],
  ['缩进 / 减少缩进', 'Tab / Shift + Tab'],
  ['粘贴为纯文本', 'Ctrl + Shift + V'],
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
        <Group title="格式" className="shortcut-section shortcut-format">
          <ShortcutGrid items={FORMATTING} />
          <p className="setting-description shortcut-format-note">
            列表与引用中回车自动续写，空项回车结束；粘贴网址、链接与代码时自动转换为 Markdown；
            剪贴板中是网址时按 Ctrl+K 直接生成链接；删除线也可按 Alt+Shift+5，下划线写作 &lt;u&gt;…&lt;/u&gt;，与 Typora 一致。
          </p>
        </Group>
      </div>
      <p className="settings-notice">所列快捷键固定生效，无需额外配置；中文选词期间不触发。</p>
    </>
  );
}
