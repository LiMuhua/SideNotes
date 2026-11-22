"""把应用自带的 Maple Mono NF CN 子集化为官网用的西文字体（常规与粗体），并附上许可证。

官网的标题、按键与首屏大字用这套字体；中文仍由系统字体显示，所以只保留西文字符，每个字重约 20 KB。
用法（在仓库根目录）：python -I docs/home-page/tools/fonts.py
需要 fontTools 与 brotli：pip install fonttools brotli
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src" / "assets" / "fonts"
TARGET = ROOT / "docs" / "home-page" / "public" / "assets" / "fonts"

# 基本拉丁、拉丁补充、常用标点（连接号、引号、项目符号、省略号）、箭头与减号。
UNICODES = "U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2190-2193,U+2212"

WEIGHTS = {"Regular": 400, "Bold": 700}


def main() -> int:
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, weight in WEIGHTS.items():
        source = SOURCE / f"MapleMono-NF-CN-{name}.woff2"
        output = TARGET / f"maple-mono-{weight}.woff2"
        # 等宽字体不需要字距；连字与替换字形（calt、ss01 等）在正文里会把 -> 之类的写法变形，一并去掉。
        subprocess.run(
            [
                sys.executable, "-I", "-m", "fontTools.subset", str(source),
                f"--unicodes={UNICODES}",
                "--layout-features=",
                "--no-hinting",
                "--desubroutinize",
                "--flavor=woff2",
                f"--output-file={output}",
            ],
            check=True,
        )
        print(f"{output.relative_to(ROOT)}  {output.stat().st_size / 1024:.1f} KB")
    shutil.copyfile(SOURCE / "OFL.txt", TARGET / "OFL.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
