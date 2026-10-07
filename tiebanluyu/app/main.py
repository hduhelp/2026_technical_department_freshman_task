"""
应用入口。

启动方式（在 lost-and-found 目录下执行）：
    python -m uvicorn app.main:app --reload --port 8000

然后打开：
    http://127.0.0.1:8000/docs    ← 交互式接口文档，可以直接点按钮调接口
    http://127.0.0.1:8000/redoc   ← 另一种风格的文档
    http://127.0.0.1:8000/health  ← 健康检查
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, database, security
from .routers import auth, items

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("lost_and_found")


# ------------------------------------------------------------------ 生命周期


@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动 / 关闭时执行的钩子。

    lifespan 是 FastAPI 现在推荐的方式（旧的 @app.on_event("startup") 已废弃）。
    这里在启动时自动建表，好处是新人克隆代码后不需要手动执行任何建库命令。
    """
    logger.info("正在初始化数据库：%s", config.DB_PATH)
    database.init_db()

    purged = security.purge_expired_sessions()
    if purged:
        logger.info("已清理 %d 条过期登录记录", purged)

    logger.info("%s v%s 启动完成", config.APP_NAME, config.APP_VERSION)
    yield
    logger.info("服务已关闭")


# ------------------------------------------------------------------ 应用实例

app = FastAPI(
    title=config.APP_NAME,
    version=config.APP_VERSION,
    description=(
        "杭电校园失物招领平台后端接口。\n\n"
        "## 主要功能\n"
        "- **认证**：注册、登录、获取当前用户、退出登录\n"
        "- **失物/招领**：发布、浏览、搜索、修改、删除、状态流转\n\n"
        "## 怎么快速试一下\n"
        "1. 调 `POST /api/auth/register` 注册一个账号（会自动登录）\n"
        "2. 调 `GET /api/auth/me` 确认已经识别出身份\n"
        "3. 调 `POST /api/items` 发布一条失物信息\n"
        "4. 调 `GET /api/items` 查看列表\n\n"
        "浏览器会自动带上登录 Cookie，所以第 3、4 步不需要手动填 token。"
    ),
    lifespan=lifespan,
)


# ------------------------------------------------------------------ 中间件

# 因为前端最终由本服务自己托管（同源），正常情况下不需要跨域。
# 这里保留配置是为了支持「前端单独用 Vite 跑在另一个端口」的开发方式。
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,  # 允许携带 Cookie，这一项为 True 时 allow_origins 不能用 "*"
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ 统一错误格式


@app.exception_handler(security.AuthError)
async def auth_error_handler(request: Request, exc: security.AuthError) -> JSONResponse:
    """把认证异常统一转成 401，并带上 WWW-Authenticate 头。

    带上 WWW-Authenticate 是 HTTP 规范要求，
    有些前端库（如 axios）会依赖它来判断「需要跳转登录页」。
    """
    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"error": True, "code": exc.code, "message": exc.message},
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """统一 HTTP 错误的返回格式。

    好处：前端只需要处理一种错误结构
        { "error": true, "code": "...", "message": "..." }
    而不是到处判断 detail 是字符串还是对象。
    """
    detail = exc.detail

    if isinstance(detail, dict):
        code = detail.get("code", f"http_{exc.status_code}")
        message = detail.get("message", "请求失败")
        extra = {k: v for k, v in detail.items() if k not in {"code", "message"}}
    else:
        code = f"http_{exc.status_code}"
        message = str(detail)
        extra = {}

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "code": code, "message": message, **extra},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """参数校验失败时返回 422，并说明是哪个字段错了。

    默认的错误信息是英文且嵌套很深，这里压平成人类可读的中文提示，
    前端可以直接弹出来给用户看。
    """
    # Pydantic v2 会在自定义校验器的错误信息前自动加上 "Value error, " 前缀，
    # 例如 "Value error, 密码至少需要 8 位"。这个前缀对用户没有意义，
    # 直接展示会显得很粗糙，所以在这里统一去掉。
    noise_prefixes = ("Value error, ", "Assertion failed, ")

    def clean(text: str) -> str:
        message = str(text)
        for prefix in noise_prefixes:
            if message.startswith(prefix):
                message = message[len(prefix) :]
        return message

    problems = []
    for error in exc.errors():
        # loc 形如 ("body", "password")，取出字段路径
        location = " → ".join(str(part) for part in error.get("loc", ()) if part != "body")
        problems.append(
            {
                "field": location or "(请求体)",
                "reason": clean(error.get("msg", "格式不正确")),
            }
        )

    first = problems[0] if problems else None
    message = f"参数校验失败：{first['field']} {first['reason']}" if first else "参数校验失败"

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": True,
            "code": "validation_error",
            "message": message,
            "problems": problems,
        },
    )


@app.exception_handler(sqlite3.Error)
async def database_error_handler(request: Request, exc: sqlite3.Error) -> JSONResponse:
    """数据库异常兜底。

    不把原始错误信息返回给前端 —— 那可能暴露表名、列名等内部结构。
    详细信息只记录在服务器日志里，方便开发者排查。
    """
    logger.exception("数据库异常：%s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": True,
            "code": "database_error",
            "message": "服务器内部错误，请稍后重试",
        },
    )


# ------------------------------------------------------------------ 路由注册

app.include_router(auth.router)
app.include_router(items.router)
app.include_router(items.uploads_router)

# ------------------------------------------------------------------ 用户上传的图片

# /uploads/<文件名> —— 让前端可以直接用 <img src="/uploads/xxx.png"> 展示
config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(config.UPLOAD_DIR)), name="uploads")


# ------------------------------------------------------------------ 基础接口


@app.get("/health", tags=["系统"], summary="健康检查", description="用于确认服务是否正常运行。")
def health_check():
    return {
        "status": "ok",
        "app": config.APP_NAME,
        "version": config.APP_VERSION,
        "database": str(config.DB_PATH.name),
    }


# ------------------------------------------------------------------ 前端页面

# 【顺序说明 —— 这里踩过坑】
# 把 static/ 挂到根路径 "/"，它会接管所有没被前面匹配到的请求，
# 因此**必须放在文件最末尾注册**。
#
# 我第一版把它放在了 include_router 之后、/health 之前，结果是：
#   /api/items  → 正常（因为 API 路由注册在它前面，先被匹配到）
#   /health     → 404（因为它注册在 mount 之后，请求先被静态处理器接走去找文件）
#
# 而根路径 "/" 原来返回的是 JSON 格式的接口说明，现在由静态目录的
# index.html 提供前端页面 —— 对使用者来说这是更好的默认行为。
# API 文档仍然可以通过 /docs 和 /redoc 访问，/health 也保留用于健康检查。
if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="static")
