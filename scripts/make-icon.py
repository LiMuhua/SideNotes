"""按原型 favicon 的构图生成 Tauri 图标源文件。

原型图标是 SVG，Tauri 的 `tauri icon` 需要位图源；此脚本用 Pillow
以相同的圆角底、双层卡片与两条文字线重绘 1024x1024 PNG。
运行：python scripts/make-icon.py
"""

from PIL import Image, ImageDraw

SIZE = 1024
SCALE = SIZE / 64  # 原型视图框为 64x64


def scaled(value: float) -> float:
    return value * SCALE


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 圆角底板
    draw.rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1],
        radius=scaled(17),
        fill=(232, 238, 231, 255),
    )
    # 后层深色卡片
    draw.rectangle(
        [scaled(18), scaled(15), scaled(47), scaled(46)],
        fill=(49, 88, 70, 255),
    )
    # 前层浅色卡片
    draw.rectangle(
        [scaled(13), scaled(20), scaled(42), scaled(51)],
        fill=(142, 165, 139, 255),
    )
    # 两条文字线
    width = int(scaled(3))
    draw.line(
        [scaled(23), scaled(28), scaled(36), scaled(28)],
        fill=(255, 255, 255, 255),
        width=width,
    )
    draw.line(
        [scaled(23), scaled(35), scaled(33), scaled(35)],
        fill=(255, 255, 255, 255),
        width=width,
    )

    image.save("src-tauri/icons/source.png")
    print("已生成 src-tauri/icons/source.png")


if __name__ == "__main__":
    main()
