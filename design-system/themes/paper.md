# 记录纸（Paper）

一叠贴着屏幕边缘的记录纸：灰绿纸垫上铺着一张张浅色纸片，只有一种墨色，编辑时纸片上出现横线。取自 Glance 的记录纸外观，也对应现有 SideNotes 的纸张材质。

令牌文件：[tokens/paper.css](../tokens/paper.css)。结构差异：[surfaces.ts](../playground/src/surfaces.ts) 中 `id: 'paper'` 的一项。

## 一、定位

| 项目 | 内容 |
| --- | --- |
| 关键词 | 贴边纸垫、纸片、单色墨水、灰绿纸色、编辑时的横线 |
| 适合 | 喜欢安静、颜色少的界面；记录长短不一，需要一眼分清每一条 |
| 参考 | Glance 记录纸外观（`theme.rs`），见 [glance-analysis.md](../references/glance-analysis.md)；现有 SideNotes 的纸张材质 |

## 二、结构

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 与屏幕边缘 | 贴边整块 | 贴边一侧没有圆角，朝屏幕内侧一边 16px 圆角 |
| 记录 | 纸片 | 一像素边框、3px 圆角，底边一像素的纸厚阴影；纸片之间留 8px |
| 页签 | 下划线 | 当前页签下方一条墨绿色的线 |
| 底栏 | 版本号与设置 | — |
| 快捷键 | 写在工具提示中 | — |
| 页签色点 | 无 | — |
| 材质 | 实心 | 不需要透明窗口 |

Glance 用细线分栏，它的栏目内容短而整齐；SideNotes 的记录长短不一，只用细线时边界不清楚，所以改为纸片。

## 三、颜色

纸垫是略深的灰绿，纸片更浅；只有一种墨色，第二墨色（墨绿）只用于主要操作与选中。深色模式是墨绿的深底，纸片略亮。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 纸垫（面板） | `--sn-color-panel` | `#e3e9e1` | `#0f1a17` |
| 纸片（卡片） | `--sn-color-card` | `#f5f8f3` | `#172723` |
| 主要文字（墨色） | `--sn-color-text` | `#16221e` | `#e7eee7` |
| 弱化文字 | `--sn-color-text-muted` | `#56645d` | `#8c9c94` |
| 强调色（墨绿） | `--sn-color-accent` | `#1f6b45` | `#4ecb82` |
| 焦点环 | `--sn-color-focus` | `#16221e`（与墨色相同） | `#e7eee7` |
| 编辑底色 | `--sn-color-editing` | `#fbfcf9` | `#1b2d28` |
| 编辑时的横线 | `--sn-color-rule` | 叠 10% 的墨色 | 叠 8% 的浅色 |

全部取值见附录。

## 四、字体与排版

| 用途 | 令牌 | 取值 |
| --- | --- | --- |
| 界面、标题、正文 | `--sn-font-ui` 等 | Archivo（Glance 记录纸的字体），回落到 Segoe UI Variable Text、Microsoft YaHei UI 与 Linux 的 Noto Sans 等 |
| 代码 | `--sn-font-code` | Cascadia Mono、Maple Mono NF CN、Consolas |
| 界面字号 | `--sn-font-size-xs` 至 `--sn-font-size-xl` | 11、12、13、13、16px |
| 卡片标题 | `--sn-font-size-lg`、`--sn-title-weight` | 13px，字重 650，字距 -0.005em，最多两行 |
| 正文 | `--sn-note-size`、`--sn-note-line-height` | 13.5px，行高 1.7 |

## 五、形状、间距与尺寸

| 项目 | 令牌 | 取值 |
| --- | --- | --- |
| 面板圆角（内侧、贴边一侧） | `--sn-panel-radius`、`--sn-panel-radius-edge` | 16px、0 |
| 记录圆角、控件圆角 | `--sn-card-radius`、`--sn-radius-control` | 3px、6px |
| 面板内边距 | `--sn-panel-padding` | 12px |
| 记录内边距 | `--sn-card-padding-x`、`--sn-card-padding-y` | 12px、10px |
| 记录间隙 | `--sn-card-gap` | 8px |
| 控件高度 | `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` | 24、30、36px |
| 标题区、页签、底栏 | `--sn-header-height`、`--sn-tab-height`、`--sn-footer-height` | 42、32、38px |

## 六、层次与立体感

层次靠纸垫与纸片的深浅：纸片底边一像素的纸厚阴影（`--sn-shadow-sm`），像一张张叠放的纸；侧栏整体一层柔和的投影（`--sn-shadow-panel`）。不用大投影。

## 七、状态

| 状态 | 表现 | 令牌 |
| --- | --- | --- |
| 默认 | 浅色纸片、浅色边框，底边纸厚阴影，右侧显示时间 | `--sn-color-card`、`--sn-color-border-subtle`、`--sn-shadow-sm` |
| 悬停与选中 | 墨绿边框加一圈墨绿外圈，纸片略微浮起，叠一层很淡的墨绿；时间换成操作按钮 | `--sn-shadow-card-active`、`--sn-color-card-active` |
| 多选 | 纸片叠一层浅墨绿，墨绿边框 | `--sn-color-accent-subtle` |
| 键盘焦点 | 纸片内侧一圈 2px 的墨色焦点环 | `--sn-color-focus` |
| 编辑中 | 纸片换成更白的编辑底色并加投影；边框不变，不用墨绿 | `--sn-color-editing`、`--sn-shadow-editing` |
| 其余卡片变淡 | 有卡片在编辑时降到禁用透明度，悬停时恢复 | `--sn-opacity-disabled` |
| 收起 | 只剩标题行 | — |

## 八、编辑模式

| 部位 | 表现 |
| --- | --- |
| 编辑区 | 纸片换成更白的编辑底色，每一行下方出现一条淡淡的横线，像写在横线纸上 |
| Markdown 标记 | 弱化的墨色 |
| 光标 | 墨绿 |
| 编辑栏 | 附件工具、取消、保存；快捷键写在按钮的工具提示中 |

横线画在每一行的底部，行高变化（代码块等）时仍与文字对齐。五套主题共用的编辑模式规则见 [editing.md](../editing.md)。

## 九、动效

| 令牌 | 取值 |
| --- | --- |
| `--sn-duration-fast`、`--sn-duration-normal`、`--sn-duration-slow` | 160、240、280ms |
| `--sn-ease-standard`、`--sn-ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)`，取自 Glance 的强减速曲线 |
| `--sn-motion-distance` | 6px |

## 十、实现与平台

- 实心表面，Windows、Linux、Android 都不需要窗口材质。
- 设置项 `surface` 沿用现有的取值 `paper`，外观换成本文所述的样式，见 [adaptation.md](../adaptation.md)。

## 十一、已知限制

- Archivo 没有随应用打包，多数电脑上显示的是系统字体，与 Glance 的观感有差距；要打包需要确认字体许可。
- 只有一种墨色，置顶、归档等状态主要靠图标区分。

## 附录：令牌取值

以下是 [tokens/paper.css](../tokens/paper.css) 中的全部取值，由令牌文件生成，`design-system/tests/docs.test.ts` 检查两者一致。共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。

### 随明暗变化

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--sn-color-panel` | `#e3e9e1` | `#0f1a17` |
| `--sn-color-panel-band` | `rgb(22 34 30 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card` | `#f5f8f3` | `#172723` |
| `--sn-color-card-head` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card-active` | `rgb(31 107 69 / 0.04)` | `rgb(78 203 130 / 0.05)` |
| `--sn-color-card-head-active` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-editing` | `#fbfcf9` | `#1b2d28` |
| `--sn-color-sheen` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-bg` | `#dde3da` | `#0c1513` |
| `--sn-color-surface` | `#eef2ec` | `#14231f` |
| `--sn-color-surface-raised` | `#f7f9f5` | `#1b2d28` |
| `--sn-color-surface-sunken` | `#dae1d7` | `#0b1412` |
| `--sn-color-hover` | `rgb(22 34 30 / 0.05)` | `rgb(231 238 231 / 0.06)` |
| `--sn-color-pressed` | `rgb(22 34 30 / 0.09)` | `rgb(231 238 231 / 0.1)` |
| `--sn-color-selected` | `rgb(22 34 30 / 0.075)` | `rgb(231 238 231 / 0.08)` |
| `--sn-color-overlay` | `rgb(22 34 30 / 0.3)` | `rgb(0 0 0 / 0.5)` |
| `--sn-color-border` | `#cdd6cb` | `#273a34` |
| `--sn-color-border-subtle` | `#d6ded4` | `#20312c` |
| `--sn-color-border-strong` | `#75827b` | `#6f817a` |
| `--sn-color-edge-highlight` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-top` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-bottom` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rule` | `rgb(22 34 30 / 0.1)` | `rgb(231 238 231 / 0.08)` |
| `--sn-color-text` | `#16221e` | `#e7eee7` |
| `--sn-color-text-secondary` | `#3f4c46` | `#a1b0a8` |
| `--sn-color-text-muted` | `#56645d` | `#8c9c94` |
| `--sn-color-text-disabled` | `#a5b1aa` | `#4f615a` |
| `--sn-color-halo` | `rgb(255 255 255 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-syntax` | `#56645d` | `#8c9c94` |
| `--sn-color-accent` | `#1f6b45` | `#4ecb82` |
| `--sn-color-accent-hover` | `#185838` | `#6ad597` |
| `--sn-color-accent-text` | `#1f6b45` | `#4ecb82` |
| `--sn-color-accent-subtle` | `rgb(31 107 69 / 0.1)` | `rgb(78 203 130 / 0.13)` |
| `--sn-color-on-accent` | `#ffffff` | `#0b1f15` |
| `--sn-color-focus` | `#16221e` | `#e7eee7` |
| `--sn-color-caret` | `#1f6b45` | `#4ecb82` |
| `--sn-color-highlight` | `rgb(214 180 60 / 0.38)` | `rgb(214 180 60 / 0.3)` |
| `--sn-color-selection` | `rgb(31 107 69 / 0.2)` | `rgb(78 203 130 / 0.25)` |
| `--sn-color-inverse` | `#16221e` | `#e7eee7` |
| `--sn-color-on-inverse` | `#eef2ec` | `#14231f` |
| `--sn-color-mark-workspace` | `#56645d` | `#a1b0a8` |
| `--sn-color-mark-pinned` | `#1f6b45` | `#4ecb82` |
| `--sn-color-mark-archive` | `#56645d` | `#a1b0a8` |
| `--sn-color-success` | `#1f6b45` | `#4ecb82` |
| `--sn-color-success-subtle` | `rgb(31 107 69 / 0.1)` | `rgb(78 203 130 / 0.13)` |
| `--sn-color-warning` | `#855c00` | `#e4b45a` |
| `--sn-color-warning-subtle` | `rgb(200 150 40 / 0.14)` | `rgb(228 180 90 / 0.14)` |
| `--sn-color-danger` | `#a83318` | `#ff7b4a` |
| `--sn-color-danger-subtle` | `rgb(210 63 28 / 0.1)` | `rgb(255 123 74 / 0.14)` |
| `--sn-color-info` | `#2f5f8a` | `#7fb3dd` |
| `--sn-color-info-subtle` | `rgb(47 95 138 / 0.1)` | `rgb(127 179 221 / 0.14)` |
| `--sn-code-bg` | `#e4eae2` | `#0f1b18` |
| `--sn-code-text` | `#16221e` | `#dfe8e0` |
| `--sn-shadow-sm` | `0 1px 0 rgb(22 34 30 / 0.09)` | `0 1px 0 rgb(0 0 0 / 0.4)` |
| `--sn-shadow-md` | `0 10px 28px -8px rgb(22 34 30 / 0.28), 0 2px 6px rgb(22 34 30 / 0.1)` | `0 10px 28px -8px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-lg` | `0 18px 40px -12px rgb(22 34 30 / 0.35), 0 2px 6px rgb(22 34 30 / 0.12)` | `0 18px 40px -12px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-panel` | `0 18px 40px -12px rgb(22 34 30 / 0.35), 0 2px 6px rgb(22 34 30 / 0.12)` | `0 18px 40px -12px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-card-active` | `0 0 0 1px var(--sn-color-accent), 0 3px 8px -2px rgb(22 34 30 / 0.16)` | `0 0 0 1px var(--sn-color-accent), 0 3px 10px -2px rgb(0 0 0 / 0.45)` |
| `--sn-shadow-editing` | `0 10px 24px -8px rgb(22 34 30 / 0.24)` | `0 10px 26px -8px rgb(0 0 0 / 0.6)` |

### 不随明暗变化

| 令牌 | 取值 |
| --- | --- |
| `--sn-panel-blur` | `0px` |
| `--sn-panel-saturate` | `1` |
| `--sn-panel-inset` | `0px` |
| `--sn-panel-radius` | `16px` |
| `--sn-panel-radius-edge` | `0px` |
| `--sn-block-gap` | `0px` |
| `--sn-font-ui` | `Archivo, 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC', system-ui, -apple-system, Roboto, 'Noto Sans', Ubuntu, Cantarell, sans-serif` |
| `--sn-font-title` | `var(--sn-font-ui)` |
| `--sn-font-note` | `var(--sn-font-ui)` |
| `--sn-font-meta` | `var(--sn-font-ui)` |
| `--sn-font-code` | `'Cascadia Mono', 'Maple Mono NF CN', Consolas, 'Noto Sans Mono', 'DejaVu Sans Mono', monospace` |
| `--sn-font-size-xs` | `11px` |
| `--sn-font-size-sm` | `12px` |
| `--sn-font-size-md` | `13px` |
| `--sn-font-size-lg` | `13px` |
| `--sn-font-size-xl` | `16px` |
| `--sn-line-height-tight` | `1.3` |
| `--sn-line-height-normal` | `1.5` |
| `--sn-line-height-relaxed` | `1.7` |
| `--sn-note-size` | `13.5px` |
| `--sn-note-line-height` | `1.7` |
| `--sn-code-size` | `12px` |
| `--sn-body-weight` | `400` |
| `--sn-title-weight` | `650` |
| `--sn-title-tracking` | `-0.005em` |
| `--sn-radius-xs` | `3px` |
| `--sn-radius-sm` | `4px` |
| `--sn-radius-md` | `6px` |
| `--sn-radius-lg` | `10px` |
| `--sn-radius-control` | `6px` |
| `--sn-radius-chip` | `4px` |
| `--sn-card-radius` | `3px` |
| `--sn-duration-fast` | `160ms` |
| `--sn-duration-normal` | `240ms` |
| `--sn-duration-slow` | `280ms` |
| `--sn-ease-standard` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--sn-ease-exit` | `cubic-bezier(0.4, 0, 0.7, 1)` |
| `--sn-motion-distance` | `6px` |
| `--sn-header-height` | `42px` |
| `--sn-tab-height` | `32px` |
| `--sn-footer-height` | `38px` |
| `--sn-panel-padding` | `12px` |
| `--sn-card-padding-x` | `12px` |
| `--sn-card-padding-y` | `10px` |
| `--sn-card-gap` | `8px` |
| `--sn-control-height-sm` | `24px` |
| `--sn-control-height` | `30px` |
| `--sn-control-height-lg` | `36px` |
| `--sn-icon-size` | `16px` |
| `--sn-icon-size-sm` | `14px` |
| `--sn-icon-stroke` | `1.6` |
| `--sn-menu-item-height` | `32px` |
| `--sn-dialog-width` | `440px` |
