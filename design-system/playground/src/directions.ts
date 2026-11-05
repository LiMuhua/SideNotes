/**
 * 五套设计方向的结构差异。
 *
 * 颜色、字体、尺寸、材质等可以用数值表达的差异写在令牌文件中（design-system/tokens）；
 * 这里只描述令牌无法表达的结构差异：侧栏与屏幕边缘的关系、记录的组织方式、页签形态等。
 * 记录纸、Windows 11、磨砂玻璃三套对应 Glance 的三种外观，也对应现有 SideNotes 的三种界面材质。
 */

export type DirectionId = 'workbench' | 'editorial' | 'paper' | 'fluent' | 'glass';

export interface DirectionSpec {
  id: DirectionId;
  /** 中文名。 */
  name: string;
  /** 英文名。 */
  english: string;
  /** 一句话的设计理念。 */
  idea: string;
  keywords: string[];
  references: string[];
  /** 用户的倾向：首选、备选；未标注的待比较。 */
  preference?: 'primary' | 'alternative';
  /** 侧栏与屏幕边缘的关系：贴边的整块、离开边缘的浮动面板、分开的若干块。 */
  dock: 'flush' | 'floating' | 'blocks';
  /** 记录的组织方式：带标题栏的窗格、带底色的卡片、各自独立的玻璃块。 */
  entries: 'panes' | 'cards' | 'tiles';
  /** 页签形态：文字加下划线、分段控件。 */
  tabs: 'underline' | 'segmented';
  /** 半透明表面，背后透出桌面（需要透明窗口与系统材质，见方向文档）。 */
  translucent: boolean;
  /** 底部状态栏：存储状态、条数与常用快捷键。 */
  statusLine: boolean;
  /** 在按钮与输入框上直接显示快捷键，而不是只写在工具提示里。 */
  inlineShortcuts: boolean;
  /** 页签前的分区色圆点（Glance 磨砂玻璃每个模块一种颜色）。 */
  tabMarks: boolean;
}

export const DIRECTIONS: readonly DirectionSpec[] = [
  {
    id: 'workbench',
    name: '开发者工作台',
    english: 'Developer Workbench',
    idea: '像编辑器的一角：每条记录是一个带标题栏的窗格，等宽字体、键盘优先，快捷键与状态始终可见，记下就走。',
    keywords: ['等宽字体', '石墨色', '琥珀强调色', '标题栏窗格', '状态栏', '快捷键可见'],
    references: ['现有 SideNotes 的默认字体 Maple Mono', 'Raycast 的键盘模型', 'Obsidian', 'Glance 记录纸的单色墨水'],
    preference: 'primary',
    dock: 'flush',
    entries: 'panes',
    tabs: 'underline',
    translucent: false,
    statusLine: true,
    inlineShortcuts: true,
    tabMarks: false,
  },
  {
    id: 'editorial',
    name: '现代编辑',
    english: 'Modern Editorial',
    idea: '一本随手翻的笔记本：暖纸色、宽松留白、衬线标题，卡片之间有呼吸感。',
    keywords: ['暖纸色', '鼠尾草绿', '衬线标题', '圆角卡片', '浮动面板'],
    references: ['Apple HIG 的阅读体验', 'Material 3 的色调表面', '现有 SideNotes 的纸张配色'],
    preference: 'alternative',
    dock: 'floating',
    entries: 'cards',
    tabs: 'segmented',
    translucent: false,
    statusLine: false,
    inlineShortcuts: false,
    tabMarks: false,
  },
  {
    id: 'paper',
    name: '记录纸',
    english: 'Paper',
    idea: '一叠贴着屏幕边缘的记录纸：灰绿纸垫上铺着一张张浅色纸片，只有一种墨色，信号色只在需要时出现。',
    keywords: ['贴边纸垫', '纸片', '单色墨水', '灰绿纸色', '标题加右侧数值'],
    references: ['Glance 记录纸外观（theme.rs）', '现有 SideNotes 的记录纸材质'],
    dock: 'flush',
    entries: 'cards',
    tabs: 'underline',
    translucent: false,
    statusLine: false,
    inlineShortcuts: false,
    tabMarks: false,
  },
  {
    id: 'fluent',
    name: 'Windows 11',
    english: 'Windows 11 Fluent',
    idea: '一张亚克力面板，和开始菜单、快速设置一样：离开屏幕边缘 12 像素，8 像素圆角，一像素描边。',
    keywords: ['亚克力', '系统强调色', 'Segoe UI Variable', '分层卡片', '浮动面板'],
    references: ['Glance Windows 11 外观（theme.rs、skins.rs）', 'Fluent 2', '现有 SideNotes 的 Windows 11 材质'],
    dock: 'floating',
    entries: 'cards',
    tabs: 'underline',
    translucent: true,
    statusLine: false,
    inlineShortcuts: false,
    tabMarks: false,
  },
  {
    id: 'glass',
    name: '磨砂玻璃',
    english: 'Frosted Glass',
    idea: '分开的几块磨砂玻璃，在边缘透出桌面；背景越杂乱磨得越砂，文字在任何背景上都清楚。',
    keywords: ['分块玻璃', '顶部受光', '大圆角', '分区色', '文字光晕'],
    references: ['Glance 磨砂玻璃外观（theme.rs、skins.rs）', '现有 SideNotes 的磨砂玻璃材质'],
    dock: 'blocks',
    entries: 'tiles',
    tabs: 'segmented',
    translucent: true,
    statusLine: false,
    inlineShortcuts: false,
    tabMarks: true,
  },
];

export const DIRECTION_BY_ID: Record<DirectionId, DirectionSpec> = Object.fromEntries(
  DIRECTIONS.map((direction) => [direction.id, direction]),
) as Record<DirectionId, DirectionSpec>;

export const DIRECTION_IDS: readonly DirectionId[] = DIRECTIONS.map((direction) => direction.id);
