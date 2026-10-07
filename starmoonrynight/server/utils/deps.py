# -*- coding: utf-8 -*-
"""认证依赖：解析令牌、注入当前用户、管理员校验"""
from typing import Optional

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import load_secret, settings
from ..db import now_str, query_one
from .common import BizError
from .jwt_util import decode

bearer = HTTPBearer(auto_error=False)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _load_user(user_id: int) -> Optional[dict]:
    return query_one(
        "SELECT id, username, nickname, phone, wechat, avatar, role, status, create_time "
        "FROM sys_user WHERE id = ? AND deleted = 0", (user_id,))


def current_user_optional(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Optional[dict]:
    """可选登录：未带令牌返回 None，带了但无效则报错"""
    if cred is None or not cred.credentials:
        return None
    payload = decode(cred.credentials, load_secret())
    if not payload or payload.get("typ") != "access":
        raise BizError(1006)
    jti = payload.get("jti")
    blocked = query_one("SELECT jti, expire_at FROM sys_token_block WHERE jti = ?", (jti,))
    if blocked:
        raise BizError(1006)
    user = _load_user(int(payload["sub"]))
    if not user:
        raise BizError(1006)
    if user["status"] != 1:
        raise BizError(1005)
    request.state.user = user
    return user


def require_user(user: Optional[dict] = Depends(current_user_optional)) -> dict:
    if user is None:
        raise BizError(1001)
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != 2:
        raise BizError(1007)
    return user


def block_token(jti: str, exp: int) -> None:
    from ..db import execute
    execute("INSERT OR REPLACE INTO sys_token_block (jti, expire_at, create_time) VALUES (?,?,?)",
            (jti, exp, now_str()))
