/* global document, matchMedia, fetch, setTimeout, clearTimeout, URL, localStorage */
/**
 * SideNotes 官网的交互。全部是锦上添花：没有脚本时内容完整，首屏的出场动画也由 CSS 播放。
 *
 * 1. 首屏的屏幕边缘：指针碰到右边缘或悬停门缝时侧栏滑出，离开侧栏 0.6 秒后滑回（与应用的默认值相同）；
 *    点击门缝或按 Alt+Shift+S 切换，这样打开的不会自动收起。
 * 2. 主题：选主题与明暗，原来的侧栏滑回，换上新主题再滑出。
 * 3. 下载：GitHub 上有发布版时，下载按钮直接指向 Windows 安装程序，并写出版本号。
 */
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const SLIDE = 460; // 与 site.css 的 --slide 一致

  /* ---------- 1. 首屏的屏幕边缘 ---------- */
  const edge = document.querySelector('[data-edge]');
  if (edge) {
    const seam = edge.querySelector('.seam');
    const panel = edge.querySelector('.panel');
    const HIDE_DELAY = 600;
    const EDGE_ZONE = 24;
    let shown = true;
    let ready = false; // 出场动画放完之前不接管，免得打断它
    let armed = false; // 指针进过侧栏之后才自动收起，刚打开页面时不会自己收走
    let sticky = false;
    let timer = 0;

    const render = () => {
      edge.dataset.state = shown ? 'shown' : 'hidden';
      seam.setAttribute('aria-expanded', String(shown));
      seam.setAttribute('aria-label', shown ? seam.dataset.labelHide : seam.dataset.labelShow);
    };
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const set = (next, stick) => {
      cancel();
      ready = true;
      sticky = next && stick;
      if (shown !== next || !edge.dataset.state) {
        shown = next;
        render();
      }
    };
    const scheduleHide = () => {
      if (!ready || !armed || sticky || !shown || timer) return;
      timer = setTimeout(() => {
        timer = 0;
        set(false, false);
      }, HIDE_DELAY);
    };
    const inHero = (y) => {
      const rect = edge.getBoundingClientRect();
      return y >= rect.top && y <= rect.bottom;
    };

    // 出场动画结束（或减少动态效果时立即）后，由脚本接管状态。
    const takeOver = () => {
      if (!ready) set(true, false);
    };
    if (reduceMotion.matches) takeOver();
    else {
      panel.addEventListener('animationend', takeOver, { once: true });
      setTimeout(takeOver, 2400);
    }

    document.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const overPanel = panel.contains(event.target) || seam.contains(event.target);
      if (overPanel) {
        if (shown) armed = true;
        cancel();
      }
      const atEdge = event.clientX >= document.documentElement.clientWidth - EDGE_ZONE && inHero(event.clientY);
      if (atEdge && !shown) {
        armed = true;
        set(true, false);
      } else if (!overPanel && !atEdge) {
        scheduleHide();
      }
    });

    // 指针从右边移出窗口（滑到滚动条或屏幕边上）也算碰到边缘。
    document.documentElement.addEventListener('mouseleave', (event) => {
      if (event.clientX >= document.documentElement.clientWidth - 2 && inHero(event.clientY) && !shown) {
        armed = true;
        set(true, false);
      }
    });

    seam.addEventListener('click', () => set(!shown, true));

    document.addEventListener('keydown', (event) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyS') return;
      if (edge.getBoundingClientRect().bottom <= 0) return;
      event.preventDefault();
      set(!shown, true);
    });
  }

  /* ---------- 2. 主题 ---------- */
  const gallery = document.querySelector('[data-gallery]');
  const pickers = document.querySelector('[data-pickers]');
  if (gallery && pickers) {
    const TRANSLUCENT = new Set(['win11', 'glass']);
    const value = (name) => pickers.querySelector(`input[name="${name}"]:checked`).value;
    const label = (name, current) => pickers.querySelector(`input[name="${name}"][value="${current}"]`).nextElementSibling.textContent.trim();
    let figure = gallery.querySelector('.shot');
    let running = false;
    let queued = false;

    const apply = (target, surface, mode) => {
      const url = `${gallery.dataset.shotBase}${surface}-${mode}.webp`;
      const img = target.querySelector('img');
      img.src = url;
      img.alt = gallery.dataset.alt.replace('{theme}', label('surface', surface)).replace('{mode}', label('mode', mode).toLowerCase());
      if (TRANSLUCENT.has(surface)) {
        target.dataset.translucent = '';
        // 自定义属性里的相对地址会按样式表所在的目录解析，这里先换成绝对地址。
        target.style.setProperty('--shape', `url("${new URL(url, document.baseURI).href}")`);
      } else {
        delete target.dataset.translucent;
        target.style.removeProperty('--shape');
      }
    };

    // 切换时只换到最后一次选中的组合；动画进行中再点，放完这一轮接着换。
    const swap = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      do {
        queued = false;
        const next = figure.cloneNode(true);
        apply(next, value('surface'), value('mode'));
        const img = next.querySelector('img');
        img.loading = 'eager';
        try {
          await img.decode();
        } catch {
          // 解码失败也照常换上，浏览器会显示替代文字。
        }
        if (reduceMotion.matches) {
          figure.replaceWith(next);
          figure = next;
          continue;
        }
        next.dataset.entering = '';
        figure.dataset.leaving = '';
        gallery.append(next);
        await wait(SLIDE);
        figure.remove();
        void next.offsetWidth;
        delete next.dataset.entering;
        figure = next;
        await wait(SLIDE);
      } while (queued);
      running = false;
    };

    // 明暗默认跟随访客的系统。
    if (matchMedia('(prefers-color-scheme: dark)').matches) {
      pickers.querySelector('input[name="mode"][value="dark"]').checked = true;
      apply(figure, value('surface'), 'dark');
    }
    pickers.addEventListener('change', swap);
  }

  /* ---------- 3. 下载 ---------- */
  const downloads = document.querySelectorAll('[data-download]');
  if (downloads.length) {
    // GitHub 接口匿名访问每小时 60 次：结果（包括「还没有发布版」）在本机记一小时，翻页、重开不再重复查询。
    const CACHE_KEY = 'sidenotes-site:release';
    const CACHE_MS = 60 * 60 * 1000;
    const show = (release) => {
      if (!release) return;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const installer =
        assets.find((asset) => /setup\.exe$/i.test(asset.name)) ??
        assets.find((asset) => /\.exe$/i.test(asset.name)) ??
        assets.find((asset) => /\.msi$/i.test(asset.name));
      if (installer) downloads.forEach((link) => (link.href = installer.browser_download_url));
      const version = String(release.tag_name ?? '').replace(/^v/i, '');
      if (version) {
        document.querySelectorAll('[data-release]').forEach((note) => {
          note.textContent = note.dataset.template.replace('{version}', version);
        });
      }
    };
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    } catch {
      // 浏览器禁用了本地存储时每次都查询。
    }
    if (cached && Date.now() - cached.at < CACHE_MS) {
      show(cached.release);
    } else {
      fetch('https://api.github.com/repos/LiMuhua/SideNotes/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
        .then((response) => {
          // 404 是还没有发布版，可以记下；限流（403）等其它错误不记，下次再试。
          if (response.ok) return response.json();
          if (response.status === 404) return null;
          throw new Error(String(response.status));
        })
        .then((data) => {
          const release = data && { tag_name: data.tag_name, assets: (data.assets ?? []).map(({ name, browser_download_url }) => ({ name, browser_download_url })) };
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
          } catch {
            // 存不下就算了，不影响显示。
          }
          show(release);
        })
        .catch(() => {
          // 取不到发布信息时保留指向发布页的链接。
        });
    }
  }
})();
