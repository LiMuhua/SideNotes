/**
 * 应用图标页（本次提出）：定稿的 6 个内置图标，以及按轮次留下的设计演进记录。
 *
 * 上半部分是定稿：一览、单个图标的尺寸阶梯与像素放大、使用场景、全部图标的小尺寸对照与资源文件。
 * 图片直接取随应用打包的资源（src-tauri/icons/builtin/，见 model/appIcons.ts），看到的就是安装包里的文件。
 * 下半部分是设计演进（说明与历史图标见 appIconHistory.ts）。
 * 这一页是展示台，用固定的中性配色，不随主题与明暗变化；图标在浅色与深色背景上的效果另外并排列出。
 */

import { useState } from 'react';
import { APP_ICONS, DEFAULT_APP_ICON, ICO_SIZES, PNG_SIZES, builtinAppIcon, type BuiltinAppIcon } from '../model/appIcons';
import { useNotes } from '../model/notes';
import { FAMILIES, FINAL_NOTES, HISTORY_ICONS, ROUNDS, SIZE_USES } from './appIconHistory';

const historyFiles = import.meta.glob<string>('../../../icon-history/*.svg', { eager: true, query: '?url', import: 'default' });

/** 尺寸阶梯显示到 256；512 太大，只在资源文件中列出。 */
const LADDER_SIZES = PNG_SIZES.filter((size) => size <= 256);
const PIXEL_SIZES = [16, 20, 24, 32];
const COMPARE_SIZES = [16, 20, 24, 32, 48, 64];

const SECTIONS = [
  { id: 'icons-final', label: '定稿' },
  { id: 'icons-sizes', label: '尺寸' },
  { id: 'icons-scenes', label: '使用场景' },
  { id: 'icons-compare', label: '对照' },
  { id: 'icons-files', label: '资源文件' },
  { id: 'icons-history', label: '设计演进' },
];

/** 不小于 size 的最小一张 PNG。 */
function png(icon: BuiltinAppIcon, size: number): string {
  return (icon.png.find((item) => item.size >= size) ?? icon.png[icon.png.length - 1]).url;
}

/** 按 100% 缩放显示：普通屏幕用同尺寸的 PNG，高分屏用两倍尺寸的，避免把小图放大得发虚。 */
function Sized({ icon, size, className }: { icon: BuiltinAppIcon; size: number; className?: string }) {
  return <img className={className} src={png(icon, size)} srcSet={`${png(icon, size)} 1x, ${png(icon, size * 2)} 2x`} width={size} height={size} alt="" draggable={false} />;
}

/** 缩略图：id 是历史图标的编号或定稿图标的 id；compact 时只写编号，名称放进悬停提示（演进线用）。 */
function Thumb({ id, size = 64, compact = false }: { id: string; size?: number; compact?: boolean }) {
  const history = HISTORY_ICONS[id];
  const final = history ? null : builtinAppIcon(id);
  const url = history ? historyFiles[`../../../icon-history/${history.file}`] : final?.svg;
  const number = history ? id : final?.number;
  const name = history ? history.name : final?.name;
  return (
    <figure className={`pg-icons-thumb${compact ? ' is-compact' : ''}`} title={compact ? `${number} ${name}` : undefined}>
      <img src={url} width={size} height={size} alt="" draggable={false} />
      <figcaption>
        <span className="pg-icons-number">{number}</span>
        {compact ? null : name}
        {final && !compact ? <span className="pg-icons-badge">定稿</span> : null}
      </figcaption>
    </figure>
  );
}

export function AppIconsPage() {
  const [selected, setSelected] = useState(DEFAULT_APP_ICON);
  const icon = builtinAppIcon(selected);
  return (
    <div className="pg-icons">
      <div className="pg-icons-content">
        <header className="pg-icons-intro">
          <h1>应用图标</h1>
          <p>
            定稿为 172、210、211、212、213、214 六个内置图标，默认 211。资源在 <code>src-tauri/icons/builtin/</code>，随安装包放到 <code>app-icons/</code>；
            设置的「外观与交互 › 显示」可以在它们与上传的图片之间切换。下面先看单个图标的各个尺寸与使用场景，最后是设计演进。
          </p>
        </header>
        <nav className="pg-icons-toc" aria-label="本页目录">
          {SECTIONS.map((section) => (
            <button key={section.id} type="button" onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
              {section.label}
            </button>
          ))}
        </nav>

        <section id="icons-final" className="pg-icons-section">
          <h2>定稿</h2>
          <div className="pg-icons-finals" role="radiogroup" aria-label="查看的图标">
            {APP_ICONS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={item.id === selected} className="pg-icons-final" onClick={() => setSelected(item.id)}>
                <img src={item.svg} width={88} height={88} alt="" draggable={false} />
                <span className="pg-icons-final-name">
                  <span className="pg-icons-number">{item.number}</span>
                  {item.name}
                </span>
                {item.id === DEFAULT_APP_ICON ? <span className="pg-icons-badge">默认</span> : null}
              </button>
            ))}
          </div>
          <Detail icon={icon} />
        </section>

        <Sizes icon={icon} />
        <Scenes icon={icon} />
        <Compare selected={selected} />
        <Files icon={icon} />
        <History />
      </div>
    </div>
  );
}

/** 选中图标的大图、说明、演进线，以及设为当前图标。 */
function Detail({ icon }: { icon: BuiltinAppIcon }) {
  const { appIcon, setAppIcon } = useNotes();
  const note = FINAL_NOTES[icon.id];
  const family = note ? FAMILIES[note.family] : null;
  const siblings = APP_ICONS.filter((item) => FINAL_NOTES[item.id]?.family === note?.family);
  return (
    <div className="pg-icons-detail">
      <div className="pg-icons-hero">
        <img src={icon.svg} width={256} height={256} alt={`${icon.number} ${icon.name}`} draggable={false} />
      </div>
      <div className="pg-icons-meta">
        <h3>
          <span className="pg-icons-number">{icon.number}</span>
          {icon.name}
          {icon.id === DEFAULT_APP_ICON ? <span className="pg-icons-badge">默认</span> : null}
        </h3>
        <p>{note?.idea}</p>
        <div className="pg-icons-actions">
          {appIcon === icon.id ? (
            <span className="pg-icons-current">Playground 正在使用这个图标</span>
          ) : (
            <button type="button" className="pg-icons-button" onClick={() => setAppIcon(icon.id)}>
              设为当前应用图标
            </button>
          )}
        </div>
        {family ? (
          <div className="pg-icons-lineage">
            <h4>演进线 · {family.name}</h4>
            <ol>
              {family.steps.map((step) => (
                <li key={step.join('+')}>
                  {step.map((id) => (
                    <Thumb key={id} id={id} size={40} compact />
                  ))}
                </li>
              ))}
              <li className="is-final">
                {siblings.map((item) => (
                  <Thumb key={item.id} id={item.id} size={40} compact />
                ))}
              </li>
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 尺寸阶梯按屏幕的实际像素显示（一个图标像素对应一个屏幕像素），再把小尺寸放大 4 倍看像素。 */
function Sizes({ icon }: { icon: BuiltinAppIcon }) {
  const ratio = window.devicePixelRatio || 1;
  return (
    <section id="icons-sizes" className="pg-icons-section">
      <h2>尺寸</h2>
      <p className="pg-icons-note">
        每个尺寸都从母版直接渲染，不由大图缩小。阶梯按屏幕的实际像素显示{ratio === 1 ? '' : `（当前屏幕缩放 ${Math.round(ratio * 100)}%，所以看起来比标称尺寸小）`}；放大一栏把小尺寸放大 4 倍，看每个像素。
      </p>
      {(['light', 'dark'] as const).map((tone) => (
        <div key={tone} className={`pg-icons-ladder is-${tone}`}>
          {LADDER_SIZES.map((size) => (
            <figure key={size}>
              <img src={png(icon, size)} style={{ width: size / ratio, height: size / ratio }} alt="" draggable={false} />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
      ))}
      <div className="pg-icons-pixels">
        {(['light', 'dark'] as const).map((tone) => (
          <div key={tone} className={`pg-icons-pixel-row is-${tone}`}>
            {PIXEL_SIZES.map((size) => (
              <figure key={size}>
                <img src={png(icon, size)} width={size * 4} height={size * 4} alt="" draggable={false} />
                <figcaption>
                  {size}px
                  <small>{SIZE_USES[size]}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 使用场景：Windows 任务栏与托盘、桌面、资源管理器、Linux 程序坞与 Android 桌面，按 100% 缩放。 */
function Scenes({ icon }: { icon: BuiltinAppIcon }) {
  return (
    <section id="icons-scenes" className="pg-icons-section">
      <h2>使用场景</h2>
      <div className="pg-icons-scenes">
        {(['light', 'dark'] as const).map((tone) => (
          <figure key={tone} className="pg-icons-scene is-wide">
            <div className={`pg-scene-taskbar is-${tone}`}>
              <span className="pg-scene-apps">
                <span className="pg-scene-app is-start" />
                <span className="pg-scene-app is-a" />
                <span className="pg-scene-app is-b" />
                <span className="pg-scene-running">
                  <Sized icon={icon} size={24} />
                </span>
              </span>
              <span className="pg-scene-tray">
                <span className="pg-scene-chevron">⌃</span>
                <Sized icon={icon} size={16} />
                <span className="pg-scene-clock">
                  14:32
                  <br />
                  2026/11/10
                </span>
              </span>
            </div>
            <figcaption>Windows 任务栏（{tone === 'light' ? '浅色' : '深色'}）：设置窗口打开时的任务栏按钮 24px，托盘 16px</figcaption>
          </figure>
        ))}
        <figure className="pg-icons-scene">
          <div className="pg-scene-desktop">
            <span className="pg-scene-shortcut">
              <Sized icon={icon} size={48} />
              SideNotes
            </span>
          </div>
          <figcaption>桌面快捷方式 48px</figcaption>
        </figure>
        <figure className="pg-icons-scene">
          <div className="pg-scene-explorer">
            <span className="pg-scene-file">
              <Sized icon={icon} size={96} />
              SideNotes.exe
            </span>
          </div>
          <figcaption>资源管理器 · 大图标 96px</figcaption>
        </figure>
        <figure className="pg-icons-scene">
          <div className="pg-scene-dock">
            <span className="pg-scene-dock-app is-a" />
            <span className="pg-scene-dock-app">
              <Sized icon={icon} size={48} />
            </span>
            <span className="pg-scene-dock-app is-b" />
          </div>
          <figcaption>Linux 程序坞 48px</figcaption>
        </figure>
        <figure className="pg-icons-scene">
          <div className="pg-scene-phone">
            <span className="pg-scene-launcher">
              <Sized icon={icon} size={56} className="is-round" />
              SideNotes
            </span>
          </div>
          <figcaption>Android 桌面（圆形遮罩）</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** 全部定稿图标在小尺寸下并排，浅色与深色任务栏各一组。 */
function Compare({ selected }: { selected: string }) {
  return (
    <section id="icons-compare" className="pg-icons-section">
      <h2>对照</h2>
      <p className="pg-icons-note">六个图标在任务栏与托盘常见尺寸下的样子，按 100% 缩放显示。</p>
      <div className="pg-icons-compare">
        {(['light', 'dark'] as const).map((tone) => (
          <table key={tone} className={`is-${tone}`}>
            <thead>
              <tr>
                <th>{tone === 'light' ? '浅色' : '深色'}</th>
                {COMPARE_SIZES.map((size) => (
                  <th key={size}>{size}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {APP_ICONS.map((item) => (
                <tr key={item.id} className={item.id === selected ? 'is-selected' : undefined}>
                  <th>
                    {item.number} {item.name}
                  </th>
                  {COMPARE_SIZES.map((size) => (
                    <td key={size}>
                      <Sized icon={item} size={size} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

/** 选中图标的资源文件：点击打开实际文件。 */
function Files({ icon }: { icon: BuiltinAppIcon }) {
  const folder = `src-tauri/icons/builtin/${icon.number}-${icon.id}`;
  return (
    <section id="icons-files" className="pg-icons-section">
      <h2>资源文件</h2>
      <p className="pg-icons-note">
        <code>{folder}/</code>，安装后位于 <code>app-icons/{icon.number}-{icon.id}/</code>。默认图标另外生成 <code>src-tauri/icons/</code>{' '}
        的全套平台图标（安装包、窗口、托盘、Android）。修改母版后运行 <code>pnpm icons</code> 重新生成。
      </p>
      <table className="pg-icons-files">
        <tbody>
          <tr>
            <th>
              <a href={icon.svg} target="_blank" rel="noreferrer">
                icon.svg
              </a>
            </th>
            <td>母版，64 × 64 视图框</td>
          </tr>
          <tr>
            <th>
              <a href={icon.ico} target="_blank" rel="noreferrer">
                icon.ico
              </a>
            </th>
            <td>Windows：{ICO_SIZES.join('、')} 共 {ICO_SIZES.length} 个尺寸，覆盖各缩放比例下的托盘、任务栏与资源管理器</td>
          </tr>
          {icon.png.map((item) => (
            <tr key={item.size}>
              <th>
                <a href={item.url} target="_blank" rel="noreferrer">
                  png/{item.size}.png
                </a>
              </th>
              <td>{SIZE_USES[item.size]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 设计演进：每一轮留几版代表，第一轮只有文字。 */
function History() {
  return (
    <section id="icons-history" className="pg-icons-section">
      <h2>设计演进</h2>
      <p className="pg-icons-note">
        从第一版到定稿的六轮，每轮留几版代表；其余版本已从目录中撤下，保留在 Git 历史里。决定与理由见 <code>docs/design-system/design-decisions.md</code> 第三十七、三十九节。
      </p>
      <ol className="pg-icons-rounds">
        {ROUNDS.map((round) => (
          <li key={round.title}>
            <div className="pg-icons-round-text">
              <h3>{round.title}</h3>
              <p>{round.note}</p>
            </div>
            <div className="pg-icons-round-icons">
              {round.icons.map((id) => (
                <Thumb key={id} id={id} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
