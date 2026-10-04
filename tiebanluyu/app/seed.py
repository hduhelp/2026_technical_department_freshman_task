"""
种子数据脚本：一键生成演示数据。

用途
----
面试演示时，如果数据库是空的，视频里就只能看到一片空白。
这个脚本会创建几个示例账号和十几条失物/招领信息，
并且**故意包含几组可以互相匹配的数据**，
这样演示「智能匹配」功能时能立刻看到效果。

运行方式（在 lost-and-found 目录下）
------------------------------------
    # 清空并重建演示数据（推荐，保证每次演示结果一致）
    python -m app.seed

    # 保留已有数据，只往里面追加
    python -m app.seed --keep

演示账号
--------
    用户名: xiaoming    密码: Demo@2026
    用户名: xiaohong    密码: Demo@2026
    用户名: lisi        密码: Demo@2026
    用户名: wangwu      密码: Demo@2026
    用户名: zhaoliu     密码: Demo@2026
"""

from __future__ import annotations

import sys

from . import config, security
from .database import init_db, transaction

# ==================================================================
# 演示账号
# ==================================================================

DEMO_PASSWORD = "Demo@2026"

USERS: list[dict[str, str]] = [
    {"username": "xiaoming", "display_name": "小明", "contact": "微信:xiaoming_hdu"},
    {"username": "xiaohong", "display_name": "小红", "contact": "QQ:100200300"},
    {"username": "lisi", "display_name": "李四", "contact": "手机:13800001111"},
    {"username": "wangwu", "display_name": "王五", "contact": "微信:wangwu_hdu"},
    {"username": "zhaoliu", "display_name": "赵六", "contact": "QQ:998877665"},
]

# ==================================================================
# 演示信息
# ==================================================================
#
# 字段说明：
#   owner       发布者的用户名
#   type        lost=寻物启事 / found=招领启事
#   status      searching / found / closed
#   title       物品名
#   location    地点（特意写成不同粒度，用来展示地点模糊匹配）
#   event_time  丢失或拾取的时间
#   created_at  发布时间（特意设成晚于 event_time，符合真实情况：
#               人往往是丢了东西过一阵子才想起来发帖）
#
# 【演示重点】第 3 条和第 4 条构成一对高匹配度数据，用来演示智能匹配：
#   李四 丢了 iPhone 15 手机壳，在图书馆二楼
#   王五 捡到 iPhone 15 手机壳，在图书馆
#   两者物品名相同、地点相近、时间相差 7.5 小时 → 应该被匹配出来

ITEMS: list[dict[str, str]] = [
    # ---------- 配对组 1：校园卡（高匹配）----------
    {
        "owner": "wangwu",
        "type": "lost",
        "status": "searching",
        "title": "校园卡",
        "location": "下沙校区图书馆",
        "event_time": "2026-09-26T14:30:00",
        "created_at": "2026-09-26T15:10:00",
        "description": "黑色卡套，里面有校园卡，姓名王五。当天下午在图书馆四楼自习区丢的。",
    },
    {
        "owner": "xiaoming",
        "type": "found",
        "status": "searching",
        "title": "校园卡",
        "location": "图书馆二楼",
        "event_time": "2026-09-26T15:00:00",
        "created_at": "2026-09-26T15:20:00",
        "description": "在图书馆二楼靠窗的座位上捡到一张校园卡，带黑色卡套，已交到图书馆前台。",
    },
    # ---------- 配对组 2：iPhone 15 手机壳（高匹配）----------
    {
        "owner": "lisi",
        "type": "lost",
        "status": "searching",
        "title": "iPhone 15 手机壳",
        "location": "图书馆二楼",
        "event_time": "2026-09-27T09:00:00",
        "created_at": "2026-09-27T09:30:00",
        "description": "透明硅胶手机壳，背面贴了一张哆啦A梦的贴纸，在图书馆二楼自习时不见了。",
    },
    {
        "owner": "wangwu",
        "type": "found",
        "status": "searching",
        "title": "iPhone 15 手机壳",
        "location": "图书馆",
        "event_time": "2026-09-27T16:30:00",
        "created_at": "2026-09-27T17:00:00",
        "description": "捡到一个透明手机壳，上面有哆啦A梦贴纸，看起来是 iPhone 15 的，放在图书馆一楼失物架。",
    },
    # ---------- 配对组 3：雨伞（中等匹配）----------
    {
        "owner": "xiaohong",
        "type": "lost",
        "status": "searching",
        "title": "黑色雨伞",
        "location": "第一教学楼",
        "event_time": "2026-09-28T11:40:00",
        "created_at": "2026-09-28T12:30:00",
        "description": "长柄自动伞，伞骨有一根修过，伞柄上缠了一圈红色的胶带。",
    },
    {
        "owner": "zhaoliu",
        "type": "found",
        "status": "searching",
        "title": "雨伞",
        "location": "一教 305 教室",
        "event_time": "2026-09-28T12:00:00",
        "created_at": "2026-09-28T12:40:00",
        "description": "教室里捡到一把黑色长柄伞，伞柄缠着红胶带，已放在教学楼值班室。",
    },
    # ---------- 其余信息：制造数据量和多样性 ----------
    {
        "owner": "xiaoming",
        "type": "lost",
        "status": "searching",
        "title": "AirPods Pro 耳机",
        "location": "体育馆",
        "event_time": "2026-09-25T18:20:00",
        "created_at": "2026-09-25T20:00:00",
        "description": "白色耳机盒，左耳耳机上有一道划痕。打完球发现在更衣室不见了。",
    },
    {
        "owner": "lisi",
        "type": "found",
        "status": "searching",
        "title": "蓝色保温杯",
        "location": "第三餐厅",
        "event_time": "2026-09-27T12:10:00",
        "created_at": "2026-09-27T12:35:00",
        "description": "膳魔师保温杯，蓝色，杯身上贴了张社团的贴纸，放在三餐厅二楼收餐处。",
    },
    {
        "owner": "zhaoliu",
        "type": "lost",
        "status": "found",
        "title": "学生证",
        "location": "下沙校区南门",
        "event_time": "2026-09-24T08:15:00",
        "created_at": "2026-09-24T09:00:00",
        "description": "已经找到了，谢谢大家！在宿舍楼下的快递柜旁边，是被室友帮忙收起来的。",
    },
    {
        "owner": "xiaohong",
        "type": "found",
        "status": "found",
        "title": "有线耳机",
        "location": "图书馆三楼",
        "event_time": "2026-09-23T16:00:00",
        "created_at": "2026-09-23T16:30:00",
        "description": "白色有线耳机，3.5mm 接口。失主已经联系我了，感谢平台！",
    },
    {
        "owner": "wangwu",
        "type": "lost",
        "status": "closed",
        "title": "自行车钥匙",
        "location": "6 号宿舍楼",
        "event_time": "2026-09-20T19:00:00",
        "created_at": "2026-09-20T19:30:00",
        "description": "已经重新配了一把钥匙，这条信息作废，谢谢大家。",
    },
    {
        "owner": "xiaoming",
        "type": "found",
        "status": "searching",
        "title": "黑色钱包",
        "location": "第二教学楼",
        "event_time": "2026-09-29T10:05:00",
        "created_at": "2026-09-29T10:40:00",
        "description": "二教 201 教室的桌肚里发现一个黑色皮夹，里面有若干现金和一张公交卡。已交给教务处。",
    },
    {
        "owner": "lisi",
        "type": "lost",
        "status": "searching",
        "title": "机械键盘",
        "location": "实验室 A301",
        "event_time": "2026-09-29T21:00:00",
        "created_at": "2026-09-29T22:15:00",
        "description": "68 键的小键盘，键帽是白色和灰色拼的，上面有一个替换的空格键帽。做完实验忘记带走了。",
    },
    {
        "owner": "xiaohong",
        "type": "found",
        "status": "searching",
        "title": "眼镜",
        "location": "图书馆四楼",
        "event_time": "2026-09-30T14:00:00",
        "created_at": "2026-09-30T14:25:00",
        "description": "黑框近视眼镜，度数应该不低，装在棕色眼镜盒里。放在图书馆四楼服务台。",
    },
]


# ==================================================================
# 执行
# ==================================================================


def seed(keep_existing: bool = False) -> None:
    """写入演示数据。

    keep_existing=True 时保留已有数据（只追加），
    否则先删除数据库文件重建，保证演示结果每次一致。
    """
    if keep_existing:
        init_db()
        print("已确保表结构存在（保留原有数据）")
    else:
        if config.DB_PATH.exists():
            config.DB_PATH.unlink()
            print(f"已删除旧数据库：{config.DB_PATH.name}")
        init_db()
        print("已重建数据库表结构")

    # 密码哈希比较慢（scrypt 故意设计得慢），所以只算一次，所有演示账号共用
    password_hash = security.hash_password(DEMO_PASSWORD)

    with transaction() as conn:
        # ---------- 插入用户 ----------
        user_ids: dict[str, int] = {}
        for user in USERS:
            existing = conn.execute(
                "SELECT id FROM users WHERE username = ?", (user["username"],)
            ).fetchone()

            if existing is not None:
                user_ids[user["username"]] = existing["id"]
                print(f"  用户已存在，跳过：{user['username']}")
                continue

            cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, contact)
                VALUES (?, ?, ?, ?)
                """,
                (user["username"], password_hash, user["display_name"], user["contact"]),
            )
            user_ids[user["username"]] = int(cursor.lastrowid)

        print(f"已写入 {len(user_ids)} 个演示账号")

        # ---------- 插入信息 ----------
        inserted = 0
        for item in ITEMS:
            owner_id = user_ids.get(item["owner"])
            if owner_id is None:
                print(f"  跳过（找不到发布者 {item['owner']}）：{item['title']}")
                continue

            conn.execute(
                """
                INSERT INTO items
                    (owner_id, type, status, title, description, location, event_time,
                     contact, view_count, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
                """,
                (
                    owner_id,
                    item["type"],
                    item["status"],
                    item["title"],
                    item["description"],
                    item["location"],
                    item["event_time"],
                    # 给一点随机浏览量，让"按热度排序"看起来正常
                    (inserted * 7 + 3) % 40,
                    item["created_at"],
                    item["created_at"],
                ),
            )
            inserted += 1

    print(f"已写入 {inserted} 条演示信息")
    print()
    print("=" * 56)
    print("演示数据准备完成")
    print("=" * 56)
    print(f"  账号数量：{len(USERS)}")
    print(f"  信息数量：{inserted}")
    print(f"  数据库：  {config.DB_PATH}")
    print()
    print("可用于演示的账号（密码都是 " + DEMO_PASSWORD + "）：")
    for user in USERS:
        print(f"  {user['username']:<10} 昵称 {user['display_name']}")
    print()
    print("演示智能匹配的推荐操作：")
    print("  打开「iPhone 15 手机壳」的寻物启事详情页，查看推荐配对")
    print("  （李四丢的 与 王五捡到的 应该被匹配出来）")


def main() -> None:
    keep = "--keep" in sys.argv
    seed(keep_existing=keep)


if __name__ == "__main__":
    main()
