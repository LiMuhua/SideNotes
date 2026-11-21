# 平台适配

本文说明五套主题在 Windows、Linux、Android 上的实现条件：字体、半透明材质、透明窗口、缩放、明暗与高对比度、从现有设置迁移的规则，以及应用图标的更换。现有应用的情况取自 0.7.3 的源码，Tauri 与 Windows 的说法取自官方文档，出处见 [references/source-evidence.md](./references/source-evidence.md)。

## 一、平台

| 平台 | 现状 | 本规范的要求 |
| --- | --- | --- |
| Windows 10、11 | 主要平台；WebView2 渲染；三个窗口都不透明（`transparent: false`） | 五套主题全部可用；两套半透明主题依赖窗口材质，条件见第三节 |
| Linux | 代码有退路，没有构建与界面的验证记录 | 三套实心主题可用；两套半透明主题退回不透明的颜色 |
| Android | 只生成了启动图标，没有界面；全局快捷键在移动端排除 | 按 [layout.md](./layout.md) 第七节的手机形态；不显示快捷键 |

## 二、字体

| 主题 | 界面与正文 | 标题 | 代码 | 是否随应用打包 |
| --- | --- | --- | --- | --- |
| 终端 | Maple Mono NF CN | 同左 | 同左 | 已打包（SIL OFL 1.1，现有） |
| 杂志 | Segoe UI Variable Text、Segoe UI、微软雅黑 UI | Georgia、Noto Serif SC，最后回落到宋体 | Maple Mono NF CN 等 | 否，使用系统字体 |
| 记录纸 | Archivo，回落到 Segoe UI Variable 等 | 同左 | Cascadia Mono 等 | 否 |
| Windows 11 | Segoe UI Variable Text | Segoe UI Variable Display | Cascadia Mono 等 | 否，系统字体 |
| 磨砂玻璃 | Inter，回落到 Segoe UI Variable 等 | 同左 | Cascadia Mono 等 | 否 |

规则：

- 每个字体栈都以各平台的系统字体收尾：Windows 是 Segoe UI 与微软雅黑 UI，Linux 是 Noto Sans、Noto Sans CJK SC 等，Android 是 Roboto 与系统的中文字体。没有打包的字体缺失时，界面照常可用，只是观感与设计稿有差距。
- Segoe UI Variable 只有 Windows 11 自带；Windows 10 回落到 Segoe UI。
- Archivo 与 Inter 都以 SIL OFL 1.1 发布，可以随应用打包，代价是安装包变大；是否打包待定，见 [design-decisions.md](./design-decisions.md)。
- 中文衬线字体在多数 Windows 上要回落到宋体，屏幕显示效果一般；杂志的标题如果要稳定，需要打包中文衬线字体并确认许可。

**字体设置与主题（本次提出）。** 现有设置中的「字体」作用于全部界面文字，默认是 Maple Mono NF CN。五套主题各有字体后，规则改为：

1. 「字体」增加「跟随主题」一项，并作为默认值。
2. 选了具体字体时，只替换界面与正文的字体（`--sn-font-ui`、`--sn-font-note`）；标题与代码的字体仍跟随主题，主题把标题设为界面字体的（终端、记录纸、磨砂玻璃），标题随之替换。
3. 迁移时，字体等于旧默认值 Maple Mono NF CN 的改为「跟随主题」，其余取值保留。终端主题本身使用 Maple Mono NF CN，所以默认用户的观感不变。

Playground 已按这条规则接入：「字体」是可以输入筛选的组合框，默认「跟随主题」；选了具体字体时，三个窗口的界面与正文换成这个字体，「系统默认」换成 Segoe UI 与微软雅黑 UI（与现有应用的 `resolveFontFamily` 相同）。本机没有安装的字体回落到微软雅黑 UI。

## 三、半透明材质

### 3.1 为什么需要窗口材质

CSS 的 `backdrop-filter` 只能模糊同一个窗口里、元素背后的内容。要透出桌面与后面的窗口，需要两步：窗口改为透明（`transparent: true`），再由系统给窗口加材质（Tauri 的 `windowEffects`）。Playground 用模拟的桌面壁纸代替真实桌面，所以 Playground 中的磨砂效果不能说明真实窗口的观感。

### 3.2 Tauri 提供的窗口材质

以下取自 Tauri 2 的配置参考（`WindowEffect`、`WindowEffectsConfig`、`WindowConfig`）：

| 效果 | 适用的系统 | 说明 |
| --- | --- | --- |
| `mica`、`micaLight`、`micaDark` | 只限 Windows 11 | Mica，跟随系统明暗，或固定为浅色、深色 |
| `tabbed`、`tabbedLight`、`tabbedDark` | 只限 Windows 11 | Mica 的变体 |
| `acrylic` | Windows 10、11 | 在 Windows 10 v1903 及以上、Windows 11 build 22000 上，拖动或调整窗口大小时性能差 |
| `blur` | Windows 7、10、11（22H1） | 在 Windows 11 build 22621 上，拖动或调整窗口大小时性能差 |

- `windowEffects` 要求窗口透明；Linux 不支持。
- 同时给出几个互相冲突的效果时，只应用第一个。
- 着色（`color`）只在 Windows 10 v1903 及以上对 `blur` 与 `acrylic` 生效，在 Windows 11 上无效。
- Windows 上创建透明窗口时，`noRedirectionBitmap` 可以避免窗口出现时的白色闪烁。

### 3.3 Windows 对材质的规定

以下取自 Microsoft Learn 的 Acrylic 与 Mica 两篇设计文档：

| 项目 | Acrylic（背景亚克力） | Mica |
| --- | --- | --- |
| 透出什么 | 桌面壁纸与后面的窗口 | 只有桌面壁纸，材质本身不透明 |
| 建议用于 | 菜单、浮出控件、非模态弹出层、点别处即消失的窗格 | 应用窗口的底层 |
| 退回纯色 | 关闭「透明效果」、节电模式、低端硬件；窗口失去激活时 | 同左；另外 Windows 版本低于 22000 时 |
| 其它 | 不建议在亚克力上放强调色的文字，默认 14px 字号下往往达不到对比度要求 | 只取一次壁纸，性能好 |

### 3.4 本规范的做法（本次提出）

| 主题 | Windows 11 | Windows 10 | Linux、Android，或材质退回纯色时 |
| --- | --- | --- | --- |
| Windows 11 | 透明窗口加 `acrylic` | 透明窗口加 `acrylic` | 不透明的面板与卡片颜色（尚未提供） |
| 磨砂玻璃 | 透明窗口加 `acrylic` | 透明窗口加 `acrylic` | 同上 |
| 杂志 | 透明窗口，不加材质 | 同左 | 面板与屏幕边缘之间的留白画成面板底色，浮动的效果消失 |
| 终端、记录纸 | 不透明窗口 | 同左 | 同左 |

上表是侧栏的做法，速记浮窗相同。设置窗口是长期打开的窗口，五套主题都保持不透明；以后如果要用材质，应选 Mica 而不是亚克力（见 [references/reference-matrix.md](./references/reference-matrix.md) 第二节）。

理由与限制：

- 侧栏移开即收起，属于微软建议使用背景亚克力的「点别处即消失的窗格」；Mica 透不出后面的窗口，侧栏下面正在工作的窗口看不到，不符合「不打断当前工作」的定位。
- 现有应用唤出侧栏时会激活侧栏窗口（`src-tauri/src/windows.rs` 的 `show_sidebar`），点到侧栏之外即收起，所以侧栏显示期间通常处于激活状态。例外是固定侧栏后回到其他程序工作：侧栏失去激活，背景亚克力退回纯色。
- 侧栏的滑入滑出由后端逐帧移动窗口完成，拖动调宽是调整窗口大小，正好落在 Acrylic「性能差」的说明范围内，需要实测。
- 系统关闭透明效果或进入节电模式时，材质由系统换成纯色，界面也要换成不透明的颜色，否则半透明的卡片叠在纯色上，对比度没有经过检查。可以由后端读取系统的透明效果开关（注册表的 `EnableTransparency`）与节电状态，通知前端切换。
- 强调色文字放在亚克力上，与微软的建议不符。Windows 11 主题的置顶标记、标签悬停等处用了强调色，实现时改为文字色，或放在不透明的底上。

## 四、透明窗口与屏幕边缘

浮动面板与分开的玻璃块离开屏幕边缘一段距离（杂志、磨砂玻璃 10px，Windows 11 8px；记录纸贴住侧边，只离开上下 10px）。侧栏窗口仍然贴住屏幕边缘，这段距离是窗口内的留白：

- 窗口透明时，留白透出桌面，面板看起来浮在桌面上。
- 窗口不透明时，留白只能画成实色，与贴边整块没有区别。
- 窗口的宽度包括留白，设置中的「宽度」仍是整个窗口的宽度，面板实际宽度少一段留白。
- 鼠标移到屏幕边缘唤出侧栏后，面板与屏幕边缘之间有一条缝；这条缝属于侧栏窗口，指针停在缝里不会让侧栏收起（Playground 如此模拟，真实窗口需要实测）。
- 透明窗口里的面板不画大投影：窗口只比面板大出留白的一圈，投影在窗口里只剩面板旁边的一小段、又被窗口边切断（桌面端第十轮反馈：杂志的侧栏底下多出一条暗带）。

## 五、缩放

现有应用按「字号 ÷ 13」缩放整个 WebView（后端命令 `set_ui_zoom`），Playground 用 CSS 的 `zoom` 模拟，两者效果相同。令牌中的像素值都是缩放前的值，见 [layout.md](./layout.md) 第一节。

## 六、明暗模式

- 明暗模式与主题分开设置：浅色、深色、跟随系统，五套主题各有浅色与深色两组颜色。取值方式是在窗口根元素上写 `data-sn-surface` 与 `data-sn-theme` 两个属性，见 [design-tokens.md](./design-tokens.md) 第二节。
- 现有应用的「跟随系统」只在设置变化时判断一次，系统切换明暗后要等下一次设置变化才生效（`resolveTheme`）。本次提出：监听 `matchMedia('(prefers-color-scheme: dark)')` 的变化，三个窗口立即切换。
- 现有的默认值是浅色，本规范不改。

## 七、高对比度

Windows 开启对比主题后，WebView2 进入强制颜色模式（`forced-colors: active`）：作者写的颜色换成系统颜色，阴影与背景渐变被去掉。对 SideNotes 的影响：

| 部位 | 影响 | 处理（待实现） |
| --- | --- | --- |
| 焦点环 | 用 `outline` 绘制，颜色换成系统颜色，仍然可见 | 不需要处理 |
| 输入类控件与菜单项的焦点 | 底边的强调线与选中色画在背景层里，会被去掉 | 已处理：改用 2px 的 `Highlight` 轮廓线 |
| 悬停与按下 | 用背景图层叠加，会被去掉 | 悬停时加 1px 的 `Highlight` 边框 |
| 选中、多选与编辑中的卡片 | 外圈阴影、编辑底色与投影被去掉，强调色边框换成系统颜色，与默认状态分不开 | 用 2px 的 `Highlight` 轮廓线区分；编辑中的卡片平时不用强调色边框，对比主题下例外 |
| 半透明主题 | 磨砂与受光失效 | 不使用 `backdrop-filter`，Mica 与 Acrylic 由系统显示用户选择的背景色 |

## 八、从现有设置迁移

| 设置 | 现有取值 | 迁移后 |
| --- | --- | --- |
| `surface`（界面材质，改称「主题」） | `standard`、`paper`、`glass`、`win11`，默认 `standard` | `terminal`、`magazine`、`paper`、`win11`、`glass`，默认 `terminal`；`standard` 改为 `terminal`，其余三个沿用同名取值，外观换成新的样式；无法识别的取值按默认处理 |
| `theme`（明暗模式） | `light`、`dark`、`system` | 不变 |
| `fontFamily`（字体） | 任意字体名，默认 Maple Mono NF CN | 增加「跟随主题」，规则见第二节 |
| `appIcon`（应用图标，新增） | — | 默认 `door-smile-indigo`（211），规则见第十节 |
| 其余设置 | — | 不变；数据模型不变 |

迁移随设置的结构版本（`SETTINGS_VERSION`）从 2 升到 3 一次完成，读取设置时由 `normalizeSettings` 统一处理。

## 九、从 Glance 到 WebView

记录纸、Windows 11、磨砂玻璃三套主题取自 Glance 的三种外观（见 [references/glance-analysis.md](./references/glance-analysis.md)）。Glance 用 Direct2D 与 DirectComposition 原生绘制，SideNotes 用 WebView，做法有以下差别：

| Glance 的做法 | SideNotes 的做法 |
| --- | --- |
| 截取桌面画面，按背景的亮度与杂乱程度实时调整磨砂 | 磨砂程度固定，按纯黑与纯白两种最差背景检查对比度 |
| 玻璃边缘顶部受光、底部反光 | 用渐变边框（`--sn-color-rim-top` 到 `--sn-color-rim-bottom`）与顶部光泽（`--sn-color-sheen`）表现 |
| 文字带一圈光晕，保证在杂乱背景上可读 | `--sn-color-halo` 的文字阴影 |
| 可以按桌面背景的亮度自动切换明暗 | 不做：WebView 读不到桌面画面 |
| 内置 Archivo 与 Inter 字体 | 尚未打包，回落到系统字体 |
| 只支持 Windows | 覆盖 Windows、Linux、Android，半透明主题在 Linux 与 Android 上退回不透明的颜色 |

## 十、应用图标

设计见 [components.md](./components.md) 第七节。桌面应用尚未实现切换，下面是实现时的做法（本次提出）。

**资源**：内置图标在 `src-tauri/icons/builtin/<编号>-<id>/`，有 `icon.svg`、`icon.ico` 与 `png/<尺寸>.png`，清单是 `manifest.json`；`tauri.conf.json` 的 `bundle.resources` 把整个目录打包到安装目录的 `app-icons/`，运行时用 `resolveResource('app-icons/...')` 取得路径。默认图标同时是 `src-tauri/icons/` 中的桌面图标。改了母版或清单后运行 `pnpm icons` 重新生成；`docs/design-system/tests/app-icons.test.ts` 检查资源齐全、尺寸正确。

**设置**：新增 `appIcon`，取值为内置图标的 id，或 `custom` 表示使用上传的图片；默认 `door-smile-indigo`。取值在清单中找不到时（例如以后删掉了某个图标）按默认处理。

**上传的图片**：裁好后保存到应用数据目录的 `app-icon/custom.png`（512 × 512），并按清单的 ICO 尺寸生成 `custom.ico`；移除时删除这两个文件。图片只在本机，不进入导出备份。

**各处的图标**：

| 位置 | 图标来源 | 更换后 |
| --- | --- | --- |
| 窗口图标、设置窗口的任务栏按钮 | 窗口的 `set_icon` | 立即生效。按当前缩放比例从 PNG 中取最接近的尺寸 |
| 托盘 | 托盘的 `set_icon`（现在用 `default_window_icon`） | 立即生效。Windows 托盘按 16px 乘以缩放比例取图 |
| 关于页、各窗口的品牌标记 | 前端按设置显示 | 立即生效 |
| 开始菜单与桌面快捷方式 | 安装时指向 exe 的图标 | 把快捷方式的图标位置改到 `app-icons/<目录>/icon.ico` 或 `custom.ico`；资源管理器可能要等图标缓存刷新 |
| exe 文件、安装程序 | 打包时的默认图标 | 不变 |
| Linux 程序坞与应用列表 | 打包时 `.desktop` 文件的图标 | 只能换窗口图标，程序坞是否跟随取决于桌面环境 |
| Android 启动图标 | 打包时的 mipmap | 不变：运行时更换需要为每个图标准备 activity-alias，暂不做 |
