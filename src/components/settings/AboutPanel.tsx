/**
 * 关于。
 *
 * 结构对应原型 settings.js 的 renderAbout：版本信息、项目入口与开源致谢。
 * 外部链接交给系统浏览器打开，不在设置窗口内跳转。
 * 末尾的「调试」为桌面端新增，打开各窗口的开发者工具，便于排查界面问题。
 */

import { useState } from 'react';
import logoUrl from '../../assets/favicon.svg';
import * as bridge from '../../core/bridge';
import { useToast } from '../../hooks/useToast';
import { Icon } from '../Icon';
import { ActionButton, Group } from './controls';

/** 开源致谢，与原型列表一致。 */
const CREDITS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Tauri', 'https://tauri.app/', '◈', '桌面与跨平台运行时'],
  ['React', 'https://react.dev/', '⚛', '界面方案参考'],
  ['Vite', 'https://vite.dev/', 'ϟ', '开发与构建工具'],
  ['SQLite', 'https://sqlite.org/', '▱', '本地数据方案参考'],
  ['Filee', 'https://github.com/KnifeLemon/Filee', '▣', '桌面外观与交互参考'],
];

/** 可打开开发者工具的窗口。 */
const DEVTOOLS: ReadonlyArray<readonly [bridge.WindowLabel, string]> = [
  ['main', '侧栏'],
  ['capture', '速记浮窗'],
  ['settings', '设置'],
];

/** 图标式外部链接。 */
function ExternalLink({ label, url, glyph, description }: { label: string; url: string; glyph: string; description: string }) {
  const toast = useToast();
  return (
    <a
      className="resource-link settings-external-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={description || label}
      onClick={(event) => {
        event.preventDefault();
        void bridge.openExternal(url).catch(() => toast('无法打开链接，请检查默认浏览器设置', null, true));
      }}
    >
      <span className="resource-icon" aria-hidden="true">
        {glyph}
      </span>
      <span>{label}</span>
      <Icon name="arrow-up-right" />
    </a>
  );
}

export function AboutPanel() {
  const toast = useToast();
  const [sponsor, setSponsor] = useState(false);

  return (
    <>
      <div className="about-hero settings-about-logo">
        <img src={logoUrl} alt="" />
        <h3>SideNotes</h3>
        <span className="settings-version">桌面预览版 {__APP_VERSION__}</span>
        <p className="setting-description">本地速记 · 置顶取用 · 用后归档</p>
      </div>
      <Group title="项目">
        <div className="resource-links about-links settings-about-links">
          <ExternalLink label="GitHub" url="https://github.com/" glyph="⌘" description="项目地址占位：GitHub 首页" />
          <ExternalLink label="官方网站" url="https://example.com/" glyph="🌐" description="官网地址占位：example.com" />
          <ActionButton
            label="支持项目"
            className="resource-link sponsor-button"
            leading={
              <span className="resource-icon" aria-hidden="true">
                ♡
              </span>
            }
            onClick={() => setSponsor((shown) => !shown)}
          />
          <ActionButton
            label="检查更新"
            icon="restore"
            className="resource-link settings-update-button"
            onClick={() => toast('更新服务待桌面端接入')}
          />
        </div>
        {sponsor ? (
          <p className="setting-description sponsor-note">赞助入口暂未开放，也欢迎通过反馈与代码贡献支持项目。</p>
        ) : null}
      </Group>
      <Group title="开源致谢">
        <p className="setting-description">感谢开源项目与社区的支持。</p>
        <div className="resource-links settings-credits">
          {CREDITS.map(([label, url, glyph, description]) => (
            <ExternalLink key={label} label={label} url={url} glyph={glyph} description={description} />
          ))}
        </div>
      </Group>
      <Group title="调试">
        <p className="setting-description">打开窗口的开发者工具，查看控制台输出与页面结构。</p>
        <div className="resource-links settings-debug-links">
          {DEVTOOLS.map(([label, name]) => (
            <ActionButton
              key={label}
              label={name}
              icon="code"
              className="resource-link"
              title={`打开${name}的开发者工具`}
              aria-label={`打开${name}的开发者工具`}
              onClick={() => void bridge.openDevtools(label).catch(() => toast('无法打开开发者工具', null, true))}
            />
          ))}
        </div>
      </Group>
    </>
  );
}
