# 开发任务

本文跟踪 SideNotes 桌面端的开发任务，是判断当前进度的主要依据。

任务状态分为四种：待开始、进行中、已完成、阻塞。只有通过验收标准中列出的验证，任务才标记为已完成；未经验证的部分写入[已知问题](./known-issues.md)。

## 当前版本

0.6.3（预览版）。版本号以 `package.json` 为准，`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 同步修改。

## 任务列表

| 编号 | 任务 | 优先级 | 状态 | 验收标准 |
| --- | --- | --- | --- | --- |
| T01 | 工程骨架：Tauri 2、React 19、Vite 8、TypeScript | 高 | 已完成 | `pnpm tauri build` 产出 NSIS 与 MSI 安装包 |
| T02 | 迁移核心模块：记录模型、标签解析、Markdown、实时编辑器 | 高 | 已完成 | `pnpm test` 全部通过 |
| T03 | 本地存储：SQLite 快照读写、回收站到期清理 | 高 | 已完成 | `cargo test` 通过；重启后数据保留 |
| T04 | 多窗口数据同步：侧栏、速记、设置三个窗口互不覆盖 | 高 | 已完成 | 单元测试覆盖设置合并写入、写入失败回滚、读库期间丢弃过时结果；桌面端验证在设置窗口改设置后，侧栏新写的记录仍在，主题在三个窗口间双向同步 |
| T05 | 设置窗口按原型一比一还原 | 高 | 已完成 | 五个分类与回收站确认层在浅色、深色下与原型逐项比对：共有元素的位置与尺寸一致，计算样式一致；桌面端打开、Esc 关闭、最小化、还原、关闭按钮均已验证 |
| T06 | 侧栏出入平移动画，时长可配置 | 中 | 进行中 | 桌面端人工确认滑入、滑出、中途反向均平滑 |
| T07 | 侧栏与速记浮窗的界面细节对齐原型 | 中 | 进行中 | 逐项对照原型确认 |
| T08 | 列表按需加载（设置中的「列表加载」） | 中 | 待开始 | 滚动到底部按批追加，批量大小随设置变化 |
| T09 | 卡片拖动排序与批量选择 | 中 | 待开始 | 与原型 interactions.js 行为一致 |
| T10 | 更换数据存储位置并迁移数据 | 低 | 待开始 | 切换目录后数据完整迁移，旧目录保留备份 |
| T11 | 云端自动备份 | 低 | 待开始 | 可选功能；接入前设置页只保存配置 |

## 开发与验证命令

```bash
pnpm install
```

```bash
pnpm tauri dev
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm test
```

```bash
pnpm tauri build
```

浏览器预览可单独查看各窗口界面：先运行 `pnpm dev`，再访问 `http://localhost:1420/?window=settings`（设置）或 `?window=capture`（速记）。浏览器预览不连接数据库，仅用于检查界面；加上 `&debug-data=1` 可载入示例记录。

## 验证方法

**与原型比对**：用 Python 启动原型的静态服务（`python -m http.server 5181 --directory docs/prototype`），与 `pnpm dev` 同时运行；分别打开原型的设置弹窗与应用的 `?window=settings`（视口 880×720），逐个分类导出截图、DOM 轮廓（标签、类名、文字与相对坐标）和计算样式后比对。`.claude/launch.json` 记录了这两个预览服务。

**桌面端调试**：WebView2 支持远程调试，启动时设置环境变量即可用 DevTools 协议连接三个窗口，检查运行时行为：

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9555 pnpm tauri dev
```

连接后访问 `http://127.0.0.1:9555/json` 获取各窗口的调试地址。该方式会读写真实的应用数据，验证前应先备份 `%APPDATA%\com.limuhua.sidenotes` 目录下的数据库文件。
