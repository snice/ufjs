#!/usr/bin/env python3
"""App Store screenshots for fjs go: raw simulator captures -> captioned images.

    python3 -m venv .venv && .venv/bin/pip install pillow
    .venv/bin/python store/make_screenshots.py

Reads screenshots/raw/*.png (captured with `xcrun simctl io <device>
screenshot`, status bar overridden to 9:41) and writes the upload-ready
sets App Store Connect asks for:

    screenshots/iphone-6.9/   1320 x 2868  (iPhone 17 Pro Max)
    screenshots/ipad-13/      2064 x 2752  (iPad Pro 13-inch)

Captions live in SHOTS below; the look follows the app icon (the bolt's
orange -> pink gradient behind white type).
"""
from __future__ import annotations

import glob
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
RAW = HERE / "screenshots" / "raw"

# (raw file, headline, subline)
SHOTS = {
    "iphone": [
        ("iphone-1-connect.png", "扫码即连 fjs dev", "改完 JS / Vue，手机上立刻看到效果"),
        ("iphone-2-components.png", "Vue 3 组件，原生渲染", "每个标签都映射成 Flutter Widget"),
        ("iphone-3-echarts.png", "图表、Canvas 都能跑", "ECharts、F2 一份源码多端出图"),
        ("iphone-4-game.png", "WebGL 与 3D 游戏", "three.js、PixiJS 直接跑在 App 里"),
        ("iphone-5-devmenu.png", "开发菜单随手可达", "重新加载、查看日志、断开，一步到位"),
    ],
    "ipad": [
        ("ipad-1-connect.png", "扫码即连 fjs dev", "改完 JS / Vue，平板上立刻看到效果"),
        ("ipad-2-components.png", "Vue 3 组件，原生渲染", "每个标签都映射成 Flutter Widget"),
        ("ipad-3-echarts.png", "图表、Canvas 都能跑", "ECharts、F2 一份源码多端出图"),
        ("ipad-4-game.png", "WebGL 与 3D 游戏", "three.js、PixiJS 直接跑在 App 里"),
    ],
}

TARGETS = {
    "iphone": ("iphone-6.9", (1320, 2868)),
    "ipad": ("ipad-13", (2064, 2752)),
}

GRADIENT = [(255, 149, 0), (255, 122, 0), (232, 58, 107)]  # theme.dart Brand.gradient


def font_path() -> tuple[str, int, int]:
    """PingFang SC (Semibold, Regular) if the system has it, else Hiragino."""
    hits = glob.glob("/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*/AssetData/PingFang.ttc")
    if hits:
        return hits[0], 11, 3
    return "/System/Library/Fonts/Hiragino Sans GB.ttc", 1, 0


def gradient(size: tuple[int, int]) -> Image.Image:
    """Diagonal three-stop gradient, top-left to bottom-right."""
    w, h = size
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x / 63 * 0.45 + y / 63 * 0.55)
            if t < 0.45:
                a, b, u = GRADIENT[0], GRADIENT[1], t / 0.45
            else:
                a, b, u = GRADIENT[1], GRADIENT[2], (t - 0.45) / 0.55
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3))
    return small.resize(size, Image.BICUBIC)


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def compose(raw: Path, title: str, sub: str, size: tuple[int, int], tablet: bool) -> Image.Image:
    w, h = size
    canvas = gradient(size).convert("RGBA")

    # soft light blobs so the gradient is not flat
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((-w * 0.3, -h * 0.15, w * 0.7, h * 0.3), fill=(255, 255, 255, 38))
    g.ellipse((w * 0.45, h * 0.55, w * 1.35, h * 1.1), fill=(255, 255, 255, 26))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(w // 10)))

    path, bold_i, regular_i = font_path()
    title_font = ImageFont.truetype(path, int(w * (0.058 if tablet else 0.082)), index=bold_i)
    sub_font = ImageFont.truetype(path, int(w * (0.030 if tablet else 0.042)), index=regular_i)
    draw = ImageDraw.Draw(canvas)
    top = int(h * 0.055)
    draw.text((w / 2, top), title, font=title_font, fill="white", anchor="ma")
    tb = draw.textbbox((w / 2, top), title, font=title_font, anchor="ma")
    draw.text((w / 2, tb[3] + int(h * 0.018)), sub, font=sub_font,
              fill=(255, 255, 255, 225), anchor="ma")

    # the screenshot, scaled into a rounded "device" that runs off the bottom
    shot = Image.open(raw).convert("RGB")
    shot_w = int(w * (0.80 if tablet else 0.84))
    shot = shot.resize((shot_w, round(shot.height * shot_w / shot.width)), Image.LANCZOS)
    bezel = int(shot_w * (0.018 if tablet else 0.028))
    radius = int(shot_w * (0.045 if tablet else 0.11))
    frame = Image.new("RGB", (shot_w + bezel * 2, shot.height + bezel * 2), (20, 20, 20))
    frame = rounded(frame, radius + bezel)
    frame.alpha_composite(rounded(shot, radius), (bezel, bezel))

    x = (w - frame.width) // 2
    y = int(h * (0.215 if tablet else 0.205))
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x, y + 30, x + frame.width, y + frame.height + 30), radius + bezel, fill=(90, 20, 30, 110))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(40)))
    canvas.alpha_composite(frame, (x, y))
    return canvas.convert("RGB")


def main() -> None:
    for kind, shots in SHOTS.items():
        folder, size = TARGETS[kind]
        out_dir = HERE / "screenshots" / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, (name, title, sub) in enumerate(shots, 1):
            img = compose(RAW / name, title, sub, size, tablet=kind == "ipad")
            out = out_dir / f"{i:02d}.png"
            img.save(out, optimize=True)
            print(f"{out.relative_to(HERE)}  {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    main()
