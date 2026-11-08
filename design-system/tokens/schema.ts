/**
 * 设计令牌清单。
 *
 * 这里只登记令牌的名称、分组、语义与是否随明暗模式变化，数值写在 CSS 中：
 * - `base.css`：与主题无关的共享令牌（间距、描边宽度、字重、层级等）。
 * - 各主题的令牌文件：随主题变化的令牌，按 `data-sn-surface` 与 `data-sn-theme` 分组。
 *
 * 这份清单同时供 Playground 的令牌页展示、`design-system/tests` 检查各主题是否定义完整、
 * 组件样式是否只引用清单中的令牌，以及 `design-tokens.md` 与 CSS 是否一致。
 */

export type TokenGroup =
  | 'surface'
  | 'border'
  | 'text'
  | 'accent'
  | 'status'
  | 'code'
  | 'shadow'
  | 'material'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'border-width'
  | 'motion'
  | 'layout'
  | 'opacity'
  | 'z-index';

export interface TokenSpec {
  name: string;
  group: TokenGroup;
  /** 简短的中文语义说明。 */
  meaning: string;
  /** 浅色与深色是否分别取值。 */
  themed: boolean;
  /** 所有主题共用同一个值，写在 base.css。 */
  shared?: boolean;
}

const themed = (group: TokenGroup, entries: Array<[string, string]>): TokenSpec[] =>
  entries.map(([name, meaning]) => ({ name, group, meaning, themed: true }));

const fixed = (group: TokenGroup, entries: Array<[string, string]>, shared = false): TokenSpec[] =>
  entries.map(([name, meaning]) => ({ name, group, meaning, themed: false, shared }));

export const TOKENS: readonly TokenSpec[] = [
  ...themed('surface', [
    ['--sn-color-panel', '侧栏与速记浮窗的面板底色，可以半透明（Windows 11、磨砂玻璃）'],
    ['--sn-color-panel-band', '面板中的页脚带，叠在面板之上'],
    ['--sn-color-card', '记录卡片与新建卡片的底色，叠在面板之上，可以半透明'],
    ['--sn-color-card-head', '记录卡片标题栏的底色，叠在卡片之上；只有窗格式的记录（终端）使用，其余主题透明'],
    ['--sn-color-card-active', '悬停或选中的卡片：叠在卡片底色上的叠加色'],
    ['--sn-color-card-head-active', '悬停或选中时标题栏的底色，取代标题栏底色；只有窗格式的记录（终端）使用，其余主题透明'],
    ['--sn-color-editing', '编辑中的卡片与获得焦点的新建卡片的底色，取代卡片底色'],
    ['--sn-color-sheen', '玻璃块顶部的光泽，从上往下渐隐（磨砂玻璃）；不用时为透明'],
    ['--sn-color-bg', '设置窗口的窗口底色与分类栏'],
    ['--sn-color-surface', '设置窗口的内容区、弹窗正文'],
    ['--sn-color-surface-raised', '浮起的表面：菜单、弹窗'],
    ['--sn-color-surface-sunken', '凹陷的表面：输入框、分段控件底'],
    ['--sn-color-hover', '悬停叠加色，叠在任意表面上'],
    ['--sn-color-pressed', '按下叠加色'],
    ['--sn-color-selected', '当前页签、设置导航项与菜单当前项的叠加色'],
    ['--sn-color-overlay', '弹窗遮罩'],
  ]),
  ...themed('border', [
    ['--sn-color-border', '常规分隔线与浮层描边'],
    ['--sn-color-border-subtle', '弱分隔线：条目之间、分组内'],
    ['--sn-color-border-strong', '控件边界：输入框、复选框（对比度不低于 3:1）'],
    ['--sn-color-edge-highlight', '面板与浮窗顶部一像素的受光边（Windows 11 的亚克力）；不用时为透明'],
    ['--sn-color-rim-top', '玻璃边缘受光：上缘的亮边，与下缘之间渐变（磨砂玻璃）；不用时为透明'],
    ['--sn-color-rim-bottom', '玻璃边缘受光：下缘的弱光（磨砂玻璃）；不用时为透明'],
    ['--sn-color-rule', '编辑时每行下方的横线（记录纸）；不用时为透明'],
  ]),
  ...themed('text', [
    ['--sn-color-text', '主要文字：标题、正文'],
    ['--sn-color-text-secondary', '次要文字：说明、正文预览中的弱化内容'],
    ['--sn-color-text-muted', '弱化文字：时间、计数、占位（对比度不低于 4.5:1）'],
    ['--sn-color-text-disabled', '禁用文字（不要求对比度）'],
    ['--sn-color-halo', '文字光晕：玻璃上为文字加一圈浅色或深色晕；不用时为透明'],
    ['--sn-color-syntax', '编辑时 Markdown 标记（#、**、- 等）的颜色（对比度不低于 4.5:1）'],
  ]),
  ...themed('accent', [
    ['--sn-color-accent', '强调色填充：主要按钮、选中指示条、开关'],
    ['--sn-color-accent-hover', '强调色填充的悬停态'],
    ['--sn-color-accent-text', '强调色文字与图标（对比度不低于 4.5:1）'],
    ['--sn-color-accent-subtle', '强调色浅底：选中的标签、筛选条'],
    ['--sn-color-on-accent', '强调色填充上的文字'],
    ['--sn-color-focus', '键盘焦点环'],
    ['--sn-color-caret', '输入光标（对比度不低于 3:1）'],
    ['--sn-color-highlight', '搜索命中的底色'],
    ['--sn-color-selection', '文本选区'],
    ['--sn-color-inverse', '反色表面：提示条、工具提示'],
    ['--sn-color-on-inverse', '反色表面上的文字'],
    ['--sn-color-mark-workspace', '页签标记：工作区'],
    ['--sn-color-mark-pinned', '页签标记：置顶'],
    ['--sn-color-mark-archive', '页签标记：归档'],
  ]),
  ...themed('status', [
    ['--sn-color-success', '成功：文字与图标'],
    ['--sn-color-success-subtle', '成功的浅底'],
    ['--sn-color-warning', '警告：文字与图标'],
    ['--sn-color-warning-subtle', '警告的浅底'],
    ['--sn-color-danger', '危险：删除、错误'],
    ['--sn-color-danger-subtle', '危险的浅底'],
    ['--sn-color-info', '提示信息'],
    ['--sn-color-info-subtle', '提示信息的浅底'],
  ]),
  ...themed('code', [
    ['--sn-code-bg', '代码块与行内代码的底色'],
    ['--sn-code-text', '代码文字'],
  ]),
  ...themed('shadow', [
    ['--sn-shadow-sm', '小阴影：卡片、按下的分段'],
    ['--sn-shadow-md', '中阴影：菜单、下拉框、工具提示'],
    ['--sn-shadow-lg', '大阴影：弹窗、速记浮窗、设置窗口'],
    ['--sn-shadow-panel', '侧栏面板与玻璃块的阴影：贴边时为朝向内容的一侧'],
    ['--sn-shadow-card-active', '悬停或选中的卡片：强调色外圈与浮起'],
    ['--sn-shadow-editing', '编辑中的卡片与获得焦点的新建卡片：浮起的投影（边框不变，不用强调色）'],
  ]),
  ...fixed('material', [
    ['--sn-panel-blur', '面板的背景模糊半径；0 表示实心表面'],
    ['--sn-panel-saturate', '背景模糊时的饱和度倍数'],
    ['--sn-panel-inset', '侧栏离屏幕边缘的距离；0 表示贴边'],
    ['--sn-panel-radius', '面板圆角'],
    ['--sn-panel-radius-edge', '面板贴边一侧的圆角'],
    ['--sn-block-gap', '分块面板之间的间隙（磨砂玻璃）；整块面板为 0'],
  ]),
  ...fixed('typography', [
    ['--sn-font-ui', '界面字体'],
    ['--sn-font-title', '标题字体'],
    ['--sn-font-note', '记录正文字体'],
    ['--sn-font-meta', '元信息字体：时间、计数、快捷键'],
    ['--sn-font-code', '代码字体'],
    ['--sn-font-size-xs', '最小字号：徽标、快捷键'],
    ['--sn-font-size-sm', '小字号：时间、说明'],
    ['--sn-font-size-md', '界面基准字号'],
    ['--sn-font-size-lg', '卡片标题、面板标题'],
    ['--sn-font-size-xl', '窗口标题、设置分类标题'],
    ['--sn-line-height-tight', '紧凑行高：标题、单行控件'],
    ['--sn-line-height-normal', '常规行高：界面文字'],
    ['--sn-line-height-relaxed', '宽松行高：说明段落'],
    ['--sn-note-size', '记录正文字号'],
    ['--sn-note-line-height', '记录正文行高'],
    ['--sn-code-size', '代码字号'],
    ['--sn-body-weight', '界面正文字重：在玻璃等半透明表面上略加粗'],
    ['--sn-title-weight', '标题字重'],
    ['--sn-title-tracking', '标题字距'],
  ]),
  ...fixed(
    'typography',
    [
      ['--sn-font-weight-regular', '常规字重'],
      ['--sn-font-weight-medium', '中等字重'],
      ['--sn-font-weight-semibold', '半粗字重'],
      ['--sn-font-weight-bold', '粗体字重'],
    ],
    true,
  ),
  ...fixed(
    'spacing',
    [
      ['--sn-space-0', '0'],
      ['--sn-space-1', '2px：图标与文字的最小间隙'],
      ['--sn-space-2', '4px：紧凑元素之间'],
      ['--sn-space-3', '6px：控件内的小间距'],
      ['--sn-space-4', '8px：基础单位'],
      ['--sn-space-5', '12px：控件内边距、行内间距'],
      ['--sn-space-6', '16px：分组之间、面板内边距'],
      ['--sn-space-7', '20px'],
      ['--sn-space-8', '24px：区块之间'],
      ['--sn-space-9', '32px'],
      ['--sn-space-10', '40px：窗口级留白'],
    ],
    true,
  ),
  ...fixed('radius', [
    ['--sn-radius-xs', '最小圆角：快捷键、行内代码'],
    ['--sn-radius-sm', '小圆角：标签、小按钮'],
    ['--sn-radius-md', '中圆角：菜单、代码块'],
    ['--sn-radius-lg', '大圆角：弹窗、浮窗'],
    ['--sn-radius-control', '按钮与输入框圆角'],
    ['--sn-radius-chip', '标签与徽标圆角'],
    ['--sn-card-radius', '记录卡片圆角'],
  ]),
  ...fixed('radius', [['--sn-radius-full', '完全圆形：圆点、开关']], true),
  ...fixed(
    'border-width',
    [
      ['--sn-border-width', '描边宽度'],
      ['--sn-focus-ring-width', '焦点环宽度'],
      ['--sn-focus-ring-offset', '焦点环与元素的间距'],
    ],
    true,
  ),
  ...fixed('motion', [
    ['--sn-duration-fast', '快：悬停、按下、开关'],
    ['--sn-duration-normal', '常规：菜单、工具提示、卡片展开'],
    ['--sn-duration-slow', '慢：弹窗、速记浮窗'],
    ['--sn-ease-standard', '标准缓动：状态变化'],
    ['--sn-ease-enter', '进入缓动：元素出现、侧栏滑入'],
    ['--sn-ease-exit', '退出缓动：元素消失、侧栏滑出'],
    ['--sn-motion-distance', '进入时的位移距离'],
  ]),
  ...fixed('layout', [
    ['--sn-header-height', '侧栏顶部与浮窗标题栏的高度'],
    ['--sn-tab-height', '页签高度'],
    ['--sn-footer-height', '侧栏底栏与浮窗底栏的高度'],
    ['--sn-panel-padding', '面板内容的左右内边距'],
    ['--sn-card-padding-x', '卡片左右内边距'],
    ['--sn-card-padding-y', '卡片上下内边距'],
    ['--sn-card-gap', '卡片之间的间隙'],
    ['--sn-control-height-sm', '小控件高度'],
    ['--sn-control-height', '控件高度'],
    ['--sn-control-height-lg', '大控件高度'],
    ['--sn-icon-size', '图标尺寸'],
    ['--sn-icon-size-sm', '小图标尺寸'],
    ['--sn-icon-stroke', '图标描边宽度（24 网格）'],
    ['--sn-menu-item-height', '菜单项高度'],
    ['--sn-dialog-width', '常规弹窗宽度'],
  ]),
  ...fixed('opacity', [['--sn-opacity-disabled', '禁用元素的不透明度']], true),
  ...fixed(
    'z-index',
    [
      ['--sn-z-sticky', '吸顶元素'],
      ['--sn-z-dropdown', '下拉菜单'],
      ['--sn-z-overlay', '遮罩'],
      ['--sn-z-dialog', '弹窗'],
      ['--sn-z-popover', '弹窗之上的浮层'],
      ['--sn-z-toast', '提示条'],
      ['--sn-z-tooltip', '工具提示'],
    ],
    true,
  ),
];

/** 按名称查找令牌。 */
export const TOKEN_BY_NAME: ReadonlyMap<string, TokenSpec> = new Map(TOKENS.map((token) => [token.name, token]));

/** 分组的中文名，用于令牌页与文档。 */
export const GROUP_LABELS: Record<TokenGroup, string> = {
  surface: '表面',
  border: '边框',
  text: '文字',
  accent: '强调、反色与标记',
  status: '状态',
  code: '代码',
  shadow: '阴影',
  material: '材质',
  typography: '字体与排版',
  spacing: '间距',
  radius: '圆角',
  'border-width': '描边',
  motion: '动效',
  layout: '布局与尺寸',
  opacity: '不透明度',
  'z-index': '层级',
};
