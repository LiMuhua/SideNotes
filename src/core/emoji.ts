/**
 * 记录 Emoji 的分类目录、唯一分配与搜索。
 *
 * 数据与原型一致：十个分类，每项附中英文关键词供搜索；
 * 新记录从未占用的 Emoji 池中随机分配，池耗尽后使用短组合保证唯一。
 */

/** 一个候选 Emoji。 */
export interface EmojiItem {
  emoji: string;
  /** 搜索关键词，格式为「中文 英文」。 */
  keywords: string;
  category: string;
  /** 中文标签。 */
  label: string;
}

/** 分类定义。 */
export interface EmojiGroup {
  id: string;
  label: string;
}

const GROUP_SOURCE: Array<[string, string, string]> = [
  [
    'faces',
    '表情',
    '😀 开心 smile|😃 高兴 happy|😄 微笑 grin|😁 齿笑 beam|😆 大笑 laugh|😅 汗笑 sweat|😂 笑哭 joy|🤣 捧腹 rofl|😊 害羞 blush|🙂 微笑 slight|🙃 倒脸 upside|😉 眨眼 wink|😍 喜爱 love|🥰 爱心 hearts|😘 亲吻 kiss|😗 嘟嘴 kissing|😋 美味 tasty|😛 吐舌 tongue|😜 调皮 playful|🤪 搞怪 zany|😎 墨镜 cool|🤓 书呆 nerd|🧐 观察 monocle|🤔 思考 thinking|🤨 怀疑 eyebrow|😐 平静 neutral|😶 无语 silent|😏 得意 smirk|🙄 白眼 roll|😌 放松 relaxed|😔 沉思 pensive|😴 睡觉 sleeping|🥱 困倦 yawn|🤤 流口水 drool|😪 疲倦 tired|😷 口罩 mask|🤒 发烧 ill|🤕 受伤 injured|🤢 恶心 sick|🤧 喷嚏 sneeze|🥵 热 hot|🥶 冷 cold|😵 眩晕 dizzy|🤯 惊讶 exploding|😮 张嘴 surprise|😯 吃惊 hush|😲 震惊 astonish|😳 脸红 flushed|🥺 请求 pleading|😢 哭泣 sad|😭 大哭 crying|😤 努力 triumph|😠 生气 angry|🤬 愤怒 swear|😈 小恶魔 devil|👻 幽灵 ghost|👽 外星人 alien|🤖 机器人 robot|🎃 南瓜 pumpkin|😺 笑猫 cat',
  ],
  [
    'nature',
    '自然',
    '🌱 幼苗 seedling|🌿 草本 herb|🍀 四叶草 clover|☘️ 三叶草 shamrock|🌵 仙人掌 cactus|🌴 棕榈 palm|🌳 树木 tree|🌲 松树 evergreen|🍁 枫叶 maple|🍂 落叶 fallen|🍃 风叶 leaf|🌸 樱花 blossom|🌺 木槿 hibiscus|🌹 玫瑰 rose|🌷 郁金香 tulip|🌼 花朵 daisy|🌻 向日葵 sunflower|🪴 盆栽 plant|🍄 蘑菇 mushroom|🌾 稻穗 rice|🌈 彩虹 rainbow|☀️ 太阳 sun|🌤️ 晴天 sunny|☁️ 云 cloud|🌧️ 雨 rain|⛈️ 雷雨 storm|❄️ 雪 snow|🔥 火 fire|💧 水滴 water|🌊 海浪 wave|🌙 月亮 moon|⭐ 星 star|🌟 闪亮 sparkle|✨ 星光 stars|☄️ 彗星 comet|🌍 地球 earth|🌕 满月 fullmoon|🪐 土星 saturn',
  ],
  [
    'animals',
    '动物',
    '🐶 狗 dog|🐱 猫 cat|🐭 鼠 mouse|🐹 仓鼠 hamster|🐰 兔 rabbit|🦊 狐狸 fox|🐻 熊 bear|🐼 熊猫 panda|🐨 考拉 koala|🐯 老虎 tiger|🦁 狮子 lion|🐮 牛 cow|🐷 猪 pig|🐸 青蛙 frog|🐵 猴 monkey|🐔 鸡 chicken|🐧 企鹅 penguin|🐦 鸟 bird|🐤 小鸡 chick|🦆 鸭 duck|🦉 猫头鹰 owl|🦅 鹰 eagle|🦋 蝴蝶 butterfly|🐝 蜜蜂 bee|🐞 瓢虫 ladybug|🐌 蜗牛 snail|🐢 乌龟 turtle|🐬 海豚 dolphin|🐳 鲸 whale|🐙 章鱼 octopus|🦀 螃蟹 crab|🐟 鱼 fish|🐠 热带鱼 tropical|🦈 鲨鱼 shark|🦄 独角兽 unicorn|🐴 马 horse|🦒 长颈鹿 giraffe|🐘 大象 elephant|🦔 刺猬 hedgehog|🐿️ 松鼠 squirrel',
  ],
  [
    'food',
    '饮食',
    '🍎 苹果 apple|🍐 梨 pear|🍊 橘子 orange|🍋 柠檬 lemon|🍌 香蕉 banana|🍉 西瓜 watermelon|🍇 葡萄 grape|🍓 草莓 strawberry|🫐 蓝莓 blueberry|🍒 樱桃 cherry|🍑 桃 peach|🥭 芒果 mango|🍍 菠萝 pineapple|🥝 猕猴桃 kiwi|🥑 牛油果 avocado|🥕 胡萝卜 carrot|🌽 玉米 corn|🥦 西兰花 broccoli|🥬 生菜 greens|🥒 黄瓜 cucumber|🍞 面包 bread|🥐 牛角 croissant|🥨 椒盐卷 pretzel|🧀 奶酪 cheese|🍕 披萨 pizza|🍔 汉堡 burger|🍟 薯条 fries|🌮 塔可 taco|🍜 面条 noodles|🍣 寿司 sushi|🍚 米饭 rice|🥟 饺子 dumpling|🍦 冰淇淋 icecream|🍰 蛋糕 cake|🍪 饼干 cookie|🍩 甜甜圈 donut|🍫 巧克力 chocolate|🍯 蜂蜜 honey|☕ 咖啡 coffee|🍵 茶 tea|🧋 奶茶 bubbletea|🧃 果汁 juice',
  ],
  [
    'work',
    '工作',
    '📝 记录 note|📒 笔记本 notebook|📓 日记 journal|📔 书册 book|📕 红书 redbook|📗 绿书 greenbook|📘 蓝书 bluebook|📙 橙书 orangebook|📚 书籍 books|📖 阅读 read|📋 清单 clipboard|📌 图钉 pin|📍 标记 location|📎 回形针 paperclip|🖇️ 链接 clips|📁 文件夹 folder|📂 打开文件 openfolder|🗂️ 分类 folders|🗃️ 卡盒 cardbox|🗄️ 文件柜 cabinet|📅 日历 calendar|🗓️ 日程 schedule|📊 图表 chart|📈 上升 growth|📉 下降 decrease|📐 三角尺 ruler|📏 直尺 measure|✏️ 铅笔 pencil|🖊️ 钢笔 pen|🖋️ 毛笔 fountain|🖌️ 画笔 brush|🖍️ 蜡笔 crayon|🔖 书签 bookmark|🏷️ 标签 label|📑 页签 tabs|📄 文件 document|📃 页面 page|📜 卷轴 scroll|✉️ 邮件 mail|📧 邮箱 email|📦 包裹 package|💼 公文包 briefcase',
  ],
  [
    'tech',
    '科技',
    '💻 电脑 laptop|🖥️ 显示器 desktop|⌨️ 键盘 keyboard|🖱️ 鼠标 mouse|📱 手机 phone|📲 通知 mobile|💾 磁盘 disk|💿 光盘 cd|📀 DVD disc|📸 相机 camera|📷 摄影 photo|🎥 摄像机 movie|📹 录像 video|🎬 场记 action|🎞️ 胶片 film|📺 电视 tv|📻 收音机 radio|🎙️ 麦克风 microphone|🎧 耳机 headphones|🔊 音量 sound|🔋 电池 battery|🔌 插头 plug|💡 灯泡 idea|🔦 手电 torch|🔍 搜索 search|🔎 查找 find|🔧 扳手 wrench|🔨 锤 hammer|🛠️ 工具 tools|⚙️ 设置 gear|🧰 工具箱 toolbox|🧲 磁铁 magnet|🧪 试管 test|🧬 DNA science|🔬 显微镜 microscope|🔭 望远镜 telescope|🛰️ 卫星 satellite|🚀 火箭 rocket|🛸 飞碟 ufo|🧮 算盘 abacus',
  ],
  [
    'life',
    '生活',
    '🏠 家 home|🏡 花园 house|🏢 办公 office|🏫 学校 school|🏛️ 博物馆 museum|🏥 医院 hospital|🏕️ 露营 camp|⛺ 帐篷 tent|🏖️ 海滩 beach|🏝️ 小岛 island|🏔️ 山脉 mountain|🗻 富士山 fuji|🎡 摩天轮 wheel|🎢 过山车 coaster|🎠 旋转木马 carousel|🚲 自行车 bike|🛴 滑板车 scooter|🚗 汽车 car|🚌 公交 bus|🚆 火车 train|✈️ 飞机 plane|⛵ 帆船 boat|🗺️ 地图 map|🧭 指南针 compass|🎒 背包 backpack|🧳 行李 suitcase|☂️ 雨伞 umbrella|👟 鞋 shoes|🧣 围巾 scarf|🧤 手套 gloves|🧦 袜子 socks|🛏️ 床 bed|🪑 椅子 chair|🛋️ 沙发 sofa|🪟 窗户 window|🪴 花盆 potted|🪞 镜子 mirror|🔑 钥匙 key|🔒 锁 lock|🔓 解锁 unlock',
  ],
  [
    'activities',
    '活动',
    '🎯 目标 target|🏆 奖杯 trophy|🏅 奖牌 medal|🥇 第一 first|🎖️ 荣誉 honor|🎨 调色板 palette|🎭 戏剧 theatre|🎪 马戏 circus|🎟️ 门票 ticket|🎤 唱歌 sing|🎵 音符 music|🎶 旋律 melody|🎹 钢琴 piano|🎸 吉他 guitar|🎻 小提琴 violin|🥁 鼓 drum|🎺 小号 trumpet|🎷 萨克斯 sax|🎲 骰子 dice|🧩 拼图 puzzle|♟️ 国际象棋 chess|🎮 游戏 game|🕹️ 摇杆 joystick|⚽ 足球 soccer|🏀 篮球 basketball|🏈 橄榄球 football|⚾ 棒球 baseball|🎾 网球 tennis|🏐 排球 volleyball|🎱 台球 billiard|🏓 乒乓球 pingpong|🏸 羽毛球 badminton|🥊 拳击 boxing|🥋 武术 martial|🏹 射箭 archery|⛳ 高尔夫 golf|🎣 钓鱼 fishing|🎿 滑雪 ski|🛹 滑板 skateboard|🛼 轮滑 skate',
  ],
  [
    'symbols',
    '符号',
    '❤️ 爱心 heart|🧡 橙心 orangeheart|💛 黄心 yellowheart|💚 绿心 greenheart|💙 蓝心 blueheart|💜 紫心 purpleheart|🖤 黑心 blackheart|🤍 白心 whiteheart|🤎 棕心 brownheart|💖 闪心 sparkling|💕 双心 twohearts|💗 心动 growing|💝 礼物 giftheart|✅ 完成 done|☑️ 勾选 check|❌ 错误 cross|⭕ 圆圈 circle|❗ 重要 important|❓ 问题 question|💯 满分 hundred|🔴 红色 red|🟠 橙色 orange|🟡 黄色 yellow|🟢 绿色 green|🔵 蓝色 blue|🟣 紫色 purple|⚫ 黑色 black|⚪ 白色 white|🟤 棕色 brown|🔶 橙菱 diamond|🔷 蓝菱 bluediamond|🔺 上升 triangle|🔻 下降 down|🔔 铃铛 bell|🔕 静音 silent|♻️ 回收 recycle|🌐 网络 web|💬 对话 chat|💭 思想 thought|📣 广播 announce',
  ],
];

/** 全部候选，按分类顺序去重。 */
export const EMOJI_ITEMS: EmojiItem[] = (() => {
  const seen = new Set<string>();
  const items: EmojiItem[] = [];
  GROUP_SOURCE.forEach(([category, , source]) => {
    source.split('|').forEach((entry) => {
      const split = entry.indexOf(' ');
      const emoji = entry.slice(0, split);
      if (seen.has(emoji)) return;
      seen.add(emoji);
      const keywords = entry.slice(split + 1);
      items.push({ emoji, keywords, category, label: keywords.split(' ')[0] });
    });
  });
  return items;
})();

/** 分类列表，附「全部」由界面自行添加。 */
export const EMOJI_GROUPS: EmojiGroup[] = GROUP_SOURCE.map(([id, label]) => ({ id, label }));

/** 校验保存的 Emoji 字符。 */
export function isValidEmoji(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 32 &&
    /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|️|‍|⃣|[0-9#*])+$/u.test(
      value,
    )
  );
}

/**
 * 从未占用池随机分配 Emoji。
 *
 * 池耗尽后拼接多个 Emoji 作为短组合，保证列表内始终不重复。
 */
export function pickEmoji(used: Iterable<string>): string {
  const taken = new Set(used);
  const available = EMOJI_ITEMS.filter((item) => !taken.has(item.emoji));
  if (available.length) return available[Math.floor(Math.random() * available.length)].emoji;

  const total = EMOJI_ITEMS.length;
  const seed = Math.floor(Math.random() * total * total);
  for (let tries = 0; ; tries += 1) {
    let remainder = seed + tries;
    let emoji = '';
    do {
      emoji = EMOJI_ITEMS[remainder % total].emoji + emoji;
      remainder = Math.floor(remainder / total);
    } while (remainder > 0);
    if (!taken.has(emoji)) return emoji;
  }
}

/** 搜索指定分类的 Emoji。 */
export function searchEmoji(query = '', category = 'all'): EmojiItem[] {
  const keyword = query.trim().toLocaleLowerCase();
  return EMOJI_ITEMS.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (!keyword || item.emoji.includes(keyword) || item.keywords.toLocaleLowerCase().includes(keyword)),
  );
}
