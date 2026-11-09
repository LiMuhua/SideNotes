# 设计令牌

设计令牌是 SideNotes 界面中所有可以用数值表达的决定：颜色、字体、尺寸、圆角、材质与动效。组件样式只引用令牌，不写死数值；五套主题之间的差异，除了少数结构差异（见 [components.md](./components.md)），全部来自令牌。

## 一、命名与分组

- 令牌都是 CSS 自定义属性，以 `--sn-` 开头：颜色为 `--sn-color-<角色>`，代码为 `--sn-code-<角色>`，阴影为 `--sn-shadow-<用途>`，其余按类别命名，例如 `--sn-space-4`、`--sn-radius-control`、`--sn-duration-fast`。
- 名字表达用途，不表达取值：写 `--sn-color-text-muted`，不写 `--sn-gray-500`。
- 令牌分三类：
  - 随明暗变化：颜色、代码与阴影，每套主题在浅色与深色下各有一个值；
  - 不随明暗变化：字体、字号、圆角、材质、动效与布局尺寸，每套主题一个值；
  - 共享：间距、字重、描边宽度、不透明度与层级，所有主题共用，写在 `base.css`。
- 组件内部的变量以 `--local-` 开头（例如卡片的 `--local-shadow`），Markdown 编辑器运行时设置的变量以 `--md-` 开头。它们都不是令牌，只在所属组件内使用。

## 二、文件与作用域

| 文件 | 内容 |
| --- | --- |
| [tokens/schema.ts](./tokens/schema.ts) | 令牌清单：名称、分组、含义、是否随明暗变化、是否共享 |
| [tokens/base.css](./tokens/base.css) | 共享令牌 |
| `tokens/<主题>.css` | 每套主题一个文件：不随明暗变化的令牌，加上浅色与深色两组颜色 |
| [tokens/parse.ts](./tokens/parse.ts) | 解析令牌文件、叠加半透明颜色、计算对比度；测试与 Playground 的令牌页共用 |

令牌按两个属性取值：

```css
[data-sn-surface='terminal'] { /* 主题，浅色 */ }
[data-sn-surface='terminal'][data-sn-theme='dark'] { /* 深色 */ }
```

`data-sn-surface` 是主题（`terminal`、`magazine`、`paper`、`win11`、`glass`），`data-sn-theme` 是明暗模式（`light`、`dark`）。正式实现时两个属性写在每个窗口的根元素上，取值来自设置项 `surface` 与 `theme`；「跟随系统」先换算成 `light` 或 `dark`。

## 三、取值规则

- 尺寸以 13px 字号为基准，单位是像素。字号设置是整页缩放：每个窗口的内容放大「字号 ÷ 13」倍，令牌不需要换算。
- 间距按 4px 网格：`--sn-space-1` 到 `--sn-space-10` 依次为 2、4、6、8、12、16、20、24、32、40px。
- 颜色可以半透明。半透明表面背后是什么无法预知，对比度按最差情况计算：表面分别叠在纯黑与纯白上，取较差的一个。
- 一个令牌可以引用另一个令牌，例如 `--sn-shadow-card-active` 中的 `var(--sn-color-accent)`。
- 某套主题用不到的特效令牌取透明，而不是不定义：例如只有磨砂玻璃用到边缘受光，其余主题的 `--sn-color-rim-top` 为透明。每套主题定义的令牌完全相同，组件样式不需要按主题判断。

## 四、令牌清单

<!-- generated:token-list -->
| 分组 | 令牌 | 含义 | 随明暗变化 | 取值写在 |
| --- | --- | --- | --- | --- |
| 表面 | `--sn-color-panel` | 侧栏与速记浮窗的面板底色，可以半透明（Windows 11、磨砂玻璃） | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-panel-band` | 面板中的页脚带，叠在面板之上 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-card` | 记录卡片与新建卡片的底色，叠在面板之上，可以半透明 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-card-head` | 记录卡片标题栏的底色，叠在卡片之上；只有窗格式的记录（终端）使用，其余主题透明 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-card-active` | 悬停或选中的卡片：叠在卡片底色上的叠加色 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-card-head-active` | 悬停或选中时标题栏的底色，取代标题栏底色；只有窗格式的记录（终端）使用，其余主题透明 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-editing` | 编辑中的卡片与获得焦点的新建卡片的底色，取代卡片底色 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-sheen` | 玻璃块顶部的光泽，从上往下渐隐（磨砂玻璃）；不用时为透明 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-bg` | 设置窗口的窗口底色与分类栏 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-surface` | 设置窗口的内容区、弹窗正文 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-surface-raised` | 浮起的表面：菜单、弹窗、工具提示与问号说明 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-surface-sunken` | 凹陷的表面：输入框、分段控件底 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-hover` | 悬停叠加色，叠在任意表面上 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-pressed` | 按下叠加色 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-selected` | 当前页签、设置导航项与菜单当前项的叠加色 | 是 | 各主题的令牌文件 |
| 表面 | `--sn-color-overlay` | 弹窗遮罩 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-border` | 常规分隔线与浮层描边 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-border-subtle` | 弱分隔线：条目之间、分组内 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-border-strong` | 控件边界：输入框、复选框（对比度不低于 3:1） | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-edge-highlight` | 面板与浮窗顶部一像素的受光边（Windows 11 的亚克力）；不用时为透明 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-rim-top` | 玻璃边缘受光：上缘的亮边，与下缘之间渐变（磨砂玻璃）；不用时为透明 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-rim-bottom` | 玻璃边缘受光：下缘的弱光（磨砂玻璃）；不用时为透明 | 是 | 各主题的令牌文件 |
| 边框 | `--sn-color-rule` | 编辑时每行下方的横线（记录纸）；不用时为透明 | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-text` | 主要文字：标题、正文 | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-text-secondary` | 次要文字：说明、正文预览中的弱化内容 | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-text-muted` | 弱化文字：时间、计数、占位（对比度不低于 4.5:1） | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-text-disabled` | 禁用文字（不要求对比度） | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-halo` | 文字光晕：玻璃上为文字加一圈浅色或深色晕；不用时为透明 | 是 | 各主题的令牌文件 |
| 文字 | `--sn-color-syntax` | 编辑时 Markdown 标记（#、**、- 等）的颜色（对比度不低于 4.5:1） | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-accent` | 强调色填充：主要按钮、选中指示条、开关 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-accent-hover` | 强调色填充的悬停态 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-accent-text` | 强调色文字与图标（对比度不低于 4.5:1） | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-accent-subtle` | 强调色浅底：选中的标签、筛选条、问号说明 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-on-accent` | 强调色填充上的文字 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-focus` | 键盘焦点环 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-caret` | 输入光标（对比度不低于 3:1） | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-highlight` | 搜索命中的底色 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-selection` | 文本选区 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-inverse` | 反色表面：提示条 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-on-inverse` | 反色表面上的文字 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-mark-workspace` | 页签标记：工作区 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-mark-pinned` | 页签标记：置顶 | 是 | 各主题的令牌文件 |
| 强调、反色与标记 | `--sn-color-mark-archive` | 页签标记：归档 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-success` | 成功：文字与图标 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-success-subtle` | 成功的浅底 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-warning` | 警告：文字与图标 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-warning-subtle` | 警告的浅底 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-danger` | 危险：删除、错误 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-danger-subtle` | 危险的浅底 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-info` | 提示信息 | 是 | 各主题的令牌文件 |
| 状态 | `--sn-color-info-subtle` | 提示信息的浅底 | 是 | 各主题的令牌文件 |
| 代码 | `--sn-code-bg` | 代码块与行内代码的底色 | 是 | 各主题的令牌文件 |
| 代码 | `--sn-code-text` | 代码文字 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-sm` | 小阴影：卡片、按下的分段 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-md` | 中阴影：菜单、下拉框、工具提示 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-lg` | 大阴影：弹窗、速记浮窗、设置窗口、问号说明 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-panel` | 侧栏面板与玻璃块的阴影：贴边时为朝向内容的一侧 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-card-active` | 悬停或选中的卡片：强调色外圈与浮起 | 是 | 各主题的令牌文件 |
| 阴影 | `--sn-shadow-editing` | 编辑中的卡片与获得焦点的新建卡片：浮起的投影（边框不变，不用强调色） | 是 | 各主题的令牌文件 |
| 材质 | `--sn-panel-blur` | 面板的背景模糊半径；0 表示实心表面 | 否 | 各主题的令牌文件 |
| 材质 | `--sn-panel-saturate` | 背景模糊时的饱和度倍数 | 否 | 各主题的令牌文件 |
| 材质 | `--sn-panel-inset` | 侧栏离屏幕边缘的距离；0 表示贴边 | 否 | 各主题的令牌文件 |
| 材质 | `--sn-panel-radius` | 面板圆角 | 否 | 各主题的令牌文件 |
| 材质 | `--sn-panel-radius-edge` | 面板贴边一侧的圆角 | 否 | 各主题的令牌文件 |
| 材质 | `--sn-block-gap` | 分块面板之间的间隙（磨砂玻璃）；整块面板为 0 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-ui` | 界面字体 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-title` | 标题字体 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-note` | 记录正文字体 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-meta` | 元信息字体：时间、计数、快捷键 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-code` | 代码字体 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-size-xs` | 最小字号：徽标、快捷键 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-size-sm` | 小字号：时间、说明 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-size-md` | 界面基准字号 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-size-lg` | 卡片标题、面板标题 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-size-xl` | 窗口标题、设置分类标题 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-line-height-tight` | 紧凑行高：标题、单行控件 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-line-height-normal` | 常规行高：界面文字 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-line-height-relaxed` | 宽松行高：说明段落 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-note-size` | 记录正文字号 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-note-line-height` | 记录正文行高 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-code-size` | 代码字号 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-body-weight` | 界面正文字重：在玻璃等半透明表面上略加粗 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-title-weight` | 标题字重 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-title-tracking` | 标题字距 | 否 | 各主题的令牌文件 |
| 字体与排版 | `--sn-font-weight-regular` | 常规字重 | 否 | base.css |
| 字体与排版 | `--sn-font-weight-medium` | 中等字重 | 否 | base.css |
| 字体与排版 | `--sn-font-weight-semibold` | 半粗字重 | 否 | base.css |
| 字体与排版 | `--sn-font-weight-bold` | 粗体字重 | 否 | base.css |
| 间距 | `--sn-space-0` | 0 | 否 | base.css |
| 间距 | `--sn-space-1` | 2px：图标与文字的最小间隙 | 否 | base.css |
| 间距 | `--sn-space-2` | 4px：紧凑元素之间 | 否 | base.css |
| 间距 | `--sn-space-3` | 6px：控件内的小间距 | 否 | base.css |
| 间距 | `--sn-space-4` | 8px：基础单位 | 否 | base.css |
| 间距 | `--sn-space-5` | 12px：控件内边距、行内间距 | 否 | base.css |
| 间距 | `--sn-space-6` | 16px：分组之间、面板内边距 | 否 | base.css |
| 间距 | `--sn-space-7` | 20px | 否 | base.css |
| 间距 | `--sn-space-8` | 24px：区块之间 | 否 | base.css |
| 间距 | `--sn-space-9` | 32px | 否 | base.css |
| 间距 | `--sn-space-10` | 40px：窗口级留白 | 否 | base.css |
| 圆角 | `--sn-radius-xs` | 最小圆角：快捷键、行内代码 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-sm` | 小圆角：标签、小按钮 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-md` | 中圆角：菜单、代码块 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-lg` | 大圆角：弹窗、浮窗 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-control` | 按钮与输入框圆角 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-chip` | 标签与徽标圆角 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-card-radius` | 记录卡片圆角 | 否 | 各主题的令牌文件 |
| 圆角 | `--sn-radius-full` | 完全圆形：圆点、开关 | 否 | base.css |
| 描边 | `--sn-border-width` | 描边宽度 | 否 | base.css |
| 描边 | `--sn-focus-ring-width` | 焦点环宽度 | 否 | base.css |
| 描边 | `--sn-focus-ring-offset` | 焦点环与元素的间距 | 否 | base.css |
| 动效 | `--sn-duration-fast` | 快：悬停、按下、开关 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-duration-normal` | 常规：菜单、工具提示、卡片展开 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-duration-slow` | 慢：弹窗、速记浮窗 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-ease-standard` | 标准缓动：状态变化 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-ease-enter` | 进入缓动：元素出现、侧栏滑入 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-ease-exit` | 退出缓动：元素消失、侧栏滑出 | 否 | 各主题的令牌文件 |
| 动效 | `--sn-motion-distance` | 进入时的位移距离 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-header-height` | 侧栏顶部与浮窗标题栏的高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-tab-height` | 页签高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-footer-height` | 侧栏底栏与浮窗底栏的高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-panel-padding` | 面板内容的左右内边距 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-card-padding-x` | 卡片左右内边距 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-card-padding-y` | 卡片上下内边距 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-card-gap` | 卡片之间的间隙 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-control-height-sm` | 小控件高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-control-height` | 控件高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-control-height-lg` | 大控件高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-icon-size` | 图标尺寸 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-icon-size-sm` | 小图标尺寸 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-icon-stroke` | 图标描边宽度（24 网格） | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-menu-item-height` | 菜单项高度 | 否 | 各主题的令牌文件 |
| 布局与尺寸 | `--sn-dialog-width` | 常规弹窗宽度 | 否 | 各主题的令牌文件 |
| 不透明度 | `--sn-opacity-disabled` | 禁用元素的不透明度 | 否 | base.css |
| 层级 | `--sn-z-sticky` | 吸顶元素 | 否 | base.css |
| 层级 | `--sn-z-dropdown` | 下拉菜单 | 否 | base.css |
| 层级 | `--sn-z-overlay` | 遮罩 | 否 | base.css |
| 层级 | `--sn-z-dialog` | 弹窗 | 否 | base.css |
| 层级 | `--sn-z-popover` | 弹窗之上的浮层 | 否 | base.css |
| 层级 | `--sn-z-toast` | 提示条 | 否 | base.css |
| 层级 | `--sn-z-tooltip` | 工具提示 | 否 | base.css |
<!-- /generated:token-list -->

各主题的取值见主题文档的附录：[终端](./themes/terminal.md)、[杂志](./themes/magazine.md)、[记录纸](./themes/paper.md)、[Windows 11](./themes/win11.md)、[磨砂玻璃](./themes/glass.md)。

## 五、共享令牌的取值

<!-- generated:shared-values -->
| 令牌 | 取值 |
| --- | --- |
| `--sn-font-weight-regular` | `400` |
| `--sn-font-weight-medium` | `500` |
| `--sn-font-weight-semibold` | `600` |
| `--sn-font-weight-bold` | `700` |
| `--sn-space-0` | `0px` |
| `--sn-space-1` | `2px` |
| `--sn-space-2` | `4px` |
| `--sn-space-3` | `6px` |
| `--sn-space-4` | `8px` |
| `--sn-space-5` | `12px` |
| `--sn-space-6` | `16px` |
| `--sn-space-7` | `20px` |
| `--sn-space-8` | `24px` |
| `--sn-space-9` | `32px` |
| `--sn-space-10` | `40px` |
| `--sn-radius-full` | `999px` |
| `--sn-border-width` | `1px` |
| `--sn-focus-ring-width` | `2px` |
| `--sn-focus-ring-offset` | `2px` |
| `--sn-opacity-disabled` | `0.45` |
| `--sn-z-sticky` | `10` |
| `--sn-z-dropdown` | `100` |
| `--sn-z-overlay` | `200` |
| `--sn-z-dialog` | `300` |
| `--sn-z-popover` | `400` |
| `--sn-z-toast` | `500` |
| `--sn-z-tooltip` | `600` |
<!-- /generated:shared-values -->

## 六、对比度要求

正文与图标文字不低于 4.5:1；控件边界、焦点环、输入光标与页签色点不低于 3:1（WCAG 2.2 的 1.4.3 与 1.4.11）。下表是 Playground 令牌页列出的关键组合；测试另外检查各层表面上的文字、浅底上的状态色、代码块与页签色点。

<!-- generated:contrast-pairs -->
| 组合 | 前景 | 叠放的表面（由下到上） | 最低对比度 |
| --- | --- | --- | --- |
| 主要文字 / 卡片 | `--sn-color-text` | `--sn-color-panel` + `--sn-color-card` | 4.5:1 |
| 次要文字 / 卡片 | `--sn-color-text-secondary` | `--sn-color-panel` + `--sn-color-card` | 4.5:1 |
| 弱化文字 / 卡片 | `--sn-color-text-muted` | `--sn-color-panel` + `--sn-color-card` | 4.5:1 |
| 弱化文字 / 页脚 | `--sn-color-text-muted` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-panel-band` | 4.5:1 |
| 主要文字 / 卡片标题栏 | `--sn-color-text` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-head` | 4.5:1 |
| 弱化文字 / 卡片标题栏 | `--sn-color-text-muted` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-head` | 4.5:1 |
| 主要文字 / 选中卡片 | `--sn-color-text` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-active` | 4.5:1 |
| 次要文字 / 选中卡片 | `--sn-color-text-secondary` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-active` | 4.5:1 |
| 主要文字 / 选中的标题栏 | `--sn-color-text` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-active` + `--sn-color-card-head-active` | 4.5:1 |
| 次要文字 / 选中的标题栏 | `--sn-color-text-secondary` | `--sn-color-panel` + `--sn-color-card` + `--sn-color-card-active` + `--sn-color-card-head-active` | 4.5:1 |
| 主要文字 / 编辑区 | `--sn-color-text` | `--sn-color-panel` + `--sn-color-editing` | 4.5:1 |
| Markdown 标记 / 编辑区 | `--sn-color-syntax` | `--sn-color-panel` + `--sn-color-editing` | 4.5:1 |
| 输入光标 / 编辑区 | `--sn-color-caret` | `--sn-color-panel` + `--sn-color-editing` | 3:1 |
| 强调色文字 / 卡片 | `--sn-color-accent-text` | `--sn-color-panel` + `--sn-color-card` | 4.5:1 |
| 强调色上的文字 | `--sn-color-on-accent` | `--sn-color-accent` | 4.5:1 |
| 危险色 / 菜单 | `--sn-color-danger` | `--sn-color-surface-raised` | 4.5:1 |
| 控件边界 / 卡片 | `--sn-color-border-strong` | `--sn-color-panel` + `--sn-color-card` | 3:1 |
| 焦点环 / 卡片 | `--sn-color-focus` | `--sn-color-panel` + `--sn-color-card` | 3:1 |
| 代码文字 / 代码块 | `--sn-code-text` | `--sn-color-panel` + `--sn-color-card` + `--sn-code-bg` | 4.5:1 |
| 主要文字 / 设置内容区 | `--sn-color-text` | `--sn-color-surface` | 4.5:1 |
| 弱化文字 / 设置分类栏 | `--sn-color-text-muted` | `--sn-color-bg` | 4.5:1 |
<!-- /generated:contrast-pairs -->

## 七、检查与维护

`pnpm test` 包含三项设计系统检查：

- `docs/design-system/tests/tokens.test.ts`：每套主题、每种明暗都定义了全部令牌，引用都能展开，对比度达标。
- `docs/design-system/tests/styles.test.ts`：产品样式不写死颜色、像素、rem 与时长，只引用令牌清单中的令牌；确需固定的数值在行尾注明「固定：原因」。
- `docs/design-system/tests/docs.test.ts`：本文与主题文档附录中的表与代码一致，主题文档的章节统一，文档中的相对链接有效。

新增或修改令牌的步骤：

1. 在 `tokens/schema.ts` 中登记名称、分组与含义。
2. 在五个主题文件中写入取值，随明暗变化的令牌写浅色与深色两处；用不到时取透明。
3. 在组件样式中引用。
4. 在 Git Bash 或 Linux 终端中运行下面的命令，重新生成本文与主题文档中的表，检查差异后再运行 `pnpm test`。

```bash
SN_UPDATE_DOCS=1 pnpm exec vitest run docs/design-system/tests/docs.test.ts
```
