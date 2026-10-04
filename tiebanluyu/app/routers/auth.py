"""
认证接口：注册、登录、获取当前用户、修改资料、退出登录。

对应任务的「基础要求 1：用户注册和登录」。

关于 token 怎么给前端，本项目做了双重支持：
  1. 写进 HttpOnly Cookie —— 浏览器自动携带，且 JavaScript 读不到，能防 XSS 窃取
  2. 同时在响应体里返回    —— 方便用 /docs、Apifox、curl 手动调接口
"""

from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, HTTPException, Request, Response, status

from .. import config, schemas, security
from ..database import get_db, transaction, utc_to_iso
from ..deps import CurrentUser, get_user_by_username

router = APIRouter(prefix="/api/auth", tags=["认证"])


# ------------------------------------------------------------------ 内部工具


def _row_to_user_public(row: sqlite3.Row) -> schemas.UserPublic:
    """把数据库行转换成对外返回的用户信息（顺带挡住 password_hash）。"""
    return schemas.UserPublic(
        id=row["id"],
        username=row["username"],
        display_name=row["display_name"] or row["username"],
        contact=row["contact"] or "",
        avatar=row["avatar"] or "",
        # 数据库存的是 UTC，这里补上 Z 标记，前端才能正确换算成本地时间
        created_at=utc_to_iso(row["created_at"]),
    )


def _set_auth_cookie(response: Response, token: str) -> None:
    """把 token 写进 HttpOnly Cookie。

    各参数的含义（这几个正是 Cookie 安全的核心）：
      httponly=True   JavaScript 无法读取，XSS 攻击偷不走 token
      samesite="lax"  跨站请求不携带，缓解 CSRF 攻击
      secure=...      只在 HTTPS 下发送；本地 http 开发必须为 False
      max_age=...     过期时间，与 token 自身的 exp 保持一致
      path="/"        整个站点都携带
    """
    response.set_cookie(
        key=config.COOKIE_NAME,
        value=token,
        max_age=config.ACCESS_TOKEN_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    """清掉 Cookie。属性必须与设置时一致，否则浏览器不会真正删除它。"""
    response.delete_cookie(
        key=config.COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


# 用于「用户不存在」时消耗等量 CPU 的假哈希，抵御时序探测攻击。
# 参数与 security.hash_password 一致，所以耗时接近。
_DUMMY_HASH = security.hash_password("dummy-password-for-timing-defense")


# ------------------------------------------------------------------ 注册


@router.post(
    "/register",
    response_model=schemas.TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="用户注册",
    description=(
        "创建一个新账号。\n\n"
        "- 注册成功后**直接自动登录**（返回 token 并写入 Cookie），"
        "不需要再手动登录一次，这是更好的体验。\n"
        "- 用户名支持中文、字母、数字（如「小明」「王老师」「wanglaoshi」），"
        "不区分大小写，统一按小写存储。\n"
        "- 用户名重复时返回 409。"
    ),
)
def register(payload: schemas.UserRegister, response: Response):
    # 用户名转小写（对中文调用 lower() 无副作用）已经在
    # schemas.UserRegister 的校验器里做过，这里直接用，
    # 不再重复处理，避免两处规则不一致。
    username = payload.username

    # 【安全要点】这里把明文密码交给 hash_password 做 scrypt 哈希。
    # 不存明文，也不存可逆的加密结果，只存"无法反推"的指纹。
    password_hash = security.hash_password(payload.password)

    try:
        with transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, contact)
                VALUES (?, ?, ?, ?)
                """,
                (
                    username,
                    password_hash,
                    payload.display_name or payload.username,
                    payload.contact,
                ),
            )
            user_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError as exc:
        # 数据库的 UNIQUE 约束在这里兜底。
        # 即使并发情况下有两条请求同时通过了检查，数据库也不会产生重复账号。
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "username_taken", "message": "该用户名已被注册，请换一个"},
        ) from exc

    # 注册后自动登录，签发 token
    token, _jti, expires_at = security.create_access_token(user_id)
    _set_auth_cookie(response, token)

    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    return schemas.TokenResponse(
        access_token=token,
        expires_in=expires_at - int(time.time()),
        user=_row_to_user_public(row),
    )


# ------------------------------------------------------------------ 登录


@router.post(
    "/login",
    response_model=schemas.TokenResponse,
    summary="用户登录",
    description=(
        "用用户名和密码换取 token。\n\n"
        "**安全设计**：无论「用户名不存在」还是「密码错误」，"
        "返回的提示都是同一句《用户名或密码错误》。\n"
        "如果分开提示，攻击者就能靠它枚举出系统里到底有哪些用户名。"
    ),
)
def login(payload: schemas.UserLogin, response: Response):
    with get_db() as conn:
        user = get_user_by_username(conn, payload.username)

    if user is None:
        # 即使查不到用户，也执行一次同等耗时的哈希运算。
        # 否则「用户不存在」会立刻返回，攻击者靠测量响应时间就能判断用户名是否存在。
        security.verify_password(payload.password, _DUMMY_HASH)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "用户名或密码错误"},
        )

    if not security.verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "用户名或密码错误"},
        )

    token, _jti, expires_at = security.create_access_token(user["id"])
    _set_auth_cookie(response, token)

    return schemas.TokenResponse(
        access_token=token,
        expires_in=expires_at - int(time.time()),
        user=_row_to_user_public(user),
    )


# ------------------------------------------------------------------ 当前用户


@router.get(
    "/me",
    response_model=schemas.UserPublic,
    summary="获取当前用户信息",
    description=(
        "返回 token 对应的用户信息。\n\n"
        "这个接口是前端「判断用户有没有登录」的标准做法："
        "页面加载时调一次，成功就进主页，返回 401 就跳转到登录页。"
    ),
)
def get_me(user: CurrentUser):
    return _row_to_user_public(user)


@router.patch(
    "/me",
    response_model=schemas.UserPublic,
    summary="修改当前用户资料",
    description="只更新请求体里传了的字段，没传的保持原样。",
)
def update_me(payload: schemas.UserProfileUpdate, user: CurrentUser):
    # exclude_unset=True：只取前端明确传了的字段，
    # 这样「显式传了空字符串」和「根本没传这个字段」能被区分开。
    provided = payload.model_dump(exclude_unset=True)

    # 列名白名单：只允许更新这三列。
    # 【安全要点】为什么可以拼接字符串进 SQL？因为列名来自这里写死的白名单，
    # 不是用户输入；而列的值仍然用 ? 占位符传递。两者共同保证不会 SQL 注入。
    allowed_columns = ("display_name", "contact", "avatar")
    columns = [c for c in provided if c in allowed_columns]

    if columns:
        set_clause = ", ".join(f"{c} = ?" for c in columns)
        values: list[object] = [provided[c] for c in columns]
        values.append(user["id"])

        with transaction() as conn:
            conn.execute(
                f"UPDATE users SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
                values,
            )

    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()

    return _row_to_user_public(row)


# ------------------------------------------------------------------ 退出登录


@router.post(
    "/logout",
    response_model=schemas.MessageResponse,
    summary="用户退出登录",
    description=(
        "退出登录必须做两件事：\n\n"
        "1. **清掉浏览器的 Cookie**，否则下次请求还会带着旧 token；\n"
        "2. **把 token 编号写入黑名单**（`user_sessions` 表）。\n\n"
        "第 2 步是很多人会漏掉的：JWT 是无状态的，服务器默认无法让它提前失效。"
        "如果只清 Cookie，那个 token 在自然过期前仍然有效 —— "
        "万一已被别人复制走，退出登录并不能阻止他继续使用。"
    ),
)
def logout(user: CurrentUser, request: Request, response: Response):
    # deps.py 在鉴权时把 token 载荷挂在了 request.state 上，这里取出来
    payload = getattr(request.state, "token_payload", None)

    if payload:
        # 把这个 token 的编号记入黑名单，之后再用它就是 401
        security.revoke_token(
            jti=payload["jti"],
            user_id=user["id"],
            expires_at=payload["exp"],
        )

    _clear_auth_cookie(response)
    return schemas.MessageResponse(message="已退出登录", detail="登录凭证已失效，请重新登录")
