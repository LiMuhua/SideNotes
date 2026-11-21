# 官方设计规范对照

本文对照 Fluent 2 与 Windows 应用设计、Material Design 3（下称 Material 3）、Apple 人机界面指南（HIG）、Radix、shadcn/ui 与 Tailwind CSS、WCAG 2.2 与 WAI-ARIA 创作实践（APG）中与 SideNotes 有关的规定，并写明 SideNotes 的取舍。参考产品见 [reference-products.md](./reference-products.md)，主要视觉参考 Glance 见 [glance-analysis.md](./glance-analysis.md)。

资料于 2026-11-07 读取，每个页面取用的事实与可信度见[证据索引](./source-evidence.md)。约定：

- 表中的数值与说法都取自页面原文，没有读到的不填。
- 「未核实」：页面无法读取，或读到的页面没有给出这一项。
- 「推断」：本项目根据原文做出的判断或建议。
- 令牌名称与取值取自 `docs/design-system/tokens/`。像素值按 13px 设计字号计，字号设置会整页缩放。
- 缓动只写 `cubic-bezier()` 的四个参数。

## 结论

- **目标尺寸按 CSS 像素计，不随字号缩放。** WCAG 2.2 的 2.5.8 要求 24×24 CSS 像素，说明文档写明缩放不能作为达标理由。终端的 `--sn-control-height-sm` 为 22px，只能靠 2px 间隙形成的 24px 中心距套用间距例外，处在临界；建议改为 24px（推断）。2026-11-07 已改为 24px，中心距 26px。Android 版应以 48dp 为准。
- **对比度门槛与各家一致。** 正文 4.5:1，控件边界、焦点与光标 3:1，与 WCAG AA、Fluent、HIG 相同。半透明表面按叠在纯黑与纯白上的较差值计算，不依赖 Windows 所说的系统亚克力已保证文字对比度，适合背后桌面未知的窗口（推断）。
- **半透明只用于临时表面，并且总能退回实心。** Windows 把亚克力留给菜单、弹出层等临时表面，Mica 用于长期窗口；关闭透明效果、节电或硬件不足时都改为实心色。侧栏与速记浮窗对应亚克力，设置窗口如果使用材质应对应 Mica（推断）。
- **Windows 11 主题的圆角与系统一致，菜单除外。** 控件、卡片、工具提示 4px，弹窗与面板 8px，与 Windows 相同；菜单取 `--sn-radius-md`（4px），而 Windows 的菜单属于弹出层，用 8px。
- **动效时长都在平台范围内。** Fluent Web 为 50 至 500ms，Material 3 为 50 至 1000ms；终端最短（70 至 160ms），Windows 11 主题的 167ms 与 250ms 与 WinUI 相同，缓动取 Fluent 的 EasyEase、DecelerateMax 与 Windows 的柔和退出。
- **界面基准字号 13px 与 macOS 正文相同，比 Windows 正文小 1px。** `--sn-font-size-xs`（11px）低于 Windows 建议的最小 12px，只宜用于徽标与快捷键（推断）。
- **键盘行为以 APG 为准。** 菜单、菜单按钮、弹窗、页签与列表的按键按 APG；Radix Primitives 的按键表与 APG 一致，可以作为验收清单（推断）。

## 一、颜色与明暗

| 来源 | 颜色结构 | 明暗与层次 | 对比度 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | 中性、共享、品牌三组色板，全局令牌之上是别名令牌；强调色少量使用，标示重要元素与交互状态 | 浅色、深色两种模式；两种模式下都是越暗的表面越次要，重要表面更亮 | 正文 4.5:1；大字（粗体 18.5px 以上或常规 24px 以上）3:1；交互组件与图标 3:1 |
| Material 3 | 5 个关键色，各对应 13 个色调；角色成对，如 primary 与 on-primary、primary-container 与 on-primary-container；surface-container 分五档 | 层次主要靠色调叠加，深色主题的叠加色取自 primary | 色调板按对比度标准设计，页面没有给出比值 |
| Apple HIG | 使用语义化的动态系统颜色，不改变用途，例如不把分隔线色用作文字 | 深色模式有 base 与 elevated 两组背景，弹出框等前景界面用更亮的 elevated；要在「增强对比度」与「降低透明度」下测试 | 17pt 及以下 4.5:1，18pt 及以上或粗体 3:1；自定义颜色争取 7:1，小字尤其如此 |
| Radix | 每个色阶 12 级：1、2 级背景，3 至 5 级组件底色，6 至 8 级边框，9、10 级实色底，11、12 级文字 | 每个色阶有浅色与深色两套，各带 Alpha 版本 | 11、12 级在同色阶第 2 级上保证 APCA Lc 60 与 Lc 90 |
| shadcn/ui 与 Tailwind | 表面与前景成对：background、card、popover、primary、secondary、muted、accent 各带 `-foreground`，另有 destructive、border、input、ring 与一组 sidebar 令牌 | 在 `:root` 与 `.dark` 中各写一份 | 未核实 |
| WCAG 2.2 与 APG | 1.4.1：颜色不能是传达信息的唯一方式 | 未核实 | 1.4.3：文字 4.5:1，大字（18pt 或 14pt 粗体）3:1；1.4.11：识别组件、状态与图形所需的部分 3:1；未激活的组件不要求 |

SideNotes 的取舍：

- 令牌按表面与前景成对命名，与 shadcn/ui 相同，如 `--sn-color-accent` 与 `--sn-color-on-accent`、`--sn-color-inverse` 与 `--sn-color-on-inverse`；`--sn-color-panel` 一组相当于 shadcn/ui 的 sidebar 令牌（推断）。
- 对比度门槛取 WCAG AA：各级文字（包括 `--sn-color-text-muted`）4.5:1，`--sn-color-border-strong`、`--sn-color-focus`、`--sn-color-caret` 3:1。半透明表面取叠在纯黑与纯白上的较差值（`tokens/parse.ts`）；读到的条款没有规定半透明表面怎样计算，这是本项目的保守做法（推断）。
- 不追求 HIG 建议的 7:1，令牌测试只检查 4.5:1 与 3:1。
- 深色表面越高越亮，与 Windows、HIG、Material 3 的方向一致：终端深色的面板、卡片、浮层依次为 `#101317`、`#181c21`、`#1c2026`。
- 终端深色的强调色 `#e5a54b` 上用深色文字（`--sn-color-on-accent` 为 `#1a1206`）；Radix 也说明 Amber 等色阶的 9、10 级是为深色文字设计的。

## 二、半透明材质

| 来源 | 材质与用途 | 可读性 | 关闭与回退 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | 实心、Mica、亚克力、Smoke 四种；亚克力用于菜单、弹出层等点外部即关闭的临时表面，Mica 不透明，用于应用与设置这类长期窗口；分区用的竖向面板宜用不透明背景，叠在内容上打开的竖向面板可以用应用内亚克力 | 系统的亚克力资源已调到文字达标；不要在亚克力上放强调色文字；不要边对边放几块亚克力，会出现接缝 | 关闭透明效果、节电模式、低端硬件时变为实心色；高对比度模式显示用户选的背景色；背景亚克力在窗口失去焦点时也变实心 |
| Material 3 | 未核实（读到的页面只有色调层次，见第五节） | 未核实 | 未核实 |
| Apple HIG | Liquid Glass 用于浮在内容上的控件与导航层（如侧栏），不用于内容层；内容层用标准材质 | 越厚越不透明、文字越清楚，越薄越能看清背景；文字多的组件（侧栏、弹出框）用 regular 变体；侧栏等大元素的玻璃更不透明；clear 变体叠在亮内容上时可加 35% 的暗色遮罩 | 「降低透明度」「增强对比度」会改变材质外观，深色模式下要分别并同时测试两项 |
| Radix | 未核实 | 未核实 | 未核实 |
| shadcn/ui 与 Tailwind | 未核实 | 未核实 | 未核实 |
| WCAG 2.2 与 APG | 读到的条款没有专门规定 | 1.4.3 与 1.4.11 同样适用于半透明表面上的内容（推断） | 未核实 |

SideNotes 的取舍：

- 只有 Windows 11 与磨砂玻璃两套主题是半透明的：`--sn-panel-blur` 分别为 30px 与 24px，面板或卡片底色带透明度；终端、杂志、记录纸为实心（`--sn-panel-blur: 0px`）。
- 侧栏与速记浮窗是临时出现、叠在其他应用之上的窗口，对应 Windows 的背景亚克力；设置窗口是长期窗口，目前用实心的 `--sn-color-bg`，以后如果使用材质应选 Mica（推断）。
- 回退规则与 Windows 一致：关闭透明效果、节电模式下改为实心表面；Linux 与 Android 没有对应材质时同样用实心表面（推断）。
- Windows 不建议在亚克力上放强调色文字。Windows 11 主题的 `--sn-color-accent-text` 放在半透明卡片上，由「强调色文字 / 卡片」组合的最差情况 4.5:1 检查保证（`tokens/parse.ts`）。
- 与 HIG 所说的大块、文字多的玻璃更不透明一致：磨砂玻璃的卡片底色不透明度为 78%（浅色）与 80%（深色），编辑区为 93% 与 94%；玻璃块之间留 8px（`--sn-block-gap`），没有边对边相接（推断：避开了 Windows 所说的接缝）。

## 三、字体与字号

| 来源 | 字体 | 字号阶梯 | 最小字号与字重 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | Windows 用 Segoe UI Variable，Web 默认 Segoe UI，其他平台用系统字体；HTML 中要在 CSS 里指定 Segoe UI Variable，光学尺寸才自动匹配字号；简体中文界面字体为 Microsoft YaHei UI | Windows：Caption 12/16，Body 14/20，Body Large 18/24，Subtitle 20/28，Title 28/36（epx，即有效像素）；Web：Caption 1 12/16，Body 1 14/20，Subtitle 2 16/22 | 常规字重最小 12px，半粗最小 14px；标题用半粗；强调用半粗而不是粗体；不用斜体 |
| Material 3 | 未核实 | body 16/24、14/20、12/16；label 14/20、12/16、11/16（中等字重）；title 22/28、16/24、14/20（按 16px 根字号换算） | 阶梯中最小为 label small 11px |
| Apple HIG | macOS 用 SF Pro；系统字体随字号自动调整光学尺寸与字距 | macOS：Body 13/16，Callout 12/15，Subheadline 11/14，Footnote 与 Caption 10/13，Headline 13/16（粗体），Title 3 15/20（单位 pt） | macOS 默认 13pt、最小 10pt；iOS 默认 17pt、最小 11pt；避免 Ultralight、Thin、Light |
| Radix | 未核实 | 未核实 | 未核实 |
| shadcn/ui 与 Tailwind | 未核实 | Tailwind：xs 12/16、sm 14/20、base 16/24、lg 18、xl 20（按 16px 根字号换算） | 未核实 |
| WCAG 2.2 与 APG | 未核实 | 1.4.4：文字放大到 200% 不丢失内容；1.4.10：宽度相当于 320 CSS 像素时不出现二维滚动 | 读到的条款没有规定最小字号；1.4.12：用户把行高设为 1.5 倍、段后 2 倍、字距 0.12 倍、词距 0.16 倍时不丢失内容 |

SideNotes 的取舍：

- `--sn-font-size-md` 五套主题都是 13px，与 macOS 正文相同，比 Windows 与 Fluent Web 的正文（14px）小 1px。字号设置把窗口内容按「字号 ÷ 13」缩放（design-tokens.md），默认 16px 时界面基准字号显示为 16px。
- `--sn-font-size-xs` 为 11px，低于 Windows 的最小常规字号 12px，高于 macOS 的最小 10pt；只用于徽标与快捷键，不用于需要阅读的文字（推断）。
- 标题字重：Windows 11 主题的 `--sn-title-weight` 为 600，与 Windows 的半粗一致；终端为 700，因为 Maple Mono 只有 400 与 700 两个字重（`base.css` 的注释）。
- Windows 11 主题的字体写的是 'Segoe UI Variable Text' 与 'Segoe UI Variable Display' 两个命名字体。官方只说明指定 Segoe UI Variable 时光学尺寸自动调整，命名字体在 WebView2 中的表现未核实，需要实测。
- 中文：杂志、记录纸、Windows 11、磨砂玻璃的 `--sn-font-ui` 都含 Windows 推荐的 Microsoft YaHei UI；终端用自带中文字形的 Maple Mono NF CN。
- 记录正文行高 `--sn-note-line-height` 为 1.55 至 1.75，都不低于 1.5；1.4.12 只要求用户加大间距时内容不丢失，所以放文字的容器不宜用固定高度（推断）。
- 速记浮窗默认 560px 宽，最大字号 20px 时内容宽约 364 CSS 像素，仍高于 1.4.10 的 320（推断，按「字号 ÷ 13」计算）。

## 四、间距、密度与目标尺寸

| 来源 | 间距 | 控件尺寸 | 最小目标 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | 4px 基准，另有 2、6、10 用于对齐图标，从 2 到 56 共 16 档；Windows：按钮之间 8，控件与标题 8，控件与标签 12，内容区之间 12，表面边缘到文字 16（epx） | Fluent React 的图标按钮宽 24/32/40px（small、medium、large，源码）；Windows 的控件尺寸与密度页面已失效，未核实 | Windows 触控目标约 7.5mm（40×40 epx）；Fluent 的移动端最小触控目标：iOS 与 Web 44×44，Android 48×48 |
| Material 3 | 未核实 | 图标按钮的状态层 40×40，图标 24 | 触控目标至少 48×48dp；鼠标、触控板等精确输入可以更小 |
| Apple HIG | 带边框的元素四周留约 12pt，无边框的约 24pt | macOS 默认 28×28pt，iOS 默认 44×44pt | macOS 最小 20×20pt，iOS 最小 28×28pt |
| Radix | 未核实 | 未核实 | 未核实 |
| shadcn/ui 与 Tailwind | Tailwind 的间距按 `--spacing`（默认 0.25rem）乘以数字计算 | 未核实 | 未核实 |
| WCAG 2.2 与 APG | 未核实 | 未核实 | 2.5.8（AA）：24×24 CSS 像素，与页面缩放无关；更小的目标，以 24px 直径的圆互不相交为例外；圆角可能使目标放不下 24×24 的正方形；2.5.5（AAA）：44×44 |

SideNotes 的取舍：

- `--sn-space-1` 至 `--sn-space-10`（2/4/6/8/12/16/20/24/32/40）都在 Fluent 的阶梯里，少了 10、28、36 与 40 以上的档；终端的 `--sn-panel-padding`、`--sn-card-padding-x` 为 10px，也是 Fluent 的一档。
- 控件高度：Windows 11 主题的 `--sn-control-height-sm`、`--sn-control-height`、`--sn-control-height-lg` 为 24/32/40px，与 Fluent React 图标按钮的三档相同；终端为 22/26/30px，最紧凑。
- 目标尺寸一律按令牌中的 CSS 像素判断，不计字号缩放。终端的小号控件 22px 低于 24px；Playground 中卡片操作按钮之间是 `--sn-space-1`（2px），中心距恰为 24px，两个 24px 圆相切，处在间距例外的临界（推断）。建议把终端的 `--sn-control-height-sm` 改为 24px，或把间隙加到 `--sn-space-2`（推断）。2026-11-07 用户选定前者。
- 圆角也会让按钮变成小目标：杂志的 `--sn-radius-control` 为 999px，直径 26px 的圆形按钮内只放得下约 18px 的正方形（推断，按 2.5.8 说明中圆角的例子计算）。所以各主题小按钮之间的间隙都不能取消。
- Android 版以 48dp 为准，不能沿用桌面的 22 至 26px（推断）。

## 五、圆角与层次

| 来源 | 圆角 | 阴影与高度 |
| --- | --- | --- |
| Fluent 2 / Windows | Fluent：默认 4px，小于 32px 的形状 2px，大与特大组件 8px 与 12px，贴屏幕边缘的组件不圆；Web 代码令牌的 Large 为 6px、XLarge 为 8px，与设计站点（8px、12px）不一致。Windows：窗口、弹出层、菜单、对话框 8px；按钮、列表底板、工具提示 4px；直边相接与贴靠或最大化的窗口 0 | 阴影由清晰的方向阴影与柔和的环境阴影组成，shadow N 的模糊半径为 N；深色的阴影更重（低高度第一层 28% 对 14%）；Windows 用描边代替方向阴影，窗口与对话框高度 128，弹出层 32，工具提示 16，卡片 8，控件 2，都有 1px 描边 |
| Material 3 | none 0、extra-small 4、small 8、medium 12、large 16、extra-large 28（px）与 full；菜单与文本框用 extra-small | 高度 level0 至 level5 为 0/1/3/6/8/12；层次主要靠色调叠加，辅以阴影 |
| Apple HIG | 未核实 | 深色模式用 base 与 elevated 背景区分层次；Liquid Glass 是浮在内容之上的功能层 |
| Radix | 未核实 | 第 6 级用于不可交互的边框（侧栏、卡片、分隔线），第 7、8 级用于可交互组件的边框 |
| shadcn/ui 与 Tailwind | shadcn/ui：`--radius` 默认 0.625rem，sm、md、xl 等按 0.6、0.8、1.4 倍推算；Tailwind：xs 2、sm 4、md 6、lg 8、xl 12、2xl 16、3xl 24（px） | shadcn/ui：card 用于卡片与设置面板，popover 用于浮层；Tailwind：shadow-sm 至 shadow-lg 各为两层 10% 的黑色阴影 |
| WCAG 2.2 与 APG | 未核实 | 1.4.11：识别组件所需的边界 3:1 |

SideNotes 的取舍：

- Windows 11 主题与 Windows 一致：`--sn-radius-control`、`--sn-card-radius` 与工具提示用的 `--sn-radius-sm` 为 4px，弹窗用的 `--sn-radius-lg` 与 `--sn-panel-radius` 为 8px。
- 菜单不一致：Playground 的菜单取 `--sn-radius-md`，Windows 11 主题为 4px，而 Windows 的菜单是 8px（Glance 的菜单也是 8px）。可以把这套主题的 `--sn-radius-md` 改为 8px（代码块、行内提示随之变化），或为菜单单设令牌（推断）。
- 贴边：终端与记录纸贴住屏幕的侧边（记录纸只离开上下 10px），贴边一侧的 `--sn-panel-radius-edge` 为 0，符合 Fluent 的贴屏幕边缘不圆与 Windows 的直边相接不圆。
- 其余主题的圆角是风格选择，不对应某个平台：终端 2 至 6px，杂志用胶囊按钮（999px）与 14px 卡片，磨砂玻璃 12px 控件、18px 卡片、24px 面板（推断）。
- 阴影用两层：Windows 11 主题 `--sn-shadow-md` 的主阴影 `0 8px 16px` 与 `--sn-shadow-lg` 的 `0 32px 64px`，与 Fluent Web 的 shadow16、shadow64 几何相同。五套主题深色 `--sn-shadow-md` 的不透明度都高于浅色，与 Fluent 一致。

## 六、动效

| 来源 | 时长 | 缓动 | 减少动态效果 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | Fluent Web：50/100/150/200/250/300/400/500ms；WinUI 控件：83/167/250ms；进入 167/250/333ms，退出 167ms，纯淡入淡出 83ms | Fluent：EasyEase `(0.33, 0, 0.67, 1)`、DecelerateMax `(0.1, 0.9, 0.2, 1)`、DecelerateMid `(0, 0, 0, 1)`、AccelerateMid `(1, 0, 1, 1)`；Windows：进入 `(0, 0, 0, 1)`，点到点 `(0.55, 0.55, 0, 1)`，柔和退出 `(1, 0, 1, 1)` | 提供无动效设置；时长短、动作自然；动效限于焦点所在元素 |
| Material 3 | short 50 至 200、medium 250 至 400、long 450 至 600、extra-long 700 至 1000ms，每段 4 档 | standard `(0.2, 0, 0, 1)`；emphasized decelerate `(0.05, 0.7, 0.1, 1)`、accelerate `(0.3, 0, 0.8, 0.15)`；legacy `(0.4, 0, 0.2, 1)` | 未核实 |
| Apple HIG | 没有数值；反馈动画要简短精确；频繁的交互一般不加动效；不要让人等动画结束 | 未核实 | 开启「减少动态效果」时减少缩放与外围运动，用淡入淡出代替位移，不做模糊的出入动画，减少回弹 |
| Radix | 未核实 | 未核实 | 未核实 |
| shadcn/ui 与 Tailwind | Tailwind 过渡默认 150ms | 默认 `(0.4, 0, 0.2, 1)`；ease-in `(0.4, 0, 1, 1)`、ease-out `(0, 0, 0.2, 1)` | `motion-reduce:` 变体对应 `prefers-reduced-motion` |
| WCAG 2.2 与 APG | 未核实 | 未核实 | 2.3.3（AAA）：交互触发的运动动画可以关闭，必要的除外 |

SideNotes 的取舍：

- 五套主题的 `--sn-duration-fast` / `--sn-duration-normal` / `--sn-duration-slow`：终端 70/110/160，杂志 150/240/340，记录纸 160/240/280，Windows 11 100/167/250，磨砂玻璃 160/260/360（ms），都在 Fluent Web 的 50 至 500ms 之内。
- 终端最短：快档 70ms 介于 Fluent 的 50ms 与 WinUI 的 83ms 之间；慢档 160ms 用于弹窗与速记浮窗，比 Windows 的进入时长 167ms 还短。这是动效极短的主题风格，也符合 HIG 的频繁交互少加动效（推断）。
- Windows 11 主题：167/250ms 与 WinUI 相同；快档 100ms 等于 Fluent Web 的 durationFaster，WinUI 的对应值是 83ms。`--sn-ease-standard`、`--sn-ease-enter` 分别等于 Fluent 的 EasyEase 与 DecelerateMax；`--sn-ease-exit` 原为 `cubic-bezier(0.7, 0, 1, 0.5)`，在读到的资料中没有出处，已改为 Windows 的柔和退出 `cubic-bezier(1, 0, 1, 1)`。
- 杂志的三条缓动与 Material 3 的 standard、emphasized decelerate、emphasized accelerate 相同；时长 240/340ms 不在 Material 3 的档位上（相邻为 200、250 与 300、350）。
- 终端的 `--sn-ease-enter` 与 `--sn-ease-exit` 等于 Tailwind 的 ease-out 与 ease-in，也是 Material 3 的 legacy decelerate 与 accelerate。
- 减少动态效果：Playground 在 `prefers-reduced-motion: reduce` 时把过渡与动画缩短到近似为零（`playground/src/styles/base.css`）。HIG 建议用淡入淡出代替位移、不做模糊的出入动画；侧栏可以只保留透明度变化，不必瞬间出现（推断）。

## 七、交互状态与焦点

| 来源 | 悬停、按下、选中 | 焦点 | 禁用 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | Web 组件交互时变深，选中最深；Windows 相反，交互时变亮；Windows 控件静止与悬停高度 2、按下 1 | 焦点时颜色不变，描边加粗；WinUI 焦点框外层 2px、内层 1px，默认离控件 1px，只在键盘或手柄操作时显示 | 禁用的按钮不要求对比度 |
| Material 3 | 状态层不透明度：悬停 0.08，焦点 0.12，按下 0.12，拖动 0.16 | 焦点环 3px，向外偏移 2px | 内容不透明度 0.38 |
| Apple HIG | 列表获得焦点时，选中项用强调色底与白字；未获得焦点时用灰色底与常规文字色 | 文本框与搜索框用焦点环，列表与集合用整行高亮；不要在用户没有操作时移动焦点 | 不可用的菜单项变暗、不响应 |
| Radix | 第 3、4、5 级分别是组件常态、悬停、按下或选中的底色；默认透明的组件悬停用第 3 级 | 焦点环用第 7 级（概览表）或第 8 级（正文），页面前后不一 | 未核实 |
| shadcn/ui 与 Tailwind | `accent` 用于悬停、焦点与当前项（ghost 按钮、菜单高亮、悬停行） | `ring` 用于焦点环 | 未核实 |
| WCAG 2.2 与 APG | 1.4.11：表示状态的视觉信息 3:1 | 2.4.7（AA）键盘焦点可见；2.4.11（AA）获得焦点的组件不被作者内容完全遮住；2.4.13（AAA）指示面积不小于 2px 粗的周长，焦点前后同一像素 3:1 | 未激活的组件不要求对比度 |

SideNotes 的取舍：

- 悬停、按下、选中用叠加色（`--sn-color-hover`、`--sn-color-pressed`、`--sn-color-selected`），与 Material 3 的状态层、Radix 的 3 至 5 级同一思路。叠加比 Material 3 轻：悬停 4% 至 8%，按下 4% 至 12%。
- 焦点环：`--sn-focus-ring-width` 与 `--sn-focus-ring-offset` 都是 2px，与 WinUI 的主边框同宽，满足 2.4.13 的面积要求；令牌测试检查 `--sn-color-focus` 在卡片上 3:1。画在元素外侧的焦点环落在父级表面上（如页脚、标题区），这些组合可以补测（推断）。
- Playground 中卡片的焦点环画在内侧（`outline-offset` 为负值），接近 HIG 的列表整行高亮（推断）。
- 焦点与选中分开：APG listbox 指出两者不同，HIG 也区分列表有无焦点时的选中色。卡片的选中态与键盘焦点环要能同时显示，不能互相取代（推断）。
- 侧栏的标题区与页脚不能盖住获得焦点的卡片（2.4.11）；用键盘移动时把卡片滚入可见区（推断）。
- 禁用：`--sn-opacity-disabled` 为 0.45，比 Material 3 的 0.38 略高；`--sn-color-text-disabled` 不要求对比度，与 WCAG 对未激活组件的例外一致。

## 八、列表、菜单、弹窗与提示

| 来源 | 菜单与列表 | 弹窗 | 提示条与工具提示 |
| --- | --- | --- | --- |
| Fluent 2 / Windows | 菜单最宽 300px，长标签折行；次要内容槽只放快捷键；危险项放最后，分组用分隔线；Windows：菜单附着在按钮上，右键菜单附着在元素上、放次要命令；上下方向键在列表与菜单内移动焦点 | 对话框是模态的，关闭前阻止与窗口交互；必须有安全的关闭按钮，Esc 触发它；默认按钮响应 Enter，内容中没有可聚焦元素时打开即获得焦点 | 工具提示离目标 4px，悬停或聚焦时出现，失焦或移出时消失；不用它传达系统反馈 |
| Material 3 | 菜单容器圆角 extra-small（4px） | 未核实 | 未核实 |
| Apple HIG | 同组菜单项要么都有图标，要么都没有；用分隔线分组；需要进一步输入的命令加省略号；不可用的项变暗，菜单仍可打开 | 未核实 | 未核实 |
| Radix | Dropdown Menu 按 Menu Button 模式，Context Menu 按 Menu 模式，用 roving tabindex；Space、Enter 激活，上下键移动，左右键开关子菜单，Esc 关闭并把焦点还给触发按钮；支持首字母跳转 | 模态时焦点限制在弹窗内，Esc 关闭并把焦点还给触发按钮 | Toast 默认 5000ms 后关闭，悬停、聚焦或窗口失焦时暂停；F8 跳到提示区；用户操作的结果用 foreground 类型立即播报 |
| shadcn/ui 与 Tailwind | `popover` 用于 DropdownMenu、ContextMenu 等浮层 | 未核实 | 未核实 |
| WCAG 2.2 与 APG | APG 菜单：Tab 不在菜单项之间移动，上下键移动（可循环），Enter 激活并关闭，Esc 关闭并把焦点还给打开它的元素，禁用项可聚焦但不能激活，分隔线不可聚焦；listbox：超过 5 项时强烈建议支持 Home、End；页签：左右键移动并循环，面板无延迟时建议聚焦即激活 | APG：打开时焦点移入，Tab 在弹窗内循环，Esc 关闭，关闭后焦点回到触发元素；不可逆操作可以把初始焦点放在最不危险的按钮上 | WCAG 1.4.13：悬停或聚焦出现的内容可以不移开指针就关闭，指针能移到内容上，内容持续到触发消失 |

SideNotes 的取舍：

- 右键菜单与更多菜单按 APG 菜单模式，与 Radix Context Menu、Dropdown Menu 的按键一致；`--sn-menu-item-height` 为 26 至 34px（终端 26，Windows 11 32），都不低于 24px。
- 记录列表按 APG listbox 的思路：上下键移动焦点，焦点与选中分开（卡片键盘模型见 [reference-products.md](./reference-products.md) 的综合结论）。首字母跳转不适用于没有短名称的记录，不采用（推断）。
- 侧栏页签按 APG tabs；页签内容已在内存中，可以聚焦即激活（推断）。
- 删除确认等弹窗把初始焦点放在最不危险的按钮上，Esc 关闭并把焦点还给触发元素，APG 与 Windows 对话框的规定一致。
- 已复制、已移入回收站这类提示是用户操作的结果，按 Radix 的 foreground 类型立即播报；带撤销按钮的提示在悬停、聚焦时暂停计时（推断）。
- 工具提示离目标的距离，Fluent 为 4px，Glance 为 8px；按 1.4.13，工具提示要能用 Esc 关闭，指针移到提示上时不消失（推断）。

## 九、文本编辑

只列来源提到的内容。

| 来源 | 光标与选区 | 占位文字 |
| --- | --- | --- |
| Fluent 2 / Windows | 文本框默认用于编辑而不是替换：点进去时插入点落在词间，不选中内容；替换是主要用法时，可以在获得焦点时全选 | 用途不明确时用标签或占位文字；占位文字在有值后消失 |
| Material 3 | 文本框光标用 primary，出错时用 error；描边 1px，聚焦时 2px | 占位文字用 on-surface-variant |
| Apple HIG | macOS 分别定义选中文字底色、选中文字颜色、非当前窗口的弱化选区颜色与查找高亮颜色 | 占位文字输入后消失，可以另加标签说明用途；macOS 有专门的占位文字颜色 |
| Radix | 未核实 | 未核实 |
| shadcn/ui 与 Tailwind | `input` 用于输入框边框 | `muted-foreground` 用于占位文字、说明与空状态 |
| WCAG 2.2 与 APG | 2.5.8：可以在其中放置光标的编辑区算作一个目标 | 未核实 |

SideNotes 的取舍：

- `--sn-color-caret` 按 3:1 检查。读到的条款没有直接规定光标的对比度，本项目按 1.4.11 的界面组件门槛处理（推断）。除 Windows 11 主题用黑 90% 与白色外，其余主题的光标取强调色，与 Material 3 用 primary 相同。
- 选区 `--sn-color-selection` 与搜索命中 `--sn-color-highlight` 分成两个令牌，与 macOS 把选区与查找高亮分开一致。令牌中没有窗口失去焦点时的弱化选区色；侧栏与速记浮窗失去焦点后可能仍然可见，可以考虑增加（推断）。
- 占位文字没有单独的令牌，用 `--sn-color-text-muted`（4.5:1），与 shadcn/ui 用 muted 的做法相同。
- 速记浮窗与新建卡片打开时，插入点放在末尾、不选中内容，与 Windows 文本框的默认行为一致（推断：速记以追加为主）。
- 输入类控件获得焦点时底边换成 2px 的强调色线（五套主题共用，取 Windows 输入框的做法），读到的 Windows 页面没有写这一细节（未核实）；Material 3 的做法是聚焦时描边加粗到 2px。此前 Windows 11 主题的编辑区底部也有这条线（`--sn-color-editor-underline`），2026-11-08 删除。
