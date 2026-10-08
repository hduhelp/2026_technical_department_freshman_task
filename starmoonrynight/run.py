# -*- coding: utf-8 -*-
"""失物招领系统 · 启动脚本

用法：
    .venv\\Scripts\\python.exe run.py              启动服务（默认 0.0.0.0:8000）
    .venv\\Scripts\\python.exe run.py --port 8080  指定端口
    .venv\\Scripts\\python.exe run.py --init-only 仅初始化数据库后退出
"""
import argparse
import socket
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from server.config import ensure_dirs, settings          # noqa: E402
from server.db import init_db, scalar                    # noqa: E402


def local_ips() -> list[str]:
    ips: list[str] = []
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


def print_banner(port: int) -> None:
    print("=" * 70)
    print(f"  {settings.app_name}  v{settings.version}")
    print("=" * 70)
    print(f"  数据库文件 : {settings.db_path}")
    print(f"  上传目录   : {settings.upload_dir}")
    print(f"  备份目录   : {settings.backup_dir}")
    print("-" * 70)
    print(f"  本机访问   : http://127.0.0.1:{port}")
    for ip in local_ips():
        print(f"  局域网访问 : http://{ip}:{port}")
    print(f"  接口文档   : http://127.0.0.1:{port}/api/docs")
    print(f"  数据库管理 : http://127.0.0.1:{port}/db.html   （需管理员登录）")
    print("-" * 70)
    print("  默认账号   : admin / Admin@123456      （管理员）")
    print("              zhangsan / User@123456     （普通用户）")
    print("  正式上线前请务必修改管理员密码！")
    print("=" * 70)


def main() -> int:
    parser = argparse.ArgumentParser(description="失物招领系统启动脚本")
    parser.add_argument("--host", default=None, help="监听地址，默认 0.0.0.0（允许局域网访问）")
    parser.add_argument("--port", type=int, default=None, help="监听端口，默认 8000")
    parser.add_argument("--init-only", action="store_true", help="只初始化数据库后退出")
    parser.add_argument("--no-seed", action="store_true", help="初始化时不写入演示数据")
    args = parser.parse_args()

    ensure_dirs()
    init_db(seed=not args.no_seed)
    print(f"[初始化完成] 用户 {scalar('SELECT COUNT(*) FROM sys_user')} 个 · "
          f"信息 {scalar('SELECT COUNT(*) FROM item_record')} 条 · "
          f"分类 {scalar('SELECT COUNT(*) FROM category')} 个 · "
          f"地点 {scalar('SELECT COUNT(*) FROM location')} 个")

    if args.init_only:
        return 0

    from server.services import seed_images
    made = seed_images.ensure_placeholder_images()
    if made:
        print(f"[占位图] 生成 {made} 张示例图片")

    host = args.host or settings.host
    port = args.port or settings.port
    print_banner(port)

    import uvicorn
    uvicorn.run("server.main:app", host=host, port=port, reload=False, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
