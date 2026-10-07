# -*- coding: utf-8 -*-
"""统一响应体、错误码、异常处理、脱敏工具"""
import re
from typing import Any, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# ----------------------------------------------------------------------
# 业务错误码（与《04 接口设计说明书》一致）
# ----------------------------------------------------------------------
CODE_MESSAGE = {
    0: "success",
    1001: "请先登录",
    1002: "用户名已存在",
    1003: "手机号已被注册",
    1004: "账号已锁定，请稍后重试",
    1005: "账号已被禁用，请联系管理员",
    1006: "登录已过期，请重新登录",
    1007: "无操作权限",
    1008: "原密码不正确",
    1009: "密码强度不足（8-20 位且同时包含字母与数字）",
    1010: "两次输入的密码不一致",
    2001: "参数校验失败",
    2002: "时间设置不合法",
    2003: "发布过于频繁，请稍后再试",
    2004: "图片格式或大小不符合要求",
    2005: "信息不存在或无权操作",
    2006: "联系方式缺失（手机号与微信至少填写一项）",
    2007: "图片数量超限",
    2008: "分类不存在或已停用",
    2009: "地点不存在或已停用",
    2010: "状态流转不合法",
    2011: "请勿重复提交相同内容",
    2012: "该物品已有较多认领申请，请先联系发布人确认",
    2013: "不能认领自己发布的信息",
    2014: "该认领已断开，无法继续发送消息",
    3001: "分类名称已存在",
    3002: "地点名称已存在",
    3003: "该分类下存在信息，无法删除",
    3004: "不能操作当前登录账号",
    3005: "该地点下存在信息，无法删除",
    9001: "操作过于频繁，请稍后重试",
    9002: "文件上传失败，请重试",
    5000: "服务繁忙，请稍后重试",
}

HTTP_STATUS = {
    1001: 401, 1006: 401, 1004: 429, 1005: 403, 1007: 403,
    9001: 429, 2004: 400, 5000: 500,
}


class BizError(HTTPException):
    """业务异常：HTTP 状态码按错误码映射，响应体仍为统一结构"""

    def __init__(self, code: int, message: Optional[str] = None, detail: Optional[Any] = None):
        self.code = code
        self.biz_message = message or CODE_MESSAGE.get(code, "操作失败")
        self.detail = detail
        super().__init__(status_code=HTTP_STATUS.get(code, 200), detail=self.biz_message)


def ok(data: Any = None, request: Optional[Request] = None) -> dict:
    return {
        "code": 0,
        "message": "success",
        "data": data,
        "traceId": getattr(request.state, "trace_id", "") if request is not None else "",
    }


def fail(code: int, message: Optional[str] = None, request: Optional[Request] = None,
         detail: Any = None) -> JSONResponse:
    body = {
        "code": code,
        "message": message or CODE_MESSAGE.get(code, "操作失败"),
        "data": detail,
        "traceId": getattr(request.state, "trace_id", "") if request is not None else "",
    }
    return JSONResponse(status_code=HTTP_STATUS.get(code, 200), content=body)


def page_result(items: list, total: int, page: int, size: int) -> dict:
    pages = (total + size - 1) // size if size else 0
    return {"list": items, "total": total, "page": page, "size": size, "pages": pages}


# ----------------------------------------------------------------------
# 脱敏
# ----------------------------------------------------------------------
def mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone or len(phone) < 7:
        return phone
    return f"{phone[:3]}****{phone[-4:]}"


def mask_wechat(wechat: Optional[str]) -> Optional[str]:
    if not wechat:
        return None
    if len(wechat) <= 2:
        return wechat[0] + "*"
    return wechat[:2] + "***"


def escape_like(kw: str) -> str:
    """转义 SQL LIKE 通配符，避免用户输入 % _ 造成全表匹配"""
    return kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ----------------------------------------------------------------------
# 校验
# ----------------------------------------------------------------------
RE_USERNAME = re.compile(r"^[a-zA-Z0-9_]{4,20}$")
RE_PHONE = re.compile(r"^1[3-9]\d{9}$")
RE_PWD_HAS_ALPHA = re.compile(r"[A-Za-z]")
RE_PWD_HAS_DIGIT = re.compile(r"\d")


def check_username(v: str) -> None:
    if not RE_USERNAME.match(v or ""):
        raise BizError(2001, "用户名需为 4-20 位字母、数字或下划线")


def check_phone(v: str) -> None:
    if not RE_PHONE.match(v or ""):
        raise BizError(2001, "手机号格式不正确")


def check_password_strength(v: str) -> None:
    if not (8 <= len(v or "") <= 20) or not RE_PWD_HAS_ALPHA.search(v) or not RE_PWD_HAS_DIGIT.search(v):
        raise BizError(1009)


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))
