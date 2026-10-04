@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  校园失物招领系统 · 一键启动（Windows）
REM  用法：双击本文件，或在终端执行 dev.bat
REM
REM  流程：检查环境 -> 建库导数据 -> 起后端 -> 起前端 -> 打开浏览器
REM  后端/前端各自在新窗口运行；关闭本窗口不会停止它们。
REM ============================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   校园失物招领系统 · 一键启动
echo ============================================================
echo.

REM ---------- 0. 环境检查 ----------
echo [0/5] 检查基础环境...

where go >nul 2>nul
if errorlevel 1 (
    echo   [X] 未找到 go，请先安装 Go 并加入 PATH
    echo       下载：https://go.dev/dl/
    goto :fail
)
for /f "tokens=*" %%v in ('go version') do echo   [OK] %%v

where node >nul 2>nul
if errorlevel 1 (
    echo   [X] 未找到 node，请先安装 Node.js 并加入 PATH
    echo       下载：https://nodejs.org/
    goto :fail
)
for /f "tokens=*" %%v in ('node -v') do echo   [OK] Node %%v

set "HAS_DOCKER=1"
where docker >nul 2>nul
if errorlevel 1 set "HAS_DOCKER=0"
if "!HAS_DOCKER!"=="1" (
    echo   [OK] docker 可用
) else (
    echo   [!] 未找到 docker，将跳过数据库初始化
    echo       如果你用的是本机 MySQL，请自行确保：
    echo         - MySQL 已在 127.0.0.1:3306 运行
    echo         - 已建库 lost_found，且已导入 sql\schema.sql 与 sql\seed.sql
)

REM ---------- 1. 准备 .env ----------
echo.
echo [1/5] 准备后端配置...

if not exist "server\.env" (
    if not exist "server\.env.example" (
        echo   [X] 找不到 server\.env 也找不到 server\.env.example
        goto :fail
    )
    copy "server\.env.example" "server\.env" >nul
    echo   [OK] 已从 .env.example 生成 server\.env
) else (
    echo   [OK] server\.env 已存在
)

REM 读取 DB_PASSWORD / DB_NAME（供建库与连通性检查使用）
set "DB_PASSWORD="
set "DB_NAME=lost_found"
for /f "usebackq tokens=1,* delims==" %%a in ("server\.env") do (
    if /i "%%a"=="DB_PASSWORD" set "DB_PASSWORD=%%b"
    if /i "%%a"=="DB_NAME" set "DB_NAME=%%b"
)
REM 去掉可能的首尾空格与回车
for /f "tokens=* delims= " %%p in ("!DB_PASSWORD!") do set "DB_PASSWORD=%%p"
if "!DB_PASSWORD!"=="" (
    echo   [X] server\.env 中未读到 DB_PASSWORD
    goto :fail
)

REM ---------- 2. 数据库 ----------
echo.
echo [2/5] 启动数据库并导入 schema / seed...

if "!HAS_DOCKER!"=="1" (
    echo   正在启动 MySQL 容器...
    docker compose -f server\docker-compose.yml up -d
    if errorlevel 1 (
        echo   [X] docker compose 启动失败
        goto :fail
    )

    echo   等待 MySQL 就绪...
    set /a WAIT=0
    :waitloop
    docker exec lostfound-mysql mysqladmin ping -h localhost -uroot -p!DB_PASSWORD! >nul 2>nul
    if errorlevel 1 (
        set /a WAIT+=1
        if !WAIT! GEQ 60 (
            echo.
            echo   [X] 等待 MySQL 超时（约 60 秒）
            echo       常见原因：server\.env 的 DB_PASSWORD 与
            echo       server\docker-compose.yml 的 MYSQL_ROOT_PASSWORD 不一致。
            goto :fail
        )
        <nul set /p "=."
        timeout /t 1 /nobreak >nul
        goto :waitloop
    )
    echo.
    echo   [OK] MySQL 已就绪

    echo   导入 schema.sql ...
    docker exec -i lostfound-mysql mysql -uroot -p!DB_PASSWORD! --default-character-set=utf8mb4 < server\sql\schema.sql
    if errorlevel 1 (
        echo   [X] schema.sql 导入失败
        goto :fail
    )
    echo   [OK] schema.sql 已导入

    echo   导入 seed.sql ...
    docker exec -i lostfound-mysql mysql -uroot -p!DB_PASSWORD! --default-character-set=utf8mb4 !DB_NAME! < server\sql\seed.sql
    if errorlevel 1 (
        echo   [X] seed.sql 导入失败
        goto :fail
    )
    echo   [OK] seed.sql 已导入（3 个演示账号 + 演示帖子）
) else (
    echo   [!] 跳过数据库初始化
)

REM ---------- 3. 后端 ----------
echo.
echo [3/5] 启动 Go 后端（新窗口）...

netstat -ano | findstr ":8080 " | findstr LISTENING >nul 2>nul
if not errorlevel 1 (
    echo   [!] 8080 已被占用，可能后端已在运行，跳过启动
) else (
    start "lostfound-api" cmd /k "cd /d "%~dp0server" && go run ./cmd/api"
    echo   [OK] 后端已在新窗口启动
)

echo   等待后端就绪...
set /a WAIT=0
:waitapi
curl -s http://localhost:8080/api/health 2>nul | findstr "db" >nul 2>nul
if errorlevel 1 (
    set /a WAIT+=1
    if !WAIT! GEQ 60 (
        echo.
        echo   [!] 后端 60 秒内未就绪，请查看 "lostfound-api" 窗口的报错
        goto :skipapi
    )
    <nul set /p "=."
    timeout /t 1 /nobreak >nul
    goto :waitapi
)
echo.
echo   [OK] 后端健康检查通过（db: up）
:skipapi

REM ---------- 4. 前端 ----------
echo.
echo [4/5] 启动 Vue 前端（新窗口）...

if not exist "web\node_modules" (
    echo   node_modules 不存在，先执行 npm install（可能需要几分钟）...
    pushd web
    call npm install
    if errorlevel 1 (
        popd
        echo   [X] npm install 失败。建议先设置国内镜像：
        echo       npm config set registry https://registry.npmmirror.com
        goto :fail
    )
    popd
    echo   [OK] 依赖安装完成
) else (
    echo   [OK] node_modules 已存在，跳过安装
)

netstat -ano | findstr ":5173 " | findstr LISTENING >nul 2>nul
if not errorlevel 1 (
    echo   [!] 5173 已被占用，可能前端已在运行，跳过启动
) else (
    start "lostfound-web" cmd /k "cd /d "%~dp0web" && npm run dev"
    echo   [OK] 前端已在新窗口启动
)

REM ---------- 5. 打开浏览器 ----------
echo.
echo [5/5] 等待前端就绪并打开浏览器...
set /a WAIT=0
:waitweb
netstat -ano | findstr ":5173 " | findstr LISTENING >nul 2>nul
if errorlevel 1 (
    set /a WAIT+=1
    if !WAIT! GEQ 45 (
        echo.
        echo   [!] 前端 45 秒内未就绪，请查看 "lostfound-web" 窗口
        goto :skipweb
    )
    <nul set /p "=."
    timeout /t 1 /nobreak >nul
    goto :waitweb
)
timeout /t 2 /nobreak >nul
start http://localhost:5173
echo.
echo   [OK] 已打开浏览器
:skipweb

echo.
echo ============================================================
echo   启动完成
echo ============================================================
echo.
echo   前端：  http://localhost:5173
echo   后端：  http://localhost:8080/api/health
echo.
echo   测试账号（密码统一 123456，注意不是 123456）：
echo     alice  小明     联系方式已公开，用于演示可见性规则
echo     bob    小红     联系方式默认隐藏
echo     carol  管理员
echo.
echo   建议按 F12 切到手机模式（iPhone 12 Pro）——本产品为移动端优先设计。
echo.
echo   停止服务：关闭 "lostfound-api" 与 "lostfound-web" 两个窗口。
echo   停止数据库：docker compose -f server\docker-compose.yml down
echo.
pause
goto :eof

:fail
echo.
echo ------------------------------------------------------------
echo   启动中断，请按上面的提示排查后重试。
echo ------------------------------------------------------------
echo.
pause
exit /b 1
