# -*- coding: utf-8 -*-
"""轻量 JWT（HS256）实现，仅依赖标准库"""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Optional


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def encode(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64e(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    p = _b64e(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signing_input = f"{h}.{p}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{h}.{p}.{_b64e(sig)}"


def decode(token: str, secret: str) -> Optional[dict]:
    try:
        h, p, s = token.split(".")
        signing_input = f"{h}.{p}".encode("ascii")
        expect = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expect, _b64d(s)):
            return None
        payload = json.loads(_b64d(p).decode("utf-8"))
        if payload.get("exp") and int(payload["exp"]) < int(time.time()):
            return None
        return payload
    except Exception:                                    # noqa: BLE001
        return None


def make_tokens(user_id: int, role: int, nickname: str, secret: str,
                access_minutes: int, refresh_days: int) -> dict:
    now = int(time.time())
    access_jti = secrets.token_hex(12)
    refresh_jti = secrets.token_hex(12)
    access = {
        "sub": user_id, "role": role, "nickname": nickname, "typ": "access",
        "jti": access_jti, "iat": now, "exp": now + access_minutes * 60,
    }
    refresh = {
        "sub": user_id, "role": role, "typ": "refresh",
        "jti": refresh_jti, "iat": now, "exp": now + refresh_days * 86400,
    }
    return {
        "accessToken": encode(access, secret),
        "refreshToken": encode(refresh, secret),
        "expiresIn": access_minutes * 60,
        "accessJti": access_jti,
        "accessExp": access["exp"],
    }
