@echo off
chcp 65001 >nul
title 失物招领系统 - 安装开机自启
cd /d "%~dp0"

echo ============================================================
echo   安装「开机自动启动失物招领服务」
echo ============================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [提示] 当前不是管理员权限，创建开机任务需要管理员。
  echo        请右键本文件 -^> 以管理员身份运行。
  echo.
  pause
  exit /b 1
)

set TASKNAME=LostFoundServer
set PY=%~dp0.venv\Scripts\python.exe
set WORKDIR=%~dp0

if not exist "%PY%" (
  echo [错误] 未找到虚拟环境解释器：%PY%
  pause
  exit /b 1
)

echo 任务名称 : %TASKNAME%
echo 执行程序 : %PY%
echo 参数     : run.py --port 8000
echo 起始目录 : %WORKDIR%
echo.

schtasks /Query /TN "%TASKNAME%" >nul 2>&1
if not errorlevel 1 (
  echo [信息] 已存在同名任务，将先删除再重建。
  schtasks /Delete /TN "%TASKNAME%" /F >nul
)

schtasks /Create /TN "%TASKNAME%" /SC ONLOGON /RL HIGHEST /F ^
  /TR "\"%PY%\" run.py --port 8000" ^
  /ST 00:00

if errorlevel 1 (
  echo.
  echo [失败] 任务创建失败，请改用「任务计划程序」图形界面手动添加：
  echo        触发器：登录时   操作：启动程序 %PY%   参数：run.py --port 8000   起始于：%WORKDIR%
) else (
  echo.
  echo [成功] 已创建登录时自动启动的任务。
  echo        立即启动一次： schtasks /Run /TN "%TASKNAME%"
  echo        停止服务：     schtasks /End /TN "%TASKNAME%"
  echo        卸载自启：     schtasks /Delete /TN "%TASKNAME%" /F
  echo.
  echo 建议同时放行防火墙端口（只需一次）：
  echo   New-NetFirewallRule -DisplayName "失物招领系统 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Any
)

echo.
echo 是否现在就启动一次服务？(Y/N)
set /p ANS=
if /i "%ANS%"=="Y" schtasks /Run /TN "%TASKNAME%"

echo.
pause
