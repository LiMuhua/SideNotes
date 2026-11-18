/**
 * 用示例数据启动一份桌面端：`pnpm tauri:dev:sample`。
 *
 * 应用标识换成 com.limuhua.sidenotes.sample，数据目录与 WebView 的用户目录都和正式数据分开，不会写到平时用的数据库；
 * 前端在 1450 端口单独起一个开发服务器（覆盖的配置见 src-tauri/tauri.sample.conf.json），构建时带上 VITE_SIDENOTES_SAMPLE_DATA=1，第一次启动（数据库为空）就写入
 * 全部示例记录（见 src/debug/sample-notes.ts），用来测全局搜索、按页签分组与按需加载。
 * 想重新生成示例时，退出后删除 %APPDATA%\com.limuhua.sidenotes.sample 目录再启动。
 *
 * 与 `pnpm tauri:dev` 同时运行时两边共用 Rust 的编译目录，后启动的一方会等前一方编译完。
 */

import { spawn } from 'node:child_process';

// 覆盖的配置写在文件里：Windows 上经由命令行传 JSON 时，引号会被 cmd 去掉。
const CONFIG = 'src-tauri/tauri.sample.conf.json';

const child = spawn('pnpm', ['tauri', 'dev', '--config', CONFIG], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_SIDENOTES_SAMPLE_DATA: '1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
