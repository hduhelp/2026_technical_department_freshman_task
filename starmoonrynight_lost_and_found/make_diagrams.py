# -*- coding: utf-8 -*-
"""
失物招领系统 · 设计图生成脚本
生成 8 张设计图的 SVG（矢量源文件），随后由 make_docx.py 调用 LibreOffice 转为 PNG。
用法： python make_diagrams.py
输出： ./图/*.svg
"""
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "图")
os.makedirs(OUT_DIR, exist_ok=True)

FONT = "'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif"

C = {
    "bg": "#FFFFFF", "ink": "#1F2329", "ink2": "#5A6270", "ink3": "#8A93A0",
    "line": "#C9CFDA", "border": "#E5E8EE",
    "blue": "#2F6BFF", "blue_bg": "#EAF1FF", "blue_bd": "#A9C4FF",
    "green": "#22A06B", "green_bg": "#E6F6EF", "green_bd": "#9BD9BE",
    "orange": "#E8A33D", "orange_bg": "#FDF3E3", "orange_bd": "#F0CE94",
    "red": "#E5484D", "red_bg": "#FDECEC", "red_bd": "#F3B4B6",
    "purple": "#7A5AF8", "purple_bg": "#F0ECFF", "purple_bd": "#C6B8FF",
    "gray_bg": "#F4F6F9", "gray_bd": "#D6DBE4",
    "ink_bg": "#F4F6F9", "ink_bd": "#D6DBE4", "ink3_bg": "#F4F6F9", "ink3_bd": "#D6DBE4",
}


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def wrap_cn(text, max_chars):
    out, line, w = [], "", 0.0
    for ch in text:
        cw = 1.0 if ord(ch) > 0x2000 else 0.55
        if w + cw > max_chars:
            out.append(line)
            line, w = "", 0.0
        line += ch
        w += cw
    if line:
        out.append(line)
    return out or [""]


def bg_of(key):
    return C.get(key + "_bg", C["gray_bg"])


def bd_of(key):
    return C.get(key + "_bd", C["gray_bd"])


def fg_of(key):
    return C.get(key, C["ink2"])


class SVG:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.parts = []

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill="none", stroke=None, rx=6, sw=1.2, dash=None, op=None):
        a = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}"'
        if stroke:
            a += f' stroke="{stroke}" stroke-width="{sw}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if op is not None:
            a += f' opacity="{op}"'
        self.add(a + "/>")

    def line(self, x1, y1, x2, y2, stroke=None, sw=1.2, dash=None, marker=None):
        stroke = stroke or C["line"]
        a = (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{sw}"')
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if marker:
            a += f' marker-end="url(#{marker})"'
        self.add(a + "/>")

    def path(self, d, stroke=None, sw=1.2, fill="none", dash=None, marker=None):
        stroke = stroke or C["line"]
        a = (f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" '
             f'stroke-linejoin="round" stroke-linecap="round"')
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if marker:
            a += f' marker-end="url(#{marker})"'
        self.add(a + "/>")

    def text(self, x, y, s, size=13, fill=None, anchor="middle", weight="normal", op=None):
        fill = fill or C["ink"]
        a = (f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
             f'font-weight="{weight}" font-family="{FONT}"')
        if op is not None:
            a += f' opacity="{op}"'
        self.add(a + f'>{esc(s)}</text>')

    def ctext(self, cx, cy, lines, size=13, fill=None, weight="normal", lh=None):
        lh = lh or size + 6
        n = max(len(lines), 1)
        y0 = cy - (n - 1) * lh / 2 + size * 0.35
        for i, ln in enumerate(lines):
            self.text(cx, y0 + i * lh, ln, size=size, fill=fill, weight=weight)

    def arrow(self, x1, y1, x2, y2, stroke=None, sw=1.4, dash=None, marker="ah"):
        self.line(x1, y1, x2, y2, stroke=stroke, sw=sw, dash=dash, marker=marker)

    def diamond(self, cx, cy, w, h, lines, size=12, fill=None, stroke=None):
        self.add(f'<polygon points="{cx:.1f},{cy - h / 2:.1f} {cx + w / 2:.1f},{cy:.1f} '
                 f'{cx:.1f},{cy + h / 2:.1f} {cx - w / 2:.1f},{cy:.1f}" '
                 f'fill="{fill or C["blue_bg"]}" stroke="{stroke or C["blue_bd"]}" stroke-width="1.2"/>')
        self.ctext(cx, cy, lines, size=size)

    def crow(self, x, y, direction="right", color=None):
        color = color or C["line"]
        d = 1 if direction == "right" else -1
        for dy in (-6, 0, 6):
            self.line(x, y, x + 10 * d, y + dy, stroke=color)

    def one_bar(self, x, y, direction="left", color=None):
        self.line(x, y - 7, x, y + 7, stroke=color or C["line"])

    def title(self, t, sub=None):
        self.text(40, 40, t, size=21, weight="700", anchor="start")
        if sub:
            self.text(40, 64, sub, size=12.5, fill=C["ink3"], anchor="start")

    def save(self, name):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
                f'viewBox="0 0 {self.w} {self.h}">\n<defs>\n'
                f'<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
                f'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{C["ink2"]}"/></marker>\n'
                f'</defs>\n<rect width="{self.w}" height="{self.h}" fill="{C["bg"]}"/>\n')
        with open(os.path.join(OUT_DIR, name + ".svg"), "w", encoding="utf-8") as f:
            f.write(head + "\n".join(self.parts) + "\n</svg>\n")
        print("  OK", name + ".svg")


# ============================================================
# 图 1 · 用例图
# ============================================================
def fig01_usecase():
    s = SVG(1200, 900)
    s.title("图 1  失物招领系统用例图",
            "参与者：游客 / 注册用户 / 管理员 —— 极简版覆盖「发布 + 查询」及其必要支撑")

    # 系统边界
    s.rect(300, 100, 560, 720, fill="#FCFDFF", stroke=C["blue_bd"], rx=14, dash="6 5")
    s.text(580, 126, "失物招领系统", size=14, weight="700", fill=C["blue"])

    def actor(cx, cy, name, color, sub=None):
        s.add(f'<circle cx="{cx:.1f}" cy="{cy - 24:.1f}" r="14" fill="{bg_of(color)}" stroke="{fg_of(color)}" stroke-width="1.6"/>')
        s.path(f"M {cx:.1f} {cy - 10:.1f} L {cx:.1f} {cy + 12:.1f}", stroke=fg_of(color), sw=1.6)
        s.path(f"M {cx - 15:.1f} {cy:.1f} L {cx + 15:.1f} {cy:.1f}", stroke=fg_of(color), sw=1.6)
        s.path(f"M {cx:.1f} {cy + 12:.1f} L {cx - 12:.1f} {cy + 32:.1f}", stroke=fg_of(color), sw=1.6)
        s.path(f"M {cx:.1f} {cy + 12:.1f} L {cx + 12:.1f} {cy + 32:.1f}", stroke=fg_of(color), sw=1.6)
        # 文字白底，避免多条关联线穿过文字
        s.rect(cx - 62, cy + 40, 124, 36, fill="#FFFFFF", stroke="none", rx=4)
        s.text(cx, cy + 56, name, size=13.5, weight="700", fill=fg_of(color))
        if sub:
            s.text(cx, cy + 72, sub, size=10.6, fill=C["ink3"])

    actor(120, 240, "游客", "ink3", "未登录访问者")
    actor(120, 500, "注册用户", "blue", "学生 / 教职工")
    actor(1080, 400, "管理员", "purple", "后勤 / 物业")

    sx, sw = 322, 516

    # 游客用例
    y = 156
    for t, code in [("浏览信息列表", "UC-04"), ("检索信息（关键词/分类/地点/时间）", "UC-05"),
                    ("查看信息详情（联系方式脱敏）", "UC-06"), ("注册账号", "UC-01"), ("登录", "UC-02")]:
        h = 40
        s.rect(sx + 16, y, sw - 32, h, fill=C["gray_bg"], stroke=C["gray_bd"], rx=20)
        s.text(sx + 38, y + h / 2 + 4.5, f"{code}   {t}", size=12.4, anchor="start")
        s.line(134, 240, sx + 16, y + h / 2, stroke=C["ink3"], sw=1.05)
        y += h + 12

    # 用户用例
    y += 6
    for t, code in [("发布失物信息", "UC-07"), ("发布招领信息", "UC-08"), ("编辑我的信息", "UC-09"),
                    ("下架 / 重新上架", "UC-10"), ("删除我的信息", "UC-11"), ("查看我的发布", "UC-12"),
                    ("收藏信息", "UC-13"), ("维护资料 / 修改密码", "UC-14 / UC-15")]:
        h = 34
        s.rect(sx + 36, y, sw - 72, h, fill=C["blue_bg"], stroke=C["blue_bd"], rx=17)
        s.text(sx + 56, y + h / 2 + 4.5, f"{code}   {t}", size=12, anchor="start")
        s.line(134, 500, sx + 36, y + h / 2, stroke=C["blue"], sw=1.05)
        y += h + 8

    # 管理员用例
    ay = 340
    for t, code in [("维护分类字典", "UC-16"), ("维护地点字典", "UC-17"), ("管理用户（启停）", "UC-18"),
                    ("下架违规信息", "UC-19"), ("查看统计概览", "UC-20")]:
        h = 34
        s.rect(sx + sw - 232, ay, 216, h, fill=C["purple_bg"], stroke=C["purple_bd"], rx=17, sw=1.4)
        s.text(sx + sw - 214, ay + h / 2 + 4.5, f"{code}   {t}", size=12, anchor="start")
        s.line(1160, 400, sx + sw - 16, ay + h / 2, stroke=C["purple"], sw=1.05)
        ay += h + 14

    # 「上传图片」作为用户用例的包含
    s.rect(sx + 36, y + 10, sw - 72, 34, fill=C["orange_bg"], stroke=C["orange_bd"], rx=17)
    s.text(sx + 56, y + 10 + 21.5, "UC-21   上传图片（发布流程包含）", size=12, anchor="start")
    s.path(f"M {sx + 200} {y + 2} L {sx + 200} {y + 10}", stroke=C["orange"], sw=1.2, dash="4 3", marker="ah")

    s.text(600, 828, "说明：实线为参与者与用例的关联；UC-21 由发布流程内部触发（«include»）。"
                     "管理员的用例同时作用于用户与信息数据，但权限边界由 AdminOnly 拦截器统一控制。",
           size=11.4, fill=C["ink3"])
    s.save("01-用例图")


# ============================================================
# 图 2 · 系统架构图
# ============================================================
def fig02_architecture():
    s = SVG(1220, 920)
    s.title("图 2  系统总体架构图（分层）",
            "Java 17 + Spring Boot 3 + MyBatis-Plus + MySQL 8 + Redis + Vue 3 —— 单体分层架构")

    x0, w = 200, 900
    y = 104
    layers = [
        ("客户端层", "blue", 96,
         "Vue 3 SPA（用户端 + 管理端）",
         [("用户端页面", ["首页 / 检索结果 / 详情", "发布 / 编辑 / 个人中心"]),
          ("管理端页面", ["数据概览 / 分类 / 地点", "用户管理 / 信息管理"])]),
        ("接入层", "orange", 76,
         "Nginx 1.24",
         [("静态与代理", ["HTTPS 卸载 · 静态资源托管", "反向代理 /api · 图片目录只读映射", "Gzip · IP 限流 600 次/分钟"])]),
        ("接口层", "green", 130,
         "Spring MVC Controller + Interceptor",
         [("请求入口", ["AuthInterceptor：JWT 校验 / 角色校验 / 禁用态拦截",
                    "@Valid 参数校验 · DTO ↔ VO 转换 · 统一响应体 Result<T>",
                    "GlobalExceptionHandler：业务异常 → 错误码；兜底 → 5000 + traceId"])]),
        ("业务层", "purple", 150,
         "Service（事务边界 + 业务规则）",
         [("业务模块", ["AuthService / UserService（注册登录、资料、令牌）",
                    "ItemService（发布、编辑、状态流转、组合检索）",
                    "ImageService（上传校验、压缩、缩略图）· FavoriteService（收藏）",
                    "CategoryService / LocationService（字典）· StatisticsService（统计）",
                    "OperationLogService（审计日志）"])]),
        ("数据访问层", "ink3", 104,
         "MyBatis-Plus Mapper",
         [("持久化能力", ["LambdaQueryWrapper 条件构造 · 分页插件（物理分页）· 逻辑删除",
                     "预编译 #{} 防注入 · 批量 IN 装配防 N+1 · 查询全部走索引设计"])]),
        ("数据层", "red", 124,
         "MySQL 8.0 / Redis 7.x / 文件存储",
         [("MySQL", ["8 张业务表 + 统计视图", "每日备份 + binlog 增量"]),
          ("Redis", ["字典与详情缓存", "限流 / 风控 / 浏览量去重"]),
          ("文件存储", ["/data/uploads 原图", "缩略图 + 无主文件清理"])]),
    ]

    layer_h = {}
    for name, color, h, big, cols in layers:
        layer_h[name] = (y, h)
        s.rect(x0, y, w, h, fill=bg_of(color), stroke=fg_of(color), rx=12, sw=1.3)
        s.text(x0 - 18, y + h / 2 + 4, name, size=14, weight="700", anchor="end", fill=fg_of(color))
        s.text(x0 + 18, y + 24, big, size=13, weight="700", anchor="start", fill=fg_of(color))
        iy, ih = y + 38, h - 52
        n = len(cols)
        cw = (w - 36 - 10 * (n - 1)) / n
        cx = x0 + 18
        for title_, texts in cols:
            s.rect(cx, iy, cw, ih, fill="#FFFFFF", stroke=fg_of(color), rx=8, sw=1.0, op=0.97)
            s.text(cx + cw / 2, iy + 18, title_, size=12.2, weight="700", fill=fg_of(color))
            yy = iy + 36
            for t in texts:
                for ln in wrap_cn(t, int(cw / 7.1)):
                    s.text(cx + 12, yy, ln, size=11.3, fill=C["ink2"], anchor="start")
                    yy += 15.5
                yy += 2
            cx += cw + 10
        y += h + 16

    # 层间箭头
    for i in range(len(layers) - 1):
        name = layers[i][0]
        y_top, h = layer_h[name]
        s.arrow(x0 + w / 2, y_top + h + 1, x0 + w / 2, y_top + h + 15, stroke=C["ink3"], sw=1.3)

    # 运维支撑
    rx, rw = 1130, 70
    s.rect(rx - 20, 104, 90, y - 120, fill="#FAFBFD", stroke=C["border"], rx=12, dash="5 4")
    s.text(rx + 25, 132, "运维支撑", size=12.5, weight="700", fill=C["ink2"])
    ops = ["定时任务：\n失物过期 / 无主图片清理\n/ 逻辑删除数据清理",
           "日志：\nlogback 滚动\n+ traceId 贯穿",
           "监控：\n接口错误率与\n响应时间告警",
           "备份：\nmysqldump 全量\n+ binlog 增量（7 天）",
           "部署：\nDocker Compose\n一键启停"]
    oy = 162
    for t in ops:
        for i, ln in enumerate(t.split("\n")):
            s.text(rx, oy, ln, size=10.6, fill=C["ink2"], anchor="start")
            oy += 14
        oy += 12
    s.save("02-系统架构图")


# ============================================================
# 图 3 · 数据库 ER 图
# ============================================================
def fig03_er():
    entities = {
        "sys_user": ("sys_user", "用户表（用户 + 管理员）", [
            ("PK", "id  BIGINT"), ("UK", "username  VARCHAR(32)"), ("", "password  VARCHAR(100)"),
            ("", "nickname  VARCHAR(32)"), ("UK", "phone  VARCHAR(20)"), ("", "wechat  VARCHAR(32)"),
            ("", "avatar  VARCHAR(255)"), ("", "role  TINYINT  1用户/2管理员"),
            ("", "status  TINYINT  1正常/0禁用"), ("", "last_login_time  DATETIME"),
            ("", "last_login_ip  VARCHAR(64)"), ("", "deleted  TINYINT"),
            ("", "create_time / update_time")]),
        "item_record": ("item_record", "信息记录主表（失物 + 招领）", [
            ("PK", "id  BIGINT"), ("", "type  TINYINT  1失物/2招领"),
            ("FK", "publisher_id → sys_user.id"), ("", "title  VARCHAR(100)"),
            ("FK", "category_id → category.id"), ("", "area_type  TINYINT  1校内/2校外"),
            ("FK", "location_id → location.id"), ("", "location_detail  详细地址"),
            ("", "happen_time  DATETIME"), ("", "description  TEXT"),
            ("", "is_anonymous  TINYINT  1匿名发布"),
            ("", "handover_address / handover_phone"),
            ("", "contact_name / phone / wechat"),
            ("", "status  TINYINT  1发布中/2已结束"),
            ("", "claim_status  TINYINT  0暂未认领/1认领中"),
            ("", "claim_count  SMALLINT  有效认领人数"),
            ("", "view_count / favorite_count  INT"),
            ("", "finish_time / expire_time"), ("", "deleted  TINYINT"),
            ("", "create_time / update_time")]),
        "category": ("category", "物品分类字典", [
            ("PK", "id  BIGINT"), ("UK", "name  VARCHAR(32)"), ("", "icon  VARCHAR(64)"),
            ("", "sort  INT"), ("", "status  TINYINT  1启用/0停用"),
            ("", "deleted  TINYINT"), ("", "create_time / update_time")]),
        "location": ("location", "地点字典（一 / 二级）", [
            ("PK", "id  BIGINT"), ("FK", "parent_id  0 表示一级"), ("", "name  VARCHAR(64)"),
            ("", "level  TINYINT  1/2"), ("", "full_name  VARCHAR(128)"), ("", "sort  INT"),
            ("", "status / deleted  TINYINT"), ("", "create_time / update_time")]),
        "item_image": ("item_image", "信息图片表", [
            ("PK", "id  BIGINT"), ("FK", "item_id → item_record.id"),
            ("", "url  VARCHAR(255)"), ("", "thumb_url  VARCHAR(255)"), ("", "sort  TINYINT"),
            ("", "file_size / width / height"), ("", "deleted  TINYINT"), ("", "create_time")]),
        "item_favorite": ("item_favorite", "收藏表", [
            ("PK", "id  BIGINT"), ("FK", "user_id → sys_user.id"),
            ("FK", "item_id → item_record.id"), ("UK", "(user_id, item_id)  防重复收藏"),
            ("", "create_time")]),
        "sys_operation_log": ("sys_operation_log", "操作日志表", [
            ("PK", "id  BIGINT"), ("FK", "operator_id → sys_user.id"),
            ("", "operator_name  VARCHAR(32)"), ("", "module / action  VARCHAR(32)"),
            ("", "target_id  BIGINT"), ("", "detail  VARCHAR(500)"), ("", "ip  VARCHAR(64)"),
            ("", "create_time")]),
        "sys_login_log": ("sys_login_log", "登录日志表", [
            ("PK", "id  BIGINT"), ("FK", "user_id → sys_user.id"), ("", "account  VARCHAR(64)"),
            ("", "result  TINYINT  1成功/0失败"), ("", "fail_reason  VARCHAR(64)"),
            ("", "ip / user_agent"), ("", "create_time")]),
        "item_claim": ("item_claim", "失物认领申请表（认领不排他）", [
            ("PK", "id  BIGINT"), ("FK", "item_id → item_record.id（仅失物）"),
            ("FK", "claimant_id → sys_user.id（实名）"), ("FK", "publisher_id → sys_user.id"),
            ("", "claim_note  VARCHAR(500)  认领说明"),
            ("", "status  TINYINT  1认领中/2已完成/3超时断开/4已取消"),
            ("", "start_time  申请时间"), ("", "expire_time = 申请 + 72 小时"),
            ("", "last_chat_time  最近私聊时间"), ("", "finish_time / finish_reason"),
            ("", "deleted / create_time / update_time")]),
        "claim_message": ("claim_message", "认领沟通消息表（站内私聊）", [
            ("PK", "id  BIGINT"), ("FK", "claim_id → item_claim.id"),
            ("FK", "sender_id / receiver_id → sys_user.id"), ("", "content  VARCHAR(500)  纯文本"),
            ("", "read_flag  TINYINT  1已读/0未读"), ("", "create_time")]),
    }

    BW, HDR, ROW = 340, 44, 17.0
    layout = {
        "sys_user": (40, 108), "item_image": (410, 108),
        "category": (780, 108), "location": (1150, 108),
        "sys_operation_log": (1120, 560), "sys_login_log": (1120, 860),
        "item_record": (780, 620), "item_favorite": (520, 920),
        "item_claim": (40, 1130), "claim_message": (420, 1180),
    }
    heights = {k: HDR + 15 + len(v[2]) * ROW + 8 for k, v in entities.items()}
    pos = {name: (xy[0], xy[1], BW, heights[name]) for name, xy in layout.items()}

    s = SVG(1540, 1560)
    s.title("图 3  数据库实体关系图（ER）",
            "10 张业务表；不建物理外键，由应用层维护引用完整性；业务主表统一逻辑删除 deleted；认领与私聊表支撑「提交申请 + 72 小时计时」")

    def draw(name):
        x, y, w, h = pos[name]
        core = (name == "item_record")
        s.rect(x, y, w, h, fill=C["blue_bg"] if core else "#FFFFFF",
               stroke=C["blue"] if core else C["gray_bd"], rx=10, sw=1.5 if core else 1.2)
        s.rect(x, y, w, HDR, fill=C["blue"] if core else C["gray_bg"], stroke="none", rx=10)
        s.rect(x, y + HDR - 12, w, 12, fill=C["blue"] if core else C["gray_bg"], stroke="none", rx=0)
        s.text(x + 14, y + 21, entities[name][0], size=12.8, weight="700", anchor="start",
               fill="#FFFFFF" if core else C["ink"])
        s.text(x + 14, y + 37, entities[name][1], size=10.6, anchor="start",
               fill="#D6E3FF" if core else C["ink3"])
        yy = y + HDR + 15
        for tag, f in entities[name][2]:
            if tag:
                col = {"PK": C["red"], "FK": C["blue"], "UK": C["orange"]}.get(tag, C["ink3"])
                s.rect(x + 12, yy - 11, 24, 15, fill="#FFFFFF", stroke=col, rx=3, sw=0.9)
                s.text(x + 24, yy + 0.5, tag, size=9.4, fill=col, weight="700")
                s.text(x + 44, yy, f, size=11.2, anchor="start", fill=C["ink"])
            else:
                s.text(x + 12, yy, "·  " + f, size=11.2, anchor="start", fill=C["ink2"])
            yy += ROW

    for n in entities:
        draw(n)

    def edge(name, side):
        x, y, w, h = pos[name]
        return {"L": (x, y + HDR / 2 + 24), "R": (x + w, y + HDR / 2 + 24),
                "T": (x + w / 2, y), "B": (x + w / 2, y + h)}[side]

    def tag(x, y, text_, color="ink2"):
        w = len(text_) * 6.4 + 12
        s.rect(x - w / 2, y - 11, w, 20, fill="#FFFFFF", stroke=C["border"], rx=4, sw=0.8)
        s.text(x, y + 3.5, text_, size=10.4, fill=C[color])

    def elbow_between(a, sa, b, sb, label, color="ink3", dash=None, tagpos=0.5):
        """两点之间绘制折线并标注基数"""
        (x1, y1), (x2, y2) = edge(a, sa), edge(b, sb)
        if sa in ("L", "R") and sb in ("L", "R"):
            midx = (x1 + x2) / 2
            d = f"M {x1:.1f} {y1:.1f} L {midx:.1f} {y1:.1f} L {midx:.1f} {y2:.1f} L {x2:.1f} {y2:.1f}"
            tx, ty = midx, y1 + (y2 - y1) * tagpos
        else:
            midy = (y1 + y2) / 2
            d = f"M {x1:.1f} {y1:.1f} L {x1:.1f} {midy:.1f} L {x2:.1f} {midy:.1f} L {x2:.1f} {y2:.1f}"
            tx, ty = x1 + (x2 - x1) * tagpos, midy
        s.path(d, stroke=C[color], sw=1.1, dash=dash)
        s.one_bar(x1, y1, sa if sa in ("L", "R") else "left")
        if sb == "R":
            s.crow(x2 + 10, y2, "left")
        elif sb == "L":
            s.crow(x2 - 10, y2, "right")
        elif sb == "T":
            s.crow(x2, y2 - 10, "right")
        else:
            s.crow(x2, y2 + 10, "right")
        if label:
            tag(tx, ty, label)

    elbow_between("sys_user", "R", "item_image", "L", "1 : N  发布")
    elbow_between("category", "B", "item_record", "T", "1 : N  归类")
    elbow_between("location", "B", "item_record", "T", "1 : N  发生于", tagpos=0.45)
    elbow_between("item_image", "R", "item_favorite", "L", "1 : N  含图片", tagpos=0.3)
    elbow_between("item_record", "L", "item_favorite", "R", "N : N  收藏", tagpos=0.55)
    elbow_between("item_claim", "R", "claim_message", "L", "1 : N  站内私聊", tagpos=0.5)
    elbow_between("sys_user", "R", "sys_operation_log", "L", "1 : N  操作审计（弱关联）", dash="4 3", tagpos=0.5)
    elbow_between("sys_user", "R", "sys_login_log", "L", "1 : N  登录审计（弱关联）", dash="4 3", tagpos=0.5)

    # sys_user → item_claim（从左侧与下方绕行，避免与其它表交叉）
    s.path("M 40 220 L 16 220 L 16 1090 L 210 1090 L 210 1130", stroke=C["ink3"], sw=1.1)
    s.one_bar(32, 220, "left")
    s.crow(210, 1120, "right")
    tag(120, 1046, "1 : N  发起认领（实名）")

    # item_record → item_claim（从左侧绕行）
    x1r, y1r = edge("item_record", "L")
    x2t, y2t = edge("item_claim", "T")
    s.path(f"M {x1r} {y1r + 90} L 120 {y1r + 90} L 120 {y2t - 70} L 250 {y2t - 70} L 250 {y2t}",
           stroke=C["ink3"], sw=1.1)
    s.one_bar(x1r - 8, y1r + 90, "left")
    s.crow(250, y2t - 10, "right")
    tag(430, y2t - 70, "1 : N  被认领")

    # location 自关联
    x, y, w, h = pos["location"]
    s.path(f"M {x + w} {y + 78} L {x + w + 30} {y + 78} L {x + w + 30} {y - 30} L {x + w - 190} {y - 30}",
           stroke=C["ink3"], sw=1.05)
    tag(x + w - 90, y - 30, "自关联 parent_id（1 : N）")

    # 图例
    ly = 1330
    s.rect(40, ly, 1460, 140, fill="#FAFBFD", stroke=C["border"], rx=10)
    s.text(64, ly + 26, "图例", size=12.5, weight="700", anchor="start")
    for i, (t, col) in enumerate([("PK", C["red"]), ("FK", C["blue"]), ("UK", C["orange"])]):
        x = 120 + i * 170
        s.rect(x, ly + 15, 24, 15, fill="#FFFFFF", stroke=col, rx=3, sw=0.9)
        s.text(x + 12, ly + 26.5, t, size=9.4, fill=col, weight="700")
        s.text(x + 34, ly + 26, {"PK": "主键", "FK": "逻辑外键（应用层维护）", "UK": "唯一约束"}[t],
               size=11, anchor="start", fill=C["ink2"])
    s.rect(660, ly + 13, 16, 16, fill=C["blue_bg"], stroke=C["blue"], rx=3, sw=1.2)
    s.text(684, ly + 26, "核心业务表", size=11, anchor="start", fill=C["ink2"])
    s.line(800, ly + 21, 850, ly + 21, stroke=C["ink3"], sw=1.05, dash="4 3")
    s.text(862, ly + 26, "审计型弱关联（无业务约束）", size=11, anchor="start", fill=C["ink2"])

    s.text(64, ly + 56, "索引要点：item_record 建有 idx_type_status_time / idx_status_time / idx_category_status_time / idx_area_location_status / "
                        "idx_claim_status_time / idx_publisher_status / idx_happen_time / idx_expire，", size=11, anchor="start", fill=C["ink3"])
    s.text(64, ly + 74, "遵循「等值条件在前、范围与排序在后」的顺序，使「状态 + 类型 + 分类/地点（校内/校外）/认领状态」筛选与 create_time 排序能同时走索引。",
           size=11, anchor="start", fill=C["ink3"])
    s.text(64, ly + 96, "认领规则：同一条失物允许多条 status = 1 的认领同时存在（不排他）；item_claim.expire_time = 申请时间 + 72 小时，超时由定时任务置为 3 已超时断开；",
           size=11, anchor="start", fill=C["ink3"])
    s.text(64, ly + 114, "匿名发布：item_record.is_anonymous = 1 时前台隐藏昵称与联系方式，publisher_id 仍指向真实用户，管理员与操作日志可完整追溯。",
           size=11, anchor="start", fill=C["ink3"])
    s.text(64, ly + 132, "删除策略：用户与字典表逻辑删除；item_image 随主记录逻辑删除；item_favorite 为弱关系可直接物理删除；日志表只增不改，按保留期（90 / 180 天）清理。",
           size=11, anchor="start", fill=C["ink3"])
    s.save("03-数据库ER图")


# ============================================================
# 图 4 · 业务流程图
# ============================================================
def fig04_flow():
    s = SVG(1300, 980)
    s.title("图 4  核心业务流程图", "泳道 A：发布信息（写路径）    泳道 B：浏览与检索（读路径）")

    s.rect(40, 92, 620, 800, fill="#FBFCFF", stroke=C["blue_bd"], rx=12, dash="6 5")
    s.text(350, 118, "泳道 A · 用户发布信息（写路径）", size=13.5, weight="700", fill=C["blue"])
    s.rect(680, 92, 580, 800, fill="#FBFDFC", stroke=C["green_bd"], rx=12, dash="6 5")
    s.text(970, 118, "泳道 B · 浏览与检索（读路径）", size=13.5, weight="700", fill=C["green"])

    def step(cx, cy, w, h, text_, color="blue", shape="rect"):
        lines = wrap_cn(text_, int((w - 26) / 6.9))
        if shape == "round":
            s.rect(cx - w / 2, cy - h / 2, w, h, fill=bg_of(color), stroke=bd_of(color), rx=h / 2, sw=1.3)
        else:
            s.rect(cx - w / 2, cy - h / 2, w, h, fill=bg_of(color), stroke=bd_of(color), rx=8, sw=1.2)
        s.ctext(cx, cy, lines, size=12.1, fill=C["ink"])

    def arr(x1, y1, x2, y2, color="ink3"):
        s.arrow(x1, y1, x2, y2, stroke=C[color], sw=1.4)

    def branch_label(x, y, text_, color):
        w = len(text_) * 6.5 + 14
        s.rect(x - w / 2, y - 11, w, 20, fill="#FFFFFF", stroke=C["border"], rx=4, sw=0.8)
        s.text(x, y + 3.5, text_, size=10.4, fill=C[color])

    # ---- 泳道 A ----
    ax = 350
    step(ax, 158, 210, 44, "开始：进入发布页", "blue", "round")
    step(ax, 228, 330, 46, "选择类型（失物 / 招领），表单文案随类型切换")
    step(ax, 304, 330, 46, "填写：标题 · 分类 · 地点 · 时间 · 描述")
    step(ax, 380, 330, 46, "上传图片（可选，≤ 6 张，服务端压缩）")
    step(ax, 456, 330, 46, "填写联系方式（手机 / 微信至少一项）")
    step(ax, 540, 350, 54, "提交：前端校验 → 后端二次校验\n（必填 / 长度 / 时间 / 格式 / 频控）", "blue")
    step(ax - 200, 654, 130, 76, "提示错误并定位到对应字段", "red")
    step(ax + 30, 654, 220, 54, "校验通过，开启事务写入", "green")
    step(ax, 748, 310, 46, "提交成功，跳转详情页，信息公开展示")
    step(ax, 826, 210, 44, "结束", "blue", "round")

    arr(ax, 180, ax, 205, "blue")
    arr(ax, 251, ax, 281, "blue")
    arr(ax, 327, ax, 357, "blue")
    arr(ax, 403, ax, 433, "blue")
    arr(ax, 479, ax, 513, "blue")

    s.path(f"M {ax - 60} 567 L {ax - 60} 592 L {ax - 200} 592 L {ax - 200} 616", stroke=C["red"], sw=1.4, marker="ah")
    branch_label(ax - 120, 592, "校验不通过", "red")
    s.path(f"M {ax + 60} 567 L {ax + 60} 590 L {ax + 30} 590 L {ax + 30} 627", stroke=C["green"], sw=1.4, marker="ah")
    branch_label(ax + 118, 590, "校验通过", "green")

    s.path(f"M {ax - 200} 692 L {ax - 200} 720 L {ax - 132} 720 L {ax - 132} 456", stroke=C["red"], sw=1.3, dash="5 4")
    s.arrow(ax - 145, 456, ax - 162, 456, stroke=C["red"], sw=1.3)
    s.text(ax - 268, 730, "返回修改，保留已填内容", size=10.4, fill=C["red"], anchor="start")
    s.arrow(ax + 30, 681, ax + 10, 725, stroke=C["green"], sw=1.4)
    s.text(ax + 52, 700, "同时写操作日志、清理列表缓存", size=10.4, fill=C["ink3"], anchor="start")
    arr(ax, 771, ax, 804, "blue")

    # ---- 泳道 B ----
    bx = 970
    step(bx, 158, 210, 44, "开始：进入首页", "green", "round")
    step(bx, 228, 350, 46, "输入关键词 / 选择分类 · 地点 · 时间 · 排序")
    step(bx, 306, 370, 54, "后端组装查询条件\n（一级地点自动展开为自身 + 启用子级）", "green")
    step(bx, 396, 310, 46, "数据库索引过滤 + 物理分页")
    step(bx, 478, 350, 54, "批量装配分类名 / 地点名 / 首图缩略图（防 N+1）")
    step(bx, 560, 310, 46, "返回列表（含命中总数与分页信息）")
    step(bx, 648, 330, 46, "前端渲染卡片，关键词命中高亮")
    step(bx - 160, 748, 160, 64, "空态：换关键词引导\n+ 同分类推荐 3 条", "orange")
    step(bx + 110, 748, 190, 64, "点击卡片进入详情页\n（联系方式登录可见）", "green")
    step(bx, 840, 210, 44, "结束", "green", "round")

    arr(bx, 180, bx, 205, "green")
    arr(bx, 251, bx, 279, "green")
    arr(bx, 333, bx, 373, "green")
    arr(bx, 419, bx, 451, "green")
    arr(bx, 505, bx, 537, "green")
    arr(bx, 583, bx, 625, "green")

    s.path(f"M {bx - 70} 671 L {bx - 70} 700 L {bx - 160} 700 L {bx - 160} 716", stroke=C["orange"], sw=1.4, marker="ah")
    branch_label(bx - 118, 700, "结果为空", "orange")
    s.path(f"M {bx + 70} 671 L {bx + 70} 700 L {bx + 110} 700 L {bx + 110} 716", stroke=C["green"], sw=1.4, marker="ah")
    branch_label(bx + 152, 700, "有结果", "green")
    s.arrow(bx - 90, 780, bx - 60, 818, stroke=C["orange"], sw=1.3, dash="5 4")
    s.arrow(bx + 110, 780, bx + 30, 818, stroke=C["green"], sw=1.4)

    # 写 → 读
    s.path("M 662 748 L 758 748", stroke=C["ink3"], sw=1.3, dash="6 4", marker="ah")
    s.rect(656, 728, 106, 20, fill="#FFFFFF", stroke=C["border"], rx=4, sw=0.8)
    s.text(709, 742, "发布后立即可检索", size=10.4, fill=C["ink2"])

    # 底部：失物认领流程（叠加在主流程之上）
    s.rect(40, 902, 1220, 46, fill="#FBFDFF", stroke=C["blue_bd"], rx=10, dash="5 4")
    s.text(62, 930, "认领流程（仅失物）：失主浏览失物 → 提交认领申请（填写特征说明）→ 平台自动开启站内私聊 → 双方沟通核对 → 发布人确认归还（记录置「已结束」）；"
                    "超过 72 小时未沟通或未完成 → 该条认领自动断开，其他人仍可继续申请。",
           size=10.6, anchor="start", fill=C["ink2"])

    s.save("04-业务流程图")


# ============================================================
# 图 5 · 状态机图
# ============================================================
def fig05_state():
    s = SVG(1220, 1030)
    s.title("图 5  信息记录状态机图",
            "item_record.status：1 发布中 ⇄ 2 已结束；认领在其上并行进行（item_claim.status：1 认领中 → 2 已完成 / 3 超时断开 / 4 已取消）")

    s.add(f'<circle cx="80" cy="300" r="10" fill="{C["ink"]}"/>')
    s.arrow(92, 300, 146, 300, stroke=C["ink"], sw=1.6)

    s.rect(154, 236, 306, 128, fill=C["blue_bg"], stroke=C["blue"], rx=14, sw=1.8)
    s.text(307, 274, "1   发布中", size=17, weight="700", fill=C["blue"])
    s.text(307, 300, "可被检索 · 联系方式可见 · 可编辑", size=11.4, fill=C["ink2"])
    s.text(307, 322, "失物：create_time + 30 天自动过期", size=11, fill=C["ink3"])
    s.text(307, 342, "招领：不过期，由拾获者手动结束", size=11, fill=C["ink3"])

    s.rect(760, 236, 306, 128, fill=C["gray_bg"], stroke=C["gray_bd"], rx=14, sw=1.8)
    s.text(913, 274, "2   已结束", size=17, weight="700", fill=C["ink2"])
    s.text(913, 300, "默认检索不可见 · 详情页提示「已结束」", size=11.4, fill=C["ink2"])
    s.text(913, 322, "数据保留，可重新上架", size=11, fill=C["ink3"])
    s.text(913, 342, "finish_time 记录结束时刻", size=11, fill=C["ink3"])

    # 1 → 2
    s.path("M 460 264 L 760 264", stroke=C["orange"], sw=1.6, marker="ah")
    s.rect(500, 212, 220, 42, fill="#FFFFFF", stroke=C["orange_bd"], rx=6, sw=1.0)
    s.text(610, 230, "用户标记已结束 / 管理员强制下架", size=11, fill=C["ink"])
    s.text(610, 246, "写入 finish_time 与操作日志", size=10.4, fill=C["ink3"])

    # 2 → 1
    s.path("M 760 336 L 460 336", stroke=C["green"], sw=1.6, marker="ah")
    s.rect(500, 344, 220, 42, fill="#FFFFFF", stroke=C["green_bd"], rx=6, sw=1.0)
    s.text(610, 362, "用户重新上架（仅发布人）", size=11, fill=C["ink"])
    s.text(610, 378, "清空 finish_time；失物顺延 30 天", size=10.4, fill=C["ink3"])

    # 自环：自动过期
    s.path("M 260 236 L 260 176 L 400 176 L 400 236", stroke=C["purple"], sw=1.5, marker="ah")
    s.rect(216, 140, 240, 38, fill="#FFFFFF", stroke=C["purple_bd"], rx=6, sw=1.0)
    s.text(336, 156, "定时任务 ExpireTask（每日 03:00）", size=10.6, fill=C["ink"])
    s.text(336, 171, "仅失物：expire_time < NOW()", size=10.3, fill=C["ink3"])

    # 删除终态
    s.add(f'<circle cx="1130" cy="300" r="17" fill="none" stroke="{C["red"]}" stroke-width="1.8"/>')
    s.add(f'<circle cx="1130" cy="300" r="10" fill="{C["red"]}"/>')
    s.text(1130, 258, "终态", size=11.4, fill=C["red"], weight="600")
    s.text(1130, 340, "逻辑删除 deleted = 1", size=11.4, fill=C["red"])
    s.text(1130, 358, "（用户删除 / 管理员强制删除）", size=10.4, fill=C["ink3"])
    s.path("M 1066 292 L 1108 296", stroke=C["red"], sw=1.6, marker="ah")
    s.text(1086, 282, "删除", size=10.4, fill=C["red"])
    s.path("M 307 364 L 307 480 L 1130 480 L 1130 322", stroke=C["red"], sw=1.4, dash="6 4", marker="ah")
    s.rect(560, 462, 280, 36, fill="#FFFFFF", stroke=C["red_bd"], rx=6, sw=1.0)
    s.text(700, 478, "发布人删除 / 管理员强制删除", size=10.7, fill=C["ink"])
    s.text(700, 492, "记录与图片一并置 deleted = 1，90 天后物理清理", size=10.3, fill=C["ink3"])

    # 合法迁移表
    s.rect(154, 540, 520, 150, fill="#FFFFFF", stroke=C["border"], rx=8)
    s.text(178, 562, "合法迁移（其余组合一律返回 2010）", size=11.4, weight="700", anchor="start")
    for i, (a, b, c) in enumerate([("1 发布中", "→ 2 已结束", "用户结束 / 管理员下架 / 自动过期"),
                                   ("2 已结束", "→ 1 发布中", "用户重新上架（仅发布人）"),
                                   ("任意状态", "→ 已删除", "发布人删除 / 管理员强制删除")]):
        yy = 584 + i * 17
        s.text(178, yy, a, size=10.6, anchor="start", fill=C["blue"] if i < 2 else C["ink2"])
        s.text(258, yy, b, size=10.6, anchor="start", fill=C["green"])
        s.text(360, yy, c, size=10.6, anchor="start", fill=C["ink2"])
    s.text(178, 648, "记录附加字段（不参与迁移，随认领变化更新）：", size=10.6, anchor="start", fill=C["ink"])
    s.text(178, 666, "claim_status：0 暂未认领（蓝色标识） / 1 认领中（黄色标识 n 人认领中）；claim_count：有效认领人数。",
           size=10.4, anchor="start", fill=C["ink3"])

    # 并行流程：认领
    s.rect(154, 700, 1046, 100, fill="#FAFBFD", stroke=C["border"], rx=8, dash="6 4")
    s.text(178, 726, "并行流程：认领（仅失物 type = 1）", size=11.4, weight="700", anchor="start", fill=C["ink2"])
    s.text(178, 750, "失主提交认领申请 → claim_status = 1、claim_count + 1，前台显示黄色「n 人认领中」；无有效申请时显示蓝色「暂未认领」。",
           size=10.6, anchor="start", fill=C["ink3"])
    s.text(178, 770, "认领不排他：其他失主仍可继续申请，由发布人根据物品特征自行判断；确认归还后可将记录置为 2 已结束。",
           size=10.6, anchor="start", fill=C["ink3"])
    s.text(178, 790, "超过 72 小时未沟通或未完成 → 该条认领自动断开（不影响其他人已提交的认领）。",
           size=10.6, anchor="start", fill=C["ink3"])

    # 认领状态机条
    cy = 860
    s.rect(60, cy - 24, 1150, 118, fill="#FBFDFF", stroke=C["blue_bd"], rx=10, dash="5 4")
    s.text(84, cy, "认领申请状态机（item_claim.status）", size=12, weight="700", anchor="start", fill=C["blue"])
    s.rect(120, cy + 26, 200, 46, fill=C["blue_bg"], stroke=C["blue_bd"], rx=10)
    s.text(220, cy + 54, "1  认领中", size=13, weight="700")
    s.rect(560, cy + 26, 200, 46, fill=C["green_bg"], stroke=C["green_bd"], rx=10)
    s.text(660, cy + 54, "2  已确认完成", size=13, weight="700")
    s.rect(880, cy + 6, 200, 46, fill=C["gray_bg"], stroke=C["gray_bd"], rx=10)
    s.text(980, cy + 34, "3  已超时断开", size=13, weight="700")
    s.rect(880, cy + 62, 200, 46, fill=C["red_bg"], stroke=C["red_bd"], rx=10)
    s.text(980, cy + 90, "4  已取消", size=13, weight="700")
    s.arrow(320, cy + 49, 556, cy + 49, stroke=C["green"], sw=1.5)
    s.text(438, cy + 36, "双方确认归还", size=10.4, fill=C["green"])
    s.arrow(760, cy + 45, 872, cy + 26, stroke=C["orange"], sw=1.5)
    s.text(880, cy - 14, "72 小时未沟通/未完成（定时任务每小时扫描）", size=10, anchor="start", fill=C["orange"])
    s.arrow(760, cy + 62, 868, cy + 88, stroke=C["red"], sw=1.4, dash="5 4")
    s.text(880, cy + 104, "申请人主动撤回", size=10, anchor="start", fill=C["red"])
    s.text(120, cy + 90, "同一失物可同时存在多条 status = 1 的认领（上限 5 条，超出返回 2012）", size=10.2, anchor="start", fill=C["ink3"])
    s.save("05-状态机图")


# ============================================================
# 图 6 · 页面导航图
# ============================================================
def fig06_nav():
    s = SVG(1320, 1010)
    s.title("图 6  页面导航地图",
            "用户端 10 个页面 + 管理端 5 个页面；虚线需登录，点线仅管理员可进入")

    def node(cx, cy, w, h, title_, sub=None, color="blue"):
        s.rect(cx - w / 2, cy - h / 2, w, h, fill=bg_of(color), stroke=bd_of(color), rx=10, sw=1.3)
        if sub:
            s.text(cx, cy - 3, title_, size=12.4, weight="700")
            s.text(cx, cy + 15, sub, size=10.2, fill=C["ink3"])
        else:
            s.text(cx, cy + 4.5, title_, size=12.4, weight="700")
        return (cx, cy, w, h)

    def link(a, b, color="ink3", label=None, dash=None, mid=None):
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        if abs(ax - bx) < 30:          # 垂直
            x1, y1 = ax, ay + ah / 2
            x2, y2 = bx, by - bh / 2
            s.arrow(x1, y1, x2, y2, stroke=C[color], sw=1.3, dash=dash)
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        else:                           # 水平
            x1, y1 = ax + aw / 2 * (1 if bx > ax else -1), ay
            x2, y2 = bx - bw / 2 * (1 if bx > ax else -1), by
            s.arrow(x1, y1, x2, y2, stroke=C[color], sw=1.3, dash=dash)
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if label:
            w = len(label) * 6.4 + 12
            s.rect(mx - w / 2, my - 11, w, 20, fill="#FFFFFF", stroke=C["border"], rx=4, sw=0.8)
            s.text(mx, my + 3.5, label, size=10.3, fill=C["ink2"])

    # 用户端
    s.rect(40, 100, 660, 700, fill="#FBFCFF", stroke=C["blue_bd"], rx=14, dash="6 5")
    s.text(70, 128, "用户端（游客 + 注册用户）", size=13.5, weight="700", fill=C["blue"], anchor="start")

    home = node(180, 196, 200, 54, "P01 首页", "检索入口 + 最新发布 + 分类", "blue")
    search = node(470, 196, 210, 54, "P02 搜索结果页", "关键词 + 类型/区域/认领", "blue")
    detail = node(530, 320, 220, 58, "P03 信息详情页", "联系方式（登录可见）+ 认领入口", "blue")
    login = node(150, 312, 160, 52, "P06 登录", "账号密码 + 回跳", "orange")
    register = node(150, 392, 160, 46, "P07 注册", "用户名 + 手机号", "orange")
    publish = node(340, 404, 180, 46, "P04 发布信息", "失物/招领 + 匿名 + 上交", "green")
    edit = node(540, 404, 170, 46, "P05 编辑信息", "仅发布人可进入", "green")
    p16 = node(250, 500, 200, 46, "P16 认领详情 / 站内私聊", None, "green")
    p17 = node(470, 500, 180, 46, "P17 我提交的认领", None, "green")
    profile = node(120, 590, 160, 46, "P08 资料维护", None, "purple")
    myitems = node(310, 590, 160, 46, "P09 我的发布", None, "purple")
    myfav = node(500, 590, 160, 46, "P10 我的收藏", None, "purple")

    link(home, search, "blue", "搜索 / 分类入口")
    link(search, detail, "blue", "点击卡片")
    link(home, detail, "blue", "点击卡片")
    link(home, login, "orange", "未登录时操作", dash="5 4")
    link(login, register, "orange", "去注册")
    link(login, publish, "orange", "登录成功回跳", dash="5 4")
    link(publish, edit, "green", "编辑")
    link(detail, p16, "green", "提交认领申请", dash="5 4")
    link(p17, p16, "green", None, dash="5 4")
    link(profile, myitems, "purple", None, dash="5 4")
    link(myitems, myfav, "purple", None, dash="5 4")
    link(myitems, p16, "green", "私聊 / 确认完成", dash="5 4")
    link(profile, p17, "green", "个人中心", dash="5 4")

    # 管理端
    s.rect(720, 100, 560, 520, fill="#FFFCF6", stroke=C["orange_bd"], rx=14, dash="6 5")
    s.text(750, 128, "管理端（仅管理员，入口按钮为橙色）", size=13.5, weight="700", fill=C["orange"], anchor="start")
    dash_b = node(1000, 196, 520, 56, "P11 数据概览", "总量 / 日增 / 有效率 / 认领完成率", "orange")
    cat = node(1000, 274, 520, 48, "P12 分类管理", "增删改查 · 启停", "orange")
    loc = node(1000, 342, 520, 48, "P13 地点管理", "校内 / 校外两类 · 一级二级 · 排序", "orange")
    usr = node(1000, 410, 520, 48, "P14 用户管理", "查询 · 启用 / 禁用", "orange")
    itm = node(1000, 478, 520, 48, "P15 信息管理", "查询（实名）· 强制下架（留痕）", "orange")
    clm = node(1000, 552, 520, 48, "P15b 认领管理", "认领列表 · 查看私聊 · 手动解除", "orange")
    for y1, y2 in [(224, 250), (298, 318), (366, 386), (434, 454), (502, 528)]:
        s.arrow(1000, y1, 1000, y2, stroke=C["orange"], sw=1.2)
    s.text(1000, 604, "「我要发布」（蓝）与「管理端」（橙）在顶部导航连成一个按钮组", size=10.6, fill=C["ink3"])

    # 图例
    s.rect(40, 750, 1240, 210, fill="#FFFFFF", stroke=C["border"], rx=12)
    s.text(64, 778, "图例与导航规则", size=13, weight="700", anchor="start")
    rules = [
        "实线：无需登录即可跳转；虚线：需要登录（未登录先跳 P06 并携带 redirect，登录成功回跳原页面）；点线：仅管理员可见入口，普通用户访问 /admin/** 静默回首页。",
        "检索条件（keyword / type / categoryId / areaType / locationId / claimStatus / sort / page）全部同步到 URL query，支持分享与前进后退。",
        "权限校验双保险：前端路由守卫控制入口，后端 Service 层校验资源归属（编辑他人信息返回 2005，认领自己的信息返回 2013）。",
        "匿名发布：前台只显示「匿名用户」且不展示联系方式，后台保留实名，管理员在 P15 / P14 可查。",
        "兜底路由 E01（404 / 信息不存在）：记录不存在或已删除时展示，并提供「返回首页」与「看看最新发布」入口。",
    ]
    yy = 800
    for r in rules:
        s.text(64, yy, "·   " + r, size=10.8, anchor="start", fill=C["ink2"])
        yy += 19

    # 认领相关页面
    s.rect(40, 872, 1240, 88, fill="#FBFDFF", stroke=C["blue_bd"], rx=10, dash="5 4")
    s.text(64, 898, "认领流程与界面：P03 详情页提交认领申请 → P16 认领详情与站内私聊（双方可见）→ 发布人在 P09 管理认领（私聊 / 确认完成 / 解除）→ "
                    "用户在 P17 查看我提交的认领与 72 小时倒计时 → 管理员在 P15 认领管理中查看或介入。", size=11, anchor="start", fill=C["blue"])
    s.text(64, 920, "标识规则：失物有 ≥1 条有效认领 → 黄色「n 人认领中」；无有效认领 → 蓝色「暂未认领」。列表项与详情页共用同一标识组件；"
                    "超过 72 小时未沟通或未完成的认领自动断开，标识与计数随之变化。", size=11, anchor="start", fill=C["ink3"])
    s.text(64, 942, "匿名记录：详情页联系方式替换为「匿名用户 + 引导站内私聊」，认领与私聊流程不受影响（发布人仍以实名在后台完成确认）。",
           size=11, anchor="start", fill=C["ink3"])
    s.save("06-页面导航图")


# ============================================================
# 图 7 · 部署架构图
# ============================================================
def fig07_deploy():
    s = SVG(1260, 820)
    s.title("图 7  部署架构图（单机 Docker Compose 形态）",
            "容量假设：2 核 4 G 应用机 + 200 G 数据盘；可平滑升级为应用与数据库分离部署")

    s.rect(60, 100, 1140, 78, fill=C["gray_bg"], stroke=C["gray_bd"], rx=12)
    s.text(96, 133, "用户终端", size=13, weight="700", anchor="start")
    for i, t in enumerate(["PC 浏览器", "手机浏览器", "平板", "（预留）小程序 / App"]):
        x = 240 + i * 240
        s.rect(x, 117, 200, 44, fill="#FFFFFF", stroke=C["gray_bd"], rx=8)
        s.text(x + 100, 144, t, size=12)

    s.arrow(630, 178, 630, 212, stroke=C["ink3"], sw=1.5)
    s.text(650, 200, "HTTPS / 443", size=11, anchor="start", fill=C["ink2"])

    s.rect(60, 212, 1140, 404, fill="#FCFDFF", stroke=C["blue_bd"], rx=14, dash="6 5")
    s.text(88, 238, "应用服务器（Linux · 2C4G · 公网 IP）", size=13, weight="700", fill=C["blue"], anchor="start")

    # Nginx
    s.rect(100, 262, 300, 330, fill=C["blue_bg"], stroke=C["blue_bd"], rx=12)
    s.text(250, 290, "Nginx 1.24（80 / 443）", size=13, weight="700", fill=C["blue"])
    yy = 318
    for k, v in [("/", "Vue dist 静态资源 + history 回退"),
                 ("/api/**", "反向代理 → Spring Boot :8080"),
                 ("/uploads/**", "图片目录只读映射（禁止执行）"),
                 ("限流", "IP 维度 600 次/分钟"),
                 ("安全", "Gzip · 缓存头 · HTTPS 证书")]:
        s.rect(120, yy, 84, 26, fill="#FFFFFF", stroke=C["blue_bd"], rx=6)
        s.text(162, yy + 18, k, size=11.2, fill=C["blue"], weight="600")
        for i, ln in enumerate(wrap_cn(v, 20)):
            s.text(212, yy + 12 + i * 15, ("→ " if i == 0 else "   ") + ln, size=10.8, anchor="start", fill=C["ink2"])
        yy += 52

    # 应用
    s.rect(440, 262, 300, 330, fill=C["green_bg"], stroke=C["green_bd"], rx=12)
    s.text(590, 290, "Spring Boot 3 应用（:8080）", size=13, weight="700", fill=C["green"])
    yy = 318
    for k, v in [("内嵌 Tomcat", "线程池 max 200"),
                 ("HikariCP", "连接池 5 ~ 20"),
                 ("JWT 鉴权", "无状态，可水平扩展"),
                 ("定时任务", "过期 / 清理，Redis 锁防重"),
                 ("日志", "/data/logs，按天滚动 30 天"),
                 ("监控", "Actuator + 错误率告警")]:
        s.rect(458, yy, 104, 26, fill="#FFFFFF", stroke=C["green_bd"], rx=6)
        s.text(510, yy + 18, k, size=11, fill=C["green"], weight="600")
        s.text(570, yy + 18, v, size=10.8, anchor="start", fill=C["ink2"])
        yy += 41

    # 数据组件
    s.rect(780, 262, 380, 330, fill="#FAFBFD", stroke=C["border"], rx=12)
    s.text(970, 290, "数据组件（同一 Compose 编排）", size=13, weight="700", fill=C["ink2"])
    yy = 314
    for name, color, desc in [
        ("MySQL 8.0  :3306", "red", "lost_found 库（8 表 + 视图）；buffer pool 1 G；每日 02:00 全量 + binlog 增量"),
        ("Redis 7.x  :6379", "orange", "字典与详情缓存、发布限流、登录风控、浏览量去重、定时任务锁"),
        ("文件存储 /data/uploads", "purple", "yyyy/MM/uuid.jpg + _thumb.jpg；预留 200 G；每周清理无主图片"),
        ("备份目录 /data/backup", "ink3", "保留 7 天并异地同步一份；每月演练一次恢复")]:
        h = 66
        s.rect(800, yy, 340, h, fill="#FFFFFF", stroke=bd_of(color), rx=8)
        s.text(816, yy + 21, name, size=11.8, weight="700", anchor="start", fill=fg_of(color))
        for i, ln in enumerate(wrap_cn(desc, 36)):
            s.text(816, yy + 40 + i * 15, ln, size=10.7, anchor="start", fill=C["ink2"])
        yy += h + 8

    s.arrow(400, 420, 438, 420, stroke=C["ink3"], sw=1.4)
    s.text(419, 410, "代理", size=10.4, fill=C["ink3"])
    s.arrow(740, 370, 778, 370, stroke=C["ink3"], sw=1.4)
    s.text(759, 360, "JDBC", size=10.4, fill=C["ink3"])
    s.arrow(740, 440, 778, 440, stroke=C["ink3"], sw=1.4)
    s.text(759, 430, "Redis", size=10.4, fill=C["ink3"])

    s.rect(60, 636, 550, 156, fill="#FFFFFF", stroke=C["border"], rx=12)
    s.text(88, 664, "运维与备份", size=12.5, weight="700", anchor="start")
    for i, t in enumerate(["Docker Compose 编排 nginx / api / mysql / redis 四个容器，一键启停",
                           "数据库全量 + binlog 增量备份，保留 7 天并异地存一份",
                           "接口错误率与响应时间配置告警阈值，日志统一查看",
                           "版本回滚：保留上一镜像与建表脚本，回滚流程演练一次",
                           "数据维护任务：失物过期、无主图片清理、逻辑删除数据清理"]):
        s.text(88, 690 + i * 20, "·  " + t, size=11, anchor="start", fill=C["ink2"])

    s.rect(640, 636, 560, 156, fill="#FFFFFF", stroke=C["border"], rx=12)
    s.text(668, 664, "安全边界", size=12.5, weight="700", anchor="start")
    for i, t in enumerate(["仅开放 80 / 443；3306 与 6379 只监听内网或本机，禁止公网暴露",
                           "上传目录独立挂载，Nginx 关闭脚本执行权限（noexec）",
                           "JWT 密钥与数据库口令通过环境变量注入，不写入配置文件与仓库",
                           "全站 HTTPS + HSTS；限流双层（Nginx IP 维度 + 应用用户维度）",
                           "联系方式非登录态脱敏，日志中手机号与密码永不落盘"]):
        s.text(668, 690 + i * 20, "·  " + t, size=11, anchor="start", fill=C["ink2"])
    s.save("07-部署架构图")


# ============================================================
# 图 8 · 发布接口时序图
# ============================================================
def fig08_sequence():
    s = SVG(1340, 940)
    s.title("图 8  发布信息接口时序图（POST /api/v1/items）",
            "鉴权 → 频控 → 校验 → 事务写入 → 缓存清理 全链路")

    actors = [("用户", "ink3", 100), ("发布页\nVue 3", "blue", 280),
              ("AuthInterceptor", "orange", 500), ("ItemController", "green", 720),
              ("ItemService", "purple", 940), ("MySQL / Redis", "red", 1200)]
    top, bottom = 148, 880

    for name, color, cx in actors:
        s.rect(cx - 80, 96, 160, 46, fill=bg_of(color), stroke=bd_of(color), rx=8, sw=1.3)
        s.ctext(cx, 119, name.split("\n"), size=12, weight="700")
        s.line(cx, 142, cx, bottom, stroke=C["line"], sw=1.1, dash="5 5")
        s.rect(cx - 62, bottom, 124, 20, fill=C["gray_bg"], stroke=C["border"], rx=5)

    def msg(x1, x2, y, text_, color="ink3", ret=False):
        s.arrow(x1, y, x2, y, stroke=C[color], sw=1.2 if ret else 1.5, dash="5 4" if ret else None)
        w = len(text_) * 6.4 + 16
        mx = (x1 + x2) / 2
        s.rect(mx - w / 2, y - 12, w, 22, fill="#FFFFFF", stroke=C["border"], rx=4, sw=0.8)
        s.text(mx, y + 3.5, text_, size=10.7, fill=C["ink"])

    def self(x, y, text_, color="ink3", h=34):
        s.path(f"M {x} {y} L {x + 74} {y} L {x + 74} {y + h} L {x + 4} {y + h}", stroke=C[color], sw=1.3, marker="ah")
        yy = y + 12
        for ln in wrap_cn(text_, 26):
            s.text(x + 82, yy, ln, size=10.4, anchor="start", fill=C["ink2"])
            yy += 15

    def note(x, y, w, text_, color="orange"):
        lines = wrap_cn(text_, int((w - 20) / 6.6))
        h = 14 + 15 * len(lines)
        s.rect(x, y, w, h, fill=bg_of(color), stroke=bd_of(color), rx=6, sw=1.0)
        for i, ln in enumerate(lines):
            s.text(x + 10, y + 17 + i * 15, ln, size=10.3, anchor="start", fill=C["ink2"])

    y = 186
    msg(100, 280, y, "① 点击「立即发布」（表单已本地校验）", "blue")
    y += 44
    msg(280, 500, y, "② POST /api/v1/items  +  Bearer Token", "blue")
    y += 40
    self(500, y, "解析 JWT、校验签名与过期；查询 Redis 判断账号是否被禁用；注入 UserContext", "orange", 46)
    y += 74
    note(410, y, 300, "失败分支：1001 未登录 / 1006 令牌过期 / 1005 账号被禁用 —— 直接返回，不进入业务层", "red")
    y += 60
    msg(500, 720, y, "③ 放行", "orange")
    y += 40
    self(720, y, "@Valid 校验 DTO：字段缺失或格式错误 → 2001", "green", 32)
    y += 60
    msg(720, 940, y, "④ publish(dto)", "green")
    y += 40
    self(940, y, "频控校验：60 秒 1 条 + 当日 10 条 + 总量 100 条 → 超限 2003", "purple", 46)
    y += 72
    msg(940, 1200, y, "⑤ 读取分类 / 地点（字典缓存，未命中回查 MySQL）", "purple")
    y += 38
    msg(1200, 940, y, "⑥ 返回字典数据", "red", ret=True)
    y += 44
    self(940, y, "业务校验：发生时间（2002）、联系方式（2006）、图片数量（2007）、同标题幂等（2011）", "purple", 46)
    y += 76
    note(830, y, 340, "事务开始 @Transactional：插入 item_record（expire_time = 失物 ? now + 30 天 : NULL）", "purple")
    y += 56
    msg(940, 1200, y, "⑦ INSERT item_record", "purple")
    y += 36
    msg(940, 1200, y, "⑧ INSERT item_image（批量，按 sort）", "purple")
    y += 36
    msg(940, 1200, y, "⑨ INSERT sys_operation_log", "purple")
    y += 44
    note(830, y, 340, "事务提交；删除 lf:item:hot 缓存（清理失败仅记录告警，不影响发布结果）", "green")
    y += 60
    msg(940, 720, y, "⑩ 返回记录 id = 20001", "green", ret=True)
    y += 42
    msg(720, 280, y, "⑪ Result{code:0, data:{id:20001}}", "green", ret=True)
    y += 42
    msg(280, 100, y, "⑫ 提示「发布成功」并跳转 /item/20001", "blue", ret=True)

    s.rect(60, 906, 1220, 26, fill="#FAFBFD", stroke=C["border"], rx=8)
    s.text(80, 924, "关键设计：图片先上传后引用（独立上传接口）；事务仅包住数据库写入；缓存清理采用「失败仅告警」的最终一致策略；"
                    "所有失败分支返回统一响应体并携带 traceId。", size=10.8, anchor="start", fill=C["ink2"])
    s.text(80, 946, "认领入口：12′ 之后，失主可调用 POST /api/v1/claims 提交认领申请（72 小时有效），并进入站内私聊；发布人确认归还后记录置为「已结束」。",
           size=10.8, anchor="start", fill=C["blue"])
    s.save("08-发布时序图")


if __name__ == "__main__":
    print("生成设计图 SVG：")
    fig01_usecase()
    fig02_architecture()
    fig03_er()
    fig04_flow()
    fig05_state()
    fig06_nav()
    fig07_deploy()
    fig08_sequence()
    print("完成，输出目录：", OUT_DIR)
