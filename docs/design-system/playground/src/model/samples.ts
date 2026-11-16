/**
 * 第六次反馈补充的示例记录（「补充丰富更多的测试数据项」），与交互原型 `docs/prototype/app.js` 的 createMoreExamples 相同，
 * id 以 sample6- 开头。追加在现有示例（`src/debug/sample-notes.ts`，桌面端的调试数据，不改）之后，只在 Playground 中使用。
 *
 * 覆盖：各个页签；跨页签的同一个词（「发布」）；相近的标签（#产品 与 #产品经理、#设计 与 #设计规范）；很长的标签名；
 * 长标题（菜单里截断）与长正文（收起、展开）；只有一行、不带标签与带很多标签的记录；Markdown 的各种写法；
 * 多张图片与文件引用（含不存在的路径）；置顶与回收站；从今天到去年的日期。
 */

import { canonicalize } from '@/core/tags';
import type { Note, NoteImage } from '@/core/types';

const HOUR = 3_600_000;

/** 示例的原始描述：hours 是相对现在的小时数；trash 是移入回收站的时间（同样相对现在），没有时不在回收站。 */
interface Seed {
  id: string;
  text: string;
  emoji: string;
  hours: number;
  pinned?: boolean;
  collapsed?: boolean;
  trash?: number;
  images?: NoteImage[];
}

const svg = (id: string, name: string, source: string): NoteImage => ({
  id,
  name,
  type: 'image/svg+xml',
  data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
});

const ICON_A =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#1f2433"/><rect x="40" y="40" width="120" height="120" rx="30" fill="#e9a23b"/><circle cx="100" cy="100" r="22" fill="#1f2433"/></svg>';
const ICON_B =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#f4f1ea"/><path d="M110 30h100v140l-50-34-50 34z" fill="#3b6fd8"/><path d="M135 70h50M135 92h36" stroke="#f4f1ea" stroke-width="10" stroke-linecap="round"/></svg>';
const SHOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#e8ecf2"/><rect x="20" y="24" width="250" height="16" rx="4" fill="#c5cdd9"/><rect x="20" y="52" width="210" height="12" rx="4" fill="#d5dbe4"/><rect x="300" width="180" height="300" fill="#22252e"/><rect x="314" y="18" width="70" height="12" rx="3" fill="#e9a23b"/><rect x="314" y="44" width="152" height="60" rx="8" fill="#2e323d"/><rect x="314" y="114" width="152" height="80" rx="8" fill="#2e323d"/><rect x="314" y="204" width="152" height="48" rx="8" fill="#2e323d"/></svg>';

const FENCE = '```';

const SEEDS: Seed[] = [
  { id: 'sample6-release-notes', emoji: '🚀', hours: -3, text: '0.7.4 发布说明草稿\n\n## 新增\n- 页签栏放不下时才收起，最后一格固定只占一个位置\n- 筛选行右边加上多选与收起全部\n\n## 修复\n- Shift+单击从上一次单击的卡片选起\n\n#开发 #SideNotes #发布' },
  { id: 'sample6-release-review', emoji: '📋', hours: -26, text: '发布前评审清单\n\n- [x] 确认验收清单都有人认领\n- [x] 截图与文案定稿\n- [ ] 回滚方案演练\n- [ ] 发布公告排期\n\n#产品 #发布 #待办' },
  { id: 'sample6-release-copy', emoji: '✍️', hours: -50, text: '应用商店的发布文案\n\n**一句话：**藏在屏幕边上的速记本。\n\n副标题候选：\n1. 随手记，随时找\n2. 先记录，再整理\n3. 不打断手上的事\n\n#设计 #发布 #文案' },
  { id: 'sample6-pm-weekly', emoji: '🗓️', hours: -8, text: '产品经理周会\n\n- 本周目标：完成搜索与页签的验收\n- 风险：桌面端还没跟上原型\n- 下周：整理下一轮反馈\n\n#产品经理 #会议' },
  { id: 'sample6-pm-interview', emoji: '🎙️', hours: -75, text: '用户访谈：三位产品经理\n\n> 我经常只记得一句话，想不起来记在哪个分类里。\n\n> 页签多了以后，希望常用的放前面。\n\n结论：搜索要搜全部记录，结果写出所在的页签，评审时再确认分组的写法。\n\n#产品经理 #产品 #访谈' },
  { id: 'sample6-design-spec', emoji: '📐', hours: -30, text: '设计规范：间距与字号\n\n- 间距按 2、4、6、8、12、16 递增\n- 正文 13px，辅助文字 12px\n- 图标 14px 与 16px 两档\n\n不写死数值，一律引用令牌。\n\n#设计规范 #设计' },
  {
    id: 'sample6-design-icons',
    emoji: '🎨',
    hours: -55,
    text: '图标候选对比\n\n左边是圆角方块，右边是书签形。\n\n#设计 #图标',
    images: [svg('sample6-icon-a', '图标候选-方块.svg', ICON_A), svg('sample6-icon-b', '图标候选-书签.svg', ICON_B)],
  },
  { id: 'sample6-dev-rust', emoji: '🦀', hours: -6, text: `数据库迁移步骤\n\n${FENCE}rust\nlet tx = conn.transaction()?;\ntx.execute_batch(include_str!("migrations/0005.sql"))?;\ntx.commit()?;\n${FENCE}\n\n迁移前先备份 \`sidenotes.db\`。\n\n#开发 #Rust` },
  { id: 'sample6-dev-ts', emoji: '🧩', hours: -98, text: `TypeScript 类型小抄\n\n${FENCE}ts\ntype Tab = 'workspace' | 'pinned' | \`tag:\${string}\`;\nconst isTag = (tab: Tab) => tab.startsWith('tag:');\n${FENCE}\n\n用 \`satisfies\` 检查对象字面量，同时保留字面量类型。\n\n#开发 #前端` },
  { id: 'sample6-dev-bug', emoji: '🐞', hours: -12, text: '已知问题：中文输入法下按 Enter\n\n- [x] 候选词上屏时不应提交\n- [ ] 记录窗口里复现一遍\n- [ ] 速记浮窗里复现一遍\n\n#开发 #缺陷 #待办' },
  { id: 'sample6-ref-links', emoji: '🔗', hours: -140, text: '常用文档\n\n- [Tauri 2 指南](https://v2.tauri.app/start/)\n- [React 文档](https://react.dev/learn)\n- [MDN：Pointer events](https://developer.mozilla.org/zh-CN/docs/Web/API/Pointer_events)\n- 很长的网址：https://example.com/a/very/long/path/that/keeps/going/to/test/wrapping/in/the/card/body?query=sidenotes&page=1\n\n#参考 #开发' },
  { id: 'sample6-ref-shortcuts', emoji: '⌨️', hours: -200, pinned: true, text: '快捷键速查\n\n- `Alt+Shift+S` 收起或展开侧栏\n- `Ctrl+Shift+Space` 速记浮窗\n- `Ctrl+F` 搜索全部记录\n- `Shift+单击` 连续选择\n- `Esc` 逐级退出\n\n#参考 #SideNotes' },
  { id: 'sample6-roadmap', emoji: '🗺️', hours: -170, collapsed: true, text: 'SideNotes 路线图\n\n## 近期\n- 搜索与页签\n  - 全局搜索按页签分组\n  - 页签栏放不下时收起\n- 设置窗口\n\n## 之后\n- 云端备份（可选）\n- 安卓端\n\n#SideNotes #规划' },
  { id: 'sample6-feedback', emoji: '📝', hours: -0.5, text: '第六次反馈整理\n\n- [x] 搜索回到页签栏\n- [x] 筛选行右边放列表操作\n- [ ] 用真实鼠标试一遍拖动\n\n#SideNotes #反馈 #待办' },
  { id: 'sample6-reading-notes', emoji: '📖', hours: -220, text: '《设计心理学》摘录\n\n> 好的设计让人一眼看出能做什么。\n\n> 用户犯错时，问题多半出在设计上。\n\n#阅读 #读书笔记' },
  { id: 'sample6-reading-list', emoji: '📚', hours: -480, text: '2026 读书清单\n\n1. 《设计心理学》\n2. 《写给大家看的设计书》\n3. 《简约至上》\n4. 《Rust 程序设计语言》\n\n#阅读 #学习计划2026' },
  { id: 'sample6-long-tag', emoji: '🏷️', hours: -336, text: '标签名很长的记录\n\n页签名超过 4 个字时截断，标签下拉里显示全名。\n\n#很长的标签名称用来测试截断 #阅读' },
  { id: 'sample6-grocery', emoji: '🛒', hours: -4, text: '周末采购\n\n- [ ] 牛奶\n- [ ] 鸡蛋\n- [x] 咖啡豆\n- [ ] 番茄\n\n#生活 #待办' },
  { id: 'sample6-recipe', emoji: '🍳', hours: -216, text: '番茄炒蛋的火候\n\n1. 蛋液加少许盐，大火炒到七成熟盛出\n2. 番茄切块，中火炒出汁\n3. 倒回鸡蛋，翻匀出锅\n\n#生活 #菜谱' },
  { id: 'sample6-running', emoji: '🏃', hours: -36, text: '跑步记录\n\n周一 5 公里，配速 6:10\n周三 3 公里，配速 5:50\n周六 10 公里，配速 6:30\n\n#健康 #运动' },
  { id: 'sample6-travel', emoji: '⛩️', hours: -288, pinned: true, text: '京都行程（草稿）\n\n## 第一天\n- 清水寺，傍晚去二年坂\n- 晚饭：锦市场附近\n\n## 第二天\n- 伏见稻荷，早上七点前到\n- 下午东福寺\n\n## 第三天\n- 岚山竹林、天龙寺\n- 渡月桥看日落\n\n## 待定\n- 宇治一日游？\n- 是否换到大阪住一晚\n\n#旅行 #生活' },
  { id: 'sample6-finance', emoji: '💳', hours: -600, text: '年度订阅费用\n\n- 域名：¥69 / 年\n- 云存储：¥180 / 年\n- 字体授权：¥0（OFL）\n\n合计约 ¥249。\n\n#财务' },
  { id: 'sample6-one-line', emoji: '💡', hours: -0.2, text: '侧栏按住 Alt 时临时半透明，看得到下面的窗口？' },
  { id: 'sample6-no-tag', emoji: '🗒️', hours: -48, text: '没有标签的记录\n\n随手记下来，之后再整理。' },
  { id: 'sample6-many-tags', emoji: '🔖', hours: -60, text: '多标签示例\n\n一条记录带很多标签时，标签行放不下的部分收进「…」。\n\n#工作 #产品 #设计 #开发 #参考 #会议 #待办 #灵感 #SideNotes' },
  { id: 'sample6-long-title', emoji: '🧾', hours: -27, text: '第三季度产品路线图评审会议纪要（修订版，含遗留问题与下一步计划）\n\n- 会议时间：周四下午\n- 参会：产品、设计、开发\n- 遗留：页签栏的收起规则、关于页的链接样式\n\n#产品 #会议' },
  {
    id: 'sample6-long-body',
    emoji: '📜',
    hours: -100,
    text: '长文示例：侧栏交互的设计原则\n\n侧栏藏在屏幕边上，唤出时不能打断手上的事。记录入口要直接，先记下来，分类和整理都可以以后再做。\n\n搜索要搜全部记录。很多时候只记得一句话，不记得它在哪个页签里；结果按页签分组，需要时可以转到它所在的位置。\n\n页签只放常用的标签，由用户手动固定。放不下时收进最后一格，最后一格只占一个位置，样子固定。\n\n卡片默认展开，内容长时限制高度；可以收起正文只看标题，也可以一次收起全部。\n\n多选用 Ctrl 或 Shift 单击，也可以点筛选行右边的多选按钮。选中之后可以合并、移到别的页签或移入回收站。\n\n#产品 #设计',
  },
  { id: 'sample6-mixed', emoji: '🌐', hours: -15, text: 'Mixed 中英混排 and emoji 🚀\n\n**粗体**、*斜体*、~~删除线~~ 与 `inline code` 混在一起；English words between 中文 should wrap naturally.\n\n---\n\n分隔线下面还有一段。\n\n#灵感' },
  { id: 'sample6-file-missing', emoji: '📁', hours: -960, text: '旧项目的文件\n\n[已删除的需求文档.docx](file:///C:/旧项目/已删除的需求文档.docx)\n\n这个路径已经不存在，打开时要重新定位。\n\n#文件' },
  {
    id: 'sample6-file-images',
    emoji: '🖼️',
    hours: -9,
    text: '截图与附件\n\n侧栏的截图在下面，设计稿在文件里：\n\n[侧栏设计稿.fig](file:///D:/Design/SideNotes/侧栏设计稿.fig)\n\n#SideNotes #文件',
    images: [svg('sample6-shot', '侧栏截图.svg', SHOT)],
  },
  { id: 'sample6-pinned-release', emoji: '📦', hours: -150, pinned: true, text: `发布命令\n\n${FENCE}bash\npnpm build\npnpm tauri build --bundles nsis\n${FENCE}\n\n#开发 #发布` },
  { id: 'sample6-last-month', emoji: '🗂️', hours: -840, text: '上个月的会议纪要\n\n讨论了标签与页签的关系：页签是固定的标签，随记放没有固定标签的记录。\n\n#会议 #工作' },
  { id: 'sample6-last-year', emoji: '🎆', hours: -9600, text: '2025 年终总结\n\n- 完成 SideNotes 0.5 到 0.7\n- 写了三百多条记录\n- 明年：安卓端\n\n#工作 #总结' },
  { id: 'sample6-trash-meeting', emoji: '📅', hours: -144, trash: -48, text: '过期的会议安排\n\n周二下午的评审已取消。\n\n#会议' },
  { id: 'sample6-trash-duplicate', emoji: '📄', hours: -720, trash: -600, text: '重复的草稿\n\n与「发布前评审清单」重复。' },
  { id: 'sample6-trash-icon', emoji: '🖌️', hours: -72, trash: -1, text: '旧版图标说明\n\n第一版图标的配色已经弃用。\n\n#设计 #图标' },
];

/**
 * 示例数据默认固定的标签：原来的「工作」「生活」之外再加四个，侧栏窄时页签栏放不下，可以直接看到最后一格「N ▾」。
 * 不固定「阅读」，组件页用它演示「固定为页签」。
 */
export const SAMPLE_PINNED_TAGS = ['工作', '生活', '开发', '设计', '产品', '参考'];

/** 构造第六次反馈补充的示例记录；时间按相对小时数计算，每次载入都贴近当前时间。 */
export function createExtraSampleNotes(now = Date.now()): Note[] {
  return SEEDS.map((seed) => {
    const createdAt = now + seed.hours * HOUR;
    const deletedAt = seed.trash === undefined ? null : now + seed.trash * HOUR;
    return {
      id: seed.id,
      text: canonicalize(seed.text),
      emoji: seed.emoji,
      images: seed.images ?? [],
      pinned: Boolean(seed.pinned),
      collapsed: Boolean(seed.collapsed),
      status: deletedAt === null ? 'active' : 'trash',
      previousStatus: 'active',
      order: null,
      createdAt,
      updatedAt: deletedAt ?? createdAt,
      deletedAt,
    };
  });
}
