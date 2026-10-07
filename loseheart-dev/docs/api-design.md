# 杭州电子科技大学校园失物招领平台接口文档

版本：v1.0  
日期：2026-10-04  
飞书版本：[在线接口文档](https://qcndrjmpg05r.feishu.cn/wiki/OQxmwWTdJiAT7LklqmQc5sgxnLc)  
适用范围：用户网页、微信小程序、管理网页共用 Go 后端。

本文定义的 37 个后端接口已实现，2026-10-06 通过本地 MySQL、Redis 集成测试与竞态检测；私有 OSS 已验证真实上传、元数据检查和读取。微信真实 code 换取身份已单独验证，绑定/换绑的自动回归使用模拟微信响应。网页和小程序前端联调尚未开展。所有账号、联系方式与凭证示例均为演示值或占位符。

## 1. 公共约定

### 1.1 地址与数据格式

接口基础地址：`http://localhost:<后端端口>/api/v1`。以下路径已包含 `/api/v1`，端口在启动配置中确定。采用 RESTful 资源路径；GET 只查询，POST 创建，PUT 替换内容或设置子资源，PATCH 更新列出的状态，DELETE 仅退出，不删除业务数据。

JSON 使用 `snake_case`；ID 为十进制字符串，版本为整数。系统时间使用 RFC3339，例如 `2026-10-04T09:30:00+08:00`；事件日期 `YYYY-MM-DD`，时间 `HH:mm`，按北京时间解释。字符上限按 Unicode 字符计，必填文字不能纯空白；密码不去空白。未知 JSON 字段、非法枚举或超长内容返回 400，不截断、不忽略。

### 1.2 认证与权限

网页 JWT 存于 `lf_access_token` Cookie：HttpOnly、SameSite=Lax、Path=/api；非本机 HTTP 环境使用 Secure，不写入 localStorage。小程序使用 `Authorization: Bearer <JWT>`，图片下载同样携带该请求头；不把令牌放入 URL。Cookie 与 Bearer 同时出现则拒绝。

“已验证有效登录”均指 JWT 验证通过，且实时查询 MySQL 确认用户 active、is_verified=true、非强制改密状态、token_version 匹配；管理员再要求实时 role=admin。强制改密用户仅能改密、退出及获取必要 CSRF。普通用户越权管理接口返回 403；无权知晓某个资源返回 404。

JWT 固定 HS256、24 小时，校验 sub/iat/exp/iss/aud/token_version，另含每次签发随机 jti 用于 CSRF 绑定；不建会话表、不将 jti 存入 Redis、不提供刷新令牌。任一端退出、改密、重置、禁用或微信换绑成功使全部端旧 JWT 失效。写事务内再次校验操作者状态与版本。

Cookie 模式的 POST/PUT/PATCH/DELETE（含登录及上传）必须携带 `X-CSRF-Token`，与 `lf_csrf` Cookie 一致且 HMAC 签名、登录绑定正确。先调用 GET /auth/csrf；后端验证配置的 Origin，缺失时验证 Referer，均无法验证则拒绝。采用同源 Vue 代理；登录前随机浏览器上下文，登录后绑定 JWT jti，使用独立 CSRF 密钥，无会话存储。纯 Bearer 小程序不使用 Cookie/CSRF；客户端类型字段不能绕过检查。 小程序首次登录尚无 Bearer，仅允许无 Cookie、无 Origin 的 JSON 登录请求；Referer 缺失或精确匹配配置 AppID 的 `https://servicewechat.com/{appid}/{version}/page-frame.html`（version 为数字或 devtools）。开发者工具的 Fetch 元数据只允许完整的 same-site / cors / empty 组合，其余组合拒绝。

### 1.3 成功与失败响应

JSON 成功默认 200，首次创建资源 201；无数据时 data=null。图片成功直接返回二进制，不套 JSON。

```json
{"code":1,"msg":"成功","data":null,"request_id":"req_demo_001"}
```

```json
{"code":"VALIDATION_ERROR","msg":"描述最多 300 字符","data":null,"request_id":"req_demo_001","errors":[{"field":"description","message":"最多 300 字符"}]}
```

成功 code 固定整数 1；失败 code 为稳定字符串，前端不按中文 msg 判断。request_id 由服务端生成并与 X-Request-ID 响应头和日志关联，不是幂等键。errors 只在字段校验失败时返回。

| HTTP 状态 | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_REQUEST / VALIDATION_ERROR / PRECONDITION_REQUIRED | 参数、格式错误，或缺少必要 If-Match |
| 401 | AUTH_REQUIRED / TOKEN_EXPIRED / TOKEN_REVOKED / INVALID_CREDENTIALS | 未登录、凭证失效或账号密码错误 |
| 403 | ACCOUNT_DISABLED / IDENTITY_UNVERIFIED / PASSWORD_CHANGE_REQUIRED / FORBIDDEN / CSRF_INVALID | 账号或权限不满足、必须改密、CSRF 校验失败 |
| 404 | RESOURCE_NOT_FOUND | 不存在或无权获知资源 |
| 409 | IDEMPOTENCY_CONFLICT / STATE_CONFLICT / WECHAT_ALREADY_BOUND / WECHAT_NOT_BOUND | 同键内容冲突、状态变化或绑定冲突 |
| 412 | RESOURCE_CHANGED | If-Match 版本过期，刷新后重新确认 |
| 413 / 415 | FILE_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | 图片过大或文件/请求格式不支持 |
| 429 | LOGIN_RATE_LIMITED / POST_QUOTA_EXCEEDED | 登录限速或当日发帖额度已用完；带 Retry-After 秒数 |
| 502 / 503 | WECHAT_UPSTREAM_ERROR / OSS_UNAVAILABLE / AUTH_LIMITER_UNAVAILABLE / SERVICE_UNAVAILABLE | 微信、OSS、Redis 或服务暂不可用 |
| 500 | INTERNAL_ERROR | 内部错误，响应不含 SQL、堆栈或凭证 |

后文异常列只列出该接口额外关注的情况；所有接口均适用本节参数、认证、权限与依赖错误。

### 1.4 分页、幂等与并发

page 默认 1，page_size 默认 20、最大 50；返回 total/page/page_size/records，空数组表示无记录，超范围页仍返回 200 空数组。各接口固定排序，不接受任意排序字段。

新帖必填 Idempotency-Key UUID。同作者相同键及相同原始规范化内容重试返回原帖当前详情 200，不重复扣额；不同内容 409。规范化内容包含有序图片和联系方式，原始摘要不随后续编辑改变。

帖子变更必须将详情 ETag 原样放入 If-Match，例如 `"post-100-v3"`。审核决定使用 `"review-501-post-v1"`；举报决定使用 `"report-601-pending"`。缺少 400，过期 412。条件比较在事务内完成；不能自动重试管理决定。成功返回新 ETag，客户端更新本地值。同状态操作无副作用，但仍校验版本。

### 1.5 登录限制与图片规则

Redis 原子保存失败计数/暂停/来源限速：账号首次失败起 10 分钟内连续失败 5 次，暂停密码登录 10 分钟；暂停尝试不延长窗口，成功密码验证清除对应失败计数。登录及绑定相关请求每 IP 每分钟最多 30 次，来源窗口自首次请求起 60 秒，后续不刷新到期，成功也计来源次数，只信任配置代理的来源。Redis 故障拒绝新登录及密码校验型绑定，503；已有 JWT 仍通过 MySQL 验证。

图片存于私有 OSS，帖子 images 是 Object Key 数组，不建图片表。后端上传/代理读取，不返回 OSS 签名 URL。JPEG/PNG，单图最多 5 MiB，帖子最多 6 张，数组顺序决定封面。所有保护 JSON/图片响应 Cache-Control: no-store。网页同源图片携带 Cookie；小程序先携带 Bearer 下载到临时路径供图片组件显示，退出后清除显示与临时路径缓存，具体行为待开发者工具联调。

通知 type 固定为 post_review（审核结果）、post_removed（下架）、report_result（举报结果）、account_status（账号处置）、password_reset（密码重置）。管理员日志 action 固定为 approve_post、return_post、reject_post、remove_post、handle_report、dismiss_report、disable_user、reset_password；以上为接口值，不要求表结构变更。


## 2. 登录认证


### 2.1 获取网页 CSRF 凭证

#### 2.1.1 基本信息

请求路径：`/api/v1/auth/csrf`  
请求方式：`GET`  
接口描述：获取网页 CSRF 凭证。  
访问权限：网页公开基础设施入口，不返回业务数据。  
成功状态：HTTP 200。

#### 2.1.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


无额外请求参数。


请求参数样例：

```http
GET /api/v1/auth/csrf HTTP/1.1
```



#### 2.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.csrf_token | string | 网页修改请求使用的签名 CSRF 值 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "csrf_token": "<签名后的CSRF值>"
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| Set-Cookie | lf_csrf=&lt;签名值&gt;; SameSite=Lax; Path=/api |


业务说明：登录前设置随机预登录 CSRF Cookie；登录后签名值绑定当前 JWT jti。返回值用于修改类请求 X-CSRF-Token。允许强制改密用户调用。有效 JWT 已失效时需重新登录。

异常状态：401 TOKEN_EXPIRED / TOKEN_REVOKED


### 2.2 账号密码或微信快捷登录

#### 2.2.1 基本信息

请求路径：`/api/v1/auth/tokens`  
请求方式：`POST`  
接口描述：账号密码或微信快捷登录。  
访问权限：未登录可用；管理员登录另校验实时 admin 角色。  
成功状态：HTTP 200。

#### 2.2.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| grant_type | Body | string | 是 | password / wechat_code |
| client_type | Body | string | 是 | web / miniapp / admin_web；仅决定交付方式，不授予角色 |
| account_no | Body | string | 条件必填 | 模拟学号/职工号，1–32 字符；password 时必填 |
| password | Body | string | 条件必填 | 原始密码 8–32 字符，不 trim；password 时必填 |
| code | Body | string | 条件必填 | 新的 wx.login 一次性 code；wechat_code 时必填且 client_type 必须 miniapp |


请求参数样例：

```http
POST /api/v1/auth/tokens HTTP/1.1
```


```json
{
  "grant_type": "password",
  "client_type": "web",
  "account_no": "25000001",
  "password": "example-only-password"
}
```


小程序微信快捷登录请求样例：

```json
{
  "grant_type": "wechat_code",
  "client_type": "miniapp",
  "code": "<新的wx.login code>"
}
```


#### 2.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.user | object | 本次登录用户摘要 |
| data.user.id | string | 资源 ID，十进制字符串 |
| data.user.nickname | string | 展示昵称 |
| data.user.role | string | user / admin |
| data.user.must_change_password | boolean | 是否必须先改密 |
| data.expires_at | string | JWT 到期时间，签发后 24 小时 |
| data.csrf_token | string | 网页修改请求使用的签名 CSRF 值 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "user": {
      "id": "1001",
      "nickname": "演示同学",
      "role": "user",
      "must_change_password": false
    },
    "expires_at": "2026-10-05T09:30:00+08:00",
    "csrf_token": "<登录后的CSRF值>"
  },
  "request_id": "req_demo_001"
}
```


小程序登录响应：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| data.access_token | string | 仅小程序返回的 JWT，日志禁止记录 |
| data.token_type | string | 固定 Bearer，仅小程序返回 |

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "user": {
      "id": "1001",
      "nickname": "演示同学",
      "role": "user",
      "must_change_password": false
    },
    "expires_at": "2026-10-05T09:30:00+08:00",
    "access_token": "<仅小程序返回的JWT>",
    "token_type": "Bearer"
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| Set-Cookie | lf_access_token=&lt;JWT&gt;; HttpOnly; SameSite=Lax; Path=/api; Max-Age=86400 |


业务说明：账号不存在及密码错误统一 401。微信身份未绑定返回 409，不自动创建账号。账号禁用或未验证不签发凭证。临时密码登录只可改密、退出和获取 CSRF；登录后前端转改密页。网页登录仅通过 HttpOnly Cookie 交付 JWT；小程序响应含 access_token 和 token_type=Bearer，不含 csrf_token。

异常状态：401 INVALID_CREDENTIALS；403 ACCOUNT_DISABLED / IDENTITY_UNVERIFIED / FORBIDDEN；409 WECHAT_NOT_BOUND；429 LOGIN_RATE_LIMITED；502 WECHAT_UPSTREAM_ERROR；503 AUTH_LIMITER_UNAVAILABLE


### 2.3 退出当前账号全部端

#### 2.3.1 基本信息

请求路径：`/api/v1/auth/tokens/current`  
请求方式：`DELETE`  
接口描述：退出当前账号全部端。  
访问权限：有效登录，允许强制改密用户。  
成功状态：HTTP 200。

#### 2.3.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


无额外请求参数。


请求参数样例：

```http
DELETE /api/v1/auth/tokens/current HTTP/1.1
```



#### 2.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | null | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": null,
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| Set-Cookie | lf_access_token=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0 |


业务说明：按 JWT 当前 token_version 条件递增用户版本，全部端旧 JWT 失效。清除网页凭证；旧令牌重试返回 401 且不再次递增。无会话表，无单设备退出。

异常状态：401 TOKEN_REVOKED / TOKEN_EXPIRED


## 3. 当前用户


### 3.1 查询当前用户资料

#### 3.1.1 基本信息

请求路径：`/api/v1/users/me`  
请求方式：`GET`  
接口描述：查询当前用户资料。  
访问权限：已验证有效登录。  
成功状态：HTTP 200。

#### 3.1.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


无额外请求参数。


请求参数样例：

```http
GET /api/v1/users/me HTTP/1.1
```



#### 3.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.account_no | string | 模拟学号/职工号，仅本人或管理员可见 |
| data.identity_type | string | student / staff |
| data.nickname | string | 展示昵称 |
| data.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.role | string | user / admin |
| data.is_verified | boolean | 模拟校园身份是否已验证 |
| data.must_change_password | boolean | 是否必须先改密 |
| data.wechat_bound | boolean | 是否绑定微信 |
| data.wechat_bound_at | string \| null | 微信绑定时间，无绑定为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "1001",
    "account_no": "25000001",
    "identity_type": "student",
    "nickname": "演示同学",
    "avatar_url": "/static/avatars/default.png",
    "role": "user",
    "is_verified": true,
    "must_change_password": false,
    "wechat_bound": false,
    "wechat_bound_at": null
  },
  "request_id": "req_demo_001"
}
```


业务说明：仅返回本人资料；头像使用预置或默认地址，无头像上传或资料修改接口。不返回哈希、token_version、OpenID 或 AppSecret。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 3.2 修改当前用户密码

#### 3.2.1 基本信息

请求路径：`/api/v1/users/me/password`  
请求方式：`PUT`  
接口描述：修改当前用户密码。  
访问权限：有效登录，允许强制改密用户。  
成功状态：HTTP 200。

#### 3.2.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| current_password | Body | string | 是 | 当前密码，8–32 字符 |
| new_password | Body | string | 是 | 新密码，8–32 字符，允许空格与 Unicode，不截断、不 trim |


请求参数样例：

```http
PUT /api/v1/users/me/password HTTP/1.1
```


```json
{
  "current_password": "example-old-password",
  "new_password": "example-new-password"
}
```


#### 3.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | null | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": null,
  "request_id": "req_demo_001"
}
```


业务说明：校验原密码（错误返回 401 INVALID_CREDENTIALS）；新旧密码相同返回 400 INVALID_REQUEST。成功后清除网页登录 Cookie，小程序清除本地令牌；Argon2id 独立盐，内存 19 MiB、迭代 2、并行度 1。事务更新哈希、清除强制改密标志并递增 token_version；全部端重新登录。不记录请求体。

异常状态：401 INVALID_CREDENTIALS；400 VALIDATION_ERROR


### 3.3 绑定或更换微信身份

#### 3.3.1 基本信息

请求路径：`/api/v1/users/me/wechat-binding`  
请求方式：`PUT`  
接口描述：绑定或更换微信身份。  
访问权限：已验证有效登录的小程序流程。  
成功状态：HTTP 200。

#### 3.3.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| code | Body | string | 是 | 新的 wx.login code，由后端换取微信身份 |
| current_password | Body | string | 条件必填 | 更换已有绑定时必填，8–32 字符；首次绑定可省略 |


请求参数样例：

```http
PUT /api/v1/users/me/wechat-binding HTTP/1.1
```


```json
{
  "code": "<新的wx.login code>",
  "current_password": "example-only-password"
}
```


#### 3.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.bound | boolean | 绑定是否成功，成功为 true |
| data.bound_at | string | 当前微信绑定时间 |
| data.reauth_required | boolean | 是否因换绑需重新登录 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "bound": true,
    "bound_at": "2026-10-04T09:30:00+08:00",
    "reauth_required": true
  },
  "request_id": "req_demo_001"
}
```


业务说明：平台账号与微信一对一。首次绑定不增加登录版本；换绑验证平台密码，成功递增版本并要求全部端重新登录。相同身份为无变化操作，reauth_required=false；失败保留原绑定。code 失败或超时后获取新值，不重复使用。无单独解绑。

异常状态：401 INVALID_CREDENTIALS；409 WECHAT_ALREADY_BOUND；429 LOGIN_RATE_LIMITED；502 WECHAT_UPSTREAM_ERROR；503 AUTH_LIMITER_UNAVAILABLE


### 3.4 查询当日发帖额度

#### 3.4.1 基本信息

请求路径：`/api/v1/users/me/post-quota`  
请求方式：`GET`  
接口描述：查询当日发帖额度。  
访问权限：已验证有效登录。  
成功状态：HTTP 200。

#### 3.4.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


无额外请求参数。


请求参数样例：

```http
GET /api/v1/users/me/post-quota HTTP/1.1
```



#### 3.4.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.date | string | 北京时间当日日期 |
| data.limit | integer | 每日最大新帖数，固定 3 |
| data.used | integer | 当日已成功提交新帖数量 |
| data.remaining | integer | 当日剩余额度 |
| data.resets_at | string | 北京次日零点 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "date": "2026-10-04",
    "limit": 3,
    "used": 1,
    "remaining": 2,
    "resets_at": "2026-10-05T00:00:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


业务说明：按北京时间自然日查询 MySQL。网页/小程序、寻物/拾物共享额度；每天最多成功提交 3 篇新帖。失败、重试、修改/重提不额外扣减；拒绝/撤回不返还。额度查询不预留提交名额。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


## 4. 帖子


### 4.1 首页帖子列表查询

#### 4.1.1 基本信息

请求路径：`/api/v1/posts`  
请求方式：`GET`  
接口描述：首页帖子列表查询。  
访问权限：已验证有效登录。  
成功状态：HTTP 200。

#### 4.1.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| post_type | Query | string | 否 | lost / found；不传为全部类型 |
| campus | Query | string | 否 | xiasha / shaoxing / wenyi；不传为全部校区 |
| keyword | Query | string | 否 | 最多 100 字符，包含搜索名称、地点、描述，不搜索联系方式 |
| event_date_from | Query | string | 否 | 事件日期下界 YYYY-MM-DD，包含 |
| event_date_to | Query | string | 否 | 事件日期上界 YYYY-MM-DD，包含，不小于下界 |
| resolution_status | Query | string | 否 | active / completed / all，默认 active；all 不含撤回 |


请求参数样例：

```http
GET /api/v1/posts?page=1&page_size=20 HTTP/1.1
```



#### 4.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_type | string | lost / found |
| data.records[].item_name | string | 物品名称 |
| data.records[].campus | string | xiasha / shaoxing / wenyi |
| data.records[].location | string | 具体地点 |
| data.records[].event_date | string | 事件日期 YYYY-MM-DD |
| data.records[].time_precision | string | date / exact / range |
| data.records[].event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.records[].event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.records[].cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.records[].resolution_status | string | active / completed / withdrawn |
| data.records[].first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.records[].author | object | 发布者公开摘要，不含学号 |
| data.records[].author.id | string | 资源 ID，十进制字符串 |
| data.records[].author.nickname | string | 展示昵称 |
| data.records[].author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.records[].etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "100",
        "post_type": "lost",
        "item_name": "校园卡",
        "campus": "xiasha",
        "location": "图书馆二楼",
        "event_date": "2026-10-02",
        "time_precision": "range",
        "event_time_start": "14:00",
        "event_time_end": "15:00",
        "cover_url": "/api/v1/posts/100/images/0?revision=1",
        "resolution_status": "active",
        "first_published_at": "2026-10-04T09:30:00+08:00",
        "author": {
          "id": "1001",
          "nickname": "演示同学",
          "avatar_url": "/static/avatars/default.png"
        },
        "etag": "\"post-100-v3\""
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：仅审核通过、未撤回且作者启用并已验证的帖子。排序 first_published_at DESC,id DESC；重审通过不置顶。作者/管理员也不能从首页得到待审核内容。卡片不返回描述全文、联系方式、图片 Key 或完整学号。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 4.2 查询帖子详情

#### 4.2.1 基本信息

请求路径：`/api/v1/posts/{id}`  
请求方式：`GET`  
接口描述：查询帖子详情。  
访问权限：已验证有效登录；可见帖读者或作者/管理员。  
成功状态：HTTP 200。

#### 4.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/posts/100 HTTP/1.1
```



#### 4.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_type | string | lost / found |
| data.item_name | string | 物品名称 |
| data.campus | string | xiasha / shaoxing / wenyi |
| data.location | string | 具体地点 |
| data.event_date | string | 事件日期 YYYY-MM-DD |
| data.time_precision | string | date / exact / range |
| data.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.resolution_status | string | active / completed / withdrawn |
| data.first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.author | object | 发布者公开摘要，不含学号 |
| data.author.id | string | 资源 ID，十进制字符串 |
| data.author.nickname | string | 展示昵称 |
| data.author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |
| data.description | string | 完整物品描述 |
| data.image_urls | array | 有序平台当前图片读取地址，不是 OSS URL |
| data.image_urls[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.contact_methods[].value | string | 联系方式内容 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.submitted_at | string | 提交时间 |
| data.completed_at | string \| null | 完成时间，未完成为 null |
| data.withdrawn_at | string \| null | 撤回时间，未撤回为 null |
| data.can_edit | boolean | 当前调用者是否可编辑 |
| data.can_report | boolean | 当前调用者是否可举报 |
| data.can_complete | boolean | 当前调用者是否可标记/撤销完成 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "post_type": "lost",
    "item_name": "校园卡",
    "campus": "xiasha",
    "location": "图书馆二楼",
    "event_date": "2026-10-02",
    "time_precision": "range",
    "event_time_start": "14:00",
    "event_time_end": "15:00",
    "cover_url": "/api/v1/posts/100/images/0?revision=1",
    "resolution_status": "active",
    "first_published_at": "2026-10-04T09:30:00+08:00",
    "author": {
      "id": "1001",
      "nickname": "演示同学",
      "avatar_url": "/static/avatars/default.png"
    },
    "etag": "\"post-100-v3\"",
    "description": "黑色卡套，里面有一张校园卡。",
    "image_urls": [
      "/api/v1/posts/100/images/0?revision=1"
    ],
    "contact_methods": [
      {
        "type": "wechat",
        "value": "example_wechat"
      }
    ],
    "review_status": "approved",
    "revision": 1,
    "state_version": 3,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "completed_at": null,
    "withdrawn_at": null,
    "can_edit": false,
    "can_report": true,
    "can_complete": false
  },
  "request_id": "req_demo_001"
}
```


作者/管理员可获的附加响应字段：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| data.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.review_reason | string \| null | 当前审核/下架原因，无决定为 null |
| data.reviewed_at | string \| null | 当前审核/下架时间，无决定为 null |

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "post_type": "lost",
    "item_name": "校园卡",
    "campus": "xiasha",
    "location": "图书馆二楼",
    "event_date": "2026-10-02",
    "time_precision": "range",
    "event_time_start": "14:00",
    "event_time_end": "15:00",
    "cover_url": "/api/v1/posts/100/images/0?revision=1",
    "resolution_status": "active",
    "first_published_at": "2026-10-04T09:30:00+08:00",
    "author": {
      "id": "1001",
      "nickname": "演示同学",
      "avatar_url": "/static/avatars/default.png"
    },
    "etag": "\"post-100-v3\"",
    "description": "黑色卡套，里面有一张校园卡。",
    "image_urls": [
      "/api/v1/posts/100/images/0?revision=1"
    ],
    "contact_methods": [
      {
        "type": "wechat",
        "value": "example_wechat"
      }
    ],
    "review_status": "approved",
    "revision": 1,
    "state_version": 3,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "completed_at": null,
    "withdrawn_at": null,
    "can_edit": true,
    "can_report": false,
    "can_complete": true,
    "images": [
      "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
    ],
    "review_reason": "审核通过",
    "reviewed_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "post-100-v3" |


业务说明：普通读者返回公开详情；作者/管理员另外返回 images、review_reason、reviewed_at，供编辑或审核。隐藏/撤回帖子只有作者与管理员可读。权限标志是界面提示，不能替代后端授权。

异常状态：404 RESOURCE_NOT_FOUND


### 4.3 提交新帖子

#### 4.3.1 基本信息

请求路径：`/api/v1/posts`  
请求方式：`POST`  
接口描述：提交新帖子。  
访问权限：已验证有效登录。  
成功状态：HTTP 201。

#### 4.3.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| Idempotency-Key | Header | string | 是 | 一次新帖的 UUID，客户端重复提交使用原值 |
| post_type | Body | string | 是 | lost 寻物 / found 拾物，必须主动选择 |
| item_name | Body | string | 是 | 物品名称，1–50 字符 |
| campus | Body | string | 是 | xiasha 下沙 / shaoxing 绍兴 / wenyi 文一 |
| location | Body | string | 是 | 具体地点，1–100 字符 |
| event_date | Body | string | 是 | YYYY-MM-DD，北京时间日期，不得在未来 |
| time_precision | Body | string | 是 | date 仅日期 / exact 具体时间 / range 同日时间段 |
| event_time_start | Body | string \| null | 条件必填 | HH:mm；date 为 null，exact/range 必填 |
| event_time_end | Body | string \| null | 条件必填 | HH:mm；date/exact 为 null，range 必填且不早于 start |
| description | Body | string | 是 | 描述含补充信息共 1–300 字符 |
| images | Body | array&lt;string&gt; | 是 | 必传，可为空；最多 6 个不同 Object Key，属于本人且对象存在 |
| contact_methods | Body | array&lt;object&gt; | 是 | 至少 1 项，不限制同类型项数 |
| contact_methods[].type | Body | string | 是 | wechat / phone / qq / other |
| contact_methods[].value | Body | string | 是 | 1–200 字符；手机为大陆 11 位数字，QQ 为 5–12 位数字，其他非空 |


请求参数样例：

```http
POST /api/v1/posts HTTP/1.1
Idempotency-Key: 8b4b53c0-7e2b-4f13-8a6a-6620d06c871e
```


```json
{
  "post_type": "lost",
  "item_name": "校园卡",
  "campus": "xiasha",
  "location": "图书馆二楼",
  "event_date": "2026-10-02",
  "time_precision": "range",
  "event_time_start": "14:00",
  "event_time_end": "15:00",
  "description": "黑色卡套，里面有一张校园卡。",
  "images": [
    "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
  ],
  "contact_methods": [
    {
      "type": "wechat",
      "value": "example_wechat"
    }
  ]
}
```


#### 4.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_type | string | lost / found |
| data.item_name | string | 物品名称 |
| data.campus | string | xiasha / shaoxing / wenyi |
| data.location | string | 具体地点 |
| data.event_date | string | 事件日期 YYYY-MM-DD |
| data.time_precision | string | date / exact / range |
| data.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.resolution_status | string | active / completed / withdrawn |
| data.first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.author | object | 发布者公开摘要，不含学号 |
| data.author.id | string | 资源 ID，十进制字符串 |
| data.author.nickname | string | 展示昵称 |
| data.author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |
| data.description | string | 完整物品描述 |
| data.image_urls | array | 有序平台当前图片读取地址，不是 OSS URL |
| data.image_urls[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.contact_methods[].value | string | 联系方式内容 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.submitted_at | string | 提交时间 |
| data.completed_at | string \| null | 完成时间，未完成为 null |
| data.withdrawn_at | string \| null | 撤回时间，未撤回为 null |
| data.can_edit | boolean | 当前调用者是否可编辑 |
| data.can_report | boolean | 当前调用者是否可举报 |
| data.can_complete | boolean | 当前调用者是否可标记/撤销完成 |
| data.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.review_reason | string \| null | 当前审核/下架原因，无决定为 null |
| data.reviewed_at | string \| null | 当前审核/下架时间，无决定为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "post_type": "lost",
    "item_name": "校园卡",
    "campus": "xiasha",
    "location": "图书馆二楼",
    "event_date": "2026-10-02",
    "time_precision": "range",
    "event_time_start": "14:00",
    "event_time_end": "15:00",
    "cover_url": "/api/v1/posts/100/images/0?revision=1",
    "resolution_status": "active",
    "first_published_at": null,
    "author": {
      "id": "1001",
      "nickname": "演示同学",
      "avatar_url": "/static/avatars/default.png"
    },
    "etag": "\"post-100-v1\"",
    "description": "黑色卡套，里面有一张校园卡。",
    "image_urls": [
      "/api/v1/posts/100/images/0?revision=1"
    ],
    "contact_methods": [
      {
        "type": "wechat",
        "value": "example_wechat"
      }
    ],
    "review_status": "pending",
    "revision": 1,
    "state_version": 1,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "completed_at": null,
    "withdrawn_at": null,
    "can_edit": true,
    "can_report": false,
    "can_complete": false,
    "images": [
      "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
    ],
    "review_reason": null,
    "reviewed_at": null
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| Location | /api/v1/posts/100 |
| ETag | "post-100-v1" |


业务说明：事务写入新帖 pending+active、revision=1、state_version=1、完整审核快照和当日额度。相同作者+键+原始内容重试 200 返回该帖当前详情；不同内容复用键 409。先判断幂等再判断额度。上传失败或数据库回滚不扣额。

异常状态：409 IDEMPOTENCY_CONFLICT；429 POST_QUOTA_EXCEEDED（Retry-After 为到北京次日零点秒数）；503 OSS_UNAVAILABLE


### 4.4 编辑并重新提交帖子

#### 4.4.1 基本信息

请求路径：`/api/v1/posts/{id}`  
请求方式：`PUT`  
接口描述：编辑并重新提交帖子。  
访问权限：作者本人。  
成功状态：HTTP 200。

#### 4.4.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| If-Match | Header | string | 是 | 传入所操作资源详情返回的 ETag，保留双引号；缺少返回 400，过期返回 412 |
| post_type | Body | string | 是 | lost 寻物 / found 拾物，必须主动选择 |
| item_name | Body | string | 是 | 物品名称，1–50 字符 |
| campus | Body | string | 是 | xiasha 下沙 / shaoxing 绍兴 / wenyi 文一 |
| location | Body | string | 是 | 具体地点，1–100 字符 |
| event_date | Body | string | 是 | YYYY-MM-DD，北京时间日期，不得在未来 |
| time_precision | Body | string | 是 | date 仅日期 / exact 具体时间 / range 同日时间段 |
| event_time_start | Body | string \| null | 条件必填 | HH:mm；date 为 null，exact/range 必填 |
| event_time_end | Body | string \| null | 条件必填 | HH:mm；date/exact 为 null，range 必填且不早于 start |
| description | Body | string | 是 | 描述含补充信息共 1–300 字符 |
| images | Body | array&lt;string&gt; | 是 | 必传，可为空；最多 6 个不同 Object Key，属于本人且对象存在 |
| contact_methods | Body | array&lt;object&gt; | 是 | 至少 1 项，不限制同类型项数 |
| contact_methods[].type | Body | string | 是 | wechat / phone / qq / other |
| contact_methods[].value | Body | string | 是 | 1–200 字符；手机为大陆 11 位数字，QQ 为 5–12 位数字，其他非空 |


请求参数样例：

```http
PUT /api/v1/posts/100 HTTP/1.1
If-Match: "post-100-v3"
```


```json
{
  "post_type": "lost",
  "item_name": "校园卡",
  "campus": "xiasha",
  "location": "图书馆二楼",
  "event_date": "2026-10-02",
  "time_precision": "range",
  "event_time_start": "14:00",
  "event_time_end": "15:00",
  "description": "黑色卡套，里面有一张校园卡。",
  "images": [
    "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
  ],
  "contact_methods": [
    {
      "type": "wechat",
      "value": "example_wechat"
    }
  ]
}
```


#### 4.4.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_type | string | lost / found |
| data.item_name | string | 物品名称 |
| data.campus | string | xiasha / shaoxing / wenyi |
| data.location | string | 具体地点 |
| data.event_date | string | 事件日期 YYYY-MM-DD |
| data.time_precision | string | date / exact / range |
| data.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.resolution_status | string | active / completed / withdrawn |
| data.first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.author | object | 发布者公开摘要，不含学号 |
| data.author.id | string | 资源 ID，十进制字符串 |
| data.author.nickname | string | 展示昵称 |
| data.author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |
| data.description | string | 完整物品描述 |
| data.image_urls | array | 有序平台当前图片读取地址，不是 OSS URL |
| data.image_urls[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.contact_methods[].value | string | 联系方式内容 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.submitted_at | string | 提交时间 |
| data.completed_at | string \| null | 完成时间，未完成为 null |
| data.withdrawn_at | string \| null | 撤回时间，未撤回为 null |
| data.can_edit | boolean | 当前调用者是否可编辑 |
| data.can_report | boolean | 当前调用者是否可举报 |
| data.can_complete | boolean | 当前调用者是否可标记/撤销完成 |
| data.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.review_reason | string \| null | 当前审核/下架原因，无决定为 null |
| data.reviewed_at | string \| null | 当前审核/下架时间，无决定为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "post_type": "lost",
    "item_name": "校园卡",
    "campus": "xiasha",
    "location": "图书馆二楼",
    "event_date": "2026-10-02",
    "time_precision": "range",
    "event_time_start": "14:00",
    "event_time_end": "15:00",
    "cover_url": "/api/v1/posts/100/images/0?revision=2",
    "resolution_status": "active",
    "first_published_at": "2026-10-04T09:30:00+08:00",
    "author": {
      "id": "1001",
      "nickname": "演示同学",
      "avatar_url": "/static/avatars/default.png"
    },
    "etag": "\"post-100-v4\"",
    "description": "黑色卡套，里面有一张校园卡。",
    "image_urls": [
      "/api/v1/posts/100/images/0?revision=2"
    ],
    "contact_methods": [
      {
        "type": "wechat",
        "value": "example_wechat"
      }
    ],
    "review_status": "pending",
    "revision": 2,
    "state_version": 4,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "completed_at": null,
    "withdrawn_at": null,
    "can_edit": true,
    "can_report": false,
    "can_complete": false,
    "images": [
      "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
    ],
    "review_reason": null,
    "reviewed_at": null
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "post-100-v4" |


业务说明：完整替换内容，缺字段不沿用旧值；每次有效提交新 revision/state_version、审核快照，旧未审记录置 superseded。立即隐藏待重审；完成标记保留。撤回不可编辑；其他审核状态均可编辑。不扣新帖额度。

异常状态：409 STATE_CONFLICT；412 RESOURCE_CHANGED；503 OSS_UNAVAILABLE


### 4.5 完成、撤销完成或撤回帖子

#### 4.5.1 基本信息

请求路径：`/api/v1/posts/{id}/resolution`  
请求方式：`PATCH`  
接口描述：完成、撤销完成或撤回帖子。  
访问权限：作者本人。  
成功状态：HTTP 200。

#### 4.5.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| If-Match | Header | string | 是 | 传入所操作资源详情返回的 ETag，保留双引号；缺少返回 400，过期返回 412 |
| resolution_status | Body | string | 是 | active / completed / withdrawn |


请求参数样例：

```http
PATCH /api/v1/posts/100/resolution HTTP/1.1
If-Match: "post-100-v3"
```


```json
{
  "resolution_status": "completed"
}
```


#### 4.5.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.resolution_status | string | active / completed / withdrawn |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.completed_at | string \| null | 完成时间，未完成为 null |
| data.withdrawn_at | string \| null | 撤回时间，未撤回为 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "review_status": "approved",
    "resolution_status": "completed",
    "revision": 1,
    "state_version": 4,
    "completed_at": "2026-10-04T09:30:00+08:00",
    "withdrawn_at": null,
    "etag": "\"post-100-v4\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "post-100-v4" |


业务说明：active→completed / completed→active 仅限审核通过且未撤回；active/completed→withdrawn 允许任意审核状态，撤回不可恢复。只增加状态版本，不创建内容审核；撤销完成清空 completed_at。相同目标状态为无变化操作，仍检查 If-Match，不重复通知/计数。

异常状态：409 STATE_CONFLICT；412 RESOURCE_CHANGED


### 4.6 查询帖子历史审核记录

#### 4.6.1 基本信息

请求路径：`/api/v1/posts/{id}/reviews`  
请求方式：`GET`  
接口描述：查询帖子历史审核记录。  
访问权限：作者或管理员。  
成功状态：HTTP 200。

#### 4.6.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |


请求参数样例：

```http
GET /api/v1/posts/100/reviews?page=1&page_size=20 HTTP/1.1
```



#### 4.6.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_id | string \| null | 帖子 ID |
| data.records[].revision | integer | 帖子内容版本，从 1 开始 |
| data.records[].decision | string | pending / approved / returned / rejected / superseded |
| data.records[].content_snapshot | object | 不可变的该次提交完整内容 |
| data.records[].content_snapshot.post_type | string | lost / found |
| data.records[].content_snapshot.item_name | string | 物品名称 |
| data.records[].content_snapshot.campus | string | xiasha / shaoxing / wenyi |
| data.records[].content_snapshot.location | string | 具体地点 |
| data.records[].content_snapshot.event_date | string | 事件日期 YYYY-MM-DD |
| data.records[].content_snapshot.time_precision | string | date / exact / range |
| data.records[].content_snapshot.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.records[].content_snapshot.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.records[].content_snapshot.description | string | 完整物品描述 |
| data.records[].content_snapshot.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.records[].content_snapshot.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.records[].content_snapshot.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.records[].content_snapshot.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.records[].content_snapshot.contact_methods[].value | string | 联系方式内容 |
| data.records[].reviewer | object \| null | 审核人摘要，无审核人为 null；非空含 id/nickname |
| data.records[].reviewer.id | string | 处理人用户 ID，非空对象包含 |
| data.records[].reviewer.nickname | string | 处理人展示昵称，非空对象包含 |
| data.records[].reason | string \| null | 审核或管理原因，无决定为 null |
| data.records[].submitted_at | string | 提交时间 |
| data.records[].processed_at | string \| null | 审核处理时间，未处理为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "501",
        "post_id": "100",
        "revision": 1,
        "decision": "pending",
        "content_snapshot": {
          "post_type": "lost",
          "item_name": "校园卡",
          "campus": "xiasha",
          "location": "图书馆二楼",
          "event_date": "2026-10-02",
          "time_precision": "range",
          "event_time_start": "14:00",
          "event_time_end": "15:00",
          "description": "黑色卡套，里面有一张校园卡。",
          "images": [
            "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
          ],
          "contact_methods": [
            {
              "type": "wechat",
              "value": "example_wechat"
            }
          ]
        },
        "reviewer": null,
        "reason": null,
        "submitted_at": "2026-10-04T09:30:00+08:00",
        "processed_at": null
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：revision DESC 排序，包含 pending/approved/returned/rejected/superseded 的不可变内容快照与处理结果；不提供其他普通用户访问。图片 Key 供授权编辑/追溯，历史图片使用专用读取接口。

异常状态：404 RESOURCE_NOT_FOUND


### 4.7 查询我的帖子

#### 4.7.1 基本信息

请求路径：`/api/v1/users/me/posts`  
请求方式：`GET`  
接口描述：查询我的帖子。  
访问权限：已验证有效登录。  
成功状态：HTTP 200。

#### 4.7.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| review_status | Query | string | 否 | pending / approved / returned / rejected / removed |
| resolution_status | Query | string | 否 | active / completed / withdrawn |


请求参数样例：

```http
GET /api/v1/users/me/posts?page=1&page_size=20 HTTP/1.1
```



#### 4.7.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_type | string | lost / found |
| data.records[].item_name | string | 物品名称 |
| data.records[].campus | string | xiasha / shaoxing / wenyi |
| data.records[].location | string | 具体地点 |
| data.records[].event_date | string | 事件日期 YYYY-MM-DD |
| data.records[].time_precision | string | date / exact / range |
| data.records[].event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.records[].event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.records[].cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.records[].resolution_status | string | active / completed / withdrawn |
| data.records[].first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.records[].author | object | 发布者公开摘要，不含学号 |
| data.records[].author.id | string | 资源 ID，十进制字符串 |
| data.records[].author.nickname | string | 展示昵称 |
| data.records[].author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.records[].etag | string | 并发条件值，写请求原样放入 If-Match |
| data.records[].review_status | string | pending / approved / returned / rejected / removed |
| data.records[].revision | integer | 帖子内容版本，从 1 开始 |
| data.records[].state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.records[].review_reason | string \| null | 当前审核/下架原因，无决定为 null |
| data.records[].submitted_at | string | 提交时间 |
| data.records[].created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "100",
        "post_type": "lost",
        "item_name": "校园卡",
        "campus": "xiasha",
        "location": "图书馆二楼",
        "event_date": "2026-10-02",
        "time_precision": "range",
        "event_time_start": "14:00",
        "event_time_end": "15:00",
        "cover_url": "/api/v1/posts/100/images/0?revision=1",
        "resolution_status": "active",
        "first_published_at": "2026-10-04T09:30:00+08:00",
        "author": {
          "id": "1001",
          "nickname": "演示同学",
          "avatar_url": "/static/avatars/default.png"
        },
        "etag": "\"post-100-v3\"",
        "review_status": "approved",
        "revision": 1,
        "state_version": 3,
        "review_reason": "审核通过",
        "submitted_at": "2026-10-04T09:30:00+08:00",
        "created_at": "2026-10-04T09:30:00+08:00"
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：包含本人所有审核及归还状态。created_at DESC,id DESC；不返回完整联系方式或描述。状态筛选不传即全部。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


## 5. 图片


### 5.1 上传单张帖子图片

#### 5.1.1 基本信息

请求路径：`/api/v1/users/me/image-uploads`  
请求方式：`POST`  
接口描述：上传单张帖子图片。  
访问权限：已验证有效登录。  
成功状态：HTTP 201。

#### 5.1.2 请求参数

请求数据格式：multipart/form-data。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| file | Body | file | 是 | 单张 JPEG/PNG；按真实内容校验，最大 5,242,880 字节 |


请求参数样例：

```http
POST /api/v1/users/me/image-uploads HTTP/1.1
```


表单字段 file：选择本地 JPEG/PNG 文件；multipart boundary 由客户端生成。


#### 5.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.object_key | string | 上传成功的永久 OSS 对象标识 |
| data.preview_url | string | 本人上传预览地址 |
| data.mime_type | string | image/jpeg 或 image/png |
| data.size_bytes | integer | 文件大小，字节 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "object_key": "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg",
    "preview_url": "/api/v1/users/me/image-uploads/550e8400-e29b-41d4-a716-446655440000.jpg/content",
    "mime_type": "image/jpeg",
    "size_bytes": 120000
  },
  "request_id": "req_demo_001"
}
```


业务说明：后端生成本人前缀+随机 UUID Key，不覆盖旧对象。上传本身不扣发帖额度，不建图片表；帖子最多引用 6 张。数据库提交失败保留已上传对象。Key 用于发帖，preview_url 只用于本人预览。

异常状态：413 FILE_TOO_LARGE；415 UNSUPPORTED_MEDIA_TYPE；503 OSS_UNAVAILABLE


### 5.2 预览本人已上传图片

#### 5.2.1 基本信息

请求路径：`/api/v1/users/me/image-uploads/{filename}/content`  
请求方式：`GET`  
接口描述：预览本人已上传图片。  
访问权限：上传者本人。  
成功状态：HTTP 200。

#### 5.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| filename | Path | string | 是 | 后端返回的 UUID.jpg / UUID.png 文件名 |


请求参数样例：

```http
GET /api/v1/users/me/image-uploads/550e8400-e29b-41d4-a716-446655440000.jpg/content HTTP/1.1
```



#### 5.2.3 响应数据


响应数据格式：图片二进制，Content-Type 为 image/jpeg 或 image/png。

响应参数说明（响应头）：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| Content-Type | string | 实际图片 MIME 类型 |
| Cache-Control | string | 固定 no-store |
| X-Content-Type-Options | string | 固定 nosniff |
| X-Request-ID | string | 服务端请求追踪 ID |

响应数据样例：

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Request-ID: req_demo_001

<JPEG 二进制数据>
```

失败返回 1.3 的 JSON 错误格式，不把 JSON 伪装成图片。


业务说明：filename 仅允许后端返回 UUID.jpg 或 UUID.png；按当前用户构建对象前缀，不允许输入路径、外部 URL 或 Bucket。未发帖也可本人预览。

异常状态：404 RESOURCE_NOT_FOUND；503 OSS_UNAVAILABLE


### 5.3 读取帖子当前版本图片

#### 5.3.1 基本信息

请求路径：`/api/v1/posts/{id}/images/{index}`  
请求方式：`GET`  
接口描述：读取帖子当前版本图片。  
访问权限：可见帖读者，或作者/管理员。  
成功状态：HTTP 200。

#### 5.3.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| index | Path | integer | 是 | 图片下标，从 0 开始 |
| revision | Query | integer | 是 | 必须等于帖子当前 revision，最小 1 |


请求参数样例：

```http
GET /api/v1/posts/100/images/0?revision=1 HTTP/1.1
```



#### 5.3.3 响应数据


响应数据格式：图片二进制，Content-Type 为 image/jpeg 或 image/png。

响应参数说明（响应头）：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| Content-Type | string | 实际图片 MIME 类型 |
| Cache-Control | string | 固定 no-store |
| X-Content-Type-Options | string | 固定 nosniff |
| X-Request-ID | string | 服务端请求追踪 ID |

响应数据样例：

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Request-ID: req_demo_001

<JPEG 二进制数据>
```

失败返回 1.3 的 JSON 错误格式，不把 JSON 伪装成图片。


业务说明：index 从 0 开始，按帖子 images 数组定位。revision 不匹配或 index 越界返回 404，避免旧 URL 展示新版本另一张图；每次请求实时校验登录版本和帖子权限。

异常状态：404 RESOURCE_NOT_FOUND；503 OSS_UNAVAILABLE


### 5.4 读取审核快照中的历史图片

#### 5.4.1 基本信息

请求路径：`/api/v1/posts/{id}/reviews/{review_id}/images/{index}`  
请求方式：`GET`  
接口描述：读取审核快照中的历史图片。  
访问权限：作者或管理员。  
成功状态：HTTP 200。

#### 5.4.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| review_id | Path | string | 是 | 审核记录 ID，十进制字符串 |
| index | Path | integer | 是 | 图片下标，从 0 开始 |


请求参数样例：

```http
GET /api/v1/posts/100/reviews/501/images/0 HTTP/1.1
```



#### 5.4.3 响应数据


响应数据格式：图片二进制，Content-Type 为 image/jpeg 或 image/png。

响应参数说明（响应头）：

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| Content-Type | string | 实际图片 MIME 类型 |
| Cache-Control | string | 固定 no-store |
| X-Content-Type-Options | string | 固定 nosniff |
| X-Request-ID | string | 服务端请求追踪 ID |

响应数据样例：

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Cache-Control: no-store
X-Content-Type-Options: nosniff
X-Request-ID: req_demo_001

<JPEG 二进制数据>
```

失败返回 1.3 的 JSON 错误格式，不把 JSON 伪装成图片。


业务说明：校验审核记录属于路径中的帖子，再从不可变快照定位图片；index 从 0 开始，普通读者不能读取历史图片。

异常状态：404 RESOURCE_NOT_FOUND；503 OSS_UNAVAILABLE


## 6. 举报与通知


### 6.1 举报帖子

#### 6.1.1 基本信息

请求路径：`/api/v1/posts/{id}/reports`  
请求方式：`POST`  
接口描述：举报帖子。  
访问权限：已验证有效登录；他人的当前可见帖子。  
成功状态：HTTP 201。

#### 6.1.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| post_revision | Body | integer | 是 | 用户看到的当前内容 revision，最小 1 |
| reason_type | Body | string | 是 | false_information / inappropriate / privacy / harassment / other |
| details | Body | string | 条件必填 | 最多 500 字符；other 时 1–500 非空 |


请求参数样例：

```http
POST /api/v1/posts/100/reports HTTP/1.1
```


```json
{
  "post_revision": 1,
  "reason_type": "privacy",
  "details": "图片中包含完整校园卡信息"
}
```


#### 6.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_id | string \| null | 帖子 ID |
| data.post_revision | integer | 举报关联的内容版本 |
| data.status | string | 当前资源状态，枚举见业务说明 |
| data.created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "601",
    "post_id": "100",
    "post_revision": 1,
    "status": "pending",
    "created_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


业务说明：禁止举报自己的帖子。帖子 revision 已变返回 409，请重新查看。相同用户+帖子+版本重复返回原记录 200，不更新原原因；首次 201。不同用户分别保存，后续新内容版本可再次举报。不因举报数量自动处罚。

异常状态：403 FORBIDDEN；404 RESOURCE_NOT_FOUND；409 STATE_CONFLICT


### 6.2 查询本人系统通知

#### 6.2.1 基本信息

请求路径：`/api/v1/notifications`  
请求方式：`GET`  
接口描述：查询本人系统通知。  
访问权限：通知收件人。  
成功状态：HTTP 200。

#### 6.2.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| read | Query | string | 否 | all / true / false，默认 all |


请求参数样例：

```http
GET /api/v1/notifications?page=1&page_size=20 HTTP/1.1
```



#### 6.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.records[].title | string | 通知标题 |
| data.records[].content | string | 通知正文，不含凭证/他人身份 |
| data.records[].post_id | string \| null | 帖子 ID |
| data.records[].review_id | string \| null | 审核记录 ID，无关联时 null |
| data.records[].report_id | string \| null | 举报 ID，无关联时 null |
| data.records[].read_at | string \| null | 首次已读时间，未读为 null |
| data.records[].created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "701",
        "type": "post_review",
        "title": "帖子审核通过",
        "content": "你的校园卡寻物帖已通过审核。",
        "post_id": "100",
        "review_id": "501",
        "report_id": null,
        "read_at": null,
        "created_at": "2026-10-04T09:30:00+08:00"
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：created_at DESC,id DESC。查询不会标为已读；通知不含临时密码、其他举报人的身份或完整联系方式。点击目标帖子仍按当前权限判断；无私聊、独立消息页或微信订阅提醒。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 6.3 查询未读通知数量

#### 6.3.1 基本信息

请求路径：`/api/v1/notifications/unread-count`  
请求方式：`GET`  
接口描述：查询未读通知数量。  
访问权限：通知收件人。  
成功状态：HTTP 200。

#### 6.3.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


无额外请求参数。


请求参数样例：

```http
GET /api/v1/notifications/unread-count HTTP/1.1
```



#### 6.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.count | integer | 当前未读数量 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "count": 3
  },
  "request_id": "req_demo_001"
}
```


业务说明：统计当前用户 read_at 为 null 的通知，响应 count 为非负整数。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 6.4 标记通知已读

#### 6.4.1 基本信息

请求路径：`/api/v1/notifications/{id}/read-state`  
请求方式：`PUT`  
接口描述：标记通知已读。  
访问权限：通知收件人。  
成功状态：HTTP 200。

#### 6.4.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| read | Body | boolean | 是 | 仅允许 true，首版不支持改回未读 |


请求参数样例：

```http
PUT /api/v1/notifications/701/read-state HTTP/1.1
```


```json
{
  "read": true
}
```


#### 6.4.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.read_at | string \| null | 首次已读时间，未读为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "701",
    "read_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


业务说明：第一次写 read_at，重复请求保留原已读时间；不能操作其他人的通知。

异常状态：404 RESOURCE_NOT_FOUND


## 7. 后台帖子与审核


### 7.1 后台帖子列表查询

#### 7.1.1 基本信息

请求路径：`/api/v1/admin/posts`  
请求方式：`GET`  
接口描述：后台帖子列表查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.1.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| post_type | Query | string | 否 | lost / found；不传为全部类型 |
| campus | Query | string | 否 | xiasha / shaoxing / wenyi；不传为全部校区 |
| keyword | Query | string | 否 | 最多 100 字符，包含搜索名称、地点、描述，不搜索联系方式 |
| review_status | Query | string | 否 | pending / approved / returned / rejected / removed |
| resolution_status | Query | string | 否 | active / completed / withdrawn |
| author_id | Query | string | 否 | 发布者用户 ID，精确过滤 |


请求参数样例：

```http
GET /api/v1/admin/posts?page=1&page_size=20 HTTP/1.1
```



#### 7.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_type | string | lost / found |
| data.records[].item_name | string | 物品名称 |
| data.records[].campus | string | xiasha / shaoxing / wenyi |
| data.records[].location | string | 具体地点 |
| data.records[].event_date | string | 事件日期 YYYY-MM-DD |
| data.records[].time_precision | string | date / exact / range |
| data.records[].event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.records[].event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.records[].cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.records[].resolution_status | string | active / completed / withdrawn |
| data.records[].first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.records[].author | object | 发布者公开摘要，不含学号 |
| data.records[].author.id | string | 资源 ID，十进制字符串 |
| data.records[].author.nickname | string | 展示昵称 |
| data.records[].author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.records[].etag | string | 并发条件值，写请求原样放入 If-Match |
| data.records[].author_id | string | 发布者 ID |
| data.records[].review_status | string | pending / approved / returned / rejected / removed |
| data.records[].revision | integer | 帖子内容版本，从 1 开始 |
| data.records[].state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.records[].submitted_at | string | 提交时间 |
| data.records[].created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "100",
        "post_type": "lost",
        "item_name": "校园卡",
        "campus": "xiasha",
        "location": "图书馆二楼",
        "event_date": "2026-10-02",
        "time_precision": "range",
        "event_time_start": "14:00",
        "event_time_end": "15:00",
        "cover_url": "/api/v1/posts/100/images/0?revision=1",
        "resolution_status": "active",
        "first_published_at": "2026-10-04T09:30:00+08:00",
        "author": {
          "id": "1001",
          "nickname": "演示同学",
          "avatar_url": "/static/avatars/default.png"
        },
        "etag": "\"post-100-v3\"",
        "author_id": "1001",
        "review_status": "approved",
        "revision": 1,
        "state_version": 3,
        "submitted_at": "2026-10-04T09:30:00+08:00",
        "created_at": "2026-10-04T09:30:00+08:00"
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：包含隐藏、撤回及账号被禁用的帖子；created_at DESC,id DESC。筛选不传即全部，不返回完整联系方式。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 7.2 后台帖子详情查询

#### 7.2.1 基本信息

请求路径：`/api/v1/admin/posts/{id}`  
请求方式：`GET`  
接口描述：后台帖子详情查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/admin/posts/100 HTTP/1.1
```



#### 7.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_type | string | lost / found |
| data.item_name | string | 物品名称 |
| data.campus | string | xiasha / shaoxing / wenyi |
| data.location | string | 具体地点 |
| data.event_date | string | 事件日期 YYYY-MM-DD |
| data.time_precision | string | date / exact / range |
| data.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.cover_url | string \| null | 平台封面读取地址，无图为 null |
| data.resolution_status | string | active / completed / withdrawn |
| data.first_published_at | string \| null | 首次审核通过时间，未曾通过为 null |
| data.author | object | 发布者公开摘要，不含学号 |
| data.author.id | string | 资源 ID，十进制字符串 |
| data.author.nickname | string | 展示昵称 |
| data.author.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |
| data.description | string | 完整物品描述 |
| data.image_urls | array | 有序平台当前图片读取地址，不是 OSS URL |
| data.image_urls[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.contact_methods[].value | string | 联系方式内容 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.submitted_at | string | 提交时间 |
| data.completed_at | string \| null | 完成时间，未完成为 null |
| data.withdrawn_at | string \| null | 撤回时间，未撤回为 null |
| data.can_edit | boolean | 当前调用者是否可编辑 |
| data.can_report | boolean | 当前调用者是否可举报 |
| data.can_complete | boolean | 当前调用者是否可标记/撤销完成 |
| data.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.review_reason | string \| null | 当前审核/下架原因，无决定为 null |
| data.reviewed_at | string \| null | 当前审核/下架时间，无决定为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "post_type": "lost",
    "item_name": "校园卡",
    "campus": "xiasha",
    "location": "图书馆二楼",
    "event_date": "2026-10-02",
    "time_precision": "range",
    "event_time_start": "14:00",
    "event_time_end": "15:00",
    "cover_url": "/api/v1/posts/100/images/0?revision=1",
    "resolution_status": "active",
    "first_published_at": "2026-10-04T09:30:00+08:00",
    "author": {
      "id": "1001",
      "nickname": "演示同学",
      "avatar_url": "/static/avatars/default.png"
    },
    "etag": "\"post-100-v3\"",
    "description": "黑色卡套，里面有一张校园卡。",
    "image_urls": [
      "/api/v1/posts/100/images/0?revision=1"
    ],
    "contact_methods": [
      {
        "type": "wechat",
        "value": "example_wechat"
      }
    ],
    "review_status": "approved",
    "revision": 1,
    "state_version": 3,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "completed_at": null,
    "withdrawn_at": null,
    "can_edit": false,
    "can_report": false,
    "can_complete": false,
    "images": [
      "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
    ],
    "review_reason": "审核通过",
    "reviewed_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "post-100-v3" |


业务说明：可查看隐藏/撤回帖子、图片 Key、最新审核原因；作者权限标志仍按调用者是否为作者计算，管理员对他人帖 can_edit/can_complete=false。

异常状态：404 RESOURCE_NOT_FOUND


### 7.3 后台人工下架帖子

#### 7.3.1 基本信息

请求路径：`/api/v1/admin/posts/{id}/moderation`  
请求方式：`PATCH`  
接口描述：后台人工下架帖子。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.3.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| If-Match | Header | string | 是 | 传入所操作资源详情返回的 ETag，保留双引号；缺少返回 400，过期返回 412 |
| review_status | Body | string | 是 | 仅允许 removed |
| reason | Body | string | 是 | 处置原因，1–500 字符，非纯空白 |


请求参数样例：

```http
PATCH /api/v1/admin/posts/100/moderation HTTP/1.1
If-Match: "post-100-v3"
```


```json
{
  "review_status": "removed",
  "reason": "图片包含未遮挡的个人信息"
}
```


#### 7.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.review_status | string | pending / approved / returned / rejected / removed |
| data.resolution_status | string | active / completed / withdrawn |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "100",
    "review_status": "removed",
    "resolution_status": "active",
    "revision": 1,
    "state_version": 4,
    "etag": "\"post-100-v4\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "post-100-v4" |


业务说明：仅对未撤回帖子下架；保留完成状态/时间和历史审核结论。未处理审核置 superseded。帖子、通知和日志同事务；同状态不重复副作用，仍检查版本。

异常状态：409 STATE_CONFLICT；412 RESOURCE_CHANGED


### 7.4 后台审核记录列表查询

#### 7.4.1 基本信息

请求路径：`/api/v1/admin/reviews`  
请求方式：`GET`  
接口描述：后台审核记录列表查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.4.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| decision | Query | string | 否 | pending / approved / returned / rejected / superseded，默认 pending |
| post_id | Query | string | 否 | 帖子 ID，精确过滤 |


请求参数样例：

```http
GET /api/v1/admin/reviews?page=1&page_size=20 HTTP/1.1
```



#### 7.4.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_id | string \| null | 帖子 ID |
| data.records[].revision | integer | 帖子内容版本，从 1 开始 |
| data.records[].decision | string | pending / approved / returned / rejected / superseded |
| data.records[].content_snapshot | object | 不可变的该次提交完整内容 |
| data.records[].content_snapshot.post_type | string | lost / found |
| data.records[].content_snapshot.item_name | string | 物品名称 |
| data.records[].content_snapshot.campus | string | xiasha / shaoxing / wenyi |
| data.records[].content_snapshot.location | string | 具体地点 |
| data.records[].content_snapshot.event_date | string | 事件日期 YYYY-MM-DD |
| data.records[].content_snapshot.time_precision | string | date / exact / range |
| data.records[].content_snapshot.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.records[].content_snapshot.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.records[].content_snapshot.description | string | 完整物品描述 |
| data.records[].content_snapshot.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.records[].content_snapshot.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.records[].content_snapshot.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.records[].content_snapshot.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.records[].content_snapshot.contact_methods[].value | string | 联系方式内容 |
| data.records[].reviewer | object \| null | 审核人摘要，无审核人为 null；非空含 id/nickname |
| data.records[].reviewer.id | string | 处理人用户 ID，非空对象包含 |
| data.records[].reviewer.nickname | string | 处理人展示昵称，非空对象包含 |
| data.records[].reason | string \| null | 审核或管理原因，无决定为 null |
| data.records[].submitted_at | string | 提交时间 |
| data.records[].processed_at | string \| null | 审核处理时间，未处理为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "501",
        "post_id": "100",
        "revision": 1,
        "decision": "pending",
        "content_snapshot": {
          "post_type": "lost",
          "item_name": "校园卡",
          "campus": "xiasha",
          "location": "图书馆二楼",
          "event_date": "2026-10-02",
          "time_precision": "range",
          "event_time_start": "14:00",
          "event_time_end": "15:00",
          "description": "黑色卡套，里面有一张校园卡。",
          "images": [
            "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
          ],
          "contact_methods": [
            {
              "type": "wechat",
              "value": "example_wechat"
            }
          ]
        },
        "reviewer": null,
        "reason": null,
        "submitted_at": "2026-10-04T09:30:00+08:00",
        "processed_at": null
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：submitted_at ASC,id ASC。pending 默认仅返回可处理的当前版本、未撤回、未下架且作者启用并已验证的记录；历史决定筛选返回对应历史记录。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 7.5 后台审核记录详情查询

#### 7.5.1 基本信息

请求路径：`/api/v1/admin/reviews/{id}`  
请求方式：`GET`  
接口描述：后台审核记录详情查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.5.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/admin/reviews/501 HTTP/1.1
```



#### 7.5.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_id | string \| null | 帖子 ID |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.decision | string | pending / approved / returned / rejected / superseded |
| data.content_snapshot | object | 不可变的该次提交完整内容 |
| data.content_snapshot.post_type | string | lost / found |
| data.content_snapshot.item_name | string | 物品名称 |
| data.content_snapshot.campus | string | xiasha / shaoxing / wenyi |
| data.content_snapshot.location | string | 具体地点 |
| data.content_snapshot.event_date | string | 事件日期 YYYY-MM-DD |
| data.content_snapshot.time_precision | string | date / exact / range |
| data.content_snapshot.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.content_snapshot.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.content_snapshot.description | string | 完整物品描述 |
| data.content_snapshot.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.content_snapshot.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.content_snapshot.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.content_snapshot.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.content_snapshot.contact_methods[].value | string | 联系方式内容 |
| data.reviewer | object \| null | 审核人摘要，无审核人为 null；非空含 id/nickname |
| data.reviewer.id | string | 处理人用户 ID，非空对象包含 |
| data.reviewer.nickname | string | 处理人展示昵称，非空对象包含 |
| data.reason | string \| null | 审核或管理原因，无决定为 null |
| data.submitted_at | string | 提交时间 |
| data.processed_at | string \| null | 审核处理时间，未处理为 null |
| data.current_post | object | 当前帖子与作者状态摘要，与历史快照分开 |
| data.current_post.id | string | 资源 ID，十进制字符串 |
| data.current_post.revision | integer | 帖子内容版本，从 1 开始 |
| data.current_post.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.current_post.review_status | string | pending / approved / returned / rejected / removed |
| data.current_post.resolution_status | string | active / completed / withdrawn |
| data.current_post.author_id | string | 发布者 ID |
| data.current_post.author_status | string | 作者 active / disabled |
| data.current_post.author_is_verified | boolean | 作者是否已验证 |
| data.is_current | boolean | 该快照是否当前内容版本 |
| data.can_decide | boolean | 当前管理员是否可处理 |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "501",
    "post_id": "100",
    "revision": 1,
    "decision": "pending",
    "content_snapshot": {
      "post_type": "lost",
      "item_name": "校园卡",
      "campus": "xiasha",
      "location": "图书馆二楼",
      "event_date": "2026-10-02",
      "time_precision": "range",
      "event_time_start": "14:00",
      "event_time_end": "15:00",
      "description": "黑色卡套，里面有一张校园卡。",
      "images": [
        "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
      ],
      "contact_methods": [
        {
          "type": "wechat",
          "value": "example_wechat"
        }
      ]
    },
    "reviewer": null,
    "reason": null,
    "submitted_at": "2026-10-04T09:30:00+08:00",
    "processed_at": null,
    "current_post": {
      "id": "100",
      "revision": 1,
      "state_version": 1,
      "review_status": "pending",
      "resolution_status": "active",
      "author_id": "1001",
      "author_status": "active",
      "author_is_verified": true
    },
    "is_current": true,
    "can_decide": true,
    "etag": "\"review-501-post-v1\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "review-501-post-v1" |


业务说明：展示完整提交快照与当前帖子状态；is_current 表示该记录 revision 是否为当前内容版本，can_decide 综合未处理、版本、撤回及作者状态。ETag 绑定审核记录和当前帖子状态版本。

异常状态：404 RESOURCE_NOT_FOUND


### 7.6 后台作出审核决定

#### 7.6.1 基本信息

请求路径：`/api/v1/admin/reviews/{id}/decision`  
请求方式：`PUT`  
接口描述：后台作出审核决定。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 7.6.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| If-Match | Header | string | 是 | 传入所操作资源详情返回的 ETag，保留双引号；缺少返回 400，过期返回 412 |
| decision | Body | string | 是 | approved / returned / rejected |
| reason | Body | string | 条件必填 | 最多 500 字符；returned/rejected 必填 1–500，approved 可省略 |


请求参数样例：

```http
PUT /api/v1/admin/reviews/501/decision HTTP/1.1
If-Match: "review-501-post-v1"
```


```json
{
  "decision": "approved",
  "reason": "审核通过"
}
```


#### 7.6.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_id | string \| null | 帖子 ID |
| data.revision | integer | 帖子内容版本，从 1 开始 |
| data.decision | string | pending / approved / returned / rejected / superseded |
| data.reason | string \| null | 审核或管理原因，无决定为 null |
| data.processed_at | string \| null | 审核处理时间，未处理为 null |
| data.post_review_status | string | 决定后帖子的审核状态 |
| data.post_state_version | integer | 决定后帖子的状态版本 |
| data.post_etag | string | 帖子新的并发条件值 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "501",
    "post_id": "100",
    "revision": 1,
    "decision": "approved",
    "reason": "审核通过",
    "processed_at": "2026-10-04T09:30:00+08:00",
    "post_review_status": "approved",
    "post_state_version": 2,
    "post_etag": "\"post-100-v2\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "review-501-post-v2" |


业务说明：只处理当前 pending 版本且未撤回/下架、作者可发布。首次通过设置 first_published_at，重审保留原值。帖子/审核/通知/日志同事务。不批准历史快照覆盖新内容。前置条件过期 412，状态不可处理 409；客户端读取现有结果，不自动重复决定。

异常状态：409 STATE_CONFLICT；412 RESOURCE_CHANGED


## 8. 后台举报处理


### 8.1 后台举报列表查询

#### 8.1.1 基本信息

请求路径：`/api/v1/admin/reports`  
请求方式：`GET`  
接口描述：后台举报列表查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 8.1.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| status | Query | string | 否 | pending / handled / dismissed，默认 pending |
| post_id | Query | string | 否 | 帖子 ID，精确过滤 |


请求参数样例：

```http
GET /api/v1/admin/reports?page=1&page_size=20 HTTP/1.1
```



#### 8.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].post_id | string \| null | 帖子 ID |
| data.records[].post_revision | integer | 举报关联的内容版本 |
| data.records[].status | string | 当前资源状态，枚举见业务说明 |
| data.records[].created_at | string | 创建时间 |
| data.records[].reporter | object | 举报人摘要，仅管理员获得 |
| data.records[].reporter.id | string | 资源 ID，十进制字符串 |
| data.records[].reporter.nickname | string | 展示昵称 |
| data.records[].reason_type | string | 举报原因枚举 |
| data.records[].details | string | 举报补充说明 |
| data.records[].result_action | string \| null | none / remove_post / disable_user；未处理为 null |
| data.records[].handler | object \| null | 处理人摘要，未处理为 null |
| data.records[].handler.id | string | 处理人用户 ID，非空对象包含 |
| data.records[].handler.nickname | string | 处理人展示昵称，非空对象包含 |
| data.records[].handling_reason | string \| null | 处理原因，未处理为 null |
| data.records[].handled_at | string \| null | 处理时间，未处理为 null |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "601",
        "post_id": "100",
        "post_revision": 1,
        "status": "pending",
        "created_at": "2026-10-04T09:30:00+08:00",
        "reporter": {
          "id": "1002",
          "nickname": "演示用户乙"
        },
        "reason_type": "privacy",
        "details": "图片中包含完整校园卡信息",
        "result_action": null,
        "handler": null,
        "handling_reason": null,
        "handled_at": null
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：created_at ASC,id ASC；保留各举报人的独立记录，可按帖子过滤，不合并丢失处理结果。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 8.2 后台举报详情查询

#### 8.2.1 基本信息

请求路径：`/api/v1/admin/reports/{id}`  
请求方式：`GET`  
接口描述：后台举报详情查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 8.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/admin/reports/601 HTTP/1.1
```



#### 8.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.post_id | string \| null | 帖子 ID |
| data.post_revision | integer | 举报关联的内容版本 |
| data.status | string | 当前资源状态，枚举见业务说明 |
| data.created_at | string | 创建时间 |
| data.reporter | object | 举报人摘要，仅管理员获得 |
| data.reporter.id | string | 资源 ID，十进制字符串 |
| data.reporter.nickname | string | 展示昵称 |
| data.reason_type | string | 举报原因枚举 |
| data.details | string | 举报补充说明 |
| data.result_action | string \| null | none / remove_post / disable_user；未处理为 null |
| data.handler | object \| null | 处理人摘要，未处理为 null |
| data.handler.id | string | 处理人用户 ID，非空对象包含 |
| data.handler.nickname | string | 处理人展示昵称，非空对象包含 |
| data.handling_reason | string \| null | 处理原因，未处理为 null |
| data.handled_at | string \| null | 处理时间，未处理为 null |
| data.content_snapshot | object | 不可变的该次提交完整内容 |
| data.content_snapshot.post_type | string | lost / found |
| data.content_snapshot.item_name | string | 物品名称 |
| data.content_snapshot.campus | string | xiasha / shaoxing / wenyi |
| data.content_snapshot.location | string | 具体地点 |
| data.content_snapshot.event_date | string | 事件日期 YYYY-MM-DD |
| data.content_snapshot.time_precision | string | date / exact / range |
| data.content_snapshot.event_time_start | string \| null | 事件开始时间 HH:mm，不适用为 null |
| data.content_snapshot.event_time_end | string \| null | 事件结束时间 HH:mm，不适用为 null |
| data.content_snapshot.description | string | 完整物品描述 |
| data.content_snapshot.images | array | 有序 OSS Object Key 数组，仅作者/管理员可获 |
| data.content_snapshot.images[] | string | 按数组顺序返回的元素；图片字段为 Object Key 或平台读取地址，依字段说明 |
| data.content_snapshot.contact_methods | array | 联系方式数组，仅有权查看详情者可获 |
| data.content_snapshot.contact_methods[].type | string | 联系方式或通知的类型，取值见本接口说明 |
| data.content_snapshot.contact_methods[].value | string | 联系方式内容 |
| data.current_post | object | 当前帖子与作者状态摘要，与历史快照分开 |
| data.current_post.id | string | 资源 ID，十进制字符串 |
| data.current_post.revision | integer | 帖子内容版本，从 1 开始 |
| data.current_post.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.current_post.review_status | string | pending / approved / returned / rejected / removed |
| data.current_post.resolution_status | string | active / completed / withdrawn |
| data.current_post.author_id | string | 发布者 ID |
| data.current_post.author_status | string | 作者 active / disabled |
| data.current_post.author_is_verified | boolean | 作者是否已验证 |
| data.can_decide | boolean | 当前管理员是否可处理 |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "601",
    "post_id": "100",
    "post_revision": 1,
    "status": "pending",
    "created_at": "2026-10-04T09:30:00+08:00",
    "reporter": {
      "id": "1002",
      "nickname": "演示用户乙"
    },
    "reason_type": "privacy",
    "details": "图片中包含完整校园卡信息",
    "result_action": null,
    "handler": null,
    "handling_reason": null,
    "handled_at": null,
    "content_snapshot": {
      "post_type": "lost",
      "item_name": "校园卡",
      "campus": "xiasha",
      "location": "图书馆二楼",
      "event_date": "2026-10-02",
      "time_precision": "range",
      "event_time_start": "14:00",
      "event_time_end": "15:00",
      "description": "黑色卡套，里面有一张校园卡。",
      "images": [
        "posts/users/1001/550e8400-e29b-41d4-a716-446655440000.jpg"
      ],
      "contact_methods": [
        {
          "type": "wechat",
          "value": "example_wechat"
        }
      ]
    },
    "current_post": {
      "id": "100",
      "revision": 1,
      "state_version": 3,
      "review_status": "approved",
      "resolution_status": "active",
      "author_id": "1001",
      "author_status": "active",
      "author_is_verified": true
    },
    "can_decide": true,
    "etag": "\"report-601-pending\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "report-601-pending" |


业务说明：展示举报原版本快照与当前帖子状态，便于判断新内容是否仍需下架。报告不会漂移到新 revision。ETag 绑定举报当前处理状态。

异常状态：404 RESOURCE_NOT_FOUND


### 8.3 后台处理举报

#### 8.3.1 基本信息

请求路径：`/api/v1/admin/reports/{id}/decision`  
请求方式：`PUT`  
接口描述：后台处理举报。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 8.3.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| If-Match | Header | string | 是 | 传入所操作资源详情返回的 ETag，保留双引号；缺少返回 400，过期返回 412 |
| status | Body | string | 是 | handled 成立并处置 / dismissed 不成立 |
| result_action | Body | string | 是 | dismissed 必须 none；handled 必须 remove_post 或 disable_user |
| handling_reason | Body | string | 是 | 1–500 字符，非空 |
| expected_post_state_version | Body | integer | 条件必填 | remove_post 时必须提供当前帖子 state_version，其他省略 |


请求参数样例：

```http
PUT /api/v1/admin/reports/601/decision HTTP/1.1
If-Match: "report-601-pending"
```


```json
{
  "status": "handled",
  "result_action": "remove_post",
  "handling_reason": "确认图片泄露个人信息",
  "expected_post_state_version": 3
}
```


#### 8.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.status | string | 当前资源状态，枚举见业务说明 |
| data.result_action | string \| null | none / remove_post / disable_user；未处理为 null |
| data.handling_reason | string \| null | 处理原因，未处理为 null |
| data.handled_at | string \| null | 处理时间，未处理为 null |
| data.etag | string | 并发条件值，写请求原样放入 If-Match |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "601",
    "status": "handled",
    "result_action": "remove_post",
    "handling_reason": "确认图片泄露个人信息",
    "handled_at": "2026-10-04T09:30:00+08:00",
    "etag": "\"report-601-handled\""
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| ETag | "report-601-handled" |


业务说明：下架时当前帖子版本不符返回 409，不能自动处置新内容。禁用对象固定为被举报帖作者，且必须普通用户。目标已下架/禁用可结案，但不重复通知或递增版本。举报结果、状态变更、通知、日志同事务；不提供批量处理。

异常状态：403 FORBIDDEN（目标管理员）；409 STATE_CONFLICT；412 RESOURCE_CHANGED


## 9. 后台用户管理


### 9.1 后台用户列表查询

#### 9.1.1 基本信息

请求路径：`/api/v1/admin/users`  
请求方式：`GET`  
接口描述：后台用户列表查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 9.1.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| account_no | Query | string | 否 | 模拟学号/职工号精确匹配，最多 32 字符 |
| nickname | Query | string | 否 | 昵称包含匹配，最多 50 字符 |
| status | Query | string | 否 | active / disabled |
| identity_type | Query | string | 否 | student / staff |


请求参数样例：

```http
GET /api/v1/admin/users?page=1&page_size=20 HTTP/1.1
```



#### 9.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].account_no | string | 模拟学号/职工号，仅本人或管理员可见 |
| data.records[].identity_type | string | student / staff |
| data.records[].nickname | string | 展示昵称 |
| data.records[].avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.records[].role | string | user / admin |
| data.records[].is_verified | boolean | 模拟校园身份是否已验证 |
| data.records[].must_change_password | boolean | 是否必须先改密 |
| data.records[].wechat_bound | boolean | 是否绑定微信 |
| data.records[].wechat_bound_at | string \| null | 微信绑定时间，无绑定为 null |
| data.records[].status | string | 当前资源状态，枚举见业务说明 |
| data.records[].created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "1001",
        "account_no": "25000001",
        "identity_type": "student",
        "nickname": "演示同学",
        "avatar_url": "/static/avatars/default.png",
        "role": "user",
        "is_verified": true,
        "must_change_password": false,
        "wechat_bound": false,
        "wechat_bound_at": null,
        "status": "active",
        "created_at": "2026-10-04T09:30:00+08:00"
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：created_at DESC,id DESC；账号及身份仅管理员可见，不返回密码哈希、OpenID、登录版本或令牌。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 9.2 后台用户详情查询

#### 9.2.1 基本信息

请求路径：`/api/v1/admin/users/{id}`  
请求方式：`GET`  
接口描述：后台用户详情查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 9.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/admin/users/1001 HTTP/1.1
```



#### 9.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.account_no | string | 模拟学号/职工号，仅本人或管理员可见 |
| data.identity_type | string | student / staff |
| data.nickname | string | 展示昵称 |
| data.avatar_url | string \| null | 预置头像地址，无头像时 null |
| data.role | string | user / admin |
| data.is_verified | boolean | 模拟校园身份是否已验证 |
| data.must_change_password | boolean | 是否必须先改密 |
| data.wechat_bound | boolean | 是否绑定微信 |
| data.wechat_bound_at | string \| null | 微信绑定时间，无绑定为 null |
| data.status | string | 当前资源状态，枚举见业务说明 |
| data.created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "1001",
    "account_no": "25000001",
    "identity_type": "student",
    "nickname": "演示同学",
    "avatar_url": "/static/avatars/default.png",
    "role": "user",
    "is_verified": true,
    "must_change_password": false,
    "wechat_bound": false,
    "wechat_bound_at": null,
    "status": "active",
    "created_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


业务说明：返回模拟账号、角色、启用与验证状态、昵称、头像、绑定状态、创建时间，不暴露微信标识或凭证。

异常状态：404 RESOURCE_NOT_FOUND


### 9.3 后台禁用普通用户

#### 9.3.1 基本信息

请求路径：`/api/v1/admin/users/{id}/status`  
请求方式：`PATCH`  
接口描述：后台禁用普通用户。  
访问权限：管理员，仅普通用户可被处置。  
成功状态：HTTP 200。

#### 9.3.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| status | Body | string | 是 | 仅允许 disabled |
| reason | Body | string | 是 | 处置原因，1–500 字符，非纯空白 |


请求参数样例：

```http
PATCH /api/v1/admin/users/1001/status HTTP/1.1
```


```json
{
  "status": "disabled",
  "reason": "多次发布虚假信息"
}
```


#### 9.3.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.status | string | 当前资源状态，枚举见业务说明 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "1001",
    "status": "disabled"
  },
  "request_id": "req_demo_001"
}
```


业务说明：首次禁用原子更新状态、递增 token_version、记录日志与通知；已有帖子通过作者状态过滤隐藏，原审核结论保留。同状态不重复增版本/通知。不允许禁用管理员，无恢复启用入口。

异常状态：403 FORBIDDEN；404 RESOURCE_NOT_FOUND


### 9.4 后台重置普通用户密码

#### 9.4.1 基本信息

请求路径：`/api/v1/admin/users/{id}/password-resets`  
请求方式：`POST`  
接口描述：后台重置普通用户密码。  
访问权限：管理员，仅普通用户可被重置。  
成功状态：HTTP 201。

#### 9.4.2 请求参数

请求数据格式：application/json。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |
| reason | Body | string | 是 | 处置原因，1–500 字符，非纯空白 |


请求参数样例：

```http
POST /api/v1/admin/users/1001/password-resets HTTP/1.1
```


```json
{
  "reason": "演示用户忘记密码"
}
```


#### 9.4.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.user_id | string | 用户 ID |
| data.must_change_password | boolean | 是否必须先改密 |
| data.temporary_password | string | 仅本次重置响应的一次性临时密码，不落库或日志 |
| data.operation_log_id | string | 本次重置操作日志 ID |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "user_id": "1001",
    "must_change_password": true,
    "temporary_password": "<本次生成的随机临时密码>",
    "operation_log_id": "9001"
  },
  "request_id": "req_demo_001"
}
```


成功响应头：

| 响应头 | 示例值 |
| --- | --- |
| Location | /api/v1/admin/operation-logs/9001 |


业务说明：生成满足 8–32 字符的随机临时密码，仅本次授权响应交付；存 Argon2id 哈希、强制改密=true 并递增版本，通知/日志不包含明文。客户端不自动重试；响应丢失后明确再重置，前次密码失效。初次临时密码登录仅允许改密、退出、必要 CSRF。禁止重置管理员。

异常状态：403 FORBIDDEN；404 RESOURCE_NOT_FOUND


## 10. 后台操作记录


### 10.1 后台操作记录列表查询

#### 10.1.1 基本信息

请求路径：`/api/v1/admin/operation-logs`  
请求方式：`GET`  
接口描述：后台操作记录列表查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 10.1.2 请求参数

请求数据格式：Query，无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Query | integer | 否 | 页码，默认 1，最小 1 |
| page_size | Query | integer | 否 | 每页条数，默认 20，范围 1–50 |
| operator_id | Query | string | 否 | 管理员用户 ID |
| action | Query | string | 否 | approve_post / return_post / reject_post / remove_post / handle_report / dismiss_report / disable_user / reset_password |
| target_post_id | Query | string | 否 | 目标帖子 ID |
| target_user_id | Query | string | 否 | 目标用户 ID |
| created_from | Query | string | 否 | RFC3339 时间，下界包含 |
| created_to | Query | string | 否 | RFC3339 时间，上界不包含，不小于下界 |


请求参数样例：

```http
GET /api/v1/admin/operation-logs?page=1&page_size=20 HTTP/1.1
```



#### 10.1.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.total | integer | 符合筛选的总记录数 |
| data.page | integer | 当前页码 |
| data.page_size | integer | 每页条数 |
| data.records | array | 本页记录，空页为空数组 |
| data.records[].id | string | 资源 ID，十进制字符串 |
| data.records[].operator | object | 管理员摘要 |
| data.records[].operator.id | string | 资源 ID，十进制字符串 |
| data.records[].operator.nickname | string | 展示昵称 |
| data.records[].action | string | 操作类型 |
| data.records[].target_user_id | string \| null | 目标用户 ID，无目标为 null |
| data.records[].target_post_id | string \| null | 目标帖子 ID，无目标为 null |
| data.records[].target_report_id | string \| null | 目标举报 ID，无目标为 null |
| data.records[].reason | string \| null | 审核或管理原因，无决定为 null |
| data.records[].state_before | object | 操作前白名单状态摘要，不含凭证或联系方式 |
| data.records[].state_before.review_status | string | pending / approved / returned / rejected / removed |
| data.records[].state_before.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.records[].state_after | object | 操作后白名单状态摘要，不含凭证或联系方式 |
| data.records[].state_after.review_status | string | pending / approved / returned / rejected / removed |
| data.records[].state_after.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.records[].created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "total": 1,
    "page": 1,
    "page_size": 20,
    "records": [
      {
        "id": "9001",
        "operator": {
          "id": "1",
          "nickname": "演示管理员"
        },
        "action": "approve_post",
        "target_user_id": "1001",
        "target_post_id": "100",
        "target_report_id": null,
        "reason": "审核通过",
        "state_before": {
          "review_status": "pending",
          "state_version": 1
        },
        "state_after": {
          "review_status": "approved",
          "state_version": 2
        },
        "created_at": "2026-10-04T09:30:00+08:00"
      }
    ]
  },
  "request_id": "req_demo_001"
}
```


业务说明：created_at DESC,id DESC。状态快照仅包含状态、版本等白名单信息，不复制联系方式、密码哈希或令牌。时间统一解析后按 UTC 查询。

异常状态：参数、认证、权限及服务故障按 1.3 返回。


### 10.2 后台操作记录详情查询

#### 10.2.1 基本信息

请求路径：`/api/v1/admin/operation-logs/{id}`  
请求方式：`GET`  
接口描述：后台操作记录详情查询。  
访问权限：管理员。  
成功状态：HTTP 200。

#### 10.2.2 请求参数

请求数据格式：无请求体。认证请求头/Cookie、网页修改请求的 CSRF 规则见 1.2。

参数说明：


| 参数名 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Path | string | 是 | 资源 ID，十进制字符串 |


请求参数样例：

```http
GET /api/v1/admin/operation-logs/9001 HTTP/1.1
```



#### 10.2.3 响应数据


响应数据格式：application/json。

响应参数说明：


| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| code | integer | 成功固定为 1，失败见公共错误码 |
| msg | string | 结果提示，不能作为分支判断依据 |
| data | object | 本接口业务数据，无数据为 null |
| request_id | string | 服务端生成的请求追踪 ID |
| data.id | string | 资源 ID，十进制字符串 |
| data.operator | object | 管理员摘要 |
| data.operator.id | string | 资源 ID，十进制字符串 |
| data.operator.nickname | string | 展示昵称 |
| data.action | string | 操作类型 |
| data.target_user_id | string \| null | 目标用户 ID，无目标为 null |
| data.target_post_id | string \| null | 目标帖子 ID，无目标为 null |
| data.target_report_id | string \| null | 目标举报 ID，无目标为 null |
| data.reason | string \| null | 审核或管理原因，无决定为 null |
| data.state_before | object | 操作前白名单状态摘要，不含凭证或联系方式 |
| data.state_before.review_status | string | pending / approved / returned / rejected / removed |
| data.state_before.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.state_after | object | 操作后白名单状态摘要，不含凭证或联系方式 |
| data.state_after.review_status | string | pending / approved / returned / rejected / removed |
| data.state_after.state_version | integer | 帖子状态版本，从 1 开始，变化递增 |
| data.created_at | string | 创建时间 |

响应数据样例：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "id": "9001",
    "operator": {
      "id": "1",
      "nickname": "演示管理员"
    },
    "action": "approve_post",
    "target_user_id": "1001",
    "target_post_id": "100",
    "target_report_id": null,
    "reason": "审核通过",
    "state_before": {
      "review_status": "pending",
      "state_version": 1
    },
    "state_after": {
      "review_status": "approved",
      "state_version": 2
    },
    "created_at": "2026-10-04T09:30:00+08:00"
  },
  "request_id": "req_demo_001"
}
```


业务说明：展示操作者、动作、目标、原因、前后状态和时间；记录只读，不提供修改或删除接口。

异常状态：404 RESOURCE_NOT_FOUND
