# -*- coding: utf-8 -*-
"""内网部署最终验证：逐个入口用局域网 IP 访问一遍"""
import json
import socket
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.db import scalar  # noqa: E402


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main() -> int:
    ip = local_ip()
    print("=" * 66)
    print(f"内网部署验证 · 局域网 IP = {ip}")
    print("=" * 66)

    ok = 0
    fail = 0
    for label, path in (("健康检查", "/api/health"), ("首页", "/"), ("检索页", "/search.html"),
                        ("详情页", "/item.html?id=2"), ("发布页", "/publish.html"),
                        ("登录页", "/login.html"), ("管理后台", "/admin.html"),
                        ("数据库管理台", "/db.html"), ("静态样式", "/static/style.css"),
                        ("静态脚本", "/static/app.js"), ("示例图片", "/uploads/seed/2_0.jpg")):
        url = f"http://{ip}:8000{path}"
        try:
            with urllib.request.urlopen(url, timeout=8) as r:
                size = len(r.read())
                print(f"  [OK]   {label:<12} {path:<24} HTTP {r.status}  {size} bytes")
                ok += 1
        except Exception as exc:                                     # noqa: BLE001
            print(f"  [FAIL] {label:<12} {path:<24} {exc}")
            fail += 1

    print("-" * 66)
    print(f"数据库统计：用户 {scalar('SELECT COUNT(*) FROM sys_user WHERE deleted = 0')} · "
          f"信息 {scalar('SELECT COUNT(*) FROM item_record WHERE deleted = 0')} · "
          f"认领 {scalar('SELECT COUNT(*) FROM item_claim WHERE deleted = 0')} · "
          f"私聊 {scalar('SELECT COUNT(*) FROM claim_message')}")
    print(f"结果：通过 {ok} 项，失败 {fail} 项")
    print(f"使用者访问地址： http://{ip}:8000")
    print(f"管理后台：       http://{ip}:8000/admin.html")
    print(f"数据库管理台：   http://{ip}:8000/db.html")
    print("=" * 66)
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
