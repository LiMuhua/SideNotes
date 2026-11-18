/**
 * 大量的调试记录：测全局搜索、按页签分组、按需加载与列表性能用（2026-11-18 用户要求补充足量的测试数据）。
 *
 * 按主题与写法组合生成，内容固定、每次生成相同的一批（标识以 bulk- 开头）。同一个词出现在多个页签里
 * （发布、预算、会议、复盘、清单、SideNotes），相近的标签（#产品 与 #产品经理）、待办、代码、引用与长短不一的正文都有，
 * 日期从今天往前铺到一年前。只在调试开关打开、数据库为空时随其它示例一起写入（见 sample-notes.ts）。
 */

import { canonicalize } from '../core/tags';
import type { Note } from '../core/types';

const HOUR = 3_600_000;

interface Topic {
  tag: string;
  emoji: string[];
  /** 每条记录的标题与正文，`n` 是序号（1 起），用来变换数字与措辞。 */
  build: (n: number) => { title: string; body: string; extraTags?: string[] };
  count: number;
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'];
const PEOPLE = ['小林', '阿杰', '王老师', 'Lisa', '陈工', '小周'];
const PLACES = ['京都', '成都', '大理', '青岛', '清迈', '首尔', '厦门'];
const BOOKS = ['《人类简史》', '《设计心理学》', '《黑客与画家》', '《原则》', '《置身事内》', '《禅与摩托车维修艺术》'];
const pick = <T,>(list: readonly T[], n: number): T => list[n % list.length];

const TOPICS: Topic[] = [
  {
    tag: '工作',
    emoji: ['📋', '🗂️', '📌'],
    count: 14,
    build: (n) => ({
      title: n % 3 === 0 ? `第 ${n} 周复盘` : n % 3 === 1 ? `${pick(WEEKDAYS, n)}会议纪要` : `v0.${n % 9 + 1} 发布计划`,
      body:
        n % 3 === 0
          ? `- 做完：整理需求池、修复 ${n + 2} 个缺陷\n- 卡住：等待设计确认\n- 下周：准备发布说明，和${pick(PEOPLE, n)}对一下预算`
          : n % 3 === 1
            ? `参会：${pick(PEOPLE, n)}、${pick(PEOPLE, n + 2)}\n\n1. 会议确定下个版本的范围\n2. 预算再压 ${5 + (n % 4) * 5}%\n3. SideNotes 的发布时间往后推一周`
            : `- [x] 冻结功能\n- [${n % 2 ? ' ' : 'x'}] 回归测试\n- [ ] 写发布说明\n- [ ] 通知${pick(PEOPLE, n)}`,
      extraTags: n % 4 === 0 ? ['产品'] : undefined,
    }),
  },
  {
    tag: '开发',
    emoji: ['🧑‍💻', '🦀', '⚙️'],
    count: 14,
    build: (n) => ({
      title: n % 2 ? `Rust 笔记 ${n}：所有权与借用` : `排查：列表滚动卡顿 #${100 + n}`,
      body:
        n % 2
          ? '```rust\nfn main() {\n    let notes = vec!["SideNotes", "发布"];\n    for note in &notes {\n        println!("{note}");\n    }\n}\n```\n借用结束之前不能再可变借用。'
          : `> 现象：${n * 10} 条以上的记录滚动掉帧\n\n原因是每次滚动都重新计算高度，改成按需加载后正常。复盘时记一下：先量再改。`,
      extraTags: n % 5 === 0 ? ['工作'] : undefined,
    }),
  },
  {
    tag: '设计',
    emoji: ['🎨', '🖌️', '📐'],
    count: 10,
    build: (n) => ({
      title: n % 2 ? `配色方案 ${n}` : `图标第 ${n} 轮评审`,
      body: n % 2 ? `主色 #${(0x3b6fd8 + n * 1111).toString(16).slice(0, 6)}，强调色用低饱和的青色。\n标题字重 650，正文 500，留白要比上一版多。` : `- 门缝版保留\n- 一叠版的表情再往中间靠\n- 发布前再看一次 16px 下的清晰度`,
      extraTags: n % 3 === 0 ? ['设计规范'] : undefined,
    }),
  },
  {
    tag: '产品',
    emoji: ['💡', '🧭', '📈'],
    count: 10,
    build: (n) => ({
      title: n % 2 ? `用户反馈整理 ${n}` : `竞品分析：速记工具 ${n}`,
      body: n % 2 ? `${pick(PEOPLE, n)}说搜索结果分组后更好找了；也有人希望能按日期筛选。\n\n- 高频：全局搜索\n- 中频：标签整理\n- 低频：导出` : `对比了 ${3 + (n % 3)} 款产品：都有快捷键呼出，少有贴边侧栏。我们的优势是不打断当前工作。`,
      extraTags: n % 3 === 0 ? ['产品经理'] : undefined,
    }),
  },
  {
    tag: '生活',
    emoji: ['🏠', '🛒', '🍳'],
    count: 12,
    build: (n) => ({
      title: n % 3 === 0 ? `周末采购清单 ${n}` : n % 3 === 1 ? `菜谱：${pick(['番茄炒蛋', '红烧肉', '清蒸鱼', '麻婆豆腐'], n)}` : `家务分工 ${n}`,
      body:
        n % 3 === 0
          ? `- [ ] 牛奶\n- [ ] 鸡蛋\n- [x] 咖啡豆\n- [ ] 洗衣液\n\n预算 ${200 + n * 10} 元以内。`
          : n % 3 === 1
            ? `1. 备料\n2. 大火快炒\n3. 出锅前加盐\n\n${pick(PEOPLE, n)}说少放糖。`
            : `${pick(WEEKDAYS, n)}倒垃圾，周末大扫除。清单贴在冰箱上。`,
    }),
  },
  {
    tag: '健康',
    emoji: ['🏃', '🥗', '😴'],
    count: 8,
    build: (n) => ({
      title: n % 2 ? `跑步记录 ${n}` : `睡眠复盘 ${n}`,
      body: n % 2 ? `今天 ${3 + (n % 5)} 公里，配速 ${6 - (n % 3) * 0.2} 分钟每公里。膝盖没有不适。` : `平均 ${6 + (n % 3) * 0.5} 小时。睡前不看手机，效果明显。`,
    }),
  },
  {
    tag: '理财',
    emoji: ['💰', '📊', '🧾'],
    count: 10,
    build: (n) => ({
      title: n % 2 ? `${n} 月预算` : `账单核对 ${n}`,
      body: n % 2 ? `| 项目 | 预算 |\n| --- | --- |\n| 房租 | 3500 |\n| 餐饮 | ${1500 + n * 50} |\n| 交通 | 400 |` : `- [x] 信用卡账单\n- [ ] 水电燃气\n- [ ] 订阅服务：SideNotes 之外还有 ${n % 4 + 2} 个`,
    }),
  },
  {
    tag: '旅行',
    emoji: ['✈️', '🗺️', '🏨'],
    count: 10,
    build: (n) => ({
      title: `${pick(PLACES, n)}行程 ${n}`,
      body: `第一天：到达，入住酒店\n第二天：老城区步行，晚上看夜景\n第三天：返程\n\n预算控制在 ${3000 + n * 200} 元/人，订票前和${pick(PEOPLE, n)}确认。`,
    }),
  },
  {
    tag: '阅读',
    emoji: ['📚', '🔖', '📖'],
    count: 10,
    build: (n) => ({
      title: `读书笔记：${pick(BOOKS, n)}`,
      body: `> 第 ${n * 7} 页：好的设计让人不必思考。\n\n摘录之外的想法：做 SideNotes 的发布说明时也可以用这个原则。`,
    }),
  },
  {
    tag: '灵感',
    emoji: ['✨', '🌱', '🧩'],
    count: 8,
    build: (n) => ({
      title: `点子 ${n}`,
      body: n % 2 ? '侧栏里拖动卡片时，回收站可以更显眼一点。' : `把会议纪要自动整理成待办？先手动试 ${n} 周。`,
    }),
  },
];

/** 生成这批调试记录：每个主题若干条，日期从今天往前铺开，少数置顶或收起。 */
export function createBulkSampleNotes(now = Date.now()): Note[] {
  const notes: Note[] = [];
  let index = 0;
  for (const topic of TOPICS) {
    for (let n = 1; n <= topic.count; n += 1) {
      index += 1;
      const { title, body, extraTags } = topic.build(n);
      const tags = [topic.tag, ...(extraTags ?? [])].map((tag) => `#${tag}`).join(' ');
      // 从 3 小时前往前铺到约一年前：越往后的序号越早。
      const createdAt = now - (3 + index * index * 0.78) * HOUR;
      notes.push({
        id: `bulk-${String(index).padStart(3, '0')}`,
        text: canonicalize(`${title}\n\n${body}\n\n${tags}`),
        emoji: pick(topic.emoji, n),
        images: [],
        pinned: index % 29 === 0,
        collapsed: index % 17 === 0,
        status: 'active',
        previousStatus: 'active',
        order: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      });
    }
  }
  return notes;
}
