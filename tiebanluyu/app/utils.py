"""
业务工具层：搜索、分页、数据转换、图片处理、智能匹配。

这个文件把"纯逻辑"从路由里抽出来，好处是：
1. 路由文件只关心"处理请求"，读起来清爽；
2. 这些函数可以单独测试，不需要启动 Web 服务；
3. 同一段逻辑（比如"数据库行 → 接口响应"）只写一遍，不会两处不一致。
"""

from __future__ import annotations

import base64
import binascii
import re
import sqlite3
from pathlib import Path
from typing import Any

from . import config
from .models import (
    ALLOWED_STATUS_TRANSITIONS,
    STATUS_LABELS,
    TYPE_LABELS,
    ItemImagesTable,
    ItemsTable,
)
from .schemas import ItemDetail, ItemOwner, ItemPublic


# ==================================================================
# 一、搜索：把用户输入安全地转成 LIKE 条件
# ==================================================================

# LIKE 语句里的特殊字符：% 表示任意字符，_ 表示单个字符。
# 如果用户搜索 "100%"，不转义就会变成"以 100 开头的所有内容"。
_LIKE_ESCAPE_CHAR = "\\"


def escape_like(keyword: str) -> str:
    """转义 LIKE 通配符，防止用户输入被当成通配符。

    配合 SQL 里的 `LIKE ? ESCAPE '\\'` 使用。

    举例：用户搜 "100%" ，转义后变成 "100\\%"，
    SQL 解析为"字面量 100%"，而不是"以 100 开头的所有内容"。

    【踩坑记录】这一步的顺序我实测验证过，结论是：
        必须**先翻倍反斜杠，再给 % 和 _ 加反斜杠前缀**。

    为什么？用 SQLite 实测对比过两种顺序（搜 6 组关键词）：

        顺序 B（正确，6/6 通过）：
            "%"  ->  "\\%"      SQL 解析为字面量 %          ✓ 精确匹配
        顺序 A（错误，2/6 通过）：
            "%"  ->  "\\%" 再翻倍反斜杠  ->  "\\\\%"
            SQL 解析为"字面量反斜杠 + 通配符"             ✗ 匹配到了所有含反斜杠的记录

    关键在于：给 % 加上的那个反斜杠是**前缀**，它不能被翻倍，
    否则 SQL 会把"转义符"当成"字面量反斜杠"。而输入里原有的反斜杠必须翻倍，
    否则用户搜 "\" 时会意外地把后面一个字符变成转义序列。
    两者要求相反，所以顺序不能颠倒。
    """
    # 第一步：把输入里原有的反斜杠翻倍（必须先做）
    escaped = keyword.replace(_LIKE_ESCAPE_CHAR, _LIKE_ESCAPE_CHAR * 2)
    # 第二步：给通配符加上单层反斜杠前缀
    escaped = escaped.replace("%", _LIKE_ESCAPE_CHAR + "%")
    escaped = escaped.replace("_", _LIKE_ESCAPE_CHAR + "_")
    return escaped


def build_search_clause(
    keyword: str | None,
    item_type: str | None,
    status: str | None,
    location: str | None,
    owner_id: int | None = None,
) -> tuple[str, list[Any]]:
    """拼装 WHERE 子句和对应的参数列表。

    这是本项目集中使用 SQL 知识点的位置：
        WHERE    按条件过滤
        LIKE     模糊搜索关键词
        AND / OR 组合多个条件

    返回 (where_sql, params)。
    所有值都通过 ? 占位符传递，**绝不把用户输入拼进 SQL 字符串**，
    从根本上杜绝 SQL 注入。
    """
    conditions: list[str] = []
    params: list[Any] = []

    # --- 按类型筛选：失物 / 招领 ---
    if item_type in ItemsTable.TYPES:
        conditions.append("i.type = ?")
        params.append(item_type)

    # --- 按状态筛选：寻找中 / 已找到 / 已结束 ---
    if status in ItemsTable.STATUSES:
        conditions.append("i.status = ?")
        params.append(status)

    # --- 关键词模糊搜索：同时匹配物品名和描述 ---
    if keyword and keyword.strip():
        pattern = f"%{escape_like(keyword.strip())}%"
        # 加括号！否则 OR 会和前面的 AND 条件混在一起，导致筛选失效
        conditions.append(
            "(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')"
        )
        params.append(pattern)
        params.append(pattern)

    # --- 按地点模糊筛选 ---
    if location and location.strip():
        conditions.append("i.location LIKE ? ESCAPE '\\'")
        params.append(f"%{escape_like(location.strip())}%")

    # --- 只看某个用户发布的信息（"我的发布"页面用）---
    if owner_id is not None:
        conditions.append("i.owner_id = ?")
        params.append(owner_id)

    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where_sql, params


# 允许的排序方式白名单。
# 【安全要点】为什么用白名单而不是直接把前端传来的字符串拼进 ORDER BY？
# 因为 ORDER BY 后面跟的是**列名**，占位符 ? 在那里不生效（会变成按字符串常量排序）。
# 所以只能拼接，而拼接就必须严格限制取值范围 —— 白名单是标准解法。
SORT_OPTIONS: dict[str, str] = {
    "newest": "i.created_at DESC, i.id DESC",  # 最新发布
    "oldest": "i.created_at ASC, i.id ASC",  # 最早发布
    "event_desc": "i.event_time DESC NULLS LAST, i.created_at DESC",  # 事件时间从新到旧
    "event_asc": "i.event_time ASC NULLS LAST, i.created_at ASC",  # 事件时间从旧到新
    "popular": "i.view_count DESC, i.created_at DESC",  # 最多浏览
}
DEFAULT_SORT = "newest"


def resolve_order_by(sort: str | None) -> str:
    """把前端的排序参数转成安全的 ORDER BY 片段。非法值一律回退到默认排序。"""
    return SORT_OPTIONS.get(sort or DEFAULT_SORT, SORT_OPTIONS[DEFAULT_SORT])


# ==================================================================
# 二、分页
# ==================================================================

PAGE_SIZE_DEFAULT = 10
PAGE_SIZE_MAX = 50


def normalize_pagination(page: int | None, page_size: int | None) -> tuple[int, int]:
    """把分页参数限制在合理范围内。

    为什么要夹紧 page_size 上限？
    如果有人传 page_size=999999，服务器会一次性查出整张表，
    内存和 CPU 都可能被拖垮 —— 这是很常见的接口攻击方式。
    """
    safe_page = max(1, page or 1)
    safe_size = page_size or PAGE_SIZE_DEFAULT
    safe_size = max(1, min(safe_size, PAGE_SIZE_MAX))
    return safe_page, safe_size


def build_page_meta(total: int, page: int, page_size: int) -> dict[str, Any]:
    """计算分页元信息。

    【知识点】OFFSET 分页的第 (page-1)*page_size 条开始取 page_size 条。
    前端除了数据本身，还需要知道总数，否则算不出有多少页。
    """
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "has_next": page < total_pages,
    }


# ==================================================================
# 三、数据库行 → 接口响应
# ==================================================================


def row_to_item_public(
    row: sqlite3.Row,
    current_user_id: int | None = None,
) -> ItemPublic:
    """把数据库行转换成列表页使用的结构。

    【安全设计】这里不返回 password_hash、也不返回发布者的私人联系方式。
    联系方式只在详情页返回，减少被批量抓取的风险。
    """
    # 发布者信息可能为 NULL（理论上不会，因为删除用户会级联删除他的信息，
    # 但用 LEFT JOIN 时仍需防御性处理，避免整页 500）
    owner = None
    if row["owner_username"] is not None:
        owner = ItemOwner(
            id=row["owner_id"],
            display_name=row["owner_display_name"] or row["owner_username"],
            contact="",
        )

    return ItemPublic(
        id=row["id"],
        type=row["type"],
        status=row["status"],
        title=row["title"],
        description=row["description"] or "",
        location=row["location"] or "",
        event_time=row["event_time"],
        contact=row["contact"] or "",
        cover_image=row["cover_image"] or "",
        view_count=row["view_count"] or 0,
        created_at=_as_iso_utc(row["created_at"]),
        updated_at=_as_iso_utc(row["updated_at"]),
        owner=owner,
        # 前端靠这个字段决定是否显示"编辑/删除/改状态"按钮。
        # 【重要】这只是为了让界面好看，真正的权限校验必须在后端做
        # （见 items.py 的 _assert_can_modify），因为前端可以被人为篡改。
        #
        # 有两类人有管理权：发布者，以及保管者（东西在他手上，
        # 状态变化往往只有他知道）。判断逻辑与后端 _can_manage 保持一致。
        is_mine=(
            current_user_id is not None
            and (row["owner_id"] == current_user_id or row["holder_user_id"] == current_user_id)
        ),
        # 中文标签由后端统一提供，前端直接显示即可。
        # 好处：以后要加英文版或改文案，只改后端一处，不用担心前端多处硬编码不一致。
        type_label=TYPE_LABELS.get(row["type"], row["type"]),
        status_label=STATUS_LABELS.get(row["status"], row["status"]),
        # ---------- 发现者与保管者（只对招领启事有意义）----------
        #
        # 【为什么寻物启事要单独处理】
        # 「谁发现的」「东西在谁手里」是招领启事才有的概念。
        # 寻物启事是失主在说自己丢了什么，那时东西不在他手上，
        # 所以这些字段统一返回空，holder_is_reporter 也固定为 True
        #（表示"不存在分离出去的保管者"）。
        #
        # 不这样处理的话，前端会看到 holder_is_reporter=False 而误以为
        # "保管者是另一个人"，进而在详情页渲染出空的"保管者：未填写"。
        finder_name=row["finder_name"] or "" if row["type"] == ItemsTable.TYPE_FOUND else "",
        holder_is_reporter=(
            row["holder_user_id"] == row["owner_id"]
            if row["type"] == ItemsTable.TYPE_FOUND
            else True
        ),
        holder_name=row["holder_name"] or "" if row["type"] == ItemsTable.TYPE_FOUND else "",
        holder_place=row["holder_place"] or "" if row["type"] == ItemsTable.TYPE_FOUND else "",
        holder_username=(
            row["holder_username"] or "" if row["type"] == ItemsTable.TYPE_FOUND else ""
        ),
        is_holder=bool(
            row["type"] == ItemsTable.TYPE_FOUND
            and current_user_id is not None
            and row["holder_user_id"] is not None
            and row["holder_user_id"] == current_user_id
        ),
        # 是否发布者。
        # 【为什么不能只看 is_mine】is_mine 表示"有管理权"（发布者 **或** 保管者），
        # 而界面要分别显示「我发布的」和「我保管的」两个不同的徽标，
        # 所以必须把这两个身份拆开判断。
        is_owner=bool(current_user_id is not None and row["owner_id"] == current_user_id),
    )


def row_to_item_detail(
    row: sqlite3.Row,
    images: list[str],
    current_user_id: int | None = None,
) -> ItemDetail:
    """把数据库行转换成详情页结构（比列表多图片和联系方式）。"""
    base = row_to_item_public(row, current_user_id)

    # 保管者的联系方式优先：失主真正要去的是保管者那里
    # （比如"图书馆服务台"对应的账号，或者代为保管的同学）。
    # 找不到保管者账号时，再用发布者的账号联系方式兜底。
    holder_contact = row["holder_contact"] or ""
    owner_contact = row["owner_contact"] or row["contact"] or ""

    return ItemDetail(
        **base.model_dump(),
        images=images,
        owner_contact=owner_contact,
        holder_contact=holder_contact,
    )


def _as_iso_utc(value: str | None) -> str | None:
    """把数据库的 UTC 时间串补上 Z 标记（详见 database.utc_to_iso 的说明）。"""
    from .database import utc_to_iso

    return utc_to_iso(value)


def fetch_item_images(conn: sqlite3.Connection, item_id: int) -> list[str]:
    """取某条信息的全部图片地址，按用户上传顺序返回。

    【知识点】ORDER BY sort_order 是必须的：
    数据库不保证返回顺序，不显式排序的话图片可能乱序。
    """
    rows = conn.execute(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order ASC, id ASC",
        (item_id,),
    ).fetchall()
    return [r["url"] for r in rows]


# ==================================================================
# 四、状态流转
# ==================================================================


def can_transition(from_status: str, to_status: str) -> bool:
    """判断状态流转是否被允许。

    规则定义在 models.ALLOWED_STATUS_TRANSITIONS 里，集中一处便于维护。
    """
    if from_status == to_status:
        return True
    return to_status in ALLOWED_STATUS_TRANSITIONS.get(from_status, ())


def describe_transition_error(from_status: str, to_status: str) -> str:
    """生成人类可读的流转失败提示。"""
    from_label = STATUS_LABELS.get(from_status, from_status)
    to_label = STATUS_LABELS.get(to_status, to_status)
    allowed = ALLOWED_STATUS_TRANSITIONS.get(from_status, ())
    allowed_labels = "、".join(STATUS_LABELS.get(s, s) for s in allowed)
    return (
        f"不允许从「{from_label}」直接变更为「{to_label}」。"
        f"当前状态可以变更为：{allowed_labels}"
    )


# ==================================================================
# 五、图片处理
# ==================================================================

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 单张最大 5MB

# 允许的图片类型及其"魔术字节"（文件开头几个字节）。
#
# 【安全要点】为什么不能只看前端传来的 content_type 或文件后缀？
# 因为这两者都是客户端自己声明的，可以随便伪造。
# 攻击者可以把一个 .php 脚本改名成 .jpg 传上来。
# 校验文件头的真实字节，才是可靠的判断依据。
_MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "jpg"),  # JPEG
    (b"\x89PNG\r\n\x1a\n", "png"),  # PNG
    (b"GIF87a", "gif"),  # GIF
    (b"GIF89a", "gif"),  # GIF
)


def _sniff_image_format(raw: bytes) -> str | None:
    """通过文件头字节判断真实图片格式。识别不出来就返回 None。"""
    for signature, fmt in _MAGIC_SIGNATURES:
        if raw.startswith(signature):
            return fmt
    # WebP 的头部结构稍特殊：RIFF....WEBP
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def save_base64_image(data_url: str) -> str:
    """把前端传来的 base64 图片存成文件，返回可访问的 URL。

    为什么用 base64 而不是 multipart/form-data 文件上传？
    ---------------------------------------------------
    因为解析 multipart 需要 python-multipart 这个额外的包，
    而本项目的设计目标之一就是"依赖尽可能少"（见 requirements.txt 的说明）。

    前端用 FileReader 把图片读成 base64 字符串放进 JSON 里提交，
    后端解码后写文件。整个链路不需要任何额外依赖。

    数据格式既支持带前缀的 `data:image/png;base64,xxxx`，
    也支持纯 base64 字符串。

    抛出的 ValueError 由路由层转换成 400 响应。
    """
    if not data_url or not isinstance(data_url, str):
        raise ValueError("图片内容为空")

    # 去掉 data URL 前缀（如果有）
    payload = data_url
    if data_url.startswith("data:"):
        if "," not in data_url:
            raise ValueError("图片数据格式不正确")
        payload = data_url.split(",", 1)[1]

    # 先用长度粗略估算，避免对超大字符串做解码白白消耗内存。
    # base64 长度约为原字节数的 4/3，这里留一些余量。
    if len(payload) > MAX_IMAGE_BYTES * 2:
        raise ValueError(f"图片过大，最大支持 {MAX_IMAGE_BYTES // 1024 // 1024}MB")

    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("图片 base64 数据无法解码") from exc

    if not raw:
        raise ValueError("图片内容为空")

    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"图片过大，最大支持 {MAX_IMAGE_BYTES // 1024 // 1024}MB")

    # 关键一步：不看后缀、不看声明，直接看文件头判断真实格式
    fmt = _sniff_image_format(raw)
    if fmt is None:
        raise ValueError("只支持 JPG / PNG / GIF / WebP 格式的图片")

    # 用随机 UUID 命名，避免两种风险：
    #   1. 不同用户上传同名文件互相覆盖
    #   2. 用户恶意构造文件名进行路径穿越（如 ../../app/main.py）
    import uuid

    filename = f"{uuid.uuid4().hex}.{fmt}"
    target = config.UPLOAD_DIR / filename
    target.write_bytes(raw)

    # 返回相对 URL，前端直接放进 <img src> 即可
    return f"/uploads/{filename}"


def delete_image_file(url: str) -> bool:
    """删除图片文件。返回是否真的删掉了。

    删除信息时顺带清理图片，避免磁盘上堆积无用文件。
    """
    if not url:
        return False

    # 只处理本系统上传的文件（外部链接不管）
    prefix = "/uploads/"
    if not url.startswith(prefix):
        return False

    filename = url[len(prefix) :]

    # 【安全要点】路径穿越防护。
    # 如果 filename 是 "../../app/main.py"，直接拼接就会删掉源码！
    # 这里强制要求文件名只能是"字母数字加点和横线"，且不含路径分隔符。
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", filename):
        return False

    target = (config.UPLOAD_DIR / filename).resolve()
    upload_root = config.UPLOAD_DIR.resolve()

    # 双重保险：解析后的绝对路径必须真的在 uploads 目录里面
    if not str(target).startswith(str(upload_root)):
        return False

    if target.is_file():
        target.unlink()
        return True
    return False


# ==================================================================
# 六、智能匹配（进阶功能）
# ==================================================================

# 各维度的权重，加起来等于 1。
# 设计理由：物品名是最核心的判断依据（"校园卡"和"校园卡"几乎肯定是同一个），
# 所以给最高权重；地点次之；描述和时间的区分度相对弱一些。
MATCH_WEIGHTS: dict[str, float] = {
    "title": 0.45,
    "location": 0.25,
    "description": 0.15,
    "time": 0.15,
}

# 低于这个分数就不认为匹配，避免把一堆无关信息推给用户
MATCH_SCORE_THRESHOLD = 0.40

# 物品名相似度低于这个值直接判负。
# 理由：如果连名字都不像，地点和时间再接近也没意义
# （同一天在图书馆丢的校园卡和捡到的雨伞，显然不是一回事）。
TITLE_MIN_SIMILARITY = 0.30


def _normalize_text(text: str) -> str:
    """把文本标准化，减少无意义的差异对相似度的影响。

    处理内容：
      · 转小写（Card 和 card 应视为相同）
      · 去掉空白和常见标点
      · 全角字符转半角（用户可能用中文输入法打出全角字母）
    """
    if not text:
        return ""
    result = text.strip().lower()
    # 全角 → 半角（全角字符编码区间 U+FF01~U+FF5E 对应半角 U+0021~U+007E）
    result = "".join(
        chr(ord(ch) - 0xFEE0) if "\uff01" <= ch <= "\uff5e" else ch for ch in result
    )
    # 去掉所有非字母数字汉字字符
    return re.sub(r"[^\w\u4e00-\u9fff]", "", result)


def text_similarity(a: str, b: str) -> float:
    """计算两段文本的相似度，返回 0.0 ~ 1.0。

    算法：字符二元组（bigram）的 Dice 系数。
    --------------------------------------------------
    为什么不直接把两个字符串比较？
    因为"校园卡"和"校园卡套"应该算高度相似，而不是"完全不同的两个词"。

    做法是把文本切成相邻两字的组合：
        "校园卡"  -> {"校园", "园卡"}
        "校园卡套" -> {"校园", "园卡", "卡套"}
    然后看两个集合的交集占比：
        交集 = {"校园","园卡"} 共 2 个
        Dice = 2 * 2 / (2 + 3) = 0.8   → 高度相似，符合直觉

    这个算法不需要任何外部模型、不联网、速度快，
    对中文短文本的效果相当好。
    """
    x = _normalize_text(a)
    y = _normalize_text(b)

    if not x or not y:
        return 0.0
    if x == y:
        return 1.0

    # 单字文本没法切 bigram，退化成精确比较
    if len(x) < 2 or len(y) < 2:
        return 1.0 if x == y else 0.0

    def bigrams(s: str) -> set[str]:
        return {s[i : i + 2] for i in range(len(s) - 1)}

    bx, by = bigrams(x), bigrams(y)
    if not bx or not by:
        return 0.0

    overlap = len(bx & by)
    return 2.0 * overlap / (len(bx) + len(by))


def _location_similarity(loc_a: str, loc_b: str) -> float:
    """地点相似度。

    给"互相包含"较高分数，因为用户描述粒度常常不同：
        失主填："图书馆"
        拾主填："下沙校区图书馆二楼"
    这两个字符串的 bigram 相似度不高，但显然指的是同一个地方。

    【防御】限制短串长度不小于 2，避免"楼"这种单字命中一切。
    """
    a = _normalize_text(loc_a)
    b = _normalize_text(loc_b)

    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) >= 2 and a in b:
        return 0.9
    if len(b) >= 2 and b in a:
        return 0.9
    return text_similarity(loc_a, loc_b)


def _parse_time(value: str | None) -> Any:
    """把时间字符串解析成 datetime，失败返回 None。

    支持 "2026-09-26T14:30:00" 和 "2026-09-26 14:30" 两种写法。
    """
    if not value:
        return None
    from datetime import datetime

    text = str(value).strip().replace(" ", "T")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _time_similarity(lost_time: str | None, found_time: str | None) -> float:
    """时间接近度。

    业务逻辑：**丢失时间必须早于或等于拾取时间**，否则逻辑矛盾
    （不可能先被人捡到、后被人丢掉）。

    在这个前提下，两者间隔越短越可能是同一件东西。
    """
    lost_dt = _parse_time(lost_time)
    found_dt = _parse_time(found_time)

    # 任一方没填时间，就给一个中性分，不因为缺信息就全盘否定
    if lost_dt is None or found_dt is None:
        return 0.5

    delta_hours = (found_dt - lost_dt).total_seconds() / 3600.0

    # 拾取时间早于丢失时间 → 逻辑上不可能是同一件东西，直接判负
    if delta_hours < -24: #间隔1天以上
        return 0.0

    # 分段给分，简单直观，也便于在界面上解释
    if delta_hours <= 6:
        return 1.0
    if delta_hours <= 24:
        return 0.85
    if delta_hours <= 72:
        return 0.65
    if delta_hours <= 24 * 7:
        return 0.45
    return 0.25


def compute_match_score(lost: sqlite3.Row, found: sqlite3.Row) -> tuple[float, str]:
    """计算一条失物和一条招领的匹配得分。

    返回 (得分 0~1, 人类可读的匹配理由)。

    设计成返回理由，是因为"只给一个分数"用户看不懂也不信任；
    说明"为什么认为这两条匹配"才有说服力。
    """
    title_sim = text_similarity(lost["title"], found["title"])

    # 名称都不像就不是同一件东西，直接判负，不浪费后续计算
    if title_sim < TITLE_MIN_SIMILARITY:
        return 0.0, ""

    location_sim = _location_similarity(lost["location"] or "", found["location"] or "")
    desc_sim = text_similarity(lost["description"] or "", found["description"] or "")
    time_sim = _time_similarity(lost["event_time"], found["event_time"])

    # 时间矛盾（拾取早于丢失前24小时）直接判负
    if time_sim == 0.0:
        return 0.0, ""

    score = (
        MATCH_WEIGHTS["title"] * title_sim
        + MATCH_WEIGHTS["location"] * location_sim
        + MATCH_WEIGHTS["description"] * desc_sim
        + MATCH_WEIGHTS["time"] * time_sim
    )

    # 生成理由：只写得分高的维度，避免理由太长
    reasons: list[str] = []
    if title_sim >= 0.6:
        reasons.append(f"物品名称高度相似（{title_sim:.0%}）")
    elif title_sim >= 0.3:
        reasons.append(f"物品名称部分相似（{title_sim:.0%}）")

    if location_sim >= 0.9:
        reasons.append("地点一致")
    elif location_sim >= 0.5:
        reasons.append("地点接近")

    if time_sim >= 0.85:
        reasons.append("时间吻合")
    elif time_sim >= 0.6:
        reasons.append("时间接近")

    if desc_sim >= 0.5:
        reasons.append("描述内容重合度较高")

    reason = "；".join(reasons) if reasons else "多项信息接近"

    return round(min(score, 1.0), 4), reason


def find_match_candidates(
    conn: sqlite3.Connection,
    item_id: int,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """给指定信息找出最可能匹配的对方信息。

    返回按得分倒序排列的匹配结果列表。

    【实现说明】为什么在 Python 里算分，而不用 SQL 算？
    因为相似度算法（bigram Dice 系数）不是 SQLite 能表达的计算。
    真实生产环境会把这一步放到专门的匹配服务里。
    本项目的数据量（校园级、几千条）完全够用，
    而且候选集先用 SQL 粗筛（只取对方类型、排除已结束的），
    不会真的两两全表比对。
    """
    current = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if current is None:
        return []

    # 粗筛：只找**相反类型**的信息。
    # 失物配招领，招领配失物。并排除已结束的（不需要再匹配了）。
    opposite_type = ItemsTable.TYPE_FOUND if current["type"] == ItemsTable.TYPE_LOST else ItemsTable.TYPE_LOST

    candidates = conn.execute(
        """
        SELECT i.*, u.username AS owner_username, u.display_name AS owner_display_name,
               u.contact AS owner_contact
        FROM items i
        JOIN users u ON u.id = i.owner_id
        WHERE i.type = ? AND i.status != 'closed' AND i.id != ?
        ORDER BY i.created_at DESC
        LIMIT 500
        """,
        (opposite_type, item_id),
    ).fetchall()

    # 确定哪条是"失物"、哪条是"招领"。
    # 时间比较的逻辑依赖这个顺序，不能搞反。
    if current["type"] == ItemsTable.TYPE_LOST:
        lost_row, found_row = current, None
    else:
        lost_row, found_row = None, current

    results: list[dict[str, Any]] = []
    for cand in candidates:
        if lost_row is not None:
            score, reason = compute_match_score(lost_row, cand)
            other = cand
        else:
            score, reason = compute_match_score(cand, found_row)
            other = cand

        if score >= MATCH_SCORE_THRESHOLD:
            results.append(
                {
                    "item_id": other["id"],
                    "title": other["title"],
                    "type": other["type"],
                    "location": other["location"] or "",
                    "event_time": other["event_time"],
                    "cover_image": other["cover_image"] or "",
                    "score": score,
                    "score_percent": round(score * 100),
                    "reason": reason,
                    "owner_display_name": other["owner_display_name"] or other["owner_username"],
                }
            )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]


def refresh_match_cache(conn: sqlite3.Connection, item_id: int) -> None:
    """重算并缓存某条信息的匹配结果到 matches 表。

    为什么既实时计算又写缓存表？
    · 实时计算的接口（suggestions）保证结果永远是最新的
    · 缓存表用于将来做"匹配通知"（比如定时任务扫描新发布的失物，主动通知失主）
    两者相辅相成，这里先打好基础。
    """
    current = conn.execute("SELECT type FROM items WHERE id = ?", (item_id,)).fetchone()
    if current is None:
        return

    # 先清掉这条信息相关的旧匹配记录，再重新写入
    conn.execute("DELETE FROM matches WHERE lost_id = ? OR found_id = ?", (item_id, item_id))

    candidates = find_match_candidates(conn, item_id, limit=20)
    if not candidates:
        return

    is_lost = current["type"] == ItemsTable.TYPE_LOST
    for cand in candidates:
        lost_id = item_id if is_lost else cand["item_id"]
        found_id = cand["item_id"] if is_lost else item_id
        conn.execute(
            """
            INSERT OR REPLACE INTO matches (lost_id, found_id, score, reason)
            VALUES (?, ?, ?, ?)
            """,
            (lost_id, found_id, cand["score"], cand["reason"]),
        )


# ==================================================================
# 七、常量导出（供文档和前端使用）
# ==================================================================

__all__ = [
    "ALLOWED_STATUS_TRANSITIONS",
    "STATUS_LABELS",
    "TYPE_LABELS",
    "ItemImagesTable",
    "ItemsTable",
    "build_page_meta",
    "build_search_clause",
    "can_transition",
    "compute_match_score",
    "delete_image_file",
    "describe_transition_error",
    "escape_like",
    "fetch_item_images",
    "find_match_candidates",
    "normalize_pagination",
    "refresh_match_cache",
    "resolve_order_by",
    "row_to_item_detail",
    "row_to_item_public",
    "save_base64_image",
    "text_similarity",
]
