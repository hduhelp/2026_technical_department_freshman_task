# -*- coding: utf-8 -*-
"""初始化占位图：为演示数据生成真实存在的图片文件，避免前端出现破图"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..config import settings
from ..db import query_all

PALETTE = [
    ((47, 107, 255), "证件卡类"), ((232, 163, 61), "电子产品"), ((34, 160, 107), "书籍资料"),
    ((122, 90, 248), "衣物鞋帽"), ((229, 72, 77), "钥匙"), ((90, 130, 200), "饰品手表"),
    ((45, 170, 170), "运动器材"), ((220, 130, 90), "雨具"), ((150, 150, 90), "钱包财物"),
    ((130, 140, 160), "其他"),
]

CN_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def _font(size: int):
    for path in CN_FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _make_image(path: Path, size: tuple[int, int], color: tuple[int, int, int],
                text: str, sub: str = "") -> None:
    w, h = size
    img = Image.new("RGB", (w, h), (245, 247, 250))
    d = ImageDraw.Draw(img)
    # 渐变底
    for y in range(h):
        ratio = y / max(h - 1, 1)
        c = tuple(int(color[i] * (1 - ratio * 0.35) + 255 * ratio * 0.35) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    title_font = _font(max(18, h // 12))
    sub_font = _font(max(12, h // 22))
    tw = d.textlength(text, font=title_font)
    d.text(((w - tw) / 2, h * 0.40), text, font=title_font, fill=(255, 255, 255))
    if sub:
        sw = d.textlength(sub, font=sub_font)
        d.text(((w - sw) / 2, h * 0.58), sub, font=sub_font, fill=(255, 255, 255))
    # 角标
    d.rectangle([0, h - 6, w, h], fill=(255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=88, optimize=True)


def ensure_placeholder_images() -> int:
    """为 item_image 中存在的记录生成对应的占位图（原图 + 缩略图）"""
    rows = query_all("""
        SELECT im.url, im.thumb_url, i.title, c.name AS category_name, i.type
        FROM item_image im
        LEFT JOIN item_record i ON i.id = im.item_id
        LEFT JOIN category c ON c.id = i.category_id
        WHERE im.deleted = 0 AND i.deleted = 0
    """)
    made = 0
    for r in rows:
        url = r["url"] or ""
        if not url.startswith("/uploads/"):
            continue
        rel = url[len("/uploads/"):]
        base = Path(settings.upload_dir) / rel
        thumb = base.with_name(base.stem + "_thumb" + base.suffix)
        if base.exists() and thumb.exists():
            continue
        cat = r["category_name"] or "其他"
        color = next((c for c, name in PALETTE if name == cat), (120, 130, 150))
        label = "招领" if r["type"] == 2 else "失物"
        _make_image(base, (1200, 900), color, cat, f"{label} · 示例图片")
        _make_image(thumb, (300, 225), color, cat, "")
        made += 1
    return made
