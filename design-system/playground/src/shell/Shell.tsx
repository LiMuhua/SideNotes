/**
 * Playground 外壳：页面导航与预览设置（主题、明暗、平台、屏幕、壁纸），下面是预览区。
 *
 * 外壳本身不属于 SideNotes 的设计，只用自己的少量变量（shell.css 中的 --pg-*），
 * 不使用设计系统组件，避免把展示台与被展示的对象混在一起。
 * `frame=bare` 时只显示预览区，用于在指定尺寸下截图。
 */

import type { ReactNode } from 'react';
import { SURFACES } from '../surfaces';
import { useNotes } from '../model/notes';
import { Desktop } from '../app/Desktop';
import { ComparePage } from '../pages/Compare';
import { GalleryPage } from '../pages/Gallery';
import { IconCandidatesPage } from '../pages/IconCandidates';
import { TokensPage } from '../pages/Tokens';
import { Stage } from './Stage';
import { PAGES, usePlayground, VIEWPORTS, WALLPAPERS, type PageId, type ThemeMode } from './state';

const HINTS: Record<PageId, string> = {
  sidebar: '侧栏贴在屏幕边缘：单击或悬停选中，双击编辑，右键打开菜单，Ctrl+C 复制；收起后把鼠标移到屏幕边缘唤出，Alt+Shift+S 切换。浏览器保留了 Ctrl+N，新建请直接在顶部输入。',
  capture: '速记浮窗：在任何程序里按 Ctrl+Shift+Space 呼出，Ctrl+Enter 保存并收起，Esc 保留草稿并收起；草稿与侧栏的新建卡片共用。按住标题区可以拖动浮窗，放到不同的背景上检查材质。',
  settings: '设置窗口 960 × 720：明暗模式、主题、侧栏行为、字号等改动立即作用于所有窗口。字号是整页缩放（字号 ÷ 13）。',
  components: '当前主题与明暗下的组件与状态：卡片的各种状态、编辑模式、新建卡片、页签、筛选条、菜单、弹窗与提示条。',
  tokens: '当前主题与明暗下的全部令牌。数值从令牌文件解析，与设计系统测试检查的是同一份数据；半透明表面的对比度按纯黑与纯白背景中较差的一个计算。',
  compare: '五套主题的侧栏放在同一张壁纸上对比，每个侧栏都可以操作；数据共享，浏览状态各自独立。',
  icons: '应用图标的候选：最上面是第六轮的五个候选（210–214），下面依次是细化、居中表情、克制与生动两端与更早的深化版；每版有 256px 主图与浅色、深色背景上的 32px、16px 预览，顶部是任务栏与托盘尺寸的对照。这一页不受主题与明暗设置影响。',
};

const THEMES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

/** 外壳中的分段按钮：原生按钮组，aria-pressed 表示当前项。 */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="pg-choice" role="group" aria-label={label}>
      <span className="pg-choice-label">{label}</span>
      {options.map((option) => (
        <button key={option.value} type="button" className="pg-choice-option" aria-pressed={option.value === value} title={option.title} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PageContent({ page }: { page: PageId }) {
  const { viewport, platform, resolvedWallpaper } = usePlayground();
  const form = viewport === 'phone' ? 'phone' : 'desktop';
  const scene = { form, platform, wallpaper: resolvedWallpaper, primary: true } as const;
  switch (page) {
    case 'sidebar':
      return <Desktop key={`sidebar-${form}`} {...scene} initial={{ sidebar: 'open', pinned: true }} />;
    case 'capture':
      return <Desktop key={`capture-${form}`} {...scene} initial={{ sidebar: 'hidden', capture: true }} />;
    case 'settings':
      return <Desktop key={`settings-${form}`} {...scene} initial={{ sidebar: 'open', settings: 'appearance' }} />;
    case 'components':
      return <GalleryPage />;
    case 'tokens':
      return <TokensPage />;
    case 'compare':
      return <ComparePage />;
    case 'icons':
      return <IconCandidatesPage />;
  }
}

export function Shell() {
  const playground = usePlayground();
  const data = useNotes();
  const { page, surface, theme, platform, viewport, wallpaper, bare, set } = playground;
  const scenePage = PAGES.find((item) => item.id === page)?.group === 'app';
  const current = VIEWPORTS.find((item) => item.id === viewport) ?? VIEWPORTS[0];
  // 组件、令牌与对比页总是填满预览区。
  const stageViewport = scenePage ? current : VIEWPORTS[0];
  const content: ReactNode = <PageContent page={page} />;

  if (bare) {
    return (
      <div className="pg-shell is-bare" data-pg-theme={playground.resolvedTheme}>
        <Stage viewport={stageViewport} bare>
          {content}
        </Stage>
      </div>
    );
  }

  return (
    <div className="pg-shell" data-pg-theme={playground.resolvedTheme}>
      <header className="pg-bar">
        <div className="pg-brand">
          <span className="pg-brand-name">SideNotes</span>
          <span className="pg-brand-sub">Design Playground</span>
        </div>
        <nav className="pg-pages" aria-label="页面">
          {(['app', 'system'] as const).map((group) => (
            <div key={group} className="pg-page-group" role="group" aria-label={group === 'app' ? '应用窗口' : '设计系统'}>
              {PAGES.filter((item) => item.group === group).map((item) => (
                <button key={item.id} type="button" className="pg-page" aria-current={item.id === page ? 'page' : undefined} onClick={() => set({ page: item.id })}>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </header>
      <div className="pg-controls" role="toolbar" aria-label="预览设置">
        <Choice
          label="主题"
          value={surface}
          onChange={(value) => set({ surface: value })}
          options={SURFACES.map((item) => ({
            value: item.id,
            label: item.name,
            title: item.english,
          }))}
        />
        <Choice label="明暗" value={theme} onChange={(value) => set({ theme: value })} options={THEMES} />
        <Choice
          label="平台"
          value={platform}
          onChange={(value) => set({ platform: value })}
          options={[
            { value: 'windows', label: 'Windows' },
            { value: 'linux', label: 'Linux' },
          ]}
        />
        {scenePage || page === 'compare' ? (
          <label className="pg-select">
            <span className="pg-choice-label">壁纸</span>
            <select value={wallpaper} onChange={(event) => set({ wallpaper: event.target.value as typeof wallpaper })}>
              {WALLPAPERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scenePage ? (
          <label className="pg-select">
            <span className="pg-choice-label">屏幕</span>
            <select value={viewport} onChange={(event) => set({ viewport: event.target.value as typeof viewport })}>
              {VIEWPORTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="pg-spacer" />
        <button type="button" className="pg-button is-quiet" onClick={data.reset}>
          重置示例数据
        </button>
      </div>
      <p className="pg-hint">{HINTS[page]}</p>
      <main className="pg-main">
        <Stage viewport={stageViewport} bare={false}>
          {content}
        </Stage>
      </main>
    </div>
  );
}
