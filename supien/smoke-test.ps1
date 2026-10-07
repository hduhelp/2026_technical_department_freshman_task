# Smoke test for all API endpoints
$base = "http://localhost:8080/api"
$ErrorActionPreference = "Stop"
function Post($url, $body, $token) {
    $headers = @{ "Content-Type" = "application/json" }
    if ($token) { $headers["Authorization"] = "Bearer $token" }
    return Invoke-RestMethod -Method Post -Uri "$base$url" -Headers $headers -Body ($body | ConvertTo-Json -Depth 5)
}
function Get2($url, $token) {
    $headers = @{}
    if ($token) { $headers["Authorization"] = "Bearer $token" }
    return Invoke-RestMethod -Method Get -Uri "$base$url" -Headers $headers
}
function Put2($url, $body, $token) {
    return Invoke-RestMethod -Method Put -Uri "$base$url" -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } -Body ($body | ConvertTo-Json -Depth 5)
}
function Patch2($url, $body, $token) {
    return Invoke-RestMethod -Method Patch -Uri "$base$url" -Headers @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" } -Body ($body | ConvertTo-Json -Depth 5)
}
function Delete2($url, $token) {
    return Invoke-RestMethod -Method Delete -Uri "$base$url" -Headers @{ "Authorization" = "Bearer $token" }
}
function ExpectFail($block, $name) {
    try { & $block; Write-Host "[FAIL] $name should be rejected" }
    catch {
        $code = [int]$_.Exception.Response.StatusCode
        Write-Host "[OK]   $name rejected with HTTP $code"
    }
}

Write-Host "== 1. Register zhangsan =="
$r1 = Post "/register" @{ username = "zhangsan"; password = "123456"; phone = "13800000000" }
$t1 = $r1.data.token
Write-Host ("token: " + $t1.Substring(0, 20) + "...")

Write-Host "== 2. Duplicate register -> 409 =="
ExpectFail { Post "/register" @{ username = "zhangsan"; password = "123456" } } "duplicate register"

Write-Host "== 3. Register and login lisi =="
Post "/register" @{ username = "lisi"; password = "654321" } | Out-Null
$r2 = Post "/login" @{ username = "lisi"; password = "654321" }
$t2 = $r2.data.token

Write-Host "== 4. Get current user =="
$me = Get2 "/user/me" $t1
Write-Host ("current user: " + $me.data.username)

Write-Host "== 5. zhangsan creates a lost item =="
$item = Post "/items" @{ type = "lost"; title = "lost black earbuds"; description = "lost at library 3F, sticker on case"; location = "library 3F" } $t1
$id = $item.data.id
Write-Host ("item id: " + $id + ", status: " + $item.data.status + ", contact(default): " + $item.data.contact)

Write-Host "== 6. lisi creates a found item =="
Post "/items" @{ type = "found"; title = "found a campus card at canteen"; description = "at canteen 1 gate"; location = "canteen 1" } $t2 | Out-Null

Write-Host "== 7. Search keyword=earbuds =="
$list = Get2 "/items?keyword=earbuds" $t2
Write-Host ("hits: " + $list.data.total + ", publisher: " + $list.data.list[0].publisher.username + ", is_owner(for lisi): " + $list.data.list[0].is_owner)

Write-Host "== 8. Filter by type=found =="
$f = Get2 "/items?type=found" $t1
Write-Host ("found-item count: " + $f.data.total)

Write-Host "== 9. lisi tries to update zhangsan's item -> 403 =="
ExpectFail { Put2 "/items/$id" @{ title = "hacked" } $t2 } "cross-user update"

Write-Host "== 10. lisi tries to change status -> 403 =="
ExpectFail { Patch2 "/items/$id/status" @{ status = "found" } $t2 } "cross-user status"

Write-Host "== 11. zhangsan updates own item =="
$up = Put2 "/items/$id" @{ title = "lost black earbuds (maybe room 302)"; location = "library room 302" } $t1
Write-Host ("new title: " + $up.data.title)

Write-Host "== 12. zhangsan marks it found =="
$st = Patch2 "/items/$id/status" @{ status = "found" } $t1
Write-Host ("new status: " + $st.data.status)

Write-Host "== 13. Invalid status -> 400 =="
ExpectFail { Patch2 "/items/$id/status" @{ status = "xxx" } $t1 } "invalid status"

Write-Host "== 14. No token -> 401 =="
ExpectFail { Get2 "/items" $null } "no token"

Write-Host "== 15. zhangsan logs out =="
Post "/logout" @{} $t1 | Out-Null
Write-Host "logged out"

Write-Host "== 16. Old token after logout -> 401 =="
ExpectFail { Get2 "/user/me" $t1 } "token after logout"

Write-Host "== 17. zhangsan re-logs in and deletes the item =="
$rl = Post "/login" @{ username = "zhangsan"; password = "123456" }
$t1new = $rl.data.token
$dl = Delete2 "/items/$id" $t1new
Write-Host $dl.data.message

Write-Host "== 18. Query deleted item -> 404 =="
ExpectFail { Get2 "/items/$id" $t1new } "query after delete"

Write-Host ""
Write-Host "All tests finished."
