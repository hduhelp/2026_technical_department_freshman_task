# -*- coding: utf-8 -*-
"""
失物招领系统 · 设计图 PNG 栅格化脚本
复用 make_diagrams.py 的绘图代码（同一个 SVG 接口），用 Pillow 直接输出 2 倍分辨率 PNG。
用法： python make_png.py
输出： ./图/*.png
"""
import importlib.util
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(BASE, "图")
S = 2  # 超采样倍数

REG = r"C:\Windows\Fonts\msyh.ttc"
BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

_font_cache = {}
_measure_img = Image.new("RGB", (8, 8))
_measure_draw = ImageDraw.Draw(_measure_img)


def _font(size, bold=False):
    key = (round(size, 1), bold)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(BOLD if bold else REG, max(int(round(size * S)), 8))
    return _font_cache[key]


def _rgb(hexstr, default=None):
    if hexstr is None:
        return default or (0, 0, 0)
    h = hexstr.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def text_size(s, size, bold=False):
    f = _font(size, bold)
    box = _measure_draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0], box[3] - box[1]


class PILSVG:
    """与 make_diagrams.SVG 接口兼容的 Pillow 实现"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGB", (int(w * S), int(h * S)), (255, 255, 255))
        self.d = ImageDraw.Draw(self.img)

    # ---- 基础 ----
    def add(self, s):
        return

    def rect(self, x, y, w, h, fill="none", stroke=None, rx=6, sw=1.2, dash=None, op=None):
        box = [x * S, y * S, (x + w) * S, (y + h) * S]
        f = None if fill in (None, "none") else _rgb(fill)
        o = None if stroke in (None, "none") else _rgb(stroke)
        width = max(int(round(sw * S)), 1)
        r = max(int(round((rx or 0) * S)), 0)
        if r > 0:
            self.d.rounded_rectangle(box, radius=r, fill=f, outline=o, width=width if o else 0)
        else:
            self.d.rectangle(box, fill=f, outline=o, width=width if o else 0)
        if dash and o:
            self._dashed_rect(box, o, width, dash)

    def _dashed_rect(self, box, color, width, dash):
        # 用白线打断边框，模拟虚线
        x1, y1, x2, y2 = box
        step = 12 * S
        seg = 7 * S
        for x in range(int(x1), int(x2), step):
            self.d.line([x, y1, min(x + seg, x2), y1], fill=(255, 255, 255), width=width + 2)
            self.d.line([x, y2, min(x + seg, x2), y2], fill=(255, 255, 255), width=width + 2)
        for y in range(int(y1), int(y2), step):
            self.d.line([x1, y, x1, min(y + seg, y2)], fill=(255, 255, 255), width=width + 2)
            self.d.line([x2, y, x2, min(y + seg, y2)], fill=(255, 255, 255), width=width + 2)

    def line(self, x1, y1, x2, y2, stroke=None, sw=1.2, dash=None, marker=None):
        color = _rgb(stroke or "#C9CFDA")
        width = max(int(round(sw * S)), 1)
        p1 = (x1 * S, y1 * S)
        p2 = (x2 * S, y2 * S)
        if dash:
            self._dashed_line(p1, p2, color, width)
        else:
            self.d.line([p1, p2], fill=color, width=width)
        if marker:
            self._arrow_head(p1, p2, color, max(7.5 * S, width * 3))

    def _dashed_line(self, p1, p2, color, width, on=7, off=5):
        x1, y1 = p1
        x2, y2 = p2
        dist = math.hypot(x2 - x1, y2 - y1)
        if dist == 0:
            return
        ux, uy = (x2 - x1) / dist, (y2 - y1) / dist
        pos = 0.0
        while pos < dist:
            end = min(pos + on * S, dist)
            self.d.line([(x1 + ux * pos, y1 + uy * pos), (x1 + ux * end, y1 + uy * end)],
                        fill=color, width=width)
            pos = end + off * S

    def _arrow_head(self, p1, p2, color, size):
        ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
        tip = p2
        left = (tip[0] - size * math.cos(ang - math.pi / 7), tip[1] - size * math.sin(ang - math.pi / 7))
        right = (tip[0] - size * math.cos(ang + math.pi / 7), tip[1] - size * math.sin(ang + math.pi / 7))
        self.d.polygon([tip, left, right], fill=color)

    def path(self, d, stroke=None, sw=1.2, fill="none", dash=None, marker=None):
        color = _rgb(stroke or "#C9CFDA")
        width = max(int(round(sw * S)), 1)
        pts = self._parse_path(d)
        if len(pts) < 2:
            return
        for i in range(len(pts) - 1):
            if dash and i % 2 == 1:
                continue
            self.d.line([pts[i], pts[i + 1]], fill=color, width=width)
        if marker:
            # 箭头方向取最后一段有效方向
            p_last, p_prev = pts[-1], pts[-2]
            if math.hypot(p_last[0] - p_prev[0], p_last[1] - p_prev[1]) < 1:
                p_prev = pts[-3] if len(pts) > 2 else pts[0]
            self._arrow_head(p_prev, p_last, color, max(7.5 * S, width * 3))

    def _parse_path(self, d):
        toks = re.findall(r"[MLZmlz]|-?\d+(?:\.\d+)?", d)
        pts, i, cx, cy, cmd = [], 0, 0.0, 0.0, "M"
        while i < len(toks):
            t = toks[i]
            if t in "MLZmlz":
                cmd = t
                i += 1
                continue
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            if cmd in ("M", "L"):
                cx, cy = x, y
            pts.append((cx * S, cy * S))
        return pts

    def diamond(self, cx, cy, w, h, lines, size=12, fill=None, stroke=None):
        pts = [(cx * S, (cy - h / 2) * S), ((cx + w / 2) * S, cy * S),
               (cx * S, (cy + h / 2) * S), ((cx - w / 2) * S, cy * S)]
        self.d.polygon(pts, fill=_rgb(fill or "#EAF1FF"), outline=_rgb(stroke or "#A9C4FF"),
                       width=max(int(1.2 * S), 1))
        self.ctext(cx, cy, lines, size=size)

    def crow(self, x, y, direction="right", color=None):
        c = _rgb(color or "#C9CFDA")
        d = 1 if direction == "right" else -1
        for dy in (-6, 0, 6):
            self.d.line([(x * S, y * S), ((x + 10 * d) * S, (y + dy) * S)], fill=c, width=max(int(1.2 * S), 1))

    def one_bar(self, x, y, direction="left", color=None):
        c = _rgb(color or "#C9CFDA")
        self.d.line([(x * S, (y - 7) * S), (x * S, (y + 7) * S)], fill=c, width=max(int(1.2 * S), 1))

    def ctext(self, cx, cy, lines, size=13, fill=None, weight="normal", lh=None):
        lh = lh or size + 6
        n = max(len(lines), 1)
        y0 = cy - (n - 1) * lh / 2 + size * 0.35
        for i, ln in enumerate(lines):
            self.text(cx, y0 + i * lh, ln, size=size, fill=fill, anchor="middle", weight=weight)

    def text(self, x, y, s, size=13, fill=None, anchor="middle", weight="normal", op=None):
        bold = weight in ("700", "600", "bold")
        f = _font(size, bold)
        tw, th = text_size(s, size, bold)
        if anchor == "middle":
            px = x * S - tw / 2
        elif anchor == "end":
            px = x * S - tw
        else:
            px = x * S
        # Pillow 以顶部为基准，SVG 以基线为基准：偏移约 0.78em
        py = y * S - th / 2 - size * S * 0.30
        self.d.text((px, py), s, font=f, fill=_rgb(fill or "#1F2329"))

    def arrow(self, x1, y1, x2, y2, stroke=None, sw=1.4, dash=None, marker="ah"):
        self.line(x1, y1, x2, y2, stroke=stroke, sw=sw, dash=dash, marker=marker)

    def title(self, t, sub=None):
        self.text(40, 40, t, size=21, weight="700", anchor="start")
        if sub:
            self.text(40, 64, sub, size=12.5, fill="#8A93A0", anchor="start")

    def save(self, name):
        out = os.path.join(IMG_DIR, name + ".png")
        self.img.save(out, "PNG", optimize=True)
        print("  OK", name + ".png", self.img.size)


class CaptureSVG(PILSVG):
    """把各绘图函数的 .save(name) 直接落到 图/<name>.png"""

    def save(self, name):
        out = os.path.join(IMG_DIR, name + ".png")
        self.img.save(out, "PNG", optimize=True)
        print("  OK", name + ".png", f"{self.img.size[0]}x{self.img.size[1]}")


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    spec = importlib.util.spec_from_file_location("diagrams", os.path.join(BASE, "make_diagrams.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.SVG = CaptureSVG      # 关键：替换绘图后端
    figs = ["fig01_usecase", "fig02_architecture", "fig03_er", "fig04_flow",
            "fig05_state", "fig06_nav", "fig07_deploy", "fig08_sequence"]
    print("生成设计图 PNG（2 倍分辨率）：")
    for fn in figs:
        getattr(mod, fn)()
    print("完成，输出目录：", IMG_DIR)


if __name__ == "__main__":
    main()
