# -*- coding: utf-8 -*-
"""清理自测数据，便于重复执行 server/tests_e2e.py"""
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DB = BASE / "server" / "data" / "lostfound.db"

if not DB.exists():
    print("数据库不存在：", DB)
    sys.exit(1)

conn = sqlite3.connect(str(DB))
cur = conn.cursor()
cur.execute("DELETE FROM item_record WHERE title LIKE '自测-%' OR title LIKE '自测-%'")
items = cur.rowcount
cur.execute("DELETE FROM item_claim WHERE item_id NOT IN (SELECT id FROM item_record)")
claims = cur.rowcount
cur.execute("DELETE FROM claim_message WHERE claim_id NOT IN (SELECT id FROM item_claim)")
msgs = cur.rowcount
cur.execute("DELETE FROM item_image WHERE item_id NOT IN (SELECT id FROM item_record)")
imgs = cur.rowcount
cur.execute("DELETE FROM item_favorite WHERE item_id NOT IN (SELECT id FROM item_record)")
favs = cur.rowcount
cur.execute("DELETE FROM upload_file WHERE used = 0")
uploads = cur.rowcount
cur.execute("UPDATE item_record SET claim_status = 1, claim_count = 2 "
            "WHERE deleted = 0 AND type = 1 AND status = 1 AND title LIKE '%蓝牙耳机%'")
conn.commit()
cur.execute("SELECT COUNT(*) FROM item_record WHERE deleted = 0")
left = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM item_claim WHERE deleted = 0")
left_claims = cur.fetchone()[0]
conn.close()
print(f"已清理：信息 {items} 条 / 认领 {claims} 条 / 私聊 {msgs} 条 / 图片 {imgs} 条 / 收藏 {favs} 条 / 上传登记 {uploads} 条")
print(f"剩余：信息 {left} 条，认领 {left_claims} 条")
