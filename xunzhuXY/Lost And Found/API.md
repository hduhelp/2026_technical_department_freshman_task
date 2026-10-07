# 校园失物招领系统 · API 文档

## 一、总则

- **服务地址**：`http://127.0.0.1:8080`
- **数据格式**：请求体与响应体均为 JSON（`Content-Type: application/json`）
- **认证方式**：除标注「公开」的接口外，都需要在请求头携带登录时拿到的 token：

  ```
  Authorization: Bearer <token>
  ```

  token 由 `/login` 签发（JWT，HS256），有效期 **24 小时**。
  **注意**：服务端不保存 token，只用密钥验签（无状态）。用户信息以数据库为准 ——
  中间件会按 token 里的 `user_id` 去数据库核对用户是否存在，查不到则返回 401。

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
| image | string | 图片**文件名**（不含路径与域名）；无图时为空字符串 |
| status | string | `searching`（寻找中）/ `found`（已找到）/ `closed`（已结束） |
| created_at | string | 发布时间（服务端写入） |

> **列表接口不返回 `contact_info`**，需要看联系方式请调详情接口。
> 图片以**文件名**存储（如 `1791029177733663800.jpg`）。前端拼接为 `/uploads/<文件名>` 访问；
> 文件名由**服务端随机生成**，客户端无法指定。
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
| 11 | POST | `/upload` | **是** | 上传图片，返回文件名 |
| 12 | POST | `/items/:id/match` | **是** | AI 智能匹配（找可能相关的帖子） |

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
      "created_at": "2026-09-26 14:31",
      "image": "1791029177733663800.jpg"
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
| image | string | 否 | 图片文件名（先调 `/upload` 拿到；不传则无图） |

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

> 请求体里可以带 `image`（先调 `/upload` 拿文件名）。不传就是空图。
> 发布成功后前端会自动调用一次 `/items/:id/match` 做智能匹配（属于附加功能，失败不影响发布结果）。

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
> **有图片的帖子，删除时会一并删除 `uploads/` 下的图片文件**（删文件失败只记日志，不影响删除结果）。

---

## 11. 上传图片

**POST** `/upload` ｜ **需要 token**

请求：`multipart/form-data`，字段名固定为 **`file`**

```bash
curl -X POST http://127.0.0.1:8080/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.jpg"
```

> ⚠️ 前端用 `FormData` + `fetch` 时，**不要手动设置 `Content-Type`** ——
> 必须由浏览器自动加上 `boundary` 分隔符，否则服务端解析不出文件。

成功 `200`：

```json
{ "ok": true, "data": { "filename": "1791029177733663800.jpg" } }
```

错误：

| 状态码 | 说明 |
|---|---|
| 400 | 没有文件 / 超过 5MB / 后缀不在白名单 |
| 401 | 未认证 |

**服务端做的四件事（安全考虑）：**

| # | 措施 | 说明 |
|---|---|---|
| 1 | **文件名由服务端生成** | 用纳秒时间戳 + 原后缀，**完全不采用客户端文件名** → 杜绝路径穿越（如 `../../main.go`） |
| 2 | **大小限制 5MB** | 防止超大文件占满磁盘 |
| 3 | **后缀白名单** | 只允许 `.jpg .jpeg .png .gif .webp` |
| 4 | **静态目录独立** | 图片存 `./uploads/`，通过 `r.Static("/uploads", ...)` 只读暴露，与 `static/` 分离 |

> 拿到 `filename` 后，发帖/改帖时把它填进 `image` 字段即可。
> 客户端**无法指定文件名**，所以不存在覆盖服务端文件的风险。

---

## 12. AI 智能匹配（进阶功能）

**POST** `/items/:id/match` ｜ **需要 token**（**只能对自己的帖子调用**）

用途：发布一条帖子后，让模型判断**反向类型**的帖子中是否有**同一件物品**。
（发"丢失"帖 → 在"招领"里找；发"招领"帖 → 在"丢失"里找）

```bash
curl -X POST http://127.0.0.1:8080/items/3/match \
  -H "Authorization: Bearer <token>"
```

成功 `200`：

```json
{
  "ok": true,
  "result": [
    {
      "item_id": 21,
      "verdict": "same",
      "reason": "依据：两帖均提到黑色折叠伞与伞柄蓝色贴纸，地点均为七教北"
    }
  ]
}
```

`verdict` 含义：

| 值 | 含义 |
|---|---|
| `same` | 很可能是同一件物品 |
| `maybe` | 可能相关（信息不足，无法确定） |

> **`no` 的候选不会返回** —— 服务端只回传 `same` / `maybe`，且 `same` 排在前面。

**重要：这是"附加功能"，失败不影响主流程**

以下情况一律返回 `{"ok": true, "result": []}`（**不会返回 5xx**）：

- 模型 API 调用失败 / 超时
- 模型返回的内容解析失败
- 没有可比较的候选帖

> 设计理由：发布帖子这个**主流程**已经成功了，不该因为附加功能故障而让用户以为发布失败。
> 失败原因会写进服务端日志。

**候选集与成本控制：**

- 反向类型的帖子，按 `created_at DESC` 取**最近 20 条**（`LIMIT 20`），
  且**只取最近 14 天内**的帖子（失物招领时效性强，半年前的旧帖不会误入候选）；
- **一次请求打包所有候选**交给模型（而不是一条帖调一次）→ 20 次比较只花一次调用；
- 结果按 `same` → `maybe` 排序后返回。

> 数据量增大后可升级为**两阶段检索**：先用地点/时间/类别做**宽松召回**（宁可多捞），
> 再用模型**严格判定**（recall → rerank 的标准思路）。

**依赖配置**：需要环境变量 `LLM_API_KEY`，未配置时接口返回空结果并记录日志。

---

## 四、安全设计说明

| 措施 | 说明 |
|---|---|
| 密码哈希 | bcrypt（自带随机盐 + 可调 cost），不用 MD5/SHA |
| SQL 注入防护 | **全部 SQL 使用参数化查询**（`?` 占位符），值永不拼进语句 |
| 排序参数白名单 | `ORDER BY` 的方向**无法参数化** → 用白名单（只接受 `asc`/`desc`，其余走默认） |
| JWT 验签 | 中间件校验签名与过期时间，并显式检查签名算法为 HMAC（防 alg 混淆攻击） |
| 越权防护 | 修改 / 删除 / 改状态 / **AI 匹配** 都校验 `item.UserID == token 里的 user_id` |
| 信息最小化 | 列表不返回联系方式；用户相关响应不含密码哈希 |
| 错误信息 | 登录失败统一返回"用户名或密码错误"，避免攻击者枚举用户名 |
| 上传安全 | 文件名由服务端生成（**防路径穿越**）+ 5MB 限制 + 后缀白名单 + 上传目录与静态目录隔离 |
| 不信任客户端 | `item_id` / `publisher` / `user_id` / `status` / `created_at` / **图片文件名** 一律由服务端决定 |
| 降级设计 | AI 匹配失败返回空结果而非 5xx —— 附加功能故障不影响发布主流程 |
| 绑定地址 | 服务只监听 `127.0.0.1`，不对外网暴露 |

### 已知限制

- **退出登录在前端完成**（清除 localStorage）。JWT 是无状态的，服务端不维护会话 ——
  **代价**：token 在 24 小时有效期内无法被服务端主动吊销。
- 用户信息以数据库为准，因此"用户被删除后旧 token 自动失效"这一点无需额外逻辑支持。
- SQLite 单文件存储，适合单机演示；高并发写入场景需要换成服务型数据库。
- AI 匹配依赖外部模型 API：有网络与额度依赖，候选集只取最近 20 条反向帖（数据量大时需两阶段召回）。
- 图片存本地 `./uploads/`，未做压缩 / CDN / 多图；每条帖只支持一张图（多图需要拆出 `item_images` 表）。
- 未实现"用户注销账号"与"找回密码"。

### 后续可以做的事

- 匹配召回升级为两阶段（地点/时间/类别宽松召回 → 模型精判）
- 图片多图支持 + 压缩 + 上传进度条
- 匹配结果"推送给被匹配到的另一方"（现在是只提示发帖人）
- 引入迁移文件（`migrations/001_init.sql`）管理表结构变更

