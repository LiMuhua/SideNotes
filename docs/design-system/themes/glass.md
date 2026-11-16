# 磨砂玻璃（Frosted Glass）

分开的几块磨砂玻璃，在边缘透出桌面：立体感来自玻璃边缘的受光，而不是投影；文字在任何背景上都清楚。取自 Glance 的磨砂玻璃外观，也对应现有 SideNotes 的玻璃材质。

令牌文件：[tokens/glass.css](../tokens/glass.css)。结构差异：[surfaces.ts](../playground/src/surfaces.ts) 中 `id: 'glass'` 的一项。

## 一、定位

| 项目 | 内容 |
| --- | --- |
| 关键词 | 分块玻璃、边缘受光、大圆角、分区色、青色强调色、文字光晕 |
| 适合 | 喜欢轻盈、通透的界面，桌面壁纸也是工作环境一部分的用户 |
| 参考 | Glance 磨砂玻璃外观（`theme.rs`、`skins.rs`），见 [glance-analysis.md](../references/glance-analysis.md)；现有 SideNotes 的玻璃材质 |

## 二、结构

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 与屏幕边缘 | 分开的若干块 | 侧栏没有整块面板：标题区与页签、列表顶栏、新建卡片、每条记录、底栏都是独立的玻璃块，离开屏幕边缘 10px，块与块之间留 8px；速记浮窗是一整块玻璃，编辑器直接写在玻璃上 |
| 记录 | 玻璃块 | 18px 圆角，各自磨砂 |
| 页签 | 分段控件 | 页签前有分区色圆点：工作区青色、置顶琥珀色、归档蓝色 |
| 底栏 | 版本号与设置 | 单独一块玻璃 |
| 快捷键 | 写在工具提示中 | — |
| 页签色点 | 有 | Glance 每个模块一种颜色，这里只用在页签的小圆点上 |
| 材质 | 半透明 | 每块玻璃模糊 24px、饱和度 1.1，需要透明窗口与窗口材质 |

## 三、颜色

玻璃是白色（深色为深青灰）加透明度，强调色是低饱和的青色，与 Windows 11 的蓝、记录纸的绿区分开；此前的紫色显得突兀，2026-11-08 改为青色。Glance 按背景亮度与杂乱程度实时调整磨砂程度；这里取固定的较高不透明度，保证玻璃叠在纯黑或纯白上，弱化文字仍达到 4.5:1。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 面板 | `--sn-color-panel` | 透明 | 透明 |
| 玻璃块 | `--sn-color-card` | 白色 78% | `#121618` 80% |
| 主要文字 | `--sn-color-text` | 黑色 88% | 白色 95% |
| 弱化文字 | `--sn-color-text-muted` | 黑色 62% | 白色 70% |
| 强调色 | `--sn-color-accent` | `#1f6f78` | `#72c7c1` |
| 强调色文字 | `--sn-color-accent-text` | `#17525a` | `#a8e3df` |
| 边缘受光（上、下） | `--sn-color-rim-top`、`--sn-color-rim-bottom` | 白色 95%、30% | 白色 30%、6% |
| 顶部光泽 | `--sn-color-sheen` | 白色 35% | 白色 5% |
| 文字光晕 | `--sn-color-halo` | 白色 60% | 黑色 50% |
| 编辑底色 | `--sn-color-editing` | 白色 93% | `#141a1c` 94% |

全部取值见附录。

## 四、字体与排版

| 用途 | 令牌 | 取值 |
| --- | --- | --- |
| 界面、标题、正文 | `--sn-font-ui` 等 | Inter，回落到 Segoe UI Variable Text、Microsoft YaHei UI 与 Linux 的 Noto Sans 等 |
| 代码 | `--sn-font-code` | Cascadia Mono、Maple Mono NF CN、Consolas |
| 界面字号 | `--sn-font-size-xs` 至 `--sn-font-size-xl` | 11、12、13、14、20px |
| 正文字重 | `--sn-body-weight` | 500，在半透明背景上保持清晰 |
| 卡片标题 | `--sn-font-size-lg`、`--sn-title-weight` | 14px，字重 650，字距 -0.01em，最多两行 |
| 正文 | `--sn-note-size`、`--sn-note-line-height` | 13.5px，行高 1.6 |

## 五、形状、间距与尺寸

| 项目 | 令牌 | 取值 |
| --- | --- | --- |
| 面板离屏幕边缘、玻璃块圆角 | `--sn-panel-inset`、`--sn-panel-radius` | 10px、24px |
| 块与块之间 | `--sn-block-gap` | 8px |
| 记录圆角、控件圆角 | `--sn-card-radius`、`--sn-radius-control` | 18px、12px |
| 面板内边距 | `--sn-panel-padding` | 14px |
| 记录内边距 | `--sn-card-padding-x`、`--sn-card-padding-y` | 16px、13px |
| 记录间隙 | `--sn-card-gap` | 8px |
| 控件高度 | `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` | 26、32、40px |
| 标题区、页签、底栏 | `--sn-header-height`、`--sn-tab-height`、`--sn-footer-height` | 48、30、48px |

## 六、层次与立体感

立体感来自玻璃边缘的受光，而不是投影：

- 边缘受光：一圈上亮下暗的渐变描边，盖在边框上（`--sn-color-rim-top` 到 `--sn-color-rim-bottom`）。
- 顶部光泽：玻璃块顶部从上往下渐隐的一层浅色（`--sn-color-sheen`）。
- 投影只保留贴近边缘的一点（`--sn-shadow-panel`）：块与块之间留着缝，大投影叠在缝里会显得脏。
- 文字带一圈光晕（`--sn-color-halo`），在杂乱的背景上保持清楚。

悬停与选中只把边框换成强调色，编辑时只换成更实的玻璃并浮起，都不加彩色光晕；速记浮窗是一大块玻璃，不用顶部光泽。

## 七、状态

| 状态 | 表现 | 令牌 |
| --- | --- | --- |
| 默认 | 磨砂玻璃块，边缘受光与顶部光泽，右侧显示时间 | `--sn-color-card`、`--sn-color-rim-top`、`--sn-color-sheen` |
| 悬停与选中 | 去掉边缘受光，露出青色边框，外加一像素的青色线与很浅的投影，叠一层很淡的青色；时间换成操作按钮 | `--sn-shadow-card-active`、`--sn-color-card-active` |
| 多选 | 玻璃块叠一层浅青色，青色边框 | `--sn-color-accent-subtle` |
| 键盘焦点 | 玻璃块内侧一圈 2px 的焦点环 | `--sn-color-focus` |
| 编辑中 | 玻璃磨得更实，几乎不透出背景，并浮起；边框与边缘受光不变，不用青色，不加光晕 | `--sn-color-editing`、`--sn-shadow-editing` |
| 其余卡片变淡 | 有卡片在编辑时降到禁用透明度，悬停时恢复 | `--sn-opacity-disabled` |
| 收起 | 只剩标题行 | — |

## 八、编辑模式

| 部位 | 表现 |
| --- | --- |
| 编辑区 | 玻璃磨得更实（白色 93%），背后的桌面几乎不透出来，长时间输入也不累 |
| Markdown 标记 | 弱化文字色 |
| 光标 | 青色 |
| 编辑栏 | 附件工具、取消、保存；快捷键写在按钮的工具提示中 |

五套主题共用的编辑模式规则见 [editing.md](../editing.md)。

## 九、动效

| 令牌 | 取值 |
| --- | --- |
| `--sn-duration-fast`、`--sn-duration-normal`、`--sn-duration-slow` | 160、260、360ms |
| `--sn-ease-standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.2, 0.9, 0.25, 1.06)`，结尾略微回弹 |
| `--sn-motion-distance` | 10px |

## 十、实现与平台

- 实现条件与 [Windows 11](./win11.md) 相同：透明窗口加窗口材质，Linux 与 Android 退回不透明的颜色（尚未提供），见 [adaptation.md](../adaptation.md)。
- 每块玻璃各自模糊，渲染开销在五套中最大；如果实测卡顿，可以改为整个侧栏模糊一次、玻璃块只画底色与受光。
- 设置项 `surface` 沿用现有的取值 `glass`，见 [adaptation.md](../adaptation.md)。

## 十一、已知限制

- 大圆角与块间距占空间，密度低。
- Playground 中，列表底边处被裁到一半的玻璃块会漏出背后的内容，疑似 Chromium 对滚动容器裁切与 `backdrop-filter` 的绘制问题，需要在 WebView2 中复核。
- Inter 没有随应用打包，多数电脑上显示的是系统字体。

## 附录：令牌取值

以下是 [tokens/glass.css](../tokens/glass.css) 中的全部取值，由令牌文件生成，`docs/design-system/tests/docs.test.ts` 检查两者一致。共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。

### 随明暗变化

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--sn-color-panel` | `rgb(255 255 255 / 0)` | `rgb(18 22 24 / 0)` |
| `--sn-color-panel-band` | `rgb(255 255 255 / 0)` | `rgb(18 22 24 / 0)` |
| `--sn-color-card` | `rgb(255 255 255 / 0.78)` | `rgb(18 22 24 / 0.8)` |
| `--sn-color-card-head` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card-active` | `rgb(31 111 120 / 0.05)` | `rgb(114 199 193 / 0.07)` |
| `--sn-color-card-head-active` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-editing` | `rgb(255 255 255 / 0.93)` | `rgb(20 26 28 / 0.94)` |
| `--sn-color-sheen` | `rgb(255 255 255 / 0.35)` | `rgb(255 255 255 / 0.05)` |
| `--sn-color-bg` | `#edf1f2` | `#101415` |
| `--sn-color-surface` | `#f6f8f9` | `#171c1e` |
| `--sn-color-surface-raised` | `#ffffff` | `#20272a` |
| `--sn-color-surface-sunken` | `rgb(255 255 255 / 0.72)` | `rgb(255 255 255 / 0.07)` |
| `--sn-color-hover` | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.08)` |
| `--sn-color-pressed` | `rgb(0 0 0 / 0.08)` | `rgb(255 255 255 / 0.12)` |
| `--sn-color-selected` | `rgb(31 111 120 / 0.1)` | `rgb(114 199 193 / 0.14)` |
| `--sn-color-overlay` | `rgb(8 20 24 / 0.3)` | `rgb(0 0 0 / 0.5)` |
| `--sn-color-border` | `rgb(0 0 0 / 0.1)` | `rgb(255 255 255 / 0.12)` |
| `--sn-color-border-subtle` | `rgb(0 0 0 / 0.06)` | `rgb(255 255 255 / 0.08)` |
| `--sn-color-border-strong` | `rgb(0 0 0 / 0.56)` | `rgb(255 255 255 / 0.56)` |
| `--sn-color-edge-highlight` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-top` | `rgb(255 255 255 / 0.95)` | `rgb(255 255 255 / 0.3)` |
| `--sn-color-rim-bottom` | `rgb(255 255 255 / 0.3)` | `rgb(255 255 255 / 0.06)` |
| `--sn-color-rule` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-text` | `rgb(0 0 0 / 0.88)` | `rgb(255 255 255 / 0.95)` |
| `--sn-color-text-secondary` | `rgb(0 0 0 / 0.72)` | `rgb(255 255 255 / 0.8)` |
| `--sn-color-text-muted` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.7)` |
| `--sn-color-text-disabled` | `rgb(0 0 0 / 0.34)` | `rgb(255 255 255 / 0.34)` |
| `--sn-color-halo` | `rgb(255 255 255 / 0.6)` | `rgb(0 0 0 / 0.5)` |
| `--sn-color-syntax` | `rgb(0 0 0 / 0.62)` | `rgb(255 255 255 / 0.7)` |
| `--sn-color-accent` | `#1f6f78` | `#72c7c1` |
| `--sn-color-accent-hover` | `#195c64` | `#8fd5d0` |
| `--sn-color-accent-text` | `#17525a` | `#a8e3df` |
| `--sn-color-accent-subtle` | `rgb(31 111 120 / 0.12)` | `rgb(114 199 193 / 0.12)` |
| `--sn-color-on-accent` | `#ffffff` | `#072624` |
| `--sn-color-focus` | `#1f6f78` | `#a8e3df` |
| `--sn-color-caret` | `#1f6f78` | `#8fd5d0` |
| `--sn-color-highlight` | `rgb(255 204 0 / 0.4)` | `rgb(255 204 0 / 0.3)` |
| `--sn-color-selection` | `rgb(31 111 120 / 0.2)` | `rgb(114 199 193 / 0.3)` |
| `--sn-color-inverse` | `#172226` | `#eef3f4` |
| `--sn-color-on-inverse` | `#ffffff` | `#172226` |
| `--sn-color-mark-workspace` | `#1f6f78` | `#a8e3df` |
| `--sn-color-mark-pinned` | `#a35400` | `#ffb347` |
| `--sn-color-mark-archive` | `#3a5bb8` | `#a3b8ff` |
| `--sn-color-success` | `#146a33` | `#57d67b` |
| `--sn-color-success-subtle` | `rgb(36 161 72 / 0.12)` | `rgb(48 209 88 / 0.14)` |
| `--sn-color-warning` | `#8a5000` | `#ffc460` |
| `--sn-color-warning-subtle` | `rgb(232 137 12 / 0.14)` | `rgb(255 159 10 / 0.14)` |
| `--sn-color-danger` | `#9b1c14` | `#ff9e97` |
| `--sn-color-danger-subtle` | `rgb(255 59 48 / 0.12)` | `rgb(255 105 97 / 0.14)` |
| `--sn-color-info` | `#003f8a` | `#9ccfff` |
| `--sn-color-info-subtle` | `rgb(10 122 255 / 0.1)` | `rgb(61 155 255 / 0.12)` |
| `--sn-code-bg` | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.07)` |
| `--sn-code-text` | `rgb(0 0 0 / 0.88)` | `rgb(255 255 255 / 0.95)` |
| `--sn-shadow-sm` | `0 1px 2px rgb(15 30 34 / 0.05)` | `0 1px 2px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-md` | `0 10px 30px rgb(15 30 34 / 0.14), 0 1px 3px rgb(15 30 34 / 0.08)` | `0 10px 30px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.2)` |
| `--sn-shadow-lg` | `0 24px 60px rgb(15 30 34 / 0.2), 0 2px 8px rgb(15 30 34 / 0.08)` | `0 24px 60px rgb(0 0 0 / 0.45), 0 2px 8px rgb(0 0 0 / 0.25)` |
| `--sn-shadow-panel` | `0 1px 2px rgb(15 30 34 / 0.06)` | `0 1px 2px rgb(0 0 0 / 0.25)` |
| `--sn-shadow-card-active` | `0 0 0 1px var(--sn-color-accent), 0 2px 8px rgb(15 30 34 / 0.1)` | `0 0 0 1px var(--sn-color-accent), 0 2px 10px rgb(0 0 0 / 0.35)` |
| `--sn-shadow-editing` | `0 12px 28px rgb(15 30 34 / 0.16)` | `0 12px 28px rgb(0 0 0 / 0.45)` |

### 不随明暗变化

| 令牌 | 取值 |
| --- | --- |
| `--sn-panel-blur` | `24px` |
| `--sn-panel-saturate` | `1.1` |
| `--sn-panel-inset` | `10px` |
| `--sn-panel-radius` | `24px` |
| `--sn-panel-radius-edge` | `24px` |
| `--sn-block-gap` | `8px` |
| `--sn-font-ui` | `Inter, 'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC', system-ui, -apple-system, Roboto, 'Noto Sans', Ubuntu, Cantarell, sans-serif` |
| `--sn-font-title` | `var(--sn-font-ui)` |
| `--sn-font-note` | `var(--sn-font-ui)` |
| `--sn-font-meta` | `var(--sn-font-ui)` |
| `--sn-font-code` | `'Cascadia Mono', 'Maple Mono NF CN', Consolas, 'Noto Sans Mono', 'DejaVu Sans Mono', monospace` |
| `--sn-font-size-xs` | `11px` |
| `--sn-font-size-sm` | `12px` |
| `--sn-font-size-md` | `13px` |
| `--sn-font-size-lg` | `14px` |
| `--sn-font-size-xl` | `20px` |
| `--sn-line-height-tight` | `1.3` |
| `--sn-line-height-normal` | `1.5` |
| `--sn-line-height-relaxed` | `1.65` |
| `--sn-note-size` | `13.5px` |
| `--sn-note-line-height` | `1.6` |
| `--sn-code-size` | `12px` |
| `--sn-body-weight` | `500` |
| `--sn-title-weight` | `650` |
| `--sn-title-tracking` | `-0.01em` |
| `--sn-radius-xs` | `6px` |
| `--sn-radius-sm` | `10px` |
| `--sn-radius-md` | `14px` |
| `--sn-radius-lg` | `22px` |
| `--sn-radius-control` | `12px` |
| `--sn-radius-chip` | `999px` |
| `--sn-card-radius` | `18px` |
| `--sn-duration-fast` | `160ms` |
| `--sn-duration-normal` | `260ms` |
| `--sn-duration-slow` | `360ms` |
| `--sn-ease-standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.2, 0.9, 0.25, 1.06)` |
| `--sn-ease-exit` | `cubic-bezier(0.4, 0, 0.7, 1)` |
| `--sn-motion-distance` | `10px` |
| `--sn-header-height` | `48px` |
| `--sn-tab-height` | `30px` |
| `--sn-footer-height` | `48px` |
| `--sn-panel-padding` | `14px` |
| `--sn-card-padding-x` | `16px` |
| `--sn-card-padding-y` | `13px` |
| `--sn-card-gap` | `8px` |
| `--sn-control-height-sm` | `26px` |
| `--sn-control-height` | `32px` |
| `--sn-control-height-lg` | `40px` |
| `--sn-icon-size` | `17px` |
| `--sn-icon-size-sm` | `15px` |
| `--sn-icon-stroke` | `1.75` |
| `--sn-menu-item-height` | `34px` |
| `--sn-dialog-width` | `440px` |
