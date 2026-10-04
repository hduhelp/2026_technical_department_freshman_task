"""
数据模型说明（设计文档性质）。

为什么这里没有定义 ORM 类？
---------------------------
常规做法是用 SQLAlchemy 定义 `class User(Base)` 这样的模型类。
本项目没有引入 SQLAlchemy，而是直接在 `database.py` 里手写建表 SQL，
原因是任务明确要求掌握 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET`，
手写 SQL 能让每一句查询都清晰可见。

所以这个文件的作用不是"定义模型"，而是**记录数据模型的设计决策**：
每个字段为什么这样设计、有什么约束、将来怎么扩展。
真正的建表语句见 `database.py` 的 `SCHEMA_SQL`。

────────────────────────────────────────────────────────
表关系总览
────────────────────────────────────────────────────────

    users ──1:N──> items ──1:N──> item_images
      │              │
      │              └──N:M──> matches（失物 × 招领，智能匹配结果）
      │
      └──1:N──> user_sessions（已注销的 token 黑名单）

────────────────────────────────────────────────────────
"""

from __future__ import annotations

from typing import Final

# ==================================================================
# users —— 用户表
# ==================================================================


class UsersTable:
    """用户账号表。

    字段说明
    --------
    id            主键，自增
    username      登录名。**统一转小写存储**，这样 Tom 和 tom 不会变成两个账号。
                  加 UNIQUE 约束，由数据库保证不会重复（而不只靠应用层查重，
                  因为并发请求下"先查再插"存在竞态漏洞）。
    password_hash 密码哈希。格式：scrypt$n$r$p$盐$哈希
                  【安全】绝不存明文，也不存可逆加密结果。
    display_name  昵称，用于展示。允许为空，为空时前端回退显示 username。
    contact       联系方式（手机 / QQ / 微信）。用于让失主和拾主能互相联系。
    avatar        头像地址。阶段三前端实现后再用。
    created_at    注册时间。存 UTC，接口返回时补 Z 标记（见 database.utc_to_iso）
    updated_at    最后修改时间
    """

    TABLE: Final = "users"
    COLUMNS: Final = (
        "id",
        "username",
        "password_hash",
        "display_name",
        "contact",
        "avatar",
        "created_at",
        "updated_at",
    )
    # 这些字段绝不能出现在任何 API 响应里
    NEVER_EXPOSE: Final = ("password_hash",)


# ==================================================================
# user_sessions —— token 黑名单
# ==================================================================


class UserSessionsTable:
    """已注销 token 的记录表。

    为什么需要这张表？
    ------------------
    JWT 是无状态的：服务器签发后不再保存任何记录，
    因此**默认无法让一个还没过期的 token 提前失效**。

    如果退出登录只是清掉浏览器 Cookie，那个 token 字符串在自然过期前
    （本项目 7 天）依然完全有效。万一它已被别人复制走，退出登录拦不住他。

    解决办法就是这张表：记录退出登录时用过的 token 编号（jti），
    之后每次鉴权都查一下在不在黑名单里。

    字段说明
    --------
    jti         token 的唯一编号，主键
    user_id     属于哪个用户（用户删除时级联删除）
    expires_at  token 的自然过期时间（Unix 时间戳）。
                用途：token 本身过期后，这条黑名单记录就没意义了，
                可以定期清理，避免表无限增长（见 security.purge_expired_sessions）
    revoked_at  注销时间
    """

    TABLE: Final = "user_sessions"


# ==================================================================
# items —— 失物 / 招领信息表（核心）
# ==================================================================


class ItemsTable:
    """失物与招领信息表。

    【关键设计决策】为什么失物和招领用同一张表？
    --------------------------------------------
    两者的字段完全一致（物品名、地点、时间、描述、联系方式），
    只有 type 一个是 lost、一个是 found。

    合并的好处：
    1. 查询时加 `WHERE type = 'lost'` 就能分开，成本极低；
    2. **将来做智能匹配时**，要在"失物"和"招领"之间两两比对，
       同一张表里直接自连接（self join）就能算，比跨两张表方便得多。

    字段说明
    --------
    id          主键
    owner_id    发布者，外键指向 users.id。删除用户时其发布的信息级联删除。
    type        'lost'  = 寻物启事（我丢东西了）
                'found' = 招领启事（我捡到东西了）
                用 CHECK 约束限制取值，防止脏数据写进来。
    status      状态机，取值：
                  'searching' 寻找中
                  'found'     已找到
                  'closed'    已结束
                设计意图：一条信息不应该永远停在"寻找中"，
                否则别人看到会以为还需要帮忙，实际早就找到了。
    title       物品名称，如"校园卡"。搜索时主要匹配这个字段。
    description 详细描述，如"黑色卡套，里面有校园卡"。
    location    地点，如"下沙校区图书馆"。
    event_time  丢失 / 拾取的时间。存 ISO 8601 字符串。
                注意：这是**用户自己填的时间**，与 created_at（发布时间）不同。
                比如 9 月 20 日丢的卡，可能 9 月 26 日才来发布。
    contact     本条信息单独填的联系方式。
                为空时回退使用用户在 users.contact 里填的。
                这样设计是因为有些人希望"这条帖子留宿舍电话，其他帖子留微信"。
    cover_image 封面图地址，列表页展示用，避免列表页加载所有大图。
    view_count  浏览量。阶段二实现详情接口时自增。
    created_at  发布时间（UTC）
    updated_at  最后修改时间（UTC）

    索引设计
    --------
    idx_items_type_status   ON (type, status)
        服务于最高频的查询："查所有寻找中的失物"。
        这两个字段组合起来区分度好，且正好匹配 `WHERE type=? AND status=?`。
    idx_items_created_at    ON (created_at DESC)
        服务于列表页默认按发布时间倒序。
    idx_items_owner         ON (owner_id)
        服务于"我发布的信息"页面。
    """

    TABLE: Final = "items"

    TYPE_LOST: Final = "lost"
    TYPE_FOUND: Final = "found"
    TYPES: Final = (TYPE_LOST, TYPE_FOUND)

    STATUS_SEARCHING: Final = "searching"
    STATUS_FOUND: Final = "found"
    STATUS_CLOSED: Final = "closed"
    STATUSES: Final = (STATUS_SEARCHING, STATUS_FOUND, STATUS_CLOSED)


# 状态流转规则：key 是当前状态，value 是允许切换到的状态集合。
#
# 【设计意图】加这一层校验，体现的是"我在管理业务规则"，
# 而不只是"我在存数据"。非法流转会被接口拒绝并返回 400。
#
# 为什么不禁止 closed 回到 searching？
#   考虑到有人误点"已结束"，应该允许他改回来。所以设计成"单向宽松"：
#   正向流程推荐 寻找中 → 已找到 → 已结束，
#   但允许从终态回退（因为这是纠错），只是不允许无理跳跃。
ALLOWED_STATUS_TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    ItemsTable.STATUS_SEARCHING: (
        ItemsTable.STATUS_FOUND,
        ItemsTable.STATUS_CLOSED,
    ),
    ItemsTable.STATUS_FOUND: (
        ItemsTable.STATUS_SEARCHING,  # 纠正误操作：其实还没找到
        ItemsTable.STATUS_CLOSED,
    ),
    ItemsTable.STATUS_CLOSED: (
        ItemsTable.STATUS_SEARCHING,  # 纠正误操作：完结得太早了
        ItemsTable.STATUS_FOUND,
    ),
}

# 状态对应的中文名，前端展示和文档都用这一份，避免各处硬编码不一致
STATUS_LABELS: Final[dict[str, str]] = {
    ItemsTable.STATUS_SEARCHING: "寻找中",
    ItemsTable.STATUS_FOUND: "已找到",
    ItemsTable.STATUS_CLOSED: "已结束",
}

TYPE_LABELS: Final[dict[str, str]] = {
    ItemsTable.TYPE_LOST: "寻物启事",
    ItemsTable.TYPE_FOUND: "招领启事",
}


# ==================================================================
# item_images —— 信息附带的图片
# ==================================================================


class ItemImagesTable:
    """一条信息可以附带多张图片（最多 9 张，与微信朋友圈习惯一致）。

    为什么单独建表而不是在 items 里放一个逗号分隔的字符串？
    --------------------------------------------------------
    因为那样违反数据库第一范式，会导致：
    · 查"包含某张图的信息"只能全表扫描 + 字符串匹配，无法建索引
    · 删除某一张图需要读出整个字符串再改写，容易出错
    拆成独立的表，每条记录一张图，查询和增删都干净。

    字段说明
    --------
    id         主键
    item_id    外键指向 items.id，信息删除时图片记录级联删除
    url        图片地址
    sort_order 排序序号，保证前端展示顺序与用户上传顺序一致
                （数据库不保证返回顺序，必须显式排序）
    """

    TABLE: Final = "item_images"
    MAX_PER_ITEM: Final = 9


# ==================================================================
# matches —— 智能匹配结果（进阶功能预留）
# ==================================================================


class MatchesTable:
    """失物与招领的智能匹配结果。

    设计思路
    --------
    这是"进阶方向"里的 AI 智能匹配功能。实现方式是**规则打分**，
    不依赖外部大模型 API，因此不花钱、不需要联网、演示时也不会因为网络问题失败。

    打分维度（权重待阶段二实现时敲定）：
      1. 物品名相似度 —— 权重最高。这是最核心的判断依据。
      2. 地点相似度   —— 同在校区/同一栋楼，匹配度更高。
      3. 时间接近度   —— 丢失时间应早于拾取时间，且间隔越短越可能匹配。
      4. 描述关键词重合度

    score  综合得分 0~1，越高越可能是同一样东西
    reason 可读的匹配理由，例如"物品名高度相似；地点都在图书馆"。
           前端可以展示"为什么认为这两条匹配"，比只给一个分数更有说服力。

    UNIQUE(lost_id, found_id) 约束
    ------------------------------
    同一条失物和同一条招领只会产生一条匹配记录，
    这样重算匹配结果时可以用 INSERT OR REPLACE 安全覆盖，不会产生重复。
    """

    TABLE: Final = "matches"
