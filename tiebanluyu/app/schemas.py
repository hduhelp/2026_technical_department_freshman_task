"""
数据校验层（请求体 / 响应体的结构定义）。

这一层解决什么问题？
--------------------
前端发来的数据永远不可信：可能是空的、超长的、类型不对的。
如果直接塞进 SQL，轻则报错，重则产生安全问题。
Pydantic 会在数据进入业务逻辑之前先挡住这些情况，并返回清晰的错误信息。

本文件对应的 Pydantic 版本：v2（已确认环境为 2.13.4）
v1 与 v2 的写法差异很大（例如 v1 用 class Config，v2 用 model_config），
所以这里统一使用 v2 风格。
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ------------------------------------------------------------------ 常量

# 用户名的允许规则。
#
# 【为什么不能用 ^[A-Za-z0-9_-]+$ 】
# 因为拾取者需要能直接填写保管者的名字（"王老师""李阿姨"），
# 而真实的中文名用纯英文数字表达不出来。如果用户名只允许 ASCII，
# 中文用户就只能被迫起一个英文字号，别人根本认不出他是谁，
# 这会直接破坏"输入保管者名字就能找到人"这个使用场景。
#
# 【为什么必须允许中文和数字混用】
# 我第一版写成"要么纯中文、要么纯 ASCII，不许混用"，结果把
# 「王老师1812」这种名字拦掉了 —— 而两个老师都姓王时，
# 用户自然会写「王老师2」来区分。禁止混用恰好堵死了最需要的场景。
# 所以规则放宽为：中文、字母、数字、下划线、连字符，任意组合。
#
# 仍然禁止的：空格、标点、emoji。
# 理由是这些字符会造成"看起来一样、实际是两个账号"的问题
# （比如"李老师。"和"李老师"），而且难以辨认。
USERNAME_PATTERN = re.compile(r"^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9_-]+$")

USERNAME_MIN_CHARS = 2
USERNAME_MAX_CHARS = 30
# 30 个汉字 = 90 字节。
# 【注意】不要用「字符数 × 3」反推字节上限：UTF-8 下一个字符最长 4 字节
# （emoji、部分扩展区汉字），"× 3" 会低估实际占用。
USERNAME_MAX_BYTES = 90

# 密码长度下限。8 位是当前主流安全基线（防止 123456 这类弱口令）
PASSWORD_MIN_LENGTH = 8

# 各类文本长度限制。
#
# 【这里有个容易搞错的地方，我自己就写错过】
# 下面每一对 "(字符数, 字节数)" 里，**字节数才是真正的约束**，
# 字符数只是为了让报错信息更友好、以及在纯 ASCII 输入时提前拦下。
#
# 为什么不能只按字符数限制？
#   因为 SQLite 的 TEXT 没有长度限制，字符数是纯产品约束；
#   而将来若换成 MySQL 的 VARCHAR(n)，n 是按**字节**算的。
# 为什么不能只按字节数限制？
#   因为用户看到"300 字节"没有概念，不知道自己还能打几个字。
#
# 【绝对不要做的事】不要用「字节上限 ÷ 3」告诉用户"约等于几个汉字"。
#   我原来就是这么写的，但 UTF-8 下一个字符最长可以是 4 字节，
#   那个换算会给出错误的提示信息（不只是注释错，是给用户的提示错）。
MAX_TITLE_CHARS = 50
MAX_TITLE_BYTES = 300  # 100 个汉字，或 75 个 emoji

MAX_DESCRIPTION_CHARS = 2000
MAX_DESCRIPTION_BYTES = 6000

MAX_LOCATION_CHARS = 100
MAX_LOCATION_BYTES = 300

MAX_CONTACT_CHARS = 100
MAX_CONTACT_BYTES = 300

# 拾取者 / 保管者这类"人名"字段的长度
MAX_PERSON_NAME_CHARS = 30
MAX_PERSON_NAME_BYTES = 90  # 30 个汉字

MAX_URL_CHARS = 500


# ------------------------------------------------------------------ 通用校验函数


def _utf8_length(text: str) -> int:
    """返回字符串的 UTF-8 字节数。"""
    return len(text.encode("utf-8"))


def _check_utf8_length(text: str, max_bytes: int, field_label: str) -> str:
    """字节数超限时抛出带清晰提示的错误。

    提示里只给字节数，**不做"约等于几个汉字"的换算** ——
    因为一个 UTF-8 字符可以是 1~4 字节，任何固定除数都是错的。
    """
    actual = _utf8_length(text)
    if actual > max_bytes:
        raise ValueError(f"{field_label}过长（当前 {actual} 字节，最多 {max_bytes} 字节）")
    return text


def _clean_required_text(value: str, field_label: str) -> str:
    """处理必填文本：去首尾空白，并禁止纯空白内容。"""
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{field_label}不能为空")
    return cleaned


# ------------------------------------------------------------------ 用户相关


class UserRegister(BaseModel):
    """注册请求体。"""

    username: str = Field(
        ...,
        description=(
            f"登录用户名，{USERNAME_MIN_CHARS}~{USERNAME_MAX_CHARS} 位。"
            "支持中文、字母、数字、下划线、连字符（如 小明、wanglaoshi、王老师_2）"
        ),
    )
    password: str = Field(..., description=f"密码，至少 {PASSWORD_MIN_LENGTH} 位")
    display_name: str = Field("", description="昵称，留空则默认与用户名相同")
    contact: str = Field("", description="联系方式（手机 / QQ / 微信），可留空")

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        cleaned = value.strip()

        # 先查字符数（对用户友好），再查字节数（真正的约束）
        if len(cleaned) < USERNAME_MIN_CHARS:
            raise ValueError(f"用户名至少需要 {USERNAME_MIN_CHARS} 个字符")
        if len(cleaned) > USERNAME_MAX_CHARS:
            raise ValueError(f"用户名最多 {USERNAME_MAX_CHARS} 个字符")
        _check_utf8_length(cleaned, USERNAME_MAX_BYTES, "用户名")

        # 允许中文、字母、数字、下划线、连字符，可以任意混用
        # （如「王老师2」「xiaoming」「李阿姨_hdu」）。
        # 不允许空格、标点和 emoji —— 它们会产生"看起来一样、实际是两个账号"
        # 的问题（比如"李老师。"和"李老师"）。
        if not USERNAME_PATTERN.match(cleaned):
            raise ValueError(
                "用户名只能由中文、字母、数字、下划线或连字符组成，不能包含空格和标点"
            )

        # 统一转小写存储，保证 Tom 和 tom 不会变成两个账号。
        # 对中文调用 lower() 是无害的（中文没有大小写），所以这里可以统一处理。
        return cleaned.lower()

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < PASSWORD_MIN_LENGTH:
            raise ValueError(f"密码至少需要 {PASSWORD_MIN_LENGTH} 位")
        # 限制上限，防止有人提交超大字符串消耗服务器 CPU 做哈希
        return _check_utf8_length(value, 256, "密码")

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            return ""
        if len(cleaned) > 30:
            raise ValueError("昵称最多 30 个字符")
        return cleaned

    @field_validator("contact")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            return ""
        return _check_utf8_length(cleaned, MAX_CONTACT_BYTES, "联系方式")


class UserLogin(BaseModel):
    """登录请求体。"""

    username: str = Field(..., description="登录用户名")
    password: str = Field(..., description="密码")

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        # 登录时不校验用户名格式（避免把"格式错误"和"密码错误"区分开，
        # 那会泄露"哪些用户名存在"这一信息），只做去空白。
        return value.strip()


class UserPublic(BaseModel):
    """对外返回的用户信息。

    【安全要点】这里刻意不包含 password_hash 字段。
    用独立的数据模型控制"哪些字段能出去"，比手工删除字段更不容易出错。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    contact: str = ""
    avatar: str = ""
    created_at: str | None = None


class UserProfileUpdate(BaseModel):
    """修改个人资料请求体。所有字段可选，只更新传了的字段。"""

    display_name: str | None = Field(None, description="昵称")
    contact: str | None = Field(None, description="联系方式")
    avatar: str | None = Field(None, description="头像地址")

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > 30:
            raise ValueError("昵称最多 30 个字符")
        return cleaned

    @field_validator("contact")
    @classmethod
    def validate_contact(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _check_utf8_length(value.strip(), MAX_CONTACT_BYTES, "联系方式")

    @field_validator("avatar")
    @classmethod
    def validate_avatar(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _check_utf8_length(value.strip(), MAX_URL_CHARS, "头像地址")


class TokenResponse(BaseModel):
    """登录成功后的返回体。

    同时返回 token 和用户信息，前端拿到就能直接进主页，少一次请求。
    注意：token 也会写进 HttpOnly Cookie，所以前端其实不必自己保存它。
    """

    access_token: str
    token_type: str = "Bearer"
    expires_in: int = Field(..., description="有效期秒数")
    user: UserPublic


# ------------------------------------------------------------------ 失物招领相关


ItemType = Literal["lost", "found"]
ItemStatus = Literal["searching", "found", "closed"]


class ItemCreate(BaseModel):
    """发布失物 / 招领信息。"""

    type: ItemType = Field(..., description="lost=寻物启事，found=招领启事")
    title: str = Field(..., description=f"物品名称，最多 {MAX_TITLE_CHARS} 个字符")
    description: str = Field("", description="详细描述")
    location: str = Field("", description="丢失/拾取地点")
    event_time: str | None = Field(None, description="丢失/拾取时间，ISO 8601，例如 2026-09-26T14:30")
    contact: str = Field("", description="本条信息单独填的联系方式，留空则用账号里的")
    image_urls: list[str] = Field(default_factory=list, description="附带的图片地址列表")

    # ---------- 拾取者与保管者 ----------
    #
    # 【为什么要分成三组字段】
    # 真实场景里「谁捡到的」「东西现在在谁手里」「谁发的帖」经常是三个人：
    #   初中生捡到一包现金 → 不敢拿 → 交给老师 → 老师发帖
    # 失主真正要去的地方是"保管者"那里，所以保管信息必须单独存。
    #
    # holder_is_reporter=True 表示发布人就是保管者（最常见的情况，前端默认勾选），
    # 此时 holder_name / holder_place 会被忽略。
    holder_is_reporter: bool = Field(
        True,
        description="发布人是否就是保管者。勾选后下面的保管者信息会被忽略",
    )
    finder_name: str = Field(
        "",
        description="拾取者称呼，可留空或只写一个称呼（如「一位同学」）。不必是注册用户",
    )
    holder_username: str = Field(
        "",
        description=(
            "保管者的用户名。只有保管者也注册了本平台时才填，填了之后 TA 也能管理这条信息"
        ),
    )
    holder_name: str = Field("", description="保管者称呼，如「王老师」「6 号楼宿管阿姨」")
    holder_place: str = Field("", description="保管地点，如「图书馆一楼服务台」「行政楼 102 保卫处」")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        cleaned = _clean_required_text(value, "物品名称")
        if len(cleaned) > MAX_TITLE_CHARS:
            raise ValueError(f"物品名称最多 {MAX_TITLE_CHARS} 个字符")
        # 【为什么不在这里再查字节数】
        # 因为 50 个字符最多 200 字节（UTF-8 单字符最长 4 字节），
        # 而 MAX_TITLE_BYTES 是 300。也就是说字节上限**永远不可能触发**，
        # 写了也是死代码。这里保留字符数检查就够了。
        # （如果哪天把 MAX_TITLE_CHARS 调大到 76 以上，就必须把字节检查加回来。）
        return cleaned

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        if len(value) > MAX_DESCRIPTION_CHARS:
            raise ValueError(f"描述最多 {MAX_DESCRIPTION_CHARS} 个字符")
        return _check_utf8_length(value.strip(), MAX_DESCRIPTION_BYTES, "描述")

    @field_validator("location")
    @classmethod
    def validate_location(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > MAX_LOCATION_CHARS:
            raise ValueError(f"地点最多 {MAX_LOCATION_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_LOCATION_BYTES, "地点")

    @field_validator("contact")
    @classmethod
    def validate_contact(cls, value: str) -> str:
        return _check_utf8_length(value.strip(), MAX_CONTACT_BYTES, "联系方式")

    @field_validator("finder_name", "holder_name")
    @classmethod
    def validate_person_name(cls, value: str, info) -> str:
        cleaned = value.strip()
        if len(cleaned) > MAX_PERSON_NAME_CHARS:
            raise ValueError(f"{info.field_name} 最多 {MAX_PERSON_NAME_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_PERSON_NAME_BYTES, info.field_name)

    @field_validator("holder_place")
    @classmethod
    def validate_holder_place(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) > MAX_LOCATION_CHARS:
            raise ValueError(f"保管地点最多 {MAX_LOCATION_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_LOCATION_BYTES, "保管地点")

    @field_validator("holder_username")
    @classmethod
    def validate_holder_username(cls, value: str) -> str:
        # 不在这里判断"用户是否存在" —— 那需要查数据库，
        # 校验层应该只做格式检查，存在性判断交给路由层（能返回更准确的错误）。
        cleaned = value.strip()
        if not cleaned:
            return ""
        if len(cleaned) > USERNAME_MAX_CHARS:
            raise ValueError(f"保管者用户名最多 {USERNAME_MAX_CHARS} 个字符")
        return cleaned.lower()

    @field_validator("event_time")
    @classmethod
    def validate_event_time(cls, value: str | None) -> str | None:
        """把时间统一成 ISO 8601 字符串。

        【设计说明】前端可能传 "2026-09-26T14:30" 或 "2026-09-26 14:30"，
        这里统一规范化为 "2026-09-26T14:30:00"，保证数据库里格式一致，
        排序和比较才不会出错。统一用本地时间（不带时区），由前端负责展示。
        """
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        normalized = cleaned.replace(" ", "T").replace("/", "-")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("时间格式不正确，请使用 2026-09-26T14:30 这样的格式") from exc
        return parsed.replace(microsecond=0).isoformat()

    @field_validator("image_urls")
    @classmethod
    def validate_image_urls(cls, value: list[str]) -> list[str]:
        if len(value) > 9:
            raise ValueError("最多上传 9 张图片")
        return [_check_utf8_length(u.strip(), MAX_URL_CHARS, "图片地址") for u in value if u.strip()]


class ItemUpdate(BaseModel):
    """修改自己的信息。所有字段可选，只更新传了的字段。"""

    title: str | None = None
    description: str | None = None
    location: str | None = None
    event_time: str | None = None
    contact: str | None = None
    image_urls: list[str] | None = None

    # 拾取者 / 保管者也可以改（比如物品从"老师手上"转移到了"保卫处"）
    holder_is_reporter: bool | None = None
    finder_name: str | None = None
    holder_username: str | None = None
    holder_name: str | None = None
    holder_place: str | None = None

    @field_validator("finder_name", "holder_name")
    @classmethod
    def validate_person_name(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > MAX_PERSON_NAME_CHARS:
            raise ValueError(f"{info.field_name} 最多 {MAX_PERSON_NAME_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_PERSON_NAME_BYTES, info.field_name)

    @field_validator("holder_place")
    @classmethod
    def validate_holder_place(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > MAX_LOCATION_CHARS:
            raise ValueError(f"保管地点最多 {MAX_LOCATION_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_LOCATION_BYTES, "保管地点")

    @field_validator("holder_username")
    @classmethod
    def validate_holder_username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return ""
        if len(cleaned) > USERNAME_MAX_CHARS:
            raise ValueError(f"保管者用户名最多 {USERNAME_MAX_CHARS} 个字符")
        return cleaned.lower()

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean_required_text(value, "物品名称")
        if len(cleaned) > MAX_TITLE_CHARS:
            raise ValueError(f"物品名称最多 {MAX_TITLE_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_TITLE_BYTES, "物品名称")

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value) > MAX_DESCRIPTION_CHARS:
            raise ValueError(f"描述最多 {MAX_DESCRIPTION_CHARS} 个字符")
        return _check_utf8_length(value.strip(), MAX_DESCRIPTION_BYTES, "描述")

    @field_validator("location")
    @classmethod
    def validate_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) > MAX_LOCATION_CHARS:
            raise ValueError(f"地点最多 {MAX_LOCATION_CHARS} 个字符")
        return _check_utf8_length(cleaned, MAX_LOCATION_BYTES, "地点")

    @field_validator("contact")
    @classmethod
    def validate_contact(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _check_utf8_length(value.strip(), MAX_CONTACT_BYTES, "联系方式")

    @field_validator("event_time")
    @classmethod
    def validate_event_time(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        normalized = cleaned.replace(" ", "T").replace("/", "-")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("时间格式不正确，请使用 2026-09-26T14:30 这样的格式") from exc
        return parsed.replace(microsecond=0).isoformat()

    @field_validator("image_urls")
    @classmethod
    def validate_image_urls(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > 9:
            raise ValueError("最多上传 9 张图片")
        return [_check_utf8_length(u.strip(), MAX_URL_CHARS, "图片地址") for u in value if u.strip()]


class ItemStatusUpdate(BaseModel):
    """修改信息状态（寻找中 / 已找到 / 已结束）。"""

    status: ItemStatus = Field(..., description="searching=寻找中，found=已找到，closed=已结束")


class ItemOwner(BaseModel):
    """信息里展示的发布者摘要（不含敏感字段）。"""

    id: int
    display_name: str
    contact: str = ""


class ItemPublic(BaseModel):
    """列表页返回的信息（不含图片详情，减小体积）。"""

    id: int
    type: ItemType
    status: ItemStatus
    title: str
    description: str
    location: str
    event_time: str | None = None
    contact: str = ""
    cover_image: str = ""
    view_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None
    owner: ItemOwner | None = None
    is_mine: bool = Field(
        False,
        description="当前登录用户是否有权管理这条信息（发布者或保管者）",
    )
    type_label: str = Field("", description="类型的中文名，例如「寻物启事」")
    status_label: str = Field("", description="状态的中文名，例如「寻找中」")

    # ---------- 拾取者与保管者 ----------
    finder_name: str = Field("", description="拾取者称呼，可能为空")
    holder_is_reporter: bool = Field(
        True, description="发布人是否就是保管者。为 True 时下面的 holder_* 字段都为空"
    )
    holder_name: str = Field("", description="保管者称呼")
    holder_place: str = Field("", description="保管地点")
    holder_username: str = Field(
        "", description="保管者的用户名（如果保管者也注册了账号）"
    )
    is_holder: bool = Field(
        False,
        description=(
            "当前登录用户是否是保管者。用于前端区分显示："
            "保管者看到的是「我保管的东西」，发布者看到的是「我发布的信息」"
        ),
    )
    is_owner: bool = Field(
        False,
        description=(
            "当前登录用户是否是发布者。"
            "注意要和 is_mine 区分：is_mine = is_owner 或 is_holder，"
            "表示「有管理权」；而界面上要显示「我发布的」还是「我保管的」，"
            "必须分别判断这两个字段，不能只看 is_mine"
        ),
    )


class ItemDetail(ItemPublic):
    """详情页返回的信息（额外带图片列表）。"""

    images: list[str] = Field(default_factory=list)
    owner_contact: str = Field("", description="发布者的账号联系方式，便于联系失主/拾主")
    holder_contact: str = Field(
        "",
        description=(
            "保管者的账号联系方式。失主真正要去的是保管者那里，"
            "所以这个字段比 owner_contact 更实用"
        ),
    )


class ItemListResponse(BaseModel):
    """分页列表返回体。

    除了数据本身，还必须告诉前端"总共有多少条"，
    否则前端无法计算分页按钮，只能一直点"下一页"。
    """

    items: list[ItemPublic]
    total: int = Field(..., description="符合筛选条件的总条数")
    page: int = Field(..., description="当前页码，从 1 开始")
    page_size: int = Field(..., description="每页条数")
    total_pages: int = Field(..., description="总页数")
    has_next: bool = Field(..., description="是否还有下一页")


# ------------------------------------------------------------------ 图片相关


class ImageUploadRequest(BaseModel):
    """图片上传请求体。

    用 base64 字符串而不是 multipart 表单，是为了避免引入
    `python-multipart` 依赖（详见 utils.save_base64_image 的说明）。
    """

    image_base64: str = Field(
        ...,
        description="图片的 base64 内容，支持带 data:image/png;base64, 前缀，也支持纯 base64",
    )


class ImageUploadResponse(BaseModel):
    """图片上传成功后的返回体。"""

    url: str = Field(..., description="图片访问地址，把它填进信息的 image_urls 里即可")
    message: str = "上传成功"


# ------------------------------------------------------------------ 智能匹配


class MatchSuggestion(BaseModel):
    """一条匹配建议。"""

    item_id: int
    title: str
    type: ItemType
    location: str = ""
    event_time: str | None = None
    cover_image: str = ""
    score: float = Field(..., description="匹配得分 0~1")
    score_percent: int = Field(..., description="匹配度百分比，方便前端直接显示")
    reason: str = Field("", description="人类可读的匹配理由")
    owner_display_name: str = ""


class MatchSuggestionResponse(BaseModel):
    """智能匹配接口的返回体。

    除了建议列表，还回带被查询信息自身的摘要，
    这样前端不用再查一次就能把标题显示出来。
    """

    item_id: int
    item_title: str
    item_type: ItemType
    opposite_type_label: str = Field("", description="对方类型的中文名，例如「招领启事」")
    suggestions: list[MatchSuggestion] = Field(default_factory=list)


# ------------------------------------------------------------------ 通用返回体


class MessageResponse(BaseModel):
    """通用简单消息返回体，例如"退出登录成功"。"""

    message: str
    detail: str = ""


class ErrorResponse(BaseModel):
    """统一错误格式，前端只需处理这一种结构。"""

    error: bool = True
    code: str = Field(..., description="机器可读的错误码，例如 invalid_credentials")
    message: str = Field(..., description="给用户看的中文提示")
