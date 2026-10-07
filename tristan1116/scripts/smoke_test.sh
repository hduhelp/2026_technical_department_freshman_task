#!/bin/bash
# ============================================================
#  校园失物招领系统 · 后端冒烟测试
#  把全部接口按"真实使用流程"跑一遍，包含权限、状态机等反例
#  用法：先启动服务（./lostfound.exe），再执行  bash scripts/smoke_test.sh
# ============================================================

BASE="http://localhost:8080/api"
PASS=0
FAIL=0
TMP_BODY=$(mktemp)                 # 临时文件：用来传请求体（见下方 req 的说明）
trap 'rm -f "$TMP_BODY"' EXIT      # 脚本退出时自动清理

# 断言：$1=用例名 $2=期望值 $3=实际值
check() {
  if [ "$2" = "$3" ]; then
    echo "  ✅ $1"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $1  —— 期望 [$2]，实际 [$3]"
    FAIL=$((FAIL + 1))
  fi
}

# 发请求：$1=方法 $2=路径 $3=token(可空) $4=请求体(可空)
# 输出两行：第一行响应体，最后一行 HTTP 状态码
req() {
  local m="$1" p="$2" t="${3:-}" d="${4:-}"
  local auth=() json=()
  [ -n "$t" ] && auth=(-H "Authorization: Bearer $t")
  if [ -n "$d" ]; then
    # ★ 关键：请求体先写进临时文件，再用 @文件 传给 curl
    #   原因：Git Bash（MSYS2）把命令行参数交给 curl.exe 这类 Windows 原生程序时，
    #   会按系统码页（中文系统是 GBK）转码，直接写 -d '中文' 会变成乱码。
    #   走文件的话，curl 直接读文件字节，绕开参数转码，中文原样送达。
    printf '%s' "$d" > "$TMP_BODY"
    json=(-H "Content-Type: application/json" --data-binary "@$TMP_BODY")
  fi
  curl -s -w "\n%{http_code}" -X "$m" "$BASE$p" "${auth[@]}" "${json[@]}"
}

status() { req "$@" | tail -n1; }   # 只要 HTTP 状态码
data()   { req "$@" | sed '$d'; }   # 只要响应体
# 从 JSON 里取字段值（简易提取，够用）
field()  { echo "$1" | grep -o "\"$2\":\"\?[^,\"}]*" | head -1 | sed "s/\"$2\":\"\?//"; }

TS=$(date +%s)          # 时间戳后缀，保证脚本可以重复运行
UA="alice_$TS"
UB="bob_$TS"

# 中文的 URL 编码（浏览器/Apifox 发中文查询参数时也是这么编码的）
# 直接写中文会被 Git Bash 转码成 GBK，所以这里用编码后的值
# 想生成别的词：printf '要编码的词' | python -X utf8 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))"
KW_CARD="%E6%A0%A1%E5%9B%AD%E5%8D%A1"   # 校园卡
KW_LIB="%E5%9B%BE%E4%B9%A6%E9%A6%86"    # 图书馆

echo ""
echo "=========== 1. 用户注册 / 登录 / 当前用户 / 退出 ==========="

check "注册用户A"        200 "$(status POST /auth/register "" "{\"username\":\"$UA\",\"password\":\"123456\",\"nickname\":\"小明\",\"student_id\":\"23051101\"}")"
check "注册用户B"        200 "$(status POST /auth/register "" "{\"username\":\"$UB\",\"password\":\"123456\",\"nickname\":\"小红\"}")"
check "重复注册被拒(400)" 400 "$(status POST /auth/register "" "{\"username\":\"$UA\",\"password\":\"123456\"}")"
check "参数太短被拒(400)" 400 "$(status POST /auth/register "" "{\"username\":\"ab\",\"password\":\"123\"}")"

LOGIN_A=$(data POST /auth/login "" "{\"username\":\"$UA\",\"password\":\"123456\"}")
TOKEN_A=$(field "$LOGIN_A" token)
check "登录用户A"        200 "$(status POST /auth/login "" "{\"username\":\"$UA\",\"password\":\"123456\"}")"
check "拿到token"        "yes" "$([ -n "$TOKEN_A" ] && echo yes || echo no)"
check "密码错误被拒(400)" 400 "$(status POST /auth/login "" "{\"username\":\"$UA\",\"password\":\"wrongpass\"}")"

TOKEN_B=$(field "$(data POST /auth/login "" "{\"username\":\"$UB\",\"password\":\"123456\"}")" token)

check "获取当前用户"      200 "$(status GET /auth/me "$TOKEN_A")"
check "未登录拿不到(401)" 401 "$(status GET /auth/me "")"
check "退出登录"         200 "$(status POST /auth/logout "$TOKEN_A")"

echo ""
echo "=========== 2. 发布信息 ==========="

check "未登录不能发布(401)" 401 "$(status POST /items "" '{"type":"lost","title":"测试","category":"card","happened_at":"2026-10-06 10:00","contact":"微信 test"}')"

ITEM1=$(data POST /items "$TOKEN_A" '{"type":"lost","title":"校园卡","category":"card","campus":"下沙校区","place":"图书馆二楼","happened_at":"2026-10-05 14:30","description":"黑色卡套，里面有校园卡和饭卡","contact":"微信 xiaoming123"}')
ID1=$(field "$ITEM1" id)
check "发布失物帖"        "yes" "$([ -n "$ID1" ] && echo yes || echo no)"
check "发布招领帖"        200 "$(status POST /items "$TOKEN_B" '{"type":"found","title":"黑色耳机","category":"electronics","campus":"下沙校区","place":"三食堂","happened_at":"2026-10-06 12:00","contact":"QQ 987654321"}')"
check "发布第二篇失物"     200 "$(status POST /items "$TOKEN_A" '{"type":"lost","title":"钥匙串","category":"daily","campus":"下沙校区","place":"宿舍区","happened_at":"2026-10-04 08:00","contact":"微信 xiaoming123"}')"
check "缺必填字段被拒(400)" 400 "$(status POST /items "$TOKEN_A" '{"type":"lost","title":"没有联系方式"}')"
check "非法分类被拒(400)"   400 "$(status POST /items "$TOKEN_A" '{"type":"lost","title":"x","category":"不存在的分类","happened_at":"2026-10-06","contact":"wx"}')"

echo ""
echo "=========== 3. 列表 / 搜索 / 筛选 / 分页 ==========="

LIST=$(data GET "/items" "")
check "公开列表可访问"     200 "$(status GET /items "")"
check "列表返回总数"       "yes" "$([ -n "$(field "$LIST" total)" ] && echo yes || echo no)"
check "关键词搜索命中"      "yes" "$(data GET "/items?keyword=$KW_CARD" "" | grep -q "校园卡" && echo yes || echo no)"
check "关键词搜不到时返回[]" "yes" "$(data GET "/items?keyword=zzz_not_exist" "" | grep -q '"list":\[\]' && echo yes || echo no)"
check "按类型筛选"         "yes" "$(data GET "/items?type=found" "" | grep -q "黑色耳机" && echo yes || echo no)"
check "按分类筛选"         "yes" "$(data GET "/items?category=card" "" | grep -q "校园卡" && echo yes || echo no)"
check "按地点搜索"         "yes" "$(data GET "/items?place=$KW_LIB" "" | grep -q "校园卡" && echo yes || echo no)"
check "分页 page_size=1"   "1"   "$(data GET "/items?page_size=1" "" | grep -o '"id":[0-9]*' | wc -l | tr -d ' ')"

echo ""
echo "=========== 4. 详情 / 查看联系方式 ==========="

DETAIL=$(data GET "/items/$ID1" "")
check "详情可访问"         200 "$(status GET "/items/$ID1" "")"
check "详情含发布者昵称"    "yes" "$(echo "$DETAIL" | grep -q "publisher_nickname" && echo yes || echo no)"
check "详情不含联系方式"    "no"  "$(echo "$DETAIL" | grep -q '"contact"' && echo yes || echo no)"
check "不存在的帖子(404)"  404 "$(status GET "/items/999999" "")"
check "非法id(400)"       400 "$(status GET "/items/abc" "")"

check "未登录看不到联系方式(401)" 401 "$(status GET "/items/$ID1/contact" "")"
CONTACT=$(data GET "/items/$ID1/contact" "$TOKEN_B")
check "登录后能看到联系方式"      200 "$(status GET "/items/$ID1/contact" "$TOKEN_B")"
check "联系方式内容正确"          "yes" "$(echo "$CONTACT" | grep -q "xiaoming123" && echo yes || echo no)"

echo ""
echo "=========== 5. 权限：只能改删自己的帖子 ==========="

check "改别人的帖子被拒(403)" 403 "$(status PUT "/items/$ID1" "$TOKEN_B" '{"title":"我改了"}')"
check "删别人的帖子被拒(403)" 403 "$(status DELETE "/items/$ID1" "$TOKEN_B")"
check "改状态别人的被拒(403)" 403 "$(status PATCH "/items/$ID1/status" "$TOKEN_B" '{"status":"resolved"}')"
check "改自己的帖子"        200 "$(status PUT "/items/$ID1" "$TOKEN_A" '{"description":"黑色卡套，已补图"}')"

echo ""
echo "=========== 6. 状态机：只能前进，不能回退 ==========="

check "寻找中→已找到"      200 "$(status PATCH "/items/$ID1/status" "$TOKEN_A" '{"status":"resolved"}')"
check "已找到→已结束"      200 "$(status PATCH "/items/$ID1/status" "$TOKEN_A" '{"status":"closed"}')"
check "已结束→回退被拒(400)" 400 "$(status PATCH "/items/$ID1/status" "$TOKEN_A" '{"status":"searching"}')"
check "非法状态被拒(400)"   400 "$(status PATCH "/items/$ID1/status" "$TOKEN_A" '{"status":"随便写的"}')"
check "状态筛选已结束"      "yes" "$(data GET "/items?status=closed" "" | grep -q "\"id\":$ID1," && echo yes || echo no)"
check "默认列表不含已结束"  "no"  "$(data GET "/items" "" | grep -q "\"id\":$ID1," && echo yes || echo no)"

echo ""
echo "=========== 7. 我的发布 / 删除 ==========="

check "我的发布需要登录(401)" 401 "$(status GET /items/my "")"
MY=$(data GET /items/my "$TOKEN_A")
check "我的发布能查到"       "yes" "$(echo "$MY" | grep -q "校园卡" && echo yes || echo no)"
check "我的发布含已结束的"   "yes" "$(echo "$MY" | grep -q "closed" && echo yes || echo no)"

check "删除自己的帖子"      200 "$(status DELETE "/items/$ID1" "$TOKEN_A")"
check "删掉后详情404"       404 "$(status GET "/items/$ID1" "")"

echo ""
echo "============================================================"
echo "  测试完成：通过 $PASS 项，失败 $FAIL 项"
echo "============================================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
