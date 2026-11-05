# Windows 11（Fluent）

状态：待评审。在 Playground 顶部选择「Windows 11」查看；把壁纸换成「繁杂」可以检验半透明表面的可读性。

## 理念

一张亚克力面板，和开始菜单、快速设置一样：离开屏幕边缘 12 像素，8 像素圆角，一像素描边。取自 Glance 的 Windows 11 外观，也对应现有 SideNotes 的 Win11 材质。

## 视觉特征

| 项目 | 做法 | 主要令牌 |
| --- | --- | --- |
| 字体 | Segoe UI Variable Text（标题用 Display 字形），回落到微软雅黑 UI 与 Linux 的 Noto Sans 等 | `--sn-font-ui`、`--sn-font-title` |
| 字号 | 界面 11–13px，标题 14px（600），正文 14px、行高 1.55 | `--sn-font-size-*`、`--sn-note-size` |
| 颜色 | 黑色或白色加透明度表示层级，强调色取系统强调色，取不到时用 Glance 记录的默认值。浅色：面板 `rgb(252 252 252 / 0.85)`、卡片 `rgb(255 255 255 / 0.7)`、文字 `rgb(0 0 0 / 0.9)`、强调色 `#005fb8`；深色：面板 `rgb(44 44 44 / 0.96)`、卡片 `rgb(255 255 255 / 0.05)`、文字 `#ffffff`、强调色 `#60cdff` | `--sn-color-*` |
| 材质 | 面板模糊 30px、饱和度 1.25 | `--sn-panel-blur`、`--sn-panel-saturate` |
| 面板 | 离开屏幕边缘 12px 的浮动面板，8px 圆角，一像素描边；底栏稍暗 | `--sn-panel-inset`、`--sn-panel-radius` |
| 记录 | 半透明卡片，4px 圆角，卡片之间留 4px | `--sn-card-radius`、`--sn-card-gap` |
| 页签 | 文字加下划线 | — |
| 快捷键 | 写在工具提示中 | — |
| 动效 | 100、167、250ms | `--sn-duration-*` |

## 优点与代价

优点：

- 与 Windows 11 的开始菜单、快速设置一致，Windows 用户熟悉。
- 黑白加透明度的配色在明暗之间切换简单。

代价：

- 透出桌面依赖系统的窗口材质，有平台与焦点限制，见下一节。
- 半透明表面的颜色随背景变化，为了在最差背景上达到 4.5:1，文字的透明度比 Fluent 的第三级文字更高。
- 微软建议不要在亚克力上放强调色文字；本方向的置顶标记、标签悬停等处用了强调色文字，选用时需要改掉。

## 实现条件

详见 [comparison.md](./comparison.md) 的「半透明方向的实现条件」。要点：

- 窗口要改为透明并启用 Tauri 的 `windowEffects`；Acrylic 在部分 Windows 版本上拖动、调整窗口大小时性能差，侧栏滑入滑出与调宽都需要实测。
- 背景亚克力在窗口失去焦点时退回纯色，而侧栏由悬停唤出、不一定获得焦点。
- Linux 与 Android 没有窗口材质，需要另备一组不透明的颜色（尚未实现）。

## 参考

- Glance Windows 11 外观（`theme.rs`、`skins.rs`），见 [glance-analysis.md](../references/glance-analysis.md)。
- 微软的 [Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) 与 [Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica) 文档，以及 [reference-matrix.md](../references/reference-matrix.md)。
