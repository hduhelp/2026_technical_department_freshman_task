#!/bin/bash
# ============================================================
#  演示种子数据
#  作用：清空数据库 → 灌入 3 个演示账号 + 18 条帖子
#  用法：先启动后端（./lostfound.exe），再执行  bash scripts/seed_data.sh
#
#  ★ 可重复运行：排练时数据搞乱了，重跑一次就恢复原样
# ============================================================

BASE="http://localhost:8080/api"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

cd "$(dirname "$0")/.." || exit 1

# ---------- 从 config.yaml 读 MySQL 账号和密码 ----------
# 依次去掉：行内注释(# 开头) → 键名 → 引号和空格 → 可能的 \r
# （读 user 字段而不是写死 root：本地是 root、服务器上是专用账号 lostfound，一份脚本两处通用）
DB_USER=$(grep -E '^[[:space:]]*user:' config.yaml | head -1 \
     | sed 's/#.*//; s/.*user:[[:space:]]*//' \
     | tr -d '"[:space:]\r')
PW=$(grep -E '^[[:space:]]*password:' config.yaml | head -1 \
     | sed 's/#.*//; s/.*password:[[:space:]]*//' \
     | tr -d '"[:space:]\r')

echo ""
echo "════════════ 灌入演示数据 ════════════"
echo ""
echo "① 清空数据库…"
mysql -u "$DB_USER" -p"$PW" --default-character-set=utf8mb4 \
  -e "USE lostfound; TRUNCATE TABLE items; TRUNCATE TABLE users;" 2>/dev/null \
  && echo "   ✅ 已清空（users / items）" \
  || { echo "   ❌ 清空失败，检查 MySQL 是否启动、config.yaml 账号密码是否正确"; exit 1; }

# ---------- 工具函数（中文请求体走文件，避免 Git Bash 转码） ----------
post()      { printf '%s' "$2" > "$TMP"; curl -s -X POST  "$BASE$1" -H "Content-Type: application/json" --data-binary "@$TMP"; }
post_auth() { printf '%s' "$2" > "$TMP"; curl -s -X POST  "$BASE$1" -H "Authorization: Bearer $3" -H "Content-Type: application/json" --data-binary "@$TMP"; }
patch_auth(){ printf '%s' "$2" > "$TMP"; curl -s -X PATCH "$BASE$1" -H "Authorization: Bearer $3" -H "Content-Type: application/json" --data-binary "@$TMP"; }
field()     { echo "$1" | grep -o "\"$2\":\"\?[^,\"}]*" | head -1 | sed "s/\"$2\":\"\?//"; }

# ---------- ② 建演示账号 ----------
echo ""
echo "② 创建演示账号…"

# 用户名|密码|昵称|学号
USERS=(
  "tongshixuan|123456|童诗轩|23051101"
  "xiaoming|123456|小明|23051102"
  "xiaohong|123456|小红|23051103"
)

TOKENS=()
n=0
for u in "${USERS[@]}"; do
  IFS='|' read -r uname pwd nick sid <<< "$u"
  post "/auth/register" "{\"username\":\"$uname\",\"password\":\"$pwd\",\"nickname\":\"$nick\",\"student_id\":\"$sid\"}" > /dev/null
  resp=$(post "/auth/login" "{\"username\":\"$uname\",\"password\":\"$pwd\"}")
  TOKENS[$n]=$(field "$resp" token)
  echo "   ✅ $nick（用户名 $uname / 密码 $pwd）"
  n=$((n + 1))
done

# ---------- ③ 发布帖子 ----------
echo ""
echo "③ 发布帖子…"

# 类型|标题|分类|校区|地点|丢失时间|描述|联系方式|发布者(1/2/3)|目标状态
ITEMS=(
  # ---------- 失物 ----------
  "lost|校园卡|card|下沙校区|图书馆二楼|2026-10-05 14:30|黑色卡套，里面有校园卡和饭卡，姓名童**|微信 tong_tsx_2024|1|searching"
  "lost|黑色无线耳机|electronics|下沙校区|三食堂|2026-10-05 12:10|AirPods Pro，充电盒上有一道划痕|QQ 872341556|1|searching"
  "lost|高等数学课本|books|下沙校区|6号教学楼 305|2026-10-04 16:20|《高等数学》上册，扉页写了名字，里面夹着几张草稿纸|微信 tong_tsx_2024|1|resolved"
  "lost|蓝色保温杯|daily|下沙校区|操场看台|2026-10-03 18:40|膳魔师 500ml，杯底贴了一张卡通贴纸|手机 13812345678|1|searching"
  "lost|宿舍钥匙|daily|下沙校区|宿舍区 12 号楼|2026-10-02 21:00|一串钥匙（3 把），挂着一个棕色小熊挂件|微信 tong_tsx_2024|1|closed"
  "lost|灰色连帽卫衣|clothing|下沙校区|体育馆|2026-10-05 20:15|优衣库灰色卫衣，左袖口有一点墨迹|QQ 872341556|2|searching"
  "lost|黑框眼镜|daily|下沙校区|图书馆一楼大厅|2026-10-06 09:30|黑色半框眼镜，装在蓝色眼镜盒里|微信 xm_2024|2|searching"
  "lost|深蓝色雨伞|daily|下沙校区|一食堂门口|2026-10-04 19:00|长柄伞，伞柄缠了一圈黑色胶带|手机 13998765432|2|searching"
  "lost|小米充电宝|electronics|下沙校区|3号教学楼 201|2026-10-05 15:50|白色 10000mAh，侧面有磕碰痕迹|微信 xm_2024|2|searching"
  "lost|银色U盘|electronics|下沙校区|计算机学院机房|2026-10-03 11:20|16G，挂着一根红绳，里面有课程作业|QQ 554321789|3|searching"
  # ---------- 招领 ----------
  "found|校园卡|card|下沙校区|图书馆三楼|2026-10-06 10:20|捡到一张校园卡，姓李，请失主联系我认领|微信 xh_help|3|searching"
  "found|黑色蓝牙耳机|electronics|下沙校区|三食堂二楼|2026-10-06 12:30|在餐桌上捡到一只黑色蓝牙耳机，已交给食堂阿姨保管|微信 xh_help|3|searching"
  "found|白色保温杯|daily|下沙校区|5号教学楼 302|2026-10-05 17:00|落在教室后排，杯身上有一道贴纸痕迹|QQ 554321789|3|resolved"
  "found|高数笔记本|books|下沙校区|图书馆自习区|2026-10-04 14:00|一本笔记本，里面记满了高数笔记，第一页有名字|微信 xh_help|1|searching"
  "found|一串钥匙|daily|下沙校区|操场|2026-10-05 19:30|有 3 把钥匙和一张门禁卡，挂件是只小黄鸭|手机 13711112222|1|searching"
  "found|米色围巾|clothing|下沙校区|一食堂|2026-10-03 08:40|捡到一条米色针织围巾，已放在一食堂失物招领处|微信 tong_tsx_2024|1|searching"
  "found|学生证|card|下沙校区|体育馆|2026-10-04 20:10|捡到一本学生证，姓王，请同学联系我|QQ 872341556|2|closed"
  "found|格子雨伞|other|下沙校区|图书馆门口伞架|2026-10-06 08:50|一把蓝白格子伞，应该是昨天落下的|微信 xm_2024|2|searching"
)

declare -a IDS
i=0
for row in "${ITEMS[@]}"; do
  IFS='|' read -r type title cat campus place when desc contact owner final <<< "$row"
  tok=${TOKENS[$((owner - 1))]}

  body=$(printf '{"type":"%s","title":"%s","category":"%s","campus":"%s","place":"%s","happened_at":"%s","description":"%s","contact":"%s"}' \
    "$type" "$title" "$cat" "$campus" "$place" "$when" "$desc" "$contact")

  resp=$(post_auth "/items" "$body" "$tok")
  id=$(field "$resp" id)
  IDS[$i]=$id

  # 需要改状态的，顺手改掉
  if [ "$final" != "searching" ] && [ -n "$id" ]; then
    patch_auth "/items/$id/status" "{\"status\":\"$final\"}" "$tok" > /dev/null
  fi

  label="失物"; [ "$type" = "found" ] && label="招领"
  mark=""
  [ "$final" = "resolved" ] && mark=" → 已找到"
  [ "$final" = "closed" ]   && mark=" → 已结束"
  printf "   ✅ [%s] %-14s (id=%s)%s\n" "$label" "$title" "$id" "$mark"
  i=$((i + 1))
done

# ---------- ④ 汇总 ----------
TOTAL=$(curl -s "$BASE/items?status=all&page_size=1" | grep -o '"total":[0-9]*' | cut -d: -f2)

echo ""
echo "════════════ 完成 ════════════"
echo ""
echo "  帖子总数：$TOTAL 条"
echo "  其中：寻找中 14 ｜ 已找到 2 ｜ 已结束 2"
echo ""
echo "  ┌────────────── 演示账号（密码都是 123456）──────────────┐"
echo "  │  童诗轩  用户名 tongshixuan   ← 主账号（发帖最多）      │"
echo "  │  小明    用户名 xiaoming      ← 用来演示\"换账号看联系方式\" │"
echo "  │  小红    用户名 xiaohong      ← 数据多样性              │"
echo "  └────────────────────────────────────────────────────────┘"
echo ""
echo "  打开 http://localhost:8080 开始演示"
echo ""
