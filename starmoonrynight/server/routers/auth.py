# -*- coding: utf-8 -*-
"""认证与账号模块：注册 / 登录 / 刷新 / 登出 / 资料 / 改密 / 头像"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Request, UploadFile

from ..config import load_secret, settings
from ..db import (dt_to_str, execute, hash_password, insert, log_login, log_operation,
                  now_str, query_one, update, verify_password, tx)
from ..utils.common import BizError, check_password_strength, check_phone, check_username, mask_phone, ok
from ..utils.deps import block_token, client_ip, require_user
from ..utils.jwt_util import decode, make_tokens
from ..services.image_service import save_avatar

router = APIRouter(prefix="/auth", tags=["认证"])
user_router = APIRouter(prefix="/users", tags=["用户"])


# ----------------------------------------------------------------------
# 登录风控
# ----------------------------------------------------------------------
def _check_lock(account: str) -> None:
    row = query_one("SELECT * FROM sys_login_fail WHERE account = ?", (account,))
    if not row or not row.get("lock_until"):
        return
    until = row["lock_until"]
    if until > now_str():
        raise BizError(1004, f"账号已锁定，请于 {until[11:16]} 后重试")


def _record_fail(account: str) -> None:
    row = query_one("SELECT * FROM sys_login_fail WHERE account = ?", (account,))
    limit = settings.login_fail_limit
    if not row:
        execute("INSERT INTO sys_login_fail (account, fail_count, first_fail_at, lock_until) VALUES (?,?,?,?)",
                (account, 1, now_str(), None))
        return
    count = row["fail_count"] + 1
    lock_until = None
    if count >= limit:
        lock_until = dt_to_str(datetime.now() + timedelta(minutes=settings.login_lock_minutes))
        count = 0
    execute("UPDATE sys_login_fail SET fail_count = ?, lock_until = ? WHERE account = ?",
            (count, lock_until, account))


def _clear_fail(account: str) -> None:
    execute("DELETE FROM sys_login_fail WHERE account = ?", (account,))


def _tokens_for(user: dict) -> dict:
    return make_tokens(user["id"], user["role"], user["nickname"], load_secret(),
                       settings.access_token_minutes, settings.refresh_token_days)


def _public_user(user: dict, logged: bool = True) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "nickname": user["nickname"],
        "phone": user["phone"] if logged else mask_phone(user["phone"]),
        "wechat": user.get("wechat"),
        "avatar": user.get("avatar"),
        "role": user["role"],
        "createTime": user.get("create_time"),
    }


# ----------------------------------------------------------------------
# 注册 / 登录 / 刷新 / 登出
# ----------------------------------------------------------------------
@router.post("/register")
def register(request: Request, body: dict):
    username = (body.get("username") or "").strip()
    nickname = (body.get("nickname") or "").strip()
    phone = (body.get("phone") or "").strip()
    password = body.get("password") or ""
    confirm = body.get("confirmPassword") or ""

    check_username(username)
    check_phone(phone)
    check_password_strength(password)
    if password != confirm:
        raise BizError(1010)
    if not (2 <= len(nickname) <= 20):
        raise BizError(2001, "昵称需为 2-20 个字符")
    if query_one("SELECT id FROM sys_user WHERE username = ? AND deleted = 0", (username,)):
        raise BizError(1002)
    if query_one("SELECT id FROM sys_user WHERE phone = ? AND deleted = 0", (phone,)):
        raise BizError(1003)

    now = now_str()
    user_id = insert("sys_user", dict(
        username=username, password_hash=hash_password(password), nickname=nickname, phone=phone,
        wechat=None, avatar=None, role=1, status=1, last_login_time=now, last_login_ip=client_ip(request),
        deleted=0, create_time=now, update_time=now))
    with tx() as conn:
        log_login(conn, user_id, username, 1, None, client_ip(request), request.headers.get("user-agent"))
    user = query_one("SELECT * FROM sys_user WHERE id = ?", (user_id,))
    return ok({"userId": user_id, **_tokens_for(user), "user": _public_user(user)}, request)


@router.post("/login")
def login(request: Request, body: dict):
    account = (body.get("account") or "").strip()
    password = body.get("password") or ""
    if not account or not password:
        raise BizError(2001, "请输入账号和密码")

    _check_lock(account)
    user = query_one("SELECT * FROM sys_user WHERE (username = ? OR phone = ?) AND deleted = 0",
                     (account, account))
    ip = client_ip(request)
    ua = request.headers.get("user-agent")
    if not user or not verify_password(password, user["password_hash"]):
        _record_fail(account)
        with tx() as conn:
            log_login(conn, user["id"] if user else None, account, 0,
                      "密码错误" if user else "账号不存在", ip, ua)
        raise BizError(2001, "账号或密码错误")
    if user["status"] != 1:
        with tx() as conn:
            log_login(conn, user["id"], account, 0, "账号禁用", ip, ua)
        raise BizError(1005)

    _clear_fail(account)
    execute("UPDATE sys_user SET last_login_time = ?, last_login_ip = ? WHERE id = ?",
            (now_str(), ip, user["id"]))
    with tx() as conn:
        log_login(conn, user["id"], account, 1, None, ip, ua)
    return ok({**_tokens_for(user), "user": _public_user(user)}, request)


@router.post("/refresh")
def refresh(request: Request, body: dict):
    token = body.get("refreshToken") or ""
    payload = decode(token, load_secret())
    if not payload or payload.get("typ") != "refresh":
        raise BizError(1006)
    user = query_one("SELECT * FROM sys_user WHERE id = ? AND deleted = 0", (int(payload["sub"]),))
    if not user or user["status"] != 1:
        raise BizError(1005)
    tokens = _tokens_for(user)
    return ok({"accessToken": tokens["accessToken"], "expiresIn": tokens["expiresIn"]}, request)


@router.post("/logout")
def logout(request: Request, user: dict = Depends(require_user)):
    auth = request.headers.get("authorization", "")
    token = auth.replace("Bearer", "").strip()
    payload = decode(token, load_secret()) or {}
    if payload.get("jti"):
        block_token(payload["jti"], int(payload.get("exp", 0)))
    return ok(None, request)


# ----------------------------------------------------------------------
# 个人资料
# ----------------------------------------------------------------------
@user_router.get("/me")
def me(request: Request, user: dict = Depends(require_user)):
    rows = query_one("SELECT COUNT(*) AS c FROM item_record WHERE publisher_id = ? AND deleted = 0",
                     (user["id"],)) or {"c": 0}
    data = _public_user(user)
    data["itemCount"] = rows["c"]
    data["unreadMessages"] = query_one(
        "SELECT COUNT(*) AS c FROM claim_message WHERE receiver_id = ? AND read_flag = 0",
        (user["id"],))["c"]
    return ok(data, request)


@user_router.put("/me")
def update_me(request: Request, body: dict, user: dict = Depends(require_user)):
    nickname = (body.get("nickname") or "").strip()
    wechat = (body.get("wechat") or "").strip() or None
    if not (2 <= len(nickname) <= 20):
        raise BizError(2001, "昵称需为 2-20 个字符")
    if wechat and not (2 <= len(wechat) <= 30):
        raise BizError(2001, "微信号需为 2-30 个字符")
    update("sys_user", dict(nickname=nickname, wechat=wechat, update_time=now_str()),
           "id = ?", (user["id"],))
    return ok(None, request)


@user_router.patch("/me/password")
def change_password(request: Request, body: dict, user: dict = Depends(require_user)):
    old = body.get("oldPassword") or ""
    new = body.get("newPassword") or ""
    confirm = body.get("confirmPassword") or ""
    row = query_one("SELECT password_hash FROM sys_user WHERE id = ?", (user["id"],))
    if not verify_password(old, row["password_hash"]):
        raise BizError(1008)
    check_password_strength(new)
    if new != confirm:
        raise BizError(1010)
    update("sys_user", dict(password_hash=hash_password(new), update_time=now_str()),
           "id = ?", (user["id"],))
    execute("DELETE FROM sys_token_block")            # 简化处理：改密后全部令牌失效
    with tx() as conn:
        log_operation(conn, user["id"], user["nickname"], "user", "CHANGE_PASSWORD",
                      user["id"], None, client_ip(request))
    return ok(None, request)


@user_router.post("/me/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...),
                        user: dict = Depends(require_user)):
    url = await save_avatar(file)
    update("sys_user", dict(avatar=url, update_time=now_str()), "id = ?", (user["id"],))
    return ok({"url": url}, request)
