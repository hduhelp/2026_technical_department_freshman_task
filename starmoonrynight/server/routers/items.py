# -*- coding: utf-8 -*-
"""信息模块：发布 / 检索 / 详情 / 编辑 / 上下架 / 删除 / 收藏 / 图片上传"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from ..config import settings
from ..db import (dt_to_str, execute, insert, log_operation, now_str, query_all, query_one,
                  scalar, str_to_dt, tx, update)
from ..utils.common import (BizError, clamp, escape_like, mask_phone, mask_wechat, ok,
                            page_result, check_phone)
from ..utils.deps import client_ip, current_user_optional, require_user
from ..services import image_service

router = APIRouter(prefix="/items", tags=["信息"])
image_router = APIRouter(prefix="/images", tags=["图片"])
fav_router = APIRouter(prefix="/favorites", tags=["收藏"])

TYPE_NAME = {1: "失物", 2: "招领"}
AREA_NAME = {1: "校内", 2: "校外"}
STATUS_NAME = {1: "发布中", 2: "已结束"}

BASE_SELECT = """
SELECT i.*, c.name AS category_name, l.name AS location_name, u.nickname AS publisher_nickname,
       u.avatar AS publisher_avatar, u.phone AS publisher_phone
FROM item_record i
LEFT JOIN category c ON c.id = i.category_id
LEFT JOIN location l ON l.id = i.location_id
LEFT JOIN sys_user u ON u.id = i.publisher_id
"""


# ----------------------------------------------------------------------
# 序列化
# ----------------------------------------------------------------------
def _cover_thumb(item_id: int) -> Optional[str]:
    row = query_one("SELECT thumb_url FROM item_image WHERE item_id = ? AND deleted = 0 "
                    "ORDER BY sort LIMIT 1", (item_id,))
    return row["thumb_url"] if row else None


def _images(item_id: int) -> list[dict]:
    rows = query_all("SELECT url, thumb_url, sort FROM item_image WHERE item_id = ? AND deleted = 0 "
                     "ORDER BY sort", (item_id,))
    # 统一字段命名为小驼峰，避免前后端命名不一致
    return [{"url": r["url"], "thumbUrl": r["thumb_url"], "sort": r["sort"]} for r in rows]


def _claim_tag(row: dict) -> tuple[Optional[int], Optional[str], int]:
    if row["type"] != 1:
        return None, None, 0
    n = row["claim_count"] or 0
    if n > 0:
        return 1, f"{n} 人认领中", n
    return 0, "暂未认领", 0


def to_list_vo(row: dict, viewer: Optional[dict]) -> dict:
    claim_status, claim_name, claim_count = _claim_tag(row)
    anon = bool(row["is_anonymous"])
    is_owner = bool(viewer and viewer["id"] == row["publisher_id"])
    is_admin = bool(viewer and viewer["role"] == 2)
    hide_identity = anon and not is_owner and not is_admin
    return {
        "id": row["id"],
        "type": row["type"],
        "typeName": TYPE_NAME.get(row["type"], ""),
        "title": row["title"],
        "categoryId": row["category_id"],
        "categoryName": row["category_name"],
        "areaType": row["area_type"],
        "areaName": AREA_NAME.get(row["area_type"], ""),
        "locationId": row["location_id"],
        "locationName": row["location_name"],
        "locationDetail": row["location_detail"],
        "locationText": f"{AREA_NAME.get(row['area_type'], '')} · {row['location_detail']}",
        "happenTime": row["happen_time"],
        "description": row["description"][:60] + ("…" if len(row["description"]) > 60 else ""),
        "coverThumb": _cover_thumb(row["id"]),
        "status": row["status"],
        "statusName": STATUS_NAME.get(row["status"], ""),
        "claimStatus": claim_status,
        "claimStatusName": claim_name,
        "claimCount": claim_count,
        "isAnonymous": anon,
        "handoverEnabled": bool(row["handover_address"]),
        "publisherId": None if hide_identity else row["publisher_id"],
        "publisherNickname": "匿名用户" if hide_identity else row["publisher_nickname"],
        "viewCount": row["view_count"],
        "favoriteCount": row["favorite_count"],
        "createTime": row["create_time"],
        "favorited": bool(viewer and query_one(
            "SELECT id FROM item_favorite WHERE user_id = ? AND item_id = ?", (viewer["id"], row["id"]))),
    }


def to_detail_vo(row: dict, viewer: Optional[dict], request_ip: str = "") -> dict:
    anon = bool(row["is_anonymous"])
    logged = viewer is not None
    is_owner = bool(viewer and viewer["id"] == row["publisher_id"])
    is_admin = bool(viewer and viewer["role"] == 2)
    hide_identity = anon and not is_owner and not is_admin
    claim_status, claim_name, claim_count = _claim_tag(row)

    my_claim = None
    if viewer and row["type"] == 1:
        my_claim = query_one(
            "SELECT id, status, expire_time, start_time FROM item_claim "
            "WHERE item_id = ? AND claimant_id = ? AND deleted = 0", (row["id"], viewer["id"]))

    handover = {"enabled": bool(row["handover_address"]), "address": row["handover_address"],
                "phone": None, "tip": "拾获人已将该物品上交，请优先联系上交地址领取"}
    if row["handover_phone"]:
        handover["phone"] = row["handover_phone"] if logged else mask_phone(row["handover_phone"])

    contact = {
        "visible": logged and not hide_identity,
        "name": "匿名用户" if hide_identity else row["contact_name"],
        "phone": None, "wechat": None, "tip": "登录后可见完整联系方式",
    }
    if not hide_identity:
        contact["phone"] = row["contact_phone"] if logged else mask_phone(row["contact_phone"])
        contact["wechat"] = row["contact_wechat"] if logged else mask_wechat(row["contact_wechat"])

    vo = to_list_vo(row, viewer)
    vo.update({
        "description": row["description"],
        "images": _images(row["id"]),
        "handover": handover,
        "contact": contact,
        "owner": is_owner,
        "publisher": None if hide_identity else {
            "id": row["publisher_id"], "nickname": row["publisher_nickname"],
            "avatar": row["publisher_avatar"]},
        "expireTime": row["expire_time"],
        "finishTime": row["finish_time"],
        "updateTime": row["update_time"],
        "contactName": None if hide_identity else row["contact_name"],
        "contactPhone": None if hide_identity else (row["contact_phone"] if logged else mask_phone(row["contact_phone"])),
        "contactWechat": None if hide_identity else (row["contact_wechat"] if logged else mask_wechat(row["contact_wechat"])),
        "handoverAddress": row["handover_address"],
        "handoverPhoneVisible": None if hide_identity else (
            row["handover_phone"] if logged else mask_phone(row["handover_phone"])),
        # 编辑回填用（仅发布人可见）
        "contactPhoneRaw": row["contact_phone"] if is_owner else None,
        "contactWechatRaw": row["contact_wechat"] if is_owner else None,
        "handoverPhoneRaw": row["handover_phone"] if is_owner else None,
        "claim": {
            "supported": row["type"] == 1,
            "status": claim_status,
            "statusName": claim_name,
            "count": claim_count,
            "myClaimId": my_claim["id"] if my_claim else None,
            "myClaimStatus": my_claim["status"] if my_claim else None,
            "myClaimDeadline": my_claim["expire_time"] if my_claim else None,
            "timeoutHours": settings.claim_timeout_hours,
        },
    })
    return vo


# ----------------------------------------------------------------------
# 检索
# ----------------------------------------------------------------------
@router.get("")
def list_items(request: Request,
               keyword: str = "", type: Optional[int] = None, categoryId: Optional[int] = None,
               areaType: Optional[int] = None, locationId: Optional[int] = None,
               claimStatus: Optional[int] = None, startTime: str = "", endTime: str = "",
               status: Optional[int] = 1, publisherId: Optional[int] = None,
               mine: int = 0, onlyWithImage: int = 0, sort: str = "newest",
               page: int = 1, size: int = 12,
               viewer: Optional[dict] = Depends(current_user_optional)):
    page = max(1, page or 1)
    size = clamp(size or 12, 1, 50)

    where, args = ["i.deleted = 0"], []
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
    if locationId:
        where.append("i.location_id = ?")
        args.append(locationId)
    if publisherId:
        where.append("i.publisher_id = ?")
        args.append(publisherId)
    if mine and viewer:
        where.append("i.publisher_id = ?")
        args.append(viewer["id"])
    elif mine and not viewer:
        raise BizError(1001)
    if claimStatus is not None:
        where.append("i.claim_status = ?")
        args.append(claimStatus)
    if startTime and str_to_dt(startTime):
        where.append("i.happen_time >= ?")
        args.append(dt_to_str(str_to_dt(startTime)))
    if endTime and str_to_dt(endTime):
        where.append("i.happen_time < ?")
        args.append(dt_to_str(str_to_dt(endTime) + timedelta(days=1)))
    kw = (keyword or "").strip()[:30]
    if kw:
        esc = escape_like(kw)
        where.append("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')")
        args += [f"%{esc}%", f"%{esc}%"]
    if onlyWithImage:
        where.append("EXISTS (SELECT 1 FROM item_image im WHERE im.item_id = i.id AND im.deleted = 0)")

    order = {"newest": "i.create_time DESC", "oldest": "i.create_time ASC",
             "happen_desc": "i.happen_time DESC"}.get(sort, "i.create_time DESC")
    where_sql = " AND ".join(where)

    total = scalar(f"SELECT COUNT(*) FROM item_record i WHERE {where_sql}", args)
    rows = query_all(f"{BASE_SELECT} WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?",
                     args + [size, (page - 1) * size])
    items = [to_list_vo(r, viewer) for r in rows]
    return ok(page_result(items, total, page, size), request)


@router.get("/home")
def home(request: Request, viewer: Optional[dict] = Depends(current_user_optional)):
    def pick(sql_extra: str, limit: int):
        rows = query_all(f"{BASE_SELECT} WHERE i.deleted = 0 AND i.status = 1 {sql_extra} "
                         f"ORDER BY i.create_time DESC LIMIT ?", (limit,))
        return [to_list_vo(r, viewer) for r in rows]

    return ok({
        "latest": pick("", 6),
        "lostLatest": pick("AND i.type = 1", 4),
        "foundLatest": pick("AND i.type = 2", 4),
        "stat": {
            "itemTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND status = 1"),
            "finishedTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND status = 2"),
            "claimingTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 "
                                    "AND status = 1 AND claim_status = 1"),
        },
    }, request)


@router.get("/mine")
def my_items(request: Request, status: Optional[int] = None, type: Optional[int] = None,
             page: int = 1, size: int = 10, user: dict = Depends(require_user)):
    return list_items(request, status=status, type=type, page=page, size=size, mine=1, viewer=user)


@router.get("/{item_id}")
def item_detail(request: Request, item_id: int,
                viewer: Optional[dict] = Depends(current_user_optional)):
    row = query_one(f"{BASE_SELECT} WHERE i.id = ? AND i.deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    # 浏览量 +1（按 IP + 用户 10 分钟内去重，用轻量内存表实现）
    if _should_count_view(item_id, viewer, client_ip(request)):
        execute("UPDATE item_record SET view_count = view_count + 1 WHERE id = ?", (item_id,))
        row["view_count"] = (row["view_count"] or 0) + 1
    vo = to_detail_vo(row, viewer, client_ip(request))
    related = query_all(f"{BASE_SELECT} WHERE i.deleted = 0 AND i.status = 1 AND i.category_id = ? "
                        f"AND i.id <> ? ORDER BY i.create_time DESC LIMIT 3",
                        (row["category_id"], item_id))
    vo["related"] = [to_list_vo(r, viewer) for r in related]
    return ok(vo, request)


_VIEW_CACHE: dict[str, str] = {}


def _should_count_view(item_id: int, viewer: Optional[dict], ip: str) -> bool:
    key = f"{item_id}:{viewer['id'] if viewer else ip}"
    last = _VIEW_CACHE.get(key)
    now = datetime.now()
    if last and (now - datetime.fromisoformat(last)).total_seconds() < 600:
        return False
    _VIEW_CACHE[key] = now.isoformat(timespec="seconds")
    if len(_VIEW_CACHE) > 20000:
        _VIEW_CACHE.clear()
    return True


# ----------------------------------------------------------------------
# 发布 / 编辑
# ----------------------------------------------------------------------
def _validate_publish(body: dict, editing: Optional[dict] = None) -> dict:
    typ = int(body.get("type") or 0)
    if typ not in (1, 2):
        raise BizError(2001, "信息类型不合法")
    title = (body.get("title") or "").strip()
    if not (4 <= len(title) <= 50):
        raise BizError(2001, "标题需为 4-50 个字符")
    desc = (body.get("description") or "").strip()
    if not (10 <= len(desc) <= 1000):
        raise BizError(2001, "详细描述需为 10-1000 个字符")
    detail = (body.get("locationDetail") or "").strip()
    if not (2 <= len(detail) <= 80):
        raise BizError(2001, "详细地址需为 2-80 个字符")

    area = int(body.get("areaType") or 1)
    if area not in (1, 2):
        raise BizError(2001, "区域只能是校内（1）或校外（2）")
    category = query_one("SELECT * FROM category WHERE id = ? AND deleted = 0",
                         (int(body.get("categoryId") or 0),))
    if not category or category["status"] != 1:
        raise BizError(2008)
    location = query_one("SELECT * FROM location WHERE id = ? AND deleted = 0",
                         (int(body.get("locationId") or 0),))
    if not location or location["status"] != 1:
        raise BizError(2009)
    if location["area_type"] != area:
        raise BizError(2001, "地点与所选区域不匹配，请重新选择")

    happen = str_to_dt(body.get("happenTime"))
    if not happen:
        raise BizError(2001, "发生时间格式不正确")
    now = datetime.now()
    if happen > now + timedelta(minutes=5):
        raise BizError(2002, "发生时间不能晚于当前时间")
    if happen < now - timedelta(days=365 * 5):
        raise BizError(2002, "发生时间不能早于 5 年前")

    phone = (body.get("contactPhone") or "").strip() or None
    wechat = (body.get("contactWechat") or "").strip() or None
    if not phone and not wechat:
        raise BizError(2006)
    if phone:
        check_phone(phone)
    if wechat and not (2 <= len(wechat) <= 30):
        raise BizError(2001, "微信号需为 2-30 个字符")

    handover_addr = (body.get("handoverAddress") or "").strip() or None
    handover_phone = (body.get("handoverPhone") or "").strip() or None
    # 上交地址由拾获人登记（东西交到了服务台/宿管处），因此仅招领可填，失物信息不得填写
    if typ == 1 and (handover_addr or handover_phone):
        raise BizError(2001, "失物信息无需填写上交地址")
    if handover_addr and len(handover_addr) > 80:
        raise BizError(2001, "上交地址不能超过 80 个字符")
    if handover_phone:
        if not handover_addr:
            raise BizError(2001, "填写上交地址联系电话前请先填写上交地址")
        check_phone(handover_phone)

    images = body.get("images") or []
    if not isinstance(images, list) or len(images) > settings.image_max_count:
        raise BizError(2007)

    return {
        "type": typ, "title": title, "description": desc, "location_detail": detail,
        "area_type": area, "category_id": category["id"], "location_id": location["id"],
        "happen_time": dt_to_str(happen), "contact_phone": phone, "contact_wechat": wechat,
        "contact_name": (body.get("contactName") or "").strip()[:20] or None,
        "handover_address": handover_addr, "handover_phone": handover_phone,
        "is_anonymous": 1 if body.get("isAnonymous") else 0,
        "images": images,
    }


@router.post("")
def publish(request: Request, body: dict, user: dict = Depends(require_user)):
    data = _validate_publish(body)

    # 频率限制
    last = query_one("SELECT create_time FROM item_record WHERE publisher_id = ? AND deleted = 0 "
                     "ORDER BY id DESC LIMIT 1", (user["id"],))
    if last:
        last_dt = str_to_dt(last["create_time"])
        if last_dt and (datetime.now() - last_dt).total_seconds() < settings.publish_interval_seconds:
            raise BizError(2003, f"发布过于频繁，请 {settings.publish_interval_seconds} 秒后再试")
    today_count = scalar("SELECT COUNT(*) FROM item_record WHERE publisher_id = ? AND deleted = 0 "
                         "AND date(create_time) = date('now','localtime')", (user["id"],))
    if today_count >= settings.publish_daily_limit:
        raise BizError(2003, f"今日发布已达上限（{settings.publish_daily_limit} 条）")
    total_count = scalar("SELECT COUNT(*) FROM item_record WHERE publisher_id = ? AND deleted = 0",
                         (user["id"],))
    if total_count >= settings.publish_total_limit:
        raise BizError(2003, "发布总量已达上限，请先清理旧信息")

    dup = query_one("SELECT id FROM item_record WHERE publisher_id = ? AND title = ? AND deleted = 0 "
                    "AND create_time > datetime('now','localtime','-60 seconds')", (user["id"], data["title"]))
    if dup:
        raise BizError(2011)

    image_service.assert_images_owned(data.pop("images"), user["id"])

    now = now_str()
    expire = dt_to_str(datetime.now() + timedelta(days=settings.item_expire_days)) if data["type"] == 1 else None
    payload = dict(**data, publisher_id=user["id"], status=1, claim_status=0, claim_count=0,
                   view_count=0, favorite_count=0, finish_time=None, expire_time=expire,
                   deleted=0, create_time=now, update_time=now)
    with tx() as conn:
        cols = ", ".join(f'"{k}"' for k in payload)
        marks = ", ".join("?" for _ in payload)
        cur = conn.execute(f'INSERT INTO item_record ({cols}) VALUES ({marks})', list(payload.values()))
        item_id = cur.lastrowid
        log_operation(conn, user["id"], user["nickname"], "item", "PUBLISH", item_id, data["title"],
                      client_ip(request))
    return ok({"id": item_id}, request)


@router.put("/{item_id}")
def update_item(request: Request, item_id: int, body: dict, user: dict = Depends(require_user)):
    row = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    if row["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    body["type"] = row["type"]          # 类型不允许修改
    data = _validate_publish(body, row)
    images = data.pop("images")
    image_service.assert_images_owned(images, user["id"])

    with tx() as conn:
        sets = ", ".join(f'"{k}" = ?' for k in data)
        conn.execute(f'UPDATE item_record SET {sets}, update_time = ? WHERE id = ?',
                     list(data.values()) + [now_str(), item_id])
        # 图片差异更新：先逻辑删除旧的，再写入当前的
        conn.execute("UPDATE item_image SET deleted = 1 WHERE item_id = ?", (item_id,))
        for i, url in enumerate(images):
            thumb = url.replace(".jpg", "_thumb.jpg")
            conn.execute("INSERT INTO item_image (item_id, url, thumb_url, sort, deleted, create_time)"
                         " VALUES (?,?,?,?,0,?)", (item_id, url, thumb, i, now_str()))
        log_operation(conn, user["id"], user["nickname"], "item", "UPDATE", item_id, data["title"],
                      client_ip(request))
    return ok(None, request)


@router.patch("/{item_id}/status")
def change_status(request: Request, item_id: int, body: dict, user: dict = Depends(require_user)):
    target = int(body.get("status") or 0)
    if target not in (1, 2):
        raise BizError(2010)
    row = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    if row["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    if row["status"] == target:
        return ok(None, request)
    payload = {"status": target, "update_time": now_str()}
    if target == 2:
        payload["finish_time"] = now_str()
    else:
        payload["finish_time"] = None
        if row["type"] == 1:
            payload["expire_time"] = dt_to_str(datetime.now() + timedelta(days=settings.item_expire_days))
    update("item_record", payload, "id = ?", (item_id,))
    with tx() as conn:
        log_operation(conn, user["id"], user["nickname"], "item",
                      "OFFLINE" if target == 2 else "ONLINE", item_id, None, client_ip(request))
    return ok(None, request)


@router.delete("/{item_id}")
def delete_item(request: Request, item_id: int, user: dict = Depends(require_user)):
    row = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    if row["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    with tx() as conn:
        conn.execute("UPDATE item_record SET deleted = 1, update_time = ? WHERE id = ?", (now_str(), item_id))
        conn.execute("UPDATE item_image SET deleted = 1 WHERE item_id = ?", (item_id,))
        log_operation(conn, user["id"], user["nickname"], "item", "DELETE", item_id, row["title"],
                      client_ip(request))
    return ok(None, request)


@router.get("/{item_id}/claims")
def item_claims(request: Request, item_id: int, page: int = 1, size: int = 50,
                user: dict = Depends(require_user)):
    """发布人或管理员查看某条失物的认领申请列表"""
    item = query_one("SELECT * FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not item:
        raise BizError(2005)
    if item["publisher_id"] != user["id"] and user["role"] != 2:
        raise BizError(2005)
    from .claims import to_claim_vo
    rows = query_all("""
        SELECT c.*, i.title AS item_title, i.type AS item_type, i.status AS item_status,
               i.deleted AS item_deleted, i.is_anonymous AS item_anonymous,
               cu.nickname AS claimant_name, cu.phone AS claimant_phone, pu.nickname AS publisher_name
        FROM item_claim c JOIN item_record i ON i.id = c.item_id
        LEFT JOIN sys_user cu ON cu.id = c.claimant_id
        LEFT JOIN sys_user pu ON pu.id = c.publisher_id
        WHERE c.item_id = ? AND c.deleted = 0 AND c.status = 1
        ORDER BY c.create_time""", (item_id,))
    items = [to_claim_vo(r, user) for r in rows]
    return ok({"count": len(items), "statusName": f"{len(items)} 人认领中" if items else "暂未认领",
               "list": items}, request)


@router.post("/{item_id}/report")
def report_item(request: Request, item_id: int, body: dict,
                viewer: Optional[dict] = Depends(current_user_optional)):
    reason = (body.get("reason") or "").strip()[:200]
    if len(reason) < 2:
        raise BizError(2001, "请填写举报原因")
    row = query_one("SELECT id, title, publisher_id FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not row:
        raise BizError(2005)
    with tx() as conn:
        log_operation(conn, viewer["id"] if viewer else None,
                      viewer["nickname"] if viewer else "游客", "item", "REPORT", item_id,
                      f"举报原因：{reason}", client_ip(request))
    return ok({"received": True}, request)


# ----------------------------------------------------------------------
# 图片上传
# ----------------------------------------------------------------------
@image_router.post("")
async def upload_image(request: Request, file: UploadFile = File(...),
                       user: dict = Depends(require_user)):
    info = await image_service.save_item_image(file, user["id"])
    return ok(info, request)


@image_router.delete("")
def delete_image(request: Request, body: dict, user: dict = Depends(require_user)):
    image_service.delete_unused_image(body.get("url") or "", user["id"])
    return ok(None, request)


# ----------------------------------------------------------------------
# 收藏
# ----------------------------------------------------------------------
@fav_router.post("")
def favorite(request: Request, body: dict, user: dict = Depends(require_user)):
    item_id = int(body.get("itemId") or 0)
    item = query_one("SELECT id FROM item_record WHERE id = ? AND deleted = 0", (item_id,))
    if not item:
        raise BizError(2005)
    if query_one("SELECT id FROM item_favorite WHERE user_id = ? AND item_id = ?", (user["id"], item_id)):
        return ok(None, request)
    with tx() as conn:
        conn.execute("INSERT INTO item_favorite (user_id, item_id, create_time) VALUES (?,?,?)",
                     (user["id"], item_id, now_str()))
        conn.execute("UPDATE item_record SET favorite_count = favorite_count + 1 WHERE id = ?", (item_id,))
    return ok(None, request)


@fav_router.delete("/{item_id}")
def unfavorite(request: Request, item_id: int, user: dict = Depends(require_user)):
    with tx() as conn:
        cur = conn.execute("DELETE FROM item_favorite WHERE user_id = ? AND item_id = ?",
                           (user["id"], item_id))
        if cur.rowcount:
            conn.execute("UPDATE item_record SET favorite_count = MAX(favorite_count - 1, 0) WHERE id = ?",
                         (item_id,))
    return ok(None, request)


@fav_router.get("")
def my_favorites(request: Request, page: int = 1, size: int = 12, user: dict = Depends(require_user)):
    page = max(1, page)
    size = clamp(size, 1, 50)
    total = scalar("SELECT COUNT(*) FROM item_favorite f JOIN item_record i ON i.id = f.item_id "
                   "WHERE f.user_id = ? AND i.deleted = 0", (user["id"],))
    rows = query_all(f"{BASE_SELECT} JOIN item_favorite f ON f.item_id = i.id "
                     f"WHERE f.user_id = ? AND i.deleted = 0 ORDER BY f.create_time DESC LIMIT ? OFFSET ?",
                     (user["id"], size, (page - 1) * size))
    return ok(page_result([to_list_vo(r, user) for r in rows], total, page, size), request)


@fav_router.get("/check")
def check_favorite(request: Request, itemId: int = Query(...), user: dict = Depends(require_user)):
    row = query_one("SELECT id FROM item_favorite WHERE user_id = ? AND item_id = ?", (user["id"], itemId))
    return ok({"favorited": bool(row)}, request)
