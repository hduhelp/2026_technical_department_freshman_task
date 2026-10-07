# -*- coding: utf-8 -*-
"""图片服务：上传校验、压缩、缩略图、头像、无主文件清理"""
import io
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from ..config import settings, ensure_dirs
from ..db import execute, now_str, query_one
from ..utils.common import BizError

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAGIC = {
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG\r\n\x1a\n": "png",
}


def _sniff(head: bytes) -> Optional[str]:
    for magic, kind in MAGIC.items():
        if head.startswith(magic):
            return kind
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


async def _read_and_validate(file: UploadFile, max_bytes: int) -> bytes:
    if not file or not file.filename:
        raise BizError(2004)
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise BizError(2004, "仅支持 JPG / PNG / WebP 格式")
    raw = await file.read()
    if len(raw) == 0:
        raise BizError(2004, "文件为空")
    if len(raw) > max_bytes:
        raise BizError(2004, f"图片不能超过 {max_bytes // 1024 // 1024} MB")
    kind = _sniff(raw[:16])
    if kind is None:
        raise BizError(2004, "文件内容不是有效图片")
    if ext == ".png" and kind != "png":
        raise BizError(2004, "文件扩展名与内容不一致")
    if ext in (".jpg", ".jpeg") and kind != "jpg":
        raise BizError(2004, "文件扩展名与内容不一致")
    if ext == ".webp" and kind != "webp":
        raise BizError(2004, "文件扩展名与内容不一致")
    return raw


def _save_image_bytes(raw: bytes, subdir: str, max_side: int, thumb_side: int, quality: int = 82) -> dict:
    """压缩为 JPEG 并生成缩略图，返回相对 URL 与尺寸信息"""
    ensure_dirs()
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except UnidentifiedImageError as exc:
        raise BizError(2004, "图片解析失败") from exc

    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        img = img.convert("RGBA")
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")

    w, h = img.size
    if max(w, h) > max_side:
        scale = max_side / float(max(w, h))
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

    folder = Path(settings.upload_dir) / subdir / datetime.now().strftime("%Y%m")
    folder.mkdir(parents=True, exist_ok=True)
    name = uuid.uuid4().hex
    orig_path = folder / f"{name}.jpg"
    thumb_path = folder / f"{name}_thumb.jpg"

    img.save(orig_path, "JPEG", quality=quality, optimize=True, progressive=True)

    tw, th = img.size
    if max(tw, th) > thumb_side:
        scale = thumb_side / float(max(tw, th))
        thumb = img.resize((max(1, int(tw * scale)), max(1, int(th * scale))), Image.LANCZOS)
    else:
        thumb = img.copy()
    thumb.save(thumb_path, "JPEG", quality=quality, optimize=True)

    rel = f"/uploads/{subdir}/{datetime.now().strftime('%Y%m')}"
    return {
        "url": f"{rel}/{name}.jpg",
        "thumbUrl": f"{rel}/{name}_thumb.jpg",
        "width": img.size[0],
        "height": img.size[1],
        "fileSize": orig_path.stat().st_size,
    }


async def save_item_image(file: UploadFile, uploader_id: int) -> dict:
    raw = await _read_and_validate(file, settings.image_max_bytes)
    info = _save_image_bytes(raw, "item", settings.image_max_side, settings.thumb_max_side)
    execute("INSERT INTO upload_file (url, uploader_id, used, create_time) VALUES (?,?,0,?)",
            (info["url"], uploader_id, now_str()))
    return info


async def save_avatar(file: UploadFile) -> str:
    raw = await _read_and_validate(file, 2 * 1024 * 1024)
    info = _save_image_bytes(raw, "avatar", 400, 120)
    return info["url"]


def assert_images_owned(urls: list[str], uploader_id: int) -> None:
    """校验图片确实由当前用户上传，防止引用他人图片"""
    for url in urls:
        row = query_one("SELECT uploader_id FROM upload_file WHERE url = ?", (url,))
        if row is None:
            raise BizError(2004, "图片不存在或已过期，请重新上传")
        if row["uploader_id"] != uploader_id:
            raise BizError(2004, "不能使用他人上传的图片")


def mark_images_used(urls: list[str]) -> None:
    for url in urls:
        execute("UPDATE upload_file SET used = 1 WHERE url = ?", (url,))


def delete_unused_image(url: str, uploader_id: int) -> None:
    row = query_one("SELECT * FROM upload_file WHERE url = ?", (url,))
    if not row or row["uploader_id"] != uploader_id:
        raise BizError(2005)
    if row["used"]:
        raise BizError(2005, "图片已被信息引用，无法删除")
    execute("DELETE FROM upload_file WHERE url = ?", (url,))
    _remove_files(url)


def _remove_files(url: str) -> None:
    if not url.startswith("/uploads/"):
        return
    rel = url[len("/uploads/"):]
    base = Path(settings.upload_dir) / rel
    thumb = base.with_name(base.stem + "_thumb" + base.suffix)
    for p in (base, thumb):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def cleanup_orphans(days: int = 7) -> int:
    """清理未被引用且超过 N 天的上传文件（磁盘文件 + 记录）"""
    rows = query_all_unused(days)
    count = 0
    for row in rows:
        _remove_files(row["url"])
        execute("DELETE FROM upload_file WHERE url = ?", (row["url"],))
        count += 1
    return count


def query_all_unused(days: int) -> list[dict]:
    from ..db import query_all
    return query_all(
        "SELECT url FROM upload_file WHERE used = 0 AND create_time < datetime('now', 'localtime', ?)",
        (f"-{days} days",))
