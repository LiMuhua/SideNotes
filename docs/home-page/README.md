# SideNotes 官网

官网是纯静态页面，发布在 <https://limuhua.github.io/SideNotes/>，没有构建步骤。英文版在根目录，给 Google 的品牌验证审查；中文版在 `zh/`，两套页面顶部互相切换。

## 目录

```
docs/home-page/
├── public/                 发布到 GitHub Pages 的全部文件
│   ├── index.html          英文主页（Google 品牌页填的主页）
│   ├── privacy.html        英文隐私政策（Google 品牌页填的隐私政策）
│   ├── zh/                 中文主页与隐私政策
│   ├── 404.html            地址不存在时显示的页面
│   ├── icon.png            应用图标（旧地址，保留）
│   ├── sitemap.xml         给搜索引擎的站点地图
│   └── assets/             样式、脚本、图标、字体、截图与分享卡片
└── tools/                  维护用的脚本，不发布
    ├── check.mjs           发布前检查，流水线也运行
    ├── serve.py            本地预览
    ├── shots.mjs           截取应用真实界面
    ├── fonts.py            生成网页字体
    └── social.py           生成分享卡片
```

## 本地预览

在仓库根目录运行：

```powershell
python -I docs/home-page/tools/serve.py
```

然后打开 <http://127.0.0.1:1440/SideNotes/>。与线上一样以 `/SideNotes/` 为根，找不到的地址显示 404 页；响应不缓存，改完文件刷新就是新的。`.claude/launch.json` 里的 `home-page` 是同一条命令。

## 修改须知

- 主页与隐私政策的地址不能变：Google 品牌页填的是 `https://limuhua.github.io/SideNotes/` 与 `https://limuhua.github.io/SideNotes/privacy.html`。
- 英文主页 `<head>` 里的 `google-site-verification` 标记证明网站归开发者所有，删掉之后 Search Console 的验证会失效，品牌验证跟着失效。
- 英文主页要保留这几项，检查程序据此判断：标题与 h1 里的应用名 SideNotes、功能说明、「How SideNotes uses Google user data」一节（含申请的权限 `drive.file`）、指向 `privacy.html` 的链接。
- 隐私政策照应用实际的数据处理写。云端同步的权限、存储方式或第三方服务变了，中英文隐私政策与主页的 Google 用户数据一节一起改，并更新生效日期。
- 中英文两套页面一起改。页面不从别的网站加载脚本、样式与字体，访客打开网站时不向第三方发请求；唯一的例外是下载按钮用 GitHub 的接口查询最新发布版。
- 下载按钮直接链接 `https://github.com/LiMuhua/SideNotes/releases/latest/download/SideNotes_x64-setup.exe`，文件名来自发布流水线（`.github/workflows/release.yml`，技术决策第 75 条），两边一起改。还没有发布版时，脚本把按钮改指向发布页。
- 改完运行检查：

```powershell
node docs/home-page/tools/check.mjs
```

## 素材

截图、字体与分享卡片都已提交，只有应用界面或文案变了才需要重新生成。

### 截图

`shots.mjs` 用无头 Edge 打开应用的浏览器预览，换上官网用的示例记录、主题与明暗后截图，存为 WebP。它不改应用源码，只在浏览器里替换两个开发模块：示例记录 `src/debug/sample-notes.ts` 与读库的兜底设置（`src/core/bridge.ts`）。应用的界面只有简体中文，英文页的截图也是中文界面，只有记录内容是英文。

磨砂玻璃照应用打开实时模糊时的样子截（技术决策第 76 条）：各块背后留空，着色的倍数用应用自己的 `tintScale` 按官网主题桌面的明暗算（`shots.mjs` 里的 TONES，桌面的颜色改了要重新量），另截一张各块的形状（`*-glass-mask.webp`），网页只在这些地方模糊桌面。

先在仓库根目录启动应用的开发服务器：

```powershell
pnpm dev
```

另开一个终端运行（可以带名字里的关键词只截一部分，例如 `en-`、`hero`）：

```powershell
node docs/home-page/tools/shots.mjs
```

Edge 不在默认位置时，用环境变量 `EDGE_PATH` 指定。

### 字体

标题、按键与首屏大字用应用自带的 Maple Mono（SIL OFL 1.1 许可证，见 `public/assets/fonts/OFL.txt`），只保留西文字形，每个字重约 11 KB；中文由系统字体显示。重新生成需要 fontTools 与 brotli：

```powershell
python -I docs/home-page/tools/fonts.py
```

### 分享卡片

`assets/social-en.jpg` 与 `social-zh.jpg` 是链接预览用的图片（1200×630），用首屏截图合成，需要 Pillow 与 fontTools：

```powershell
python -I docs/home-page/tools/social.py
```

## 发布

`.github/workflows/pages.yml` 在推送 `claude` 或 `master` 且改到 `docs/home-page/public/` 或检查脚本时，先运行 `check.mjs`，通过后把 `public/` 发布到 GitHub Pages；拉取请求只检查不发布，也可以在 Actions 页手动运行。仓库的 Pages 来源是 GitHub Actions，`github-pages` 环境只允许 `claude` 与 `master` 发布。

网站不跟应用的版本号走，用构建来认：发布时流水线把这次运行的编号、提交与构建时间写进 `site.js` 的占位，打开浏览器的控制台会看到一行「SideNotes 官网 构建 #编号（提交 abc1234），构建于 2026-11-23 13:16:20 UTC+8」；本地预览没经过流水线，打的是「本地预览」。

应用的安装程序由另一条流水线 `.github/workflows/release.yml` 发布：推送版本标签（如 `v0.8.2`）时构建，发布到 GitHub Releases，下载按钮链接的就是它。

## 设计

视觉来自应用图标：靛蓝的夜里，屏幕边上有一道透光的门缝，便签从缝里探出头来。

- 首屏与页尾是夜色，页面右边缘就是屏幕边缘。首屏的侧栏是应用的真实截图，从门缝里滑出；指针碰到右边缘或门缝里的便签、点击门缝或按 <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> 让它出入，离开侧栏 0.6 秒后自动收起，与应用的默认值相同。滑回是滑出的倒放。
- 侧栏收起后，门缝的光照亮便签周围，几粒浮尘往上飘；便签旁写着「指针推到这里」，下面是三个键帽，访客按下这几个键时跟着按下去。便签的眼睛跟着指针看。
- 主题一节的桌面跟着所选的明暗换成白天或夜里，半透明的主题在上面看得出背后被模糊的颜色。
- 中间的正文只用排版：标题用 Maple Mono，正文用系统字体（Windows 上是 Segoe UI 与微软雅黑）。
- 颜色取自图标：夜色 `#171C4C`、`#232A6E`、`#36419A`，门缝的光 `#FFEAB2`，便签黄 `#FFE170`、`#F3B744`。
- 没有脚本时内容完整，首屏的出场动画由 CSS 播放；系统设置了减少动态效果时不播放动画。
