# 参考产品研究

本文记录 SideNotes 参考的成熟产品：从每个产品研究了什么、依据是什么、可以借鉴什么、不应照搬什么。主要视觉参考 Glance 单独分析，见 [glance-analysis.md](./glance-analysis.md)；官方设计规范见 [reference-matrix.md](./reference-matrix.md)。

调研时的定位是「个人片段库」。2026-11-05 用户确认 SideNotes 是贴边的速记侧栏，目的是不打断当前工作、随手记下碎片想法，片段管理不是重点（见 [sidenote-current-state.md](./sidenote-current-state.md)）。各产品一节记录的事实仍然有效，其中「参考价值」是按旧定位写的判断；以文末按新定位改写的「综合结论」为准。

## 调研方法

- 只采用官方来源：产品页、官方文档、官方博客与官方仓库。每条事实都标注来源编号。
- 网页抓取工具无法访问这些域名，改用 `curl` 读取页面原文。Obsidian 帮助站改为 JS 渲染后，正文改从官方仓库 `obsidianmd/obsidian-help` 的 Markdown 原文读取。Linear 没有快捷键总表（`/docs/keyboard-shortcuts` 返回 404），快捷键取自各功能文档页。
- 没有阅读这些产品的源码，所以本文没有 SOURCE 级证据。
- 证据等级：**OFFICIAL** 为官方文档或博客；**OBSERVED** 为在官方页面上看到的内容；**INFERRED** 为推断。各节的「参考价值」与「不照搬」都是本项目的判断，属于 INFERRED。

## 总览

| 产品 | 类型 | 平台 | 官方设计规范 | 源码 | 官方截图 | 主要参考方向 |
| --- | --- | --- | --- | --- | --- | --- |
| SnippetsLab | 片段管理器 | macOS | 无 | 闭源 | 有 | 信息架构、搜索与片段结构 |
| Linear | 项目管理 | 桌面（Electron）与网页 | 只有品牌规范 | 应用闭源，SDK 开源 | 有 | 视觉层级、颜色生成、键盘模型 |
| Raycast | 启动器 | macOS、Windows | 扩展开发指南 | 扩展仓库开源 | 有 | 列表与详情、动作面板、模板占位符 |
| Obsidian | 知识管理 | 桌面与移动端 | 公开的 CSS 变量参考 | 闭源 | 有 | 文件夹与标签、命令面板、令牌分层 |
| Paste | 剪贴板管理 | macOS、iOS | 无 | 闭源 | 有 | 内容类型预览、收藏集合 |
| Pasta | 剪贴板管理 | macOS | 无 | 闭源 | 仅商店截图 | 类型增强显示（参考权重低） |

## SnippetsLab

**来源**

- S1 产品页：https://www.renfei.org/snippets-lab/
- 用户手册，前缀 `https://www.renfei.org/snippets-lab/manual/mac/`：S2 `essentials.html`、S3 `assistant.html`、S4 `advanced.html`、S5 `themes.html`、S6 `import-and-export.html`、S7 `sync-and-backup.html`、S8 `keyboard-shortcuts.html`

**基本情况**：免费、无广告，只支持 macOS（14.6 及以上），最新版本 2.7.1（S1，OFFICIAL）。没有公开的设计规范，也没有源码（INFERRED）。产品页有落地页与 14 张主题截图，手册每项功能都配浅色与深色截图（OBSERVED）。

**研究内容**

- **分类体系**：嵌套文件夹，未归类的片段进入「未分类」；标签可多选、可设颜色，大小写不敏感但保留原写法；智能组按文件夹、标签、语言、日期等规则自动聚合，规则可以嵌套；收藏可以收藏文件夹、标签与智能组；回收站只在非空时出现在侧栏；列表默认包含子文件夹中的片段（S2，OFFICIAL）。
- **片段结构**：一个片段可以有多个分片（fragment），每个分片有自己的语言、备注与内容；备注显示在列表中，但复制时不包含；分片以页签显示，Cmd+1–9 切换；片段可以置顶与锁定（S2，OFFICIAL）。
- **修改时间**：只有标题、内容、备注、分片或附件变化才更新；改标签、语言、文件夹或置顶不更新（S2，OFFICIAL）。
- **布局**：Ctrl+1/2/3/4 分别把焦点移到侧栏、片段列表、编辑器与预览（S8，OFFICIAL），由此推断是三栏加可选的 Markdown 预览（INFERRED）。
- **语言**：600 多种语言的语法高亮；本地模型自动识别 50 种常见语言；可以只显示常用语言；每个文件夹可以设默认语言（S1、S2、S4，OFFICIAL）。
- **搜索**：Shift+Cmd+F 全局搜索；可以切换只搜标题或全文、模糊匹配、区分大小写与排序；输入 `in:` 弹出过滤菜单，按文件夹、标签、语言叠加条件；关闭模糊匹配后支持与、或、非、通配符与短语（S2，OFFICIAL）。
- **快捷操作**：Shift+Cmd+A 打开命令面板，模糊匹配、支持拼音，只列出当前可用的命令；最后一项固定为「在片段库中搜索……」，命令查不到时直接转为全库搜索（S4，OFFICIAL）。
- **菜单栏助手**：浏览与新建两种模式；Return 复制，Option+Return 在主窗口打开（S3，OFFICIAL）。
- **主题**：内置 18 套，默认跟随系统，浅色与深色可分别指定；语法颜色按 Pygments 的记号层级继承；没有设置的界面颜色由背景色等自动推算（S1、S5，OFFICIAL）。
- **数据**：iCloud 同步；自动备份按 20 分钟、小时、日、周、月分级保留；支持从多种工具导入，导出为 JSON、XML 或纯文本（S6、S7，OFFICIAL）。

**参考价值**：SnippetsLab 是最完整的片段库信息架构范本：文件夹、彩色标签、智能组（保存的搜索）、收藏、置顶与回收站，可以分期引入。「备注不进入复制内容」「改元数据不更新修改时间」两条规则可以直接采用。搜索框中的过滤记号（`in:`）、命令查不到时转入全库搜索、拼音搜索，都适合中文用户。

**不照搬**：菜单栏助手、系统服务、SF Symbols 等 macOS 专属能力；600 种语言、主题编辑器、Gist 发布与 AI 集成超出当前需求；多分片模型会显著增加编辑器与数据模型的复杂度，单独评估。

## Linear

**来源**

- L1 博客：How we redesigned the Linear UI (part Ⅱ)，2024-03-28，https://linear.app/now/how-we-redesigned-the-linear-ui
- L2 博客：A calmer interface for a product in motion，2026-03-12，https://linear.app/now/behind-the-latest-design-refresh
- 文档：L3 https://linear.app/docs/account-preferences ，L4 https://linear.app/docs/search ，L5 https://linear.app/docs/display-options ，L6 https://linear.app/docs/select-issues
- L7 品牌规范：https://linear.app/brand
- L8 官方仓库：https://github.com/linear/linear

**基本情况**：公开的只有品牌规范（命名、标志、两种品牌色），并明确禁止在其它产品中使用这些素材（L7，OFFICIAL）。官方仓库是 MIT 许可的 SDK 与插件（L8，OFFICIAL），应用本身闭源（INFERRED）。两篇博客有大量改版前后的对比截图（OBSERVED）。

**研究内容**

- **主题生成**：主题生成从 HSL 改为 LCH 颜色空间；每套主题原本要定义 98 个变量，现在只需要基础色、强调色与对比度三个输入；对比度输入可以自动生成高对比度主题；背景、前景、面板、对话框等层级的表面都在 LCH 中推算；降低了强调色在颜色计算中的占比，浅色模式文字更深、深色模式文字更浅（L1，OFFICIAL）。
- **字体**：标题用 Inter Display，其余用 Inter（L1，OFFICIAL）。
- **层级原则**：2024 年改版的目标是减少视觉噪音、保持对齐、提高导航的层级与密度（L1）。2026 年的刷新提出两条原则：「不要争夺还没赢得的注意力」，侧栏调暗几档，让内容区更突出；「结构应当被感觉到，而不是被看到」，减少分隔线并降低边框对比度。同时缩小页签与图标，去掉团队图标的彩色底（L2，OFFICIAL）。
- **配色**：默认主题从偏冷的蓝灰改为更暖、饱和度更低的灰；内部工具可以调整单个令牌的色相、彩度与明度（L2，OFFICIAL）。
- **桌面形态**：基于 Electron，导航既要在 macOS 与 Windows 上像原生应用，也要能在浏览器中使用（L1，OFFICIAL）。
- **偏好**：可调字号、交互元素可用手形指针、链接可加下划线、主题可跟随系统（L3，OFFICIAL）。
- **键盘模型**：`/` 搜索，Ctrl+F 在当前视图中过滤；命令菜单中先输入类型字母与空格可以限定结果类型；上下方向键或 J、K 移动，X 选中，Shift+方向键扩选，Esc 清除；选中后 Ctrl+K 打开针对选中项的命令菜单，也可以右键（L4、L6，OFFICIAL）。
- **显示选项与过滤器分开**：显示选项只决定显示哪些字段、如何分组排序，不减少条目；过滤器才缩小结果（L5，OFFICIAL）。文档把同一操作的键盘、鼠标与命令菜单三种方式并列（OBSERVED）。

**参考价值**：「少量输入、在感知均匀的颜色空间中推算全部令牌」可以低成本覆盖浅色、深色与高对比度；「侧栏退后、内容突出、少用边框」正适合以内容为中心的片段库；「先选中，再用 Ctrl+K 执行针对选中项的命令」，以及每个操作都有键盘、鼠标、命令三种入口。

**不照搬**：团队、周期、看板等项目管理的信息结构；大量字母序列快捷键（Android 上不可用，学习成本高）；Linear 的品牌素材与整体外观。

## Raycast

**来源**

- 开发者文档（页面地址后加 `.md` 可取原文）：R1 https://developers.raycast.com/api-reference/user-interface/list ，R2 `.../action-panel`，R3 `.../actions`，R4 https://developers.raycast.com/api-reference/feedback/toast ，R5 `.../hud`，R6 同目录的 `grid`、`detail`、`form`
- 用户手册：R7 https://manual.raycast.com/action-panel ，R8 https://manual.raycast.com/snippets ，R9 https://manual.raycast.com/dynamic-placeholders ，R10 https://manual.raycast.com/themes
- R11 扩展仓库：https://github.com/raycast/extensions

**基本情况**：只有面向扩展开发者的指南，使用内置动作即可「遵循我们的人机界面指南」（R3，OFFICIAL）。扩展仓库以 MIT 许可开源（R11，OFFICIAL），主程序闭源（INFERRED）。文档有组件示意截图（OBSERVED）。

**研究内容**

- **列表**：搜索栏默认对标题与关键词模糊匹配；条目可以分组；加载时搜索栏下方显示进度条；搜索栏右侧可放一个下拉框作为第二个过滤维度（R1，OFFICIAL）。
- **列表项**：标题、副标题、图标；右侧附加信息可以是彩色标签或相对时间（如「1d」）；关键词字段提供额外的搜索索引（R1，OFFICIAL）。
- **列表加详情**：开启详情后右侧显示 Markdown 主体与元数据区；官方建议此时列表项不再显示附加信息，移到详情中（R1，OFFICIAL）。
- **空状态**：图标、标题、说明与操作；正在加载且搜索框为空时不显示空状态（R1，OFFICIAL）。
- **表单校验**：失焦时校验并显示错误，用户修改时清除错误（R6，OFFICIAL）。
- **动作面板**：第一、第二个动作自动成为主操作与次操作，在列表中为 ↵ 与 ⌘↵；⌘K 打开完整面板，顶部可搜索，每个动作右侧显示快捷键，Esc 关闭或返回（R2、R7，OFFICIAL）。
- **内置动作**：复制后关闭主窗口并显示 HUD；危险操作使用 Destructive 样式，不可撤销的操作先确认（R3，OFFICIAL）。
- **反馈**：提示条有成功、失败、进行中三种，可带取消、撤销等操作（R4，OFFICIAL）。
- **片段功能**：名称、正文（最多 65K 字符）、关键词与标签；关键词用于在任何应用中输入后自动展开；可按名称、关键词或内容搜索，按标签过滤，支持复制、粘贴、置顶、编辑、复制一份与删除（R8，OFFICIAL）。
- **动态占位符**：`{clipboard}`、`{cursor}`（每个片段一个）、`{date}`、`{time}`、`{uuid}`、`{argument}` 等；`{argument}` 最多 3 个，支持 `name`、`default`、`options`；修饰符用管道串联，如 `{clipboard | trim | uppercase}`；输入合法的占位符时花括号变蓝，无法识别时不加样式（R9，OFFICIAL）。
- **主题**：Pro 功能，可调背景、主文字与辅助色，浅色与深色分别指定，可以分享（R10，OFFICIAL）。

**参考价值**：最接近 SideNote 的交互骨架：搜索、列表、右侧详情；Enter 执行主操作（SideNote 中为复制），Ctrl+Enter 执行次操作，Ctrl+K 打开可搜索的动作面板。显示详情时把列表行的附加信息移入详情；模板占位符「合法即高亮」的编辑反馈；三种提示条与「危险操作要确认」。

**不照搬**：启动器模式（全局唤起、根搜索、执行后关闭窗口、HUD）；系统级关键词自动展开（需要全局键盘监听与额外权限，Android 难以实现）；`{selection}`、浏览器页签与 AI 相关的占位符。所有 ⌘ 快捷键映射为 Ctrl。

## Obsidian

**来源**

- O1 帮助站：https://obsidian.md/help/plugins/file-explorer （JS 渲染，正文改读 O2）
- O2 帮助文档原文，前缀 `https://raw.githubusercontent.com/obsidianmd/obsidian-help/HEAD/en/`：`Plugins/File explorer.md`、`Editing and formatting/Tags.md`、`Plugins/Tags view.md`、`Plugins/Bookmarks.md`、`Editing and formatting/Properties.md`、`Plugins/Command palette.md`、`Plugins/Quick switcher.md`、`User interface/Tabs.md`、`User interface/Appearance.md`
- O3 CSS 变量参考：https://docs.obsidian.md/Reference/CSS+variables/Foundations/Colors ，及同目录的 `Spacing`、`Typography`
- O4 API 类型定义：https://github.com/obsidianmd/obsidian-api

**基本情况**：没有成文的设计规范，但官方 CSS 变量参考实际上是一份公开的设计令牌规范（O3，OFFICIAL）。应用闭源（INFERRED），API 类型定义为 MIT 许可（O4，OFFICIAL）。帮助仓库中有界面截图（OBSERVED）。

**研究内容**

- **文件浏览器**：新建、重命名、删除、拖动移动；按名称、修改时间或创建时间排序；可以在树中定位当前文件、一键全部展开或折叠；Alt+点击多选、Shift+点击连选（O2，OFFICIAL）。
- **标签**：正文中写 `#tag` 或写在 `tags` 属性中；用 `/` 表示嵌套，搜索父标签同时匹配子标签；大小写不敏感，按首次的写法显示；标签面板显示计数，可按名称或频次排序，在树形与平铺之间切换（O2，OFFICIAL）。
- **书签**：可以收藏文件、文件夹、搜索、标题与块，书签可以分组、拖动排序（O2，OFFICIAL）。
- **属性**：文件顶部的 YAML；类型有文本、列表、数字、复选框、日期、日期时间、标签；同名属性在整个库共用一种类型（O2，OFFICIAL）。
- **命令面板（Ctrl+P）**：模糊匹配；最近用过的命令排在最前；可以固定常用命令（O2，OFFICIAL）。
- **快速切换（Ctrl+O）**：按名称或别名模糊搜索；没有匹配时 Enter 直接新建，Shift+Enter 按输入原样新建，Ctrl+Enter 在新页签打开；输入为空时显示最近打开的笔记（O2，OFFICIAL）。
- **页签与外观**：Ctrl+T 新建页签，可以分屏与拖成独立窗口；内置浅色与深色，默认跟随系统（O2，OFFICIAL）。
- **颜色令牌**：基础色阶 `--color-base-00` 到 `--color-base-100`（浅色 00 为 `#ffffff`、100 为 `#222222`；深色 00 为 `#1c1c1c`、100 为 `#dadada`）；强调色由 `--accent-h/s/l` 三个值组成，用户可以修改；语义变量如 `--background-primary`、`--background-modifier-hover`、`--text-normal`、`--text-muted`、`--text-faint`、`--interactive-accent`；主题通过 `.theme-light`、`.theme-dark` 覆盖（O3，OFFICIAL）。
- **间距与字体**：4px 网格（`--size-4-1` 为 4px，`--size-4-2` 为 8px）；界面字号 12、13、15、20px，编辑器默认 16px；默认行高 1.5，树节点、搜索结果等紧凑位置 1.3（O3，OFFICIAL）。

**参考价值**：基础色阶、语义变量、组件变量三层令牌，加上根节点类名切换主题，可以直接用于 Light、Dark、System 三种模式；4px 网格、四档界面字号与紧凑行高可作为密度基准；「命令入口（Ctrl+P）与内容入口（Ctrl+O）分开」「没有匹配时 Enter 新建」适合快速新建片段；嵌套标签的规则与带计数的标签面板。

**不照搬**：「库就是 Markdown 文件夹」与 YAML 文件头：会污染代码片段的正文，元数据应与内容分开；复杂的分屏、独立窗口与插件生态；关系图与双向链接。

## Paste

**来源**

- P1 产品页：https://pasteapp.io/
- 帮助中心：P2 https://pasteapp.io/help/organize-with-pinboards ，P3 `.../search-and-filters`，P4 `.../quick-paste-with-numbered-shortcuts`，P5 `.../keyboard-shortcuts`，P6 `.../paste-on-mac`
- P7 App Store：https://apps.apple.com/us/app/paste-limitless-clipboard/id967805235

**基本情况**：只支持 Mac、iPhone 与 iPad（P1，OFFICIAL）。没有公开的设计规范，也不开源（INFERRED）。

**研究内容**

- **定位**：保存所有复制过的内容，跨设备同步，可以固定常用的片段、链接、颜色与模板（P1，OFFICIAL）。
- **Pinboard**：有名称与颜色，可以拖动排序；其中的内容不会过期；固定到收藏板的条目仍保留在历史中（P2，OFFICIAL）。
- **布局**：屏幕底部的横向条带，最新的在前；每个条目显示内容预览、来源应用与复制时间；拖动顶边调高度，变小后切换为紧凑模式（P6，OFFICIAL）。
- **预览与编辑**：空格键快速预览全文；Cmd+E 编辑后再粘贴（P6，OFFICIAL）。
- **搜索**：打开后直接输入即搜索；输入时在搜索框中建议过滤条件，可按内容类型、来源应用、日期与设备过滤，已生效的条件一直显示在搜索框中；全程可用键盘（P3、P6，OFFICIAL）。
- **快捷键**：Cmd+1–9 粘贴列表中的前九项；Shift+Return 以纯文本粘贴（P4、P5，OFFICIAL）。

**参考价值**：按内容类型显示预览与空格键快速预览，可借鉴到链接、JSON、Markdown 片段；带颜色的收藏集合；搜索框中的过滤记号与输入时的过滤建议；「以纯文本粘贴」对应 SideNotes 的「复制原文 / 复制渲染结果」。

**不照搬**：剪贴板历史模型（后台持续记录、以时间线为主结构、按期限清理），与 SideNote「不是剪贴板管理器」的定位冲突；屏幕底部横条与左右方向键导航，适合图片卡片，不适合代码与长文本；依赖辅助功能权限的自动粘贴。

## Pasta

任务说明中 Pasta 与 Paste 给出了同一个链接。核实结果：pasteapp.io 是 Paste 的官网，上面没有 Pasta；但确实存在一款独立的剪贴板应用。

- **来源**：PA1 App Store「Clipboard Manager - Pasta」https://apps.apple.com/us/app/clipboard-manager-pasta/id1438389787 （数据取自 Apple 接口 https://itunes.apple.com/lookup?id=1438389787 ）；PA2 开发者页面 https://applorium.com/project/clipboard-manager-pasta/
- **基本情况**：开发者 Applorium Ltd（伦敦），2019-01-17 上架，当前版本 1.5.10；免费下载，高级功能内购解锁（PA1，OFFICIAL）。没有设计规范、源码与帮助文档；商店与开发者页面各有 4 张截图（OBSERVED）。
- **研究内容**：按来源应用与内容类型过滤；收藏集合；遮蔽来自密码管理器的敏感内容并加密存储；网格界面；快速预览；对颜色值、日历事件、链接做增强显示（PA1，OFFICIAL）。
- **可信度**：官方信息前后矛盾（商店描述写「最多 10,000 条」，正文写「一千条」，开发者页面写「无限存储」），涉及容量的说法不引用（OBSERVED）。
- **参考价值**：只有「按类型增强显示」与「遮蔽敏感内容」两点，证据只有商店描述与营销页面，参考权重低。

## 综合结论

按贴边速记的定位重新取舍：

1. **键盘模型**：采用 Linear 与 Raycast 的「先选中，再操作」。SideNotes 已经是「选中即可 Ctrl+C」；本次提出卡片之间用 ↑ ↓ 移动、Enter 编辑、Delete 移入回收站，在 Playground 中标注为「本次提出」。Ctrl+K 动作面板不采用：编辑器里 Ctrl+K 已用于插入链接。
2. **设计令牌**：结构参考 Obsidian 的分层变量（基础值、语义变量、组件变量）与 4px 网格；配色参考 Linear「少量输入、感知均匀」的做法；明暗默认跟随系统。
3. **速记优先**：Raycast 的全局快捷呼出与 Paste 的「复制即用」对应 SideNotes 的速记浮窗与 Ctrl+C，保持一步完成。
4. **不采用**：文件夹与智能组、内容类型、模板占位符、命令面板、列表加详情的三栏布局。它们服务于片段管理，会让窄侧栏变重，与「不打断工作」的目标无关。
5. **跨平台**：所有 ⌘ 快捷键映射为 Ctrl；Android 上不能依赖快捷键，每个操作都要有可点击的入口。
