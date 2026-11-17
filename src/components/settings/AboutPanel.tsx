/**
 * 关于（原型第二版，与交互原型 settings.js 的 renderAbout 相同）。
 *
 * - 第一块是图标、名称与一句介绍，右侧是版本号与「检查更新」。
 * - 项目与开源致谢是带边框的按钮，按内容宽度排开、放不下自然换行；致谢的名称后面写许可证。
 *   项目一行最后是本项目的许可证 AGPL-3.0（与仓库根目录的 LICENSE 相同）。
 * - 调试只有一个按钮：打开侧栏窗口的开发者工具。
 * 外部链接交给系统浏览器打开，不在设置窗口内跳转；按钮与链接不加悬停提示。
 */

import logoUrl from '../../assets/favicon.svg';
import * as bridge from '../../core/bridge';
import { useToast } from '../../hooks/useToast';
import { Icon, type IconName } from '../Icon';
import { ActionButton, Group } from './controls';

/** 项目链接：名称、地址与图标。 */
const PROJECT_LINKS: ReadonlyArray<readonly [string, string, IconName]> = [
  ['GitHub', 'https://github.com/', 'code'],
  ['官方网站', 'https://example.com/', 'globe'],
  ['支持项目', 'https://github.com/sponsors', 'heart'],
  ['AGPL-3.0', 'https://www.gnu.org/licenses/agpl-3.0.html', 'file-text'],
];

/**
 * 开源致谢：只列桌面端实际用到的组件（package.json 与 src-tauri/Cargo.toml 的依赖，以及随应用打包的字体），
 * 名称、地址、符号与许可证，与原型相同。
 */
const CREDITS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Tauri', 'https://tauri.app/', '◈', 'MIT / Apache-2.0'],
  ['React', 'https://react.dev/', '⚛', 'MIT'],
  ['Vite', 'https://vite.dev/', 'ϟ', 'MIT'],
  ['TypeScript', 'https://www.typescriptlang.org/', 'TS', 'Apache-2.0'],
  ['SQLite', 'https://sqlite.org/', '▱', '公有领域'],
  ['rusqlite', 'https://github.com/rusqlite/rusqlite', 'Rs', 'MIT'],
  ['serde', 'https://serde.rs/', '{}', 'MIT / Apache-2.0'],
  ['windows-rs', 'https://github.com/microsoft/windows-rs', '⊞', 'MIT / Apache-2.0'],
  ['Maple Mono', 'https://github.com/subframe7536/maple-font', 'Aa', 'OFL-1.1'],
];

/** 外部链接（原型 externalLink）：图标或符号、名称、许可证（有时）与右上箭头。 */
function ExternalLink({ label, url, icon, glyph, note }: { label: string; url: string; icon?: IconName; glyph?: string; note?: string }) {
  const toast = useToast();
  return (
    <a
      className={note ? 'resource-link settings-external-link has-note' : 'resource-link settings-external-link'}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void bridge.openExternal(url).catch(() => toast('无法打开链接，请检查默认浏览器设置', null, true));
      }}
    >
      {icon ? (
        <Icon name={icon} />
      ) : (
        <span className="resource-icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="resource-name">{label}</span>
      {note ? <span className="resource-note">{note}</span> : null}
      <Icon name="arrow-up-right" />
    </a>
  );
}

export function AboutPanel() {
  const toast = useToast();

  return (
    <>
      <div className="about-hero settings-about-logo">
        <img src={logoUrl} alt="" />
        <h3>SideNotes</h3>
        <p className="setting-description">藏在屏幕边上的速记本</p>
        <div className="about-release">
          <span className="settings-version">{`桌面预览版 ${__APP_VERSION__}`}</span>
          <ActionButton
            label="检查更新"
            icon="restore"
            className="resource-link settings-update-button"
            onClick={() => toast('更新服务待桌面端接入')}
          />
        </div>
      </div>
      <Group title="项目">
        <div className="resource-links about-links settings-about-links about-link-buttons">
          {PROJECT_LINKS.map(([label, url, icon]) => (
            <ExternalLink key={label} label={label} url={url} icon={icon} />
          ))}
        </div>
      </Group>
      <Group title="开源致谢">
        <div className="resource-links settings-credits about-link-buttons">
          {CREDITS.map(([label, url, glyph, note]) => (
            <ExternalLink key={label} label={label} url={url} glyph={glyph} note={note} />
          ))}
        </div>
      </Group>
      <Group title="调试">
        <ActionButton
          label="打开开发者工具"
          icon="code"
          onClick={() => void bridge.openDevtools('main').catch(() => toast('无法打开开发者工具', null, true))}
        />
      </Group>
    </>
  );
}
