/* global process, console */
/**
 * 网站发布前的检查：GitHub Actions 发布前运行，本地也能跑（node docs/home-page/tools/check.mjs）。
 *
 * 1. Google 品牌验证依赖的几项：英文主页的 Search Console 验证标记、标题与 h1 里的应用名、主页上的隐私政策链接、
 *    说明 Google 用户数据用途的一节；隐私政策写明权限范围与有限使用声明。主页与隐私政策的地址不能变。
 * 2. 页面引用的本地文件（href、src、srcset、CSS 的 url()）都存在。
 * 3. 不从别的网站加载脚本、样式与字体：访客打开网站时不向第三方发请求。
 * 4. 每页都有语言、标题、描述与视口设置，图片都有替代文字。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认检查 ../public；也可以传入别的目录（例如试验改动时的副本）。
const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public'));
const PAGES = ['index.html', 'privacy.html', 'zh/index.html', 'zh/privacy.html', '404.html'];
const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

for (const file of [...PAGES, 'icon.png', 'sitemap.xml', 'assets/site.css', 'assets/site.js']) {
  if (!existsSync(join(ROOT, file))) fail(file, '文件不存在');
}

/** 本地地址对应的文件：去掉查询与锚点，目录指向 index.html，以 /SideNotes/ 开头的按站点根目录算。 */
function target(from, url) {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean) return null;
  const path = clean.startsWith('/SideNotes/') ? join(ROOT, clean.slice('/SideNotes/'.length)) : join(ROOT, dirname(from), clean);
  return existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
}

function checkLocal(file, url) {
  if (/^(https?:|mailto:|data:|#)/.test(url)) return;
  const path = target(file, url);
  if (path && !existsSync(path)) fail(file, `引用的 ${url} 不存在（${relative(ROOT, path)}）`);
}

for (const file of PAGES.filter((page) => existsSync(join(ROOT, page)))) {
  const html = read(file);
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) checkLocal(file, url);
  for (const [, set] of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const part of set.split(',')) checkLocal(file, part.trim().split(/\s+/)[0]);
  }
  // 分享卡片写的是线上的完整地址，对应到本地文件检查。
  for (const [, path] of html.matchAll(/<meta property="og:image" content="https:\/\/limuhua\.github\.io\/SideNotes\/([^"]+)"/g)) {
    if (!existsSync(join(ROOT, path))) fail(file, `分享卡片 ${path} 不存在`);
  }
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const url = tag.match(/\s(?:src|href)="([^"]+)"/)?.[1] ?? '';
    const rel = tag.match(/\srel="([^"]+)"/)?.[1] ?? '';
    if (/^https?:/.test(url) && (tag.startsWith('<script') || /stylesheet|preload|icon|modulepreload/.test(rel))) {
      fail(file, `从别的网站加载资源：${url}`);
    }
  }
  if (!/<html lang="[^"]+"/.test(html)) fail(file, '缺少 <html lang>');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(file, '缺少 <title>');
  if (!/<meta name="viewport"/.test(html)) fail(file, '缺少视口设置');
  if (file !== '404.html' && !/<meta name="description" content="[^"]+"/.test(html)) fail(file, '缺少描述');
  for (const [img] of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(img)) fail(file, `图片缺少 alt：${img.slice(0, 80)}`);
  }
}

const css = existsSync(join(ROOT, 'assets/site.css')) ? read('assets/site.css') : '';
for (const [, url] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
  if (url.startsWith('var(')) continue;
  if (/^https?:/.test(url)) fail('assets/site.css', `从别的网站加载资源：${url}`);
  else checkLocal('assets/site.css', url);
}
if (/@import/.test(css)) fail('assets/site.css', '不要用 @import 引入别的样式表');

// Google 品牌验证：英文主页（https://limuhua.github.io/SideNotes/）与隐私政策（privacy.html）。
if (existsSync(join(ROOT, 'index.html'))) {
  const home = read('index.html');
  if (!/<meta name="google-site-verification" content="[^"]+">/.test(home)) fail('index.html', '缺少 Google Search Console 的验证标记，品牌验证会失效');
  if (!/<html lang="en"/.test(home)) fail('index.html', '根目录的主页要是英文（给 Google 审查）');
  if (!/<title>SideNotes\b/.test(home)) fail('index.html', '<title> 要以应用名 SideNotes 开头');
  if (!/<h1[^>]*>[^<]*SideNotes/.test(home)) fail('index.html', 'h1 里要有应用名 SideNotes');
  if (!/href="privacy\.html"/.test(home)) fail('index.html', '主页要链接到隐私政策 privacy.html');
  if (!/id="google-user-data"/.test(home) || !text(home).includes('How SideNotes uses Google user data')) fail('index.html', '缺少说明 Google 用户数据用途的一节');
  if (!home.includes('https://www.googleapis.com/auth/drive.file')) fail('index.html', '没有写明申请的权限 drive.file');
}
if (existsSync(join(ROOT, 'privacy.html'))) {
  const privacy = text(read('privacy.html'));
  for (const phrase of ['SideNotes Privacy Policy', 'https://www.googleapis.com/auth/drive.file', 'Google API Services User Data Policy', 'Limited Use', 'Effective date']) {
    if (!privacy.includes(phrase)) fail('privacy.html', `隐私政策里缺少「${phrase}」`);
  }
}

if (problems.length) {
  console.error(`网站检查发现 ${problems.length} 个问题：\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`网站检查通过：${PAGES.length} 个页面。`);
