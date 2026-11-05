/**
 * 五套对比：五个方向的侧栏放在同一张壁纸上，每个侧栏都可以操作；数据共享，浏览状态各自独立。
 * 下方的表格列出结构差异（directions.ts）与关键令牌的取值（直接从令牌文件解析）。
 */

import { useMemo } from 'react';
import { resolve } from '../../../tokens/parse';
import { SidebarPanel } from '../app/SidebarPanel';
import { WorkWindow } from '../app/WorkWindow';
import { DIRECTIONS, type DirectionSpec } from '../directions';
import { Scaled } from '../shell/Stage';
import { usePlayground } from '../shell/state';
import { TokenScope } from '../ui/Scope';
import { directionTokens } from './Tokens';

const SLOT = { width: 440, height: 860, gap: 28 };
const CANVAS = { width: DIRECTIONS.length * SLOT.width + (DIRECTIONS.length + 1) * SLOT.gap, height: SLOT.height + 72 };
const noop = () => {};

const STRUCTURE: ReadonlyArray<{ label: string; value: (direction: DirectionSpec) => string }> = [
  { label: '与屏幕边缘', value: (d) => ({ flush: '贴边的一整块', floating: '离开边缘的浮动面板', blocks: '分开的几块' })[d.dock] },
  { label: '记录', value: (d) => ({ panes: '带标题栏的窗格', cards: '带底色的卡片', tiles: '各自独立的玻璃块' })[d.entries] },
  { label: '页签', value: (d) => (d.tabs === 'underline' ? '文字加下划线' : '分段控件') },
  { label: '透出桌面', value: (d) => (d.translucent ? '是：需要透明窗口与系统材质' : '否：实心表面') },
  { label: '底栏', value: (d) => (d.statusLine ? '常驻状态栏与快捷键提示' : '存储状态与设置') },
  { label: '快捷键显示', value: (d) => (d.inlineShortcuts ? '直接显示在界面上' : '写在工具提示中') },
];

const TOKEN_ROWS: ReadonlyArray<{ label: string; tokens: string[] }> = [
  { label: '界面字体', tokens: ['--sn-font-ui'] },
  { label: '界面字号 / 正文字号', tokens: ['--sn-font-size-md', '--sn-note-size'] },
  { label: '面板离边 / 圆角 / 模糊', tokens: ['--sn-panel-inset', '--sn-panel-radius', '--sn-panel-blur'] },
  { label: '卡片圆角 / 间隙', tokens: ['--sn-card-radius', '--sn-card-gap'] },
  { label: '强调色（浅色 / 深色）', tokens: ['light:--sn-color-accent', 'dark:--sn-color-accent'] },
  { label: '动效（快 / 常规 / 慢）', tokens: ['--sn-duration-fast', '--sn-duration-normal', '--sn-duration-slow'] },
];

/** 字体栈只显示第一个字体名。 */
function shortValue(value: string): string {
  return value.includes(',') ? value.split(',')[0].replace(/['"]/g, '') : value;
}

export function ComparePage() {
  const { resolvedWallpaper, set } = usePlayground();
  const tables = useMemo(() => new Map(DIRECTIONS.map((d) => [d.id, { light: directionTokens(d.id, 'light'), dark: directionTokens(d.id, 'dark') }])), []);

  return (
    <div className="pg-compare">
      <Scaled width={CANVAS.width} height={CANVAS.height}>
        <div className="sn-desktop is-compare" data-wallpaper={resolvedWallpaper} style={{ width: CANVAS.width, height: CANVAS.height }}>
          <div className="sn-desk-wallpaper" aria-hidden="true" />
          <div className="sn-compare-backdrop" aria-hidden="true">
            <WorkWindow />
          </div>
          <div className="sn-compare-row">
            {DIRECTIONS.map((direction) => (
              <section key={direction.id} className="sn-compare-slot" style={{ width: SLOT.width }} aria-label={direction.name}>
                <p className="sn-compare-label">
                  {direction.name}
                  {direction.preference === 'primary' ? <span className="sn-compare-badge">首选</span> : null}
                  {direction.preference === 'alternative' ? <span className="sn-compare-badge">备选</span> : null}
                </p>
                <div className="sn-sidebar-frame is-visible is-static" data-edge="right" style={{ width: SLOT.width, height: SLOT.height }}>
                  <TokenScope direction={direction.id} className="sn-window sn-sidebar-window">
                    <SidebarPanel pinned onTogglePinned={noop} onHide={noop} onOpenSettings={noop} />
                  </TokenScope>
                </div>
              </section>
            ))}
          </div>
        </div>
      </Scaled>
      <table className="pg-compare-table">
        <thead>
          <tr>
            <th scope="col">维度</th>
            {DIRECTIONS.map((direction) => (
              <th key={direction.id} scope="col">
                <button type="button" className="pg-link" onClick={() => set({ direction: direction.id, page: 'sidebar' })}>
                  {direction.name}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">理念</th>
            {DIRECTIONS.map((direction) => (
              <td key={direction.id}>{direction.idea}</td>
            ))}
          </tr>
          {STRUCTURE.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {DIRECTIONS.map((direction) => (
                <td key={direction.id}>{row.value(direction)}</td>
              ))}
            </tr>
          ))}
          {TOKEN_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {DIRECTIONS.map((direction) => {
                const table = tables.get(direction.id);
                const values = row.tokens.map((name) => {
                  const [theme, token] = name.includes(':') ? (name.split(':') as ['light' | 'dark', string]) : (['light', name] as const);
                  return table ? shortValue(resolve(table[theme], token)) : '';
                });
                return (
                  <td key={direction.id}>
                    <code>{values.join(' / ')}</code>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="row">参考</th>
            {DIRECTIONS.map((direction) => (
              <td key={direction.id}>{direction.references.join('、')}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
