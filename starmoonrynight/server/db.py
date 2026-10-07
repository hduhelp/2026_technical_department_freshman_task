# -*- coding: utf-8 -*-
"""SQLite 数据访问层：连接管理、建表、初始化数据、通用查询辅助"""
import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from .config import settings, ensure_dirs

SCHEMA = """
PRAGMA foreign_keys = ON;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS sys_user (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    nickname        TEXT    NOT NULL,
    phone           TEXT    NOT NULL,
    wechat          TEXT,
    avatar          TEXT,
    role            INTEGER NOT NULL DEFAULT 1,     -- 1 用户 2 管理员
    status          INTEGER NOT NULL DEFAULT 1,     -- 1 正常 0 禁用
    last_login_time TEXT,
    last_login_ip   TEXT,
    deleted         INTEGER NOT NULL DEFAULT 0,
    create_time     TEXT    NOT NULL,
    update_time     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_user_username ON sys_user(username) WHERE deleted = 0;
CREATE UNIQUE INDEX IF NOT EXISTS uk_user_phone    ON sys_user(phone)    WHERE deleted = 0;

-- 2. 分类字典
CREATE TABLE IF NOT EXISTS category (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    icon        TEXT,
    sort        INTEGER NOT NULL DEFAULT 0,
    status      INTEGER NOT NULL DEFAULT 1,
    deleted     INTEGER NOT NULL DEFAULT 0,
    create_time TEXT    NOT NULL,
    update_time TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_category_name ON category(name) WHERE deleted = 0;

-- 3. 地点字典（按区域：1 校内 / 2 校外）
CREATE TABLE IF NOT EXISTS location (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    area_type   INTEGER NOT NULL DEFAULT 1,        -- 1 校内 2 校外
    name        TEXT    NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    status      INTEGER NOT NULL DEFAULT 1,
    deleted     INTEGER NOT NULL DEFAULT 0,
    create_time TEXT    NOT NULL,
    update_time TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_location_area_name ON location(area_type, name) WHERE deleted = 0;

-- 4. 信息记录主表
CREATE TABLE IF NOT EXISTS item_record (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             INTEGER NOT NULL,             -- 1 失物 2 招领
    publisher_id     INTEGER NOT NULL,
    title            TEXT    NOT NULL,
    category_id      INTEGER NOT NULL,
    area_type        INTEGER NOT NULL DEFAULT 1,   -- 1 校内 2 校外
    location_id      INTEGER NOT NULL,
    location_detail  TEXT    NOT NULL,             -- 详细地址（自由填写）
    happen_time      TEXT    NOT NULL,
    description      TEXT    NOT NULL,
    is_anonymous     INTEGER NOT NULL DEFAULT 0,
    handover_address TEXT,                         -- 上交地址（仅招领，选填：拾获人登记物品交到了哪里）
    handover_phone   TEXT,                         -- 上交地址联系电话
    contact_name     TEXT,
    contact_phone    TEXT,
    contact_wechat   TEXT,
    status           INTEGER NOT NULL DEFAULT 1,   -- 1 发布中 2 已结束
    claim_status     INTEGER NOT NULL DEFAULT 0,   -- 0 暂未认领 1 认领中
    claim_count      INTEGER NOT NULL DEFAULT 0,
    view_count       INTEGER NOT NULL DEFAULT 0,
    favorite_count   INTEGER NOT NULL DEFAULT 0,
    finish_time      TEXT,
    expire_time      TEXT,
    deleted          INTEGER NOT NULL DEFAULT 0,
    create_time      TEXT    NOT NULL,
    update_time      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_status_time     ON item_record(status, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_item_type_status     ON item_record(type, status, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_item_category        ON item_record(category_id, status, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_item_area_location   ON item_record(area_type, location_id, status);
CREATE INDEX IF NOT EXISTS idx_item_claim           ON item_record(claim_status, status, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_item_publisher       ON item_record(publisher_id, status, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_item_expire          ON item_record(status, expire_time);

-- 5. 图片表
CREATE TABLE IF NOT EXISTS item_image (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL,
    url         TEXT    NOT NULL,
    thumb_url   TEXT    NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    file_size   INTEGER,
    width       INTEGER,
    height      INTEGER,
    deleted     INTEGER NOT NULL DEFAULT 0,
    create_time TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_image_item ON item_image(item_id, sort);

-- 6. 收藏表
CREATE TABLE IF NOT EXISTS item_favorite (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    item_id     INTEGER NOT NULL,
    create_time TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_favorite ON item_favorite(user_id, item_id);

-- 7. 认领申请表
CREATE TABLE IF NOT EXISTS item_claim (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL,
    claimant_id    INTEGER NOT NULL,
    publisher_id   INTEGER NOT NULL,
    claim_note     TEXT    NOT NULL,
    status         INTEGER NOT NULL DEFAULT 1,     -- 1 认领中 2 已完成 3 超时断开 4 已取消
    start_time     TEXT    NOT NULL,
    expire_time    TEXT    NOT NULL,
    last_chat_time TEXT,
    finish_time    TEXT,
    finish_reason  TEXT,
    deleted        INTEGER NOT NULL DEFAULT 0,
    create_time    TEXT    NOT NULL,
    update_time    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_claim_item_user ON item_claim(item_id, claimant_id) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_claim_item_status ON item_claim(item_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_claimant    ON item_claim(claimant_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_claim_expire      ON item_claim(status, expire_time);

-- 8. 认领沟通消息表（站内私聊）
CREATE TABLE IF NOT EXISTS claim_message (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id    INTEGER NOT NULL,
    sender_id   INTEGER,                           -- NULL 表示系统消息
    receiver_id INTEGER,
    content     TEXT    NOT NULL,
    is_system   INTEGER NOT NULL DEFAULT 0,
    read_flag   INTEGER NOT NULL DEFAULT 0,
    create_time TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_claim   ON claim_message(claim_id, create_time);
CREATE INDEX IF NOT EXISTS idx_msg_receiver ON claim_message(receiver_id, read_flag);

-- 9. 操作日志
CREATE TABLE IF NOT EXISTS sys_operation_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id   INTEGER,
    operator_name TEXT,
    module        TEXT    NOT NULL,
    action        TEXT    NOT NULL,
    target_id     INTEGER,
    detail        TEXT,
    ip            TEXT,
    create_time   TEXT    NOT NULL
);

-- 10. 登录日志
CREATE TABLE IF NOT EXISTS sys_login_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    account     TEXT    NOT NULL,
    result      INTEGER NOT NULL,
    fail_reason TEXT,
    ip          TEXT,
    user_agent  TEXT,
    create_time TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_account ON sys_login_log(account, create_time DESC);

-- 11. 令牌黑名单（登出/改密后立即失效）
CREATE TABLE IF NOT EXISTS sys_token_block (
    jti         TEXT PRIMARY KEY,
    expire_at   TEXT NOT NULL,
    create_time TEXT NOT NULL
);

-- 12. 上传文件登记（校验图片归属、清理无主文件）
CREATE TABLE IF NOT EXISTS upload_file (
    url         TEXT PRIMARY KEY,
    uploader_id INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    create_time TEXT NOT NULL
);

-- 12. 登录失败计数（风控）
CREATE TABLE IF NOT EXISTS sys_login_fail (
    account       TEXT PRIMARY KEY,
    fail_count    INTEGER NOT NULL DEFAULT 0,
    first_fail_at TEXT NOT NULL,
    lock_until    TEXT
);
"""


# ----------------------------------------------------------------------
# 时间辅助
# ----------------------------------------------------------------------
FMT = "%Y-%m-%d %H:%M:%S"


def now_str() -> str:
    return datetime.now().strftime(FMT)


def str_to_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    for f in (FMT, "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, f)
        except ValueError:
            continue
    return None


def dt_to_str(d: datetime) -> str:
    return d.strftime(FMT)


# ----------------------------------------------------------------------
# 密码哈希（PBKDF2-HMAC-SHA256，标准库实现，无第三方依赖）
# ----------------------------------------------------------------------
PBKDF2_ROUNDS = 200_000


def hash_password(raw: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${dk.hex()}"


def verify_password(raw: str, stored: str) -> bool:
    try:
        algo, rounds, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), int(rounds))
        return hmac.compare_digest(dk.hex(), digest)
    except Exception:                                   # noqa: BLE001
        return False


# ----------------------------------------------------------------------
# 连接管理
# ----------------------------------------------------------------------
def connect() -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(str(settings.db_path), timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")            # 并发读写更稳
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    return conn


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def tx():
    """事务：进入即 BEGIN IMMEDIATE，异常回滚"""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


# ----------------------------------------------------------------------
# 查询辅助
# ----------------------------------------------------------------------
def query_all(sql: str, args: Iterable[Any] = ()) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(sql, tuple(args)).fetchall()
        return [dict(r) for r in rows]


def query_one(sql: str, args: Iterable[Any] = ()) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(sql, tuple(args)).fetchone()
        return dict(row) if row else None


def execute(sql: str, args: Iterable[Any] = ()) -> int:
    with tx() as conn:
        cur = conn.execute(sql, tuple(args))
        return cur.lastrowid if cur.lastrowid else cur.rowcount


def scalar(sql: str, args: Iterable[Any] = (), default: Any = 0) -> Any:
    with get_conn() as conn:
        row = conn.execute(sql, tuple(args)).fetchone()
        if row is None or row[0] is None:
            return default
        return row[0]


def insert(table: str, data: dict) -> int:
    cols = ", ".join(f'"{k}"' for k in data)
    marks = ", ".join("?" for _ in data)
    sql = f'INSERT INTO "{table}" ({cols}) VALUES ({marks})'
    return execute(sql, list(data.values()))


def update(table: str, data: dict, where: str, args: Iterable[Any] = ()) -> int:
    sets = ", ".join(f'"{k}" = ?' for k in data)
    sql = f'UPDATE "{table}" SET {sets} WHERE {where}'
    with tx() as conn:
        cur = conn.execute(sql, list(data.values()) + list(args))
        return cur.rowcount


# ----------------------------------------------------------------------
# 初始化
# ----------------------------------------------------------------------
CATEGORIES = [
    ("证件卡类", "card", 1), ("电子产品", "phone", 2), ("书籍资料", "notebook", 3),
    ("衣物鞋帽", "clothes", 4), ("钥匙", "key", 5), ("饰品手表", "watch", 6),
    ("运动器材", "ball", 7), ("雨具", "umbrella", 8), ("钱包财物", "wallet", 9),
    ("其他", "more", 99),
]

LOCATIONS = {
    1: ["教学楼 A 座", "教学楼 B 座", "图书馆", "一食堂", "二食堂", "宿舍 1 号楼", "宿舍 3 号楼",
        "体育馆", "操场", "行政楼", "实验楼", "校医院", "校门口"],
    2: ["校门口公交站", "地铁 2 号线站台", "周边超市 / 便利店", "周边餐饮店", "共享单车上", "其他校外地点"],
}


def init_db(seed: bool = True) -> None:
    """建表 + 首次运行时写入基础数据（管理员、分类、地点、示例信息）"""
    ensure_dirs()
    with get_conn() as conn:
        conn.executescript(SCHEMA)

    # 分类字典
    if scalar("SELECT COUNT(*) FROM category WHERE deleted = 0") == 0:
        now = now_str()
        for name, icon, sort in CATEGORIES:
            insert("category", dict(name=name, icon=icon, sort=sort, status=1, deleted=0,
                                    create_time=now, update_time=now))
    # 地点字典
    if scalar("SELECT COUNT(*) FROM location WHERE deleted = 0") == 0:
        now = now_str()
        for area, names in LOCATIONS.items():
            for i, name in enumerate(names, start=1):
                insert("location", dict(area_type=area, name=name, sort=i, status=1, deleted=0,
                                        create_time=now, update_time=now))

    # 管理员
    if scalar("SELECT COUNT(*) FROM sys_user") == 0:
        now = now_str()
        admin_id = insert("sys_user", dict(
            username="admin", password_hash=hash_password("Admin@123456"), nickname="系统管理员",
            phone="13800000000", wechat=None, avatar=None, role=2, status=1,
            last_login_time=None, last_login_ip=None, deleted=0, create_time=now, update_time=now))
        users = [
            ("zhangsan", "张三", "13800001111", "zs_2025"),
            ("lisi", "李四", "13900002222", None),
            ("wangwu", "王五", "13700003333", "wx_li"),
            ("zhaoliu", "赵六", "13600004444", None),
        ]
        user_ids = []
        for uname, nick, phone, wechat in users:
            uid = insert("sys_user", dict(
                username=uname, password_hash=hash_password("User@123456"), nickname=nick,
                phone=phone, wechat=wechat, avatar=None, role=1, status=1,
                last_login_time=None, last_login_ip=None, deleted=0, create_time=now, update_time=now))
            user_ids.append(uid)

        if seed:
            _seed_items(admin_id, user_ids)


def _seed_items(admin_id: int, user_ids: list[int]) -> None:
    """写入 8 条示例信息，其中 1 条带认领与私聊，便于直接体验"""
    now = datetime.now()
    cat = {r["name"]: r["id"] for r in query_all("SELECT id, name FROM category")}
    loc = {(r["area_type"], r["name"]): r["id"] for r in query_all("SELECT id, area_type, name FROM location")}

    def loc_id(area: int, name: str) -> int:
        return loc.get((area, name)) or list(loc.values())[0]

    uid = user_ids
    rows = [
        # type, publisher, title, category, area, location, detail, hours_ago, desc, anon, handover, handover_phone, contact_phone, wechat, status, images
        (2, uid[0], "在图书馆一楼大厅捡到一张校园卡", "证件卡类", 1, "图书馆", "图书馆一楼大厅（靠近自助借还机）", 3,
         "卡面姓名模糊，尾部编号 0482，已交至图书馆一楼服务台代管，请失主携带学生证认领。", 0,
         "图书馆一楼服务台", "13866668888", "13800001111", "zs_2025", 1, 3),
        (1, uid[1], "黑色蓝牙耳机丢失，带蓝色保护壳", "电子产品", 1, "体育馆", "体育馆东侧看台", 26,
         "品牌为漫步者，右耳耳机壳有轻微划痕，装在蓝色硅胶保护壳内。打球时可能掉在体育馆东侧看台。", 0,
         None, None, "13900002222", None, 1, 1),
        (1, uid[2], "蓝色折叠雨伞丢失（伞柄有挂绳）", "雨具", 2, "校门口公交站", "校门口公交站 302 路站牌旁", 50,
         "深蓝色八骨折叠伞，伞柄上系着一根灰色挂绳，可能落在校门口公交站附近。", 0, None, None, "13700003333", "wx_li", 1, 0),
        (2, uid[3], "捡到一串钥匙（含宿舍门禁卡）", "钥匙", 1, "宿舍 3 号楼", "宿舍 3 号楼一楼门厅", 8,
         "共 3 把钥匙 + 1 张门禁卡，挂在一个小黄鸭挂件上，已放在 3 号楼一楼宿管处。", 1,
         "宿舍 3 号楼一楼宿管处", "13877779999", None, "kind_2025", 1, 1),
        (1, uid[0], "《数据结构与算法分析》教材丢失", "书籍资料", 1, "教学楼 A 座", "教学楼 A 座 305 教室", 74,
         "书内有较多笔记，扉页写着姓名首字母 L.M.，可能遗留在 A 座 305 教室。", 0, None, None, "13800001111", "zs_2025", 1, 0),
        (2, uid[1], "在一食堂捡到一个保温杯（银色）", "其他", 1, "一食堂", "一食堂二楼餐盘回收处", 98,
         "500ml 银色不锈钢保温杯，杯身贴有一张卡通贴纸，已放至一食堂失物暂存柜。", 0,
         "一食堂二楼失物暂存柜", None, "13900002222", None, 1, 2),
        (2, uid[2], "操场看台捡到一副黑框眼镜", "饰品手表", 1, "操场", "操场西侧看台第三排", 140,
         "黑色细框近视眼镜，镜腿内侧有度数标记，装在透明眼镜盒里。", 0, None, None, "13700003333", "wx_li", 2, 1),
        (1, uid[3], "丢失一个粉色保温饭盒（含餐具）", "其他", 2, "地铁 2 号线站台", "地铁 2 号线站台（返校途中）", 170,
         "粉色双层保温饭盒，内附不锈钢勺筷，饭盒盖上有小熊图案。", 0, None, None, "13600004444", None, 2, 0),
    ]

    for (typ, pub, title, cname, area, lname, detail, hours_ago, desc, anon,
         handover, hphone, phone, wechat, status, imgs) in rows:
        created = now - timedelta(hours=hours_ago)
        happen = created - timedelta(hours=2)
        expire = dt_to_str(created + timedelta(days=settings.item_expire_days)) if typ == 1 else None
        item_id = insert("item_record", dict(
            type=typ, publisher_id=pub, title=title, category_id=cat[cname], area_type=area,
            location_id=loc_id(area, lname), location_detail=detail,
            happen_time=dt_to_str(happen), description=desc, is_anonymous=anon,
            handover_address=handover, handover_phone=hphone,
            contact_name=(query_one("SELECT nickname FROM sys_user WHERE id=?", (pub,)) or {}).get("nickname"),
            contact_phone=phone, contact_wechat=wechat, status=status,
            claim_status=0, claim_count=0,
            view_count=20 + item_id_seed_offset(title), favorite_count=0,
            finish_time=dt_to_str(created + timedelta(hours=6)) if status == 2 else None,
            expire_time=expire, deleted=0,
            create_time=dt_to_str(created), update_time=dt_to_str(created)))

        for i in range(imgs):
            insert("item_image", dict(item_id=item_id, url=f"/uploads/seed/{item_id}_{i}.jpg",
                                      thumb_url=f"/uploads/seed/{item_id}_{i}_thumb.jpg", sort=i,
                                      file_size=None, width=None, height=None, deleted=0,
                                      create_time=dt_to_str(created)))

    # 给「黑色蓝牙耳机」造 2 条认领中的申请 + 私聊记录
    target = query_one("SELECT id, publisher_id FROM item_record WHERE title LIKE '%蓝牙耳机%' LIMIT 1")
    if target:
        for idx, (claimant, note, hours) in enumerate([
            (uid[2], "这副耳机应该是我的：右耳壳有划痕，蓝色硅胶保护壳，6 月 10 日 18:00 左右在体育馆打球时丢失。", 6),
            (uid[3], "我也丢了一副漫步者耳机，黑色带蓝色保护壳，可能是我的，想先确认一下。", 4),
        ]):
            start = now - timedelta(hours=hours)
            cid = insert("item_claim", dict(
                item_id=target["id"], claimant_id=claimant, publisher_id=target["publisher_id"],
                claim_note=note, status=1, start_time=dt_to_str(start),
                expire_time=dt_to_str(start + timedelta(hours=settings.claim_timeout_hours)),
                last_chat_time=dt_to_str(start + timedelta(hours=1)), finish_time=None, finish_reason=None,
                deleted=0, create_time=dt_to_str(start), update_time=dt_to_str(start)))
            msgs = [
                (None, None, f"认领申请已提交，请在 {settings.claim_timeout_hours} 小时内沟通完成认领。", 1),
                (claimant, target["publisher_id"], "你好，这副耳机应该是我的，右耳壳有划痕，蓝色保护壳。", 0),
                (target["publisher_id"], claimant, "收到，请再说一下你丢的时间？", 0),
                (claimant, target["publisher_id"], "6 月 10 日晚上打球的时候，大概 18:00 左右。", 0),
            ]
            for i, (snd, rcv, content, sysmsg) in enumerate(msgs):
                insert("claim_message", dict(
                    claim_id=cid, sender_id=snd, receiver_id=rcv, content=content, is_system=sysmsg,
                    read_flag=0 if i >= 2 else 1, create_time=dt_to_str(start + timedelta(minutes=10 * i))))
        update("item_record", dict(claim_status=1, claim_count=2), "id = ?", (target["id"],))


def item_id_seed_offset(title: str) -> int:
    return abs(hash(title)) % 180


def log_operation(conn, operator_id, operator_name, module, action, target_id=None, detail=None, ip=None):
    conn.execute(
        'INSERT INTO sys_operation_log (operator_id, operator_name, module, action, target_id, detail, ip, create_time)'
        ' VALUES (?,?,?,?,?,?,?,?)',
        (operator_id, operator_name, module, action, target_id, detail, ip, now_str()))


def log_login(conn, user_id, account, result, fail_reason, ip, ua):
    conn.execute(
        'INSERT INTO sys_login_log (user_id, account, result, fail_reason, ip, user_agent, create_time)'
        ' VALUES (?,?,?,?,?,?,?)',
        (user_id, account, result, fail_reason, ip, (ua or "")[:200], now_str()))
