# 校园失物招领系统 · API 文档

## 一、总则

- **服务地址**：`http://127.0.0.1:8080`
- **数据格式**：请求体与响应体均为 JSON（`Content-Type: application/json`）
- **认证方式**：除标注「公开」的接口外，都需要在请求头携带登录时拿到的 token：

  ```
  Authorization: Bearer <token>
  ```

  token 由 `/login` 签发（JWT，HS256），有效期 **24 小时**。
  **注意**：服务端不保存 token，只用密钥验签 —— 因此重启服务后，内存中的用户数据会清空，旧 token 即使签名有效也会因"用户不存在"而返回 401。

- **统一响应格式**

  | 情况 | 格式 |
  |---|---|
  | 成功（一般） | `{"ok": true, "data": ...}` |
  | 成功（登录） | `{"ok": true, "token": "..."}` |
  | 失败 | `{"ok": false, "msg": "错误原因"}` |

- **状态码约定**

  | 状态码 | 含义 |
  |---|---|
  | 200 | 查询 / 修改 / 删除成功 |
  | 201 | 创建成功 |
  | 400 | 请求本身有问题（缺字段、类型不对、id 不是数字…） |
  | 401 | 未认证（没带 token / token 无效或过期 / 用户不存在） |
  | 403 | 已认证但无权限（不是这条帖子的发布者） |
  | 404 | 资源不存在 |
  | 409 | 冲突（用户名已被注册） |
  | 500 | 服务器内部错误 |

---

## 二、数据模型

### User（仅用于存储，不直接对外返回）

| 字段 | 类型 | 说明 |
|---|---|---|
| user_id | int | 用户编号 |
| username | string | 用户名，全局唯一 |
| password | string | **bcrypt 哈希**（不是明文） |
| created_at | string | 注册时间 |

> 对外只返回 `{user_id, username}`，**任何接口都不会返回 password**。

### Item（失物 / 招领，同一张表用 type 区分）

| 字段 | 类型 | 说明 |
|---|---|---|
| item_id | int | 帖子编号 |
| publisher | string | 发布者用户名（服务端根据 token 写入） |
| user_id | int | 发布者编号（服务端写入） |
| type | string | `丢失` / `招领` |
| title | string | 物品名 |
| place | string | 地点 |
| happened_at | string | 发生时间（不填则服务端补当前时间） |
| description | string | 描述 |
| contact_info | string | 联系方式 |
| status | string | `searching`（寻找中）/ `found`（已找到）/ `closed`（已结束） |
| created_at | string | 发布时间（服务端写入） |

> **列表接口不返回 `contact_info`**，需要看联系方式请调详情接口。
> 所有时间格式：`2006-01-02 15:04:05`

---

## 三、接口列表

| # | 方法 | 路径 | 需要 token | 说明 |
|---|---|---|---|---|
| 1 | GET | `/hello` | 否 | 连通性测试 |
| 2 | POST | `/register` | 否 | 注册 |
| 3 | POST | `/login` | 否 | 登录，返回 token |
| 4 | GET | `/me` | **是** | 获取当前用户信息 |
| 5 | GET | `/items` | 否 | 帖子列表（搜索 / 排序 / 分页） |
| 6 | GET | `/items/:id` | 否 | 帖子详情（含联系方式） |
| 7 | POST | `/items` | **是** | 发布帖子 |
| 8 | PUT | `/items/:id` | **是** | 修改自己的帖子 |
| 9 | PUT | `/items/:id/status` | **是** | 修改状态 |
| 10 | DELETE | `/items/:id` | **是** | 删除自己的帖子 |

---

## 1. 连通性测试

**GET** `/hello` ｜ 公开

响应 `200`：

```json
{ "msg": "hello" }
```

---

## 2. 注册

**POST** `/register` ｜ 公开

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 是 | 不能为空、不可重复 |
| password | string | 是 | 至少 6 位 |

```bash
curl -X POST http://127.0.0.1:8080/register \
  -H "Content-Type: application/json" \
  -d '{"username":"abc","password":"123456"}'
```

> Windows PowerShell 用户请改用 `Invoke-RestMethod`：
> `-X` → `-Method`、`-H` → `-ContentType`、`-d` → `-Body`

成功 `201`：

```json
{ "ok": true, "data": { "user_id": 2, "username": "abc" } }
```

错误：

| 状态码 | 说明 |
|---|---|
| 400 | 请求体格式错误 / 用户名为空 / 密码不足 6 位 |
| 409 | 用户名已被注册 |
| 500 | 哈希失败（内部错误） |

> 密码用 **bcrypt** 存储（自带随机盐），数据库里永远不是明文。

---

## 3. 登录

**POST** `/login` ｜ 公开

请求体：

| 字段 | 类型 | 必填 |
|---|---|---|
| username | string | 是 |
| password | string | 是 |

成功 `200`：

```json
{ "ok": true, "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

token 的 payload 为：

```json
{ "user_id": 1, "username": "abc", "exp": 1791003551 }
```

错误：

| 状态码 | 说明 |
|---|---|
| 400 | 请求体格式错误 / 用户名或密码为空 |
| 401 | **用户名或密码错误**（两种情况返回同一句话，防止攻击者枚举用户名） |

---

## 4. 获取当前用户信息

**GET** `/me` ｜ **需要 token**

成功 `200`：

```json
{ "ok": true, "data": { "user_id": 1, "username": "abc" } }
```

错误：

| 状态码 | 说明 |
|---|---|
| 401 | 未带 token / token 无效或过期 / 用户已不存在 |

> 前端常用它来检查登录态：能返回用户信息 = token 还有效。

---

## 5. 帖子列表（搜索 / 排序 / 分页）

**GET** `/items` ｜ 公开

查询参数（全部可选）：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| type | string | 空 | 按类型过滤：`丢失` / `招领`；不传则不限 |
| keyword | string | 空 | 关键词，匹配 `title` **或** `description`（不区分大小写）；不传则不限 |
| order | string | `desc` | `desc` 最新在前 / `asc` 最早在前 |
| page | int | `1` | 第几页（小于 1 时按 1 处理） |
| size | int | `10` | 每页条数（非法或大于 100 时按 10 处理） |

```bash
curl "http://127.0.0.1:8080/items?type=丢失&keyword=校园卡&order=desc&page=1&size=5"
```

成功 `200`：

```json
{
  "ok": true,
  "data": [
    {
      "item_id": 1,
      "type": "丢失",
      "title": "校园卡",
      "place": "图书馆",
      "status": "searching",
      "created_at": "2026-09-26 14:31"
    }
  ],
  "total": 3,
  "page": 1,
  "size": 5
}
```

> **`data` 里没有 `contact_info`** —— 联系方式只在详情接口返回，避免在列表里批量暴露。
> 前端拿到 `total / page / size` 就可以画分页条。

---

## 6. 帖子详情

**GET** `/items/:id` ｜ 公开

| 参数 | 位置 | 类型 | 说明 |
|---|---|---|---|
| id | 路径 | int | 帖子编号 |

成功 `200`（返回**完整** Item，含联系方式）：

```json
{
  "ok": true,
  "data": {
    "item_id": 1,
    "publisher": "小明",
    "user_id": 1,
    "type": "丢失",
    "title": "校园卡",
    "place": "图书馆",
    "happened_at": "2026-09-26 14:30",
    "description": "黑色卡套的校园卡",
    "contact_info": "350257",
    "status": "searching",
    "created_at": "2026-09-26 14:31"
  }
}
```

错误：

| 状态码 | 说明 |
|---|---|
| 400 | id 不是数字 |
| 404 | 没有这条帖子 |

---

## 7. 发布帖子

**POST** `/items` ｜ **需要 token**

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| type | string | 是 | `丢失` / `招领` |
| title | string | 是 | 物品名 |
| place | string | 是 | 地点 |
| happened_at | string | 否 | 发生时间，不填则用当前时间 |
| description | string | 是 | 描述 |
| contact_info | string | 是 | 联系方式 |

> **服务端决定的字段**：`item_id`、`publisher`、`user_id`、`status`、`created_at`
> —— 客户端不能指定，必须由服务端填写（否则可以冒充他人、或自己伪造状态）。

```bash
curl -X POST http://127.0.0.1:8080/items \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"丢失","title":"校园卡","place":"图书馆","description":"黑色卡套","contact_info":"350257"}'
```

成功 `201`：`{"ok": true, "data": { ...完整 Item... }}`

错误：

| 状态码 | 说明 |
|---|---|
| 400 | 请求体格式错误 / 校验不通过（类型非法、标题/地点/描述/联系方式为空） |
| 401 | 未认证 / 登录已失效 |

---

## 8. 修改帖子

**PUT** `/items/:id` ｜ **需要 token**（**只有发布者本人可以改**）

请求体：与「发布帖子」相同的 6 个字段（**全量提交**）

```bash
curl -X PUT http://127.0.0.1:8080/items/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"丢失","title":"校园卡（已挂失）","place":"图书馆","description":"已补办","contact_info":"350257"}'
```

成功 `200`：`{"ok": true, "msg": "修改成功", "data": { ...完整 Item... }}`

错误：

| 状态码 | 说明 |
|---|---|
| 400 | id 不是数字 / 请求体格式错误 / 校验不通过 |
| 401 | 未认证 |
| 403 | 不是这条帖子的发布者 |
| 404 | 帖子不存在 |

> 使用 `PUT` 而非 `PATCH`：语义是**全量替换**，客户端提交全部可改字段。
> `item_id / user_id / publisher / status / created_at` 不会被修改。

---

## 9. 修改状态

**PUT** `/items/:id/status` ｜ **需要 token**（只有发布者）

请求体：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| status | string | 是 | 只能是 `searching` / `found` / `closed` |

```bash
curl -X PUT http://127.0.0.1:8080/items/1/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"status":"found"}'
```

成功 `200`：`{"ok": true, "msg": "状态已更新", "data": { ...完整 Item... }}`

错误：

| 状态码 | 说明 |
|---|---|
| 400 | id 不是数字 / 请求体格式错误 / status 不在允许的三个值里 |
| 401 | 未认证 |
| 403 | 不是发布者 |
| 404 | 帖子不存在 |

> 状态不限制流转顺序（可以从 `found` 改回 `searching`），避免用户误操作后无法恢复。

---

## 10. 删除帖子

**DELETE** `/items/:id` ｜ **需要 token**（只有发布者）

```bash
curl -X DELETE http://127.0.0.1:8080/items/1 \
  -H "Authorization: Bearer <token>"
```

成功 `200`：`{"ok": true, "msg": "删除成功"}`

错误：

| 状态码 | 说明 |
|---|---|
| 400 | id 不是数字 |
| 401 | 未认证 |
| 403 | 不是发布者 |
| 404 | 帖子不存在 |

> 删除后 `item_id` 不会复用（编号只增不减），因此列表里可能出现"空洞"，属正常现象。

---

## 四、安全设计说明

| 措施 | 说明 |
|---|---|
| 密码哈希 | bcrypt（自带随机盐 + 可调 cost），不用 MD5/SHA |
| 参数化查询准备 | 数据层换 SQLite 时使用参数化，避免 SQL 注入 |
| JWT 验签 | 中间件校验签名与过期时间，并检查签名算法为 HMAC |
| 越权防护 | 修改 / 删除 / 改状态都校验 `item.UserID == token 里的 user_id` |
| 信息最小化 | 列表不返回联系方式；用户相关响应不含密码哈希 |
| 错误信息 | 登录失败统一返回"用户名或密码错误"，避免枚举用户名 |
| 绑定地址 | 服务只监听 `127.0.0.1`，不对外网暴露 |

### 已知限制（当前为内存存储）

- 服务重启后所有数据（用户、帖子）会丢失；
- 数据仅存在内存切片中，无法并发安全地写入；
- 检索为线性遍历，数据量大时效率低。
- 后续计划：把存储层替换为 SQLite（`modernc.org/sqlite`，纯 Go 无需 cgo）。
