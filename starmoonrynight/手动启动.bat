@echo off
chcp 65001 >nul
title 失物招领系统 - 手动启动
cd /d "%~dp0"

set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

echo ============================================================
echo   失物招领系统 · 手动启动
echo ============================================================
echo.

rem ---------- 0. 环境检查 ----------
if not exist ".venv\Scripts\python.exe" (
  echo [错误] 未找到虚拟环境 .venv
  echo.
  echo   请先在本目录执行：
  echo     python -m venv .venv
  echo     .venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" python-multipart pillow
  echo.
  pause
  exit /b 1
)

rem ---------- 1. 释放端口：先停掉已在运行的旧实例 ----------
echo [1/3] 检查端口 %PORT% ...
set "OLDPID="
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"') do set "OLDPID=%%p"

if defined OLDPID (
  echo       端口被进程 %OLDPID% 占用，正在停止旧实例 ...
  taskkill /f /pid %OLDPID% >nul 2>&1
  rem 等待端口真正释放（ping 代替 timeout，避免重定向时 timeout 不可用）
  ping -n 3 127.0.0.1 >nul 2>&1
  echo       旧实例已停止。
) else (
  echo       端口空闲，无需处理。
)

rem ---------- 2. 启动服务 ----------
echo [2/3] 启动服务（本窗口保持打开；按 Ctrl+C 可停止服务）...
echo.
set "LF_HOST=0.0.0.0"
set "LF_PORT=%PORT%"

".venv\Scripts\python.exe" run.py

rem ---------- 3. 服务退出 ----------
echo.
echo ============================================================
echo   服务已停止。
echo ============================================================
pause >nul
