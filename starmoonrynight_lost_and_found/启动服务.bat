@echo off
chcp 65001 >nul
title 失物招领系统 - 服务端
cd /d "%~dp0"

echo ============================================================
echo   失物招领系统  启动中...
echo ============================================================

if not exist ".venv\Scripts\python.exe" (
  echo [错误] 未找到虚拟环境 .venv
  echo        请先执行： python -m venv .venv
  echo                   .venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]" python-multipart pillow
  pause
  exit /b 1
)

set LF_HOST=0.0.0.0
if "%LF_PORT%"=="" set LF_PORT=8000

echo   监听端口：%LF_PORT%
echo   局域网内其他电脑请用  http://本机IP:%LF_PORT%  访问
echo   按 Ctrl+C 可停止服务
echo ============================================================
echo.

".venv\Scripts\python.exe" run.py --port %LF_PORT%
pause
