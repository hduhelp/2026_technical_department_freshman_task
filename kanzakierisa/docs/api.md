# API 文档

> 校园失物招领系统后端接口文档。
> 本文件随阶段推进增量维护：**P0 脚手架 / P1 认证与用户 / P2 帖子 CRUD 与图片上传 / P3 列表搜索、分页与状态机已完成**，认领与匹配模块在后续阶段补全。

## 约定速览

- 基础路径 `/api`，请求与响应体均为 `application/json`（上传接口除外，为 `multipart/form-data`）
- 鉴权：请求头 `Authorization: Bearer <token>`
- 统一响应体：`{ "code": 0, "message": "ok", "data": { } }`
- 列表类接口的 `data` 形如 `{ "list": [], "page": 1, "pageSize": 10, "total": 137 }`
- 所有时间字段均为 **RFC3339 UTC**（如 `2026-09-30T23:24:48Z`），由前端转换为本地时区展示
- 分页：`page` 默认 1；`pageSize` 默认 10，范围 1–50，**越界夹取不报错**
- 列表筛选：枚举参数（`type` / `status` / `category`）取到**非法值**时**静默忽略该条件**（等同不筛选），同样不报错 —— 与分页参数保持同一条「容错优先」策略

### 鉴权类型说明

| 类型 | 含义 |
| --- | --- |
| 否 | 公开接口，无需 token |
| 是 | 必须携带合法 token，否则返回 `1002 / 401` |
| 软鉴权 | 有合法 token 则识别身份，无 token 或 token 失效**也放行**（P2 的帖子详情/匹配接口使用） |

---

## 错误码表

| code | HTTP | 含义 | 触发场景 |
| --- | --- | --- | --- |
| 0 | 200 | 成功 | — |
| 1001 | 400 | 参数错误 | 请求体校验失败、路径参数非法、请求体中的枚举非法（**列表筛选参数不适用**，见「列表接口通用约定」） |
| 1002 | 401 | 未登录或凭证失效 | 缺 token / 验签失败 / 过期 / 用户已不存在 |
| 1003 | 403 | 无权限 | 改别人的帖子、非帖主审核 |
| 1004 | 404 | 资源不存在 | 帖子 / 认领 / 用户不存在 |
| 1005 | 409 | 用户名已被占用 | 注册重名 |
| 1006 | 401 | 用户名或密码错误 | 登录失败（**不区分二者**，防用户名枚举） |
| 1007 | 400 | 状态流转非法 | 违反状态机白名单 |
| 1008 | 409 | 已提交过认领申请 | 触发 `uk_post_claimant` |
| 1009 | 400 | 上传文件不合法 | 类型非 jpg/png 或超过 2MB |
| 1010 | 409 | 该帖子已有通过的认领 | 触发 `uk_post_approved` |
| 1011 | 400 | 凭证码错误 | 核销时校验失败 |
| 5000 | 500 | 服务器内部错误 | 未预期的错误（不暴露细节给前端） |

---

## 实体 JSON 形状

### User

对外**永远不含** `password_hash`。

```json
{
  "id": 1,
  "username": "alice",
  "nickname": "小明",
  "contact": "wx: alice_hdu",
  "contact_public": false,
  "role": "user",
  "created_at": "2026-10-01T04:12:33Z"
}
```

---

## 接口清单

| 模块 | 方法 & 路径 | 鉴权 | 说明 | 状态 |
| --- | --- | --- | --- | --- |
| 健康检查 | GET `/api/health` | 否 | 返回 `{"code":0,"message":"ok","data":{"db":"up"}}` | P0 ✅ |
| 认证 | POST `/api/auth/register` | 否 | `{username, password, nickname?}` | P1 ✅ |
| 认证 | POST `/api/auth/login` | 否 | `{username, password}` → `{token, user}` | P1 ✅ |
| 认证 | POST `/api/auth/logout` | 是 | 无状态，返回成功即可（前端清 token） | P1 ✅ |
| 用户 | GET `/api/users/me` | 是 | 当前用户信息 | P1 ✅ |
| 用户 | PATCH `/api/users/me` | 是 | `{nickname?, contact?, contact_public?}` | P1 ✅ |
| 帖子 | POST `/api/posts` | 是 | 创建帖子 | P2 ✅ |
| 帖子 | GET `/api/posts` | 否 | `type` `status` `category` `keyword` `page` `pageSize` | P3 ✅ |
| 帖子 | GET `/api/posts/:id` | 软鉴权 | 详情，按三级规则处理联系方式 | P2 ✅ |
| 帖子 | PUT `/api/posts/:id` | 是 | 仅作者；**不允许改 `type` 与 `status`** | P2 ✅ |
| 帖子 | DELETE `/api/posts/:id` | 是 | 仅作者；级联删除其认领 | P2 ✅ |
| 帖子 | PATCH `/api/posts/:id/status` | 是 | `{status}`，仅作者，走状态机白名单 | P3 ✅ |
| 帖子 | GET `/api/users/me/posts` | 是 | `status?` `page` `pageSize` | P3 ✅ |
| 上传 | POST `/api/upload` | 是 | `multipart/form-data`，字段名 `file` → `{url}` | P2 ✅ |
| 认领 | POST `/api/posts/:id/claims` | 是 | `{proof}` | P6 |
| 认领 | GET `/api/posts/:id/claims` | 是 | 仅帖主，返回该帖全部申请 | P6 |
| 认领 | PATCH `/api/claims/:id` | 是 | `{action: "approve"\|"reject", reject_reason?}`，仅帖主或 admin | P6 |
| 认领 | GET `/api/users/me/claims` | 是 | 我发出的认领；`page` `pageSize` | P6 |
| 认领 | POST `/api/claims/:id/redeem` | 是 | `{voucher_code}`，仅帖主；核销后帖子置 `closed` | P6 |
| 匹配 | GET `/api/posts/:id/matches` | 软鉴权 | 返回 `[{post, score, reasons[]}]`，最多 5 条 | P6 |

> **静态资源**：`GET /uploads/<uuid>.<ext>` —— **不经过 `/api` 前缀**，也**不需要鉴权**（图片是公开资源）。
> 由 `r.Static("/uploads", cfg.UploadDir)` 直接托管。

---

## GET /api/health

健康检查：真实探测数据库连通性。

- 数据库正常：`HTTP 200`，`data.db = "up"`
- 数据库异常：`HTTP 503`，`data.db = "down"`

两种情况的 `code` 均为 0 —— 业务码表示「服务本身能应答」，可用性由 HTTP 状态码表达，便于探针据此摘流量。

```bash
curl http://localhost:8080/api/health
```

```json
{ "code": 0, "message": "ok", "data": { "db": "up" } }
```

---

## POST /api/auth/register

注册新用户。**注册成功不自动登录**，响应只返回 `user`，前端收到后引导用户前往登录页。

### 请求体

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `username` | string | 是 | 3–32 位，仅允许字母、数字、下划线（`^[A-Za-z0-9_]{3,32}$`） |
| `password` | string | 是 | 6–64 位 |
| `nickname` | string | 否 | ≤32 字符；**留空时回落为 `username`** |

### 响应 data

```json
{
  "user": {
    "id": 9,
    "username": "dave",
    "nickname": "小刚",
    "contact": "",
    "contact_public": false,
    "role": "user",
    "created_at": "2026-09-30T23:21:48Z"
  }
}
```

> **为什么注册不返回 token？** 注册与登录是两件事，让用户显式登录一次能确认「密码是他记得住的」，
> 也避免注册接口同时承担签发凭证的职责。若后续产品要求注册即登录，再扩展响应体即可（属向后兼容的增量）。

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 用户名格式非法 / 密码长度不符 / 昵称超长 | 1001 | 400 |
| 用户名已被占用（命中 `uk_username`） | 1005 | 409 |

> **重名判定为什么不先查再插？** 先 `SELECT` 再 `INSERT` 在并发下存在 TOCTOU 竞态：
> 两个请求可能同时通过预检。正确姿势是直接 `INSERT` 并捕获 MySQL 唯一键冲突
> （errno 1062），由数据库的唯一索引做最终裁决。

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"dave","password":"123456","nickname":"小刚"}'
```

---

## POST /api/auth/login

登录并签发 JWT。

### 请求体

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `username` | string | 是 |
| `password` | string | 是 |

### 响应 data

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "alice",
    "nickname": "小明",
    "contact": "wx: alice_hdu",
    "contact_public": true,
    "role": "user",
    "created_at": "2026-09-30T20:37:29Z"
  }
}
```

- token 算法 `HS256`，有效期由 `JWT_EXPIRE_HOURS` 控制（默认 168 小时 = 7 天）
- token 载荷只含 `uid`；**昵称、角色等可变量不放进 token**，鉴权时回查数据库取最新值

### 错误

**「用户名不存在」与「密码错误」一律返回 `1006 / 401`，且响应体完全相同。**

> **为什么合并？** 若分别返回「用户不存在」和「密码错误」，攻击者可以逐一试出哪些用户名真实存在（用户名枚举）。
>
> **额外防护：** 用户名不存在时，服务端**仍然执行一次 bcrypt 比对**（对一个固定的 dummy hash）。
> 否则「不存在」路径因跳过哈希计算会明显更快，响应时间差本身就是侧信道。

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"123456"}'
```

---

## POST /api/auth/logout

登出。JWT 是无状态的，服务端**不维护 token 黑名单**（见 SPEC 第 12 章「明确不做」），
本接口只返回成功，实际登出由前端清除本地 token 完成。

- 鉴权：是

```json
{ "code": 0, "message": "ok", "data": null }
```

---

## GET /api/users/me

返回当前登录用户信息。

- 鉴权：是

```bash
curl http://localhost:8080/api/users/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "username": "alice",
    "nickname": "小明",
    "contact": "wx: alice_hdu",
    "contact_public": true,
    "role": "user",
    "created_at": "2026-09-30T20:37:29Z"
  }
}
```

> 响应中**永远不会出现 `password_hash`**：`model.User.PasswordHash` 的 json tag 为 `-`，
> 且对外只输出 `UserDTO`，两道防线确保哈希不外泄。

---

## PATCH /api/users/me

局部更新当前用户资料。

- 鉴权：是

### 请求体

三个字段**全部可选**，只更新请求中**真正出现**的字段。

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `nickname` | string | 非空，≤32 字符 |
| `contact` | string | ≤64 字符，**允许传空串以清空** |
| `contact_public` | bool | — |

```json
{ "nickname": "小明2", "contact_public": true }
```

### 响应 data

更新后的完整 `User`。

### 不可修改的字段

`role`、`username`、`password_hash` **无法通过本接口修改**。
请求体中即使携带这些键也会被直接忽略（`UpdateMeReq` 结构体里没有对应字段，JSON 解码阶段即丢弃），
响应仍为 `code=0`，但值保持不变。

```bash
# 尝试提权 —— 返回 code=0，但 role 仍为 user
curl -X PATCH http://localhost:8080/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"role":"admin"}'
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 昵称超长 / 昵称为空 / 联系方式超长 | 1001 | 400 |
| 未登录 | 1002 | 401 |

> **为什么三个字段都用指针（`*string` / `*bool`）？**
> 若用值类型，前端不传 `nickname` 时 Go 会把它解码成零值空串，
> 于是一次「只想改联系方式」的请求会把用户昵称**静默清空**。
> 指针让「未提供」和「提供了空值」成为两种可区分的语义。

---

## 鉴权失败响应

所有需要鉴权的接口在以下情况统一返回 `1002 / 401`：

- 缺少 `Authorization` 头
- 头中缺少 `Bearer ` 前缀（注意末尾空格）
- token 为空、格式错误、签名不匹配、已过期
- 算法不是 HS256（含伪造的 `alg: none`）
- **签名有效但用户已不存在**（token 只证明签发时存在，因此验签后必须回查数据库）

```json
{ "code": 1002, "message": "未登录或登录已过期", "data": null }
```

---

## Post

```json
{
  "id": 12,
  "user_id": 1,
  "type": "lost",
  "title": "黑色卡套校园卡",
  "category": "card",
  "location": "下沙校区图书馆 3 楼",
  "happened_at": "2026-09-26T14:30:00Z",
  "description": "黑色卡套，里面是校园卡，卡号尾号 0421",
  "images": ["/uploads/8f3c....jpg"],
  "status": "open",
  "created_at": "2026-09-30T11:00:00Z",
  "updated_at": "2026-09-30T11:00:00Z",
  "author": { "id": 1, "nickname": "小明", "contact": "", "contact_visible": false },
  "can_edit": true,
  "can_claim": false
}
```

- `author` 对象**只有 4 个字段**（`id` / `nickname` / `contact` / `contact_visible`）：
  没有 `username`、没有 `role`、**永远没有 `password_hash`**。这是白名单式的设计 ——
  不外泄不靠「记得删掉」，而靠结构体里根本没有那个字段。
- `author.contact`：按三级可见性规则填充，不可见时为空串 `""`
- `can_edit`：请求者是否为作者
- `can_claim`：是否满足认领的静态前置条件（`type=found`、非本人、`status≠closed`、已登录）；游客恒 `false`
- `images` 为空时是 `[]`，**不是 `null`**（数据库列也存 `[]` 而非 NULL）
- **列表接口中的差异**（P3）：`author.contact` 一律为 `""`，`contact_visible` 仍按规则计算

---

## POST /api/posts

创建帖子。

- 鉴权：**是**

### 请求体

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `type` | string | 是 | ∈ {`lost`, `found`} |
| `title` | string | 是 | 1–64 **字符（rune）** |
| `category` | string | 否 | 缺省 `other`；∈ {`card`,`digital`,`book`,`key`,`clothes`,`other`} |
| `location` | string | 否 | ≤64 rune |
| `happened_at` | string | 是 | RFC3339（允许带毫秒），且**不晚于当前时间 + 1 小时** |
| `description` | string | 否 | ≤2000 rune |
| `images` | string[] | 否 | ≤3 项；每项必须以 `/uploads/` 开头且不含 `..` |

```json
{
  "type": "lost",
  "title": "黑色卡套校园卡",
  "category": "card",
  "location": "下沙校区图书馆 3 楼",
  "happened_at": "2026-09-26T14:30:00Z",
  "description": "黑色卡套，里面是校园卡",
  "images": ["/uploads/8f3c.jpg"]
}
```

### 响应 data

新建的 `Post`（含 `author`、`can_edit=true`）。

### 说明

- 初始 `status` 固定为 `open`，**不接受前端传入**（请求体带 `status` 会在 JSON 解码阶段被丢弃）
- 作者固定取当前登录用户，**不接受请求体里的 `user_id`**
- 长度一律按 **rune** 计（`utf8.RuneCountInString`）。中文标题用字节计会 3 倍超长，
  一个 22 字的中文标题会被误判为「超过 64」

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| `type` 非法 / 标题空或超长 / `category` 非法 / `happened_at` 缺失或超未来 / `images` 超量或前缀错 | 1001 | 400 |
| 未登录 | 1002 | 401 |

```bash
curl -X POST http://localhost:8080/api/posts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"lost","title":"黑色卡套校园卡","category":"card","location":"图书馆3楼",
       "happened_at":"2026-09-26T14:30:00Z","description":"黑色卡套","images":[]}'
```

---

## GET /api/posts/:id

帖子详情。按 SPEC 7.2 的三级规则处理联系方式可见性。

- 鉴权：**软鉴权**（有无 token 都放行；非法 token 静默降级为游客，**不返回 1002**）

### 联系方式三级可见性

```
if viewer == 游客                    → false
if viewer.ID == author.ID            → true   // 本人可见
if author.contact_public             → true   // 作者主动公开
if 双方存在已通过的认领关系           → true   // P6 接入，P3 恒 false
otherwise                            → false
```

> **实现在 SQL 层（P3）**：可见性判断被写进 SELECT 列表（`CASE WHEN ... THEN u.contact ELSE '' END`），
> 不可见的行由数据库直接返回空串，**真实联系方式根本不会进入应用内存** ——
> 而不是「先查出来再在内存里删掉」。列表接口更进一步，干脆不 SELECT 这一列。

响应中**同时**返回 `author.contact`（不可见时 `""`）与 `author.contact_visible`（bool），
前端据此渲染不同 CTA。

```bash
# 游客
curl http://localhost:8080/api/posts/12
# → author.contact="", contact_visible=false, can_edit=false

# 登录用户
curl http://localhost:8080/api/posts/12 -H "Authorization: Bearer $TOKEN"
# → 本人作者：author.contact="wx: alice_hdu", contact_visible=true, can_edit=true
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 帖子不存在 | 1004 | 404 |
| 路径 id 非正整数 | 1001 | 400 |

---

## PUT /api/posts/:id

更新帖子。**仅作者**。

- 鉴权：**是**

### 请求体

全部字段可选，只更新请求中**真正出现**的字段（语义等同 PATCH）。

| 字段 | 约束 |
| --- | --- |
| `title` | 空时视为不修改；给了则 1–64 rune |
| `category` | ∈ 枚举 |
| `location` | ≤64 rune |
| `happened_at` | RFC3339，不晚于当前时间 + 1h |
| `description` | ≤2000 rune |
| `images` | ≤3 项，`/uploads/` 前缀 |

### 不可修改的字段

`type`、`status`、`user_id` **无法通过本接口修改**。
请求体中即使携带这些键也会被忽略（`UpdatePostReq` 结构体里没有对应字段，JSON 解码阶段即丢弃），
响应仍为 `code=0` 但值保持不变。

```bash
# 尝试篡改 type/status/user_id —— 返回 code=0，但三者均未改变
curl -X PUT http://localhost:8080/api/posts/12 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"新标题","type":"found","status":"closed","user_id":999}'
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 字段校验失败 | 1001 | 400 |
| 未登录 | 1002 | 401 |
| **非作者**（改别人的帖子） | 1003 | 403 |
| 帖子不存在 | 1004 | 404 |
| 帖子已 `closed`（终态不可编辑） | 1007 | 400 |

> **为什么把「已结束不可编辑」归到 1007 而不是 1001？**
> 1007 的语义是「状态流转非法」。`closed` 是终态，对它的任何写操作
> 本质都是「试图让一个终态对象继续变化」，与状态机约束同源，故复用该码。

---

## DELETE /api/posts/:id

删除帖子。**仅作者**。

- 鉴权：**是**

该帖子下的**全部认领记录由外键 `ON DELETE CASCADE` 自动清理**，
应用层不写任何删 claims 的 SQL —— 多写一句就多一处可能与数据库约束不一致的地方。

```json
{ "code": 0, "message": "ok", "data": null }
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 未登录 | 1002 | 401 |
| 非作者 | 1003 | 403 |
| 帖子不存在 | 1004 | 404 |

---

## 列表接口通用约定（P3）

`GET /api/posts` 与 `GET /api/users/me/posts` 共用以下约定。

### 分页参数

| 参数 | 默认 | 规则 |
| --- | --- | --- |
| `page` | 1 | 非数字或 < 1 → **归一化为 1** |
| `pageSize` | 10 | 非数字 → **10**；< 1 → **1**；> 50 → **夹取为 50** |

越界一律夹取，**任何情况都不返回 1001**。页码超过总页数时返回**空 `list` 且 `code = 0`**，不返回 404。

> **为什么夹取而不是报错？** 分页参数由前端按用户操作拼装，一个 `pageSize=999`
> 不该让整个列表页变成 400 被挡在门外；而 50 的上限是防「一次拉全表」的必要保护。

### 列表筛选参数策略（本阶段明确选定的策略）

| 参数 | 说明 |
| --- | --- |
| `type` | ∈ {`lost`, `found`} |
| `status` | ∈ {`open`, `matched`, `closed`} |
| `category` | ∈ {`card`,`digital`,`book`,`key`,`clothes`,`other`} |
| `keyword` | 同时匹配 `title` 与 `description`，前空白会被 `TrimSpace`，为空视为未传 |

**枚举参数取到非法值时，服务端静默忽略该条件（等同不筛选），返回 `code = 0`，不返回 1001。**

> 这是阶段文件 04 §4 给出的「二选一」中，本项目**明确选定**的一种，特此写明以免误解：
> - 选它的理由：筛选条件与分页参数同源（都由前端按点击拼 URL）。既然 `pageSize`
>   越界走的是「夹取不报错」，枚举非法也应当走同一条「容错优先」的路子，
>   否则同一类输入会出现两套处理方式。
> - 已知代价：`?type=lostt` 这类笔误会**静默返回全部结果**，看起来像筛选没生效。
>   前端应把用户的选择限制在下拉/标签控件里，从源头避免传错值。
> - 对照：`PATCH /api/posts/:id/status` 的 `status` 属于**请求体**而非筛选条件，
>   它取非法值仍然返回 `1001`（见该接口的错误表）。

### 排序

`ORDER BY created_at DESC, id DESC`。

> 追加 `id DESC` 是为了**稳定排序**：`created_at` 精度到秒，同一秒创建的两条帖子
> 若只按时间排序，MySQL 不保证两次查询的相对顺序一致，分页时会出现
> 「第 1 页与第 2 页同时出现某条，另一条永远看不到」。

### 列表里的 author 字段

- `author.contact` **一律为空串 `""`**，即使按可见性规则判定可见也不返回（减少一次批量查询里的泄露面）
- `author.contact_visible` 仍按三级规则计算，前端据此在卡片上渲染「登录后可见」之类的提示

---

## GET /api/posts

帖子列表（浏览 / 搜索 / 筛选）。这是任务原文点名要练习 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET` 的接口。

- 鉴权：**否**（游客可访问；游客的 `can_edit` / `can_claim` 恒为 `false`）

### 查询参数

`type`、`status`、`category`、`keyword`、`page`、`pageSize`，规则见上方「列表接口通用约定」。

### 响应 data

```json
{
  "list": [ /* Post */ ],
  "page": 1,
  "pageSize": 10,
  "total": 16
}
```

`total` 与 `list` **使用完全相同的 WHERE 条件**（同一个条件构造器），因此两者永远一致。

```bash
# 默认列表（page=1, pageSize=10）
curl "http://localhost:8080/api/posts"

# 关键字搜索（命中 title 或 description）
curl --get "http://localhost:8080/api/posts" --data-urlencode "keyword=校园卡"

# 分页
curl "http://localhost:8080/api/posts?page=2&pageSize=5"

# 组合筛选
curl "http://localhost:8080/api/posts?type=found&status=open&category=digital"

# 越界夹取（pageSize 会被夹到 50）
curl "http://localhost:8080/api/posts?pageSize=9999"
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 数据库异常 | 5000 | 500 |

> 查询参数本身**不产生任何 4xx**：分页越界夹取、枚举非法忽略。
> 路径参数非法（`GET /api/posts/abc`）才是 1001。

---

## GET /api/users/me/posts

「我的帖子」列表，用于「我的」页面的状态 Tab。

- 鉴权：**是**

### 查询参数

`status`、`page`、`pageSize`。**不支持** `type` / `category` / `keyword`。

`user_id` **固定取当前登录用户**，请求里带 `?user_id=` 会被忽略 ——
否则改一个参数就能翻别人的帖子。

### 响应 data

同 `GET /api/posts`。

```bash
curl "http://localhost:8080/api/users/me/posts?status=open" -H "Authorization: Bearer $TOKEN"
```

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 未登录 | 1002 | 401 |

---

## PATCH /api/posts/:id/status

帖子状态流转。

- 鉴权：**是**，且**仅作者**

### 请求体

| 字段 | 类型 | 必填 | 取值 |
| --- | --- | --- | --- |
| `status` | string | 是 | `open` \| `matched` \| `closed` |

```json
{ "status": "matched" }
```

### 状态机

```
                 作者点「已找到」            作者点「已结束」
open(寻找中) ──────────────────▶ matched(已找到) ──────────────▶ closed(已结束)
     │                                                                ▲
     └──────────────────── 作者直接「结束」───────────────────────────┘
```

- 合法跳转白名单：`open→matched`、`matched→closed`、`open→closed`
- `closed` 是**终态**，不可逆
- 与认领流程的联动（P6 接入）：认领 `approve` → 帖子自动置 `matched`；认领核销 → 帖子自动置 `closed`。
  自动流转**复用同一个校验函数**，不另写一份规则

### 响应 data

更新后的完整 `Post`（`status` 与 `updated_at` 已刷新）。

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| `status` 非法或缺失 | 1001 | 400 |
| 未登录 | 1002 | 401 |
| **非作者** | 1003 | 403 |
| 帖子不存在 | 1004 | 404 |
| 违反白名单（含 `closed` 终态） | 1007 | 400 |
| 并发下状态已被他人改动 | 1007 | 400 |

> **并发保护**：更新语句是 `UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND status = ?`，
> 末尾的 `AND status = ?` 是**乐观锁**。两个请求同时把 `open` 改成 `matched` 与 `closed` 时，
> 后到的那个会因为 `status` 已不是 `open` 而更新 0 行，从而返回 1007，
> 而不是静默覆盖前一次的结果。

> **校验顺序**：`1001（枚举） → 1004（存在） → 1003（作者） → 1007（白名单）`。
> 权限检查排在状态检查之前，越权者稳定拿到 403，不会因为「恰好状态也不允许」
> 而拿到 1007 —— 那等于把帖子当前状态泄露给了无权操作它的人。

```bash
# open -> matched
curl -X PATCH "http://localhost:8080/api/posts/1/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"matched"}'

# matched -> open：返回 1007
curl -X PATCH "http://localhost:8080/api/posts/1/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"open"}'
```

---

## POST /api/upload

上传图片。

- 鉴权：**是**
- Content-Type：`multipart/form-data`
- 表单字段名：`file`

### 校验（双重，缺一不可）

| 步骤 | 规则 | 失败 |
| --- | --- | --- |
| 1. 体积 | `file.Size` ≤ 2MB（`UPLOAD_MAX_MB` 可配） | 1009 |
| 2. 扩展名 | ∈ {`.jpg`, `.jpeg`, `.png`}（不区分大小写） | 1009 |
| 3. 魔数 | 读前 512 字节，`http.DetectContentType` 结果 ∈ {`image/jpeg`, `image/png`} | 1009 |

> **为什么要双重校验？** 只信扩展名会被「把 .exe 改名成 .png」绕过；
> 只信魔数则无法快速拒绝明显不合法的请求。两者同时成立才放行。
>
> 实测：一个内容为纯文本、但改名成 `.png` 的文件会被**魔数**拦下（1009），
> 证明扩展名不是唯一防线。

### 重命名与路径安全

- 落盘文件名固定为 `uuid.NewString() + 小写扩展名`，**绝不使用原始文件名**（防路径穿越与覆盖）
- 目标路径经 `filepath.Abs` 归一化后，与上传根目录做前缀比较，
  确认未越出根目录才写入（比较时补 `os.PathSeparator`，
  避免 `/data/uploads-evil` 被 `/data/uploads` 误判为「在目录内」）

### 响应 data

```json
{ "url": "/uploads/a65f333c-c630-4c2a-ba68-61757695a1b3.png" }
```

该 URL 可直接通过 `GET http://localhost:8080/uploads/<uuid>.png` 访问（无需鉴权），
返回 `Content-Type: image/png`。

### 错误

| 场景 | code | HTTP |
| --- | --- | --- |
| 未登录 | 1002 | 401 |
| 文件超 2MB / 扩展名不符 / 魔数不符 / 缺 `file` 字段 | 1009 | 400 |

```bash
curl -X POST http://localhost:8080/api/upload \
  -H "Authorization: Bearer $TOKEN" -F "file=@test.png"
```

---

## 软鉴权（optional_auth）

用于 `GET /api/posts/:id` 等对游客开放、但登录用户能看到额外信息的接口。

| 情况 | 行为 |
| --- | --- |
| 无 `Authorization` 头 | 放行，不设 user（游客） |
| 有头但 token 非法 / 过期 | **放行**，不设 user（降级为游客），**不返回 1002** |
| 验签通过但用户已被删除 | 放行，不设 user |
| 全部通过 | 校验并回查数据库，写入 context |

> **为什么 token 失效不报 1002？** 详情页是公开内容，一个过期的 token 不应该
> 让用户连帖子都打不开（表现为「分享链接给别人，自己反而看不了」）。
> 真正需要重新登录的时刻，由前端在调用写操作接口时感知。

---

## 前端接入注意事项（P5 补充）

### 1. `POST /api/upload` 的请求头

前端封装（`web/src/api/upload.js`）**故意不设置 `Content-Type`**：

```js
export const upload = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/upload', fd)   // 不要加 Content-Type
}
```

浏览器需要在 `Content-Type` 里带上 `multipart/form-data; boundary=----xxx` 中的
boundary。一旦手写成 `'multipart/form-data'`，boundary 就丢了，
服务端 `c.FormFile("file")` 会直接解析失败（表现为 1009「文件字段缺失」）。
Axios 检测到 `FormData` 时会自动补齐正确的头，交给它即可。

### 2. 图片「只增不删」——本阶段的已知取舍

P5 **没有**做「删除已上传图片」的接口，因此存在两种文件残留：

| 场景 | 结果 |
| --- | --- |
| 用户上传了图片，但最终没点「立即发布」就退出 | 文件留在 `server/uploads/`，无任何帖子引用它 |
| 帖子被删除 / 图片被从表单里移除 | 同上，文件不回收 |

**为什么不顺手做掉：** 图片与帖子是「先会后合」的关系（先上传拿到 URL，再随帖子
提交），要正确回收就需要引用计数或延迟清扫任务，属于独立议题；本阶段以
「不写坏数据」优先，宁可留下孤儿文件。生产化时的做法是加一个定期任务，
把 `uploads/` 中超过 N 小时仍未被任何 `posts.images` 引用的文件清掉。

### 3. 开发期 CORS 策略

`server/internal/middleware/cors.go` 在 `APP_ENV != production` 时，
通过 `AllowOriginFunc` 放行 **回环地址 + 私有网段（10/8、172.16/12、192.168/16、fc00::/7）**
的任意端口；生产环境直接直通、不添加任何 CORS 头。

判定改成「按来源」而不是「固定白名单」的原因见 `docs/code-guide.md` 的 P5 章节：
浏览器对**同源的非 GET 请求**同样会带 `Origin` 头，而前端是经 Vite proxy 转发
`/api` 的 —— 于是「手机连同一个 Wi-Fi 访问 `http://<电脑IP>:5173`」和
`npm run preview`（4173）这两条链路，写请求都会被白名单拦成 403。

---

## 待补章节（后续阶段）

- 认领模块（审核 / 凭证码 / 核销联动）—— P6
- AI 智能匹配（2-gram 相似度打分，`GET /api/posts/:id/matches`）—— P6
- 联系方式可见性规则第 4 条「双方存在已通过的认领关系」—— P6（需查 claims 表）
