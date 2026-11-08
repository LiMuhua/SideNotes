# 终端（Terminal）

默认主题。像终端里并排的窗格：每条记录一个带标题栏的窗格，等宽字体、键盘优先，常用快捷键写在按钮旁，记下就走。

令牌文件：[tokens/terminal.css](../tokens/terminal.css)。结构差异：[surfaces.ts](../playground/src/surfaces.ts) 中 `id: 'terminal'` 的一项。

## 一、定位

| 项目 | 内容 |
| --- | --- |
| 关键词 | 等宽字体、石墨色、琥珀强调色、标题栏窗格、快捷键可见 |
| 适合 | 习惯用键盘、喜欢等宽字体与高信息密度的用户；现有 SideNotes 的默认字体就是等宽字体，换到这套主题的成本最低 |
| 参考 | 现有 SideNotes 的默认字体 Maple Mono NF CN；终端与编辑器的窗格；Raycast 与 Linear 的键盘模型 |

## 二、结构

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 与屏幕边缘 | 贴边整块 | 没有外边距与圆角，朝屏幕内侧一条边框 |
| 记录 | 窗格 | 一像素边框、4px 圆角；顶部是标题栏（Emoji、标题、时间），标题栏与正文之间一条分隔线；单行记录与收起的记录只剩标题栏 |
| 页签 | 下划线 | 当前页签下方一条强调色的线 |
| 底栏 | 与其他主题相同 | 左边是存储状态的小圆点，右边是设置按钮，其余留白 |
| 快捷键 | 显示在界面上 | 新建卡片与编辑栏写出 Ctrl+Enter，带快捷键的文字按钮在按钮上写出按键；速记浮窗的快捷键与其他主题一样收在标题旁的问号里 |
| 页签色点 | 无 | — |
| 材质 | 实心 | 不需要透明窗口 |

## 三、颜色

冷灰色的面板衬出白色窗格，只有一种强调色：琥珀色。深色模式整体压暗，窗格比面板略亮。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 面板 | `--sn-color-panel` | `#e3e6ea` | `#101317` |
| 窗格 | `--sn-color-card` | `#ffffff` | `#181c21` |
| 标题栏 | `--sn-color-card-head` | 窗格上叠 4.5% 的石墨色 | 叠 4% 的白色 |
| 选中的标题栏 | `--sn-color-card-head-active` | 叠 17% 的琥珀色 | 叠 20% 的琥珀色 |
| 主要文字 | `--sn-color-text` | `#1b1f24` | `#d8dde3` |
| 弱化文字 | `--sn-color-text-muted` | `#58606a` | `#8b949e` |
| 强调色 | `--sn-color-accent` | `#a35f00` | `#e5a54b` |
| Markdown 标记 | `--sn-color-syntax` | `#94570a` | `#e0a458` |

全部取值见附录。

## 四、字体与排版

| 用途 | 令牌 | 取值 |
| --- | --- | --- |
| 界面、标题、正文、元信息、代码 | `--sn-font-ui` 等 | 都是 Maple Mono NF CN，依次回落到 Cascadia Mono、JetBrains Mono、Consolas、Noto Sans Mono、DejaVu Sans Mono |
| 界面字号 | `--sn-font-size-xs` 至 `--sn-font-size-xl` | 11、12、13、13、15px |
| 卡片标题 | `--sn-font-size-lg`、`--sn-title-weight` | 13px，字重 700，最多两行 |
| 正文 | `--sn-note-size`、`--sn-note-line-height` | 13px，行高 1.65 |

Maple Mono NF CN 已随应用打包（SIL OFL 1.1）。它的汉字宽 1.2 em，同样宽度能放下的汉字比常规中文字体少约两成。

## 五、形状、间距与尺寸

| 项目 | 令牌 | 取值 |
| --- | --- | --- |
| 面板离屏幕边缘、面板圆角 | `--sn-panel-inset`、`--sn-panel-radius` | 0、0 |
| 记录圆角、控件圆角 | `--sn-card-radius`、`--sn-radius-control` | 4px、3px |
| 面板内边距 | `--sn-panel-padding` | 10px |
| 记录内边距 | `--sn-card-padding-x`、`--sn-card-padding-y` | 10px、8px |
| 记录间隙 | `--sn-card-gap` | 6px |
| 控件高度 | `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` | 24、26、30px |
| 标题区、页签、底栏 | `--sn-header-height`、`--sn-tab-height`、`--sn-footer-height` | 36、30、26px |

密度在五套中最高。

## 六、层次与立体感

层次靠底色深浅与边框，几乎不用投影：面板最深，窗格最亮，标题栏介于两者之间。窗格只有一像素的轻投影（`--sn-shadow-sm`）；侧栏朝屏幕内侧一条边框，加一圈柔和的投影（`--sn-shadow-panel`）。

## 七、状态

| 状态 | 表现 | 令牌 |
| --- | --- | --- |
| 默认 | 白色窗格、灰色边框，标题栏浅灰，右侧显示时间 | `--sn-color-card`、`--sn-color-border`、`--sn-color-card-head` |
| 悬停与选中 | 琥珀色边框加一圈琥珀色外圈；标题栏染成琥珀色，顶部一条 2px 的琥珀色线，像编辑器里当前的页签；时间换成操作按钮 | `--sn-shadow-card-active`、`--sn-color-card-head-active` |
| 多选 | 窗格叠一层浅琥珀色，琥珀色边框，标题栏同选中 | `--sn-color-accent-subtle` |
| 键盘焦点 | 窗格内侧一圈 2px 的焦点环 | `--sn-color-focus` |
| 编辑中 | 只加浮起的投影；边框与标题栏保持平时的样子，不用琥珀色 | `--sn-color-editing`、`--sn-shadow-editing` |
| 其余卡片变淡 | 有卡片在编辑时降到禁用透明度，悬停时恢复 | `--sn-opacity-disabled` |
| 收起 | 只剩标题栏 | — |

悬停与单击共用同一种高亮（现有行为）：高亮的那一张就是 Ctrl+C 复制的对象。

## 八、编辑模式

| 部位 | 表现 |
| --- | --- |
| 编辑区 | 底色与窗格相同（深色为 `#1b2026`）；不显示行号（2026-11-08 去掉：速记浮窗为空时行号与占位文字重叠） |
| Markdown 标记 | 琥珀色，像代码的语法着色 |
| 光标 | 琥珀色 |
| 编辑栏 | 附件工具、Ctrl+Enter 按键提示、取消、保存 |
| 标题栏 | 保持平时的浅灰，不染色，顶部也没有强调色线（2026-11-08 去掉：编辑的地方不被强调色框住） |

五套主题共用的编辑模式规则见 [editing.md](../editing.md)。

## 九、动效

| 令牌 | 取值 |
| --- | --- |
| `--sn-duration-fast`、`--sn-duration-normal`、`--sn-duration-slow` | 70、110、160ms |
| `--sn-ease-standard` | `cubic-bezier(0.2, 0, 0.2, 1)` |
| `--sn-motion-distance` | 4px |

动效极短，几乎不被察觉。侧栏滑入滑出的时长取设置中的「出入动画」，不受主题影响。

## 十、实现与平台

- 实心表面，Windows、Linux、Android 都不需要窗口材质。
- 设置项 `surface` 取值 `terminal`，也是默认值；现有的 `standard` 迁移为 `terminal`，见 [adaptation.md](../adaptation.md)。

## 十一、已知限制

- 等宽字体放下的汉字较少，标题更容易折到第二行。
- 新建卡片在终端中用 Ctrl+Enter 的按键提示代替字数，看不到字数。

## 附录：令牌取值

以下是 [tokens/terminal.css](../tokens/terminal.css) 中的全部取值，由令牌文件生成，`design-system/tests/docs.test.ts` 检查两者一致。共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。

### 随明暗变化

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--sn-color-panel` | `#e3e6ea` | `#101317` |
| `--sn-color-panel-band` | `rgb(20 24 30 / 0.04)` | `rgb(0 0 0 / 0.22)` |
| `--sn-color-card` | `#ffffff` | `#181c21` |
| `--sn-color-card-head` | `rgb(30 36 44 / 0.045)` | `rgb(255 255 255 / 0.04)` |
| `--sn-color-card-active` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card-head-active` | `rgb(184 108 0 / 0.17)` | `rgb(229 165 75 / 0.2)` |
| `--sn-color-editing` | `#ffffff` | `#1b2026` |
| `--sn-color-sheen` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-bg` | `#dfe2e6` | `#0e1114` |
| `--sn-color-surface` | `#f5f6f8` | `#13161a` |
| `--sn-color-surface-raised` | `#ffffff` | `#1c2026` |
| `--sn-color-surface-sunken` | `#eceef1` | `#0b0d10` |
| `--sn-color-hover` | `rgb(30 36 44 / 0.05)` | `rgb(255 255 255 / 0.045)` |
| `--sn-color-pressed` | `rgb(30 36 44 / 0.09)` | `rgb(255 255 255 / 0.08)` |
| `--sn-color-selected` | `rgb(184 108 0 / 0.13)` | `rgb(229 165 75 / 0.14)` |
| `--sn-color-overlay` | `rgb(16 18 22 / 0.4)` | `rgb(0 0 0 / 0.55)` |
| `--sn-color-border` | `#cbd0d6` | `#2a3037` |
| `--sn-color-border-subtle` | `#dce0e5` | `#20252b` |
| `--sn-color-border-strong` | `#737b85` | `#67707b` |
| `--sn-color-edge-highlight` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-top` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-bottom` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rule` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-text` | `#1b1f24` | `#d8dde3` |
| `--sn-color-text-secondary` | `#434a53` | `#a9b1ba` |
| `--sn-color-text-muted` | `#58606a` | `#8b949e` |
| `--sn-color-text-disabled` | `#a2a8b0` | `#4b525a` |
| `--sn-color-halo` | `rgb(255 255 255 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-syntax` | `#94570a` | `#e0a458` |
| `--sn-color-accent` | `#a35f00` | `#e5a54b` |
| `--sn-color-accent-hover` | `#8a5000` | `#f0b865` |
| `--sn-color-accent-text` | `#8f5300` | `#f0b865` |
| `--sn-color-accent-subtle` | `rgb(184 108 0 / 0.12)` | `rgb(229 165 75 / 0.14)` |
| `--sn-color-on-accent` | `#ffffff` | `#1a1206` |
| `--sn-color-focus` | `#a35f00` | `#f0b865` |
| `--sn-color-caret` | `#a35f00` | `#f0b865` |
| `--sn-color-highlight` | `rgb(250 204 21 / 0.4)` | `rgb(240 184 101 / 0.28)` |
| `--sn-color-selection` | `rgb(184 108 0 / 0.2)` | `rgb(229 165 75 / 0.28)` |
| `--sn-color-inverse` | `#262b32` | `#d8dde3` |
| `--sn-color-on-inverse` | `#f1f3f5` | `#13161a` |
| `--sn-color-mark-workspace` | `#58606a` | `#8b949e` |
| `--sn-color-mark-pinned` | `#8f5300` | `#f0b865` |
| `--sn-color-mark-archive` | `#58606a` | `#8b949e` |
| `--sn-color-success` | `#1b6e3d` | `#6cc487` |
| `--sn-color-success-subtle` | `rgb(31 122 68 / 0.1)` | `rgb(108 196 135 / 0.14)` |
| `--sn-color-warning` | `#7d5f00` | `#e9c46a` |
| `--sn-color-warning-subtle` | `rgb(202 160 0 / 0.14)` | `rgb(233 196 106 / 0.14)` |
| `--sn-color-danger` | `#b3372b` | `#f2766b` |
| `--sn-color-danger-subtle` | `rgb(184 58 46 / 0.1)` | `rgb(242 118 107 / 0.14)` |
| `--sn-color-info` | `#2a62b0` | `#6fa8f0` |
| `--sn-color-info-subtle` | `rgb(42 98 176 / 0.1)` | `rgb(111 168 240 / 0.14)` |
| `--sn-code-bg` | `#f1f3f5` | `#0b0d10` |
| `--sn-code-text` | `#1e2329` | `#d7dce2` |
| `--sn-shadow-sm` | `0 1px 2px rgb(20 24 30 / 0.06)` | `0 1px 2px rgb(0 0 0 / 0.35)` |
| `--sn-shadow-md` | `0 4px 12px rgb(20 24 30 / 0.12)` | `0 6px 16px rgb(0 0 0 / 0.45)` |
| `--sn-shadow-lg` | `0 14px 32px rgb(20 24 30 / 0.18)` | `0 16px 36px rgb(0 0 0 / 0.55)` |
| `--sn-shadow-panel` | `0 0 0 1px #cbd0d6, 0 0 24px rgb(20 24 30 / 0.14)` | `0 0 0 1px #2a3037, 0 0 28px rgb(0 0 0 / 0.45)` |
| `--sn-shadow-card-active` | `0 0 0 1px var(--sn-color-accent), 0 2px 8px rgb(20 24 30 / 0.12)` | `0 0 0 1px var(--sn-color-accent), 0 2px 10px rgb(0 0 0 / 0.4)` |
| `--sn-shadow-editing` | `0 6px 18px rgb(20 24 30 / 0.16)` | `0 8px 22px rgb(0 0 0 / 0.5)` |

### 不随明暗变化

| 令牌 | 取值 |
| --- | --- |
| `--sn-panel-blur` | `0px` |
| `--sn-panel-saturate` | `1` |
| `--sn-panel-inset` | `0px` |
| `--sn-panel-radius` | `0px` |
| `--sn-panel-radius-edge` | `0px` |
| `--sn-block-gap` | `0px` |
| `--sn-font-ui` | `'Maple Mono NF CN', 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Noto Sans Mono', 'DejaVu Sans Mono', monospace` |
| `--sn-font-title` | `var(--sn-font-ui)` |
| `--sn-font-note` | `var(--sn-font-ui)` |
| `--sn-font-meta` | `var(--sn-font-ui)` |
| `--sn-font-code` | `var(--sn-font-ui)` |
| `--sn-font-size-xs` | `11px` |
| `--sn-font-size-sm` | `12px` |
| `--sn-font-size-md` | `13px` |
| `--sn-font-size-lg` | `13px` |
| `--sn-font-size-xl` | `15px` |
| `--sn-line-height-tight` | `1.3` |
| `--sn-line-height-normal` | `1.5` |
| `--sn-line-height-relaxed` | `1.65` |
| `--sn-note-size` | `13px` |
| `--sn-note-line-height` | `1.65` |
| `--sn-code-size` | `12px` |
| `--sn-body-weight` | `400` |
| `--sn-title-weight` | `700` |
| `--sn-title-tracking` | `0em` |
| `--sn-radius-xs` | `2px` |
| `--sn-radius-sm` | `3px` |
| `--sn-radius-md` | `4px` |
| `--sn-radius-lg` | `6px` |
| `--sn-radius-control` | `3px` |
| `--sn-radius-chip` | `2px` |
| `--sn-card-radius` | `4px` |
| `--sn-duration-fast` | `70ms` |
| `--sn-duration-normal` | `110ms` |
| `--sn-duration-slow` | `160ms` |
| `--sn-ease-standard` | `cubic-bezier(0.2, 0, 0.2, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` |
| `--sn-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` |
| `--sn-motion-distance` | `4px` |
| `--sn-header-height` | `36px` |
| `--sn-tab-height` | `30px` |
| `--sn-footer-height` | `26px` |
| `--sn-panel-padding` | `10px` |
| `--sn-card-padding-x` | `10px` |
| `--sn-card-padding-y` | `8px` |
| `--sn-card-gap` | `6px` |
| `--sn-control-height-sm` | `24px` |
| `--sn-control-height` | `26px` |
| `--sn-control-height-lg` | `30px` |
| `--sn-icon-size` | `16px` |
| `--sn-icon-size-sm` | `14px` |
| `--sn-icon-stroke` | `1.5` |
| `--sn-menu-item-height` | `26px` |
| `--sn-dialog-width` | `420px` |
