/* global process, Buffer, console, fetch, WebSocket */
/**
 * 官网截图：用无头 Edge 打开应用的浏览器预览（先在仓库根目录运行 `pnpm dev`，1420 端口），截取真实界面，存为 WebP。
 *
 * 不改应用源码，通过 CDP 拦截两个开发模块：
 * - `src/debug/sample-notes.ts` 换成下面的示例记录（中英文各一套，内容随页面语言）；
 * - `src/core/bridge.ts` 里读库的兜底设置换成指定的主题、明暗与草稿。
 * 应用的界面文字只有简体中文，英文页的截图也是中文界面，只有记录内容是英文。
 *
 * 用法：node docs/home-page/tools/shots.mjs [只截名字里含这些词的图，逗号分隔]
 * Edge 不在默认位置时用环境变量 EDGE_PATH 指定。截图写到 public/assets/shots/。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'public', 'assets', 'shots');
const APP = 'http://localhost:1420/';
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
/** WebP 质量：界面文字在 86 以上才看不出压缩痕迹。 */
const QUALITY = 88;

const H = 60; // 示例记录的 ago 以分钟计
const D = 24 * H;

/** 示例记录：固定的标签不用在记录上，全部记录都留在「随记」页签里。 */
const CONTENT = {
  zh: {
    pinnedTags: ['工作', '阅读', '旅行'],
    notes: [
      { emoji: '✅', ago: 25, pinned: true, text: '今日待办\n\n- [x] 回复设计稿的修改意见\n- [x] 预约周四下午的牙医\n- [ ] 整理本周周报\n- [ ] 晚上给妈妈打电话' },
      { emoji: '⌨️', ago: 48, text: '常用命令 #命令\n\n```bash\npnpm tauri build\ngit log --oneline -5\n```' },
      { emoji: '🔗', ago: 3 * H, text: '稍后读 #链接\n\n- [Tauri 2 入门](https://v2.tauri.app/start/)\n- [CommonMark 速查](https://commonmark.org/help/)' },
      { emoji: '📋', ago: 1 * D + 2 * H, text: '周会纪要 #会议\n\n1. 发布日期定在下周三\n2. 安装包签名由小周负责\n3. 下次周会改到周五上午' },
      { emoji: '💡', ago: 2 * D, text: '周末把书架按颜色重新排一遍 #生活' },
      { emoji: '☕', ago: 3 * D, text: '咖啡豆采购清单 #生活\n\n- 耶加雪菲\n- 哥伦比亚水洗\n- 巴西半日晒' },
      { emoji: '🧾', ago: 3 * D + 5 * H, text: '报销 #财务\n\n出租车 46 元、午餐 38 元，周五前交' },
      { emoji: '🎨', ago: 4 * D, text: '配色备忘 #设计\n\n夜空 `#1D2156`，便签黄 `#F6C744`' },
      { emoji: '🎂', ago: 6 * D, text: '小林的生日是 12 月 3 日 #提醒' },
    ],
    draft: '周五前把发票寄给财务 #待办\n\n- 打印两份\n- 附上报销单',
  },
  en: {
    pinnedTags: ['work', 'books', 'trips'],
    notes: [
      { emoji: '✅', ago: 25, pinned: true, text: 'Today\n\n- [x] Reply to the design review\n- [x] Book the dentist for Thursday\n- [ ] Write the weekly report\n- [ ] Call Mom tonight' },
      { emoji: '⌨️', ago: 48, text: 'Handy commands #cli\n\n```bash\npnpm tauri build\ngit log --oneline -5\n```' },
      { emoji: '🔗', ago: 3 * H, text: 'Read later #links\n\n- [Tauri 2 quick start](https://v2.tauri.app/start/)\n- [CommonMark help](https://commonmark.org/help/)' },
      { emoji: '📋', ago: 1 * D + 2 * H, text: 'Weekly sync #meetings\n\n1. Release moves to next Wednesday\n2. Sam signs the installer\n3. Next sync: Friday morning' },
      { emoji: '💡', ago: 2 * D, text: 'Sort books by color #home' },
      { emoji: '☕', ago: 3 * D, text: 'Coffee beans to buy #home\n\n- Yirgacheffe\n- Colombia, washed\n- Brazil, pulped natural' },
      { emoji: '🧾', ago: 3 * D + 5 * H, text: 'Expenses #finance\n\nTaxi $18 and lunch $14, due Friday' },
      { emoji: '🎨', ago: 4 * D, text: 'Palette notes #design\n\nNight `#1D2156`, note yellow `#F6C744`' },
      { emoji: '🎂', ago: 6 * D, text: "Lin's birthday is December 3 #reminders" },
    ],
    draft: 'Send the invoices to finance by Friday #todo\n\n- Print two copies\n- Attach the expense form',
  },
};

const SURFACES = ['terminal', 'magazine', 'paper', 'win11', 'glass'];
const MODES = ['light', 'dark'];

/**
 * 官网主题桌面上侧栏背后的明暗（相对亮度的第 5、第 95 百分位）：浅色截图摆在白天的桌面上，深色摆在夜里的桌面上。
 * 照应用的做法量出（glass.rs 的 tone_of 与 gap_tone：按 12px 模糊后取百分位，再与不模糊的取更宽的范围），
 * 桌面的样式（site.css 的 .theme-desk）改了要重新量。
 */
const TONES = { light: { low: 0.56, high: 0.97 }, dark: { low: 0.015, high: 0.067 } };

/**
 * 磨砂玻璃照应用打开实时模糊时的样子截（App.tsx）：各块背后的模糊换成透明（官网在截图底下实时模糊桌面），
 * 各块的着色按背后的明暗调淡，倍数用应用自己的 tintScale 算（core/glassTone.ts，文字色与 App.tsx 的 GLASS_TEXT_TOKENS 相同）。
 */
function glassScript(theme) {
  return `(async () => {
    const root = document.documentElement;
    root.style.setProperty('--glass-backdrop', 'linear-gradient(transparent, transparent)');
    root.dataset.glassBackdrop = '';
    const { tintScale, cssColor } = await import('/src/core/glassTone.ts');
    const tokens = getComputedStyle(root);
    const card = cssColor(tokens.getPropertyValue('--sn-color-card'));
    const texts = ['--sn-color-text', '--sn-color-text-secondary', '--sn-color-text-muted', '--sn-color-accent-text']
      .map((name) => cssColor(tokens.getPropertyValue(name)))
      .filter(Boolean);
    const scale = tintScale(${JSON.stringify(TONES[theme])}, card, texts);
    root.style.setProperty('--glass-tint-scale', String(scale));
    await new Promise((done) => setTimeout(done, 1000));
    return 'tint ' + scale;
  })()`;
}

/** 磨砂玻璃各块的形状：块涂成不透明、去掉文字与投影再截一张，官网只在这些地方模糊桌面（site.css 的 --shape）。 */
const MASK_SCRIPT = `(async () => {
  document.documentElement.style.setProperty('--glass-backdrop', 'linear-gradient(#000, #000)');
  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { color: transparent !important; text-shadow: none !important; box-shadow: none !important; outline: none !important; border-color: transparent !important; } img, svg { visibility: hidden !important; }';
  document.head.append(style);
  await new Promise((done) => setTimeout(done, 400));
  return true;
})()`;

/** 截图任务：clip 为网页像素的截取范围，clipSelector 截取元素所在的矩形。 */
function jobs() {
  const list = [];
  for (const lang of ['zh', 'en']) {
    const content = CONTENT[lang];
    const base = (surface, theme) => ({ surface, theme, guideSeen: true, pinnedTags: content.pinnedTags, edge: 'right' });
    for (const theme of MODES) {
      // 首屏：终端主题（默认）的侧栏，截得比屏幕高，页面只露出上面一段。
      list.push({ name: `${lang}-hero-${theme}`, width: 400, height: 1400, clip: { x: 0, y: 0, width: 400, height: 1150 }, query: '?debug-data=1', settings: base('terminal', theme), ...content });
      // 速记浮窗，带一段草稿。
      list.push({ name: `${lang}-capture-${theme}`, width: 560, height: 420, query: '?window=capture&debug-data=1', settings: base('terminal', theme), ...content, draft: { text: content.draft, images: [], updatedAt: Date.now() } });
      for (const surface of SURFACES) {
        const glass = surface === 'glass' ? { script: glassScript(theme), ...(theme === 'light' ? { mask: `${lang}-glass-mask` } : {}) } : {};
        list.push({ name: `${lang}-${surface}-${theme}`, width: 400, height: 900, query: '?debug-data=1', settings: base(surface, theme), ...content, ...glass });
      }
    }
  }
  // 设置里的云端同步：界面只有中文、没有记录内容，两种语言共用；选中 Google Drive 那一张卡片。
  for (const theme of MODES) {
    list.push({
      name: `sync-${theme}`,
      width: 880,
      height: 640,
      query: '?window=settings&debug-data=1',
      settings: { surface: 'terminal', theme, guideSeen: true },
      notes: [],
      pinnedTags: [],
      background: { r: 255, g: 255, b: 255, a: 1 },
      script: `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('数据与同步')).click();
        await wait(500);
        const panel = document.querySelector('[role=tabpanel]');
        const title = [...panel.querySelectorAll('h3,h4')].find((h) => h.textContent.trim() === '云端同步');
        const card = title.closest('section.settings-group') ?? title.closest('section');
        const google = [...card.querySelectorAll('button, [role=radio], label')].find((el) => /Google Drive/.test(el.textContent));
        google?.click();
        await wait(400);
        card.scrollIntoView({ block: 'center' });
        await wait(300);
        card.dataset.siteShot = '1';
        return true;
      })()`,
      clipSelector: '[data-site-shot]',
      clipPad: 0,
    });
  }
  return list;
}

/** 示例记录模块：替换应用的 src/debug/sample-notes.ts，导出名与原模块一致。 */
function notesModule(job) {
  return `import { canonicalize } from '/src/core/tags.ts';
export const SAMPLE_PINNED_TAGS = ${JSON.stringify(job.pinnedTags ?? [])};
export const DEBUG_DATA_KEY = 'sidenotes:debug-data';
export const DEBUG_DATA_PARAM = 'debug-data';
export function shouldLoadSampleData() { return ${JSON.stringify((job.notes ?? []).length > 0)}; }
const SEEDS = ${JSON.stringify(job.notes ?? [])};
export function createSampleNotes(now = Date.now()) {
  return SEEDS.map((s, i) => {
    const t = now - s.ago * 60000;
    return { id: 'site-' + i, text: canonicalize(s.text), emoji: s.emoji, images: [], pinned: !!s.pinned, collapsed: false,
      status: 'active', previousStatus: 'active', order: null, createdAt: t, updatedAt: t, deletedAt: null };
  });
}
`;
}

/** 把读库兜底值里的 settings、draft 换成任务指定的值。 */
function patchBridge(text, job) {
  const at = text.indexOf('"load_snapshot"');
  if (at < 0) throw new Error('bridge.ts 里找不到 load_snapshot，应用的读库代码可能改了');
  const replace = (source, key, value) => {
    const token = `${key}: {}`;
    const index = source.indexOf(token, at);
    if (index < 0) throw new Error(`bridge.ts 的读库兜底值里找不到 ${token}`);
    return source.slice(0, index) + `${key}: ${JSON.stringify(value)}` + source.slice(index + token.length);
  };
  let out = replace(text, 'settings', job.settings);
  if (job.draft) out = replace(out, 'draft', job.draft);
  return out;
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Edge 还没起来，稍后再试。
    }
    await sleep(250);
  }
  throw new Error('连不上无头 Edge');
}

async function main() {
  const filters = (process.argv[2] ?? '').split(',').filter(Boolean);
  const todo = jobs().filter((job) => !filters.length || filters.some((word) => job.name.includes(word)));
  try {
    await fetch(APP);
  } catch {
    throw new Error(`打不开 ${APP}：先在仓库根目录运行 pnpm dev`);
  }
  mkdirSync(OUT, { recursive: true });
  const profile = join(tmpdir(), `sidenotes-site-shots-${process.pid}`);
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });

  const ws = new WebSocket(await connect());
  await new Promise((done) => ws.addEventListener('open', done, { once: true }));
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
      else waiter.resolve(msg.result);
    } else {
      for (const fn of handlers.get(msg.method) ?? []) fn(msg.params);
    }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, reject) => pending.set(id, { resolve: resolveCall, reject }));
  };
  const once = (method) => new Promise((done) => {
    const list = handlers.get(method) ?? [];
    const fn = (params) => {
      handlers.set(method, (handlers.get(method) ?? []).filter((item) => item !== fn));
      done(params);
    };
    handlers.set(method, [...list, fn]);
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  let current = null;
  handlers.set('Fetch.requestPaused', [async (paused) => {
    const url = paused.request.url;
    const headers = [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }];
    try {
      if (url.includes('/src/debug/sample-notes.ts')) {
        await send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(notesModule(current)).toString('base64') });
      } else if (url.includes('/src/core/bridge.ts') && paused.responseStatusCode) {
        const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId: paused.requestId });
        const text = patchBridge(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body, current);
        await send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(text).toString('base64') });
      } else {
        await send('Fetch.continueRequest', { requestId: paused.requestId });
      }
    } catch (error) {
      console.error('拦截失败', url, error.message);
      process.exitCode = 1;
      await send('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => {});
    }
  }]);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/src/debug/sample-notes.ts*', requestStage: 'Request' },
      { urlPattern: '*/src/core/bridge.ts*', requestStage: 'Response' },
    ],
  });

  for (const job of todo) {
    current = job;
    await send('Emulation.setDeviceMetricsOverride', { width: job.width, height: job.height, deviceScaleFactor: 2, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: job.settings.theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: job.background ?? { r: 0, g: 0, b: 0, a: 0 } });
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: APP + job.query });
    await loaded;
    await evaluate('document.fonts.ready.then(() => true)');
    await sleep(1500);
    const note = job.script ? await evaluate(job.script) : null;
    let clip = job.clip ? { ...job.clip, scale: 1 } : undefined;
    if (job.clipSelector) {
      const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(job.clipSelector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const pad = job.clipPad ?? 0;
      clip = { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, scale: 1 };
    }
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: QUALITY, captureBeyondViewport: false, ...(clip ? { clip } : {}) });
    const file = join(OUT, `${job.name}.webp`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('已截图', job.name, clip ? `${Math.round(clip.width)}×${Math.round(clip.height)}` : `${job.width}×${job.height}`, typeof note === 'string' ? note : '');
    if (job.mask) {
      await evaluate(MASK_SCRIPT);
      const mask = await send('Page.captureScreenshot', { format: 'webp', quality: QUALITY, captureBeyondViewport: false });
      writeFileSync(join(OUT, `${job.mask}.webp`), Buffer.from(mask.data, 'base64'));
      console.log('已截图', job.mask);
    }
  }

  ws.close();
  edge.kill();
  await sleep(800);
  rmSync(profile, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
