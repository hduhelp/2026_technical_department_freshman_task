# -*- coding: utf-8 -*-
"""失物招领系统 · 全局配置（全部支持环境变量覆盖）"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent          # server/
PROJECT_DIR = BASE_DIR.parent                       # 项目根目录


def _env(key: str, default: str) -> str:
    v = os.environ.get(key)
    return v if v not in (None, "") else default


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env(key, str(default)))
    except ValueError:
        return default


class Settings:
    # ---------- 服务 ----------
    app_name = "失物招领系统"
    version = "1.0.0"
    host = _env("LF_HOST", "0.0.0.0")               # 0.0.0.0 = 允许局域网/互联网访问
    port = _env_int("LF_PORT", 8000)
    debug = _env("LF_DEBUG", "0") == "1"

    # ---------- 数据库 ----------
    data_dir = Path(_env("LF_DATA_DIR", str(BASE_DIR / "data")))
    db_path = Path(_env("LF_DB_PATH", str(data_dir / "lostfound.db")))
    upload_dir = Path(_env("LF_UPLOAD_DIR", str(data_dir / "uploads")))
    backup_dir = Path(_env("LF_BACKUP_DIR", str(data_dir / "backup")))

    # ---------- 安全 ----------
    secret_key = _env("LF_SECRET_KEY", "")          # 留空则首次启动自动生成并写入 data/secret.key
    access_token_minutes = _env_int("LF_ACCESS_MINUTES", 120)
    refresh_token_days = _env_int("LF_REFRESH_DAYS", 7)
    login_fail_limit = _env_int("LF_LOGIN_FAIL_LIMIT", 5)
    login_lock_minutes = _env_int("LF_LOGIN_LOCK_MINUTES", 15)

    # ---------- 业务规则 ----------
    claim_timeout_hours = _env_int("LF_CLAIM_TIMEOUT_HOURS", 72)
    claim_max_active = _env_int("LF_CLAIM_MAX_ACTIVE", 5)
    item_expire_days = _env_int("LF_ITEM_EXPIRE_DAYS", 30)
    publish_interval_seconds = _env_int("LF_PUBLISH_INTERVAL", 60)
    publish_daily_limit = _env_int("LF_PUBLISH_DAILY", 10)
    publish_total_limit = _env_int("LF_PUBLISH_TOTAL", 100)
    image_max_count = _env_int("LF_IMAGE_MAX_COUNT", 6)
    image_max_bytes = _env_int("LF_IMAGE_MAX_BYTES", 5 * 1024 * 1024)
    image_max_side = _env_int("LF_IMAGE_MAX_SIDE", 1600)
    thumb_max_side = _env_int("LF_THUMB_MAX_SIDE", 300)
    allow_anonymous = _env("LF_ALLOW_ANONYMOUS", "1") == "1"

    # ---------- 站点信息（用于部署与分享链接） ----------
    public_base_url = _env("LF_PUBLIC_URL", "")     # 例如 https://lost.example.com，留空则按请求 Host 推断

    @property
    def data_dir_str(self) -> str:
        return str(self.data_dir)


settings = Settings()


def ensure_dirs() -> None:
    for d in (settings.data_dir, settings.upload_dir, settings.backup_dir):
        d.mkdir(parents=True, exist_ok=True)


def load_secret() -> str:
    """密钥优先取环境变量；否则从 data/secret.key 读取或自动生成（保证重启后令牌不失效）"""
    if settings.secret_key:
        return settings.secret_key
    ensure_dirs()
    key_file = settings.data_dir / "secret.key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    import secrets as _secrets
    key = _secrets.token_urlsafe(48)
    key_file.write_text(key, encoding="utf-8")
    return key
