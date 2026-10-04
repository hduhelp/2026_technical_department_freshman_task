"""
失物招领接口：发布、浏览、搜索、修改、删除、状态流转、图片、智能匹配。

对应任务的：
    「基础要求 2：发布失物 / 招领信息」
    「基础要求 3：查看和搜索」
    「基础要求 4：状态管理」
    「进阶方向：图片上传 / AI 智能匹配」

权限模型（很重要）
------------------
    游客     可以浏览列表和详情
    登录用户 可以发布信息
    发布者   才能修改 / 删除 / 改状态 / 管理自己帖子的图片

【关键设计】前端的"隐藏按钮"只是体验优化，**不是安全措施**。
真正的权限校验必须在这里做（见 _assert_can_modify），
因为任何人都可以绕过前端直接调接口。
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from .. import schemas, utils
from ..database import get_db, transaction
from ..deps import CurrentUser, OptionalUser
from ..models import ItemsTable, STATUS_LABELS, TYPE_LABELS

router = APIRouter(prefix="/api/items", tags=["失物招领"])


# ==================================================================
# 内部工具
# ==================================================================

# 列表和详情共用的查询语句。
# 用 JOIN 一次把发布者和保管者的信息都查出来，避免对列表里每一条
# 都单独再查一次用户表（那叫 N+1 查询问题，数据量大时会非常慢）。
#
# 【注意别名】items 和 users 两张表都有 contact 列，
# 如果直接写 h.contact，结果行里就会出现两个同名列，
# 用 row["contact"] 取值时行为不确定（SQLite 返回第一个）。
# 所以这里给两张用户表的联系人都起别名，后面一律按别名取值。
#
# 保管者用 LEFT JOIN：非常常见的情况是保管者不注册账号
# （比如"图书馆服务台""王老师"），这时 holder_user_id 为 NULL，
# 用 INNER JOIN 会让整条记录消失。
_ITEM_SELECT = """
    SELECT
        i.*,
        u.username       AS owner_username,
        u.display_name   AS owner_display_name,
        u.contact        AS owner_contact,
        h.username       AS holder_username,
        h.display_name   AS holder_display_name,
        h.contact        AS holder_contact
    FROM items i
    JOIN users u       ON u.id = i.owner_id
    LEFT JOIN users h  ON h.id = i.holder_user_id
"""


def _fetch_item_row(conn: sqlite3.Connection, item_id: int) -> sqlite3.Row | None:
    """按 id 取一条信息（含发布者与保管者信息）。"""
    return conn.execute(f"{_ITEM_SELECT} WHERE i.id = ?", (item_id,)).fetchone()


def _get_item_or_404(conn: sqlite3.Connection, item_id: int) -> sqlite3.Row:
    """取信息，不存在就抛 404。"""
    row = _fetch_item_row(conn, item_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "item_not_found", "message": "这条信息不存在或已被删除"},
        )
    return row


def _can_manage(row: sqlite3.Row, user: sqlite3.Row) -> bool:
    """判断用户是否有权管理这条信息。

    有权限的**两类人**：

      1. 发布者（owner_id）
         谁发的谁当然能改。

      2. 保管者（holder_user_id）
         这是本项目和一般练手项目不同的地方：东西现在在保管者手里，
         所以物品状态的变化（比如"已经交还给失主了"）往往只有他知道。
         如果只允许发布者改，就会出现"老师发的帖，拾取者拿不回管理权"的问题。

    注意 holder_user_id 可能是 NULL（保管者不注册账号），
    所以必须先判空再比较，否则 NULL != 5 也会返回真，造成越权。
    """
    if row["owner_id"] == user["id"]:
        return True
    holder_id = row["holder_user_id"]
    return holder_id is not None and holder_id == user["id"]


def _assert_can_modify(row: sqlite3.Row, user: sqlite3.Row) -> None:
    """【权限校验】只有发布者或保管者本人能改这条信息。

    为什么用 403 而不是 404？
    403 表示"我知道这条信息存在，但你没权限改"，
    404 表示"这个东西不存在"。语义不同，403 更准确。
    """
    if not _can_manage(row, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "not_owner",
                "message": "只能修改或删除自己发布、或自己保管的信息",
            },
        )


def _replace_images(conn: sqlite3.Connection, item_id: int, urls: list[str]) -> None:
    """全量替换一条信息的图片列表。

    实现方式：先删旧记录再插新的，而不是逐条比对差异。
    理由：图片数量很少（最多 9 张），全量替换的代码简单、不易出错，
    性能差异可以忽略。这种"简单优先"的取舍在业务代码里很常见。
    """
    conn.execute("DELETE FROM item_images WHERE item_id = ?", (item_id,))
    for index, url in enumerate(urls):
        conn.execute(
            "INSERT INTO item_images (item_id, url, sort_order) VALUES (?, ?, ?)",
            (item_id, url, index),
        )


def _sync_cover_image(conn: sqlite3.Connection, item_id: int, urls: list[str]) -> str:
    """把第一张图设为封面图，列表页只需读这个字段，不用每次去联表查图片。

    这是典型的"用一点冗余换查询性能"的取舍：写的时候多一步，读的时候快很多。
    """
    cover = urls[0] if urls else ""
    conn.execute("UPDATE items SET cover_image = ? WHERE id = ?", (cover, item_id))
    return cover


# ==================================================================
# 1. 查看列表 + 搜索 + 分页
# ==================================================================


@router.get(
    "",
    response_model=schemas.ItemListResponse,
    summary="查看信息列表（支持搜索、筛选、排序、分页）",
    description=(
        "游客也能访问。这是本项目集中体现 SQL 知识点的地方：\n\n"
        "| SQL 知识点 | 用在哪里 |\n"
        "|---|---|\n"
        "| `WHERE` | 按类型、状态、地点、发布者筛选 |\n"
        "| `LIKE` | 关键词模糊搜索物品名和描述 |\n"
        "| `ORDER BY` | 按发布时间 / 事件时间 / 浏览量排序 |\n"
        "| `LIMIT` + `OFFSET` | 分页 |\n"
        "| `COUNT(*)` | 统计总条数，用于计算总页数 |\n\n"
        "**搜索安全**：关键词里的 `%` 和 `_` 会被转义，"
        "所以搜「100%」不会变成「以 100 开头」。"
    ),
)
def list_items(
    user: OptionalUser,
    q: str | None = Query(None, description="关键词，同时匹配物品名和描述"),
    type: str | None = Query(None, description="lost=寻物启事，found=招领启事"),
    status_filter: str | None = Query(
        None, alias="status", description="searching=寻找中，found=已找到，closed=已结束"
    ),
    location: str | None = Query(None, description="地点关键词"),
    sort: str | None = Query(
        None, description="newest=最新 / oldest=最早 / event_desc / event_asc / popular=最热"
    ),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(utils.PAGE_SIZE_DEFAULT, ge=1, description="每页条数，最大 50"),
):
    safe_page, safe_size = utils.normalize_pagination(page, page_size)
    where_sql, params = utils.build_search_clause(q, type, status_filter, location)
    order_by = utils.resolve_order_by(sort)

    current_user_id = user["id"] if user is not None else None

    with get_db() as conn:
        # --- 先查总数（用于计算总页数）---
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM items i {where_sql}", params
        ).fetchone()["n"]

        # --- 再查当前页的数据 ---
        # 【知识点】LIMIT 限制返回条数，OFFSET 跳过前面多少条。
        # 第 1 页 offset=0，第 2 页 offset=page_size，以此类推。
        offset = (safe_page - 1) * safe_size
        rows = conn.execute(
            f"""
            {_ITEM_SELECT}
            {where_sql}
            ORDER BY {order_by}
            LIMIT ? OFFSET ?
            """,
            [*params, safe_size, offset],
        ).fetchall()

    meta = utils.build_page_meta(total, safe_page, safe_size)
    return schemas.ItemListResponse(
        items=[utils.row_to_item_public(r, current_user_id) for r in rows],
        **meta,
    )


# ==================================================================
# 2. 我发布的信息
# ==================================================================

# 【路由顺序注意】这个路径必须定义在 `/{item_id}` **之前**吗？
# 其实不需要 —— 因为 FastAPI 按定义顺序匹配，"/mine" 如果放在 "/{item_id}" 之后，
# 请求 /api/items/mine 会先匹配到 /{item_id} 并把 "mine" 当成 item_id 解析，
# 结果是 422 错误。所以放在前面是必要的，这是一个很经典的踩坑点。


@router.get(
    "/mine",
    response_model=schemas.ItemListResponse,
    summary="查看我发布的信息",
    description=(
        "只返回当前登录用户发布的信息，支持按类型和状态筛选。\n\n"
        "**安全设计**：发布者 id 取自登录凭证，而不是查询参数。"
        "如果做成 `?owner_id=1`，任何人都能查看别人的「我的发布」。"
    ),
)
def list_my_items(
    user: CurrentUser,
    type: str | None = Query(None, description="lost / found"),
    status_filter: str | None = Query(None, alias="status", description="searching / found / closed"),
    page: int = Query(1, ge=1),
    page_size: int = Query(utils.PAGE_SIZE_DEFAULT, ge=1),
):
    safe_page, safe_size = utils.normalize_pagination(page, page_size)
    where_sql, params = utils.build_search_clause(
        None, type, status_filter, None, owner_id=user["id"]
    )

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM items i {where_sql}", params
        ).fetchone()["n"]
        offset = (safe_page - 1) * safe_size
        rows = conn.execute(
            f"""
            {_ITEM_SELECT}
            {where_sql}
            ORDER BY i.created_at DESC, i.id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_size, offset],
        ).fetchall()

    meta = utils.build_page_meta(total, safe_page, safe_size)
    return schemas.ItemListResponse(
        items=[utils.row_to_item_public(r, user["id"]) for r in rows],
        **meta,
    )


# ==================================================================
# 3. 发布信息
# ==================================================================


def _resolve_holder(
    conn: sqlite3.Connection,
    payload: schemas.ItemCreate | schemas.ItemUpdate,
    user: sqlite3.Row,
    item_type: str,
) -> tuple[int | None, str, str]:
    """根据请求内容确定「保管者」是谁。

    返回 (holder_user_id, holder_name, holder_place)。

    ── 首先一条：寻物启事没有保管者 ──
    「谁发现的」「东西在谁手里」是**招领启事**才有的概念：
    东西被捡到了，才谈得上谁捡的、现在在哪。
    而寻物启事是失主在说自己丢了什么，那时东西不在他手上（甚至根本找不到），
    所以对 lost 类型一律返回空值。

    这条规则放在**后端**而不是只靠前端不给字段，是刻意的：
    接口是可以被直接调用的（/docs、脚本、别人写的客户端），
    如果只在前端隐藏输入框，任何人都能提交一条"寻物启事 + 保管者是王老师"
    的矛盾数据。业务规则必须由后端守住。

    ── 招领启事的三种情况 ──
      1. holder_is_reporter=True（默认）
         → 发布人就是保管者，把 holder_user_id 设为发布者自己。
         这样"东西在谁手上"这个问题永远有答案，前端逻辑也能统一处理。

      2. 填了 holder_username 且该用户存在
         → 保管者是平台上的另一个用户，关联到他的账号。
         效果：TA 登录后也能管理这条信息（改状态、编辑）。

      3. 只填了 holder_name / holder_place
         → 保管者不是平台用户（例如"图书馆服务台""王老师"）。
         只存文字，不关联账号。这是很常见的情况，必须支持。

    【为什么要区分这几种】
    因为"谁捡到的""东西在谁手里""谁发的帖"经常是三个人。
    比如初中生捡到一包现金不敢自己拿，第一时间交给老师，老师来发帖 ——
    失主真正要去的是老师那里，所以保管者信息比发布者信息更重要。
    """
    # 寻物启事：不存在保管者
    if item_type != ItemsTable.TYPE_FOUND:
        return None, "", ""

    holder_username = (getattr(payload, "holder_username", "") or "").strip().lower()

    # 情况 2：指定了保管者账号
    if holder_username:
        holder = conn.execute(
            "SELECT id, username, display_name FROM users WHERE username = ?",
            (holder_username,),
        ).fetchone()

        if holder is None:
            # 这里给 400 而不是 404：是"你填的用户名不对"，
            # 不是"你要访问的资源不存在"。
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "holder_not_found",
                    "message": (
                        f"找不到用户名为「{holder_username}」的用户。"
                        "如果保管者没有注册账号，请留空用户名、直接填写保管者称呼和保管地点"
                    ),
                },
            )

        # 保管者账号与文字信息可以并存：账号用于权限，文字用于展示。
        # holder_name 留空时用对方的昵称补上，免得详情页显示空。
        return (
            int(holder["id"]),
            (getattr(payload, "holder_name", "") or "").strip() or holder["display_name"],
            (getattr(payload, "holder_place", "") or "").strip(),
        )

    # 情况 1：发布人就是保管者
    holder_is_reporter = getattr(payload, "holder_is_reporter", True)
    if holder_is_reporter:
        return int(user["id"]), (getattr(payload, "holder_name", "") or "").strip(), (
            getattr(payload, "holder_place", "") or ""
        ).strip()

    # 情况 3：只填了文字信息（保管者不是平台用户）
    return (
        None,
        (getattr(payload, "holder_name", "") or "").strip(),
        (getattr(payload, "holder_place", "") or "").strip(),
    )


@router.post(
    "",
    response_model=schemas.ItemDetail,
    status_code=status.HTTP_201_CREATED,
    summary="发布失物 / 招领信息",
    description=(
        "需要登录。\n\n"
        "## 两种类型，字段含义不同\n\n"
        "| | `type=lost`（寻物启事） | `type=found`（招领启事） |\n"
        "|---|---|---|\n"
        "| 场景 | 我丢了东西 | 我捡到东西 |\n"
        "| `event_time` | **丢失时间** | **发现时间** |\n"
        "| `location` | **丢失地点** | **发现地点** |\n"
        "| `finder_name` | 不使用（后端会强制清空） | 谁发现的 |\n"
        "| `holder_*` | 不使用（后端会强制清空） | 东西现在在谁手里 |\n\n"
        "**为什么寻物启事没有「发现者」和「保管者」**：\n"
        "这两个角色是招领启事才有的 —— 东西被捡到了，才谈得上谁发现的、现在在谁手里。\n"
        "而寻物启事是失主在说自己丢了什么，那时东西不在他手上，谈保管者没有意义。\n"
        "即使客户端强行提交这些字段，后端也会忽略并清空。\n\n"
        "## 招领启事的保管者怎么填\n\n"
        "- `holder_is_reporter=true`（默认）表示发布人自己就是保管者\n"
        "- 如果东西已经交给别人代为保管（老师、宿管、保卫处），"
        "设为 `false`，再填 `holder_name` 和 `holder_place`\n"
        "- `holder_username` 可以指定一个平台用户作为保管者，"
        "**TA 登录后也能管理这条信息**"
        "（这是「发现者和保管者都可以管理」的实现方式）\n\n"
        "发布后状态默认为「寻找中」。"
    ),
)
def create_item(payload: schemas.ItemCreate, user: CurrentUser):
    with transaction() as conn:
        # 先确定保管者（可能需要在用户表里查人）。
        # 【注意】寻物启事会在这里被强制清空保管者和发现者字段 ——
        # 那类信息只对招领启事有意义，详见 _resolve_holder 的说明。
        is_found = payload.type == ItemsTable.TYPE_FOUND
        holder_user_id, holder_name, holder_place = _resolve_holder(
            conn, payload, user, payload.type
        )
        finder_name = payload.finder_name if is_found else ""

        cursor = conn.execute(
            """
            INSERT INTO items (
                owner_id, type, status, title, description, location, event_time, contact,
                finder_name, holder_user_id, holder_name, holder_place
            )
            VALUES (?, ?, 'searching', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                payload.type,
                payload.title,
                payload.description,
                payload.location,
                payload.event_time,
                payload.contact,
                finder_name,
                holder_user_id,
                holder_name,
                holder_place,
            ),
        )
        item_id = int(cursor.lastrowid)

        if payload.image_urls:
            _replace_images(conn, item_id, payload.image_urls)
            _sync_cover_image(conn, item_id, payload.image_urls)

        # 顺手把这条信息的匹配结果算出来写进 matches 表。
        # 为什么在发布时就算，而不是等用户去点"匹配"？
        # 因为将来要做"新发布一条失物 → 自动通知可能匹配的拾主"这类功能，
        # 需要提前有缓存数据。实时查询接口仍然照常工作，两者互不依赖。
        # 放在同一事务里，保证不会出现"信息存在但匹配结果丢了"的不一致状态。
        try:
            utils.refresh_match_cache(conn, item_id)
        except sqlite3.Error:
            # 匹配计算是锦上添花的功能，它失败不应该让"发布信息"这个主流程失败
            pass

        row = _fetch_item_row(conn, item_id)
        images = utils.fetch_item_images(conn, item_id)

    return utils.row_to_item_detail(row, images, user["id"])


# ==================================================================
# 4. 查看某条详情
# ==================================================================


@router.get(
    "/{item_id}",
    response_model=schemas.ItemDetail,
    summary="查看信息详情",
    description=(
        "游客也能访问。每次调用会把浏览量 +1。\n\n"
        "比列表多返回两项：**图片列表** 和 **发布者联系方式**。"
        "联系方式只在详情页返回，避免被人批量抓取整个平台的联系方式。"
    ),
)
def get_item(item_id: int, user: OptionalUser):
    current_user_id = user["id"] if user is not None else None

    with transaction() as conn:
        row = _get_item_or_404(conn, item_id)

        # 浏览量自增。在 SQL 里做 `view_count = view_count + 1`
        # 而不是"先读出来 +1 再写回"，后者在并发下会丢计数。
        conn.execute("UPDATE items SET view_count = view_count + 1 WHERE id = ?", (item_id,))
        images = utils.fetch_item_images(conn, item_id)

        # 重新查一次，让返回的 view_count 是自增后的值
        row = _fetch_item_row(conn, item_id)

    return utils.row_to_item_detail(row, images, current_user_id)


# ==================================================================
# 5. 修改信息
# ==================================================================


@router.patch(
    "/{item_id}",
    response_model=schemas.ItemDetail,
    summary="修改信息",
    description=(
        "**发布者和保管者都能修改**，其他人返回 403。\n\n"
        "为什么保管者也能改？因为东西现在在他手上，情况变化（比如已经交还失主、"
        "或者物品从老师手上转到了保卫处）往往只有他知道。\n\n"
        "**注意**：`type`（失物/招领）不允许修改。\n"
        "如果发布时选错了类型，应该删除后重新发布 —— "
        "因为改类型会让已有的智能匹配结果全部失效，语义上也不合理。"
    ),
)
def update_item(item_id: int, payload: schemas.ItemUpdate, user: CurrentUser):
    provided = payload.model_dump(exclude_unset=True)

    # 可修改字段白名单 → 数据库列名
    #
    # 只有这五个字段能直接照着改。保管相关的字段（holder_user_id 等）
    # 不能直接写入，因为 holder_username 要先在用户表里查成 id，
    # 所以交给 _resolve_holder 统一算，见下面。
    column_map: dict[str, str] = {
        "title": "title",
        "description": "description",
        "location": "location",
        "event_time": "event_time",
        "contact": "contact",
        "finder_name": "finder_name",
        "holder_name": "holder_name",
        "holder_place": "holder_place",
    }
    columns = [(column_map[k], v) for k, v in provided.items() if k in column_map]

    with transaction() as conn:
        row = _get_item_or_404(conn, item_id)
        _assert_can_modify(row, user)

        # 当前这条信息的类型。type 不允许修改，所以用它判断
        # "这条信息该不该有保管者字段"。
        is_found = row["type"] == ItemsTable.TYPE_FOUND

        # ---------- 保管者相关字段的更新 ----------
        # 只有前端确实传了这两个之一才重新解析，避免"只改标题"时
        # 把 holder_user_id 意外重置掉。
        #
        # 注意：holder_name / holder_place 走上面的 column_map 直接更新，
        # 不参与这里的解析；这里只负责算 holder_user_id。
        if {"holder_is_reporter", "holder_username"} & provided.keys():
            holder_user_id, holder_name, holder_place = _resolve_holder(
                conn, payload, user, row["type"]
            )
            columns.extend(
                [
                    ("holder_user_id", holder_user_id),
                    ("holder_name", holder_name),
                    ("holder_place", holder_place),
                ]
            )

        # ---------- 寻物启事：强制清空保管者与发现者 ----------
        # 【为什么要在这里拦一道】
        # 上面那个 if 只在客户端传了 holder_* 字段时才走。
        # 但客户端可以直接调接口传 finder_name / holder_name 而不传 holder_is_reporter，
        # 这样就会绕过校验，把"发现者""保管者"写进一条寻物启事里。
        # 业务规则必须由后端保证，不能只依赖前端不传。
        if not is_found:
            columns.extend(
                [
                    ("finder_name", ""),
                    ("holder_user_id", None),
                    ("holder_name", ""),
                    ("holder_place", ""),
                ]
            )

        if columns:
            set_clause = ", ".join(f"{col} = ?" for col, _ in columns)
            values: list[Any] = [v for _, v in columns]
            values.append(item_id)
            conn.execute(
                f"UPDATE items SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
                values,
            )

        # image_urls 单独处理：传了才动，没传就不碰
        if "image_urls" in provided and provided["image_urls"] is not None:
            _replace_images(conn, item_id, provided["image_urls"])
            _sync_cover_image(conn, item_id, provided["image_urls"])

        row = _fetch_item_row(conn, item_id)
        images = utils.fetch_item_images(conn, item_id)

    return utils.row_to_item_detail(row, images, user["id"])


# ==================================================================
# 6. 修改状态（基础要求 4）
# ==================================================================


@router.patch(
    "/{item_id}/status",
    response_model=schemas.ItemDetail,
    summary="修改信息状态（寻找中 / 已找到 / 已结束）",
    description=(
        "只有发布者本人能修改。\n\n"
        "**状态流转规则**：\n\n"
        "```\n"
        "寻找中 searching\n"
        "   ↓ 找到了\n"
        "已找到 found\n"
        "   ↓ 事情办完了\n"
        "已结束 closed\n"
        "```\n\n"
        "允许在纠错场景下回退（比如误点「已结束」可以改回「寻找中」），"
        "但状态值本身只能是这三个之一，非法值或被拒绝的流转返回 400。\n\n"
        "**为什么要有状态管理？** 一条信息不应该永远停在「寻找中」："
        "东西已经找到了却还挂着，会让其他想帮忙的同学白费力气。"
    ),
)
def update_item_status(item_id: int, payload: schemas.ItemStatusUpdate, user: CurrentUser):
    with transaction() as conn:
        row = _get_item_or_404(conn, item_id)
        _assert_can_modify(row, user)

        current_status = row["status"]
        target_status = payload.status

        # 【业务规则校验】不允许非法的状态跳跃
        if not utils.can_transition(current_status, target_status):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_status_transition",
                    "message": utils.describe_transition_error(current_status, target_status),
                    "current_status": current_status,
                    "current_status_label": STATUS_LABELS.get(current_status, current_status),
                },
            )

        conn.execute(
            "UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (target_status, item_id),
        )
        row = _fetch_item_row(conn, item_id)
        images = utils.fetch_item_images(conn, item_id)

    return utils.row_to_item_detail(row, images, user["id"])


# ==================================================================
# 7. 删除信息
# ==================================================================


@router.delete(
    "/{item_id}",
    response_model=schemas.MessageResponse,
    summary="删除自己发布的信息",
    description=(
        "只有发布者本人能删除。\n\n"
        "删除时会连带清理：\n"
        "- 该信息的图片数据库记录（外键 `ON DELETE CASCADE` 自动处理）\n"
        "- 磁盘上的图片文件（代码显式清理，避免留下垃圾文件）\n"
        "- 该信息相关的匹配结果\n\n"
        "**思考**：这里用的是「硬删除」，数据真的没了。"
        "生产系统常用「软删除」（加一个 `deleted_at` 字段标记），"
        "好处是误删可以恢复、也便于追溯。本项目从简处理，"
        "但在 `models.py` 里留了这个设计讨论。"
    ),
)
def delete_item(item_id: int, user: CurrentUser):
    with transaction() as conn:
        row = _get_item_or_404(conn, item_id)
        _assert_can_modify(row, user)

        # 先把图片地址取出来，删记录之后就查不到了
        images = utils.fetch_item_images(conn, item_id)

        # 显式清理匹配记录（虽然外键也能级联，但写清楚意图更好读）
        conn.execute("DELETE FROM matches WHERE lost_id = ? OR found_id = ?", (item_id, item_id))
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))

    # 数据库事务提交后再删文件。
    # 反过来做的话，如果事务回滚，文件已经没了但记录还在，数据就不一致了。
    removed = sum(1 for url in images if utils.delete_image_file(url))

    return schemas.MessageResponse(
        message="已删除该信息",
        detail=f"同时清理了 {removed} 张图片",
    )


# ==================================================================
# 8. 图片上传（进阶功能）
# ==================================================================
#
# 【为什么单独开一个 router？】
# 图片上传接口如果挂在 /api/items 下面，路径会是 POST /api/items/images，
# 而它上面已经定义了 POST /api/items/{item_id}。
# FastAPI 按定义顺序匹配路由，"/images" 会被当成 item_id 去解析成整数，
# 结果是 422 参数错误 —— 这是个很典型的踩坑点。
#
# 与其小心翼翼地调整定义顺序（脆弱，以后加接口容易再踩），
# 不如直接换一个不会冲突的前缀：/api/uploads。
# 这是更好的做法：**从结构上消除冲突，而不是靠顺序回避它**。

uploads_router = APIRouter(prefix="/api/uploads", tags=["图片上传"])


@uploads_router.post(
    "/images",
    response_model=schemas.ImageUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="上传图片（发布前先上传，拿到 URL 再填进信息里）",
    description=(
        "需要登录。\n\n"
        "**为什么用 base64 而不是 multipart 表单？**\n"
        "解析 multipart 需要额外的 `python-multipart` 包，"
        "而本项目的设计目标之一是依赖尽量少。\n"
        "前端用 `FileReader` 把图片读成 base64 放进 JSON 提交即可。\n\n"
        "**安全校验**：\n"
        "- 大小限制 5MB\n"
        "- 只允许 JPG / PNG / GIF / WebP\n"
        "- **不看文件后缀，直接校验文件头的魔术字节** —— "
        "因为后缀和 content-type 都是客户端可伪造的\n"
        "- 用随机 UUID 重命名文件，防止覆盖和路径穿越"
    ),
)
def upload_image(payload: schemas.ImageUploadRequest, user: CurrentUser):
    try:
        url = utils.save_base64_image(payload.image_base64)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_image", "message": str(exc)},
        ) from exc

    return schemas.ImageUploadResponse(url=url)


@uploads_router.post(
    "/items/{item_id}/images",
    response_model=schemas.ItemDetail,
    summary="给已有信息追加图片",
    description="只有发布者本人能操作。在已有图片后面追加，不会覆盖原有图片。",
)
def add_item_images(item_id: int, payload: schemas.ImageUploadRequest, user: CurrentUser):
    try:
        url = utils.save_base64_image(payload.image_base64)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_image", "message": str(exc)},
        ) from exc

    with transaction() as conn:
        row = _get_item_or_404(conn, item_id)
        _assert_can_modify(row, user)

        existing = utils.fetch_item_images(conn, item_id)
        if len(existing) >= 9:
            # 先失败再删掉刚存的文件，避免留下没人引用的"孤儿文件"
            utils.delete_image_file(url)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "too_many_images", "message": "每条信息最多 9 张图片"},
            )

        merged = [*existing, url]
        _replace_images(conn, item_id, merged)
        _sync_cover_image(conn, item_id, merged)

        row = _fetch_item_row(conn, item_id)

    return utils.row_to_item_detail(row, merged, user["id"])


# ==================================================================
# 9. 智能匹配（进阶功能）
# ==================================================================


@router.get(
    "/{item_id}/suggestions",
    response_model=schemas.MatchSuggestionResponse,
    summary="智能匹配：为这条信息推荐可能的配对",
    description=(
        "这是「进阶方向：AI 智能匹配」的实现。\n\n"
        "**实现方式：规则打分，不依赖任何外部大模型 API。**\n"
        "好处是不花钱、不需要联网、演示时不会因为网络问题失败。\n\n"
        "打分维度与权重：\n\n"
        "| 维度 | 权重 | 说明 |\n"
        "|---|---|---|\n"
        "| 物品名相似度 | 45% | 最核心依据，用字符二元组 Dice 系数计算 |\n"
        "| 地点相似度 | 25% | 支持「图书馆」与「下沙校区图书馆二楼」视为同一地 |\n"
        "| 描述重合度 | 15% | 描述文本相似度 |\n"
        "| 时间接近度 | 15% | **拾取时间早于丢失时间会直接判负**（逻辑矛盾）|\n\n"
        "**为什么不用大模型？** 除了成本和稳定性，"
        "还因为规则打分**可解释** —— 每个匹配结果都会给出匹配理由，"
        "用户能看懂「为什么认为这两条是同一个东西」，比只给一个分数更可信。"
    ),
)
def get_match_suggestions(
    item_id: int,
    user: OptionalUser,
    limit: int = Query(5, ge=1, le=20, description="返回几条建议"),
):
    with get_db() as conn:
        row = _get_item_or_404(conn, item_id)
        suggestions = utils.find_match_candidates(conn, item_id, limit=limit)

    opposite_label = (
        TYPE_LABELS[ItemsTable.TYPE_FOUND]
        if row["type"] == ItemsTable.TYPE_LOST
        else TYPE_LABELS[ItemsTable.TYPE_LOST]
    )

    return schemas.MatchSuggestionResponse(
        item_id=item_id,
        item_title=row["title"],
        item_type=row["type"],
        opposite_type_label=opposite_label,
        suggestions=[schemas.MatchSuggestion(**s) for s in suggestions],
    )
