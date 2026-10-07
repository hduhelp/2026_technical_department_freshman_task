# -*- coding: utf-8 -*-
"""端到端接口自测：覆盖登录、发布、检索、认领、私聊、管理端全流程（使用标准库 urllib）"""
import io
import json
import mimetypes
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8000"
PASS, FAIL = [], []
KWD = urllib.parse.quote("自测")          # 中文查询参数需要 URL 编码


def call(method: str, path: str, body=None, token=None, form=None, timeout=20):
    url = BASE + path
    headers = {}
    data = None
    if form is not None:
        boundary = "----lf" + uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in form.items():
            buf.write(f"--{boundary}\r\n".encode())
            if isinstance(v, tuple):
                filename, content, ctype = v
                buf.write(f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'.encode())
                buf.write(f"Content-Type: {ctype}\r\n\r\n".encode())
                buf.write(content)
                buf.write(b"\r\n")
            else:
                buf.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return json.loads(raw), e.code
        except json.JSONDecodeError:
            return {"code": e.code, "message": raw[:200]}, e.code


def check(name: str, cond: bool, extra: str = ""):
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (f"  {extra}" if extra and not cond else ""))


def main() -> int:
    print("=" * 72)
    print("失物招领系统 · 端到端接口自测")
    print("=" * 72)

    # 1. 健康检查
    r, _ = call("GET", "/api/health")
    check("健康检查可用", r.get("code") == 0, str(r)[:200])
    print("      ", r.get("data", {}).get("counts"))

    # 2. 管理员 / 用户登录
    r, _ = call("POST", "/api/v1/auth/login", {"account": "admin", "password": "Admin@123456"})
    check("管理员登录", r.get("code") == 0, str(r)[:200])
    admin_token = r.get("data", {}).get("accessToken")

    r, _ = call("POST", "/api/v1/auth/login", {"account": "zhangsan", "password": "User@123456"})
    check("普通用户登录", r.get("code") == 0, str(r)[:200])
    user_token = r.get("data", {}).get("accessToken")
    user_id = r.get("data", {}).get("user", {}).get("id")

    r, _ = call("POST", "/api/v1/auth/login", {"account": "wangwu", "password": "User@123456"})
    other_token = r.get("data", {}).get("accessToken")
    check("第二用户登录", r.get("code") == 0)

    r, _ = call("POST", "/api/v1/auth/login", {"account": "zhangsan", "password": "WrongPass1"})
    check("错误密码被拒", r.get("code") == 2001, str(r)[:120])

    # 3. 字典
    r, _ = call("GET", "/api/v1/categories")
    cats = r.get("data", {}).get("list", [])
    check("分类字典", len(cats) >= 10, str(r)[:120])
    r, _ = call("GET", "/api/v1/locations/tree")
    loc = r.get("data", {})
    check("地点字典按校内/校外出", len(loc.get("campus", [])) > 0 and len(loc.get("outside", [])) > 0)
    campus_loc = loc["campus"][0]["id"]
    outside_loc = loc["outside"][0]["id"]
    cat_id = cats[0]["id"]

    # 4. 未登录访问受限接口
    r, _ = call("POST", "/api/v1/items", {"type": 1})
    check("未登录发布被拒（1001）", r.get("code") == 1001, str(r)[:120])

    # 5. 匿名发布（含区域/详细地址/匿名）
    title = f"自测-黑色蓝牙耳机丢失-{int(time.time())}"
    r, _ = call("POST", "/api/v1/items", {
        "type": 1, "title": title, "categoryId": cat_id, "areaType": 1, "locationId": campus_loc,
        "locationDetail": "体育馆东侧看台第三排", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "自测数据：右耳壳有划痕，装在蓝色硅胶保护壳内，可能在打球时掉落。",
        "contactPhone": "13800001111", "contactWechat": "zs_2025", "isAnonymous": True, "images": [],
    }, token=user_token)
    check("发布信息（匿名 + 校内 + 详细地址）", r.get("code") == 0, str(r)[:200])
    item_id = r.get("data", {}).get("id")

    # 6. 频率限制
    r, _ = call("POST", "/api/v1/items", {
        "type": 1, "title": "自测-频率限制-应被拒绝", "categoryId": cat_id, "areaType": 1,
        "locationId": campus_loc, "locationDetail": "测试地址", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "这条应该因为 60 秒频率限制被拒绝，用于验证限流逻辑是否生效。",
        "contactPhone": "13800001111",
    }, token=user_token)
    check("60 秒发布频率限制生效（2003）", r.get("code") == 2003, str(r)[:160])

    # 7. 地点与区域不匹配
    r, _ = call("POST", "/api/v1/items", {
        "type": 1, "title": "自测-区域地点不匹配", "categoryId": cat_id, "areaType": 1,
        "locationId": outside_loc, "locationDetail": "测试地址", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "区域选校内但地点选校外，应该被拒绝，用于验证校验逻辑。",
        "contactPhone": "13800001111",
    }, token=user_token)
    check("区域与地点不匹配被拒（2001）", r.get("code") == 2001, str(r)[:160])

    # 8. 失物信息禁止上交地址（上交地址由拾获人登记，仅招领可填）
    r, _ = call("POST", "/api/v1/items", {
        "type": 1, "title": "自测-失物不应带上交地址", "categoryId": cat_id, "areaType": 1,
        "locationId": campus_loc, "locationDetail": "测试地址", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "失物信息填写上交地址应该被拒绝，用于验证字段适用范围。",
        "contactPhone": "13800001111", "handoverAddress": "图书馆服务台",
    }, token=user_token)
    check("失物信息填写上交地址被拒（2001）", r.get("code") == 2001, str(r)[:160])

    # 9. 带图片发布（上传 → 引用）
    png = _make_png()
    r, _ = call("POST", "/api/v1/images", token=user_token,
                form={"file": ("test.png", png, "image/png")})
    check("图片上传（含压缩与缩略图）", r.get("code") == 0, str(r)[:200])
    img_url = r.get("data", {}).get("url")
    img_thumb = r.get("data", {}).get("thumbUrl")

    with urllib.request.urlopen(BASE + (img_thumb or ""), timeout=10) as resp:
        check("缩略图可访问", resp.status == 200 and len(resp.read()) > 100)

    # 图片归属校验：他人不能引用我上传的图片
    r, _ = call("POST", "/api/v1/items", {
        "type": 2, "title": "自测-引用他人图片应被拒", "categoryId": cat_id, "areaType": 1,
        "locationId": campus_loc, "locationDetail": "测试地址", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "引用他人上传的图片应该被服务器拒绝，用于验证图片归属校验。",
        "contactPhone": "13700003333", "images": [img_url],
    }, token=other_token)
    check("不能引用他人上传的图片（2004）", r.get("code") == 2004, str(r)[:160])

    # 新建一条带图的招领信息（图片由同一个账号上传）
    r, _ = call("POST", "/api/v1/images", token=other_token,
                form={"file": ("card.png", _make_png((34, 160, 107)), "image/png")})
    card_img = r.get("data", {}).get("url")
    r, _ = call("POST", "/api/v1/items", {
        "type": 2, "title": f"自测-捡到一张校园卡-{int(time.time())}", "categoryId": cat_id, "areaType": 1,
        "locationId": campus_loc, "locationDetail": "图书馆一楼大厅自助借还机旁",
        "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "自测数据：卡面姓名模糊，尾部编号 0482，已交至图书馆一楼服务台。",
        "contactPhone": "13700003333", "images": [card_img],
        "handoverAddress": "图书馆一楼服务台", "handoverPhone": "13866668888",
    }, token=other_token)
    check("发布招领信息（带图片引用与上交地址）", r.get("code") == 0, str(r)[:200])
    card_item_id = r.get("data", {}).get("id") if isinstance(r.get("data"), dict) else None

    # 招领登记的上交地址应在详情页作为首选联系方式展示
    r, _ = call("GET", f"/api/v1/items/{card_item_id}", token=other_token)
    ho = (r.get("data") or {}).get("handover") or {}
    check("招领上交地址在详情页优先展示",
          ho.get("enabled") is True and ho.get("address") == "图书馆一楼服务台"
          and ho.get("phone") == "13866668888", str(ho)[:200])

    # 10. 检索
    r, _ = call("GET", f"/api/v1/items?keyword={KWD}&status=1&page=1&size=20")
    check("关键词检索", r.get("code") == 0 and r["data"]["total"] >= 2, str(r)[:160])
    r, _ = call("GET", "/api/v1/items?areaType=1&sort=newest")
    check("按校内筛选", r.get("code") == 0, str(r)[:120])
    r, _ = call("GET", f"/api/v1/items?locationId={campus_loc}")
    check("按地点筛选", r.get("code") == 0, str(r)[:120])
    r, _ = call("GET", "/api/v1/items?keyword=%25")
    check("通配符 % 被转义（不返回全部）", r.get("code") == 0 and r["data"]["total"] == 0, str(r)[:160])

    # 11. 详情：匿名脱敏
    r, _ = call("GET", f"/api/v1/items/{item_id}")
    d = r.get("data", {})
    check("匿名信息对游客隐藏身份",
          d.get("publisherNickname") == "匿名用户" and d.get("publisher") is None
          and d.get("contact", {}).get("visible") is False, json.dumps(d.get("contact"), ensure_ascii=False)[:160])

    r, _ = call("GET", f"/api/v1/items/{item_id}", token=user_token)
    check("发布人本人可见自己的匿名信息", r["data"].get("publisher") is not None, str(r)[:160])

    r, _ = call("GET", f"/api/v1/items/{item_id}", token=admin_token)
    check("管理员可见匿名记录实名", r["data"].get("publisher", {}).get("nickname") == "张三", str(r)[:160])

    # 12. 详情：联系方式脱敏 / 登录可见
    r, _ = call("GET", f"/api/v1/items/{card_item_id}")
    check("游客看到脱敏手机号", "****" in (r["data"].get("contactPhone") or ""), str(r["data"].get("contactPhone")))
    r, _ = call("GET", f"/api/v1/items/{card_item_id}", token=user_token)
    check("登录后可见完整手机号", r["data"].get("contactPhone") == "13700003333", str(r["data"].get("contactPhone")))

    # 13. 认领流程
    r, _ = call("POST", "/api/v1/claims", {"itemId": item_id, "claimNote": "这是我的耳机，右耳壳有划痕，蓝色保护壳。"},
                token=other_token)
    check("提交认领申请", r.get("code") == 0, str(r)[:200])
    claim_id = r.get("data", {}).get("claimId")
    check("认领有效期 72 小时", r.get("data", {}).get("timeoutHours") == 72)

    r, _ = call("POST", "/api/v1/claims", {"itemId": item_id, "claimNote": "重复提交应该返回已有申请。"},
                token=other_token)
    check("重复提交认领幂等", r.get("code") == 0 and r["data"]["claimId"] == claim_id, str(r)[:160])

    r, _ = call("POST", "/api/v1/claims", {"itemId": item_id, "claimNote": "发布人不能认领自己的信息。"},
                token=user_token)
    check("发布人不能认领自己的信息（2013）", r.get("code") == 2013, str(r)[:160])

    r, _ = call("GET", f"/api/v1/items/{item_id}")
    claim_vo = r["data"]["claim"]
    check("详情显示 N 人认领中（认领中标识）",
          claim_vo["status"] == 1 and claim_vo["statusName"] == "1 人认领中", str(claim_vo)[:200])

    # 用一条刚创建且无人认领的失物验证「暂未认领」蓝色标识（换一个账号以避开 60 秒发布频率限制）
    r, _ = call("POST", "/api/v1/auth/login", {"account": "zhaoliu", "password": "User@123456"})
    zl_token = r["data"]["accessToken"]
    r, _ = call("POST", "/api/v1/items", {
        "type": 1, "title": f"自测-无人认领的失物-{int(time.time())}", "categoryId": cat_id, "areaType": 2,
        "locationId": outside_loc, "locationDetail": "校门口公交站 302 路站牌旁",
        "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "自测数据：用于验证无认领时前台显示蓝色的「暂未认领」标识。",
        "contactPhone": "13600004444",
    }, token=zl_token)
    check("发布一条无人认领的失物", r.get("code") == 0, str(r)[:160])
    lone_item_id = r["data"]["id"] if isinstance(r.get("data"), dict) else None
    r, _ = call("GET", f"/api/v1/items/{lone_item_id}")
    check("无认领时显示暂未认领（蓝色标识）",
          bool(r.get("data")) and r["data"]["claim"]["status"] == 0
          and r["data"]["claim"]["statusName"] == "暂未认领",
          str(r.get("data", {}).get("claim") if isinstance(r.get("data"), dict) else r)[:200])

    r, _ = call("GET", "/api/v1/items?claimStatus=1")
    check("按认领状态筛选", r["code"] == 0 and r["data"]["total"] >= 1, str(r)[:160])

    # 认领不排他：第三个用户也能认领
    r, _ = call("POST", "/api/v1/auth/login", {"account": "lisi", "password": "User@123456"})
    lisi_token = r["data"]["accessToken"]
    r, _ = call("POST", "/api/v1/claims", {"itemId": item_id, "claimNote": "我也丢了一副耳机，想先确认一下是不是我的。"},
                token=lisi_token)
    check("认领不排他（第二人可认领）", r.get("code") == 0, str(r)[:160])
    r, _ = call("GET", f"/api/v1/items/{item_id}")
    check("认领人数变为 2", r["data"]["claim"]["count"] == 2, str(r["data"]["claim"])[:160])

    # 14. 站内私聊
    r, _ = call("POST", f"/api/v1/claims/{claim_id}/messages", {"content": "你好，这副耳机是我的。"},
                token=other_token)
    check("认领人发送私聊消息", r.get("code") == 0, str(r)[:160])
    r, _ = call("GET", f"/api/v1/claims/{claim_id}/messages", token=user_token)
    check("发布人可读私聊记录", r.get("code") == 0 and len(r["data"]["list"]) >= 2, str(r)[:160])
    r, _ = call("POST", f"/api/v1/claims/{claim_id}/messages", {"content": "抢答"},
                token=lisi_token)
    check("非认领双方不能发消息（2005）", r.get("code") == 2005, str(r)[:160])
    r, _ = call("GET", "/api/v1/claims/unread-count", token=user_token)
    check("未读消息统计", r.get("code") == 0, str(r)[:120])

    # 15. 越权
    r, _ = call("PUT", f"/api/v1/items/{card_item_id}", {
        "title": "越权修改测试", "categoryId": cat_id, "areaType": 1, "locationId": campus_loc,
        "locationDetail": "测试地址", "happenTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "description": "普通用户尝试修改他人信息，应该被拒绝（2005）。", "contactPhone": "13800001111",
    }, token=user_token)
    check("不能编辑他人信息（2005）", r.get("code") == 2005, str(r)[:160])
    r, _ = call("GET", "/api/v1/admin/users", token=user_token)
    check("普通用户访问管理端被拒（1007）", r.get("code") == 1007, str(r)[:160])

    # 16. 认领 72 小时超时断开（把 expire_time 改到过去，触发扫描）
    import sqlite3
    db = Path(__file__).resolve().parent / "data" / "lostfound.db"
    conn = sqlite3.connect(str(db))
    conn.execute("UPDATE item_claim SET expire_time = '2020-01-01 00:00:00' WHERE id = ?", (claim_id,))
    conn.commit()
    conn.close()
    r, _ = call("POST", "/api/v1/admin/claims/expire-scan", token=admin_token)
    check("执行超时扫描任务", r.get("code") == 0, str(r)[:160])
    r, _ = call("GET", f"/api/v1/items/{item_id}")
    check("超时认领自动断开（计数回落）", r["data"]["claim"]["count"] == 1,
          f"count={r['data']['claim']['count']} name={r['data']['claim']['statusName']}")
    r, _ = call("POST", f"/api/v1/claims/{claim_id}/messages", {"content": "断开后不能发消息"},
                token=other_token)
    check("断开后私聊只读（2014）", r.get("code") == 2014, str(r)[:160])

    # 17. 发布人确认认领完成（用剩下那条认领）
    r, _ = call("GET", f"/api/v1/items/{item_id}/claims", token=user_token)
    remain = r["data"]["list"]
    check("发布人可查看认领列表", r.get("code") == 0 and len(remain) == 1, str(r)[:200])
    if remain:
        cid = remain[0]["claimId"]
        r, _ = call("PATCH", f"/api/v1/claims/{cid}/finish", {"note": "已当面核对并归还"}, token=user_token)
        check("发布人确认认领完成", r.get("code") == 0, str(r)[:160])
        r, _ = call("GET", f"/api/v1/items/{item_id}")
        check("完成后记录显示暂未认领", r["data"]["claim"]["count"] == 0, str(r["data"]["claim"])[:160])

    # 18. 收藏
    r, _ = call("POST", "/api/v1/favorites", {"itemId": card_item_id}, token=user_token)
    check("收藏信息", r.get("code") == 0, str(r)[:120])
    r, _ = call("GET", "/api/v1/favorites", token=user_token)
    check("我的收藏列表", r.get("code") == 0 and r["data"]["total"] >= 1, str(r)[:120])

    # 19. 管理端
    r, _ = call("GET", "/api/v1/admin/statistics/overview", token=admin_token)
    st = r.get("data", {})
    check("统计概览接口", r.get("code") == 0 and "claimStat" in st, str(r)[:160])
    print("      统计：", json.dumps({k: st.get(k) for k in ("userTotal", "itemTotal", "activeItemTotal")},
                                     ensure_ascii=False), st.get("claimStat"))
    r, _ = call("GET", "/api/v1/admin/items?includeDeleted=1", token=admin_token)
    check("管理端信息列表（含实名）", r.get("code") == 0 and r["data"]["total"] >= 2, str(r)[:160])
    r, _ = call("PATCH", f"/api/v1/admin/items/{card_item_id}/offline", {"reason": "自测强制下架"}, token=admin_token)
    check("管理员强制下架", r.get("code") == 0, str(r)[:160])
    r, _ = call("GET", f"/api/v1/items/{card_item_id}")
    check("强制下架后状态为已结束", r["data"]["status"] == 2, str(r["data"].get("status")))

    # 20. 数据库管理台
    r, _ = call("GET", "/api/v1/admin/db/tables", token=admin_token)
    check("数据库管理台：表清单", r.get("code") == 0 and len(r["data"]["tables"]) >= 10, str(r)[:200])
    r, _ = call("GET", "/api/v1/admin/db/tables/item_claim?size=5", token=admin_token)
    check("数据库管理台：浏览表数据", r.get("code") == 0 and "columns" in r["data"], str(r)[:160])
    r, _ = call("POST", "/api/v1/admin/db/query", {"sql": "SELECT COUNT(*) AS c FROM item_record"}, token=admin_token)
    check("数据库管理台：SQL 查询", r.get("code") == 0 and r["data"]["rowCount"] == 1, str(r)[:200])
    r, _ = call("POST", "/api/v1/admin/db/query", {"sql": "DELETE FROM item_record"}, token=admin_token)
    check("SQL 写操作需显式授权（默认拒绝）", r.get("code") == 2001, str(r)[:160])
    r, _ = call("POST", "/api/v1/admin/db/backup", token=admin_token)
    check("数据库备份", r.get("code") == 0 and r["data"]["sizeKb"] > 0, str(r)[:200])
    r, _ = call("GET", "/api/v1/admin/db/health", token=admin_token)
    check("数据库健康检查", r["code"] == 0 and r["data"]["integrity"] == "ok", str(r)[:160])

    # 21. 页面可访问
    for page in ("/", "/index.html", "/search.html", "/item.html", "/publish.html",
                 "/login.html", "/register.html", "/my-items.html", "/my-claims.html",
                 "/my-favorites.html", "/profile.html", "/admin.html", "/db.html", "/static/app.js"):
        try:
            with urllib.request.urlopen(BASE + page, timeout=10) as resp:
                okpage = resp.status == 200 and len(resp.read()) > 200
        except Exception as exc:                                    # noqa: BLE001
            okpage = False
            print("      页面异常：", page, exc)
        check(f"页面可访问 {page}", okpage)

    print("=" * 72)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：")
        for f in FAIL:
            print("  -", f)
    print("=" * 72)
    return 1 if FAIL else 0


def _make_png(color=(47, 107, 255)) -> bytes:
    """生成一张真实的 PNG 用于上传测试"""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (900, 640), color).save(buf, "PNG")
    return buf.getvalue()


if __name__ == "__main__":
    sys.exit(main())
