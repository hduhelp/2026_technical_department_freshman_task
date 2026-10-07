# -*- coding: utf-8 -*-
"""失物招领系统 · 服务入口
启动： python -m server.main   或   python run.py
"""
import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings, ensure_dirs
from .db import execute, init_db, now_str, query_all, scalar
from .routers import admin, auth, claims, db_admin, items, meta
from .utils.common import BizError, CODE_MESSAGE, HTTP_STATUS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("lostfound")

WEB_DIR = Path(__file__).resolve().parent / "web"


# ----------------------------------------------------------------------
# 定时任务：失物自动过期 + 认领 72 小时超时断开
# ----------------------------------------------------------------------
def maintenance_once() -> dict:
    expired_items = 0
    rows = query_all("SELECT id FROM item_record WHERE type = 1 AND status = 1 AND deleted = 0 "
                     "AND expire_time IS NOT NULL AND expire_time < ? LIMIT 500", (now_str(),))
    for r in rows:
        execute("UPDATE item_record SET status = 2, finish_time = ?, update_time = ? WHERE id = ?",
                (now_str(), now_str(), r["id"]))
        expired_items += 1
    expired_claims = claims.expire_scan()
    return {"expiredItems": expired_items, "expiredClaims": expired_claims}


async def maintenance_loop() -> None:
    while True:
        try:
            result = await asyncio.to_thread(maintenance_once)
            if result["expiredItems"] or result["expiredClaims"]:
                log.info("定时任务：失物过期 %s 条，认领超时断开 %s 条",
                         result["expiredItems"], result["expiredClaims"])
        except Exception as exc:                                  # noqa: BLE001
            log.warning("定时任务执行失败：%s", exc)
        await asyncio.sleep(300)                                   # 每 5 分钟一次


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    init_db(seed=True)
    from .services import seed_images
    seed_images.ensure_placeholder_images()
    log.info("数据库：%s", settings.db_path)
    log.info("上传目录：%s", settings.upload_dir)
    task = asyncio.create_task(maintenance_loop())
    yield
    task.cancel()


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="校园 / 园区失物招领系统 · 正式版 API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

# 允许跨域（同一局域网内用其他端口/域名调试时使用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------
# 中间件：traceId + 访问日志
# ----------------------------------------------------------------------
@app.middleware("http")
async def add_trace(request: Request, call_next):
    request.state.trace_id = uuid.uuid4().hex[:12]
    started = datetime.now()
    response = await call_next(request)
    cost = (datetime.now() - started).total_seconds() * 1000
    response.headers["X-Trace-Id"] = request.state.trace_id
    if request.url.path.startswith("/api") and not request.url.path.startswith("/api/docs"):
        log.info("%s %s -> %s  %.0fms  trace=%s", request.method, request.url.path,
                 response.status_code, cost, request.state.trace_id)
    return response


# ----------------------------------------------------------------------
# 异常处理：统一响应体
# ----------------------------------------------------------------------
@app.exception_handler(BizError)
async def biz_error_handler(request: Request, exc: BizError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.biz_message, "data": exc.detail,
                 "traceId": getattr(request.state, "trace_id", "")})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    err = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(x) for x in err.get("loc", [])[1:]) or "参数"
    return JSONResponse(
        status_code=200,
        content={"code": 2001, "message": f"{field} {err.get('msg', '格式不正确')}", "data": None,
                 "traceId": getattr(request.state, "trace_id", "")})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith("/api"):
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": 5000 if exc.status_code >= 500 else 2005,
                     "message": str(exc.detail), "data": None,
                     "traceId": getattr(request.state, "trace_id", "")})
    # 非 API 路径：回退到前端页面（支持前端路由）
    index = WEB_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse(status_code=exc.status_code, content={"message": str(exc.detail)})


@app.exception_handler(Exception)
async def unknown_handler(request: Request, exc: Exception):
    log.exception("未处理异常 trace=%s", getattr(request.state, "trace_id", ""))
    return JSONResponse(
        status_code=500,
        content={"code": 5000, "message": CODE_MESSAGE[5000], "data": None,
                 "traceId": getattr(request.state, "trace_id", "")})


# ----------------------------------------------------------------------
# 路由
# ----------------------------------------------------------------------
app.include_router(auth.router, prefix="/api/v1")
app.include_router(auth.user_router, prefix="/api/v1")
app.include_router(items.router, prefix="/api/v1")
app.include_router(items.image_router, prefix="/api/v1")
app.include_router(items.fav_router, prefix="/api/v1")
app.include_router(claims.router, prefix="/api/v1")
app.include_router(meta.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(db_admin.router, prefix="/api/v1")


@app.get("/api/health")
def health():
    return {
        "code": 0, "message": "success",
        "data": {
            "app": settings.app_name, "version": settings.version,
            "time": now_str(),
            "db": str(settings.db_path),
            "counts": {
                "users": scalar("SELECT COUNT(*) FROM sys_user WHERE deleted = 0"),
                "items": scalar("SELECT COUNT(*) FROM item_record WHERE deleted = 0"),
                "claims": scalar("SELECT COUNT(*) FROM item_claim WHERE deleted = 0"),
            },
        },
        "traceId": "",
    }


# ----------------------------------------------------------------------
# 静态资源与前端页面
# ----------------------------------------------------------------------
ensure_dirs()
app.mount("/uploads", StaticFiles(directory=str(settings.upload_dir)), name="uploads")

if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(WEB_DIR / "static")), name="static")

    @app.get("/", include_in_schema=False)
    def index_page():
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/{page}.html", include_in_schema=False)
    def html_page(page: str):
        target = WEB_DIR / f"{page}.html"
        if target.exists():
            return FileResponse(target)
        return FileResponse(WEB_DIR / "index.html")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        ico = WEB_DIR / "static" / "favicon.ico"
        if ico.exists():
            return FileResponse(ico)
        return JSONResponse(status_code=204, content=None)


def main() -> None:
    import uvicorn
    log.info("=" * 66)
    log.info("%s v%s 启动中 …", settings.app_name, settings.version)
    log.info("本机访问：   http://127.0.0.1:%s", settings.port)
    for ip in _local_ips():
        log.info("局域网访问： http://%s:%s", ip, settings.port)
    log.info("接口文档：   http://127.0.0.1:%s/api/docs", settings.port)
    log.info("=" * 66)
    uvicorn.run("server.main:app", host=settings.host, port=settings.port,
                reload=settings.debug, log_level="info")


def _local_ips() -> list[str]:
    import socket
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
            s.close()
        except OSError:
            pass
    return ips


if __name__ == "__main__":
    main()
