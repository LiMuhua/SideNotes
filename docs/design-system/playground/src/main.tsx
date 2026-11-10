/**
 * Design Playground 入口（design-playground.html，开发服务器地址 /design-playground）。
 *
 * 只在开发服务器中访问，不进入正式构建（vite build 只打包 index.html），
 * 也不改动 src/main.tsx 的窗口角色判断。数据全部是内存中的示例数据。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/fonts.css';
import '../../tokens/base.css';
import '../../tokens/terminal.css';
import '../../tokens/magazine.css';
import '../../tokens/paper.css';
import '../../tokens/win11.css';
import '../../tokens/glass.css';
import './styles/base.css';
import './styles/components.css';
import './styles/controls.css';
import './styles/content.css';
import './styles/sidebar.css';
import './styles/windows.css';
import './styles/desktop.css';
import './styles/pages.css';
import './styles/icons.css';
import './styles/shell.css';
import { NotesProvider } from './model/notes';
import { Shell } from './shell/Shell';
import { PlaygroundProvider } from './shell/state';
import { PlaygroundSprite } from './ui/Icon';

const container = document.getElementById('playground-root');
if (!container) throw new Error('找不到 #playground-root');

createRoot(container).render(
  <StrictMode>
    <PlaygroundProvider>
      <NotesProvider>
        <PlaygroundSprite />
        <Shell />
      </NotesProvider>
    </PlaygroundProvider>
  </StrictMode>,
);
