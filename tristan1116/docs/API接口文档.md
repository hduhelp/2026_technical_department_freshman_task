# 校园失物招领系统 · API 接口文档

> 校园失物招领系统 · 后端接口说明
> 版本 v1.0 ｜ 更新 2026-10-06
>
> **配套文件**：`openapi.json`（可导入 Apifox / Postman）｜ [`Apifox测试指南.md`](./Apifox测试指南.md)

---

## 一、通用说明

### 1.1 基础地址

| 环境 | 地址 |
|---|---|
| 本地开发 | `http://localhost:8080` |

所有接口以 `/api` 开头。

### 1.2 统一响应格式

**所有**接口都返回这个结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | **0 = 成功**，非 0 = 失败（见错误码表） |
| `message` | string | 提示信息，成功时是 `"ok"` 或具体文案，失败时是错误原因 |
| `data` | any | 数据。失败时为 `null` |

**HTTP 状态码同时正确设置**（不是永远返回 200），前端可任选一种判断方式。

### 1.3 错误码表

| code | HTTP | 含义 |
|---|---|---|
| `0` | 200 | 成功 |
| `1001` | 400 | 参数错误（缺必填字段、长度不对、取值不在范围内、id 不合法） |
| `1002` | 401 | 未登录 / token 无效或已过期 |
| `1003` | 403 | 没有权限（试图操作别人发布的信息） |
| `1004` | 404 | 资源不存在 |
| `1005` | 400 | 用户名已被注册 |
| `1006` | 400 | 用户名或密码错误 |
| `1007` | 400 | 状态只能前进，不能回退 |
| `1008` | 500 | 服务器内部错误 |

失败示例：

```json
{ "code": 1003, "message": "只能操作自己发布的信息", "data": null }
```

### 1.4 认证方式

登录成功后拿到 `token`，之后在**请求头**里带上：

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- 有效期 **7 天**
- 格式必须是 `Bearer ` + 空格 + token，否则返回 401
- 未携带 token 访问需要登录的接口 → 401

### 1.5 枚举值对照表

前端展示时用中文，**传输和存储一律用英文码**。

| 字段 | 英文码 | 中文 |
|---|---|---|
| `type` | `lost` | 失物（我丢了东西） |
| | `found` | 招领（我捡到东西） |
| `status` | `searching` | 寻找中（招领帖显示为"待认领"） |
| | `resolved` | 已找到（招领帖显示为"已认领"） |
| | `closed` | 已结束 |
| `category` | `card` | 证件卡类 |
| | `electronics` | 电子设备 |
| | `books` | 书籍资料 |
| | `clothing` | 衣物配饰 |
| | `daily` | 生活用品 |
| | `other` | 其他 |

### 1.6 时间格式

**请求**（`happened_at`）支持以下几种写法，后端都能解析：

```
2026-10-05 14:30          2026-10-05 14:30:00
2026-10-05T14:30          2026-10-05T14:30:00
2026-10-05                2026-10-05T14:30:00+08:00
```

**响应**里的时间统一是 ISO 8601 格式：`2026-10-05T14:30:00+08:00`

---

## 二、认证模块（4 个）

### 2.1 用户注册

```
POST /api/auth/register
```

**无需登录**

**请求体**

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `username` | string | ✅ | 3~20 位 | 用户名，**唯一**，登录用 |
| `password` | string | ✅ | 6~32 位 | 密码（后端 bcrypt 加密存储） |
| `nickname` | string | ❌ | ≤32 位 | 昵称，不填则展示用户名 |
| `student_id` | string | ❌ | ≤32 位 | 学号 |

**请求示例**

```json
{
  "username": "tongshixuan",
  "password": "123456",
  "nickname": "童诗轩",
  "student_id": "23051101"
}
```

**成功响应**

```json
{
  "code": 0,
  "message": "注册成功",
  "data": {
    "id": 1,
    "username": "tongshixuan",
    "nickname": "童诗轩",
    "student_id": "23051101",
    "created_at": "2026-10-06T11:33:50.788+08:00"
  }
}
```

> **注意**：返回里**没有 password 字段** —— 后端用 `json:"-"` 保证密码哈希永不外泄。

**失败**：`1001` 参数不合法 ｜ `1005` 用户名已被注册

---

### 2.2 用户登录

```
POST /api/auth/login
```

**无需登录**

**请求体**

| 字段 | 类型 | 必填 |
|---|---|---|
| `username` | string | ✅ |
| `password` | string | ✅ |

**请求示例**

```json
{ "username": "tongshixuan", "password": "123456" }
```

**成功响应**

```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxfQ.xxx",
    "user": {
      "id": 1,
      "username": "tongshixuan",
      "nickname": "童诗轩",
      "student_id": "23051101",
      "created_at": "2026-10-06T11:33:50.788+08:00"
    }
  }
}
```

> 前端拿到 `token` 后应存起来（本项目存在 `localStorage`），之后所有需要登录的请求都带上它。

**失败**：`1006` 用户名或密码错误

---

### 2.3 获取当前用户

```
GET /api/auth/me
```

**需要登录** ｜ 无参数

前端用这个接口判断"我是谁"（显示昵称、进入"我的发布"）。

**成功响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "username": "tongshixuan",
    "nickname": "童诗轩",
    "student_id": "23051101",
    "created_at": "2026-10-06T11:33:50.788+08:00"
  }
}
```

**失败**：`1002` 未登录或 token 无效

---

### 2.4 退出登录

```
POST /api/auth/logout
```

**需要登录** ｜ 无参数

**成功响应**

```json
{
  "code": 0,
  "message": "已退出登录（前端请删除本地保存的 token）",
  "data": null
}
```

> ⚠️ **重要说明**：JWT 是**无状态**的 —— token 一旦签发，服务端无法单方面作废它。
> 所以"退出登录"真正发生在前端：**调用本接口后，前端必须自己删掉本地保存的 token**。
>
> 本接口保留的意义：① 满足任务要求；② 给前端一个统一的收尾调用点；
> ③ 将来若改成 Redis 黑名单方案，前端代码不用动。

---

## 三、物品模块（8 个）

### 3.1 信息列表（搜索 / 筛选 / 分页）

```
GET /api/items
```

**无需登录**

**查询参数**（都是可选的）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `keyword` | string | — | 关键词，对**物品名称和描述**做模糊匹配（LIKE） |
| `type` | string | — | 类型筛选：`lost` / `found` |
| `category` | string | — | 分类筛选：`card` / `electronics` / ... |
| `campus` | string | — | 校区（精确匹配） |
| `place` | string | — | 地点（模糊匹配） |
| `status` | string | `searching` | 状态筛选。**不传默认只看"寻找中"**；传 `all` 表示不限 |
| `page` | int | `1` | 页码，从 1 开始 |
| `page_size` | int | `10` | 每页条数，范围 1~50（超出按 10 处理） |

**排序**：固定按发布时间倒序（`created_at DESC`）

**请求示例**

```http
GET /api/items?keyword=校园卡&category=card&page=1&page_size=10
```

**成功响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 4,
        "type": "lost",
        "title": "校园卡",
        "category": "card",
        "campus": "下沙校区",
        "place": "图书馆二楼",
        "happened_at": "2026-10-05T14:30:00+08:00",
        "description": "黑色卡套，里面有校园卡和饭卡",
        "image_url": "",
        "status": "searching",
        "user_id": 3,
        "created_at": "2026-10-06T11:33:51.132+08:00",
        "updated_at": "2026-10-06T11:33:51.132+08:00"
      }
    ],
    "total": 3,
    "page": 1,
    "page_size": 10
  }
}
```

> **两个关键点**：
> 1. 返回的每条信息里**没有 `contact` 字段** —— 联系方式不在列表里暴露（见 3.4）
> 2. **`total` 是符合条件的总条数**，前端靠它判断"还有没有下一页"（`page * page_size < total`）
> 3. 查不到数据时 `list` 是 `[]` 而不是 `null`，前端可以直接 `.map()`

---

### 3.2 信息详情

```
GET /api/items/{id}
```

**无需登录**

**路径参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | int | 信息 ID |

**成功响应**（比列表多了发布者信息，但**依然没有 contact**）

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 4,
    "type": "lost",
    "title": "校园卡",
    "category": "card",
    "campus": "下沙校区",
    "place": "图书馆二楼",
    "happened_at": "2026-10-05T14:30:00+08:00",
    "description": "黑色卡套，里面有校园卡和饭卡",
    "image_url": "",
    "status": "searching",
    "user_id": 3,
    "created_at": "2026-10-06T11:33:51.132+08:00",
    "updated_at": "2026-10-06T11:33:51.132+08:00",
    "publisher_nickname": "演示用户",
    "publisher_student_id": "23051101"
  }
}
```

| 新增字段 | 说明 |
|---|---|
| `publisher_nickname` | 发布者昵称（详情页展示用） |
| `publisher_student_id` | 发布者学号（没填就是空字符串） |

**失败**：`1001` id 不合法（比如 `/api/items/abc`）｜ `1004` 信息不存在

---

### 3.3 发布信息

```
POST /api/items
```

**需要登录**

**请求体**

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `type` | string | ✅ | `lost` / `found` | 失物还是招领 |
| `title` | string | ✅ | ≤64 位 | 物品名称 |
| `category` | string | ✅ | 见枚举表 | 分类 |
| `campus` | string | ❌ | ≤32 位 | 校区 |
| `place` | string | ❌ | ≤64 位 | 具体地点 |
| `happened_at` | string | ✅ | 见时间格式 | 丢失 / 捡到的时间 |
| `description` | string | ❌ | ≤500 位 | 详细描述 |
| `contact` | string | ✅ | ≤100 位 | 联系方式（微信/QQ/手机号） |

**请求示例**

```json
{
  "type": "lost",
  "title": "校园卡",
  "category": "card",
  "campus": "下沙校区",
  "place": "图书馆二楼",
  "happened_at": "2026-10-05 14:30",
  "description": "黑色卡套，里面有校园卡和饭卡，捡到请联系我",
  "contact": "微信 xiaoming123"
}
```

**成功响应**：`data` 是新建的帖子（`message` 为 `"发布成功"`）

> **两个后端强制规则**（前端传了也没用）：
> - `status` 一律是 `searching`（新帖必须从"寻找中"开始）
> - `user_id` 取当前登录用户（**不接受前端传值**，防止冒充他人发布）
>
> **返回里没有 contact** —— 发布成功后前端也不需要回显联系方式。

**失败**：`1001` 参数错误 ｜ `1002` 未登录

---

### 3.4 查看联系方式

```
GET /api/items/{id}/contact
```

**需要登录** ★ 本项目的核心设计点

**成功响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": { "contact": "微信 xiaoming123" }
}
```

**为什么单独做一个接口？**

联系方式**不在**列表和详情里返回（`Item` 结构体的 `contact` 字段标了 `json:"-"`，
序列化时永远跳过）。想拿到只能走这个接口，而它挂了登录中间件。

| 访问方式 | 结果 |
|---|---|
| 未登录 | `401 {"code":1002,"message":"请先登录"}` |
| 登录后 | `200` + 联系方式 |

> 这是**结构上**的保证，不是"查出来再过滤掉"——
> 任何返回帖子的接口都**不可能**泄露联系方式。

**失败**：`1002` 未登录 ｜ `1004` 信息不存在

---

### 3.5 我的发布

```
GET /api/items/my
```

**需要登录**

**查询参数**

| 参数 | 类型 | 默认 |
|---|---|---|
| `page` | int | 1 |
| `page_size` | int | 10 |

**成功响应**：结构与 3.1 列表一致，但——

- 只返回**当前登录用户**发布的信息
- **包含全部状态**（寻找中 / 已找到 / 已结束），方便管理

**失败**：`1002` 未登录

---

### 3.6 编辑信息

```
PUT /api/items/{id}
```

**需要登录** 且 **必须是发布者本人**

**路径参数**：`id`

**请求体**（全部选填，**传了才改**；空字符串视为不修改）

| 字段 | 类型 | 约束 |
|---|---|---|
| `title` | string | ≤64 位 |
| `category` | string | 见枚举表 |
| `campus` | string | ≤32 位 |
| `place` | string | ≤64 位 |
| `happened_at` | string | 见时间格式 |
| `description` | string | ≤500 位 |
| `contact` | string | ≤100 位 |

**请求示例**

```json
{ "description": "黑色卡套，已补图", "place": "图书馆三楼" }
```

**成功响应**：`data` 是更新后的帖子，`message` 为 `"修改成功"`

> ⚠️ **本接口不能修改 `status`** —— 请求体里根本没有这个字段。
> 状态变更必须走 3.7 的专门接口，否则状态机的"只能前进"就形同虚设。
>
> 同理**也不能改 `type`** —— 一条失物帖不该变成招领帖。

**失败**：`1001` 参数错误 ｜ `1002` 未登录 ｜ `1003` 不是本人 ｜ `1004` 不存在

---

### 3.7 修改状态

```
PATCH /api/items/{id}/status
```

**需要登录** 且 **必须是发布者本人**

**请求体**

| 字段 | 类型 | 必填 | 取值 |
|---|---|---|---|
| `status` | string | ✅ | `searching` / `resolved` / `closed` |

**请求示例**

```json
{ "status": "resolved" }
```

**成功响应**

```json
{ "code": 0, "message": "状态已更新", "data": null }
```

**状态机规则**：`寻找中 → 已找到 → 已结束`，**只能前进，不能回退**

| 当前状态 | 改成 | 结果 |
|---|---|---|
| `searching` | `resolved` | ✅ 成功 |
| `searching` | `closed` | ✅ 成功（跳过一级也算前进） |
| `resolved` | `closed` | ✅ 成功 |
| `resolved` | `searching` | ❌ `1007 状态只能前进，不能回退` |
| `closed` | 任何 | ❌ `1007` |

**失败**：`1001` 非法状态值 ｜ `1002` 未登录 ｜ `1003` 不是本人 ｜ `1004` 不存在 ｜ `1007` 状态回退

---

### 3.8 删除信息

```
DELETE /api/items/{id}
```

**需要登录** 且 **必须是发布者本人**

**成功响应**

```json
{ "code": 0, "message": "删除成功", "data": null }
```

> 前端应在删除前做**二次确认**（PRD 4.2 要求）。
> 删除是**物理删除**，删了就没了。

**失败**：`1002` 未登录 ｜ `1003` 不是本人 ｜ `1004` 不存在

---

## 四、接口总览

| # | 方法 | 路径 | 登录 | 本人 | 说明 |
|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | — | — | 注册 |
| 2 | POST | `/api/auth/login` | — | — | 登录 |
| 3 | GET | `/api/auth/me` | ✅ | — | 获取当前用户 |
| 4 | POST | `/api/auth/logout` | ✅ | — | 退出登录 |
| 5 | GET | `/api/items` | — | — | 列表（搜索/筛选/分页） |
| 6 | GET | `/api/items/{id}` | — | — | 详情 |
| 7 | GET | `/api/items/{id}/contact` | ✅ | — | 查看联系方式 |
| 8 | GET | `/api/items/my` | ✅ | — | 我的发布 |
| 9 | POST | `/api/items` | ✅ | — | 发布 |
| 10 | PUT | `/api/items/{id}` | ✅ | ✅ | 编辑 |
| 11 | PATCH | `/api/items/{id}/status` | ✅ | ✅ | 改状态 |
| 12 | DELETE | `/api/items/{id}` | ✅ | ✅ | 删除 |

---

## 五、完整调用流程示例

一个完整的用户使用流程（可直接照着在 Apifox 里跑）：

```
① POST /api/auth/register        注册 → 拿到 user.id
② POST /api/auth/login           登录 → 拿到 token（存进环境变量）
③ POST /api/items                发布一条失物（Header 带 token）
④ GET  /api/items?keyword=校园卡  搜索，确认能搜到
⑤ GET  /api/items/{id}           看详情（注意没有 contact）
⑥ GET  /api/items/{id}/contact   不带 token → 401；带 token → 看到联系方式
⑦ PATCH /api/items/{id}/status   改成 resolved
⑧ PATCH /api/items/{id}/status   再改回 searching → 400（状态不能回退）
⑨ GET  /api/items/my             我的发布，能看到刚才那条（状态已变）
⑩ DELETE /api/items/{id}         删除
```

> 自动化版本见 `scripts/smoke_test.sh`（47 项断言，含越权、状态回退等反例）。
