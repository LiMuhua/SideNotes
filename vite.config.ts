// 使用 vitest/config 的 defineConfig：它在 Vite 配置类型上补充 test 字段，
// Vite 自身会忽略该字段，两个工具因此共用同一份别名与插件配置。
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Tauri 在开发期通过固定端口加载前端，端口冲突时应直接失败而非静默切换。
const host = process.env.TAURI_DEV_HOST;

// 版本号只在 package.json 维护一处，构建时注入界面，避免多处手写版本。
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/**
 * 移除原型样式中按视口宽高生效的媒体查询。
 *
 * 原型是在大屏浏览器中展示的页面，侧栏、速记与设置都只是其中的面板；这些查询面向小屏浏览器。
 * 桌面端每个窗口就是一个面板，视口即面板尺寸，保留它们会让 416 像素宽的侧栏错用原型的窄屏布局。
 * 只处理 prototype.css，减少动态效果等偏好类查询保留，原型文件本身不做改动。
 */
const stripViewportMedia = {
  postcssPlugin: 'sidenotes-strip-viewport-media',
  AtRule: {
    media(rule: { params: string; source?: { input: { file?: string } }; remove: () => void }) {
      if (!rule.source?.input.file?.replace(/\\/g, '/').endsWith('/styles/prototype.css')) return;
      if (/\((?:max|min)-(?:width|height)\s*:/.test(rule.params)) rule.remove();
    },
  },
};

/**
 * 开发服务器把 /design-playground 转到设计系统目录中的 Playground 页面。
 *
 * 页面与源码一起放在 docs/design-system/playground/，仓库根目录只保留应用自己的 index.html。
 * 这里只改写请求路径，地址栏与地址参数保持不变，`pnpm playground` 打开的地址也不用改。
 * 只在开发服务器中生效；vite build 只打包根目录的 index.html，Playground 不进入正式构建。
 */
const designPlaygroundPage = '/docs/design-system/playground/index.html';
const designPlayground: Plugin = {
  name: 'sidenotes-design-playground',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '';
      const queryStart = url.indexOf('?');
      const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
      if (pathname === '/design-playground' || pathname === '/design-playground/') {
        req.url = designPlaygroundPage + (queryStart === -1 ? '' : url.slice(queryStart));
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), designPlayground],
  css: {
    postcss: { plugins: [stripViewportMedia] },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 使用固定端口，避免 WebView 加载到错误地址。
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Rust 侧产物由 cargo 监视，前端无需重复监听。
      ignored: ['**/src-tauri/**'],
    },
  },
  // 目标为 Tauri 自带 WebView2（Chromium），无需兼容旧版浏览器。
  // Vite 8 起压缩由 Oxc 承担，`esbuild` 需额外安装且已废弃，这里使用默认压缩器。
  build: {
    target: 'chrome120',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    environment: 'jsdom',
    // docs/design-system 下是设计系统的检查：令牌齐全、关键颜色组合的对比度达标、产品样式只引用令牌。
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'docs/design-system/**/*.test.ts', 'docs/design-system/**/*.test.tsx'],
    globals: false,
  },
});
