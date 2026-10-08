# -*- coding: utf-8 -*-
"""管理端：分类 / 地点 / 用户 / 信息 / 认领 / 统计"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from ..db import (execute, insert, log_operation, now_str, query_all, query_one, scalar, tx, update)
from ..utils.common import BizError, clamp, mask_phone, ok, page_result
from ..utils.deps import client_ip, require_admin
from .claims import refresh_claim_stat, to_claim_vo
from .items import BASE_SELECT, to_list_vo

router = APIRouter(prefix="/admin", tags=["管理端"])


# ----------------------------------------------------------------------
# 分类字典
# ----------------------------------------------------------------------
@router.get("/categories")
def list_categories(request: Request, admin: dict = Depends(require_admin)):
    rows = query_all("SELECT * FROM category WHERE deleted = 0 ORDER BY sort, id")
    for r in rows:
        r["itemCount"] = scalar("SELECT COUNT(*) FROM item_record WHERE category_id = ? AND deleted = 0",
                                (r["id"],))
    return ok({"list": rows, "total": len(rows)}, request)


@router.post("/categories")
def create_category(request: Request, body: dict, admin: dict = Depends(require_admin)):
    name = (body.get("name") or "").strip()
    if not (1 <= len(name) <= 16):
        raise BizError(2001, "分类名称需为 1-16 个字符")
    if query_one("SELECT id FROM category WHERE name = ? AND deleted = 0", (name,)):
        raise BizError(3001)
    now = now_str()
    cid = insert("category", dict(name=name, icon=(body.get("icon") or "").strip() or None,
                                  sort=int(body.get("sort") or 0),
                                  status=1 if body.get("status", 1) else 0,
                                  deleted=0, create_time=now, update_time=now))
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "category", "CREATE", cid, name,
                      client_ip(request))
    return ok({"id": cid}, request)


@router.put("/categories/{cid}")
def update_category(request: Request, cid: int, body: dict, admin: dict = Depends(require_admin)):
    row = query_one("SELECT * FROM category WHERE id = ? AND deleted = 0", (cid,))
    if not row:
        raise BizError(2005)
    name = (body.get("name") or row["name"]).strip()
    if query_one("SELECT id FROM category WHERE name = ? AND deleted = 0 AND id <> ?", (name, cid)):
        raise BizError(3001)
    update("category", dict(name=name, icon=(body.get("icon") or "").strip() or None,
                            sort=int(body.get("sort") if body.get("sort") is not None else row["sort"]),
                            status=1 if body.get("status", row["status"]) else 0,
                            update_time=now_str()), "id = ?", (cid,))
    return ok(None, request)


@router.delete("/categories/{cid}")
def delete_category(request: Request, cid: int, admin: dict = Depends(require_admin)):
    used = scalar("SELECT COUNT(*) FROM item_record WHERE category_id = ? AND deleted = 0", (cid,))
    if used:
        raise BizError(3003, f"该分类下存在 {used} 条信息，无法删除，可改为停用")
    update("category", dict(deleted=1, update_time=now_str()), "id = ?", (cid,))
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "category", "DELETE", cid, None,
                      client_ip(request))
    return ok(None, request)


# ----------------------------------------------------------------------
# 地点字典
# ----------------------------------------------------------------------
@router.get("/locations")
def list_locations(request: Request, areaType: Optional[int] = None,
                   admin: dict = Depends(require_admin)):
    sql = "SELECT * FROM location WHERE deleted = 0"
    args: list = []
    if areaType:
        sql += " AND area_type = ?"
        args.append(areaType)
    sql += " ORDER BY area_type, sort, id"
    rows = query_all(sql, args)
    for r in rows:
        r["itemCount"] = scalar("SELECT COUNT(*) FROM item_record WHERE location_id = ? AND deleted = 0",
                                (r["id"],))
    return ok({"list": rows, "total": len(rows)}, request)


@router.post("/locations")
def create_location(request: Request, body: dict, admin: dict = Depends(require_admin)):
    name = (body.get("name") or "").strip()
    area = int(body.get("areaType") or 1)
    if area not in (1, 2):
        raise BizError(2001, "区域只能是校内（1）或校外（2）")
    if not (1 <= len(name) <= 32):
        raise BizError(2001, "地点名称需为 1-32 个字符")
    if query_one("SELECT id FROM location WHERE area_type = ? AND name = ? AND deleted = 0", (area, name)):
        raise BizError(3002)
    now = now_str()
    lid = insert("location", dict(area_type=area, name=name, sort=int(body.get("sort") or 0),
                                  status=1 if body.get("status", 1) else 0, deleted=0,
                                  create_time=now, update_time=now))
    return ok({"id": lid}, request)


@router.put("/locations/{lid}")
def update_location(request: Request, lid: int, body: dict, admin: dict = Depends(require_admin)):
    row = query_one("SELECT * FROM location WHERE id = ? AND deleted = 0", (lid,))
    if not row:
        raise BizError(2005)
    name = (body.get("name") or row["name"]).strip()
    area = int(body.get("areaType") or row["area_type"])
    if query_one("SELECT id FROM location WHERE area_type = ? AND name = ? AND deleted = 0 AND id <> ?",
                 (area, name, lid)):
        raise BizError(3002)
    update("location", dict(name=name, area_type=area,
                            sort=int(body.get("sort") if body.get("sort") is not None else row["sort"]),
                            status=1 if body.get("status", row["status"]) else 0,
                            update_time=now_str()), "id = ?", (lid,))
    return ok(None, request)


@router.delete("/locations/{lid}")
def delete_location(request: Request, lid: int, admin: dict = Depends(require_admin)):
    used = scalar("SELECT COUNT(*) FROM item_record WHERE location_id = ? AND deleted = 0", (lid,))
    if used:
        raise BizError(3005, f"该地点下存在 {used} 条信息，无法删除，可改为停用")
    update("location", dict(deleted=1, update_time=now_str()), "id = ?", (lid,))
    return ok(None, request)


# ----------------------------------------------------------------------
# 用户管理
# ----------------------------------------------------------------------
@router.get("/users")
def list_users(request: Request, keyword: str = "", status: Optional[int] = None,
               role: Optional[int] = None, page: int = 1, size: int = 10,
               admin: dict = Depends(require_admin)):
    page, size = max(1, page), clamp(size, 1, 50)
    where, args = ["deleted = 0"], []
    kw = (keyword or "").strip()
    if kw:
        where.append("(username LIKE ? OR nickname LIKE ? OR phone LIKE ?)")
        args += [f"%{kw}%"] * 3
    if status is not None:
        where.append("status = ?")
        args.append(status)
    if role is not None:
        where.append("role = ?")
        args.append(role)
    where_sql = " AND ".join(where)
    total = scalar(f"SELECT COUNT(*) FROM sys_user WHERE {where_sql}", args)
    rows = query_all(f"SELECT * FROM sys_user WHERE {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?",
                     args + [size, (page - 1) * size])
    items = [{
        "id": r["id"], "username": r["username"], "nickname": r["nickname"],
        "phone": mask_phone(r["phone"]), "phoneFull": r["phone"], "wechat": r["wechat"],
        "role": r["role"], "status": r["status"], "createTime": r["create_time"],
        "lastLoginTime": r["last_login_time"], "lastLoginIp": r["last_login_ip"],
        "itemCount": scalar("SELECT COUNT(*) FROM item_record WHERE publisher_id = ? AND deleted = 0",
                            (r["id"],)),
        "claimCount": scalar("SELECT COUNT(*) FROM item_claim WHERE claimant_id = ? AND deleted = 0",
                             (r["id"],)),
    } for r in rows]
    return ok(page_result(items, total, page, size), request)


@router.patch("/users/{uid}/status")
def change_user_status(request: Request, uid: int, body: dict,
                       admin: dict = Depends(require_admin)):
    if uid == admin["id"]:
        raise BizError(3004)
    target = 1 if int(body.get("status") or 0) == 1 else 0
    row = query_one("SELECT * FROM sys_user WHERE id = ? AND deleted = 0", (uid,))
    if not row:
        raise BizError(2005)
    update("sys_user", dict(status=target, update_time=now_str()), "id = ?", (uid,))
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "user",
                      "ENABLE_USER" if target else "DISABLE_USER", uid, row["username"],
                      client_ip(request))
    return ok(None, request)


# ----------------------------------------------------------------------
# 信息管理
# ----------------------------------------------------------------------
@router.get("/items")
def list_all_items(request: Request, keyword: str = "", status: Optional[int] = None,
                   type: Optional[int] = None, categoryId: Optional[int] = None,
                   areaType: Optional[int] = None, claimStatus: Optional[int] = None,
                   includeDeleted: int = 0, page: int = 1, size: int = 10,
                   admin: dict = Depends(require_admin)):
    page, size = max(1, page), clamp(size, 1, 50)
    where, args = [], []
    if not includeDeleted:
        where.append("i.deleted = 0")
    if status is not None:
        where.append("i.status = ?")
        args.append(status)
    if type:
        where.append("i.type = ?")
        args.append(type)
    if categoryId:
        where.append("i.category_id = ?")
        args.append(categoryId)
    if areaType:
        where.append("i.area_type = ?")
        args.append(areaType)
    if claimStatus is not None:
        where.append("i.claim_status = ?")
        args.append(claimStatus)
    kw = (keyword or "").strip()
    if kw:
        where.append("(i.title LIKE ? OR i.description LIKE ?)")
        args += [f"%{kw}%"] * 2
    where_sql = (" AND " + " AND ".join(where)) if where else ""
    total = scalar(f"SELECT COUNT(*) FROM item_record i WHERE 1=1{where_sql}", args)
    rows = query_all(f"{BASE_SELECT} WHERE 1=1{where_sql} ORDER BY i.create_time DESC LIMIT ? OFFSET ?",
                     args + [size, (page - 1) * size])
    items = []
    for r in rows:
        vo = to_list_vo(r, admin)
        vo["deleted"] = r["deleted"]
        vo["publisherRealName"] = r["publisher_nickname"]
        vo["publisherPhone"] = mask_phone(r["publisher_phone"])
        vo["publisherPhoneFull"] = r["publisher_phone"]
        items.append(vo)
    return ok(page_result(items, total, page, size), request)


@router.patch("/items/{item_id}/offline")
def force_offline(request: Request, item_id: int, body: dict,
                  admin: dict = Depends(require_admin)):
    reason = (body.get("reason") or "").strip()
    if not reason or len(reason) > 200:
        raise BizError(2001, "请填写强制下架原因（不超过 200 个字符）")
    row = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    with tx() as conn:
        conn.execute("UPDATE item_record SET status = 2, finish_time = ?, update_time = ? WHERE id = ?",
                     (now_str(), now_str(), item_id))
        log_operation(conn, admin["id"], admin["nickname"], "item", "FORCE_OFFLINE", item_id, reason,
                      client_ip(request))
    return ok(None, request)


# ----------------------------------------------------------------------
# 认领管理
# ----------------------------------------------------------------------
@router.get("/claims")
def list_claims(request: Request, status: Optional[int] = None, itemId: Optional[int] = None,
                keyword: str = "", page: int = 1, size: int = 10,
                admin: dict = Depends(require_admin)):
    page, size = max(1, page), clamp(size, 1, 50)
    where, args = ["c.deleted = 0"], []
    if status:
        where.append("c.status = ?")
        args.append(status)
    if itemId:
        where.append("c.item_id = ?")
        args.append(itemId)
    kw = (keyword or "").strip()
    if kw:
        where.append("(i.title LIKE ? OR cu.nickname LIKE ?)")
        args += [f"%{kw}%"] * 2
    where_sql = " AND ".join(where)
    total = scalar(f"SELECT COUNT(*) FROM item_claim c JOIN item_record i ON i.id = c.item_id "
                   f"LEFT JOIN sys_user cu ON cu.id = c.claimant_id WHERE {where_sql}", args)
    rows = query_all(f"""
        SELECT c.*, i.title AS item_title, i.type AS item_type, i.status AS item_status,
               i.deleted AS item_deleted, i.is_anonymous AS item_anonymous,
               cu.nickname AS claimant_name, cu.phone AS claimant_phone, pu.nickname AS publisher_name
        FROM item_claim c JOIN item_record i ON i.id = c.item_id
        LEFT JOIN sys_user cu ON cu.id = c.claimant_id
        LEFT JOIN sys_user pu ON pu.id = c.publisher_id
        WHERE {where_sql} ORDER BY CASE c.status WHEN 1 THEN 0 ELSE 1 END, c.create_time DESC
        LIMIT ? OFFSET ?""", args + [size, (page - 1) * size])
    return ok(page_result([to_claim_vo(r, None) for r in rows], total, page, size), request)


@router.get("/claims/{claim_id}/messages")
def admin_claim_messages(request: Request, claim_id: int, admin: dict = Depends(require_admin)):
    rows = query_all("SELECT * FROM claim_message WHERE claim_id = ? ORDER BY create_time, id", (claim_id,))
    return ok({"list": [{
        "id": m["id"], "senderName": "系统消息" if m["is_system"] else "",
        "senderId": m["sender_id"], "isSystem": bool(m["is_system"]),
        "content": m["content"], "createTime": m["create_time"],
    } for m in rows]}, request)


@router.patch("/claims/{claim_id}/release")
def admin_release_claim(request: Request, claim_id: int, body: dict,
                        admin: dict = Depends(require_admin)):
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise BizError(2001, "请填写解除原因")
    row = query_one("SELECT * FROM item_claim WHERE id = ? AND deleted = 0", (claim_id,))
    if not row:
        raise BizError(2005)
    if row["status"] != 1:
        raise BizError(2010, "该认领不是「认领中」状态")
    with tx() as conn:
        conn.execute("UPDATE item_claim SET status = 3, finish_time = ?, finish_reason = ?, update_time = ?"
                     " WHERE id = ?", (now_str(), f"[管理员] {reason}", now_str(), claim_id))
        conn.execute("INSERT INTO claim_message (claim_id, sender_id, receiver_id, content, is_system,"
                     " read_flag, create_time) VALUES (?,NULL,NULL,?,1,0,?)",
                     (claim_id, f"管理员已解除该认领，原因：{reason}", now_str()))
        log_operation(conn, admin["id"], admin["nickname"], "claim", "ADMIN_RELEASE", claim_id, reason,
                      client_ip(request))
    refresh_claim_stat(row["item_id"])
    return ok(None, request)


@router.post("/claims/expire-scan")
def trigger_expire_scan(request: Request, admin: dict = Depends(require_admin)):
    from .claims import expire_scan
    n = expire_scan()
    with tx() as conn:
        log_operation(conn, admin["id"], admin["nickname"], "claim", "EXPIRE_SCAN", None,
                      f"断开 {n} 条超时认领", client_ip(request))
    return ok({"expired": n}, request)


# ----------------------------------------------------------------------
# 统计
# ----------------------------------------------------------------------
@router.get("/statistics/overview")
def statistics(request: Request, admin: dict = Depends(require_admin)):
    day_expr = "date(create_time) = date('now','localtime')"
    total_item = scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0")
    active_item = scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND status = 1")
    finished_claim = scalar("SELECT COUNT(*) FROM item_claim WHERE status = 2")
    expired_claim = scalar("SELECT COUNT(*) FROM item_claim WHERE status = 3")
    finish_rate = round(finished_claim / (finished_claim + expired_claim), 3) if (finished_claim + expired_claim) else 0

    trend = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        trend.append({"date": day, "count": scalar(
            "SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND date(create_time) = ?", (day,))})

    return ok({
        "userTotal": scalar("SELECT COUNT(*) FROM sys_user WHERE deleted = 0"),
        "itemTotal": total_item,
        "todayNew": scalar(f"SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND {day_expr}"),
        "todayUserNew": scalar(f"SELECT COUNT(*) FROM sys_user WHERE deleted = 0 AND {day_expr}"),
        "activeItemTotal": active_item,
        "activeRate": round(active_item / total_item, 3) if total_item else 0,
        "typeDistribution": {
            "lost": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND type = 1"),
            "found": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND type = 2"),
        },
        "areaDistribution": {
            "campus": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND area_type = 1"),
            "outside": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND area_type = 2"),
        },
        "claimStat": {
            "activeClaimTotal": scalar("SELECT COUNT(*) FROM item_claim WHERE status = 1 AND deleted = 0"),
            "finishedClaimTotal": finished_claim,
            "expiredClaimTotal": expired_claim,
            "canceledClaimTotal": scalar("SELECT COUNT(*) FROM item_claim WHERE status = 4"),
            "finishRate": finish_rate,
            "anonymousItemTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND is_anonymous = 1"),
        },
        "categoryTop5": query_all(
            "SELECT c.id AS categoryId, c.name AS categoryName, COUNT(i.id) AS count "
            "FROM category c LEFT JOIN item_record i ON i.category_id = c.id AND i.deleted = 0 "
            "GROUP BY c.id ORDER BY count DESC, c.sort LIMIT 5"),
        "trend7Days": trend,
    }, request)
