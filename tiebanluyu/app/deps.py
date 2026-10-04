"""
依赖注入（Dependency Injection）层。

这个文件回答题目里那个关键问题：
    "用户登录之后，系统怎么知道'现在操作的人是谁'？"

答案的实现就在这里 —— FastAPI 的依赖机制。
任何接口只要在函数参数里写上 `user: CurrentUser`，
框架就会在进入函数之前自动执行 get_current_user()：
    1. 从请求里取出 token
    2. 验签 + 查过期 + 查黑名单
    3. 用 token 里的用户 id 查出用户
    4. 把用户对象塞进 user 参数
取不到就直接返回 401，业务函数根本不会被调用。

好处：认证逻辑只写一遍，所有需要登录的接口复用，
不会出现"某个接口忘了检查登录"的漏洞。
"""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import Depends, Request

from . import config, security
from .database import get_db


def get_bearer_token(request: Request) -> str | None:
    """从请求中提取 token。

    支持两种携带方式，优先级：Authorization 头 > Cookie。
      · Authorization: Bearer <token>   —— 方便用 /docs、Apifox、curl 调试
      · Cookie: lf_token=<token>        —— 浏览器自动携带，前端无需写代码
    """
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token

    cookie_token = request.cookies.get(config.COOKIE_NAME)
    return cookie_token or None


def get_user_by_id(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    """按主键查用户。"""
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_username(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    """按用户名查用户。

    注意：用户名在注册时已统一转小写存储，所以这里也转小写再查，
    保证 Tom 和 tom 被认为是同一个账号。
    """
    return conn.execute(
        "SELECT * FROM users WHERE username = ?",
        (username.strip().lower(),),
    ).fetchone()


async def get_current_user(request: Request) -> sqlite3.Row:
    """【核心】取出当前登录用户。未登录或凭证无效时抛 401。

    这里用 async def，因为 FastAPI 对 async 依赖和 def 依赖的处理方式不同：
    async 依赖在事件循环中直接执行，异常能更准确地冒泡到中间件。
    """
    token = get_bearer_token(request)
    if not token:
        raise security.AuthError("请先登录", "not_authenticated")

    # 第 1~3 步：验签、查过期、解析出用户 id 和 token 编号
    payload = security.decode_access_token(token)

    # 第 4 步：查黑名单。JWT 是无状态的，服务器本来无法主动注销 token，
    # 靠这张表实现"退出登录后立刻失效"。
    if security.is_token_revoked(payload["jti"]):
        raise security.AuthError("登录状态已失效，请重新登录", "token_revoked")

    # 第 5 步：确认用户还存在（可能已被删除）
    with get_db() as conn:
        user = get_user_by_id(conn, int(payload["sub"]))

    if user is None:
        raise security.AuthError("用户不存在或已被删除", "user_not_found")

    # 把 token 载荷挂在 request.state 上，退出登录时需要用里面的 jti 和 exp
    request.state.token_payload = payload
    return user


async def get_optional_user(request: Request) -> sqlite3.Row | None:
    """可选登录：登录了就返回用户，没登录返回 None，不抛错。

    用途：列表和详情接口允许游客浏览，但登录用户需要额外知道
    "这条信息是不是我自己发的"（用于前端显示编辑/删除按钮）。
    """
    if not get_bearer_token(request):
        return None
    try:
        return await get_current_user(request)
    except security.AuthError:
        # 凭证无效时按游客处理，而不是报错，保证浏览体验不中断
        return None


# 类型别名：让接口签名更简洁易读
CurrentUser = Annotated[sqlite3.Row, Depends(get_current_user)]
OptionalUser = Annotated[sqlite3.Row | None, Depends(get_optional_user)]
