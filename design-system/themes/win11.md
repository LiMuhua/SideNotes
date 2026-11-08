# Windows 11

一张亚克力面板，和开始菜单、快速设置一样：离开屏幕边缘 12 像素，8 像素圆角，一像素描边。取自 Glance 的 Windows 11 外观，也对应现有 SideNotes 的 Win11 材质。

令牌文件：[tokens/win11.css](../tokens/win11.css)。结构差异：[surfaces.ts](../playground/src/surfaces.ts) 中 `id: 'win11'` 的一项。

## 一、定位

| 项目 | 内容 |
| --- | --- |
| 关键词 | 亚克力、系统强调色、Segoe UI Variable、分层卡片、浮动面板 |
| 适合 | 希望 SideNotes 看起来像 Windows 自带工具的用户 |
| 参考 | Glance Windows 11 外观（`theme.rs`、`skins.rs`）；Fluent 2；微软的 Mica 与 Acrylic 文档，见 [adaptation.md](../adaptation.md) |

## 二、结构

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 与屏幕边缘 | 浮动面板 | 离开屏幕边缘 12px，8px 圆角，一像素描边 |
| 记录 | 卡片 | 半透明的白色卡片，4px 圆角，卡片之间留 4px |
| 页签 | 下划线 | 当前页签下方一条强调色的线 |
| 底栏 | 存储状态与设置 | 底栏比面板稍暗 |
| 快捷键 | 写在工具提示中 | — |
| 页签色点 | 无 | — |
| 材质 | 半透明 | 面板模糊 30px、饱和度 1.25，需要透明窗口与窗口材质 |

## 三、颜色

文字是黑色或白色加透明度，内容靠标题与留白分组；强调色取系统强调色，取不到时用 Glance 记录的默认值。半透明表面的颜色随背景变化，令牌按最差情况取值：表面叠在纯黑或纯白上，弱化文字都要达到 4.5:1，所以文字的透明度比 Fluent 的第三级文字高。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 面板 | `--sn-color-panel` | 白色 85% | `#2c2c2c` 96% |
| 卡片 | `--sn-color-card` | 白色 70% | 白色 5% |
| 选中卡片的叠加色 | `--sn-color-card-active` | 叠 5% 的强调色 | 叠 6% 的强调色 |
| 主要文字 | `--sn-color-text` | 黑色 90% | `#ffffff` |
| 弱化文字 | `--sn-color-text-muted` | 黑色 62% | 白色 62% |
| 强调色 | `--sn-color-accent` | `#005fb8` | `#60cdff` |
| 编辑底色 | `--sn-color-editing` | 白色 94% | `#2d2d2d` |
| 焦点环 | `--sn-color-focus` | 黑色 90% | `#ffffff` |

全部取值见附录。

## 四、字体与排版

| 用途 | 令牌 | 取值 |
| --- | --- | --- |
| 界面与正文 | `--sn-font-ui`、`--sn-font-note` | Segoe UI Variable Text、Segoe UI、Microsoft YaHei UI，Linux 回落到 Noto Sans 等 |
| 标题 | `--sn-font-title` | Segoe UI Variable Display |
| 代码 | `--sn-font-code` | Cascadia Mono、Maple Mono NF CN、Consolas |
| 界面字号 | `--sn-font-size-xs` 至 `--sn-font-size-xl` | 11、12、13、14、20px |
| 卡片标题 | `--sn-font-size-lg`、`--sn-title-weight` | 14px，字重 600，最多两行 |
| 正文 | `--sn-note-size`、`--sn-note-line-height` | 14px，行高 1.55 |

## 五、形状、间距与尺寸

| 项目 | 令牌 | 取值 |
| --- | --- | --- |
| 面板离屏幕边缘、面板圆角 | `--sn-panel-inset`、`--sn-panel-radius` | 12px、8px |
| 记录圆角、控件圆角 | `--sn-card-radius`、`--sn-radius-control` | 4px、4px |
| 面板内边距 | `--sn-panel-padding` | 12px |
| 记录内边距 | `--sn-card-padding-x`、`--sn-card-padding-y` | 12px、10px |
| 记录间隙 | `--sn-card-gap` | 4px |
| 控件高度 | `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` | 24、32、40px |
| 标题区、页签、底栏 | `--sn-header-height`、`--sn-tab-height`、`--sn-footer-height` | 44、32、48px |

## 六、层次与立体感

按 Fluent 的分层：亚克力面板是底层，卡片是一层半透明的白色；面板一层较深的投影（`--sn-shadow-panel`），卡片只有一像素的轻投影。

## 七、状态

| 状态 | 表现 | 令牌 |
| --- | --- | --- |
| 默认 | 半透明白色卡片、浅色描边，右侧显示时间 | `--sn-color-card`、`--sn-color-border-subtle` |
| 悬停与选中 | 强调色边框加一圈强调色外圈，叠一层很淡的强调色；时间换成操作按钮 | `--sn-shadow-card-active`、`--sn-color-card-active` |
| 多选 | 卡片叠一层浅强调色，强调色边框 | `--sn-color-accent-subtle` |
| 键盘焦点 | 卡片内侧一圈 2px 的黑色（深色为白色）焦点环，与 Windows 11 一致 | `--sn-color-focus` |
| 编辑中 | 卡片换成几乎不透明的白色，略微浮起；边框不变，不用强调色 | `--sn-color-editing`、`--sn-shadow-editing` |
| 其余卡片变淡 | 有卡片在编辑时降到禁用透明度，悬停时恢复 | `--sn-opacity-disabled` |
| 收起 | 只剩标题行 | — |

## 八、编辑模式

| 部位 | 表现 |
| --- | --- |
| 编辑区 | 卡片换成几乎不透明的白色，背后的桌面几乎不透出来；编辑区里不画强调线（2026-11-08 去掉，输入框获得焦点时的底边强调线改为五套主题共用） |
| Markdown 标记 | 弱化文字色 |
| 光标 | 与文字同色 |
| 编辑栏 | 附件工具、取消、保存；快捷键写在按钮的工具提示中 |

五套主题共用的编辑模式规则见 [editing.md](../editing.md)。

## 九、动效

| 令牌 | 取值 |
| --- | --- |
| `--sn-duration-fast`、`--sn-duration-normal`、`--sn-duration-slow` | 100、167、250ms |
| `--sn-ease-standard` | `cubic-bezier(0.33, 0, 0.67, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.1, 0.9, 0.2, 1)` |
| `--sn-motion-distance` | 8px |

## 十、实现与平台

- 透出桌面需要透明窗口加窗口材质（Tauri 的 `windowEffects`）。Acrylic 能透出后面的窗口，但在部分 Windows 版本上拖动、调整窗口大小时性能差；Mica 只取一次桌面壁纸，不透出后面的窗口。细节与取舍见 [adaptation.md](../adaptation.md)。
- Linux 与 Android 没有窗口材质，需要一组不透明的面板与卡片颜色（尚未提供）。
- 设置项 `surface` 沿用现有的取值 `win11`，见 [adaptation.md](../adaptation.md)。

## 十一、已知限制

- 背景亚克力在窗口失去激活时退回纯色。现有应用唤出侧栏时会激活窗口，但固定侧栏后回到其他程序工作时，侧栏失去激活，只显示纯色；真实应用中的观感需要实测。
- 微软建议不要在亚克力上放强调色文字；本主题的置顶标记、标签悬停等处用了强调色，实现时需要改为文字色或放在不透明的底上。
- 不透明的退路颜色尚未提供。

## 附录：令牌取值

以下是 [tokens/win11.css](../tokens/win11.css) 中的全部取值，由令牌文件生成，`design-system/tests/docs.test.ts` 检查两者一致。共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。

### 随明暗变化

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--sn-color-panel` | `rgb(252 252 252 / 0.85)` | `rgb(44 44 44 / 0.96)` |
| `--sn-color-panel-band` | `rgb(0 0 0 / 0.035)` | `rgb(0 0 0 / 0.18)` |
| `--sn-color-card` | `rgb(255 255 255 / 0.7)` | `rgb(255 255 255 / 0.05)` |
| `--sn-color-card-head` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card-active` | `rgb(0 95 184 / 0.05)` | `rgb(96 205 255 / 0.06)` |
| `--sn-color-card-head-active` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-editing` | `rgb(255 255 255 / 0.94)` | `#2d2d2d` |
| `--sn-color-sheen` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-bg` | `#f3f3f3` | `#202020` |
| `--sn-color-surface` | `#fbfbfb` | `#272727` |
| `--sn-color-surface-raised` | `#f9f9f9` | `#2c2c2c` |
| `--sn-color-surface-sunken` | `rgb(255 255 255 / 0.7)` | `rgb(255 255 255 / 0.06)` |
| `--sn-color-hover` | `rgb(0 0 0 / 0.04)` | `rgb(255 255 255 / 0.06)` |
| `--sn-color-pressed` | `rgb(0 0 0 / 0.06)` | `rgb(255 255 255 / 0.04)` |
| `--sn-color-selected` | `rgb(0 0 0 / 0.06)` | `rgb(255 255 255 / 0.08)` |
| `--sn-color-overlay` | `rgb(0 0 0 / 0.3)` | `rgb(0 0 0 / 0.45)` |
| `--sn-color-border` | `rgb(0 0 0 / 0.1)` | `rgb(255 255 255 / 0.09)` |
| `--sn-color-border-subtle` | `rgb(0 0 0 / 0.06)` | `rgb(255 255 255 / 0.06)` |
| `--sn-color-border-strong` | `rgb(0 0 0 / 0.56)` | `rgb(255 255 255 / 0.54)` |
| `--sn-color-edge-highlight` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-top` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-bottom` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rule` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-text` | `rgb(0 0 0 / 0.9)` | `#ffffff` |
| `--sn-color-text-secondary` | `rgb(0 0 0 / 0.72)` | `rgb(255 255 255 / 0.79)` |
| `--sn-color-text-muted` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.62)` |
| `--sn-color-text-disabled` | `rgb(0 0 0 / 0.36)` | `rgb(255 255 255 / 0.36)` |
| `--sn-color-halo` | `rgb(255 255 255 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-syntax` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.62)` |
| `--sn-color-accent` | `#005fb8` | `#60cdff` |
| `--sn-color-accent-hover` | `#1a6fc4` | `#7fd6ff` |
| `--sn-color-accent-text` | `#005fb8` | `#99ebff` |
| `--sn-color-accent-subtle` | `rgb(0 95 184 / 0.1)` | `rgb(96 205 255 / 0.12)` |
| `--sn-color-on-accent` | `#ffffff` | `#000000` |
| `--sn-color-focus` | `rgb(0 0 0 / 0.9)` | `#ffffff` |
| `--sn-color-caret` | `rgb(0 0 0 / 0.9)` | `#ffffff` |
| `--sn-color-highlight` | `rgb(255 200 0 / 0.38)` | `rgb(255 200 0 / 0.3)` |
| `--sn-color-selection` | `rgb(0 95 184 / 0.22)` | `rgb(96 205 255 / 0.3)` |
| `--sn-color-inverse` | `#2b2b2b` | `#f3f3f3` |
| `--sn-color-on-inverse` | `#ffffff` | `#1c1c1c` |
| `--sn-color-mark-workspace` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.62)` |
| `--sn-color-mark-pinned` | `#005fb8` | `#99ebff` |
| `--sn-color-mark-archive` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.62)` |
| `--sn-color-success` | `#0f7b0f` | `#6ccb5f` |
| `--sn-color-success-subtle` | `rgb(15 123 15 / 0.1)` | `rgb(108 203 95 / 0.13)` |
| `--sn-color-warning` | `#8a5300` | `#fce100` |
| `--sn-color-warning-subtle` | `rgb(157 93 0 / 0.12)` | `rgb(252 225 0 / 0.12)` |
| `--sn-color-danger` | `#c42b1c` | `#ff99a4` |
| `--sn-color-danger-subtle` | `rgb(196 43 28 / 0.1)` | `rgb(255 153 164 / 0.12)` |
| `--sn-color-info` | `#005fb8` | `#99ebff` |
| `--sn-color-info-subtle` | `rgb(0 95 184 / 0.08)` | `rgb(96 205 255 / 0.1)` |
| `--sn-code-bg` | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.06)` |
| `--sn-code-text` | `rgb(0 0 0 / 0.9)` | `#ffffff` |
| `--sn-shadow-sm` | `0 1px 2px rgb(0 0 0 / 0.06)` | `0 1px 2px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-md` | `0 8px 16px rgb(0 0 0 / 0.14), 0 0 0 1px rgb(0 0 0 / 0.05)` | `0 8px 16px rgb(0 0 0 / 0.26), 0 0 0 1px rgb(0 0 0 / 0.2)` |
| `--sn-shadow-lg` | `0 32px 64px rgb(0 0 0 / 0.19), 0 2px 21px rgb(0 0 0 / 0.15)` | `0 32px 64px rgb(0 0 0 / 0.37), 0 2px 21px rgb(0 0 0 / 0.37)` |
| `--sn-shadow-panel` | `0 8px 32px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.08)` | `0 8px 32px rgb(0 0 0 / 0.4), 0 2px 8px rgb(0 0 0 / 0.25)` |
| `--sn-shadow-card-active` | `0 0 0 1px var(--sn-color-accent), 0 2px 4px rgb(0 0 0 / 0.08)` | `0 0 0 1px var(--sn-color-accent), 0 2px 6px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-editing` | `0 8px 16px rgb(0 0 0 / 0.14)` | `0 8px 16px rgb(0 0 0 / 0.3)` |

### 不随明暗变化

| 令牌 | 取值 |
| --- | --- |
| `--sn-panel-blur` | `30px` |
| `--sn-panel-saturate` | `1.25` |
| `--sn-panel-inset` | `12px` |
| `--sn-panel-radius` | `8px` |
| `--sn-panel-radius-edge` | `8px` |
| `--sn-block-gap` | `0px` |
| `--sn-font-ui` | `'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC', system-ui, -apple-system, Roboto, 'Noto Sans', Ubuntu, Cantarell, sans-serif` |
| `--sn-font-title` | `'Segoe UI Variable Display', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC', system-ui, -apple-system, Roboto, 'Noto Sans', Ubuntu, Cantarell, sans-serif` |
| `--sn-font-note` | `var(--sn-font-ui)` |
| `--sn-font-meta` | `var(--sn-font-ui)` |
| `--sn-font-code` | `'Cascadia Mono', 'Maple Mono NF CN', Consolas, 'Noto Sans Mono', 'DejaVu Sans Mono', monospace` |
| `--sn-font-size-xs` | `11px` |
| `--sn-font-size-sm` | `12px` |
| `--sn-font-size-md` | `13px` |
| `--sn-font-size-lg` | `14px` |
| `--sn-font-size-xl` | `20px` |
| `--sn-line-height-tight` | `1.3` |
| `--sn-line-height-normal` | `1.45` |
| `--sn-line-height-relaxed` | `1.6` |
| `--sn-note-size` | `14px` |
| `--sn-note-line-height` | `1.55` |
| `--sn-code-size` | `12.5px` |
| `--sn-body-weight` | `400` |
| `--sn-title-weight` | `600` |
| `--sn-title-tracking` | `0em` |
| `--sn-radius-xs` | `2px` |
| `--sn-radius-sm` | `4px` |
| `--sn-radius-md` | `4px` |
| `--sn-radius-lg` | `8px` |
| `--sn-radius-control` | `4px` |
| `--sn-radius-chip` | `4px` |
| `--sn-card-radius` | `4px` |
| `--sn-duration-fast` | `100ms` |
| `--sn-duration-normal` | `167ms` |
| `--sn-duration-slow` | `250ms` |
| `--sn-ease-standard` | `cubic-bezier(0.33, 0, 0.67, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.1, 0.9, 0.2, 1)` |
| `--sn-ease-exit` | `cubic-bezier(1, 0, 1, 1)` |
| `--sn-motion-distance` | `8px` |
| `--sn-header-height` | `44px` |
| `--sn-tab-height` | `32px` |
| `--sn-footer-height` | `48px` |
| `--sn-panel-padding` | `12px` |
| `--sn-card-padding-x` | `12px` |
| `--sn-card-padding-y` | `10px` |
| `--sn-card-gap` | `4px` |
| `--sn-control-height-sm` | `24px` |
| `--sn-control-height` | `32px` |
| `--sn-control-height-lg` | `40px` |
| `--sn-icon-size` | `16px` |
| `--sn-icon-size-sm` | `14px` |
| `--sn-icon-stroke` | `1.5` |
| `--sn-menu-item-height` | `32px` |
| `--sn-dialog-width` | `440px` |
