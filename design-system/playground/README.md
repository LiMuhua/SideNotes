# Design Playground

SideNotes 设计系统的交互式预览：在模拟的桌面上运行侧栏、速记浮窗与设置窗口，五套视觉方向可以随时切换对比。数据只在内存中，不读写数据库，也不调用桌面接口。

## 启动

在工作树根目录运行：

```bash
pnpm playground
```

浏览器打开 `http://localhost:1430/design-playground`。Playground 固定使用 1430 端口（`--strictPort`），端口被占用时直接报错，不会改用其他端口；应用的开发服务器使用 1420，两者可以同时运行，方便对照实际应用。

## 页面

| 页面 | 内容 |
| --- | --- |
| 侧栏 | 模拟桌面上的侧栏：贴边滑出，按设置延迟收起；新建、搜索、编辑、菜单、多选都可以操作 |
| 速记浮窗 | 侧栏收起时用快捷键呼出的浮窗，草稿与新建卡片共用 |
| 设置 | 设置窗口的五个分类；修改立即作用于所有窗口 |
| 组件 | 卡片的各种状态、侧栏部件、菜单、弹窗、提示条与基础控件 |
| 令牌 | 当前方向与主题下的全部令牌，以及关键颜色组合的对比度 |
| 五套对比 | 五个侧栏并排放在同一张壁纸上，下方是结构差异对照表 |

## 控件与地址参数

顶部控件的状态写在地址中，可以直接分享或刷新：

| 控件 | 参数 | 取值 |
| --- | --- | --- |
| 页面 | `page` | `sidebar`、`capture`、`settings`、`components`、`tokens`、`compare` |
| 方向 | `direction` | `workbench`、`editorial`、`paper`、`fluent`、`glass` |
| 主题 | `theme` | `light`、`dark`、`system` |
| 平台 | `platform` | `windows`、`linux` |
| 壁纸 | `wallpaper` | `auto`（跟随主题）、`light`、`dark`、`busy`（繁杂，检验半透明表面） |
| 屏幕 | `viewport` | `fit`、`1920x1080`、`1440x900`、`1280x800`、`1024x768`、`phone`（Android 412 × 892） |

另外，`frame=bare` 只显示预览区并按 1:1 显示，用于截图。「重置示例数据」恢复 21 条示例记录与默认设置。

## 在模拟桌面中操作

- 侧栏收起后，把鼠标移到屏幕边缘唤出；任务栏托盘或 Linux 程序坞上的图标也可以切换。
- 页面获得焦点时模拟两个全局快捷键：Alt+Shift+S 切换侧栏，Ctrl+Shift+Space 呼出速记浮窗。
- 浏览器保留了 Ctrl+N 等组合键，新建记录请直接在新建卡片中输入。
- 附件按钮只显示提示，不读取本机文件。

## 目录

| 位置 | 内容 |
| --- | --- |
| `src/app/` | 桌面场景与三个窗口：侧栏、记录卡片、新建卡片、菜单与弹窗、速记浮窗、设置窗口 |
| `src/model/` | 内存中的记录与设置，规则沿用 `src/core` |
| `src/ui/` | 通用组件（按钮、菜单、弹窗、输入框等）与令牌作用域 |
| `src/pages/` | 组件页、令牌页、五套对比页 |
| `src/shell/` | Playground 外壳与舞台缩放 |
| `src/styles/` | 样式，见下文 |
| `../tokens/` | 设计令牌：`base.css` 与五套方向的令牌文件，`schema.ts` 是令牌表 |
| `../tests/` | 设计系统的测试 |

`src/styles/` 中，`base`、`components`、`controls`、`content`、`sidebar`、`windows` 是产品样式，只引用令牌；`desktop`（桌面场景）、`pages`（组件页）与 `shell`（外壳）不属于 SideNotes 的设计，可以写固定数值。

## 复用的现有代码

| 代码 | 用途 |
| --- | --- |
| `src/core` | 记录、标签、标题与正文的显示规则、Emoji、设置的取值范围与默认值、更新日志 |
| `src/components/Markdown` | 正文渲染 |
| `src/core/editor` 的 `MarkdownEditor` | 新建卡片、速记浮窗与卡片编辑 |
| `src/debug/sample-notes.ts` | 示例数据 |

Playground 有独立的入口 `design-playground.html`，不改动 `src/main.tsx`，也不进入 `vite build`。

## 检查

```bash
pnpm test
```

- `design-system/tests/tokens.test.ts`：每套方向、每种主题的令牌齐全，关键颜色组合在最差背景上达到 4.5:1 或 3:1。
- `design-system/tests/styles.test.ts`：产品样式不写死颜色、像素、rem 与时长，只引用令牌表中的令牌。

`pnpm lint` 与 `pnpm typecheck` 同样覆盖 Playground 的代码。

## 已知限制

- Windows 11 与磨砂玻璃方向用 CSS 的 `backdrop-filter` 模拟桌面材质，只能模糊模拟桌面中的内容；真实应用需要系统的窗口材质，见 [../directions/comparison.md](../directions/comparison.md)。
- 磨砂玻璃方向中，列表底边处被裁到一半的玻璃块会漏出背后的内容，见 [../directions/glass.md](../directions/glass.md)。
- 全局快捷键只在页面获得焦点时生效。
