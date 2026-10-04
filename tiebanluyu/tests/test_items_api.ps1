# 阶段二接口测试：失物招领全流程
#
# 覆盖：发布、列表、搜索、筛选、分页、排序、详情、修改、状态流转、删除、权限、智能匹配
#
# 运行方式（先启动服务，再另开终端）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_items_api.ps1

param([int]$Port = 8000)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$BASE = "http://127.0.0.1:$Port"
$script:passed = 0
$script:failed = 0

function Show-Result {
    param([string]$Name, [string]$Response, [int]$Code, [string]$Expect)
    $ok = $false
    if ($Expect -match '^(\d)xx$') {
        $ok = ([math]::Floor($Code / 100) -eq [int]$Matches[1])
    } elseif ($Expect -match '^\d+$') {
        $ok = ($Code -eq [int]$Expect)
    }
    if ($ok) { $script:passed++ } else { $script:failed++ }
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ""
    Write-Host "[$mark] $Name" -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) -NoNewline
    Write-Host "  期望=$Expect  实际=HTTP $Code"
    $short = $Response
    if ($short.Length -gt 300) { $short = $short.Substring(0, 300) + ' ...' }
    Write-Host "       $short"
}

function Invoke-Api {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [string]$Json = '',
        [string]$Token = '',
        [string]$Expect = '2xx'
    )
    $curlArgs = @('-s', '-w', "`n@@CODE@@%{http_code}", '-X', $Method, "$BASE$Path")
    if ($Token) { $curlArgs += @('-H', "Authorization: Bearer $Token") }

    $tmp = $null
    if ($Json) {
        $tmp = Join-Path $env:TEMP ("lf_i_{0}.json" -f ([guid]::NewGuid().ToString('N')))
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

function Get-Token {
    param([string]$Username, [string]$Password = 'Demo@2026')
    $tmp = Join-Path $env:TEMP ("lf_login_{0}.json" -f ([guid]::NewGuid().ToString('N')))
    $json = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    $raw = & curl.exe -s -H 'Content-Type: application/json' --data-binary "@$tmp" "$BASE/api/auth/login" 2>&1 | Out-String
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($raw -match '"access_token"\s*:\s*"([^"]+)"') { return $Matches[1] }
    return ''
}

Write-Host "==================== 阶段二 失物招领接口测试 ====================" -ForegroundColor Cyan

# ---------- 准备：登录两个演示账号 ----------
Write-Host ""
Write-Host "--- 准备：获取两个账号的登录凭证 ---" -ForegroundColor Yellow
$tokenMing = Get-Token -Username 'xiaoming'
$tokenLisi = Get-Token -Username 'lisi'
if ($tokenMing) { Write-Host "[PASS] 小明登录成功（发布者A）" -ForegroundColor Green; $script:passed++ } else { Write-Host "[FAIL] 小明登录失败" -ForegroundColor Red; $script:failed++ }
if ($tokenLisi) { Write-Host "[PASS] 李四登录成功（发布者B）" -ForegroundColor Green; $script:passed++ } else { Write-Host "[FAIL] 李四登录失败" -ForegroundColor Red; $script:failed++ }

# ---------- 1. 列表与分页 ----------
Write-Host ""
Write-Host "--- 1. 列表基础（WHERE / ORDER BY / LIMIT / OFFSET）---" -ForegroundColor Yellow
$list = Invoke-Api -Name "游客可浏览列表" -Method GET -Path '/api/items?page=1&page_size=5' -Expect '200'
if ($list -match '"total"\s*:\s*(\d+)') { Write-Host "       总条数 = $($Matches[1])" }
if ($list -match '"total_pages"\s*:\s*(\d+)') { Write-Host "       总页数 = $($Matches[1])" }
if ($list -match '"has_next"\s*:\s*(\w+)') { Write-Host "       还有下一页 = $($Matches[1])" }

Invoke-Api -Name "第 2 页（验证 OFFSET 生效）" -Method GET -Path '/api/items?page=2&page_size=5' -Expect '200' | Out-Null
Invoke-Api -Name "末页之后的空页" -Method GET -Path '/api/items?page=99&page_size=5' -Expect '200' | Out-Null

# ---------- 2. 筛选 ----------
Write-Host ""
Write-Host "--- 2. 按类型 / 状态筛选（WHERE）---" -ForegroundColor Yellow
$lostOnly = Invoke-Api -Name "只看寻物启事 type=lost" -Method GET -Path '/api/items?type=lost&page_size=50' -Expect '200'
if ($lostOnly -notmatch '"type":"found"') { Write-Host "[PASS] 筛选结果中确实没有招领信息" -ForegroundColor Green; $script:passed++ } else { Write-Host "[FAIL] 筛选中混入了招领信息" -ForegroundColor Red; $script:failed++ }

$searching = Invoke-Api -Name "只看寻找中 status=searching" -Method GET -Path '/api/items?status=searching&page_size=50' -Expect '200'
if ($searching -notmatch '"status":"found"') { Write-Host "[PASS] 筛选结果中没有已找到的信息" -ForegroundColor Green; $script:passed++ } else { Write-Host "[FAIL] 筛选中混入了已找到的信息" -ForegroundColor Red; $script:failed++ }

Invoke-Api -Name "非法 type 值（应被忽略而不是报错）" -Method GET -Path '/api/items?type=hack' -Expect '200' | Out-Null

# ---------- 3. 搜索 ----------
Write-Host ""
Write-Host "--- 3. 关键词搜索（LIKE）---" -ForegroundColor Yellow
$kw = Invoke-Api -Name "搜索「校园卡」" -Method GET -Path '/api/items?q=%E6%A0%A1%E5%9B%AD%E5%8D%A1' -Expect '200'
if ($kw -match '"total"\s*:\s*(\d+)') { Write-Host "       命中 $($Matches[1]) 条" }

Invoke-Api -Name "搜索描述里的词「哆啦A梦」（应命中）" -Method GET -Path '/api/items?q=%E5%93%86%E5%95%A6A%E6%A2%A6' -Expect '200' | Out-Null

# 【重点安全测试】LIKE 通配符转义
#
# 这里的关键是：如果 % 没有被转义，搜 "%" 会命中**全部 14 条**记录
# （因为 LIKE '%%%' 里前后的 % 是通配符，中间那个 % 会被当通配符吃掉）。
# 所以正确行为是"只命中标题里真的含 % 的那一条"。
#
# 【踩坑记录】一开始我把这里写成了搜 "%%" 并期望命中 1 条，这是错的：
# 数据里只有一个 %，"%%" 表示"连续两个百分号"，当然命中 0 条。
# 断言写错会让人误以为是代码 bug，白白排查很久。
# 教训：**断言要基于数据的真实特征，而不是凭感觉。**
#
# 另外为了排除历史测试残留数据的干扰，这里用随机标题保证唯一性。
$uniqueTag = "百分号测试-$(Get-Random -Minimum 10000 -Maximum 99999)"
$pctItem = Invoke-Api -Name "造一条标题含百分号的数据" -Method POST -Path '/api/items' -Token $tokenMing -Expect '201' -Json (
    @{ type = 'lost'; title = "$uniqueTag 100%"; description = '含通配符的测试数据' } | ConvertTo-Json -Compress
)
$pctId = 0
if ($pctItem -match '"id"\s*:\s*(\d+)') { $pctId = [int]$Matches[1] }

# 搜单个 % —— 应该只命中标题里真的含 % 的记录，而不是全部
$wildcard = Invoke-Api -Name "搜索单个 %（通配符转义测试）" -Method GET -Path '/api/items?q=%25&page_size=50' -Expect '200'
if ($wildcard -match '"total"\s*:\s*(\d+)') {
    $t = [int]$Matches[1]
    if ($t -eq 1 -and $wildcard -match [regex]::Escape($uniqueTag)) {
        Write-Host "[PASS] 转义生效：只命中 1 条含 % 的记录，且正是刚创建的那条" -ForegroundColor Green; $script:passed++
    } elseif ($t -eq 0) {
        Write-Host "[FAIL] 命中 0 条，含 % 的标题反而搜不到（转义过度）" -ForegroundColor Red; $script:failed++
    } elseif ($t -ge 14) {
        Write-Host "[FAIL] 命中了 $t 条（几乎全表），通配符未转义，存在信息泄露风险" -ForegroundColor Red; $script:failed++
    } else {
        Write-Host "[FAIL] 命中 $t 条，未精确匹配到刚创建的记录" -ForegroundColor Red; $script:failed++
    }
}

# 搜 "%%"（连续两个百分号）应该命中 0 条 —— 数据里没有连续两个 %
$twoPct = Invoke-Api -Name "搜索连续两个 %%（应 0 条）" -Method GET -Path '/api/items?q=%25%25&page_size=50' -Expect '200'
if ($twoPct -match '"total"\s*:\s*(\d+)') {
    if ([int]$Matches[1] -eq 0) {
        Write-Host "[PASS] 连续两个 %% 命中 0 条（符合语义，且未泄露全表）" -ForegroundColor Green; $script:passed++
    } else {
        Write-Host "[FAIL] 连续两个 %% 竟然命中了 $($Matches[1]) 条" -ForegroundColor Red; $script:failed++
    }
}

# 搜 "_" 下划线也是通配符，必须同样被转义（数据里没有下划线，应为 0 条）
$underscore = Invoke-Api -Name "搜索下划线 _（通配符转义测试）" -Method GET -Path '/api/items?q=_&page_size=50' -Expect '200'
if ($underscore -match '"total"\s*:\s*(\d+)') {
    if ([int]$Matches[1] -eq 0) {
        Write-Host "[PASS] 下划线被正确转义，命中 0 条（未泄露全表）" -ForegroundColor Green; $script:passed++
    } else {
        Write-Host "[FAIL] 下划线未转义，命中了 $($Matches[1]) 条" -ForegroundColor Red; $script:failed++
    }
}

# 清理这条测试数据，避免影响后面的统计
if ($pctId -gt 0) {
    $null = & curl.exe -s -X DELETE -H "Authorization: Bearer $tokenMing" "$BASE/api/items/$pctId" 2>&1
}

# ---------- 4. 排序 ----------
Write-Host ""
Write-Host "--- 4. 排序（ORDER BY）---" -ForegroundColor Yellow
Invoke-Api -Name "按最新排序 sort=newest" -Method GET -Path '/api/items?sort=newest&page_size=3' -Expect '200' | Out-Null
Invoke-Api -Name "按最热排序 sort=popular" -Method GET -Path '/api/items?sort=popular&page_size=3' -Expect '200' | Out-Null
# 注意：URL 里的分号必须编码成 %3B，否则 curl 会把 URL 判为非法（表现为 HTTP 0，连接层就失败了）。
# 之前这里写的是裸分号，导致这条用例假失败 —— 是测试脚本的问题，不是后端的问题。
Invoke-Api -Name "非法排序值（应回退到默认，不报错）" -Method GET -Path '/api/items?sort=%3BDROP%20TABLE%20items--&page_size=2' -Expect '200' | Out-Null
Invoke-Api -Name "任意乱写的排序值也应正常回退" -Method GET -Path '/api/items?sort=not_a_real_option&page_size=2' -Expect '200' | Out-Null
Invoke-Api -Name "排序白名单外注入尝试后列表仍正常" -Method GET -Path '/api/items?page_size=2' -Expect '200' | Out-Null

# ---------- 5. 发布 ----------
Write-Host ""
Write-Host "--- 5. 发布信息 ---" -ForegroundColor Yellow
Invoke-Api -Name "未登录发布（应 401）" -Method POST -Path '/api/items' -Expect '401' -Json (
    @{ type = 'lost'; title = '测试物品' } | ConvertTo-Json -Compress
) | Out-Null

$newItem = Invoke-Api -Name "小明发布一条寻物启事" -Method POST -Path '/api/items' -Token $tokenMing -Expect '201' -Json (
    @{
        type = 'lost'
        title = '测试用充电宝'
        description = '白色小米充电宝，20000mAh，侧面有一道划痕'
        location = '图书馆三楼'
        event_time = '2026-09-30 15:00'
        contact = '微信:test_ming'
    } | ConvertTo-Json -Compress
)
$newId = 0
if ($newItem -match '"id"\s*:\s*(\d+)') { $newId = [int]$Matches[1]; Write-Host "       新建信息 id = $newId" }

Invoke-Api -Name "非法类型 type=xxx（应 422）" -Method POST -Path '/api/items' -Token $tokenMing -Expect '422' -Json (
    @{ type = 'xxx'; title = '测试' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "空标题（应 422）" -Method POST -Path '/api/items' -Token $tokenMing -Expect '422' -Json (
    @{ type = 'lost'; title = '   ' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "时间格式非法（应 422）" -Method POST -Path '/api/items' -Token $tokenMing -Expect '422' -Json (
    @{ type = 'lost'; title = '测试'; event_time = '不是时间' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 6. 详情 ----------
Write-Host ""
Write-Host "--- 6. 查看详情 ---" -ForegroundColor Yellow
Invoke-Api -Name "查看刚发布的信息详情" -Method GET -Path "/api/items/$newId" -Expect '200' | Out-Null
Invoke-Api -Name "查看不存在的 id（应 404）" -Method GET -Path '/api/items/999999' -Expect '404' | Out-Null
Invoke-Api -Name "非法 id 格式（应 422）" -Method GET -Path '/api/items/abc' -Expect '422' | Out-Null

# 浏览量自增验证
$before = (Invoke-Api -Name "记录当前浏览量" -Method GET -Path "/api/items/$newId" -Expect '200')
$v1 = 0; if ($before -match '"view_count"\s*:\s*(\d+)') { $v1 = [int]$Matches[1] }
$after = (Invoke-Api -Name "再访问一次" -Method GET -Path "/api/items/$newId" -Expect '200')
$v2 = 0; if ($after -match '"view_count"\s*:\s*(\d+)') { $v2 = [int]$Matches[1] }
if ($v2 -gt $v1) { Write-Host "[PASS] 浏览量自增生效：$v1 -> $v2" -ForegroundColor Green; $script:passed++ }
else { Write-Host "[FAIL] 浏览量没有自增：$v1 -> $v2" -ForegroundColor Red; $script:failed++ }

# ---------- 7. 权限 ----------
Write-Host ""
Write-Host "--- 7. 权限控制（核心安全验证）---" -ForegroundColor Yellow
Invoke-Api -Name "李四改小明的信息（应 403）" -Method PATCH -Path "/api/items/$newId" -Token $tokenLisi -Expect '403' -Json (
    @{ title = '我要篡改别人的帖子' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "李四删小明的信息（应 403）" -Method DELETE -Path "/api/items/$newId" -Token $tokenLisi -Expect '403' | Out-Null

Invoke-Api -Name "李四改小明的信息状态（应 403）" -Method PATCH -Path "/api/items/$newId/status" -Token $tokenLisi -Expect '403' -Json (
    @{ status = 'found' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "未登录修改（应 401）" -Method PATCH -Path "/api/items/$newId" -Expect '401' -Json (
    @{ title = '未登录篡改' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 8. 修改 ----------
Write-Host ""
Write-Host "--- 8. 修改自己的信息 ---" -ForegroundColor Yellow
Invoke-Api -Name "小明改自己的标题和地点" -Method PATCH -Path "/api/items/$newId" -Token $tokenMing -Expect '200' -Json (
    @{ title = '白色充电宝（已更新）'; location = '图书馆四楼' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 9. 状态流转 ----------
Write-Host ""
Write-Host "--- 9. 状态管理（寻找中 → 已找到 → 已结束）---" -ForegroundColor Yellow
$s1 = Invoke-Api -Name "标记为已找到 found" -Method PATCH -Path "/api/items/$newId/status" -Token $tokenMing -Expect '200' -Json (
    @{ status = 'found' } | ConvertTo-Json -Compress
)
if ($s1 -match '"status":"found"') { Write-Host "[PASS] 状态确实变成了 found" -ForegroundColor Green; $script:passed++ } else { Write-Host "[FAIL] 状态未变" -ForegroundColor Red; $script:failed++ }

Invoke-Api -Name "再标记为已结束 closed" -Method PATCH -Path "/api/items/$newId/status" -Token $tokenMing -Expect '200' -Json (
    @{ status = 'closed' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "非法状态值（应 422）" -Method PATCH -Path "/api/items/$newId/status" -Token $tokenMing -Expect '422' -Json (
    @{ status = 'whatever' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "纠错：从已结束改回寻找中（规则允许）" -Method PATCH -Path "/api/items/$newId/status" -Token $tokenMing -Expect '200' -Json (
    @{ status = 'searching' } | ConvertTo-Json -Compress
) | Out-Null

# ---------- 10. 我的发布 ----------
Write-Host ""
Write-Host "--- 10. 我的发布 ---" -ForegroundColor Yellow
$mine = Invoke-Api -Name "小明查看自己的发布" -Method GET -Path '/api/items/mine' -Token $tokenMing -Expect '200'
if ($mine -match '"total"\s*:\s*(\d+)') { Write-Host "       小明共发布 $($Matches[1]) 条" }
Invoke-Api -Name "未登录查看我的发布（应 401）" -Method GET -Path '/api/items/mine' -Expect '401' | Out-Null

# ---------- 11. 智能匹配 ----------
Write-Host ""
Write-Host "--- 11. 智能匹配（进阶功能核心验证）---" -ForegroundColor Yellow

# 找到李四那条 iPhone 15 手机壳的 id
$iphone = Invoke-Api -Name "搜索「手机壳」" -Method GET -Path '/api/items?q=%E6%89%8B%E6%9C%BA%E5%A3%B3&page_size=10' -Expect '200'
$targetId = 0
if ($iphone -match '"id"\s*:\s*(\d+)') { $targetId = [int]$Matches[1] }
Write-Host "       用于测试的信息 id = $targetId"

if ($targetId -gt 0) {
    $sug = Invoke-Api -Name "获取匹配建议" -Method GET -Path "/api/items/$targetId/suggestions" -Expect '200'
    if ($sug -match '"score_percent"\s*:\s*(\d+)') {
        Write-Host "       最高匹配度 = $($Matches[1])%" -ForegroundColor Cyan
    }
    if ($sug -match '"reason"\s*:\s*"([^"]*)"') {
        Write-Host "       匹配理由 = $($Matches[1])" -ForegroundColor Cyan
    }
    if ($sug -match '"suggestions"\s*:\s*\[\s*\{') {
        Write-Host "[PASS] 匹配到了候选信息（智能匹配生效）" -ForegroundColor Green; $script:passed++
    } else {
        Write-Host "[FAIL] 没有匹配到任何候选" -ForegroundColor Red; $script:failed++
    }
}

Invoke-Api -Name "给不存在的 id 求匹配（应 404）" -Method GET -Path '/api/items/999999/suggestions' -Expect '404' | Out-Null

# ---------- 12. 图片上传 ----------
Write-Output ""
Write-Host "--- 12. 图片上传（进阶功能）---" -ForegroundColor Yellow

# 构造一个最小的合法 PNG（1x1 像素）的 base64，用于测试真实图片链路
$pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
$up = Invoke-Api -Name "上传合法 PNG" -Method POST -Path '/api/uploads/images' -Token $tokenMing -Expect '201' -Json (
    @{ image_base64 = "data:image/png;base64,$pngBase64" } | ConvertTo-Json -Compress
)
$imgUrl = ''
if ($up -match '"url"\s*:\s*"([^"]+)"') { $imgUrl = $Matches[1]; Write-Host "       图片地址 = $imgUrl" }

if ($imgUrl) {
    # 验证图片真的能通过 HTTP 访问到（这是"魔术字节校验"之外的另一条链路）
    $code = & curl.exe -s -o NUL -w "%{http_code}" "$BASE$imgUrl" 2>&1
    if ($code -eq '200') { Write-Host "[PASS] 上传的图片可通过 $imgUrl 访问（HTTP 200）" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "[FAIL] 图片无法访问，HTTP $code" -ForegroundColor Red; $script:failed++ }
}

Invoke-Api -Name "上传伪装成图片的文本（应 400，魔术字节拦截）" -Method POST -Path '/api/uploads/images' -Token $tokenMing -Expect '400' -Json (
    @{ image_base64 = 'data:image/png;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('这不是图片，是一个恶意脚本 <?php system($_GET[0]); ?>')) } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "上传空内容（应 400）" -Method POST -Path '/api/uploads/images' -Token $tokenMing -Expect '400' -Json (
    @{ image_base64 = '' } | ConvertTo-Json -Compress
) | Out-Null

Invoke-Api -Name "未登录上传（应 401）" -Method POST -Path '/api/uploads/images' -Expect '401' -Json (
    @{ image_base64 = "data:image/png;base64,$pngBase64" } | ConvertTo-Json -Compress
) | Out-Null

# 把图片挂到信息上
if ($imgUrl -and $newId -gt 0) {
    Invoke-Api -Name "把图片追加到信息上" -Method POST -Path "/api/uploads/items/$newId/images" -Token $tokenMing -Expect '200' -Json (
        @{ image_base64 = "data:image/png;base64,$pngBase64" } | ConvertTo-Json -Compress
    ) | Out-Null
    Invoke-Api -Name "李四给别人信息加图（应 403）" -Method POST -Path "/api/uploads/items/$newId/images" -Token $tokenLisi -Expect '403' -Json (
        @{ image_base64 = "data:image/png;base64,$pngBase64" } | ConvertTo-Json -Compress
    ) | Out-Null
}

# ---------- 13. 删除 ----------
Write-Host ""
Write-Host "--- 13. 删除 ---" -ForegroundColor Yellow
Invoke-Api -Name "小明删除自己的信息" -Method DELETE -Path "/api/items/$newId" -Token $tokenMing -Expect '200' | Out-Null
Invoke-Api -Name "删除后再查看（应 404）" -Method GET -Path "/api/items/$newId" -Expect '404' | Out-Null
Invoke-Api -Name "重复删除（应 404）" -Method DELETE -Path "/api/items/$newId" -Token $tokenMing -Expect '404' | Out-Null

# ---------- 汇总 ----------
Write-Host ""
Write-Host "==================== 测试汇总 ====================" -ForegroundColor Cyan
Write-Host "通过: $script:passed   失败: $script:failed" -ForegroundColor $(if ($script:failed -eq 0) { 'Green' } else { 'Red' })
