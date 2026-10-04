#!/usr/bin/env bash
# ============================================================
#  校园失物招领系统 · 一键启动（macOS / Linux / Git Bash）
#  用法：bash dev.sh  或  chmod +x dev.sh && ./dev.sh
#
#  会依次：检查环境 -> 建库导数据 -> 起后端 -> 起前端 -> 打开浏览器
#  Ctrl+C 会同时停止后端与前端。
# ============================================================

set -uo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

C_RESET=$'\033[0m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'

ok()   { printf "  %s[OK]%s %s\n" "$C_OK"   "$C_RESET" "$1"; }
warn() { printf "  %s[!]%s %s\n"  "$C_WARN" "$C_RESET" "$1"; }
die()  { printf "  %s[X]%s %s\n" "$C_ERR"  "$C_RESET" "$1"; echo; exit 1; }

echo
echo "============================================================"
echo "  校园失物招领系统 · 一键启动"
echo "============================================================"
echo

# 后台进程，供 trap 清理
API_PID=""
WEB_PID=""
cleanup() {
    echo
    echo "正在停止服务..."
    [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null
    [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
    wait 2>/dev/null
    echo "已停止。"
}
trap cleanup INT TERM

# ---------- 0. 环境检查 ----------
echo "[0/5] 检查基础环境..."

command -v go >/dev/null 2>&1 || die "未找到 go，请先安装 Go：https://go.dev/dl/"
ok "$(go version)"

command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js：https://nodejs.org/"
ok "Node $(node -v)"

HAS_DOCKER=1
command -v docker >/dev/null 2>&1 || HAS_DOCKER=0
if [ "$HAS_DOCKER" = "1" ]; then ok "docker 可用"; else warn "无 docker，将跳过数据库初始化"; fi

port_in_use() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
    else
        netstat -an 2>/dev/null | grep -q "[.:]$1 .*LISTEN"
    fi
}

# ---------- 1. .env ----------
echo
echo "[1/5] 准备后端配置..."

if [ ! -f server/.env ]; then
    [ -f server/.env.example ] || die "找不到 server/.env 与 server/.env.example"
    cp server/.env.example server/.env
    ok "已从 .env.example 生成 server/.env"
    warn "请检查 server/.env 里的 DB_PASSWORD 是否与你的 MySQL 一致"
else
    ok "server/.env 已存在"
fi

# 读取配置（去掉可能的 CRLF 与引号）
read_env() { grep -E "^$1=" server/.env | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'; }
DB_PASSWORD="$(read_env DB_PASSWORD)"
DB_NAME="$(read_env DB_NAME)"; [ -n "$DB_NAME" ] || DB_NAME=lost_found
[ -n "$DB_PASSWORD" ] || die "server/.env 中未读到 DB_PASSWORD"

# ---------- 2. 数据库 ----------
echo
echo "[2/5] 启动数据库并导入 schema / seed..."

if [ "$HAS_DOCKER" = "1" ]; then
    docker compose -f server/docker-compose.yml up -d || die "docker compose 启动失败"

    printf "  等待 MySQL 就绪"
    n=0
    until docker exec lostfound-mysql mysqladmin ping -h localhost -uroot -p"$DB_PASSWORD" >/dev/null 2>&1; do
        n=$((n+1)); [ "$n" -ge 60 ] && { echo; die "等待 MySQL 超时（约 60 秒）"; }
        printf "."; sleep 1
    done
    echo; ok "MySQL 已就绪"

    docker exec -i lostfound-mysql mysql -uroot -p"$DB_PASSWORD" --default-character-set=utf8mb4 \
        < server/sql/schema.sql >/dev/null 2>&1 || die "schema.sql 导入失败"
    ok "schema.sql 已导入"

    docker exec -i lostfound-mysql mysql -uroot -p"$DB_PASSWORD" --default-character-set=utf8mb4 "$DB_NAME" \
        < server/sql/seed.sql >/dev/null 2>&1 || die "seed.sql 导入失败"
    ok "seed.sql 已导入（3 个演示账号 + 演示帖子）"
else
    warn "跳过数据库初始化，请自行确保 MySQL 已就绪"
fi

# ---------- 3. 后端 ----------
echo
echo "[3/5] 启动 Go 后端..."

if port_in_use 8080; then
    warn "8080 已被占用，可能后端已在运行，跳过启动"
else
    ( cd server && go run ./cmd/api ) > /tmp/lostfound-api.log 2>&1 &
    API_PID=$!
    ok "后端已启动（PID $API_PID，日志 /tmp/lostfound-api.log）"
fi

printf "  等待后端就绪"
n=0
until curl -s http://localhost:8080/api/health 2>/dev/null | grep -q '"db"'; do
    n=$((n+1))
    if [ "$n" -ge 60 ]; then
        echo; warn "后端 60 秒未就绪，日志末尾："; tail -20 /tmp/lostfound-api.log 2>/dev/null
        break
    fi
    printf "."; sleep 1
done
[ "$n" -lt 60 ] && { echo; ok "后端健康检查通过"; }

# ---------- 4. 前端 ----------
echo
echo "[4/5] 启动 Vue 前端..."

if [ ! -d web/node_modules ]; then
    echo "  node_modules 不存在，先 npm install（可能需要几分钟）..."
    ( cd web && npm install ) || die "npm install 失败。可先设置镜像：npm config set registry https://registry.npmmirror.com"
    ok "依赖安装完成"
else
    ok "node_modules 已存在，跳过安装"
fi

if port_in_use 5173; then
    warn "5173 已被占用，可能前端已在运行，跳过启动"
else
    ( cd web && npm run dev ) > /tmp/lostfound-web.log 2>&1 &
    WEB_PID=$!
    ok "前端已启动（PID $WEB_PID，日志 /tmp/lostfound-web.log）"
fi

# ---------- 5. 打开浏览器 ----------
echo
echo "[5/5] 等待前端就绪..."

n=0
until port_in_use 5173; do
    n=$((n+1)); [ "$n" -ge 45 ] && { warn "前端 45 秒未就绪，日志末尾："; tail -20 /tmp/lostfound-web.log 2>/dev/null; break; }
    sleep 1
done

if [ "$n" -lt 45 ]; then
    sleep 2
    URL="http://localhost:5173"
    if command -v open >/dev/null 2>&1; then open "$URL"            # macOS
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"  # Linux
    else warn "无法自动打开浏览器，请手动访问 $URL"; fi
    ok "已尝试打开浏览器"
fi

echo
echo "============================================================"
echo "  启动完成"
echo "============================================================"
echo
echo "  前端：  http://localhost:5173"
echo "  后端：  http://localhost:8080/api/health"
echo
echo "  测试账号（密码统一 123456，不是 123456）："
echo "    alice / bob / carol"
echo
echo "  建议 F12 切到手机模式（iPhone 12 Pro），本产品为移动端优先设计。"
echo
echo "  按 Ctrl+C 停止后端与前端。"
echo

wait
