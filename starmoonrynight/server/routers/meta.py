# -*- coding: utf-8 -*-
"""公共字典：分类、地点（按区域分组）、站点信息"""
from typing import Optional

from fastapi import APIRouter, Depends, Request

from ..config import settings
from ..db import query_all
from ..utils.common import ok
from ..utils.deps import current_user_optional

router = APIRouter(tags=["公共字典"])

AREA_NAME = {1: "校内", 2: "校外"}


@router.get("/categories")
def categories(request: Request):
    rows = query_all("SELECT id, name, icon, sort FROM category WHERE deleted = 0 AND status = 1 "
                     "ORDER BY sort, id")
    return ok({"list": rows, "total": len(rows)}, request)


@router.get("/locations/tree")
def locations(request: Request, areaType: Optional[int] = None):
    """按区域（校内 / 校外）分组返回地点列表"""
    sql = "SELECT id, area_type, name, sort FROM location WHERE deleted = 0 AND status = 1"
    args: list = []
    if areaType:
        sql += " AND area_type = ?"
        args.append(areaType)
    sql += " ORDER BY area_type, sort, id"
    rows = query_all(sql, args)
    tree: dict = {"campus": [], "outside": []}
    for r in rows:
        key = "campus" if r["area_type"] == 1 else "outside"
        tree[key].append({"id": r["id"], "name": r["name"], "areaType": r["area_type"],
                          "areaName": AREA_NAME.get(r["area_type"], "")})
    return ok({"campus": tree["campus"], "outside": tree["outside"],
               "list": tree["campus"] + tree["outside"]}, request)


@router.get("/site/config")
def site_config(request: Request, viewer: Optional[dict] = Depends(current_user_optional)):
    """前端启动时读取：站点配置、演示账号提示、是否允许匿名等"""
    from ..db import scalar
    return ok({
        "appName": settings.app_name,
        "version": settings.version,
        "allowAnonymous": settings.allow_anonymous,
        "claimTimeoutHours": settings.claim_timeout_hours,
        "claimMaxActive": settings.claim_max_active,
        "itemExpireDays": settings.item_expire_days,
        "imageMaxCount": settings.image_max_count,
        "imageMaxMb": settings.image_max_bytes // 1024 // 1024,
        "publishIntervalSeconds": settings.publish_interval_seconds,
        "publishDailyLimit": settings.publish_daily_limit,
        "logged": viewer is not None,
        "stats": {
            "itemTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0"),
            "activeTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND status = 1"),
            "finishedTotal": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0 AND status = 2"),
            "userTotal": scalar("SELECT COUNT(*) FROM sys_user WHERE deleted = 0"),
        },
    }, request)
