/**
 * 应用图标页的说明文字与设计演进记录。
 *
 * 定稿图标的清单与资源在 model/appIcons.ts；这里只放展示用的说明：每个定稿图标的想法、所属的一族与演进线，
 * 以及按轮次留下的历史图标（docs/design-system/icon-history/）。完整过程见 docs/tasks.md 的 DS01 进度。
 */

export type FamilyId = 'door-indigo' | 'door-warm' | 'stack' | 'fan';

/** 每个定稿图标的说明与所属的一族（同一族共用一条演进线）。 */
export const FINAL_NOTES: Readonly<Record<string, { family: FamilyId; idea: string }>> = {
  'door-smile-indigo': {
    family: 'door-indigo',
    idea: '靛蓝暗房里，一张便签从门缝探出来浅笑，旁边三颗星点；折角像一只小手。配色和第一版「探头的便签」一脉相承，在浅色与深色任务栏上都分得开。',
  },
  'door-plain-indigo': { family: 'door-indigo', idea: '和 211 同一场景，平视，配两颗星点，更安静。' },
  'door-smile-warm': { family: 'door-warm', idea: '暖色暗房，门缝透出暖光，便签浅笑，配三颗星点。暗底接近深色任务栏，轮廓比靛蓝两款弱。' },
  'door-plain-warm': { family: 'door-warm', idea: '暖色暗房，平视，配两颗星点。' },
  'stack-smile': { family: 'stack', idea: '一叠便签从屏幕边上探出来，最前面那张浅笑，配三颗星点：记下的不止一条。' },
  'fan-swish': { family: 'fan', idea: '最前面那张便签留下两道残影，像是唰地一下落到手边；没有表情，是最克制的一款。' },
};

/** 每一族的演进线：从原稿到定稿前一轮，每一步可以是几版的结合。 */
export const FAMILIES: Readonly<Record<FamilyId, { name: string; steps: ReadonlyArray<readonly string[]> }>> = {
  'door-indigo': { name: '门缝 · 靛蓝', steps: [['15', '00'], ['164'], ['177'], ['197'], ['206']] },
  'door-warm': { name: '门缝 · 暖', steps: [['15', '00'], ['163'], ['176'], ['207', '208']] },
  stack: { name: '一叠', steps: [['00', '10'], ['168'], ['173'], ['193'], ['203']] },
  fan: { name: '叠纸', steps: [['10']] },
};

/** 留作记录的历史图标：编号、文件与名称。 */
export const HISTORY_ICONS: Readonly<Record<string, { file: string; name: string }>> = {
  '00': { file: '00.svg', name: '探头的便签' },
  '10': { file: '10-paper-fan.svg', name: '叠纸' },
  '15': { file: '15-door-light.svg', name: '门缝的光' },
  '21': { file: '21-note-moon.svg', name: '月相便签' },
  '163': { file: '163-door-note.svg', name: '门缝便签' },
  '164': { file: '164-door-note-indigo.svg', name: '门缝便签 · 靛蓝' },
  '168': { file: '168-peek-stack.svg', name: '一叠探头' },
  '173': { file: '173-stack-spark.svg', name: '一叠探头 · 灵光' },
  '176': { file: '176-door-note-lit.svg', name: '门缝便签 · 光影修正' },
  '177': { file: '177-door-spark.svg', name: '门缝便签 · 灵光' },
  '180': { file: '180-calm-dots.svg', name: '探头 · 圆点（克制）' },
  '188': { file: '188-lively-stars.svg', name: '一叠 · 闪亮眼（生动）' },
  '193': { file: '193-mid-stack-smile.svg', name: '一叠 · 浅笑（居中）' },
  '197': { file: '197-mid-door-curious.svg', name: '门缝 · 好奇（居中）' },
  '203': { file: '203-fine-stack-smile.svg', name: '一叠 · 浅笑（细化）' },
  '206': { file: '206-fine-door-cluster.svg', name: '门缝星点 · 靛蓝' },
  '207': { file: '207-fine-warm-smile.svg', name: '门缝浅笑 · 暖' },
  '208': { file: '208-fine-warm-plain.svg', name: '门缝平视 · 暖' },
};

/**
 * 设计演进：每一轮的做法与取舍，icons 里是历史图标的编号，或定稿图标的 id（显示为定稿）。
 * 第一轮的 12 个品牌符号已经撤下，只留文字，文件在提交 f1bd1c8 中。
 */
export const ROUNDS: ReadonlyArray<{ title: string; note: string; icons: readonly string[] }> = [
  {
    title: '起点 · 四个原稿',
    note: '第一版应用图标「探头的便签」（00）：一张黄色便签从靛蓝屏幕的右边缘探出头来；另外三个原稿来自更早的候选：叠纸（10）、门缝的光（15）、月相便签（21）。',
    icons: ['00', '10', '15', '21'],
  },
  {
    title: '第一轮 · 品牌符号（151–162）',
    note: '按「不用笔记符号、追求独特的品牌符号」画了 12 个成品（浪、鲸尾、一线天等）。用户认为都不合适，要求回到四个原稿，用点缀、变体与结合的方式深化。',
    icons: [],
  },
  {
    title: '第二轮 · 在原稿上深化（163–172）',
    note: '门缝里递出一张便签（163，靛蓝变体 164）；一叠便签从屏幕边上探头（168）；叠纸留下两道残影（172，后来直接定稿）。',
    icons: ['163', '164', '168', 'fan-swish'],
  },
  {
    title: '第三轮 · 结合与光影（173–179）',
    note: '叠纸、表情与门缝互相结合。门缝便签原来像正面打光，改为门缝整条在便签后面，便签靠门缝的一端最亮、往左渐暗，边缘透出亮边。',
    icons: ['173', '176', '177'],
  },
  {
    title: '第四轮 · 表情（180–202）',
    note: '先试两端：克制（180）太死板，生动（188）太浮夸、偏幼态。最后取中间（193、197）：眼睛比圆点大、只留一个小高光，表情靠浅笑与抬眼，腮红很淡。',
    icons: ['180', '188', '193', '197'],
  },
  {
    title: '第五轮 · 细化（203–209）',
    note: '一叠收细节，折角下加阴影；门缝版的背光不再发棕，光晕收紧，灵光换成星点（206）；暖色版补上居中表情（207、208）。',
    icons: ['203', '206', '207', '208'],
  },
  {
    title: '第六轮 · 定稿（210–214）',
    note: '浅笑配三颗星，平视配两颗星；门缝版的折角放大、换成浅色并加一道阴影，像一只小手。连同 172 定为六个内置图标，默认 211。',
    icons: ['stack-smile', 'door-smile-indigo', 'door-plain-indigo', 'door-smile-warm', 'door-plain-warm'],
  },
];

/** 每个尺寸主要用在哪里（Windows 按 100% 缩放计）。 */
export const SIZE_USES: Readonly<Record<number, string>> = {
  16: '托盘、标题栏',
  20: '托盘 125%',
  22: 'Linux 托盘',
  24: '任务栏、托盘 150%',
  32: '任务栏 125–150%、托盘 200%',
  40: '任务栏 175%',
  48: '桌面、任务栏 200%',
  64: '程序坞',
  96: '资源管理器大图标',
  128: 'Linux 应用列表',
  256: '资源管理器超大图标、安装包',
  512: '应用商店与宣传图',
};
