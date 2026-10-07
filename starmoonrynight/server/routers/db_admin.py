# -*- coding: utf-8 -*-
"""数据库管理台：Web 版数据浏览 / 编辑 / SQL 控制台 / 备份（仅管理员）"""
import csv
import io
import re
import sqlite3
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, Response

from ..config import settings
from ..db import connect, get_conn, log_operation, now_str, query_all, scalar, tx
from ..utils.common import BizError, clamp, ok
from ..utils.deps import client_ip, require_admin

router = APIRouter(prefix="/admin/db", tags=["数据库管理"])

# 允许在管理台直接编辑的表（白名单，避免误改系统内部表）
EDITABLE_TABLES = [
    "sys_user", "category", "location", "item_record", "item_image", "item_favorite",
    "item_claim", "claim_message", "sys_operation_log", "sys_login_log", "sys_token_block",
    "upload_file", "sys_login_fail",
]
# 只读表（可查看、不可编辑）
READONLY_TABLES = {"sys_token_block"}
# 敏感的列（列表中脱敏显示，仍可编辑）
SENSITIVE_COLUMNS = {"password_hash"}

TABLE_LABELS = {
    "sys_user": "用户表", "category": "分类字典", "location": "地点字典",
    "item_record": "信息记录主表", "item_image": "信息图片", "item_favorite": "收藏",
    "item_claim": "失物认领申请", "claim_message": "认领站内私聊", "sys_operation_log": "操作日志",
    "sys_login_log": "登录日志", "sys_token_block": "令牌黑名单", "upload_file": "上传文件登记",
    "sys_login_fail": "登录失败计数",
}

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _check_table(table: str) -> str:
    if table not in EDITABLE_TABLES:
        raise BizError(2001, f"不允许访问的表：{table}")
    return table


def _check_ident(name: str) -> str:
    if not _IDENT.match(name or ""):
        raise BizError(2001, f"非法字段名：{name}")
    return name


@router.get("/tables")
def tables(request: Request, admin: dict = Depends(require_admin)):
    result = []
    for t in EDITABLE_TABLES:
        result.append({
            "name": t,
            "label": TABLE_LABELS.get(t, t),
            "rows": scalar(f'SELECT COUNT(*) FROM "{t}"'),
            "columns": len(query_all(f'PRAGMA table_info("{t}")')),
            "readonly": t in READONLY_TABLES,
        })
    info = {
        "dbFile": str(settings.db_path),
        "dbSizeKb": round(settings.db_path.stat().st_size / 1024, 1) if settings.db_path.exists() else 0,
        "sqliteVersion": sqlite3.sqlite_version,
        "journalMode": query_all("PRAGMA journal_mode")[0]["journal_mode"],
    }
    return ok({"tables": result, "info": info}, request)


@router.get("/tables/{table}")
def table_rows(request: Request, table: str, page: int = 1, size: int = 50,
               keyword: str = "", orderBy: str = "", orderDir: str = "desc",
               admin: dict = Depends(require_admin)):
    t = _check_table(table)
    page, size = max(1, page), clamp(size, 1, 200)
    cols = query_all(f'PRAGMA table_info("{t}")')
    col_names = [c["name"] for c in cols]
    pk = next((c["name"] for c in cols if c["pk"]), col_names[0])

    where, args = "", []
    kw = (keyword or "").strip()
    if kw:
        text_cols = [c["name"] for c in cols if (c["type"] or "").upper().startswith(("TEXT", "VARCHAR", "CHAR"))]
        if text_cols:
            where = " WHERE " + " OR ".join(f'"{c}" LIKE ?' for c in text_cols)
            args = [f"%{kw}%"] * len(text_cols)

    ob = _check_ident(orderBy) if orderBy else pk
    if ob not in col_names:
        ob = pk
    direction = "DESC" if str(orderDir).lower() == "desc" else "ASC"

    total = scalar(f'SELECT COUNT(*) FROM "{t}"{where}', args)
    rows = query_all(f'SELECT * FROM "{t}"{where} ORDER BY "{ob}" {direction} LIMIT ? OFFSET ?',
                     args + [size, (page - 1) * size])
    for r in rows:
        for k in list(r.keys()):
            if k in SENSITIVE_COLUMNS and r[k]:
                r[k] = str(r[k])[:14] + "…（已脱敏）"
    return ok({
        "table": t, "label": TABLE_LABELS.get(t, t), "pk": pk,
        "columns": [{"name": c["name"], "type": c["type"], "notnull": c["notnull"],
                     "pk": bool(c["pk"])} for c in cols],
        "list": rows, "total": total, "page": page, "size": size,
        "pages": (total + size - 1) // size,
        "readonly": t in READONLY_TABLES,
    }, request)


@router.put("/tables/{table}/{row_id}")
def update_row(request: Request, table: str, row_id: str, body: dict,
               admin: dict = Depends(require_admin)):
    t = _check_table(table)
    if t in READONLY_TABLES:
        raise BizError(2001, "该表为只读表")
    cols = [c["name"] for c in query_all(f'PRAGMA table_info("{t}")')]
    pk = next((c["name"] for c in query_all(f'PRAGMA table_info("{t}")') if c["pk"]), cols[0])
    data = {k: v for k, v in (body.get("values") or {}).items() if k in cols and k != pk}
    if not data:
        raise BizError(2001, "没有需要更新的字段")
    sets = ", ".join(f'"{_check_ident(k)}" = ?' for k in data)
    before = query_all(f'SELECT * FROM "{t}" WHERE "{pk}" = ?', (row_id,))
    if not before:
        raise BizError(2005, "记录不存在")
    with tx() as conn:
        conn.execute(f'UPDATE "{t}" SET {sets} WHERE "{pk}" = ?', list(data.values()) + [row_id])
        log_operation(conn, admin["id"], admin["nickname"], "db", "UPDATE_ROW", None,
                      f"{t}#{row_id} 修改字段 {list(data.keys())}", client_ip(request))
    return ok(None, request)


@router.post("/tables/{table}")
def insert_row(request: Request, table: str, body: dict, admin: dict = Depends(require_admin)):
    t = _check_table(table)
    if t in READONLY_TABLES:
        raise BizError(2001, "该表为只读表")
    cols = [c["name"] for c in query_all(f'PRAGMA table_info("{t}")')]
    data = {k: v for k, v in (body.get("values") or {}).items() if k in cols and v not in ("", None)}
    if not data:
        raise BizError(2001, "请至少填写一个字段")
    col_sql = ", ".join(f'"{_check_ident(k)}"' for k in data)
    mark_sql = ", ".join("?" for _ in data)
    with tx() as conn:
        cur = conn.execute(f'INSERT INTO "{t}" ({col_sql}) VALUES ({mark_sql})', list(data.values()))
        new_id = cur.lastrowid
        log_operation(conn, admin["id"], admin["nickname"], "db", "INSERT_ROW", new_id,
                      f"{t} 新增记录", client_ip(request))
    return ok({"id": new_id}, request)


@router.delete("/tables/{table}/{row_id}")
def delete_row(request: Request, table: str, row_id: str, admin: dict = Depends(require_admin)):
    t = _check_table(table)
    if t in READONLY_TABLES:
        raise BizError(2001, "该表为只读表")
    pk = next((c["name"] for c in query_all(f'PRAGMA table_info("{t}")') if c["pk"]), "id")
    with tx() as conn:
        cur = conn.execute(f'DELETE FROM "{t}" WHERE "{pk}" = ?', (row_id,))
        if cur.rowcount == 0:
            raise BizError(2005, "记录不存在")
        log_operation(conn, admin["id"], admin["nickname"], "db", "DELETE_ROW", None,
                      f"{t}#{row_id} 删除记录", client_ip(request))
    return ok(None, request)


@router.post("/query")
def run_sql(request: Request, body: dict, admin: dict = Depends(require_admin)):
    """SQL 控制台：默认只读；写入语句需显式勾选 allowWrite"""
    sql = (body.get("sql") or "").strip().rstrip(";")
    if not sql:
        raise BizError(2001, "请输入 SQL")
    if ";" in sql:
        raise BizError(2001, "一次仅允许执行一条语句")
    allow_write = bool(body.get("allowWrite"))
    head = sql.split(None, 1)[0].upper()
    is_write = head in ("INSERT", "UPDATE", "DELETE", "REPLACE", "ALTER", "DROP", "CREATE", "TRUNCATE", "VACUUM")
    if head in ("ATTACH", "DETACH", "PRAGMA") and not allow_write:
        raise BizError(2001, "该语句需要在「允许写入」模式下执行")
    if is_write and not allow_write:
        raise BizError(2001, "写操作需要勾选「允许写入」后执行")
    if head == "DROP" and not body.get("confirmDrop"):
        raise BizError(2001, "DROP 语句需要二次确认")

    started = datetime.now()
    with get_conn() as conn:
        try:
            cur = conn.execute(sql)
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
            columns = [d[0] for d in cur.description] if cur.description else []
            affected = cur.rowcount
        except sqlite3.Error as exc:
            raise BizError(2001, f"SQL 执行失败：{exc}") from exc
    cost_ms = int((datetime.now() - started).total_seconds() * 1000)
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "db",
                      "SQL" if not is_write else "SQL_WRITE", None, sql[:200], client_ip(request))
    return ok({"columns": columns, "rows": rows[:200], "rowCount": len(rows),
               "affected": affected, "costMs": cost_ms, "write": is_write}, request)


@router.get("/export/{table}")
def export_table(request: Request, table: str, admin: dict = Depends(require_admin)):
    t = _check_table(table)
    rows = query_all(f'SELECT * FROM "{t}"')
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    data = "\ufeff" + buf.getvalue()          # 带 BOM，Excel 直接打开不乱码
    return Response(content=data.encode("utf-8"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{t}.csv"'})


@router.post("/backup")
def backup(request: Request, admin: dict = Depends(require_admin)):
    """使用 SQLite 在线备份 API 生成一致性快照"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = settings.backup_dir / f"lostfound_{stamp}.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    src = connect()
    try:
        dst = sqlite3.connect(str(target))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "db", "BACKUP", None,
                      str(target.name), client_ip(request))
    return ok({"file": target.name, "path": str(target),
               "sizeKb": round(target.stat().st_size / 1024, 1)}, request)


@router.get("/backups")
def list_backups(request: Request, admin: dict = Depends(require_admin)):
    files = sorted(settings.backup_dir.glob("lostfound_*.db"), reverse=True)
    return ok({"list": [{"file": f.name, "sizeKb": round(f.stat().st_size / 1024, 1),
                         "time": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")}
                        for f in files[:30]]}, request)


@router.get("/schema")
def schema(request: Request, admin: dict = Depends(require_admin)):
    rows = query_all("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    return ok({"list": rows}, request)


@router.get("/health")
def db_health(request: Request, admin: dict = Depends(require_admin)):
    checks = {
        "integrity": query_all("PRAGMA integrity_check")[0]["integrity_check"],
        "walSize": None,
        "tableCount": scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"),
    }
    wal = settings.db_path.with_suffix(".db-wal")
    if wal.exists():
        checks["walSize"] = round(wal.stat().st_size / 1024, 1)
    return ok(checks, request)
