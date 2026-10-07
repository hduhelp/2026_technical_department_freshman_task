# 阶段一接口测试：真实 HTTP 请求，使用 curl 的 Cookie 罐模拟浏览器行为
# 说明：curl 的 -c 保存 Cookie、-b 发送 Cookie，正好模拟"浏览器登录后自动带凭证"的过程
#
# 运行方式（在 lost-and-found 目录下）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_auth_api.ps1

param([int]$Port = 8000)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$BASE = "http://127.0.0.1:$Port"
$JAR  = Join-Path $PSScriptRoot 'cookies.txt'
if (Test-Path $JAR) { Remove-Item $JAR -Force }

$script:passed = 0
$script:failed = 0
$realToken = ''

function Show-Result {
    param([string]$Name, [string]$Response, [int]$Code, [string]$Expect)
    # $Expect 形如 "201"、"2xx"、"4xx"，用于区分"预期成功"和"预期失败"
    $ok = $false
    if ($Expect -match '^(\d)xx$') {
        $ok = ([math]::Floor($Code / 100) -eq [int]$Matches[1])
    } elseif ($Expect -match '^\d+$') {
        $ok = ($Code -eq [int]$Expect)
    }

    if ($ok) { $script:passed++ } else { $script:failed++ }
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    $color = if ($ok) { 'Green' } else { 'Red' }
    Write-Host ""
    Write-Host "[$mark] $Name" -ForegroundColor $color -NoNewline
    Write-Host "  期望=$Expect  实际=HTTP $Code"
    $short = $Response
    if ($short.Length -gt 300) { $short = $short.Substring(0, 300) + ' ...' }
    Write-Host "       $short"
}

function Call-Api {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [string]$Json = '',
        [string]$Expect = '2xx',
        [switch]$NoCookie,
        [switch]$UseCookie
    )
    # 注意：不要用 $args 作为变量名，它是 PowerShell 的保留自动变量
    $curlArgs = @('-s', '-w', "`n@@HTTP_CODE@@%{http_code}", '-X', $Method, "$BASE$Path")
    if ($UseCookie) { $curlArgs += @('-b', $JAR) }
    if (-not $NoCookie) { $curlArgs += @('-c', $JAR) }

    $tmp = $null
    if ($Json) {
        $tmp = Join-Path $env:TEMP ("lf_payload_{0}.json" -f ([guid]::NewGuid().ToString('N')))
        [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding($false)))
        # 只用 application/json，不加 charset：避免分号在 PowerShell 传参时被误解析
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$tmp")
    }

    $raw = & curl.exe @curlArgs 2>&1 | Out-String
    if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }

    $code = 0
    $body = $raw
    if ($raw -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') {
        $body = $Matches[1].Trim()
        $code = [int]$Matches[2]
    }
    Show-Result -Name $Name -Response $body -Code $code -Expect $Expect
    return $body
}

Write-Host "==================== 阶段一 认证接口测试 ====================" -ForegroundColor Cyan
$suffix = Get-Random -Minimum 1000 -Maximum 9999
$uname  = "hdu_test_$suffix"
$goodPwd = 'Hdu@2026pass'

# ---------- 1. 注册 ----------
Write-Host ""
Write-Host "--- 1. 注册新用户 ---" -ForegroundColor Yellow
Call-Api -Name "注册 $uname" -Method POST -Path '/api/auth/register' -Expect '201' -Json (
    @{ username = $uname; password = $goodPwd; display_name = '测试同学'; contact = 'QQ:123456' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 2. 重复注册 ----------
Write-Host ""
Write-Host "--- 2. 重复用户名注册（测数据库 UNIQUE 约束）---" -ForegroundColor Yellow
Call-Api -Name "重复注册 $uname" -Expect '409' -Method POST -Path '/api/auth/register' -NoCookie -Json (
    @{ username = $uname; password = 'AnotherPass123' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 3. 参数校验 ----------
Write-Host ""
Write-Host "--- 3. 参数校验 ---" -ForegroundColor Yellow
Call-Api -Name "弱密码 123" -Expect '422' -Method POST -Path '/api/auth/register' -NoCookie -Json (
    @{ username = 'weakpwd_user'; password = '123' } | ConvertTo-Json -Compress
) | Out-Null
Call-Api -Name "非法用户名（带空格和感叹号）" -Expect '422' -Method POST -Path '/api/auth/register' -NoCookie -Json (
    @{ username = 'bad name!'; password = 'GoodPass123' } | ConvertTo-Json -Compress
) | Out-Null
Call-Api -Name "缺少必填字段" -Expect '422' -Method POST -Path '/api/auth/register' -NoCookie -Json (
    @{ username = 'onlyname' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 4. 获取当前用户（Cookie 自动鉴权）----------
Write-Host ""
Write-Host "--- 4. 获取当前用户（验证 Cookie 鉴权）---" -ForegroundColor Yellow
Call-Api -Name "GET /api/auth/me（用注册时拿到的 Cookie）" -Expect '200' -Method GET -Path '/api/auth/me' -UseCookie | Out-Null

# ---------- 5. 未登录访问 ----------
Write-Host ""
Write-Host "--- 5. 未登录访问（测鉴权拦截）---" -ForegroundColor Yellow
Call-Api -Name "无凭证访问 /me" -Expect '401' -Method GET -Path '/api/auth/me' -NoCookie | Out-Null

# ---------- 6. 修改资料 ----------
Write-Host ""
Write-Host "--- 6. 修改个人资料 ---" -ForegroundColor Yellow
Call-Api -Name "PATCH /me 改昵称和联系方式" -Expect '200' -Method PATCH -Path '/api/auth/me' -UseCookie -Json (
    @{ display_name = '杭电小助手'; contact = '微信:hduhelp' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 7. 退出登录 ----------
Write-Host ""
Write-Host "--- 7. 退出登录 ---" -ForegroundColor Yellow
Call-Api -Name "POST /logout" -Expect '200' -Method POST -Path '/api/auth/logout' -UseCookie | Out-Null
Call-Api -Name "退出后 Cookie 已被清除，再访问 /me" -Expect '401' -Method GET -Path '/api/auth/me' -UseCookie | Out-Null

# ---------- 8. 重新登录 ----------
Write-Host ""
Write-Host "--- 8. 重新登录 ---" -ForegroundColor Yellow
Call-Api -Name "错误密码登录" -Expect '401' -Method POST -Path '/api/auth/login' -NoCookie -Json (
    @{ username = $uname; password = 'WrongPassword123' } | ConvertTo-Json -Compress
) | Out-Null
Call-Api -Name "不存在的用户登录" -Expect '401' -Method POST -Path '/api/auth/login' -NoCookie -Json (
    @{ username = 'nobody_here_9999'; password = 'WhateverPass123' } | ConvertTo-Json -Compress
) | Out-Null
$loginBody = Call-Api -Name "正确密码登录" -Expect '200' -Method POST -Path '/api/auth/login' -Json (
    @{ username = $uname; password = $goodPwd } | ConvertTo-Json -Compress
)
Call-Api -Name "登录后用新 Cookie 取 /me" -Expect '200' -Method GET -Path '/api/auth/me' -UseCookie | Out-Null

# ---------- 9. 用户名大小写不敏感 ----------
Write-Host ""
Write-Host "--- 9. 用户名大小写不敏感 ---" -ForegroundColor Yellow
Call-Api -Name "用大写 $($uname.ToUpper()) 登录" -Expect '200' -Method POST -Path '/api/auth/login' -NoCookie -Json (
    @{ username = $uname.ToUpper(); password = $goodPwd } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 10. token 防伪造 ----------
Write-Host ""
Write-Host "--- 10. token 防伪造（核心安全验证）---" -ForegroundColor Yellow
if ($loginBody -match '"access_token"\s*:\s*"([^"]+)"') {
    $realToken = $Matches[1]

    # 10a. 篡改签名：把签名段最后 4 个字符换掉，模拟攻击者伪造
    $parts = $realToken.Split('.')
    $tampered = "$($parts[0]).$($parts[1]).$($parts[2].Substring(0, $parts[2].Length - 4))AAAA"
    $r = & curl.exe -s -w "`n@@HTTP_CODE@@%{http_code}" -H "Authorization: Bearer $tampered" "$BASE/api/auth/me" 2>&1 | Out-String
    $code = 0; $body = $r
    if ($r -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') { $body = $Matches[1].Trim(); $code = [int]$Matches[2] }
    Show-Result -Name "篡改签名后的 token" -Response $body -Code $code -Expect '401'

    # 10b. 篡改载荷：把 sub 改成别人的 id，但签名没跟着变，也必须被拒
    $fakePayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"sub":"999","jti":"fake","exp":9999999999}')).TrimEnd('=').Replace('+','-').Replace('/','_')
    $forged = "$($parts[0]).$fakePayload.$($parts[2])"
    $r2 = & curl.exe -s -w "`n@@HTTP_CODE@@%{http_code}" -H "Authorization: Bearer $forged" "$BASE/api/auth/me" 2>&1 | Out-String
    $code2 = 0; $body2 = $r2
    if ($r2 -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') { $body2 = $Matches[1].Trim(); $code2 = [int]$Matches[2] }
    Show-Result -Name "篡改载荷内容（把用户 id 改成 999）" -Response $body2 -Code $code2 -Expect '401'

    # 10c. 乱写的 token
    $r3 = & curl.exe -s -w "`n@@HTTP_CODE@@%{http_code}" -H "Authorization: Bearer not.a.jwt" "$BASE/api/auth/me" 2>&1 | Out-String
    $code3 = 0; $body3 = $r3
    if ($r3 -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') { $body3 = $Matches[1].Trim(); $code3 = [int]$Matches[2] }
    Show-Result -Name "格式不正确的 token" -Response $body3 -Code $code3 -Expect '401'

    # 10d. 正常 Bearer 头鉴权应该成功（证明上面拒绝的是伪造，而不是 Bearer 方式本身不通）
    $r4 = & curl.exe -s -w "`n@@HTTP_CODE@@%{http_code}" -H "Authorization: Bearer $realToken" "$BASE/api/auth/me" 2>&1 | Out-String
    $code4 = 0; $body4 = $r4
    if ($r4 -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') { $body4 = $Matches[1].Trim(); $code4 = [int]$Matches[2] }
    Show-Result -Name "真实 token 用 Bearer 头鉴权" -Response $body4 -Code $code4 -Expect '200'
} else {
    Write-Host "[FAIL] 登录响应里没找到 access_token" -ForegroundColor Red
    $script:failed++
}

# ---------- 11. 黑名单 ----------
Write-Host ""
Write-Host "--- 11. 黑名单：退出登录后旧 token 立即失效 ---" -ForegroundColor Yellow
if ($realToken) {
    $null = & curl.exe -s -X POST -H "Authorization: Bearer $realToken" "$BASE/api/auth/logout" 2>&1
    $r5 = & curl.exe -s -w "`n@@HTTP_CODE@@%{http_code}" -H "Authorization: Bearer $realToken" "$BASE/api/auth/me" 2>&1 | Out-String
    $code5 = 0; $body5 = $r5
    if ($r5 -match '(?s)^(.*)@@HTTP_CODE@@(\d+)\s*$') { $body5 = $Matches[1].Trim(); $code5 = [int]$Matches[2] }
    Show-Result -Name "注销后复用同一 token（应被黑名单拦截）" -Response $body5 -Code $code5 -Expect '401'
}

# ---------- 汇总 ----------
Write-Host ""
Write-Host "==================== 测试汇总 ====================" -ForegroundColor Cyan
$color = if ($script:failed -eq 0) { 'Green' } else { 'Red' }
Write-Host "通过: $script:passed   失败: $script:failed" -ForegroundColor $color
Remove-Item $JAR -Force -ErrorAction SilentlyContinue
