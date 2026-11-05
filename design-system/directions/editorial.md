# 现代编辑（Modern Editorial）

状态：**备选**（2026-11-05 用户倾向），待评审。在 Playground 顶部选择「现代编辑（备选）」查看。

## 理念

一本随手翻的笔记本：暖纸色、宽松留白、衬线标题，卡片之间有呼吸感。

## 视觉特征

| 项目 | 做法 | 主要令牌 |
| --- | --- | --- |
| 字体 | 界面与正文用系统无衬线字体（Segoe UI Variable Text、微软雅黑 UI，Linux 回落 Noto Sans 等）；标题用衬线字体（Georgia、Noto Serif SC、思源宋体，最后回落宋体）；代码用 Maple Mono NF CN | `--sn-font-ui`、`--sn-font-title`、`--sn-font-code` |
| 字号 | 界面 11–13px，标题 15px（600），正文 14px、行高 1.75 | `--sn-font-size-*`、`--sn-note-size` |
| 颜色 | 暖纸色中性色加鼠尾草绿强调色（沿用现有 SideNotes 的配色基调）。浅色：面板 `#f4f1eb`、卡片 `#fffdf9`、文字 `#22211e`、强调色 `#4b6e4f`；深色：面板 `#1d1c19`、卡片 `#262421`、文字 `#ede9e1`、强调色 `#9dc08b` | `--sn-color-*` |
| 面板 | 离开屏幕边缘 8px 的浮动面板，18px 圆角，一像素边框 | `--sn-panel-inset`、`--sn-panel-radius` |
| 记录 | 带轻微阴影的圆角卡片（14px），卡片之间留 10px | `--sn-card-radius`、`--sn-shadow-sm`、`--sn-card-gap` |
| 控件 | 按钮与页签为胶囊形；页签是分段控件 | `--sn-radius-control` |
| 快捷键 | 写在工具提示中，不直接显示 | — |
| 动效 | 150、240、340ms，强调型减速曲线 | `--sn-duration-*`、`--sn-ease-*` |

## 优点与代价

优点：

- 长时间阅读最舒适：正文 14px、行高 1.75，卡片之间有明显的留白。
- 配色延续现有 SideNotes 的鼠尾草绿，现有用户熟悉。
- 衬线标题让记录列表有「笔记本」的个性。

代价：

- 密度在五套中最低：记录内边距 16 × 14px、间隙 10px，一屏能看到的记录最少。
- 浮动面板离开屏幕边缘 8px，鼠标移到边缘唤出时，面板与边缘之间有一条缝。
- 中文衬线字体在多数 Windows 上要回落到宋体，屏幕显示效果一般；要稳定的效果需要随应用打包字体。

## 参考

- 现有 SideNotes 的纸张配色与鼠尾草绿强调色，见 [sidenote-current-state.md](../references/sidenote-current-state.md)。
- 官方设计规范中的阅读排版与色调表面，见 [reference-matrix.md](../references/reference-matrix.md)。
