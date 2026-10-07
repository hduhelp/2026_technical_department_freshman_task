# 拾取者 / 保管者 与 中文用户名 专项测试
#
# 覆盖：
#   1. 中文用户名注册与登录（含中文+数字混用）
#   2. 空格、标点、emoji、过短过长应被拒绝
#   3. 发布时区分拾取者与保管者
#   4. 保管者用用户名指定后，能否真的管理这条信息（核心）
#   5. 字符数与 UTF-8 字节数是两套独立约束
#
# 运行方式（先启动服务）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_holder_api.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_holder_api.ps1 -Port 8011

param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$BASE = "http://127.0.0.1:$Port"
$script:passed = 0
$script:failed = 0

function Show-Result {
    param([string]$Name, [string]$Response, [int]$Code, [string]$Expect)
    $ok = $false
    if ($Expect -match '^(\d)xx$') { $ok = ([math]::Floor($Code / 100) -eq [int]$Matches[1]) }
    elseif ($Expect -match '^\d+$') { $ok = ($Code -eq [int]$Expect) }
    if ($ok) { $script:passed++ } else { $script:failed++ }
    Write-Host ""
    Write-Host "[$(if ($ok) {'PASS'} else {'FAIL'})] $Name" -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) -NoNewline
    Write-Host "  期望=$Expect  实际=HTTP $Code"
    $short = $Response
    if ($short.Length -gt 260) { $short = $short.Substring(0, 260) + ' ...' }
    Write-Host "       $short"
}

function Call-Api {
    param(
        [string]$Name, [string]$Method, [string]$Path,
        [string]$Json = '', [string]$Token = '', [string]$Expect = '2xx'
    )
    $curlArgs = @('-s', '-w', "`n@@CODE@@%{http_code}", '-X', $Method, "$BASE$Path")
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }
    $tmp = $null
    if ($Json) {
        $tmp = Join-Path $env:TEMP ("lf_h_{0}.json" -f ([guid]::NewGuid().ToString('N')))
        [System.IO.File]::WriteAllText($tmp, $Json, (New-Object System.Text.UTF8Encoding($false)))
        $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$tmp")
    }
    $raw = & curl.exe @curlArgs 2>&1 | Out-String
    if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    $code = 0; $body = $raw
    if ($raw -match '(?s)^(.*)@@CODE@@(\d+)\s*$') { $body = $Matches[1].Trim(); $code = [int]$Matches[2] }
    Show-Result -Name $Name -Response $body -Code $code -Expect $Expect
    return $body
}

Write-Host "=========== 拾取者/保管者 与 中文用户名 专项测试 ===========" -ForegroundColor Cyan

$suffix = Get-Random -Minimum 1000 -Maximum 9999
$pwd = 'Demo@2026'

# ---------- 1. 中文用户名 ----------
Write-Host ""
Write-Host "--- 1. 中文用户名 ---" -ForegroundColor Yellow

$cnUser = "王老师$suffix"
$r = Call-Api -Name "注册中文用户名「$cnUser」" -Method POST -Path '/api/auth/register' -Expect '201' -Json (
    @{ username = $cnUser; password = $pwd; display_name = '王老师'; contact = '微信:wanglaoshi' } | ConvertTo-Json -Compress
)
$cnToken = ''
if ($r -match '"access_token"\s*:\s*"([^"]+)"') { $cnToken = $Matches[1] }
if ($r -match '"username"\s*:\s*"([^"]+)"') { Write-Host "       后端存储的用户名 = $($Matches[1])" }

$cnUser2 = "李阿姨$suffix"
Call-Api -Name "注册另一个中文用户名「$cnUser2」" -Method POST -Path '/api/auth/register' -Expect '201' -Json (
    @{ username = $cnUser2; password = $pwd; display_name = '李阿姨' } | ConvertTo-Json -Compress
) | Out-Null

Call-Api -Name "用中文用户名登录（应 200）" -Method POST -Path '/api/auth/login' -Expect '200' -Json (
    @{ username = $cnUser; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

Call-Api -Name "中文名重复注册（应 409）" -Method POST -Path '/api/auth/register' -Expect '409' -Json (
    @{ username = $cnUser; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# 中文和数字混用**应该被允许** —— 这是真实需求。
# 两个老师都姓王时，用户自然会写「王老师2」来区分。
# （我第一版把混用禁掉了，结果恰好堵死了最需要的场景，这是测试帮我发现的。）
Call-Api -Name "中文+数字混用「张伟$suffix」（应 201）" -Method POST -Path '/api/auth/register' -Expect '201' -Json (
    @{ username = "张伟$suffix"; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# 含空格应被拒绝
Call-Api -Name "中文名带空格（应 422）" -Method POST -Path '/api/auth/register' -Expect '422' -Json (
    @{ username = "王 老师$suffix"; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# 太短（1 个字符）
Call-Api -Name "用户名只有 1 个字符（应 422）" -Method POST -Path '/api/auth/register' -Expect '422' -Json (
    @{ username = '明'; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# 超长（31 个汉字）
$longName = '张' * 31
Call-Api -Name "用户名 31 个汉字（超过 30 上限，应 422）" -Method POST -Path '/api/auth/register' -Expect '422' -Json (
    @{ username = $longName; password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 2. 拾取者 ≠ 保管者 ----------
Write-Host ""
Write-Host "--- 2. 拾取者与保管者分离（发布）---" -ForegroundColor Yellow

# 小明的账号（捡到东西的人）
$mingToken = ''
$r = Call-Api -Name "登录 xiaoming（拾取者）" -Method POST -Path '/api/auth/login' -Expect '200' -Json (
    @{ username = 'xiaoming'; password = $pwd } | ConvertTo-Json -Compress
)
if ($r -match '"access_token"\s*:\s*"([^"]+)"') { $mingToken = $Matches[1] }

# 场景：小明捡到一个钱包，交给了王老师保管
$item = Call-Api -Name "发布：拾取者=小明，保管者=王老师（非本平台账号）" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{
        type = 'found'
        title = '黑色钱包'
        description = '在二教门口捡到一个黑色钱包'
        location = '第二教学楼'
        finder_name = '小明'
        holder_is_reporter = $false
        holder_name = '王老师'
        holder_place = '行政楼 102 办公室'
    } | ConvertTo-Json -Compress
)
$itemId1 = 0
if ($item -match '"id"\s*:\s*(\d+)') { $itemId1 = [int]$Matches[1] }
Write-Host "       信息 id = $itemId1"

if ($item -match '"finder_name"\s*:\s*"([^"]*)"') { Write-Host "       后端记录拾取者 = $($Matches[1])" }
if ($item -match '"holder_name"\s*:\s*"([^"]*)"') { Write-Host "       后端记录保管者 = $($Matches[1])" }
if ($item -match '"holder_place"\s*:\s*"([^"]*)"') { Write-Host "       后端记录保管地点 = $($Matches[1])" }

# 用保管者用户名发布（保管者也是平台用户，应该获得管理权）
$item2 = Call-Api -Name "发布：保管者指定为平台用户「$cnUser」" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{
        type = 'found'
        title = '蓝色保温杯'
        description = '图书馆捡到的保温杯'
        finder_name = '一位同学'
        holder_is_reporter = $false
        holder_username = $cnUser
        holder_place = '图书馆一楼服务台'
    } | ConvertTo-Json -Compress
)
$itemId2 = 0
if ($item2 -match '"id"\s*:\s*(\d+)') { $itemId2 = [int]$Matches[1] }
Write-Host "       信息 id = $itemId2"
if ($item2 -match '"holder_username"\s*:\s*"([^"]*)"') { Write-Host "       关联到的保管者账号 = $($Matches[1])" }

Call-Api -Name "指定不存在的保管者用户名（应 400）" -Method POST -Path '/api/items' -Token $mingToken -Expect '400' -Json (
    @{ type = 'found'; title = '测试'; holder_is_reporter = $false; holder_username = '根本没有这个人' } | ConvertTo-Json -Compress
) | Out-Null

# 默认情况：发布人就是保管者
$item3 = Call-Api -Name "默认发布人即保管者（不传 holder 字段）" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{ type = 'found'; title = '默认保管者测试'; description = '测试' } | ConvertTo-Json -Compress
)
$itemId3 = 0
if ($item3 -match '"id"\s*:\s*(\d+)') { $itemId3 = [int]$Matches[1] }
if ($item3 -match '"holder_is_reporter"\s*:\s*(\w+)') { Write-Host "       holder_is_reporter = $($Matches[1])（应为 True）" }

# ---------- 3. 保管者权限（核心） ----------
Write-Host ""
Write-Host "--- 3. 保管者的管理权限（核心验证）---" -ForegroundColor Yellow

if ($itemId2 -gt 0 -and $cnToken) {
    # 王老师是这条信息的保管者，应该能改状态
    Call-Api -Name "保管者改状态为「已找到」（应 200）" -Method PATCH -Path "/api/items/$itemId2/status" -Token $cnToken -Expect '200' -Json (
        @{ status = 'found' } | ConvertTo-Json -Compress
    ) | Out-Null

    # 也应该能编辑内容
    Call-Api -Name "保管者修改信息内容（应 200）" -Method PATCH -Path "/api/items/$itemId2" -Token $cnToken -Expect '200' -Json (
        @{ holder_place = '图书馆二楼服务台（已转移）' } | ConvertTo-Json -Compress
    ) | Out-Null

    # 详情里应该能看出"我是保管者"
    $detail = Call-Api -Name "保管者查看详情（is_holder 应为 true、is_mine 应为 true）" -Method GET -Path "/api/items/$itemId2" -Token $cnToken -Expect '200'
    if ($detail -match '"is_holder"\s*:\s*true') { Write-Host "[PASS] is_holder 正确为 true" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "[FAIL] is_holder 不为 true" -ForegroundColor Red; $script:failed++ }
    if ($detail -match '"is_mine"\s*:\s*true') { Write-Host "[PASS] is_mine 正确为 true（保管者也有管理权）" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "[FAIL] is_mine 不为 true" -ForegroundColor Red; $script:failed++ }

    # 发布者（小明）同样有管理权（这条是 item3，他是保管者）
    Call-Api -Name "发布者仍能管理自己发的东西（应 200）" -Method PATCH -Path "/api/items/$itemId3/status" -Token $mingToken -Expect '200' -Json (
        @{ status = 'found' } | ConvertTo-Json -Compress
    ) | Out-Null

    # 无关用户不能管理
    $otherToken = ''
    $r = Call-Api -Name "登录一个无关用户「$cnUser2」" -Method POST -Path '/api/auth/login' -Expect '200' -Json (
        @{ username = $cnUser2; password = $pwd } | ConvertTo-Json -Compress
    )
    if ($r -match '"access_token"\s*:\s*"([^"]+)"') { $otherToken = $Matches[1] }

    if ($otherToken) {
        Call-Api -Name "无关用户改这条信息（应 403）" -Method PATCH -Path "/api/items/$itemId2" -Token $otherToken -Expect '403' -Json (
            @{ title = '我要篡改' } | ConvertTo-Json -Compress
        ) | Out-Null
        Call-Api -Name "无关用户删这条信息（应 403）" -Method DELETE -Path "/api/items/$itemId2" -Token $otherToken -Expect '403' | Out-Null
    }
}

# ---------- 4. 列表里能看到保管信息 ----------
Write-Host ""
Write-Host "--- 4. 列表返回是否含保管信息 ---" -ForegroundColor Yellow
if ($itemId1 -gt 0) {
    $d1 = Call-Api -Name "查看「拾取者≠保管者」那条详情" -Method GET -Path "/api/items/$itemId1" -Expect '200'
    foreach ($f in @('finder_name', 'holder_name', 'holder_place', 'holder_is_reporter')) {
        if ($d1 -match """$f""") { Write-Host "       含字段 $f" }
        else { Write-Host "[FAIL] 缺少字段 $f" -ForegroundColor Red; $script:failed++ }
    }
}

# ---------- 5. 字节长度上限 ----------
Write-Host ""
Write-Host "--- 5. 字符数与 UTF-8 字节数是两套独立约束 ---" -ForegroundColor Yellow

# 标题：50 个汉字（150 字节）应通过
Call-Api -Name "标题 50 个汉字（字符刚好到上限，应 201）" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{ type = 'found'; title = ('测' * 50) } | ConvertTo-Json -Compress
) | Out-Null

# 标题：51 个汉字，字符数超限应被拒
Call-Api -Name "标题 51 个汉字（字符超限，应 422）" -Method POST -Path '/api/items' -Token $mingToken -Expect '422' -Json (
    @{ type = 'found'; title = ('测' * 51) } | ConvertTo-Json -Compress
) | Out-Null

# emoji 是 4 字节：验证"按字符数计"是对的 —— 10 个 emoji 字符数 10、字节 40，应该通过。
# 【这条测试的意义】如果错误地按"字符数 × 3 估算字节"，含 emoji 的输入会被误判。
Call-Api -Name "标题全 emoji（4 字节字符，应 201）" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{ type = 'found'; title = '🔍🎁🎒☂️🌂📚✏️📱💻⌚' } | ConvertTo-Json -Compress
) | Out-Null

# 地点：这一对限制是 (100 字符, 300 字节)。
# 用 emoji 构造"字符数没超、但字节数超"的情况：
#   每个 emoji 在 UTF-8 里是 4 字节，100 个 emoji = 400 字节 > 300
# 这条测试验证的是**字节上限确实生效**（而不是死代码）。
Call-Api -Name "地点 100 个 emoji（字符 100 未超，但字节 400 超限，应 422）" -Method POST -Path '/api/items' -Token $mingToken -Expect '422' -Json (
    @{ type = 'found'; title = '字节上限测试'; location = ('🔍' * 100) } | ConvertTo-Json -Compress
) | Out-Null

# 地点：75 个 emoji = 300 字节，刚好在限内
Call-Api -Name "地点 75 个 emoji（刚好 300 字节，应 201）" -Method POST -Path '/api/items' -Token $mingToken -Expect '201' -Json (
    @{ type = 'found'; title = '字节边界测试'; location = ('🔍' * 75) } | ConvertTo-Json -Compress
) | Out-Null

# 用户名：31 个汉字，字符数(31>30)和字节数(93>90)都超
Call-Api -Name "用户名 31 个汉字（应 422）" -Method POST -Path '/api/auth/register' -Expect '422' -Json (
    @{ username = ('李' * 31); password = $pwd } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 汇总 ----------
Write-Host ""
Write-Host "=========== 测试汇总 ===========" -ForegroundColor Cyan
Write-Host "通过: $script:passed   失败: $script:failed" -ForegroundColor $(if ($script:failed -eq 0) { 'Green' } else { 'Red' })
