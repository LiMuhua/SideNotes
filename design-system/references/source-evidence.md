# 证据索引

本文列出设计系统文档依据的资料：[reference-matrix.md](./reference-matrix.md) 用到的官方设计规范、[adaptation.md](../adaptation.md) 用到的平台文档、[glance-analysis.md](./glance-analysis.md) 的源码与截图，以及规范中「现有」行为所依据的 SideNotes 源码。每项写明取用的事实、用到它的文档与可信度。

## 一、官方规范

以下页面于 2026-11-07 用 `curl` 读取原文。「用于」指 reference-matrix.md 的章节：结论；一、颜色与明暗；二、半透明材质；三、字体与字号；四、间距、密度与目标尺寸；五、圆角与层次；六、动效；七、交互状态与焦点；八、列表、菜单、弹窗与提示；九、文本编辑。缓动只写 `cubic-bezier()` 的四个参数。

### Fluent 2 设计站点

- **FL1 Color**：[fluent2.microsoft.design/color](https://fluent2.microsoft.design/color)，读取于 2026-11-07。
  - 事实：中性、共享、品牌三组色板，每个值存为全局令牌，别名令牌提供用途；语义色只用于传达重要信息；Web 组件随交互由浅到深，Windows 相反，越交互越亮；焦点时控件颜色不变，容器描边加粗；不能只用颜色传达信息。
  - 用于：一、七。可信度：已核实（页面原文）。
- **FL2 Typography**：[fluent2.microsoft.design/typography](https://fluent2.microsoft.design/typography)，读取于 2026-11-07。
  - 事实：Web 阶梯以 Segoe UI 为默认字体，Caption 1 12/16、Body 1 14/20、Subtitle 2 16/22、Subtitle 1 20/26；Windows 阶梯用 Segoe UI Variable，Caption 12/16、Body 14/20、Body large 18/24、Subtitle 20/28、Title 28/36；其他平台用系统字体；文字 4.5:1，大字（粗体 18.5px 以上或常规 24px 以上）3:1。
  - 用于：一、三。可信度：已核实（页面原文）。
- **FL3 Layout**：[fluent2.microsoft.design/layout](https://fluent2.microsoft.design/layout)，读取于 2026-11-07。
  - 事实：间距以 4px 为基准，2、6、10 用于对齐图标；阶梯从 size20 到 size560，即 2 至 56px 共 16 档；移动端最小触控目标 iOS 与 Web 44×44、Android 48×48。
  - 用于：四。可信度：已核实（页面原文）。
- **FL4 Shapes**：[fluent2.microsoft.design/shapes](https://fluent2.microsoft.design/shapes)，读取于 2026-11-07。
  - 事实：矩形默认圆角 4px，小于 32px 的形状 2px，大与特大组件 8px 与 12px；圆角令牌 None 0、Small 2、Medium 4、Large 8、X-Large 12、Circle 50%；贴屏幕边缘的组件不需要圆角；Web 描边 1、2、3、4px 四档。
  - 用于：五。可信度：已核实（页面原文）。
- **FL5 Elevation**：[fluent2.microsoft.design/elevation](https://fluent2.microsoft.design/elevation)，读取于 2026-11-07。
  - 事实：阴影由清晰的方向阴影（key）与柔和的环境阴影（ambient）组成；shadow 2 的模糊为 2px，shadow 64 为 64px；低高度阴影的第一层浅色 14%、深色 28%；Windows 用描边代替方向阴影。
  - 用于：五。可信度：已核实（页面原文）。
- **FL6 Motion**：[fluent2.microsoft.design/motion](https://fluent2.microsoft.design/motion)，读取于 2026-11-07。
  - 事实：页面没有时长数值；大元素的时长应更长；线性缓动只用于旋转这类匀速场景；无障碍要求：提供无动效设置，时长短、动作自然，动效限于焦点所在元素，可用 ARIA live 区域传达动画表达的信息。
  - 用于：六。可信度：已核实（页面原文）。
- **FL7 Material**：[fluent2.microsoft.design/material](https://fluent2.microsoft.design/material)，读取于 2026-11-07。
  - 事实：四种材质：实心、Mica、亚克力、Smoke；亚克力半透明，用于弹出框、菜单等点外部即关闭的临时表面；Mica 不透明，窗口激活时带桌面底色，失去焦点时变中性色；Smoke 始终是半透明黑色，用于模态界面下的遮罩。
  - 用于：二。可信度：已核实（页面原文）。
- **FL8 Accessibility**：[fluent2.microsoft.design/accessibility](https://fluent2.microsoft.design/accessibility)，读取于 2026-11-07。
  - 事实：组件达到或超过 WCAG 2.1 AA；正文 4.5:1，大字 3:1，交互组件与图标 3:1；对话框等临时界面关闭后焦点不能丢失；缩放到 400% 时在 320px 宽度下不横向滚动，文字放大到 200% 不被裁切。
  - 用于：一、三、七。可信度：已核实（页面原文）。
- **FL9 Menu**：[fluent2.microsoft.design/components/web/react/core/menu/usage](https://fluent2.microsoft.design/components/web/react/core/menu/usage)，读取于 2026-11-07。
  - 事实：菜单最宽 300px，长标签折行；常用项在前、危险项在后，分组用分隔线；次要内容槽只放与该项等效的快捷键。
  - 用于：八。可信度：已核实（页面原文）。
- **FL10 Tooltip**：[fluent2.microsoft.design/components/web/react/core/tooltip/usage](https://fluent2.microsoft.design/components/web/react/core/tooltip/usage)，读取于 2026-11-07。
  - 事实：悬停或聚焦目标时出现，失焦或移出目标与提示时消失；默认离目标 4px；不要用工具提示传达系统反馈。
  - 用于：八。可信度：已核实（页面原文）。
- **FL11 Button**：[fluent2.microsoft.design/components/web/react/core/button/usage](https://fluent2.microsoft.design/components/web/react/core/button/usage)，读取于 2026-11-07。
  - 事实：按钮文字在所有交互状态下 4.5:1，图标 3:1；文字与图标达标时按钮描边不要求对比度；禁用的按钮不要求对比度。
  - 用于：七。可信度：已核实（页面原文）。

### Fluent UI 仓库（microsoft/fluentui，master 分支）

- **FL12 durations.ts**：[packages/tokens/src/global/durations.ts](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/durations.ts)，读取于 2026-11-07。
  - 事实：UltraFast 50、Faster 100、Fast 150、Normal 200、Gentle 250、Slow 300、Slower 400、UltraSlow 500ms。
  - 用于：结论、六。可信度：已核实（页面原文）。
- **FL13 curves.ts**：[packages/tokens/src/global/curves.ts](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/curves.ts)，读取于 2026-11-07。
  - 事实：AccelerateMax (0.9, 0.1, 1, 0.2)、AccelerateMid (1, 0, 1, 1)、AccelerateMin (0.8, 0, 0.78, 1)、DecelerateMax (0.1, 0.9, 0.2, 1)、DecelerateMid (0, 0, 0, 1)、DecelerateMin (0.33, 0, 0.1, 1)、EasyEaseMax (0.8, 0, 0.2, 1)、EasyEase (0.33, 0, 0.67, 1)、Linear；其中没有 (0.7, 0, 1, 0.5)。
  - 用于：结论、六。可信度：已核实（页面原文）。
- **FL14 borderRadius.ts**：[packages/tokens/src/global/borderRadius.ts](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/borderRadius.ts)，读取于 2026-11-07。
  - 事实：None 0、Small 2、Medium 4、Large 6、XLarge 8、2XLarge 12、3XLarge 16、4XLarge 24、5XLarge 32、6XLarge 40px，Circular 10000px；Large 与 XLarge 和设计站点（FL4）的 8、12 不同。
  - 用于：五。可信度：已核实（页面原文）。
- **FL15 shadows.ts**：[packages/tokens/src/utils/shadows.ts](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/utils/shadows.ts)，读取于 2026-11-07。
  - 事实：shadowN 由一层环境阴影（`0 0 2px`，shadow28 与 shadow64 为 `0 0 8px`）与一层方向阴影组成，如 shadow16 的方向阴影为 `0 8px 16px`，shadow64 为 `0 32px 64px`。
  - 用于：五。可信度：已核实（页面原文）。
- **FL16 useButtonStyles.styles.ts**：[react-button 的按钮样式](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts)，读取于 2026-11-07。
  - 事实：只有图标的按钮宽度 small 24px、medium 32px、large 40px（minWidth 与 maxWidth 相同）。
  - 用于：四。可信度：已核实（页面原文）。

### Windows 应用设计（learn.microsoft.com）

- **WIN1 Mica material**：[windows/apps/design/style/mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)，读取于 2026-11-07。
  - 事实：Mica 不透明，结合主题与桌面壁纸绘制应用、设置等长期窗口的背景，只采样一次壁纸，窗口失去焦点时变为中性色；关闭透明效果、节电模式、低端硬件、窗口失去焦点、系统版本低于 22000 时显示实心色；高对比度模式显示用户选的背景色；一个应用只用一次背景材质。
  - 用于：二。可信度：已核实（页面原文）。
- **WIN2 Acrylic material**：[windows/apps/design/style/acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)，读取于 2026-11-07。
  - 事实：背景亚克力透出桌面与其他窗口，应用内亚克力只在窗口内产生层次；右键菜单、弹出层、非模态弹窗、点外部即关闭的窗格用背景亚克力；分区用的竖向面板用不透明背景，叠在内容上打开的竖向面板可以用应用内亚克力；避免多层亚克力，不要边对边放几块（会出现接缝）；关闭透明效果、节电、低端硬件时显示实心色，背景亚克力在窗口失去焦点时也是；系统资源已调到文字达标，不建议在亚克力上放强调色文字（默认 14px 下可能不达标）；组成为背景、模糊、排除混合、着色与噪点。
  - 用于：结论、二。可信度：已核实（页面原文）。
- **WIN3 Materials in Windows**：[windows/apps/design/signature-experiences/materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials)，读取于 2026-11-07。
  - 事实：亚克力只用于弹出层、右键菜单等临时表面，Windows 11 中更亮、更透明；Mica 不透明，并显示窗口是否处于焦点；Smoke 用于模态界面下的遮罩，始终是半透明黑色。
  - 用于：二。可信度：已核实（页面原文）。
- **WIN4 Typography in Windows**：[windows/apps/design/signature-experiences/typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography)，读取于 2026-11-07。
  - 事实：Segoe UI Variable 有字重轴（100 至 700）与光学尺寸轴；HTML 中光学尺寸也自动调整，但要在 CSS 中指定 Segoe UI Variable；最小 12px 常规、14px 半粗，标题用半粗；阶梯 12/16、14/20、18/24、20/28、28/36、40/52、68/92（epx）；强调用半粗不用粗体，不用斜体；简体中文界面字体为 Microsoft YaHei UI。
  - 用于：结论、三。可信度：已核实（页面原文）。
- **WIN5 Geometry**：[windows/apps/design/signature-experiences/geometry](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry)，读取于 2026-11-07。
  - 事实：窗口、弹出层、对话框 8px；按钮、列表底板等页内元素 4px；ContentDialog、Flyout、MenuFlyout、TeachingTip 用 8px，ToolTip 例外用 4px；进度条、滚动条、滑块 4px；直边相接不圆，贴靠或最大化的窗口不圆；全局资源 ControlCornerRadius 默认 4px，OverlayCornerRadius 默认 8px。
  - 用于：结论、五。可信度：已核实（页面原文）。
- **WIN6 Content basics**：[windows/apps/design/basics/content-basics](https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics)，读取于 2026-11-07。原地址 `design/style/spacing` 重定向到这里。
  - 事实：按钮之间 8，按钮与弹出层 8，控件与标题 8，控件与标签 12，内容区之间 12，表面边缘到文字 16（epx）。
  - 用于：四。可信度：已核实（页面原文）。
- **WIN7 Timing and easing**：[windows/apps/design/motion/timing-and-easing](https://learn.microsoft.com/en-us/windows/apps/design/motion/timing-and-easing)，读取于 2026-11-07。
  - 事实：ControlNormalAnimationDuration 250ms、ControlFastAnimationDuration 167ms、ControlFasterAnimationDuration 83ms；进入用 (0, 0, 0, 1)，退出用 (1, 0, 1, 1)。
  - 用于：结论、六。可信度：已核实（页面原文）。
- **WIN8 Motion in Windows**：[windows/apps/design/signature-experiences/motion](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/motion)，读取于 2026-11-07。
  - 事实：直接进入 (0, 0, 0, 1)，167、250、333ms；点到点 (0.55, 0.55, 0, 1)；直接退出 (0, 0, 0, 1)，167ms，要配合淡出；柔和退出 (1, 0, 1, 1)，167ms；只有透明度的淡入淡出为线性 83ms；尽量使用系统控件的动画，少做自定义动画。
  - 用于：六。可信度：已核实（页面原文）。
- **WIN9 Layering and elevation**：[windows/apps/design/signature-experiences/layering](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/layering)，读取于 2026-11-07。
  - 事实：高度值：窗口与对话框 128，弹出层 32，工具提示 16，卡片 8，控件 2，图层 1，都有 1px 描边；控件静止与悬停为 2、按下为 1；应用分基础层与内容层两层。
  - 用于：五、七。可信度：已核实（页面原文）。
- **WIN10 Color in Windows**：[windows/apps/design/signature-experiences/color](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color)，读取于 2026-11-07。
  - 事实：浅色与深色两种模式；两种模式下越暗的表面越次要，重要表面更亮；强调色少量使用，标示重要元素与交互状态；不要只用红绿两色区分界面元素。
  - 用于：一。可信度：已核实（页面原文）。
- **WIN11 Menus and context menus**：[windows/apps/develop/ui/controls/menus-and-context-menus](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/menus-and-context-menus)，读取于 2026-11-07。
  - 事实：菜单附着在按钮等命令元素上，左键打开；右键菜单附着在其他元素上，放次要命令，右键或长按打开。
  - 用于：八。可信度：已核实（页面原文）。
- **WIN12 Guidelines for touch targets**：[windows/apps/develop/input/guidelines-for-targeting](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-targeting)，读取于 2026-11-07。
  - 事实：触控目标一般为 7.5mm 见方（135 PPI、100% 缩放下 40×40 像素）；常用或误触后果严重的目标应更大。
  - 用于：四。可信度：已核实（页面原文）。
- **WIN13 Keyboard interactions**：[windows/apps/develop/input/keyboard-interactions](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-interactions)，读取于 2026-11-07。
  - 事实：焦点框在用键盘、手柄或遥控器移动焦点时显示；Tab 在控件之间移动，方向键在 ListView、MenuFlyout 等控件内部移动；Esc 取消临时界面；Enter 激活命令。
  - 用于：七、八。可信度：已核实（页面原文）。
- **WIN14 Visual feedback**：[windows/apps/develop/input/guidelines-for-visualfeedback](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-visualfeedback)，读取于 2026-11-07。
  - 事实：高可见焦点框由外层 2px 的主边框与内层 1px 的次边框组成，默认离控件边界 1px，可以按控件修改或关闭。
  - 用于：七。可信度：已核实（页面原文）。
- **WIN15 Dialog controls**：[windows/apps/develop/ui/controls/dialogs-and-flyouts/dialogs](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts/dialogs)，读取于 2026-11-07。
  - 事实：对话框是模态的，关闭前阻止与窗口交互；每个对话框都要有安全的关闭按钮，Esc 触发它；默认按钮使用强调样式并响应 Enter，内容中没有可聚焦元素时打开即获得焦点。
  - 用于：八。可信度：已核实（页面原文）。
- **WIN16 Text box**：[windows/apps/develop/ui/controls/text-box](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/text-box)，读取于 2026-11-07。
  - 事实：用途不明确时加标签或占位文字，占位文字在有值后消失；默认用于编辑，点进去时插入点落在词间、不选中内容；以替换为主的文本框可以在获得焦点时全选。
  - 用于：九。可信度：已核实（页面原文）。

### Material Design 3

m3.material.io 由脚本渲染，令牌改读 Google 官方的 material-web 仓库（main 分支，`tokens/versions/v0_192/`），说明改读 developer.android.com。

- **MD1 \_md-sys-motion.scss**：[tokens/versions/v0_192/\_md-sys-motion.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-motion.scss)，读取于 2026-11-07。
  - 事实：short1 至 short4 为 50/100/150/200ms，medium 为 250/300/350/400ms，long 为 450/500/550/600ms，extra-long 为 700/800/900/1000ms；standard (0.2, 0, 0, 1)、standard-accelerate (0.3, 0, 1, 1)、standard-decelerate (0, 0, 0, 1)、emphasized-accelerate (0.3, 0, 0.8, 0.15)、emphasized-decelerate (0.05, 0.7, 0.1, 1)、legacy (0.4, 0, 0.2, 1)、legacy-accelerate (0.4, 0, 1, 1)、legacy-decelerate (0, 0, 0.2, 1)。
  - 用于：结论、六。可信度：已核实（页面原文）。
- **MD2 \_md-sys-shape.scss**：[tokens/versions/v0_192/\_md-sys-shape.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-shape.scss)，读取于 2026-11-07。
  - 事实：corner-none 0、extra-small 4px、small 8px、medium 12px、large 16px、extra-large 28px、full 9999px。
  - 用于：五。可信度：已核实（页面原文）。
- **MD3 \_md-sys-state.scss**：[tokens/versions/v0_192/\_md-sys-state.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-state.scss)，读取于 2026-11-07。
  - 事实：状态层不透明度：悬停 0.08、焦点 0.12、按下 0.12、拖动 0.16。
  - 用于：七。可信度：已核实（页面原文）。
- **MD4 \_md-sys-typescale.scss**：[tokens/versions/v0_192/\_md-sys-typescale.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-typescale.scss)，读取于 2026-11-07。
  - 事实：body large、medium、small 为 1rem/1.5rem、0.875rem/1.25rem、0.75rem/1rem；label 为 0.875rem/1.25rem、0.75rem/1rem、0.6875rem/1rem，中等字重；title 为 1.375rem/1.75rem、1rem/1.5rem、0.875rem/1.25rem。reference-matrix.md 按 16px 根字号换算为像素。
  - 用于：三。可信度：已核实（页面原文）。
- **MD5 \_md-sys-elevation.scss**：[tokens/versions/v0_192/\_md-sys-elevation.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-elevation.scss)，读取于 2026-11-07。
  - 事实：level0 至 level5 为 0、1、3、6、8、12。
  - 用于：五。可信度：已核实（页面原文）。
- **MD6 \_md-sys-color.scss**：[tokens/versions/v0_192/\_md-sys-color.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-sys-color.scss)，读取于 2026-11-07。
  - 事实：颜色角色包括 primary、on-primary、primary-container、on-primary-container、surface、surface-dim、surface-bright、surface-container-lowest 至 surface-container-highest 五档、outline、outline-variant、inverse-surface、scrim 等。
  - 用于：一。可信度：已核实（页面原文）。
- **MD7 \_md-comp-focus-ring.scss**：[tokens/\_md-comp-focus-ring.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/_md-comp-focus-ring.scss)，读取于 2026-11-07。
  - 事实：焦点环宽 3px，向外偏移 2px，颜色取 secondary，形状为 full。
  - 用于：七。可信度：已核实（页面原文）。
- **MD8 \_md-comp-icon-button.scss**：[tokens/versions/v0_192/\_md-comp-icon-button.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-icon-button.scss)，读取于 2026-11-07。
  - 事实：图标 24px，状态层 40×40，禁用时图标不透明度 0.38。
  - 用于：四、七。可信度：已核实（页面原文）。
- **MD9 \_md-comp-menu.scss**：[tokens/versions/v0_192/\_md-comp-menu.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-menu.scss)，读取于 2026-11-07。
  - 事实：菜单容器圆角为 corner-extra-small。
  - 用于：五、八。可信度：已核实（页面原文）。
- **MD10 \_md-comp-outlined-text-field.scss**：[tokens/versions/v0_192/\_md-comp-outlined-text-field.scss](https://raw.githubusercontent.com/material-components/material-web/main/tokens/versions/v0_192/_md-comp-outlined-text-field.scss)，读取于 2026-11-07。
  - 事实：光标颜色 primary，出错时 error；描边 1px，聚焦 2px；占位文字 on-surface-variant；禁用文字不透明度 0.38；容器圆角 extra-small。
  - 用于：五、九。可信度：已核实（页面原文）。
- **MD11 Material Design 3 in Compose**：[developer.android.com/develop/ui/compose/designsystems/material3](https://developer.android.com/develop/ui/compose/designsystems/material3)，读取于 2026-11-07。
  - 事实：配色以 5 个关键色为基础，每个关键色对应 13 个色调的色调板；primary 用于主要组件与选中态；层次主要靠色调叠加，深色主题的叠加色取自 primary；禁用状态可以用带透明度的 on-x 颜色；动态配色按对比度标准设计，页面没有给出比值。
  - 用于：一、五。可信度：已核实（页面原文）。
- **MD12 Make apps more accessible**：[developer.android.com/guide/topics/ui/accessibility/apps](https://developer.android.com/guide/topics/ui/accessibility/apps)，读取于 2026-11-07。
  - 事实：触控目标至少 48dp×48dp；鼠标、触控板等精确输入可以更小。
  - 用于：结论、四。可信度：已核实（页面原文）。
- **MD13 Accessibility in Compose：API defaults**：[developer.android.com/develop/ui/compose/accessibility/api-defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults)，读取于 2026-11-07。
  - 事实：按 Material 的无障碍规范，可交互元素最小 48dp；`minimumInteractiveComponentSize` 在每个方向至少保留 48dp 的布局空间。
  - 用于：四。可信度：已核实（页面原文）。

### Apple 人机界面指南

页面由脚本渲染，正文读自 `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<页面>.json`；下面的链接是对应的网页。

- **HIG1 Materials**：[human-interface-guidelines/materials](https://developer.apple.com/design/human-interface-guidelines/materials)，读取于 2026-11-07。
  - 事实：Liquid Glass 是浮在内容上的控件与导航层（如标签栏、侧栏），不用于内容层；regular 变体模糊并调整背景亮度，用于文字多的组件（提醒、侧栏、弹出框）；clear 变体高度透明，叠在亮内容上时考虑加 35% 的暗色遮罩；标准材质越厚越不透明、对比越好，越薄越能看到背景；「降低透明度」「增强对比度」会改变外观。
  - 用于：二。可信度：已核实（页面原文）。
- **HIG2 Typography**：[human-interface-guidelines/typography](https://developer.apple.com/design/human-interface-guidelines/typography)，读取于 2026-11-07。
  - 事实：默认与最小字号 iOS 17pt、11pt，macOS 13pt、10pt；避免 Ultralight、Thin、Light；系统字体随字号调整光学尺寸与字距；macOS 文字样式 Body 13/16、Callout 12/15、Subheadline 11/14、Footnote 与 Caption 10/13、Headline 13/16（粗体）、Title 3 15/20；macOS 不支持 Dynamic Type。
  - 用于：结论、三。可信度：已核实（页面原文）。
- **HIG3 Color**：[human-interface-guidelines/color](https://developer.apple.com/design/human-interface-guidelines/color)，读取于 2026-11-07。
  - 事实：同一种颜色不表示不同含义；颜色要在浅色、深色与增强对比度下都可用；不改变动态系统颜色的语义，例如不把分隔线色用作文字；侧栏等大元素上的 Liquid Glass 更不透明；macOS 的动态颜色包括键盘焦点指示、占位文字、选中文字底色、查找高亮，以及非当前窗口的弱化选区颜色。
  - 用于：一、二、九。可信度：已核实（页面原文）。
- **HIG4 Accessibility**：[human-interface-guidelines/accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)，读取于 2026-11-07。
  - 事实：Accessibility Inspector 采用的 WCAG AA 值：17pt 及以下 4.5:1，18pt 及以上 3:1，粗体 3:1；控件尺寸 iOS 默认 44×44pt、最小 28×28pt，macOS 默认 28×28pt、最小 20×20pt；带边框的元素四周约 12pt、无边框约 24pt；「减少动态效果」开启时减少缩放与外围运动，用淡入淡出代替位移，不做模糊的出入动画，收紧弹簧以减少回弹。
  - 用于：一、四、六。可信度：已核实（页面原文）。
- **HIG5 Motion**：[human-interface-guidelines/motion](https://developer.apple.com/design/human-interface-guidelines/motion)，读取于 2026-11-07。
  - 事实：有目的地使用动效；动效可选，不作为传达重要信息的唯一方式；反馈动画简短精确；频繁的界面交互一般不加动效；允许中途取消，不让人等动画结束；页面没有时长与缓动数值。
  - 用于：六。可信度：已核实（页面原文）。
- **HIG6 Dark Mode**：[human-interface-guidelines/dark-mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)，读取于 2026-11-07。
  - 事实：对比度不低于 4.5:1，自定义颜色争取 7:1，小字尤其如此；深色模式有 base 与 elevated 两组背景，弹出框等前景界面用更亮的 elevated；要在「增强对比度」「降低透明度」开启时测试。
  - 用于：一、五。可信度：已核实（页面原文）。
- **HIG7 Focus and selection**：[human-interface-guidelines/focus-and-selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection)，读取于 2026-11-07。
  - 事实：iPadOS 与 macOS 用焦点环或高亮表示焦点；文本框与搜索框用焦点环，列表与集合用整行高亮；列表获得焦点时选中项用强调色底与白字，否则用灰色底；不要在用户没有操作时移动焦点。
  - 用于：七。可信度：已核实（页面原文）。
- **HIG8 Menus**：[human-interface-guidelines/menus](https://developer.apple.com/design/human-interface-guidelines/menus)，读取于 2026-11-07。
  - 事实：不可用的项变暗，菜单本身仍可打开；需要进一步输入的命令加省略号；同组菜单项都有图标或都没有；用分隔线分组；少用子菜单。
  - 用于：八。可信度：已核实（页面原文）。
- **HIG9 Text fields**：[human-interface-guidelines/text-fields](https://developer.apple.com/design/human-interface-guidelines/text-fields)，读取于 2026-11-07。
  - 事实：占位文字说明用途，输入后消失，因此可以另加标签。
  - 用于：九。可信度：已核实（页面原文）。

### Radix

- **RX1 Dropdown Menu**：[radix-ui.com/primitives/docs/components/dropdown-menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu)，读取于 2026-11-07。
  - 事实：遵循 WAI-ARIA 的 Menu Button 模式，用 roving tabindex 管理焦点；Space、Enter 在触发按钮上打开菜单并聚焦第一项，在菜单项上激活该项；下方向键打开或下移，上方向键上移；左右方向键开关子菜单；Esc 关闭并把焦点还给触发按钮；支持首字母跳转，支持模态与非模态。
  - 用于：结论、八。可信度：已核实（页面原文）。
- **RX2 Context Menu**：[radix-ui.com/primitives/docs/components/context-menu](https://www.radix-ui.com/primitives/docs/components/context-menu)，读取于 2026-11-07。
  - 事实：遵循 Menu 模式；Space、Enter 激活，上下方向键移动，左右方向键开关子菜单，Esc 关闭；触屏上长按打开。
  - 用于：八。可信度：已核实（页面原文）。
- **RX3 Dialog**：[radix-ui.com/primitives/docs/components/dialog](https://www.radix-ui.com/primitives/docs/components/dialog)，读取于 2026-11-07。
  - 事实：遵循 Dialog 模式；模态时焦点限制在弹窗内；Tab、Shift+Tab 在可聚焦元素之间移动；Esc 关闭并把焦点还给触发按钮。
  - 用于：八。可信度：已核实（页面原文）。
- **RX4 Toast**：[radix-ui.com/primitives/docs/components/toast](https://www.radix-ui.com/primitives/docs/components/toast)，读取于 2026-11-07。
  - 事实：Provider 的 duration 默认 5000ms；悬停、聚焦与窗口失焦时暂停关闭；F8 聚焦提示区；用户操作的结果用 foreground 类型立即播报，后台任务用 background；遵循 aria-live 的要求。
  - 用于：八。可信度：已核实（页面原文）。
- **RX5 Understanding the scale**：[radix-ui.com/colors/docs/palette-composition/understanding-the-scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)，读取于 2026-11-07。
  - 事实：12 级各有用途，第 1 级为应用背景，第 12 级为高对比文字；第 3、4、5 级为组件常态、悬停、按下或选中；第 6 级用于不可交互组件的边框，第 7 级用于可交互组件，第 8 级用于更强的边框与焦点环，而页面开头的概览表把焦点环写在第 7 级；Sky、Mint、Lime、Yellow、Amber 的 9、10 级为深色文字设计；11、12 级在同色阶第 2 级上保证 APCA Lc 60 与 Lc 90。
  - 用于：一、五、七。可信度：已核实（页面原文）。
- **RX6 Scales**：[radix-ui.com/colors/docs/palette-composition/scales](https://www.radix-ui.com/colors/docs/palette-composition/scales)，读取于 2026-11-07。
  - 事实：每个色阶都列出浅色、浅色 Alpha、深色、深色 Alpha 四组，如 Gray、Gray Alpha、Gray Dark、Gray Dark Alpha。
  - 用于：一。可信度：已核实（页面原文）。

### shadcn/ui 与 Tailwind CSS

- **SH1 Theming**：[ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)，读取于 2026-11-07。
  - 事实：基础令牌是表面色，`-foreground` 是其上的文字与图标色，写在 `:root` 与 `.dark`；card 用于卡片与设置面板，popover 用于 Popover、DropdownMenu、ContextMenu 等浮层，muted 用于说明、占位文字与空状态，accent 用于悬停、焦点与当前项，border、input、ring 分别用于分隔线、表单控件边框与焦点环，另有一组 sidebar 令牌；`--radius` 默认 0.625rem，sm 为 0.6 倍、md 为 0.8 倍、lg 为 1 倍、xl 为 1.4 倍，更大档依次递增。
  - 用于：一、五、七、八、九。可信度：已核实（页面原文）。
- **TW1 Theme variables**：[tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme)，读取于 2026-11-07。
  - 事实：默认主题 `--spacing` 为 0.25rem；`--text-xs` 0.75rem（行高 1/0.75）、`--text-sm` 0.875rem（1.25/0.875）、`--text-base` 1rem（1.5）、`--text-lg` 1.125rem、`--text-xl` 1.25rem；`--radius-xs` 至 `--radius-3xl` 为 0.125、0.25、0.375、0.5、0.75、1、1.5rem；`--shadow-sm` 至 `--shadow-lg` 各为两层 10% 的黑色阴影；`--ease-in` (0.4, 0, 1, 1)、`--ease-out` (0, 0, 0.2, 1)、`--ease-in-out` (0.4, 0, 0.2, 1)。
  - 用于：三、四、五、六。可信度：已核实（页面原文）。
- **TW2 transition-property**：[tailwindcss.com/docs/transition-property](https://tailwindcss.com/docs/transition-property)，读取于 2026-11-07。
  - 事实：过渡默认时长 150ms，默认缓动 (0.4, 0, 0.2, 1)；`motion-reduce:` 变体用于减少动态效果。
  - 用于：六。可信度：已核实（页面原文）。
- **TW3 padding**：[tailwindcss.com/docs/padding](https://tailwindcss.com/docs/padding)，读取于 2026-11-07。
  - 事实：`p-<number>` 的值为 `calc(var(--spacing) * <number>)`。
  - 用于：四。可信度：已核实（页面原文）。

### WCAG 2.2 与 WAI-ARIA 创作实践

- **WCAG1 Web Content Accessibility Guidelines (WCAG) 2.2**：[w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)，W3C 推荐标准 2024-12-12 版，读取于 2026-11-07。
  - 事实：1.4.1 颜色不能是唯一手段；1.4.3 文字 4.5:1、大字 3:1，未激活组件、装饰与标志不要求；大字为 18pt 或 14pt 粗体（中日韩字体取等效大小）；1.4.4 文字可放大到 200%；1.4.10 宽 320 CSS 像素（或高 256）时不二维滚动；1.4.11 识别界面组件、状态与图形所需的部分 3:1；1.4.12 行高 1.5、段后 2、字距 0.12、词距 0.16 倍时不丢失内容；1.4.13 悬停或聚焦出现的内容可关闭、可悬停、持续显示；2.3.3（AAA）交互触发的运动动画可以关闭；2.4.7 焦点可见；2.4.11 获得焦点的组件不被作者内容完全遮住；2.4.13（AAA）焦点指示面积不小于 2 CSS 像素粗的周长，焦点前后同一像素 3:1；2.5.5（AAA）44×44；2.5.8 24×24，另有间距、等效、行内、用户代理控制、必要五个例外，可以在其中放置光标的编辑区算一个目标。
  - 用于：结论、一、三、四、六、七、八、九。可信度：已核实（页面原文）。
- **WCAG2 Understanding Target Size (Minimum)**：[w3.org/WAI/WCAG22/Understanding/target-size-minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)，读取于 2026-11-07。
  - 事实：达标是指能在目标内画出一个 24×24 CSS 像素的正方形；圆角使目标放不下这个正方形时，目标算作偏小，要看与其他目标的间距；这项要求「independent of the zoom factor of the page」，作者不能以用户会放大页面为理由。
  - 用于：结论、四。可信度：已核实（页面原文）。
- **APG1 Listbox Pattern**：[w3.org/WAI/ARIA/apg/patterns/listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)，读取于 2026-11-07。
  - 事实：上下方向键移动焦点；Home、End 可选，超过 5 项时强烈建议支持；超过 7 项时建议支持首字母跳转；焦点与选中是两回事，单选列表可以让选中跟随焦点。
  - 用于：七、八。可信度：已核实（页面原文）。
- **APG2 Menu and Menubar Pattern**：[w3.org/WAI/ARIA/apg/patterns/menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)，读取于 2026-11-07。
  - 事实：Tab 不在菜单项之间移动；Enter 激活并关闭菜单；上下方向键移动，可以循环，不循环时 Home、End 到首尾；首字母跳转可选；Esc 关闭并把焦点还给打开菜单的元素；禁用项可以聚焦但不能激活；分隔线不可聚焦。
  - 用于：八。可信度：已核实（页面原文）。
- **APG3 Menu Button Pattern**：[w3.org/WAI/ARIA/apg/patterns/menu-button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)，读取于 2026-11-07。
  - 事实：Enter、Space 打开菜单并聚焦第一项；可选地用下方向键聚焦第一项、上方向键聚焦最后一项。
  - 用于：八。可信度：已核实（页面原文）。
- **APG4 Dialog (Modal) Pattern**：[w3.org/WAI/ARIA/apg/patterns/dialog-modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)，读取于 2026-11-07。
  - 事实：打开时焦点移入弹窗；Tab、Shift+Tab 在弹窗内循环；Esc 关闭；关闭后焦点回到触发元素；不可逆操作可以把初始焦点放在最不危险的按钮上；Tab 序列中最好有可见的关闭按钮。
  - 用于：八。可信度：已核实（页面原文）。
- **APG5 Tabs Pattern**：[w3.org/WAI/ARIA/apg/patterns/tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)，读取于 2026-11-07。
  - 事实：左右方向键在页签之间移动并在首尾循环；Home、End 可选；Space 或 Enter 激活；面板能无明显延迟显示时，建议页签获得焦点即激活。
  - 用于：八。可信度：已核实（页面原文）。

## 二、平台文档

- **TA1 Tauri 2 配置参考**：[v2.tauri.app/reference/config](https://v2.tauri.app/reference/config/)，读取于 2026-11-05。
  - 事实：`WindowEffect` 中，`mica`、`micaLight`、`micaDark` 与 `tabbed` 系列只限 Windows 11；`acrylic` 限 Windows 10、11，在 Windows 10 v1903 及以上与 Windows 11 build 22000 上拖动或调整窗口大小时性能差；`blur` 限 Windows 7、10、11（22H1），在 Windows 11 build 22621 上同样性能差。`WindowEffectsConfig` 中互相冲突的效果只应用第一个；`color` 只在 Windows 10 v1903 及以上对 `blur`、`acrylic` 生效，对 Windows 11 无效。`WindowConfig.windowEffects` 要求窗口透明，Linux 不支持；Windows 上 `noRedirectionBitmap` 可以避免创建透明窗口时的白色闪烁。
  - 用于：[adaptation.md](../adaptation.md) 第三节。可信度：已核实（页面原文）。

Windows 对 Mica 与亚克力的规定见上文的 WIN1、WIN2，[adaptation.md](../adaptation.md) 3.3 节据此编写。

## 三、Glance

仓库 https://github.com/lulu-loopp/glance ，分析版本为提交 `7c312d1`（2026-11-02），版本 0.4.3。只读源码与仓库中的官方截图，没有运行程序，原因见 [glance-analysis.md](./glance-analysis.md)「来源与方法」。SOURCE 为源码中的常量与注释，OBSERVED 为截图中看到的效果，INFERRED 为推断。

| 编号 | 结论 | 等级 | 出处 | 用于 |
| --- | --- | --- | --- | --- |
| GL1 | 三种外观：记录纸是贴着屏幕边缘的一整块记录纸，Windows 11 是一张亚克力，磨砂玻璃是分开的透明玻璃块 | SOURCE | `src/ui/theme.rs:8-12` | 记录纸、Windows 11、磨砂玻璃三套主题 |
| GL2 | 三种外观的版式相同，只换材质、圆角与配色 | OBSERVED | `docs/images/looks-zh.webp` | 五套主题共用一套结构 |
| GL3 | 只在有意义时用颜色：整块面板一种墨色，过热时才出现信号色 | SOURCE | `theme.rs:173-174` | 强调色只用于选中、焦点与主要操作 |
| GL4 | 内容靠标题和留白分组，而不是方框 | SOURCE | `theme.rs:246-249` | 标题区、页签与底栏少用边框 |
| GL5 | 背景越杂乱磨得越砂；磨砂程度按背景实时计算 | SOURCE | `theme.rs:317-320`、`skins.rs:56-63` | 按最差背景检查对比度 |
| GL6 | 玻璃边缘顶部受光、底部带一点反光；四周都亮像一根金属管 | SOURCE | `skins.rs:595-596` | 磨砂玻璃的受光 |
| GL7 | Windows 11 外观去掉亚克力的颗粒，因为深色面板上像噪点 | SOURCE | `skins.rs:492-495` | Windows 11 主题不加噪点 |
| GL8 | 三种外观的颜色 | SOURCE | `theme.rs:177-181`、`254-307`、`323-397` | 三套主题的颜色令牌 |
| GL9 | 字体与字号 | SOURCE | `theme.rs:197-203`、`267-273`、`351-357` | 三套主题的字体令牌 |
| GL10 | 间距、底栏高度、离屏幕边缘的距离 | SOURCE | `theme.rs:204-224`、`274-301`、`358-385` | 三套主题的布局令牌 |
| GL11 | 圆角、描边、阴影与模糊（Windows 11 外观模糊 30、饱和度 1.25） | SOURCE | `theme.rs:217-222`、`287-299`、`371-383`；`skins.rs:49-54`、`539-540` | `--sn-panel-blur`、`--sn-panel-saturate` 等 |
| GL12 | 动效的时长与曲线 | SOURCE | `settings_window.rs:146-149`、`1423-1424`；`look.rs:159-172`；`genie.rs:23` | 动效令牌 |
| GL13 | 菜单尺寸与 Windows 11 的菜单一致：行高 32、圆角 8 | SOURCE | `menu.rs:78-92` | Windows 11 主题的菜单 |
| GL14 | 官方截图由程序自己在屏幕外逐帧绘制 | SOURCE | `README.zh-CN.md:131` | 截图的可信度 |
| GL15 | 许可证为 MIT；内置的 Inter、Archivo 为 SIL OFL 1.1；图标取自 Lucide（ISC） | SOURCE | `LICENSE`、`licenses/` | 字体能否随应用打包 |
| GL16 | 现有 SideNotes 的纸张、玻璃、Win11 三种材质与 Glance 的三种外观一一对应 | INFERRED | — | 三套主题沿用同名的设置取值 |

## 四、现有应用

规范中标为「现有」的行为，以原仓库 `claude` 分支的 `3a7ac02`（0.7.3）为准：

| 事实 | 出处 | 用于 |
| --- | --- | --- |
| 可重新绑定的命令与默认按键、固定按键、Windows 保留的组合键 | `src/core/shortcuts.ts` | [interactions.md](../interactions.md) 第三节、[editing.md](../editing.md) 第六节 |
| 宽度 360 至 720（步长 4，默认 416）、字号 12 至 20（默认 16）、缩放为「字号 ÷ 13」、移出后收起 100 至 10000ms（默认 600）、出入动画 0 至 600ms（默认 260）、卡片高度 120 至 600（默认 220）；明暗默认浅色；`surface` 取值与默认值 `standard` | `src/core/settings.ts` | [layout.md](../layout.md) 第一节、[adaptation.md](../adaptation.md) 第八节 |
| 三个窗口的尺寸、最小尺寸，都不透明 | `src-tauri/tauri.conf.json` | [layout.md](../layout.md) 第一节、[adaptation.md](../adaptation.md) 第一节 |
| 唤出侧栏时激活窗口；从屏幕外逐帧移动窗口滑入；高度取屏幕工作区 | `src-tauri/src/windows.rs` 的 `show_sidebar`、`work_area` | [adaptation.md](../adaptation.md) 3.4 节、[layout.md](../layout.md) 第一节 |
| Esc 的逐级退出；保持展开的条件 | `src/components/Sidebar.tsx` | [interactions.md](../interactions.md) 第一节、3.4 节 |
| 长按 300ms 开始拖动、停在页签上 240ms 切换、框选、已有多选时单击切换、Ctrl+A、拖动中 Esc 取消 | `src/hooks/useCardInteractions.ts` | [interactions.md](../interactions.md) 第二、四节 |
| 提示条最多三条，普通 6 秒、带操作 9 秒；复制提示的文字 | `src/hooks/useToast.tsx`、`src/components/Sidebar.tsx` | [interactions.md](../interactions.md) 第七节 |
| 图片缩略图最高 150px | `src/styles/prototype.css` | Playground 的 `content.css` |

## 五、未能核实

- **m3.material.io**：`styles/motion/easing-and-duration/tokens-specs`、`foundations/interaction/states/state-layers`、`styles/shape/corner-radius-scale`、`styles/typography/type-scale-tokens` 由脚本渲染，`curl` 只取到标题。数值改从 material-web 读取（MD1 至 MD10）；Material 3 的密度、各档时长适用于哪类元素、菜单项高度、弹窗与提示条的规范没有核实。
- **Windows 的控件尺寸与密度**：原地址 `design/style/spacing` 重定向到 content-basics（WIN6），新页面只有间距，没有标准与紧凑两种密度的控件高度；WinUI 控件与菜单项的具体高度未核实（Glance 记录的菜单行高 32 不是微软的页面）。
- **Windows 焦点视觉的旧页**：`design/input/guidelines-for-visualfocus` 与 `develop/input/guidelines-for-visualfocus` 都返回 404，焦点框改读 WIN13 与 WIN14。
- **Windows 11 主题原来的退出缓动** `cubic-bezier(0.7, 0, 1, 0.5)`：在 FL13 与 WIN7、WIN8 中都没有找到出处，已改为 WIN7、WIN8 的柔和退出 `(1, 0, 1, 1)`。
- **亚克力的具体参数**：WIN2 只列出组成（背景、模糊、排除混合、着色、噪点），没有底色、不透明度与模糊半径；Windows 11 主题的 `--sn-panel-blur`（30px）与 `--sn-panel-saturate`（1.25）取自 Glance，不是微软给出的数值。
- **Windows 文本框聚焦时的底部强调线**：WIN16 没有写这一细节，Windows 11 主题 `--sn-color-editor-underline` 的依据未核实。
- **Segoe UI Variable 的命名字体**：WIN4 只说明 CSS 中指定 Segoe UI Variable 时光学尺寸自动调整；'Segoe UI Variable Text' 等命名字体在 WebView2 中是否同样调整，需要实测。
- **Fluent 圆角以哪套为准**：设计站点（FL4）的 Large 8、X-Large 12 与代码令牌（FL14）的 Large 6、XLarge 8 不一致，两处原文都已核实，现行标准是哪一套无法判断。
- **Fluent 阴影的第二层参数**：FL5 的公式附在图示旁，抽取出的文字中浅色两层参数相同，第二层的确切参数未核实；reference-matrix.md 只引用第一层的不透明度与 FL15 的几何。
- **Apple HIG**：没有给出动效时长、缓动、圆角与间距阶梯；Alerts、Sheets、Popovers 等页面没有读取，弹窗与提示条一栏为未核实。
- **Radix**：Primitives 不规定尺寸、颜色与动效；Alpha 色阶只读到名称（RX6），用途没有读到；焦点环用第 7 级还是第 8 级，RX5 前后说法不一。
- **shadcn/ui**：Theming 页面没有对比度要求。
- **WCAG**：读到的条款没有规定半透明表面的对比度怎样计算，也没有直接规定输入光标的对比度；reference-matrix.md 中相应的做法都标为推断。
- **圆角与命中区域**：浏览器是否按 `border-radius` 裁切命中区域，没有读取 CSS 规范核实；reference-matrix.md 第四节按 WCAG2 的圆角示例做的计算标为推断。
- **仓库版本**：fluentui 取自 `master` 分支，material-web 取自 `main` 分支；读取时 GitHub 接口限流，没有记录提交号。
