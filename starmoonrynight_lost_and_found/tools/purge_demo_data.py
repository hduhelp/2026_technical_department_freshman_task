# -*- coding: utf-8 -*-
"""清除演示 / 测试数据，把系统恢复为「干净可上线」状态。

保留：
  · 管理员账号（role = 2，否则无法登录管理后台）
  · 用 --keep 指定的账号
  · 分类 / 地点字典（发布信息的必填项，清掉就没法发布了）
  · 数据库表结构
清除（物理删除，ID 归零）：
  · 全部分信息、图片记录、认领、站内私信、收藏
  · 操作日志、登录日志、登录失败锁定、令牌黑名单、上传登记
  · 除保留账号外的全部用户

用法：
    python tools/purge_demo_data.py --yes                 # 保留管理员
    python tools/purge_demo_data.py --yes --keep zhangsan # 额外保留某账号
    python tools/purge_demo_data.py --dry-run             # 只看会删什么
注意：执行前请先停止服务，并自行备份数据库（或用 --backup 让脚本自动备份）。
"""
import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DB = BASE / "server" / "data" / "lostfound.db"
UPLOAD_ITEM_DIR = BASE / "server" / "data" / "uploads" / "item"

# 需要清空并重置自增序列的业务表
PURGE_TABLES = [
    "item_image", "item_favorite", "claim_message", "item_claim",
    "item_record", "upload_file",
    "sys_operation_log", "sys_login_log", "sys_login_fail", "sys_token_block",
]
# 保留的字典表（不动）
KEEP_TABLES = ["category", "location"]


def count(cur, table: str, where: str = "") -> int:
    return cur.execute(f"SELECT COUNT(*) FROM {table} {where}").fetchone()[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="确认执行（不加则只预览）")
    ap.add_argument("--dry-run", action="store_true", help="只预览，不做任何修改")
    ap.add_argument("--keep", action="append", default=[], help="额外保留的用户名，可重复")
    ap.add_argument("--backup", action="store_true", help="执行前自动备份数据库")
    ap.add_argument("--keep-item-uploads", action="store_true", help="保留已上传的信息图片文件")
    args = ap.parse_args()

    if not DB.exists():
        print(f"[错误] 数据库不存在：{DB}")
        return 1

    con = sqlite3.connect(str(DB), timeout=20)
    cur = con.cursor()

    # 需要保留的用户：全部管理员 + --keep 指定的账号
    keep = {r[0] for r in cur.execute("SELECT username FROM sys_user WHERE role = 2 AND deleted = 0")}
    keep |= set(args.keep)
    print(f"== 保留账号：{', '.join(sorted(keep)) or '（无）'}")
    print(f"== 保留字典：{', '.join(KEEP_TABLES)}")

    doomed = cur.execute(
        "SELECT id, username, nickname, role FROM sys_user WHERE username NOT IN (%s)"
        % ",".join("?" * len(keep)), tuple(keep)
    ).fetchall()

    print("\n== 将要清除 ==")
    for t in PURGE_TABLES:
        print(f"   {t:<20} {count(cur, t):>4} 条")
    print(f"   {'sys_user':<20} {len(doomed):>4} 个账号："
          + ", ".join(f"{u[1]}({u[2]})" for u in doomed))
    item_files = len(list(UPLOAD_ITEM_DIR.rglob("*"))) if UPLOAD_ITEM_DIR.exists() else 0
    if not args.keep_item_uploads:
        print(f"   {'上传的图片文件':<18} {item_files:>4} 个（{UPLOAD_ITEM_DIR}）")

    if args.dry_run or not args.yes:
        print("\n[预览模式] 未做任何修改。确认执行请加 --yes")
        con.close()
        return 0

    # ---------- 备份 ----------
    if args.backup:
        bak_dir = BASE / "server" / "data" / "backup"
        bak_dir.mkdir(parents=True, exist_ok=True)
        bak = bak_dir / f"lostfound_before_purge_{datetime.now():%Y%m%d_%H%M%S}.db"
        con.commit()
        shutil.copy2(DB, bak)
        print(f"\n[备份] {bak.name}  ({bak.stat().st_size / 1024:.1f} KB)")

    # ---------- 清空业务表 ----------
    print("\n== 执行清理 ==")
    for t in PURGE_TABLES:
        n = count(cur, t)
        cur.execute(f"DELETE FROM {t}")
        print(f"   清空 {t:<20} {n} 条")
        # 重置自增序列，让新数据从 1 开始
        cur.execute("DELETE FROM sqlite_sequence WHERE name = ?", (t,))

    # ---------- 清理用户 ----------
    if doomed:
        marks = ",".join("?" * len(doomed))
        cur.execute(f"DELETE FROM sys_user WHERE id IN ({marks})", [d[0] for d in doomed])
        print(f"   删除账号 {len(doomed)} 个")
        cur.execute("DELETE FROM sqlite_sequence WHERE name = 'sys_user'")

    con.commit()

    # ---------- 清理信息图片文件 ----------
    if not args.keep_item_uploads and UPLOAD_ITEM_DIR.exists():
        shutil.rmtree(UPLOAD_ITEM_DIR, ignore_errors=True)
        UPLOAD_ITEM_DIR.mkdir(parents=True, exist_ok=True)
        print(f"   删除信息图片文件 {item_files} 个")

    # ---------- 核对 ----------
    print("\n== 清理后 ==")
    for t in ("sys_user", "item_record", "item_claim", "item_image", "claim_message"):
        print(f"   {t:<20} {count(cur, t)} 条")
    print(f"   保留账号：" + ", ".join(
        f"{r[0]}(role={r[1]})" for r in cur.execute("SELECT username, role FROM sys_user ORDER BY id")))
    for t in KEEP_TABLES:
        print(f"   字典 {t:<14} {count(cur, t, 'WHERE deleted = 0')} 条（保留）")
    con.close()
    print("\n完成。管理员仍可用原密码登录管理后台。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
