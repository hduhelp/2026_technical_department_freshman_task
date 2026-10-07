"""
安全模块：密码加密 + JWT 签发/校验。

这里刻意用标准库手写，而不是 pip 安装 python-jose / passlib，
原因是："面试时你能把原理讲清楚" 比 "调用过某个库" 有价值得多。
全程只用了 hmac / hashlib / secrets / base64 / json 这些 Python 自带模块。

────────────────────────────────────────────────────────
一、密码为什么要"加密"存储？
────────────────────────────────────────────────────────
绝不能存明文。因为一旦数据库泄露，所有用户的密码就直接暴露了；
而很多人在不同网站用同一个密码，后果会扩散到其它平台。

正确做法叫"哈希"（Hash）：一种单向运算，能算出指纹，但无法从指纹反推原文。
更进一步：即使哈希过，攻击者仍可用"彩虹表"（预先算好的常见密码指纹库）反查。

所以专业做法是加"盐"（Salt）：
  存起来的指纹 = 哈希(密码 + 随机盐)
每个用户的盐都不同 → 同一个密码在不同账号下指纹也不同 → 彩虹表失效。

本项目用 scrypt 算法做哈希。
为什么不用 MD5/SHA1？因为它们算得太快，攻击者一秒能试几十亿次。
scrypt 故意设计成"又慢又费内存"，让暴力破解成本高到不可行。
（bcrypt 也是同理，只是本环境装不了它的库，而 scrypt 是 Python 标准库自带。）

────────────────────────────────────────────────────────
二、JWT 是什么？为什么登录后服务器就知道"你是谁"？
────────────────────────────────────────────────────────
传统方案叫 Session：服务器内存里存一张表，记录"会话编号 → 用户"。
缺点是服务器要记东西；多台服务器时还得共享这张表。

JWT（JSON Web Token）是无状态方案，一个 token 字符串长这样：

    eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiIxIiwianRpIjoiYWJjIn0 . 签名
    └──── 头部 ────┘   └──────── 载荷 ────────┘   └ 签名 ┘

用点号分成三段，每段都是 Base64URL 编码：
  · 头部(header)：说明用什么算法签名，例如 {"alg":"HS256","typ":"JWT"}
  · 载荷(payload)：真正的数据，本项目存 用户id(sub)、过期时间(exp)、token编号(jti)
  · 签名(signature)：用服务器密钥对"头部.载荷"做 HMAC 计算的结果

关键点：头部和载荷只是 Base64 编码，**任何人都能解开看**，所以绝不能放密码。
它防的不是"被看见"，而是"被篡改"——
攻击者想把 payload 里的 sub 改成别人的 id，就必须重新算签名，
而没有服务器密钥就算不出来。这就是"防伪造"。

本项目用 HS256 = HMAC-SHA256，对称加密：签发和验证用同一个密钥。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid

from . import config

logger = logging.getLogger(__name__)


class AuthError(Exception):
    """认证失败异常。由接口层捕获后转换成 401 响应。"""

    def __init__(self, message: str = "认证失败", code: str = "unauthorized") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


# ==================================================================
# 一、密钥准备
# ==================================================================


def _resolve_secret_key() -> bytes:
    """取得 JWT 签名密钥。

    如果用户没有通过环境变量 LF_SECRET_KEY 指定，就用一个随机的临时密钥。
    这样做的考虑：绝不留下一个公开的默认密钥（那等于人人都能伪造 token）。
    代价是重启服务后旧 token 会失效 —— 开发阶段完全可以接受。
    """
    if config.SECRET_KEY == "dev-only-insecure-secret-change-me":
        logger.warning(
            "未设置 LF_SECRET_KEY，已生成临时随机密钥；"
            "重启服务后已登录状态会失效。生产环境请务必设置固定密钥。"
        )
        return secrets.token_bytes(48)
    return config.SECRET_KEY.encode("utf-8")


_SECRET = _resolve_secret_key()


# ==================================================================
# 二、Base64URL 工具
# ==================================================================


def _b64url_encode(raw: bytes) -> str:
    """标准 Base64 里 + / = 在 URL 中有特殊含义，JWT 规定换成 - _ 并去掉补位的 =。"""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    """解码时要把补位的 = 补回来，否则长度不是 4 的倍数会报错。"""
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


# ==================================================================
# 三、密码哈希（scrypt + 随机盐）
# ==================================================================

# scrypt 参数：n=2^14 是内存开销，r=8 是块大小，p=1 是并行度。
# 这套参数约需 16MB 内存，对服务器无压力，但让暴力破解变得很贵。
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32

# 存储格式：算法$n$r$p$盐$哈希
# 把参数一起存进去的好处：将来调高参数时，旧密码仍能用旧参数验证，无需强制用户改密。
_PWD_SCHEME = "scrypt"


def hash_password(password: str) -> str:
    """把明文密码转换成可安全入库的哈希字符串。"""
    # bcrypt 有 72 字节上限，scrypt 没有，但仍限制长度防止有人用超长密码拖垮服务器
    if len(password.encode("utf-8")) > 256:
        raise AuthError("密码过长", "password_too_long")

    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_BYTES,
    )
    return "$".join(
        [
            _PWD_SCHEME,
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            _b64url_encode(salt),
            _b64url_encode(dk),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    """校验明文密码是否与库中哈希匹配。"""
    try:
        scheme, s_n, s_r, s_p, salt_b64, hash_b64 = stored.split("$")
        if scheme != _PWD_SCHEME:
            return False
        expected = _b64url_decode(hash_b64)
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_b64url_decode(salt_b64),
            n=int(s_n),
            r=int(s_r),
            p=int(s_p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        # 库里的哈希格式不对（比如被人工改坏），一律当作验证失败，不抛异常
        return False

    # 【安全要点】必须用 compare_digest 做"恒定时间比较"。
    # 用普通的 == 比较会在第一个不同的字符处提前返回，
    # 攻击者能通过测量耗时一个字符一个字符地猜出正确哈希（时序攻击）。
    return hmac.compare_digest(dk, expected)


# ==================================================================
# 四、JWT 签发
# ==================================================================


def create_access_token(user_id: int, expires_in_days: int | None = None) -> tuple[str, str, int]:
    """为用户签发一个 access token。

    返回：(token 字符串, jti 编号, 过期时间戳)
    jti 会在"退出登录"时写入黑名单，所以必须返回给调用方。
    """
    days = config.ACCESS_TOKEN_EXPIRE_DAYS if expires_in_days is None else expires_in_days
    now = int(time.time())
    expires_at = now + days * 24 * 3600
    jti = uuid.uuid4().hex

    header = {"alg": config.JWT_ALGORITHM, "typ": "JWT"}
    payload = {
        "sub": str(user_id),  # subject：这个 token 代表哪个用户
        "jti": jti,  # JWT ID：token 的唯一编号
        "iat": now,  # issued at：签发时间
        "exp": expires_at,  # expiration：过期时间（验证时会自动检查）
    }

    # 注意 separators 和 ensure_ascii：
    # separators 去掉多余空格，ensure_ascii=False 让中文不被转义成 \uXXXX，
    # 保证同样的数据每次序列化结果一致（签名依赖字节级一致）。
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
        _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = hmac.new(_SECRET, signing_input, hashlib.sha256).digest()

    return f"{segments[0]}.{segments[1]}.{_b64url_encode(signature)}", jti, expires_at


# ==================================================================
# 五、JWT 校验
# ==================================================================


def decode_access_token(token: str) -> dict:
    """验证 token 并返回其载荷。任何问题都抛 AuthError。"""
    if not token or token.count(".") != 2:
        raise AuthError("凭证格式不正确", "invalid_token")

    header_b64, payload_b64, signature_b64 = token.split(".")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    # --- 第 1 步：验签（最关键的防伪步骤）---
    try:
        provided_signature = _b64url_decode(signature_b64)
    except Exception as exc:
        raise AuthError("凭证签名无法解析", "invalid_token") from exc

    expected_signature = hmac.new(_SECRET, signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(provided_signature, expected_signature):
        raise AuthError("凭证签名校验失败，可能被篡改", "invalid_signature")

    # --- 第 2 步：解析头部，确认算法 ---
    try:
        header = json.loads(_b64url_decode(header_b64))
    except Exception as exc:
        raise AuthError("凭证头部无法解析", "invalid_token") from exc

    # 【安全要点】必须白名单校验算法。
    # 历史上有著名的 "alg=none" 攻击：攻击者把算法改成 none 并去掉签名，
    # 如果服务器不检查就直接放行，任何人都能伪造身份。
    if header.get("alg") != config.JWT_ALGORITHM:
        raise AuthError("不支持的签名算法", "invalid_algorithm")

    # --- 第 3 步：解析载荷并检查过期 ---
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception as exc:
        raise AuthError("凭证载荷无法解析", "invalid_token") from exc

    exp = payload.get("exp")
    if not isinstance(exp, int):
        raise AuthError("凭证缺少过期时间", "invalid_token")
    if exp < int(time.time()):
        raise AuthError("凭证已过期，请重新登录", "token_expired")

    if not payload.get("sub") or not payload.get("jti"):
        raise AuthError("凭证内容不完整", "invalid_token")

    return payload


# ==================================================================
# 六、黑名单（让"退出登录"真正生效）
# ==================================================================


def revoke_token(jti: str, user_id: int, expires_at: int) -> None:
    """把 token 编号写入黑名单，实现"退出登录后立刻失效"。"""
    from .database import transaction

    with transaction() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO user_sessions (jti, user_id, expires_at) VALUES (?, ?, ?)",
            (jti, user_id, expires_at),
        )


def is_token_revoked(jti: str) -> bool:
    """检查 token 是否已被注销。"""
    from .database import get_db

    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM user_sessions WHERE jti = ?", (jti,)).fetchone()
    return row is not None


def purge_expired_sessions() -> int:
    """清理黑名单中已自然过期的记录，避免表无限增长。"""
    from .database import transaction

    with transaction() as conn:
        cursor = conn.execute("DELETE FROM user_sessions WHERE expires_at < ?", (int(time.time()),))
        return cursor.rowcount
