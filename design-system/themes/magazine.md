# 杂志（Magazine）

一本随手翻的杂志：暖白纸色、衬线标题、宽松留白，莓红只用在选中、焦点与主要操作上。

令牌文件：[tokens/magazine.css](../tokens/magazine.css)。结构差异：[surfaces.ts](../playground/src/surfaces.ts) 中 `id: 'magazine'` 的一项。

## 一、定位

| 项目 | 内容 |
| --- | --- |
| 关键词 | 暖白纸色、莓红强调色、衬线标题、圆角卡片、浮动面板 |
| 适合 | 记录以文字为主、常回看较长内容的用户；阅读最舒适，信息密度最低 |
| 参考 | 杂志与阅读类应用的排版；Apple HIG 的阅读排版；Material 3 的色调表面；现有 SideNotes 的纸张配色 |

## 二、结构

| 项目 | 取值 | 说明 |
| --- | --- | --- |
| 与屏幕边缘 | 浮动面板 | 离开屏幕边缘 8px，18px 圆角，一像素边框 |
| 记录 | 卡片 | 14px 圆角，柔和的投影，卡片之间留 10px |
| 页签 | 分段控件 | 胶囊形，当前页签为白色的胶囊 |
| 底栏 | 存储状态与设置 | — |
| 快捷键 | 写在工具提示中 | — |
| 页签色点 | 无 | — |
| 材质 | 实心 | 不需要透明窗口 |

## 三、颜色

暖白纸色的面板，卡片比面板更白；文字是偏暖的近黑色，强调色是莓红。深色模式是暖调的深褐，强调色换成浅一些的粉红。危险色用偏橙的红，与莓红区分开。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 面板 | `--sn-color-panel` | `#f3ede3` | `#1c1a17` |
| 卡片 | `--sn-color-card` | `#fffcf7` | `#26231f` |
| 选中卡片的叠加色 | `--sn-color-card-active` | 叠 3.5% 的莓红 | 叠 5% 的粉红 |
| 主要文字 | `--sn-color-text` | `#211b16` | `#efe9df` |
| 弱化文字 | `--sn-color-text-muted` | `#665b50` | `#9e978b` |
| 强调色 | `--sn-color-accent` | `#a4224f` | `#f28aa8` |
| 危险色 | `--sn-color-danger` | `#b23a1e` | `#f08a6c` |
| 编辑底色 | `--sn-color-editing` | `#ffffff` | `#2b2823` |
| Markdown 标记 | `--sn-color-syntax` | `#74675a` | `#a39b8f` |

全部取值见附录。

## 四、字体与排版

| 用途 | 令牌 | 取值 |
| --- | --- | --- |
| 界面与正文 | `--sn-font-ui`、`--sn-font-note` | Segoe UI Variable Text、Segoe UI、Microsoft YaHei UI，Linux 回落到 Noto Sans 等系统字体 |
| 标题 | `--sn-font-title` | Georgia、Iowan Old Style、Noto Serif SC、Source Han Serif SC，最后回落到宋体 |
| 代码 | `--sn-font-code` | Maple Mono NF CN、Cascadia Code、Cascadia Mono、JetBrains Mono、Consolas |
| 界面字号 | `--sn-font-size-xs` 至 `--sn-font-size-xl` | 11、12、13、15、20px |
| 卡片标题 | `--sn-font-size-lg`、`--sn-title-weight` | 15px，字重 600，字距 -0.01em，最多两行 |
| 正文 | `--sn-note-size`、`--sn-note-line-height` | 14px，行高 1.75 |

## 五、形状、间距与尺寸

| 项目 | 令牌 | 取值 |
| --- | --- | --- |
| 面板离屏幕边缘、面板圆角 | `--sn-panel-inset`、`--sn-panel-radius` | 8px、18px |
| 记录圆角、控件圆角 | `--sn-card-radius`、`--sn-radius-control` | 14px、999px（胶囊） |
| 面板内边距 | `--sn-panel-padding` | 14px |
| 记录内边距 | `--sn-card-padding-x`、`--sn-card-padding-y` | 16px、14px |
| 记录间隙 | `--sn-card-gap` | 10px |
| 控件高度 | `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` | 26、32、40px |
| 标题区、页签、底栏 | `--sn-header-height`、`--sn-tab-height`、`--sn-footer-height` | 52、32、42px |

密度在五套中最低。

## 六、层次与立体感

层次靠暖色调的柔和投影：卡片是两层轻投影（`--sn-shadow-sm`），浮动面板是一层大而淡的投影（`--sn-shadow-panel`）。投影带一点暖褐色，不用纯黑。

## 七、状态

| 状态 | 表现 | 令牌 |
| --- | --- | --- |
| 默认 | 白色卡片、浅色边框、轻投影，右侧显示时间 | `--sn-color-card`、`--sn-color-border-subtle`、`--sn-shadow-sm` |
| 悬停与选中 | 莓红边框，外面一圈 3px 的淡莓红，卡片略微浮起；时间换成操作按钮 | `--sn-shadow-card-active`、`--sn-color-card-active` |
| 多选 | 卡片叠一层浅莓红，莓红边框 | `--sn-color-accent-subtle` |
| 键盘焦点 | 卡片内侧一圈 2px 的焦点环 | `--sn-color-focus` |
| 编辑中 | 白色底，明显浮起；边框不变，不用莓红 | `--sn-color-editing`、`--sn-shadow-editing` |
| 其余卡片变淡 | 有卡片在编辑时降到禁用透明度，悬停时恢复 | `--sn-opacity-disabled` |
| 收起 | 只剩标题行 | — |

## 八、编辑模式

| 部位 | 表现 |
| --- | --- |
| 编辑区 | 卡片换成纯白（深色为 `#2b2823`），像翻开的一页 |
| 标题 | 编辑区中的标题行同样用衬线字体 |
| Markdown 标记 | 暖灰色 |
| 光标 | 莓红 |
| 编辑栏 | 附件工具、取消、保存；快捷键写在按钮的工具提示中 |

五套主题共用的编辑模式规则见 [editing.md](../editing.md)。

## 九、动效

| 令牌 | 取值 |
| --- | --- |
| `--sn-duration-fast`、`--sn-duration-normal`、`--sn-duration-slow` | 150、240、340ms |
| `--sn-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)`，强调型减速 |
| `--sn-motion-distance` | 12px |

动效稍长，元素出现时有明显的减速。

## 十、实现与平台

- 实心表面，Windows、Linux、Android 都不需要窗口材质。
- 浮动面板离开屏幕边缘 8px：侧栏窗口仍贴住屏幕边缘，这 8px 是窗口内的留白，要透出桌面就需要透明窗口（不需要窗口材质）；不用透明窗口时，留白只能画成实色，浮动的效果随之消失。
- 设置项 `surface` 取值 `magazine`，是新增的取值，见 [adaptation.md](../adaptation.md)。

## 十一、已知限制

- 一屏能看到的记录在五套中最少。
- 中文衬线字体在多数 Windows 上要回落到宋体，屏幕显示效果一般；效果稳定需要随应用打包字体，并确认许可。
- 鼠标移到屏幕边缘唤出时，面板与屏幕边缘之间有一条缝。

## 附录：令牌取值

以下是 [tokens/magazine.css](../tokens/magazine.css) 中的全部取值，由令牌文件生成，`design-system/tests/docs.test.ts` 检查两者一致。共享令牌（间距、字重、描边宽度、层级等）所有主题相同，见 [design-tokens.md](../design-tokens.md)。

### 随明暗变化

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--sn-color-panel` | `#f3ede3` | `#1c1a17` |
| `--sn-color-panel-band` | `rgb(70 45 20 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card` | `#fffcf7` | `#26231f` |
| `--sn-color-card-head` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-card-active` | `rgb(164 34 79 / 0.035)` | `rgb(242 138 168 / 0.05)` |
| `--sn-color-card-head-active` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-editing` | `#ffffff` | `#2b2823` |
| `--sn-color-sheen` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-bg` | `#ece4d7` | `#161513` |
| `--sn-color-surface` | `#f9f5ee` | `#1f1d1a` |
| `--sn-color-surface-raised` | `#fffdf9` | `#2b2925` |
| `--sn-color-surface-sunken` | `#ebe3d6` | `#181715` |
| `--sn-color-hover` | `rgb(70 45 20 / 0.05)` | `rgb(255 246 235 / 0.05)` |
| `--sn-color-pressed` | `rgb(70 45 20 / 0.09)` | `rgb(255 246 235 / 0.09)` |
| `--sn-color-selected` | `rgb(164 34 79 / 0.08)` | `rgb(242 138 168 / 0.12)` |
| `--sn-color-overlay` | `rgb(40 28 18 / 0.34)` | `rgb(0 0 0 / 0.5)` |
| `--sn-color-border` | `#e0d6c6` | `#36322c` |
| `--sn-color-border-subtle` | `#ebe2d4` | `#2c2925` |
| `--sn-color-border-strong` | `#887c6e` | `#7d766a` |
| `--sn-color-edge-highlight` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-top` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rim-bottom` | `rgb(255 255 255 / 0)` | `rgb(255 255 255 / 0)` |
| `--sn-color-rule` | `rgb(0 0 0 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-text` | `#211b16` | `#efe9df` |
| `--sn-color-text-secondary` | `#4b4038` | `#c6bfb3` |
| `--sn-color-text-muted` | `#665b50` | `#9e978b` |
| `--sn-color-text-disabled` | `#b0a594` | `#625d54` |
| `--sn-color-halo` | `rgb(255 255 255 / 0)` | `rgb(0 0 0 / 0)` |
| `--sn-color-syntax` | `#74675a` | `#a39b8f` |
| `--sn-color-accent` | `#a4224f` | `#f28aa8` |
| `--sn-color-accent-hover` | `#8a1b42` | `#f6a3bb` |
| `--sn-color-accent-text` | `#9a1f4a` | `#f59ab5` |
| `--sn-color-accent-subtle` | `rgb(164 34 79 / 0.1)` | `rgb(242 138 168 / 0.14)` |
| `--sn-color-on-accent` | `#ffffff` | `#2a0a15` |
| `--sn-color-focus` | `#a4224f` | `#f59ab5` |
| `--sn-color-caret` | `#a4224f` | `#f28aa8` |
| `--sn-color-highlight` | `rgb(240 200 90 / 0.42)` | `rgb(230 196 90 / 0.3)` |
| `--sn-color-selection` | `rgb(164 34 79 / 0.16)` | `rgb(242 138 168 / 0.26)` |
| `--sn-color-inverse` | `#2a231d` | `#efe9df` |
| `--sn-color-on-inverse` | `#f5efe6` | `#1f1d1a` |
| `--sn-color-mark-workspace` | `#665b50` | `#9e978b` |
| `--sn-color-mark-pinned` | `#9a1f4a` | `#f59ab5` |
| `--sn-color-mark-archive` | `#665b50` | `#9e978b` |
| `--sn-color-success` | `#286b38` | `#86c98f` |
| `--sn-color-success-subtle` | `rgb(46 119 64 / 0.1)` | `rgb(134 201 143 / 0.14)` |
| `--sn-color-warning` | `#865800` | `#e2b65c` |
| `--sn-color-warning-subtle` | `rgb(200 150 40 / 0.14)` | `rgb(226 182 92 / 0.14)` |
| `--sn-color-danger` | `#b23a1e` | `#f08a6c` |
| `--sn-color-danger-subtle` | `rgb(178 58 30 / 0.1)` | `rgb(240 138 108 / 0.14)` |
| `--sn-color-info` | `#3a64a8` | `#8cb0e8` |
| `--sn-color-info-subtle` | `rgb(58 100 168 / 0.1)` | `rgb(140 176 232 / 0.14)` |
| `--sn-code-bg` | `#f2ece2` | `#191714` |
| `--sn-code-text` | `#262019` | `#e6e0d5` |
| `--sn-shadow-sm` | `0 1px 2px rgb(70 45 20 / 0.06), 0 2px 8px -4px rgb(70 45 20 / 0.1)` | `0 1px 2px rgb(0 0 0 / 0.35)` |
| `--sn-shadow-md` | `0 8px 24px rgb(70 45 20 / 0.1), 0 1px 3px rgb(70 45 20 / 0.05)` | `0 10px 28px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 246 235 / 0.04)` |
| `--sn-shadow-lg` | `0 24px 60px -16px rgb(70 45 20 / 0.3), 0 4px 12px rgb(70 45 20 / 0.06)` | `0 28px 64px -16px rgb(0 0 0 / 0.65), 0 4px 12px rgb(0 0 0 / 0.3)` |
| `--sn-shadow-panel` | `0 24px 60px -18px rgb(70 45 20 / 0.34), 0 2px 8px rgb(70 45 20 / 0.08)` | `0 28px 64px -18px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 246 235 / 0.05)` |
| `--sn-shadow-card-active` | `0 0 0 3px rgb(164 34 79 / 0.14), 0 10px 24px -12px rgb(70 45 20 / 0.3)` | `0 0 0 3px rgb(242 138 168 / 0.16), 0 10px 24px -12px rgb(0 0 0 / 0.6)` |
| `--sn-shadow-editing` | `0 16px 32px -14px rgb(70 45 20 / 0.34)` | `0 16px 32px -14px rgb(0 0 0 / 0.7)` |

### 不随明暗变化

| 令牌 | 取值 |
| --- | --- |
| `--sn-panel-blur` | `0px` |
| `--sn-panel-saturate` | `1` |
| `--sn-panel-inset` | `8px` |
| `--sn-panel-radius` | `18px` |
| `--sn-panel-radius-edge` | `18px` |
| `--sn-block-gap` | `0px` |
| `--sn-font-ui` | `'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC', system-ui, -apple-system, Roboto, 'Noto Sans', Ubuntu, Cantarell, sans-serif` |
| `--sn-font-title` | `Georgia, 'Iowan Old Style', 'Noto Serif SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', SimSun, serif` |
| `--sn-font-note` | `var(--sn-font-ui)` |
| `--sn-font-meta` | `var(--sn-font-ui)` |
| `--sn-font-code` | `'Maple Mono NF CN', 'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', Consolas, 'Noto Sans Mono', 'DejaVu Sans Mono', monospace` |
| `--sn-font-size-xs` | `11px` |
| `--sn-font-size-sm` | `12px` |
| `--sn-font-size-md` | `13px` |
| `--sn-font-size-lg` | `15px` |
| `--sn-font-size-xl` | `20px` |
| `--sn-line-height-tight` | `1.3` |
| `--sn-line-height-normal` | `1.55` |
| `--sn-line-height-relaxed` | `1.75` |
| `--sn-note-size` | `14px` |
| `--sn-note-line-height` | `1.75` |
| `--sn-code-size` | `12.5px` |
| `--sn-body-weight` | `400` |
| `--sn-title-weight` | `600` |
| `--sn-title-tracking` | `-0.01em` |
| `--sn-radius-xs` | `5px` |
| `--sn-radius-sm` | `8px` |
| `--sn-radius-md` | `12px` |
| `--sn-radius-lg` | `18px` |
| `--sn-radius-control` | `999px` |
| `--sn-radius-chip` | `999px` |
| `--sn-card-radius` | `14px` |
| `--sn-duration-fast` | `150ms` |
| `--sn-duration-normal` | `240ms` |
| `--sn-duration-slow` | `340ms` |
| `--sn-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--sn-ease-enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| `--sn-ease-exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` |
| `--sn-motion-distance` | `12px` |
| `--sn-header-height` | `52px` |
| `--sn-tab-height` | `32px` |
| `--sn-footer-height` | `42px` |
| `--sn-panel-padding` | `14px` |
| `--sn-card-padding-x` | `16px` |
| `--sn-card-padding-y` | `14px` |
| `--sn-card-gap` | `10px` |
| `--sn-control-height-sm` | `26px` |
| `--sn-control-height` | `32px` |
| `--sn-control-height-lg` | `40px` |
| `--sn-icon-size` | `17px` |
| `--sn-icon-size-sm` | `15px` |
| `--sn-icon-stroke` | `1.75` |
| `--sn-menu-item-height` | `34px` |
| `--sn-dialog-width` | `440px` |
