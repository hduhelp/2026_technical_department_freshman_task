"""
全局配置。

设计说明
--------
这里刻意只依赖 Python 标准库 os，不引入 pydantic-settings / python-dotenv。
原因：本项目要求"零新依赖安装"，任何配置都能用环境变量覆盖。

怎么改配置？
    PowerShell:  $env:LF_SECRET_KEY = "你自己的密钥"; python -m uvicorn app.main:app
    CMD:         set LF_SECRET_KEY=你自己的密钥
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------- 路径

# __file__ 是 app/config.py，向上两级就是项目根目录 lost-and-found/
BASE_DIR = Path(__file__).resolve().parent.parent

# 数据库文件放在 data/ 目录下，便于 .gitignore 整体忽略
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / os.getenv("LF_DB_FILE", "lost_and_found.db")

# 用户上传的图片存放目录，通过 /uploads/<文件名> 对外访问
UPLOAD_DIR = BASE_DIR / "uploads"

# 静态前端页面目录（阶段三）
STATIC_DIR = BASE_DIR / "static"

# ---------------------------------------------------------------- 服务信息

APP_NAME = "杭电失物招领系统"
APP_VERSION = "0.1.0"

# ---------------------------------------------------------------- 安全相关

# 【重要】这是给 JWT 签名用的密钥。生产环境必须换成随机长字符串！
# 生成方式：python -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY = os.getenv("LF_SECRET_KEY", "dev-only-insecure-secret-change-me")

# JWT 签名算法。只用 HMAC 系列，避免出现 "alg=none" 这类经典安全漏洞
JWT_ALGORITHM = "HS256"

# 登录凭证（token）有效期：7 天
ACCESS_TOKEN_EXPIRE_DAYS = int(os.getenv("LF_TOKEN_EXPIRE_DAYS", "7"))

# Cookie 名字：浏览器里存 token 用的键名
COOKIE_NAME = "lf_token"

# 是否只在 HTTPS 下发送 Cookie。
# 本地开发是 http://127.0.0.1，所以默认 False；
# 部署到线上（有 https）时应设为 True，防止 token 被明文传输窃取。
COOKIE_SECURE = os.getenv("LF_COOKIE_SECURE", "false").lower() == "true"

# 允许跨域的前端地址。因为前端最终由本服务自己托管，默认同源即可。
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "LF_CORS_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000",
    ).split(",")
    if o.strip()
]
