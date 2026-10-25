import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri 在开发期通过固定端口加载前端，端口冲突时应直接失败而非静默切换。
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
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
  build: {
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
