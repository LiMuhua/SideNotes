/**
 * 调试用示例数据。
 *
 * 仅在开发环境且显式开启调试开关时载入，正式运行不会写到用户数据库。
 * 通过 `pnpm dev` 启动后访问 `?debug-data=1`，或在控制台执行
 * `localStorage.setItem('sidenotes:debug-data', '1')` 后刷新来启用。
 *
 * 数据覆盖随记、置顶、旧版本的归档（载入时迁移为带 #归档 的普通记录）与回收站，用于直观检查列表密度、
 * 折叠态、标签筛选与回收站保留期等界面表现。
 */

import { canonicalize } from '../core/tags';
import { createId, migrateArchivedNote } from '../core/notes';
import type { Note, NoteStatus } from '../core/types';

/** 调试开关键：出现且值为 `1` 时载入示例数据。 */
export const DEBUG_DATA_KEY = 'sidenotes:debug-data';
/** URL 参数名，便于不碰本地存储也能临时启用。 */
export const DEBUG_DATA_PARAM = 'debug-data';

/** 判定本次运行是否应载入示例数据。 */
export function shouldLoadSampleData(): boolean {
  if (typeof window === 'undefined') return false;
  // 生产构建下除非显式打开调试开关，否则不载入。
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(DEBUG_DATA_PARAM) === '1') return true;
    return window.localStorage.getItem(DEBUG_DATA_KEY) === '1';
  } catch {
    return false;
  }
}

/** 示例条目的原始描述；时间按相对天数计算，保证每次载入都贴近当前时间。 */
interface SampleSeed {
  text: string;
  emoji: string;
  /** 相对当前时间往前推的毫秒数。 */
  ago: number;
  pinned?: boolean;
  collapsed?: boolean;
  /** 旧数据中的「归档」也保留在示例里，载入时迁移为带 #归档 的普通记录（演示迁移）。 */
  status?: NoteStatus | 'archived';
  previousStatus?: 'active' | 'archived';
  /** 回收站条目的删除时间相对毫秒数。 */
  deletedAgo?: number;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

const SAMPLES: SampleSeed[] = [
  {
    text: '欢迎使用 SideNotes\n\n这是一个本地优先的速记工具，支持 Markdown 与 #标签。\n\n- 鼠标移到屏幕边缘呼出侧栏\n- Ctrl+Shift+Space 呼出速记浮窗\n- Ctrl+F 在侧栏内搜索',
    emoji: '👋',
    ago: 2 * HOUR,
    pinned: true,
  },
  {
    text: '今日待办\n\n- [x] 整理周会纪要\n- [x] 回复客户邮件\n- [ ] 写 SideNotes 发布说明\n- [ ] 复核账单',
    emoji: '✅',
    ago: 5 * HOUR,
    pinned: true,
  },
  {
    text: '周会纪要 #工作\n\n1. 需求评审聚焦在桌面端稳定性\n2. 本周完成设置弹窗重构\n3. 下周开始移动端调研 #会议',
    emoji: '📋',
    ago: 1 * DAY,
  },
  {
    text: '读《纳瓦尔宝典》摘录 #阅读\n\n复利不只是金钱，习惯和关系同样复利积累。把每一天当作一个新的开始，但记住所有决策的复利。',
    emoji: '📚',
    ago: 2 * DAY,
  },
  {
    text: '咖啡豆采购清单 #生活\n\n- 埃塞俄比亚耶加雪菲\n- 哥伦比亚水洗\n- 巴西半日晒\n\n下次去店里试新的处理法',
    emoji: '☕',
    ago: 3 * DAY,
  },
  {
    text: 'SideNotes 路线图 #工作\n\n- v0.6 桌面端稳定版\n- v0.7 数据导入导出\n- v0.8 标签管理面板\n- v1.0 跨设备同步（可选）',
    emoji: '🗺️',
    ago: 4 * DAY,
  },
  {
    text: '健身计划 #健康\n\n每周三次力量 + 两次有氧。\n今天：深蹲 5×5、卧推 5×5、划船 3×8。',
    emoji: '💪',
    ago: 5 * DAY,
  },
  {
    text: '客户端反馈汇总 #工作\n\n- 多数希望侧栏能更窄\n- 希望快捷键可自定义\n- 希望支持代码块高亮 #反馈',
    emoji: '💬',
    ago: 6 * DAY,
  },
  {
    text: '菜谱：番茄牛尾汤 #生活\n\n牛尾焯水，番茄去皮切块，慢炖两小时，最后加盐与迷迭香。',
    emoji: '🍲',
    ago: 7 * DAY,
  },
  {
    text: '电影笔记：《在云端》#影视\n\n关于轻装上阵与人际连结的电影。瑞安的「背包理论」在疫情后读起来格外有味道。',
    emoji: '🎬',
    ago: 8 * DAY,
  },
  {
    text: '看房记录 #生活\n\n- 朝阳两居室，采光好但临街\n- 海淀三居，学区配套完善\n- 顺义别墅，通勤距离偏长',
    emoji: '🏠',
    ago: 9 * DAY,
    collapsed: true,
  },
  {
    text: 'SideNotes 技术栈 #工作\n\nTauri 2 + React 19 + Vite + TypeScript + rusqlite。\n核心模块都已迁移，桌面端调优进行中。',
    emoji: '🛠️',
    ago: 10 * DAY,
  },
  {
    text: '番茄工作法复盘 #效率\n\n连续四周 25+5 节奏，专注时段明显增加。\n下一步尝试 50+10 长节律，观察能否进一步降噪。',
    emoji: '⏱️',
    ago: 11 * DAY,
  },
  {
    text: '旅行备忘 #旅行\n\n京都行：清水寺、伏见稻荷、岚山竹林。\n预算控制在 8000/人，避开樱花季高峰。',
    emoji: '✈️',
    ago: 12 * DAY,
  },
  {
    text: '生日礼物清单 #生活\n\n- 妈妈：羊绒围巾\n- 朋友：黑胶唱片\n- 同事：手冲咖啡套装',
    emoji: '🎁',
    ago: 13 * DAY,
    collapsed: true,
  },
  {
    text: '每周复盘模板 #效率\n\n1. 本周完成\n2. 卡住的地方\n3. 下周最重要的三件事\n4. 一个需要放弃的项',
    emoji: '📝',
    ago: 14 * DAY,
  },
  {
    text: '投资笔记 #理财\n\n宽基定投 + 少量主动基金。\n核心：不在情绪高点决策，按月固定金额执行。',
    emoji: '📈',
    ago: 15 * DAY,
  },
  {
    text: '播客收听清单 #阅读\n\n- 《晚点对话》近三期\n- 《不合时宜》关于数字游民\n- 《三五环》产品访谈',
    emoji: '🎧',
    ago: 16 * DAY,
  },
  {
    text: '家庭账单 #理财\n\n本月：水电 320、网费 120、物业 280。\n年度续费：域名 200、云存储 480。',
    emoji: '🧾',
    ago: 17 * DAY,
    collapsed: true,
  },
  {
    text: '代码片段：防抖函数 #编程\n\n```ts\nfunction debounce<T extends (...a: never[]) => void>(fn: T, ms = 200) {\n  let t = 0;\n  return (...a: Parameters<T>) => {\n    clearTimeout(t);\n    t = window.setTimeout(() => fn(...a), ms);\n  };\n}\n```',
    emoji: '💻',
    ago: 18 * DAY,
  },
  {
    text: '冥想记录 #健康\n\n连续 21 天，每天 10 分钟。\n观察：上午冥想比下午更稳定，呼吸节奏更容易控制。',
    emoji: '🧘',
    ago: 19 * DAY,
  },
  {
    text: '已归档的旧需求 #工作\n\n这批需求已经完成或下线，保留备查。\n- v0.5 的边缘触发阈值调整\n- 早期草稿自动保存策略',
    emoji: '🗄️',
    ago: 25 * DAY,
    status: 'archived',
  },
  {
    text: '去年此时 #生活\n\n翻到去年今日的日记，状态完全不同。\n记录让时间有了形状。',
    emoji: '📅',
    ago: 30 * DAY,
    status: 'archived',
  },
  {
    text: '误删的草稿 #工作\n\n不小心移动到回收站的旧草稿，演示恢复流程。',
    emoji: '♻️',
    ago: 20 * DAY,
    status: 'trash',
    previousStatus: 'active',
    deletedAgo: 2 * DAY,
  },
  {
    text: '过期的购物清单 #生活\n\n已经买完，可以永久删除。',
    emoji: '🗑️',
    ago: 22 * DAY,
    status: 'trash',
    previousStatus: 'active',
    deletedAgo: 5 * DAY,
  },
];

/** 构造示例记录数组；每次调用生成新的标识与时间戳。 */
export function createSampleNotes(now = Date.now()): Note[] {
  return SAMPLES.map((sample) => {
    const updatedAt = now - sample.ago;
    return migrateArchivedNote({
      id: createId(),
      text: canonicalize(sample.text),
      emoji: sample.emoji,
      images: [],
      pinned: Boolean(sample.pinned),
      collapsed: Boolean(sample.collapsed),
      status: (sample.status ?? 'active') as NoteStatus,
      previousStatus: (sample.previousStatus ?? 'active') as 'active',
      order: null,
      createdAt: updatedAt,
      updatedAt,
      deletedAt: sample.deletedAgo ? now - sample.deletedAgo : null,
    });
  });
}
