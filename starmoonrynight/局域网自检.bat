@echo off
chcp 65001 >nul
title 失物招领系统 - 局域网自检
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ============================================================
echo   失物招领系统 · 局域网访问自检
echo ============================================================
echo.

set PORT=8000

rem ---------- 1. 本机 IP ----------
echo [1/6] 本机局域网 IP
set IPS=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set RAW=%%a
  set RAW=!RAW: =!
  if not "!RAW!"=="" (
    echo     !RAW!
    if "!IPS!"=="" (set IPS=!RAW!)
  )
)
if "!IPS!"=="" (
  echo     [警告] 未找到 IPv4 地址，请检查网络连接
)
echo.

rem ---------- 2. 端口监听 ----------
echo [2/6] 端口 %PORT% 监听状态
set LISTEN=
for /f "tokens=*" %%a in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
  echo     %%a
  set LISTEN=1
)
if "!LISTEN!"=="" (
  echo     [未监听] 服务可能没有启动，请先双击 启动服务.bat
) else (
  echo     [正常] 服务正在监听
)
echo.

rem ---------- 3. 本机 HTTP 自检 ----------
echo [3/6] 本机接口自检  http://127.0.0.1:%PORT%/api/health
powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 8 -UseBasicParsing; $j=$r.Content|ConvertFrom-Json; Write-Host ('    正常  code=' + $j.code + '  用户' + $j.data.counts.users + ' 信息' + $j.data.counts.items + ' 认领' + $j.data.counts.claims) }catch{ Write-Host '    失败：' $_.Exception.Message }"
echo.

rem ---------- 4. 局域网 HTTP 自检 ----------
echo [4/6] 局域网接口自检  http://!IPS!:%PORT%/api/health
if not "!IPS!"=="" (
  powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -Uri 'http://!IPS!:%PORT%/api/health' -TimeoutSec 8 -UseBasicParsing; Write-Host '    正常  局域网地址可用' }catch{ Write-Host '    失败：' $_.Exception.Message }"
) else (
  echo     [跳过] 未获取到 IP
)
echo.

rem ---------- 5. 防火墙规则 ----------
echo [5/6] 防火墙规则（名称：失物招领系统 %PORT%）
powershell -NoProfile -Command "$r = Get-NetFirewallRule -DisplayName '失物招领系统 %PORT%' -ErrorAction SilentlyContinue; if($r){ Write-Host ('    已存在  启用状态：' + $r.Enabled + '  方向：' + $r.Direction) } else { Write-Host '    [缺失] 其他电脑将无法访问，请用管理员 PowerShell 执行：'; Write-Host '    New-NetFirewallRule -DisplayName \"失物招领系统 %PORT%\" -Direction Inbound -Protocol TCP -LocalPort %PORT% -Action Allow -Profile Any' }"
echo.

rem ---------- 6. 睡眠设置提醒 ----------
echo [6/6] 电源设置（睡眠会中断服务）
powershell -NoProfile -Command "$s = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null; $line = ($s | Select-String '当前交流电源设置索引|Current AC Power Setting Index'); if($line){ Write-Host ('    ' + $line.ToString().Trim()) } else { Write-Host '    未读取到睡眠设置，建议手动确认为「从不」' }"
echo.

echo ============================================================
echo   把下面地址发给使用者的电脑/手机浏览器即可访问：
if not "!IPS!"=="" (
  echo       http://!IPS!:%PORT%
) else (
  echo       http://本机IP:%PORT%
)
echo.
echo   管理后台   http://!IPS!:%PORT%/admin.html
echo   数据库管理台 http://!IPS!:%PORT%/db.html
echo ============================================================
echo.
pause
