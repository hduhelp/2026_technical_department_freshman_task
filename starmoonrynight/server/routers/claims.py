# -*- coding: utf-8 -*-
"""认领模块：提交申请 / 我的认领 / 确认完成 / 解除 / 撤回 / 站内私聊 / 72 小时超时断开"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request

from ..config import settings
from ..db import (dt_to_str, execute, insert, log_operation, now_str, query_all, query_one,
                  scalar, str_to_dt, tx, update)
from ..utils.common import BizError, clamp, mask_phone, ok, page_result
from ..utils.deps import client_ip, require_admin, require_user

router = APIRouter(prefix="/claims", tags=["认领"])

CLAIM_STATUS = {1: "认领中", 2: "已确认完成", 3: "已超时断开", 4: "已取消"}
RELEASE_REASONS = {"超时未沟通", "特征不符", "双方协商未达成", "恶意认领", "其他"}
PUBLISHER_RELEASE_REASONS = {"超过 72 小时未沟通", "特征不符", "双方协商未达成", "恶意认领", "物品已归还他人"}


# ----------------------------------------------------------------------
# 内部辅助
# ----------------------------------------------------------------------
def refresh_claim_stat(item_id: int) -> None:
    """按有效认领数重算记录上的认领状态与计数（幂等）"""
    n = scalar("SELECT COUNT(*) FROM item_claim WHERE item_id = ? AND status = 1 AND deleted = 0", (item_id,))
    update("item_record", {"claim_count": n, "claim_status": 1 if n > 0 else 0}, "id = ?", (item_id,))


def _system_message(conn, claim_id: int, content: str) -> None:
    conn.execute("INSERT INTO claim_message (claim_id, sender_id, receiver_id, content, is_system,"
                 " read_flag, create_time) VALUES (?,?,?,?,1,0,?)",
                 (claim_id, None, None, content, now_str()))


def _claim_row(claim_id: int) -> dict:
    row = query_one("""
        SELECT c.*, i.title AS item_title, i.type AS item_type, i.status AS item_status,
               i.deleted AS item_deleted, i.is_anonymous AS item_anonymous,
               cu.nickname AS claimant_name, cu.phone AS claimant_phone,
               pu.nickname AS publisher_name
        FROM item_claim c
        JOIN item_record i ON i.id = c.item_id
        LEFT JOIN sys_user cu ON cu.id = c.claimant_id
        LEFT JOIN sys_user pu ON pu.id = c.publisher_id
        WHERE c.id = ? AND c.deleted = 0""", (claim_id,))
    if not row:
        raise BizError(2005)
    return row


def _can_view(row: dict, user: dict) -> bool:
    return user["role"] == 2 or user["id"] in (row["claimant_id"], row["publisher_id"])


def _remain_hours(expire_time: str) -> int:
    dt = str_to_dt(expire_time)
    if not dt:
        return 0
    delta = (dt - datetime.now()).total_seconds() / 3600.0
    return max(0, int(delta + 0.999)) if delta > 0 else 0


def to_claim_vo(row: dict, viewer: Optional[dict] = None, with_note: bool = True) -> dict:
    vo = {
        "claimId": row["id"],
        "itemId": row["item_id"],
        "itemTitle": row["item_title"],
        "itemStatus": row["item_status"],
        "claimantId": row["claimant_id"],
        "claimantName": row["claimant_name"],
        "claimantPhoneMasked": mask_phone(row["claimant_phone"]),
        "publisherId": row["publisher_id"],
        "publisherName": row["publisher_name"],
        "status": row["status"],
        "statusName": CLAIM_STATUS.get(row["status"], ""),
        "startTime": row["start_time"],
        "expireTime": row["expire_time"],
        "remainHours": _remain_hours(row["expire_time"]) if row["status"] == 1 else 0,
        "finishTime": row["finish_time"],
        "finishReason": row["finish_reason"],
        "lastChatTime": row["last_chat_time"],
        "messageCount": scalar("SELECT COUNT(*) FROM claim_message WHERE claim_id = ?", (row["id"],)),
        "isAnonymousItem": bool(row["item_anonymous"]),
        "timeoutHours": settings.claim_timeout_hours,
    }
    unread_sql = ("SELECT COUNT(*) FROM claim_message WHERE claim_id = ? AND read_flag = 0 "
                  "AND is_system = 0 AND receiver_id = ?")
    vo["unreadCount"] = scalar(unread_sql, (row["id"], viewer["id"])) if viewer else 0
    if with_note:
        vo["claimNote"] = row["claim_note"]
    return vo


# ----------------------------------------------------------------------
# 提交认领
# ----------------------------------------------------------------------
@router.post("")
def submit_claim(request: Request, body: dict, user: dict = Depends(require_user)):
    item_id = int(body.get("itemId") or 0)
    note = (body.get("claimNote") or "").strip()
    if not (10 <= len(note) <= 200):
        raise BizError(2001, "认领说明需为 10-200 个字符")

    item = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not item:
        raise BizError(2005)
    if item["type"] != 1:
        raise BizError(2001, "该信息不支持认领（仅失物可认领）")
    if item["status"] != 1:
        raise BizError(2005, "该信息已结束，无法认领")
    if item["publisher_id"] == user["id"]:
        raise BizError(2013)

    exist = query_one("SELECT * FROM item_claim WHERE item_id = ? AND claimant_id = ? AND deleted = 0",
                      (item_id, user["id"]))
    if exist:
        if exist["status"] == 1:
            row = _claim_row(exist["id"])
            return ok(to_claim_vo(row, user), request)
        raise BizError(2001, "你已提交过认领且已被断开，请先在「我的认领」中重新申请")

    active = scalar("SELECT COUNT(*) FROM item_claim WHERE item_id = ? AND status = 1 AND deleted = 0",
                    (item_id,))
    if active >= settings.claim_max_active:
        raise BizError(2012)

    now = datetime.now()
    with tx() as conn:
        cur = conn.execute(
            "INSERT INTO item_claim (item_id, claimant_id, publisher_id, claim_note, status, start_time,"
            " expire_time, last_chat_time, finish_time, finish_reason, deleted, create_time, update_time)"
            " VALUES (?,?,?,?,1,?,?,?,NULL,NULL,0,?,?)",
            (item_id, user["id"], item["publisher_id"], note, dt_to_str(now),
             dt_to_str(now + timedelta(hours=settings.claim_timeout_hours)), dt_to_str(now),
             dt_to_str(now), dt_to_str(now)))
        claim_id = cur.lastrowid
        _system_message(conn, claim_id,
                        f"认领申请已提交，请在 {settings.claim_timeout_hours} 小时内沟通完成认领。")
        log_operation(conn, user["id"], user["nickname"], "claim", "SUBMIT", claim_id,
                      item["title"], client_ip(request))
    refresh_claim_stat(item_id)
    row = _claim_row(claim_id)
    vo = to_claim_vo(row, user)
    vo["chatSessionId"] = claim_id
    return ok(vo, request)


# ----------------------------------------------------------------------
# 查询
# ----------------------------------------------------------------------
@router.get("/mine")
def my_claims(request: Request, status: Optional[int] = None, page: int = 1, size: int = 10,
              user: dict = Depends(require_user)):
    page, size = max(1, page), clamp(size, 1, 50)
    where, args = ["c.deleted = 0", "c.claimant_id = ?"], [user["id"]]
    if status:
        where.append("c.status = ?")
        args.append(status)
    where_sql = " AND ".join(where)
    total = scalar(f"SELECT COUNT(*) FROM item_claim c WHERE {where_sql}", args)
    rows = query_all(f"""
        SELECT c.*, i.title AS item_title, i.type AS item_type, i.status AS item_status,
               i.deleted AS item_deleted, i.is_anonymous AS item_anonymous,
               cu.nickname AS claimant_name, cu.phone AS claimant_phone, pu.nickname AS publisher_name
        FROM item_claim c JOIN item_record i ON i.id = c.item_id
        LEFT JOIN sys_user cu ON cu.id = c.claimant_id
        LEFT JOIN sys_user pu ON pu.id = c.publisher_id
        WHERE {where_sql} ORDER BY c.create_time DESC LIMIT ? OFFSET ?""",
        args + [size, (page - 1) * size])
    return ok(page_result([to_claim_vo(r, user) for r in rows], total, page, size), request)


@router.get("/unread-count")
def unread_count(request: Request, user: dict = Depends(require_user)):
    return ok({"count": scalar("SELECT COUNT(*) FROM claim_message WHERE receiver_id = ? AND read_flag = 0",
                               (user["id"],))}, request)


@router.get("/{claim_id}")
def claim_detail(request: Request, claim_id: int, user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if not _can_view(row, user):
        raise BizError(2005)
    return ok(to_claim_vo(row, user), request)


# ----------------------------------------------------------------------
# 状态变更
# ----------------------------------------------------------------------
@router.patch("/{claim_id}/finish")
def finish_claim(request: Request, claim_id: int, body: dict, user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if row["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    if row["status"] != 1:
        raise BizError(2010, "该认领不是「认领中」状态")
    note = (body.get("note") or "已当面核对并归还").strip()[:50]
    others = query_all("SELECT id, claimant_id FROM item_claim WHERE item_id = ? AND status = 1 AND id <> ?"
                       " AND deleted = 0", (row["item_id"], claim_id))
    with tx() as conn:
        conn.execute("UPDATE item_claim SET status = 2, finish_time = ?, finish_reason = ?, update_time = ?"
                     " WHERE id = ?", (now_str(), note, now_str(), claim_id))
        _system_message(conn, claim_id, f"发布人已确认认领完成：{note}")
        for o in others:
            conn.execute("UPDATE item_claim SET status = 3, finish_time = ?,"
                         " finish_reason = '该物品已归还他人', update_time = ? WHERE id = ?",
                         (now_str(), now_str(), o["id"]))
            _system_message(conn, o["id"], "该物品已由其他认领人完成认领，你的认领已自动断开。")
        log_operation(conn, user["id"], user["nickname"], "claim", "FINISH", claim_id, note,
                      client_ip(request))
    refresh_claim_stat(row["item_id"])
    return ok({"finishedOthers": len(others)}, request)


@router.patch("/{claim_id}/release")
def release_claim(request: Request, claim_id: int, body: dict, user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if row["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    reason = (body.get("reason") or "").strip()
    if not reason or len(reason) > 60:
        raise BizError(2001, "请填写解除原因（不超过 60 个字符）")
    if row["status"] != 1:
        raise BizError(2010, "该认领不是「认领中」状态")
    with tx() as conn:
        conn.execute("UPDATE item_claim SET status = 3, finish_time = ?, finish_reason = ?, update_time = ?"
                     " WHERE id = ?", (now_str(), reason, now_str(), claim_id))
        _system_message(conn, claim_id, f"发布人已解除该认领，原因：{reason}")
        log_operation(conn, user["id"], user["nickname"], "claim", "RELEASE", claim_id, reason,
                      client_ip(request))
    refresh_claim_stat(row["item_id"])
    return ok(None, request)


@router.patch("/{claim_id}/cancel")
def cancel_claim(request: Request, claim_id: int, user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if row["claimant_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    if row["status"] != 1:
        raise BizError(2010, "该认领不是「认领中」状态")
    with tx() as conn:
        conn.execute("UPDATE item_claim SET status = 4, finish_time = ?, finish_reason = '申请人主动撤回',"
                     " update_time = ? WHERE id = ?", (now_str(), now_str(), claim_id))
        _system_message(conn, claim_id, "申请人已撤回该认领。")
        log_operation(conn, user["id"], user["nickname"], "claim", "CANCEL", claim_id, None,
                      client_ip(request))
    refresh_claim_stat(row["item_id"])
    return ok(None, request)


# ----------------------------------------------------------------------
# 站内私聊
# ----------------------------------------------------------------------
@router.get("/{claim_id}/messages")
def list_messages(request: Request, claim_id: int, page: int = 1, size: int = 50,
                  user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if not _can_view(row, user):
        raise BizError(2005)
    page, size = max(1, page), clamp(size, 1, 200)
    total = scalar("SELECT COUNT(*) FROM claim_message WHERE claim_id = ?", (claim_id,))
    rows = query_all("""
        SELECT m.*, u.nickname AS sender_name FROM claim_message m
        LEFT JOIN sys_user u ON u.id = m.sender_id
        WHERE m.claim_id = ? ORDER BY m.create_time, m.id LIMIT ? OFFSET ?""",
        (claim_id, size, (page - 1) * size))
    # 把发给我的未读消息标记为已读
    execute("UPDATE claim_message SET read_flag = 1 WHERE claim_id = ? AND receiver_id = ? AND read_flag = 0",
            (claim_id, user["id"]))
    items = [{
        "id": m["id"],
        "senderId": m["sender_id"],
        "senderName": "系统消息" if m["is_system"] else (
            m["sender_name"] or "匿名用户"),
        "isSystem": bool(m["is_system"]),
        "mine": m["sender_id"] == user["id"],
        "content": m["content"],
        "createTime": m["create_time"],
    } for m in rows]
    return ok(page_result(items, total, page, size), request)


@router.post("/{claim_id}/messages")
def send_message(request: Request, claim_id: int, body: dict, user: dict = Depends(require_user)):
    row = _claim_row(claim_id)
    if not _can_view(row, user):
        raise BizError(2005)
    if row["status"] != 1:
        raise BizError(2014)
    content = (body.get("content") or "").strip()
    if not (1 <= len(content) <= 500):
        raise BizError(2001, "消息长度需为 1-500 个字符")
    receiver = row["publisher_id"] if user["id"] == row["claimant_id"] else row["claimant_id"]
    with tx() as conn:
        conn.execute("INSERT INTO claim_message (claim_id, sender_id, receiver_id, content, is_system,"
                     " read_flag, create_time) VALUES (?,?,?,?,0,0,?)",
                     (claim_id, user["id"], receiver, content, now_str()))
        conn.execute("UPDATE item_claim SET last_chat_time = ?, update_time = ? WHERE id = ?",
                     (now_str(), now_str(), claim_id))
    return ok(None, request)


# ----------------------------------------------------------------------
# 超时断开（定时任务调用，也可手动触发用于测试）
# ----------------------------------------------------------------------
def expire_scan() -> int:
    rows = query_all("SELECT id, item_id FROM item_claim WHERE status = 1 AND deleted = 0"
                     " AND expire_time < ? LIMIT 500", (now_str(),))
    if not rows:
        return 0
    item_ids = set()
    with tx() as conn:
        for r in rows:
            conn.execute("UPDATE item_claim SET status = 3, finish_time = ?,"
                         " finish_reason = '超时未沟通', update_time = ? WHERE id = ?",
                         (now_str(), now_str(), r["id"]))
            _system_message(conn, r["id"],
                            f"该认领已超过 {settings.claim_timeout_hours} 小时未完成，系统已自动断开。")
            item_ids.add(r["item_id"])
    for iid in item_ids:
        refresh_claim_stat(iid)
    return len(rows)
