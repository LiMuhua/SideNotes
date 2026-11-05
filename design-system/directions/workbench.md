# 开发者工作台（Developer Workbench）

状态：**首选**（2026-11-05 用户倾向），待评审。在 Playground 顶部选择「开发者工作台（首选）」查看。

## 理念

像编辑器的一角：每条记录是一个带标题栏的窗格，等宽字体、键盘优先，快捷键与状态始终可见，记下就走。

## 视觉特征

| 项目 | 做法 | 主要令牌 |
| --- | --- | --- |
| 字体 | 界面与正文都用 Maple Mono NF CN（现有 SideNotes 的默认字体，已随应用打包），依次回落到 Cascadia Mono、JetBrains Mono、Consolas、Noto Sans Mono、DejaVu Sans Mono | `--sn-font-ui`、`--sn-font-note` |
| 字号 | 界面 11、12、13px，标题 13px 加粗（700），正文 13px、行高 1.65 | `--sn-font-size-*`、`--sn-note-size` |
| 颜色 | 石墨色中性色加琥珀强调色。浅色：面板 `#eeeeea`、窗格 `#fdfdfc`、文字 `#1b1b19`、强调色 `#a35f00`；深色：面板 `#111418`、窗格 `#181c21`、文字 `#d8dde3`、强调色 `#e5a54b` | `--sn-color-*` |
| 面板 | 贴边整块，没有外边距与圆角，朝屏幕内侧一条边框 | `--sn-panel-inset`、`--sn-panel-radius` |
| 记录 | 窗格：一像素边框、4px 圆角，浅色标题栏（Emoji、标题、时间），标题栏与正文之间一条分隔线；窗格之间留 6px | `--sn-card-radius`、`--sn-color-card-head`、`--sn-card-gap` |
| 选中 | 边框换成强调色，标题栏换成选中色；操作按钮出现在标题栏右侧、时间之前 | `--sn-color-accent`、`--sn-color-selected` |
| 页签 | 文字加下划线 | — |
| 底栏 | 常驻状态栏：存储状态、当前页签的条数、Ctrl+N 新建、Ctrl+F 搜索；侧栏变窄时快捷键提示逐项隐藏 | `--sn-footer-height` |
| 快捷键 | 直接显示在界面上，例如新建卡片与编辑栏上的 Ctrl+Enter、速记浮窗底栏的 Ctrl+Enter 与 Esc | — |
| 动效 | 70、110、160ms，位移 4px，几乎不被察觉 | `--sn-duration-*`、`--sn-motion-distance` |

## 优点与代价

优点：

- 信息密度在五套中最高：面板内边距 10px，记录内边距 10 × 8px，窗格间隙 6px。
- 标题栏让每条记录的起点一眼可见，长短不一的记录也容易分辨。
- 快捷键写在界面上，不必记忆；与现有默认字体一致，用户切换成本最低。

代价：

- 等宽字体的汉字宽 1.2 em，同样宽度放下的汉字比常规中文字体少约两成（技术决策第 18 条）。
- 外观偏工具化；每条记录都有标题栏，单行记录较多时界面略显重复。
- 状态栏常驻，占用底部 26px。

## 参考

- 现有 SideNotes 的默认字体与「选中即可 Ctrl+C」的键盘习惯。
- Raycast 与 Linear 的键盘模型，见 [reference-products.md](../references/reference-products.md)。
- Glance 记录纸的单色墨水，见 [glance-analysis.md](../references/glance-analysis.md)。

## 2026-11-05 的调整

用户反馈第一版太扁平、记录之间区分不明显、看起来很累、间距浪费空间。调整如下：

- 记录从细线分隔的条目改为带标题栏的窗格，窗格之间留 6px。
- 面板底色由 `#fafaf8` 加深为 `#eeeeea`，衬出浅色窗格；深色同理。
- 面板内边距 12 改为 10，记录内边距 12 × 9 改为 10 × 8，记录圆角 0 改为 4。
- 去掉卡片底部常驻的一行（五套共用，见 [comparison.md](./comparison.md)）。
