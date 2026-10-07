"""
数据库层：SQLite 连接管理 + 表结构定义。

为什么不用 SQLAlchemy（ORM）？
------------------------------
1. 本环境无法联网安装新包，标准库 sqlite3 是唯一稳妥选择；
2. 更重要的是：本次任务明确要求学习 SQL 的
   WHERE / LIKE / ORDER BY / LIMIT / OFFSET。
   手写 SQL 能让每一句查询都看得见，比 ORM 藏起来更贴合学习目标。

表结构总览
----------
users           用户账号
user_sessions   已退出的 token 记录（让"退出登录"真正生效）
items           失物 / 招领信息（核心表）
item_images     信息附带的图片
matches         AI 智能匹配结果（进阶功能预留）
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from . import config

# ------------------------------------------------------------------ 建表语句

SCHEMA_SQL = """
-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,          -- 登录名，统一转小写存储，保证 Tom/tom 不重复
    password_hash TEXT    NOT NULL,                 -- 密码哈希，绝不存明文
    display_name  TEXT    NOT NULL DEFAULT '',      -- 昵称
    contact       TEXT    NOT NULL DEFAULT '',      -- 联系方式（手机 / QQ / 微信）
    avatar        TEXT    NOT NULL DEFAULT '',      -- 头像地址
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 已失效的 token 记录表
-- 作用：JWT 是无状态的，服务器本来无法"主动注销"一个 token。
-- 这里记下退出登录时用过的 token 编号（jti），鉴权时查一下就知道它已作废。
CREATE TABLE IF NOT EXISTS user_sessions (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,                    -- Unix 时间戳，用于定期清理
    revoked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 失物 / 招领信息表（核心）
-- 设计要点 1：失物和招领字段完全一致，只用 type 区分，
--            合成一张表后将来做"失物 vs 招领"智能匹配会容易得多。
-- 设计要点 2：区分「拾取者」和「保管者」。
--            很多人捡到东西后会交给老师、管理员、保卫处代为保管；
--            未成年人（比如初中生捡到一大包现金）根本不敢自己拿着，会第一时间上报。
--            所以：发布人不一定是拾取者，拾取者也不一定是保管者。
--            失主真正要去的地方是「保管者」那里，因此这两者必须分开存。
CREATE TABLE IF NOT EXISTS items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT    NOT NULL CHECK (type IN ('lost', 'found')),        -- lost=寻物启事 / found=招领启事
    status         TEXT    NOT NULL DEFAULT 'searching'
                           CHECK (status IN ('searching', 'found', 'closed')), -- 寻找中 / 已找到 / 已结束
    title          TEXT    NOT NULL,                 -- 物品名称
    description    TEXT    NOT NULL DEFAULT '',      -- 详细描述
    location       TEXT    NOT NULL DEFAULT '',      -- 丢失/拾取地点
    event_time     TEXT,                             -- 丢失/拾取时间，ISO 8601 字符串
    contact        TEXT    NOT NULL DEFAULT '',      -- 本条信息单独填的联系方式
    cover_image    TEXT    NOT NULL DEFAULT '',      -- 封面图（列表页展示用）
    view_count     INTEGER NOT NULL DEFAULT 0,       -- 浏览量

    -- ---------- 拾取者（谁捡到的）----------
    -- 允许留空或用称呼代替（如"一位同学"）。
    -- 单独存的原因是："谁捡到的"和"东西现在在哪"是两件事，
    -- 而且很多场景下拾取者不需要、也不应该被公开联系（例如小孩子）。
    finder_name    TEXT    NOT NULL DEFAULT '',

    -- ---------- 保管者（东西现在在谁手里）----------
    -- holder_user_id 不为空表示保管者也是本平台用户
    -- （例如拾取者自己拿着，或者代为保管的室友也注册了账号）。
    --
    -- 【注意用 ON DELETE SET NULL 而不是 CASCADE】
    -- 如果保管者注销了账号，物品记录不应该跟着消失 —— 东西还在那里，
    -- 只是失去了"对应哪个账号"这层关联，所以置空即可。
    holder_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    holder_name    TEXT    NOT NULL DEFAULT '',      -- 保管者称呼，如"王老师"
    holder_place   TEXT    NOT NULL DEFAULT '',      -- 保管地点，如"图书馆一楼服务台"

    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 信息附带的图片（一条信息可传多张）
CREATE TABLE IF NOT EXISTS item_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- AI 智能匹配结果（进阶功能预留）
-- score 是匹配得分，reason 是可读的匹配理由，方便前端展示"为什么认为这两条匹配"
CREATE TABLE IF NOT EXISTS matches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lost_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    found_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    score       REAL    NOT NULL DEFAULT 0,
    reason      TEXT   NOT NULL DEFAULT '',
    created_at  TEXT   NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lost_id, found_id)
);

-- 索引：为搜索和排序加速。
-- 这些正好对应要学的知识点：WHERE 走索引、ORDER BY created_at 走索引。
CREATE INDEX IF NOT EXISTS idx_items_type_status  ON items(type, status);
CREATE INDEX IF NOT EXISTS idx_items_created_at   ON items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_owner        ON items(owner_id);
CREATE INDEX IF NOT EXISTS idx_item_images_item   ON item_images(item_id);
"""


# ------------------------------------------------------------------ 连接管理


def get_connection() -> sqlite3.Connection:
    """创建一个新的数据库连接。

    每个请求用独立连接，避免多线程共用连接导致的锁问题。
    """
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(
        config.DB_PATH,
        # FastAPI 会在不同线程中执行同步函数，因此关闭"同线程检查"。
        # 安全性由"每请求独立连接"这条规则来保证。
        check_same_thread=False,
        timeout=10.0,  # 遇到写锁时最多等 10 秒，而不是立刻报 database is locked
    )
    # 让查询结果可以像字典一样用列名访问：row["username"]
    conn.row_factory = sqlite3.Row
    # 打开外键约束（SQLite 默认是关的，必须显式打开）
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """只读用法的连接上下文：自动关闭连接。"""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """写操作用法的连接上下文：自动提交，出错自动回滚。

    用法：
        with transaction() as conn:
            conn.execute("INSERT INTO users ...", (...))
        # 离开 with 块时自动 commit
    """
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ------------------------------------------------------------------ 时间处理

def utc_to_iso(value: str | None) -> str | None:
    """把数据库里的 UTC 时间字符串转成带时区标记的 ISO 8601 格式。

    背景（这是个很容易踩的坑）
    --------------------------
    SQLite 的 datetime('now') 返回的是 **UTC 时间**，比北京时间慢 8 小时。
    本机实测：本机 21:19 时，datetime('now') 存进去的是 13:19。

    如果直接把 "2026-09-30 13:19:00" 丢给前端，前端会当成"本地时间"显示，
    结果就是"刚发布的帖子显示成 8 小时前"。

    解决办法：在接口层统一补上 "Z" 后缀，明确告诉前端这是 UTC 时间，
    由前端负责转换成本地时间显示。例如：
        "2026-09-30 13:19:00"  ->  "2026-09-30T13:19:00Z"
    JavaScript 拿到后 new Date("2026-09-30T13:19:00Z") 会自动按本地时区渲染，
    显示正确且逻辑清晰。
    """
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    # 数据库统一存 "YYYY-MM-DD HH:MM:SS"，这里换成 ISO 的 T 分隔
    if "T" not in text:
        text = text.replace(" ", "T")
    # 已经带了时区信息就不再重复添加
    if text.endswith("Z") or "+" in text[10:]:
        return text
    return f"{text}Z"


# ------------------------------------------------------------------ 初始化


def init_db() -> None:
    """创建所有表和索引。可重复执行（都用了 IF NOT EXISTS）。"""
    with transaction() as conn:
        conn.executescript(SCHEMA_SQL)


def reset_db() -> None:
    """【危险】删除数据库文件并重建，仅用于开发调试。

    调用方式：python -m app.database
    """
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
        print(f"已删除数据库文件：{config.DB_PATH}")
    init_db()
    print(f"已重新建表：{config.DB_PATH}")


if __name__ == "__main__":
    # 支持 `python -m app.database` 一键重建数据库
    reset_db()
