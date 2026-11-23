/* global document, window, matchMedia, fetch, setTimeout, clearTimeout, requestAnimationFrame, performance, URL, localStorage, console */
/**
 * SideNotes 官网的交互。全部是锦上添花：没有脚本时内容完整，首屏的出场动画也由 CSS 播放。
 *
 * 1. 首屏的屏幕边缘：指针碰到右边缘或门缝里的便签时侧栏滑出，离开侧栏 0.6 秒后滑回（与应用的默认值相同）；
 *    点击门缝或按 Alt+Shift+S 切换，这样打开的不会自动收起。
 * 2. 便签的眼睛跟着指针看。
 * 3. 主题：选主题与明暗，原来的侧栏滑回，换上新主题再滑出；桌面跟着明暗换成白天或夜里。
 * 4. 下载：按钮直接链接最新发布版的安装程序；查到还没有发布版时改指向发布页，有发布版时写出版本号。
 * 5. 构建信息：在浏览器的控制台里打出这一次构建的编号、提交与时间。
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
    const CLICK_GRACE = 1500;
    let shown = true;
    let ready = false; // 出场动画放完之前不接管，免得打断它
    let armed = false; // 指针进过侧栏之后才自动收起，刚打开页面时不会自己收走
    let sticky = false;
    let suppress = false; // 点门缝或按快捷键收起后，指针离开边缘之前不因碰到边缘再滑出
    let slidAt = -Infinity; // 指针碰到边缘让侧栏滑出的时刻
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
    const slideOut = () => {
      armed = true;
      slidAt = performance.now();
      set(true, false);
    };
    // 点击或快捷键：打开的留着不自动收起；收起后要等指针离开边缘，免得马上又碰出来。
    const toggle = () => {
      const next = !shown;
      set(next, true);
      suppress = !next;
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
      const overSeam = seam.contains(event.target);
      const overPanel = overSeam || panel.contains(event.target);
      if (overPanel) {
        if (shown) armed = true;
        cancel();
      }
      const atEdge = event.clientX >= document.documentElement.clientWidth - EDGE_ZONE && inHero(event.clientY);
      if (suppress && !atEdge && !overSeam) suppress = false;
      if ((atEdge || overSeam) && !shown && !suppress) {
        slideOut();
      } else if (!overPanel && !atEdge) {
        scheduleHide();
      }
    });

    // 指针从右边移出窗口（滑到滚动条或屏幕边上）也算碰到边缘。
    document.documentElement.addEventListener('mouseleave', (event) => {
      if (event.clientX >= document.documentElement.clientWidth - 2 && inHero(event.clientY) && !shown && !suppress) slideOut();
    });

    // 指针碰到便签时侧栏已经滑出，紧接着的这一下点击是想让它留着，不是收起。
    seam.addEventListener('click', () => {
      if (shown && !sticky && performance.now() - slidAt < CLICK_GRACE) {
        sticky = true;
        cancel();
        return;
      }
      toggle();
    });

    document.addEventListener('keydown', (event) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyS') return;
      if (edge.getBoundingClientRect().bottom <= 0) return;
      event.preventDefault();
      toggle();
    });

    // 便签下面的键帽跟着访客按下的键按下去。
    const caps = new Map([...edge.querySelectorAll('.edge-keys kbd')].map((cap) => [cap.dataset.key, cap]));
    const press = (event, down) => {
      const cap = caps.get(event.key === 'Alt' || event.key === 'Shift' ? event.key : event.code);
      if (cap) cap.toggleAttribute('data-down', down);
    };
    document.addEventListener('keydown', (event) => press(event, true));
    document.addEventListener('keyup', (event) => press(event, false));
    window.addEventListener('blur', () => caps.forEach((cap) => cap.removeAttribute('data-down')));
  }

  /* ---------- 2. 便签的眼睛 ---------- */
  // 眼睛画在便签图形里（页面开头的 #note），位移经 --look-x、--look-y 传进去，单位是图形自己的坐标。
  const peeks = [...document.querySelectorAll('.peek')];
  if (peeks.length) {
    const TILT = (9 * Math.PI) / 180; // 便签逆时针转了 9°，把指针的方向换到便签自己的坐标里
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const look = () => {
      frame = 0;
      for (const peek of peeks) {
        const box = peek.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        const dx = pointerX - (box.left + box.width * 0.35);
        const dy = pointerY - (box.top + box.height * 0.4);
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, distance / 240); // 指针离得近时只稍微转过去
        const x = ((dx * Math.cos(TILT) - dy * Math.sin(TILT)) / distance) * reach;
        const y = ((dx * Math.sin(TILT) + dy * Math.cos(TILT)) / distance) * reach;
        peek.style.setProperty('--look-x', `${(x * 1.2).toFixed(2)}px`);
        peek.style.setProperty('--look-y', `${(y * 0.9).toFixed(2)}px`);
      }
    };
    document.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!frame) frame = requestAnimationFrame(look);
      },
      { passive: true },
    );
  }

  /* ---------- 3. 主题 ---------- */
  const gallery = document.querySelector('[data-gallery]');
  const pickers = document.querySelector('[data-pickers]');
  if (gallery && pickers) {
    const value = (name) => pickers.querySelector(`input[name="${name}"]:checked`).value;
    const label = (name, current) => pickers.querySelector(`input[name="${name}"][value="${current}"]`).closest('label').textContent.trim();
    const absolute = (url) => new URL(url, document.baseURI).href;
    let figure = gallery.querySelector('.shot');
    let running = false;
    let queued = false;

    const apply = (target, surface, mode) => {
      const img = target.querySelector('img');
      img.src = `${gallery.dataset.shotBase}${surface}-${mode}.webp`;
      img.alt = gallery.dataset.alt.replace('{theme}', label('surface', surface)).replace('{mode}', label('mode', mode).toLowerCase());
      target.dataset.surface = surface;
      // 磨砂玻璃只模糊各块底下：遮罩是另截的各块形状。自定义属性里的相对地址按样式表的目录解析，先换成绝对地址。
      if (surface === 'glass') target.style.setProperty('--shape', `url("${absolute(`${gallery.dataset.shotBase}glass-mask.webp`)}")`);
      else target.style.removeProperty('--shape');
    };
    // 桌面与主题小样跟着明暗换成白天或夜里。
    const paint = (mode) => {
      gallery.dataset.mode = mode;
      pickers.dataset.mode = mode;
    };

    // 切换时只换到最后一次选中的组合；动画进行中再点，放完这一轮接着换。
    const swap = async () => {
      paint(value('mode'));
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
    }
    apply(figure, value('surface'), value('mode'));
    paint(value('mode'));
    pickers.addEventListener('change', swap);
  }

  /* ---------- 4. 下载 ---------- */
  const downloads = document.querySelectorAll('[data-download]');
  if (downloads.length) {
    // 按钮在网页里直接链接最新发布版的安装程序（固定文件名，见 .github/workflows/release.yml），不靠脚本也能下载。
    // 这里只查一下最新发布版：还没有发布版时改指向发布页，免得点出 404；有就写出版本号。
    // GitHub 接口匿名访问每小时 60 次：结果（包括「还没有发布版」）在本机记一小时，翻页、重开不再重复查询。
    const CACHE_KEY = 'sidenotes-site:release';
    const CACHE_MS = 60 * 60 * 1000;
    const RELEASES = 'https://github.com/LiMuhua/SideNotes/releases';
    const show = (release) => {
      if (!release) {
        downloads.forEach((link) => (link.href = RELEASES));
        return;
      }
      // 发布版里没有按钮链接的那个文件（例如改过名）时，退回最像安装程序的文件，再不行就打开这个发布版的页面。
      const assets = Array.isArray(release.assets) ? release.assets : [];
      downloads.forEach((link) => {
        const file = decodeURIComponent(new URL(link.href).pathname.split('/').pop());
        if (assets.some((asset) => asset.name === file)) return;
        const installer =
          assets.find((asset) => /setup\.exe$/i.test(asset.name)) ??
          assets.find((asset) => /\.exe$/i.test(asset.name)) ??
          assets.find((asset) => /\.msi$/i.test(asset.name));
        link.href = installer ? installer.browser_download_url : release.html_url || RELEASES;
      });
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
          const release = data && {
            tag_name: data.tag_name,
            html_url: data.html_url,
            assets: (data.assets ?? []).map(({ name, browser_download_url }) => ({ name, browser_download_url })),
          };
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
          } catch {
            // 存不下就算了，不影响显示。
          }
          show(release);
        })
        .catch(() => {
          // 查不到时保留网页里写的链接。
        });
    }
  }

  /* ---------- 5. 构建信息 ---------- */
  // 网站不跟应用的版本号走，用构建来认：发布网站的流水线（.github/workflows/pages.yml）把这次运行的编号、提交与
  // 构建时间写进下面三个占位，这里在控制台打一行，看得出线上是哪一次构建。本地预览没经过流水线，占位原样留着。
  const build = { number: '__SITE_BUILD__', commit: '__SITE_COMMIT__', builtAt: '__SITE_BUILT_AT__' };
  const zh = document.documentElement.lang.startsWith('zh');
  const badge = 'background:#232a6e;color:#ffe170;font-weight:700;padding:2px 6px;border-radius:4px';
  if (build.number.startsWith('__')) {
    console.info(`%cSideNotes%c ${zh ? '官网：本地预览，没有经过发布流水线' : 'website: local preview, not built by the pipeline'}`, badge, '');
  } else {
    // 按访客所在的时区写成「2026-11-23 13:14:32 UTC+8」，中英文同一个格式。
    const at = new Date(build.builtAt);
    const pad = (n) => String(n).padStart(2, '0');
    const offset = -at.getTimezoneOffset();
    const zone = `UTC${offset < 0 ? '-' : '+'}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${pad(Math.abs(offset) % 60)}` : ''}`;
    const time = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} ${zone}`;
    const text = zh ? `官网 构建 #${build.number}（提交 ${build.commit}），构建于 ${time}` : `website build #${build.number} (commit ${build.commit}), built ${time}`;
    console.info(`%cSideNotes%c ${text}`, badge, '');
  }
})();
