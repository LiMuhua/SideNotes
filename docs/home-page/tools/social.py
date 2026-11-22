"""生成官网的分享卡片（og:image，1200×630）：夜色背景、应用名与口号，右边贴着侧栏截图。

用法（在仓库根目录，Windows）：python -I docs/home-page/tools/social.py
需要 Pillow、fontTools 与 brotli；先运行 shots.mjs 生成首屏截图。中英文口号用系统的 Segoe UI 与微软雅黑。
"""

import io
import random
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "public"
ASSETS = ROOT / "assets"
W, H = 1200, 630
FONTS = Path("C:/Windows/Fonts")

COPY = {
    "en": {"tagline": "The notebook hidden at the edge of your screen.", "sub": "Free and open source, for Windows", "font": "segoeui.ttf", "font_sub": "segoeui.ttf"},
    "zh": {"tagline": "藏在屏幕边上的速记本", "sub": "免费开源，面向 Windows", "font": "msyh.ttc", "font_sub": "msyh.ttc"},
}


def maple(weight: int, size: int) -> ImageFont.FreeTypeFont:
    """把官网用的 Maple Mono 子集（WOFF2）转成 TrueType 交给 Pillow。"""
    font = TTFont(ASSETS / "fonts" / f"maple-mono-{weight}.woff2")
    font.flavor = None
    data = io.BytesIO()
    font.save(data)
    data.seek(0)
    return ImageFont.truetype(data, size)


def background() -> Image.Image:
    img = Image.new("RGB", (W, H))
    top, bottom = (37, 45, 118), (22, 26, 71)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    # 左上角的靛蓝高光与右边门缝透出的暖光。
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([-260, -320, 700, 300], fill=(70, 84, 186, 150))
    g.ellipse([820, 120, 1500, 560], fill=(255, 224, 138, 70))
    img = img.convert("RGBA")
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    img = img.convert("RGB")
    stars = ImageDraw.Draw(img)
    rnd = random.Random(7)
    for _ in range(40):
        x, y = rnd.uniform(10, 860), rnd.uniform(10, 620)
        r = rnd.choice([0.8, 1, 1.2, 1.5])
        a = rnd.choice([70, 100, 130, 170])
        stars.ellipse([x - r, y - r, x + r, y + r], fill=(255, 243, 196) if a > 120 else (150, 150, 190))
    return img


def glow_text(img: Image.Image, xy, text, font, fill, glow_rgb, radius=18, strength=0.55) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=glow_rgb + (255,))
    halo = layer.filter(ImageFilter.GaussianBlur(radius))
    halo.putalpha(halo.getchannel("A").point(lambda v: int(v * strength)))
    img.alpha_composite(halo)
    ImageDraw.Draw(img).text(xy, text, font=font, fill=fill)


def card(lang: str) -> Image.Image:
    copy = COPY[lang]
    img = background().convert("RGBA")

    # 右边：首屏截图（终端主题、浅色）的上半段，贴着右边缘，左侧投下阴影。
    shot = Image.open(ASSETS / "shots" / f"{lang}-hero-light.webp").convert("RGBA")
    panel_w = 360
    scale = panel_w / shot.width
    shot = shot.resize((panel_w, round(shot.height * scale)), Image.LANCZOS).crop((0, 0, panel_w, H))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle([W - panel_w - 6, -40, W + 40, H + 40], fill=(6, 8, 34, 190))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28)))
    img.alpha_composite(shot, (W - panel_w, 0))

    # 左边：图标、应用名（Maple Mono 粗体，便签黄带光晕）、口号与一行说明。
    icon = Image.open(ROOT / "icon.png").convert("RGBA").resize((76, 76), Image.LANCZOS)
    img.alpha_composite(icon, (72, 78))
    glow_text(img, (68, 196), "SideNotes", maple(700, 112), (255, 225, 112), (255, 214, 102))
    tagline = ImageFont.truetype(str(FONTS / copy["font"]), 38 if lang == "en" else 44)
    sub = ImageFont.truetype(str(FONTS / copy["font_sub"]), 26)
    draw = ImageDraw.Draw(img)
    words = copy["tagline"]
    if lang == "en":
        # 英文口号分两行，断在 "hidden" 之后。
        lines = ["The notebook hidden", "at the edge of your screen."]
    else:
        lines = [words]
    y = 350
    for line in lines:
        draw.text((72, y), line, font=tagline, fill=(238, 240, 255))
        y += 52 if lang == "en" else 60
    draw.text((72, y + 26), copy["sub"], font=sub, fill=(183, 188, 232))
    return img.convert("RGB")


def main() -> int:
    for lang in COPY:
        out = ASSETS / f"social-{lang}.jpg"
        card(lang).save(out, quality=86, optimize=True, progressive=True)
        print(f"{out.relative_to(ROOT.parent)}  {out.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
