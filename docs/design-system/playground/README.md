# Design Playground

SideNotes 设计系统的交互式预览：在模拟的桌面上运行侧栏、速记浮窗与设置窗口，五套主题可以随时切换对比。数据只在内存中，不读写数据库，也不调用桌面接口。设计规范见 [../DESIGN.md](../DESIGN.md)。

Playground 的页面主要示范样式与关键功能；细致的交互规则（拖动、停留时间、键盘、撤销等）写在 [../interactions.md](../interactions.md)，组件与尺寸写在 [../components.md](../components.md)、[../layout.md](../layout.md)，完整的交互在[交互原型](../../prototype/README.md)中实现。

## 启动

在工作树根目录运行：

```bash
pnpm playground
```

命令会自动在浏览器打开交互原型 `http://localhost:1430/prototype/`；Playground 在同一个服务的 `http://localhost:1430/design-system/playground/`（地址去掉了 `docs` 一层，见 `vite.config.ts` 中的 `sidenotes-design-playground` 插件）。两边可以互相跳转：原型左上角品牌区的「Design Playground ↗」，Playground 顶栏最右边的「交互原型 ↗」。Playground 固定使用 1430 端口（`--strictPort`），端口被占用时直接报错，不会改用其他端口；应用的开发服务器使用 1420，两者可以同时运行，方便对照实际应用。

## 页面

| 页面 | 内容 |
| --- | --- |
| 侧栏 | 模拟桌面上的侧栏：贴边滑出，按设置延迟收起；新建、搜索、编辑、菜单、多选、键盘操作都可以试。页签是随记、置顶与手动固定的标签（示例数据固定了「工作」「生活」），最后一格是菜单；按标签筛选后可以固定为页签或合并成一条，多选后右键可以合并或移到页签 |
| 速记浮窗 | 侧栏收起时用快捷键呼出的浮窗，草稿与新建卡片共用；按住标题区可以拖动，放到不同的背景上检查材质（设置窗口同样可以拖动） |
| 设置 | 设置窗口（880 × 560，高度固定，左右两栏只靠底色区分）的五个分类，布局沿用现有应用；修改立即作用于所有窗口，包括字体。「外观与交互 › 显示」可以换应用图标：6 个内置图标，或上传图片（裁切后使用，可更换、移除），任务栏、托盘、标题区与关于页随之变化 |
| 组件 | 卡片的各种状态、编辑模式、侧栏部件（页签与放不下时、筛选条、新建卡片）、记录窗口（顶部与左侧标签页的静态示例）、菜单、弹窗（含合并成一条）、提示条与基础控件 |
| 令牌 | 当前主题与明暗下的全部令牌，以及关键颜色组合的对比度 |
| 五套对比 | 五个侧栏并排放在同一张壁纸上，下方是结构差异对照表 |
| 应用图标 | 定稿的 6 个应用图标（默认 211）：一览，点一个查看大图、说明与演进线；尺寸阶梯（实际像素 16–256）与 4 倍像素放大；使用场景（Windows 浅深任务栏与托盘、桌面、资源管理器、Linux 程序坞、Android 圆形遮罩）；全部图标的小尺寸对照；资源文件；下方是六轮设计演进。图片就是随应用打包的资源（`src-tauri/icons/builtin/`），这一页不受主题与明暗设置影响 |

## 控件与地址参数

顶部控件的状态写在地址中，可以直接分享或刷新：

| 控件 | 参数 | 取值 |
| --- | --- | --- |
| 页面 | `page` | `sidebar`、`capture`、`settings`、`components`、`tokens`、`compare`、`icons` |
| 主题 | `surface` | `terminal`（终端，默认）、`magazine`（杂志）、`paper`（记录纸）、`win11`（Windows 11）、`glass`（磨砂玻璃） |
| 明暗 | `theme` | `light`、`dark`、`system` |
| 平台 | `platform` | `windows`、`linux` |
| 壁纸 | `wallpaper` | `auto`（跟随明暗）、`light`、`dark`、`busy`（繁杂，检验半透明表面） |
| 屏幕 | `viewport` | `fit`、`1920x1080`、`1440x900`、`1280x800`、`1024x768`、`phone`（Android 412 × 892） |

另外，`frame=bare` 只显示预览区并按 1:1 显示，用于截图。「重置示例数据」恢复 21 条示例记录；设置、应用图标与固定的页签属于偏好，保持不变。

例如，深色的磨砂玻璃放在繁杂的壁纸上：`http://localhost:1430/design-system/playground/?surface=glass&theme=dark&wallpaper=busy`。

## 在模拟桌面中操作

- 侧栏收起后，把鼠标移到屏幕边缘唤出；任务栏托盘或 Linux 程序坞上的图标也可以切换。
- 页面获得焦点时模拟两个全局快捷键：Alt+Shift+S 切换侧栏，Ctrl+Shift+Space 呼出速记浮窗。
- 浏览器保留了 Ctrl+N 等组合键，新建记录请直接在新建卡片中输入。
- 卡片的键盘操作（本次提出）：Tab 进入列表，↑ ↓ 移动，Enter 编辑，Delete 移入回收站，Shift+F10 打开卡片菜单。
- 页签（第四次反馈）：单击切换，双击标签页签原地改名，右键「改名」「移出页签栏」；最后一格打开菜单，菜单中有收起的页签与「新建页签」。
- 附件按钮只显示提示，不读取本机文件；拖动排序（卡片与页签）、把卡片拖到页签或最后一格、框选与拖入文件没有模拟，卡片可以用菜单「移到…」移到页签。
- 记录窗口只有组件页中的静态示例；拖出、合并标签页、缩放与关闭动画在交互原型中。

## 目录

| 位置 | 内容 |
| --- | --- |
| `index.html` | 页面入口，开发服务器把 `/design-system/playground/` 转到这里（`vite.config.ts` 中的 `sidenotes-design-playground` 插件去掉地址中的 `docs` 一层） |
| `src/app/` | 桌面场景与三个窗口：侧栏、记录卡片、新建卡片、菜单与弹窗、速记浮窗、设置窗口 |
| `src/model/` | 内存中的记录与设置，规则沿用 `src/core`；以及内置应用图标的清单（`model/appIcons.ts`，引用 `src-tauri/icons/builtin/`） |
| `src/ui/` | 通用组件（按钮、菜单、弹窗、输入框等）、滚轮调整数值与令牌作用域 |
| `src/pages/` | 组件页、令牌页、五套对比页、应用图标页 |
| `src/shell/` | Playground 外壳与舞台缩放 |
| `src/styles/` | 样式，见下文 |
| `src/surfaces.ts` | 五套主题的名称、理念与 6 项结构差异；交互原型的 `docs/prototype/surfaces.js` 与它逐项比对 |
| `../tokens/` | 设计令牌：`base.css` 与五套主题的令牌文件，`schema.ts` 是令牌表 |
| `../tests/` | 设计系统的测试 |
| `../icon-history/` | 设计演进保留的 18 个历史图标 |

`src/styles/` 中，`base`、`components`、`controls`、`content`、`sidebar`、`windows` 是产品样式，只引用令牌；`desktop`（桌面场景）、`pages`（组件页）、`icons`（应用图标页）与 `shell`（外壳）属于展示台，不是 SideNotes 的设计，可以写固定数值，不在只用令牌的检查范围内。

## 复用的现有代码

| 代码 | 用途 |
| --- | --- |
| `src/core` | 记录、标签、标题与正文的显示规则、Emoji、设置的取值范围与默认值、更新日志 |
| `src/components/Markdown` | 正文渲染 |
| `src/core/editor` 的 `MarkdownEditor` | 新建卡片、速记浮窗与卡片编辑 |
| `src/debug/sample-notes.ts` | 示例数据 |

Playground 有独立的页面入口，不改动 `src/main.tsx`，也不进入 `vite build`（构建只打包仓库根目录的 `index.html`）。

## 检查

```bash
pnpm test
```

- `docs/design-system/tests/tokens.test.ts`：每套主题、每种明暗的令牌齐全，关键颜色组合在最差背景上达到 4.5:1 或 3:1。
- `docs/design-system/tests/styles.test.ts`：产品样式不写死颜色、像素、rem 与时长，只引用令牌表中的令牌。规则在 `css-rules.ts`，与原型检查共用。
- `docs/design-system/tests/prototype.test.ts`：交互原型 `docs/prototype/` 直接引用令牌，主题结构与 `surfaces.ts` 一致，旧设置按约定迁移，`theme.css` 只引用令牌，旧样式不写死颜色，变量都有来源。
- `docs/design-system/tests/docs.test.ts`：设计令牌文档与主题文档附录中的表与令牌文件一致，主题文档的章节统一，文档中的相对链接有效。
- `docs/design-system/tests/app-icons.test.ts`：内置图标的清单、母版、PNG、ICO 与打包配置一致，默认图标的母版副本与桌面 ICO 和默认图标一致。修改图标母版或清单后运行 `pnpm icons` 重新生成。

修改令牌后，在 Git Bash 或 Linux 终端中运行下面的命令，重新生成文档中的表：

```bash
SN_UPDATE_DOCS=1 pnpm exec vitest run docs/design-system/tests/docs.test.ts
```

`pnpm lint` 与 `pnpm typecheck` 同样覆盖 Playground 的代码。

## 已知限制

- Windows 11 与磨砂玻璃用 CSS 的 `backdrop-filter` 模拟桌面材质，只能模糊模拟桌面中的内容；真实应用需要系统的窗口材质，见 [../adaptation.md](../adaptation.md) 第三节。
- 磨砂玻璃中，列表底边处被裁到一半的玻璃块会漏出背后的内容，见 [../themes/glass.md](../themes/glass.md) 的「已知限制」。
- 「数据与同步」页的目录、快照、导入导出与云端备份只弹出示例提示，不访问文件。
- 手机画面没有放大触控目标。
- 全局快捷键只在页面获得焦点时生效。
- 上传的应用图标只保存在内存中，刷新后回到默认图标。
