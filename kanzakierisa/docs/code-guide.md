# 代码说明文档

> 面向「第一次打开这个仓库的人」：先讲清**整体结构**与**数据怎么流**，
> 再逐条说明**关键实现为什么这么写**。
>
> 全文分两部分：
> - **第一部分（一～六章）**是本项目的完整技术说明，按「概览 → 目录 → 数据库 →
>   关键实现 → 安全 → 限制」组织，与 SPEC 的章节一一对应；
> - **第二部分（附录）**是按开发阶段累积的「面试可讲点」明细（P1 / P3 / P5 / P6），
>   包含大量踩坑记录与取舍理由，可作为第一部分的展开阅读。
>
> 如果你只有 10 分钟，读第一部分的一、四、五章即可抓住全貌。

---

# 第一部分 · 项目技术说明

## 一、项目概览

### 1.1 这是什么

一个校园失物招领平台。核心业务闭环是：

```
发帖（失物 / 招领） → 浏览 / 搜索 / 筛选 → 提交认领申请 → 帖主审核
      → 生成 6 位电子凭证码 → 线下见面核销 → 帖子自动结束 → 领取「拾金不昧证书」
```

「认领」是整个系统里唯一有多人竞争、有状态流转、有权限不对称的链条，
也是技术密度最高的部分。

### 1.2 技术栈与选型理由

| 层 | 选型 | 为什么 |
| --- | --- | --- |
| 后端框架 | Go 1.27 + Gin | 任务指定；Gin 中间件模型清晰，便于把鉴权/日志/CORS 分层 |
| 数据访问 | `database/sql` + `sqlx` | **任务硬要求：手写参数化 SQL，禁用 ORM**。sqlx 只做「结果集 → 结构体」的映射，不生成 SQL |
| 数据库 | MySQL 8.0 | 任务指定；生成列、JSON 列、`FOR UPDATE` 都用到了 |
| 认证 | JWT HS256 + bcrypt(cost=10) | 无状态、易水平扩展；bcrypt 自带盐与可调成本 |
| 前端 | Vue 3（`<script setup>`）+ Vite + Vant 4 | 移动端优先；Vant 的组件与「校园随手拍」的使用场景吻合 |
| 状态管理 | Pinia | 只有「当前用户」一个全局状态，Pinia 足够且比 Vuex 简洁 |
| HTTP 客户端 | Axios | 需要请求/响应双拦截器（注入 token、统一翻译错误码） |

> **为什么不用 ORM**：本项目刻意练习手写 SQL。具体收益在三处体现得最明显：
> ① 联系方式可见性用 `CASE WHEN ... EXISTS (...)` 下推（ORM 很难表达）；
> ② `COUNT(*)` 与 `SELECT` 复用同一个 WHERE 构造器（跨查询复用条件）；
> ③ 唯一索引冲突要按**索引名**翻译成不同业务码（ORM 通常只抛一个笼统的约束错误）。

### 1.3 分层职责

**依赖单向向下，不允许反向 import。**

```
       ┌──────────────────────────────────────────────┐
       │                     main                     │  ← 启动、优雅关闭
       └───────────────────────┬──────────────────────┘
                               ▼
       ┌──────────────────────────────────────────────┐
       │                    router                    │  ← 唯一的路由真源；中间件顺序；依赖装配
       └──────────┬───────────────────────┬───────────┘
                  ▼                       ▼
       ┌────────────────────┐   ┌────────────────────┐
       │     middleware     │   │      handler       │  ← HTTP 编解码 + 参数校验，**零 SQL**
       └──────────┬─────────┘   └─────────┬──────────┘
                  │                       ▼
                  │            ┌────────────────────┐
                  │            │      service       │  ← 业务规则（状态机 / 可见性 / 打分 / 事务编排）
                  │            └─────────┬──────────┘
                  │                      ▼
                  │            ┌────────────────────┐
                  └───────────▶│       store        │  ← 手写参数化 SQL，**零 HTTP 概念**
                               └─────────┬──────────┘
                                         ▼
                                  database/sql + sqlx
```

三条硬规矩：

| 层 | 能做 | **不做** |
| --- | --- | --- |
| `handler` | 解 JSON、解析路径/查询参数、调 service、写响应 | 不写 SQL、不做业务判断 |
| `service` | 业务规则、校验顺序、事务编排、错误码语义 | 不碰 `gin.Context`、不拼 SQL 字符串 |
| `store` | 参数化 SQL、1062 冲突翻译、行数上报 | 不 import `gin`、不决定「该报哪个业务码」 |

**一个具体的反向依赖规避**：`middleware.Auth` 需要「按 id 回查用户」，
若直接依赖 `*service.AuthService`，依赖图就会出现 `router → middleware → service`
这条额外连线，破坏「单向向下」。因此 middleware 里定义了两个窄接口：

```go
type TokenParser interface { Parse(token string) (int64, error) }
type UserLoader interface { Authenticate(c *gin.Context, userID int64) (*model.User, error) }
```

再由 `router` 里的 `authLoader` 适配器把 `AuthService` 接上去：

```go
type authLoader struct{ svc *service.AuthService }
var _ middleware.UserLoader = (*authLoader)(nil)   // 编译期断言
```

收益：中间件可独立单测（塞个假 parser 即可），依赖图保持树状不成环。

### 1.4 一次请求的完整流转

以「**登录用户 alice 打开某张 found 帖的详情页**」为例，走一遍全链路：

```
浏览器 GET /api/posts/12  (Authorization: Bearer eyJ...)
   │
   ▼ ① Vite dev proxy（5173 → 8080，仅开发期，规避跨域）
   ▼
┌─ Gin Engine ────────────────────────────────────────────────┐
│ ② RequestID 中间件   → 生成/透传 X-Request-ID，写入日志上下文  │
│ ③ Logger             → 记录 method / path / status / 耗时     │
│ ④ Recover            → panic 兜底，转成 5000，不让进程退出     │
│ ⑤ CORS               → 非生产环境按来源放行（回环 + 私网）      │
│ ⑥ OptionalAuth       → 软鉴权：解析 Bearer，失败也放行         │
│      └ Parse(token) → uid                                    │
│      └ Authenticate(ctx, uid) → 回查 users 表                │
│      └ 成功 → c.Set("currentUser", u)；失败 → 保持游客        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ PostHandler.Detail ────────────────────────────────────────┐
│ ⑦ parseIDParam(c,"id")  → 非正整数即 1001                     │
│ ⑧ 从 context 取 user（可能是 nil = 游客）                     │
│ ⑨ 调 PostService.GetDetail(ctx, postID, viewer)              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ PostService.GetDetail ─────────────────────────────────────┐
│ ⑩ 取 viewerID（游客传 0）                                     │
│ ⑪ 调 store.GetByID(ctx, postID, viewerID, withContact=true)  │
│      └ 若返回 sql.ErrNoRows → 翻译成 1004                     │
│ ⑫ viewOf(c, inList=false) 组装 PostView（含 can_edit/can_claim）│
│ ⑬ 若已登录，再查 my_claim（当前用户在这张帖上的申请）           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ PostStore.GetByID ─────────────────────────────────────────┐
│ ⑭ SELECT ... (contactCaseSQL 决定 contact 是否返回真实值)     │
│     FROM posts p JOIN users u ON u.id = p.user_id            │
│     WHERE p.id = ?                                           │
│     ↑ 一条 SQL 同时产出 contact 与 contact_visible 的判定依据  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
        ⑮ ToPostDTO() → 白名单式裁剪（无 password_hash）
        ⑯ response.OK(c, dto) → {"code":0,"message":"ok","data":{...}}
```

几个值得注意的点：

- **第 ⑥ 步失败不报错**：软鉴权在 token 失效时静默降级为游客，而不是返回 1002。
  理由见 [第二章的中间件表](#23-中间件middleware)。
- **第 ⑦ 步是唯一的 400 来源**：查询参数（分页越界、枚举非法）一律容错，
  只有路径参数非法才报 1001。
- **第 ⑭ 步是隐私的关键**：联系方式是否进入应用内存，由 SQL 决定，
  不是查出来再删。详见 [五、安全措施](#五安全措施)。

---

## 二、目录结构

### 2.1 顶层

```
kanzakierisa/
├── README.md              项目说明、启动步骤、测试账号、设计思考
├── docs/
│   ├── api.md             19 个接口的完整契约（请求/响应/错误码）
│   ├── code-guide.md      本文件
│   ├── wireframe/         页面线框
│   └── screenshots/       浏览器走查截图（p5/ 56 张、p6/ 30 张）
├── server/                后端（Go）
└── web/                   前端（Vue 3 + Vite）
```

### 2.2 后端 `server/`

```
server/
├── cmd/api/main.go                    入口：加载配置 → 建连接池 → 组装路由 → 优雅关闭
├── internal/
│   ├── config/config.go               .env 加载与校验；DSN 拼装（固定 loc=UTC）
│   ├── db/db.go                       连接池参数、Ping、时区设置
│   ├── router/router.go               ★ 唯一的路由真源 + 依赖装配
│   ├── middleware/
│   │   ├── requestid.go               注入 X-Request-ID
│   │   ├── recover.go                 panic 兜底 → 5000
│   │   ├── cors.go                    按来源放行（回环 + 私网）
│   │   ├── auth.go                    强制鉴权 + CurrentUser(c)
│   │   └── optional_auth.go           软鉴权（失败放行为游客）
│   ├── handler/                       HTTP 编解码层（零 SQL）
│   │   ├── auth_handler.go            register / login / logout
│   │   ├── user_handler.go            GET me / PATCH me
│   │   ├── post_handler.go            创建/列表/详情/更新/删除/状态流转/我的帖子
│   │   ├── upload_handler.go          图片上传（体积 → 扩展名 → 魔数）
│   │   ├── claim_handler.go           提交/查看/审核/核销/我的认领
│   │   └── match_handler.go           智能匹配
│   ├── service/                       业务规则层
│   │   ├── validator.go               用户名/密码/帖子字段/认领证明的长度与格式校验
│   │   ├── auth_service.go            注册、登录、鉴权回查
│   │   ├── user_service.go            查自己、改自己
│   │   ├── post_service.go            帖子 CRUD + 状态机（导出 ValidateTransition）
│   │   ├── claim_service.go           认领校验顺序、审核、核销、凭证码重试
│   │   └── match_service.go           SPEC 7.4 打分与排序
│   ├── store/                         手写 SQL 层（零 HTTP）
│   │   ├── querier.go                 Querier 接口：抹平「连接池 or 事务」的差异
│   │   ├── user_store.go              users 表 SQL
│   │   ├── post_store.go              posts 表 SQL + 联系方式可见性 CASE
│   │   └── claim_store.go             claims 表 SQL + 1062 按索引名翻译
│   ├── model/                         实体与 DTO
│   │   ├── user.go                    User / UserDTO / 三个请求体
│   │   ├── post.go                    Post / PostDTO / AuthorBrief / CreatePostReq ...
│   │   ├── claim.go                   Claim / ClaimDTO / MyClaimDTO / 三个请求体
│   │   └── errors_helper.go           MySQL 1062 判定 + 索引名常量
│   └── pkg/                           无状态工具包（纯函数，可独立单测）
│       ├── apperr/                    统一错误类型 + 13 个错误码
│       ├── response/                  统一响应信封
│       ├── jwtutil/                   HS256 签发/解析（算法白名单）
│       ├── password/                  bcrypt 封装
│       ├── pagination/                分页参数解析与夹取
│       ├── valid/                     枚举白名单 + 状态机白名单
│       ├── voucher/                   6 位凭证码生成/规范化/形态校验
│       └── similar/                   中文 2-gram 相似度
├── sql/
│   ├── schema.sql                     建库建表（含 approved_flag 生成列）
│   └── seed.sql                       3 用户 + 16 帖 + 2 认领的演示数据
├── Makefile                           run/build/vet/test/schema/seed/up/down
├── docker-compose.yml                 MySQL 8.0 一键起（方式 A）
├── .env.example                       配置模板（.env 已被 gitignore）
└── uploads/                           图片落盘目录（内容不入库，仅留 .gitkeep）
```

`pkg/` 与 `internal/` 的分界标准：**能不能不依赖任何本项目其它包单独测试**。
`apperr`、`similar`、`voucher`、`pagination` 都满足，因此它们是纯函数，
不持有任何状态。

### 2.3 前端 `web/`

```
web/
├── index.html
├── vite.config.js          alias @ → src；dev 与 preview 各配一份 proxy
└── src/
    ├── main.js             createApp + Pinia + Router + Vant 全量注册
    ├── App.vue             根组件（<router-view>）
    ├── router/index.js     8 条路由 + 全局前置守卫（需登录的页面拦截）
    ├── store/user.js       Pinia：当前用户、token、登录/登出动作
    ├── api/
    │   ├── request.js      Axios 实例；双拦截器（注入 token / 翻译错误码）
    │   ├── auth.js         注册 / 登录 / 登出
    │   ├── user.js         GET me / PATCH me
    │   ├── post.js         帖子 7 个接口
    │   ├── upload.js       上传（刻意不设 Content-Type）
    │   └── claim.js        认领 5 个接口 + 匹配接口
    ├── constants/index.js  枚举、MAX_IMAGES=3、MAX_IMAGE_MB=2
    ├── utils/format.js     时间 UTC→本地、状态/类型/分类的中文映射
    ├── components/
    │   ├── PostCard.vue            列表卡片
    │   ├── PostForm.vue            发布/编辑共用表单
    │   ├── ImageUploader.vue       图片上传（对象数组↔URL 数组）
    │   ├── StatusActionSheet.vue   状态流转弹层
    │   ├── ClaimCard.vue           认领卡（manage / mine 双模式）
    │   ├── MatchList.vue           匹配推荐区块
    │   ├── HonorCertificate.vue    拾金不昧证书（canvas 导出 PNG）
    │   └── EmptyState.vue          空态
    └── pages/
        ├── PostListPage.vue        首页：搜索 / 筛选 / 无限滚动
        ├── PostDetailPage.vue      详情：轮播 / 认领 / 匹配 / 作者操作
        ├── PostCreatePage.vue      发布
        ├── PostEditPage.vue        编辑（can_edit 守卫）
        ├── ClaimManagePage.vue     帖主审核台
        ├── MyClaimsPage.vue        我的认领
        ├── MePage.vue              个人中心
        └── LoginPage.vue           登录 / 注册
```

**前端状态的一条原则**：服务端下发的 DTO 是唯一真相。
组件不本地「猜」新状态（比如审核成功后不把 `status` 直接改成 `approved`），
而是 `emit('success')` 让父页面**重新拉取**，以后端落库结果为准。

---

## 三、数据库设计

### 3.1 表关系

```
users ──1:N──▶ posts ──1:N──▶ claims
  ▲                              │
  └──────────1:N─────────────────┘   (claimant_id)
```

三张表，两个外键都是 `ON DELETE CASCADE`：

- 删用户 → 其帖子与其发出的认领一并清理
- 删帖子 → 该帖下的认领一并清理（应用层**不写任何删 claims 的 SQL**）

### 3.2 表结构要点

#### users

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `username` | VARCHAR(32) | `UNIQUE KEY uk_username`；格式由 Go 侧正则约束 |
| `password_hash` | VARCHAR(100) | bcrypt 结果固定 60 字符，留足余量；**绝不出现在任何 API 响应里** |
| `contact` / `contact_public` | VARCHAR(64) / TINYINT | 联系方式的「值」与「是否公开」分离存储 |
| `role` | VARCHAR(16) | `user` / `admin`；**不放进 JWT**，每次回查数据库 |

#### posts

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `type` | VARCHAR(8) | `lost` / `found`，用 CHECK 语义由 `valid` 包保证 |
| `images` | JSON | 存 URL 字符串数组；空时是 `[]` 而非 NULL |
| `status` | VARCHAR(16) | `open` / `matched` / `closed` |
| — | 索引 | `idx_type_status(type,status)`、`idx_category`、`idx_created`、`idx_user` |

四个索引都是照着查询写的：列表筛选走 `idx_type_status`，时间排序走 `idx_created`，
「我的帖子」走 `idx_user`，匹配的候选集查询走 `idx_type_status`。

#### claims

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `status` | VARCHAR(16) | `pending` / `approved` / `rejected` / `redeemed` |
| `voucher_code` | VARCHAR(16) NULL | `UNIQUE KEY uk_voucher_code`；未通过时为 NULL |
| `reject_reason` | VARCHAR(255) | 超长按 rune 截断 |
| `approved_flag` | **生成列** | 见下 |
| — | 唯一索引 | `uk_post_claimant(post_id, claimant_id)`、`uk_post_approved(post_id, approved_flag)` |

### 3.3 核心亮点：用生成列 + 唯一索引表达「最多一条已通过认领」

**业务约束**：一张帖子最多只能有一条「已通过」的认领记录。

**应用层写法为什么不行**：「先 `SELECT` 有没有 approved，没有就 `INSERT`」在并发下必然失效 ——
两个请求同时查到「没有」，然后双双插入。这不是理论问题：认领正是
「多个同学同时抢一个失物」的场景，天然高并发。

**数据库解法**：MySQL 8 没有「部分索引」（只对满足条件的行建索引），
但可以用**生成列 + 唯一索引**绕出来：

```sql
approved_flag TINYINT GENERATED ALWAYS AS (
  IF(status IN ('approved','redeemed'), 1, NULL)
) STORED,
UNIQUE KEY uk_post_approved (post_id, approved_flag)
```

原理：`status` 是 `approved`/`redeemed` 时 `approved_flag = 1`，否则是 `NULL`。
而 **MySQL 的唯一索引允许任意多个 `NULL`**（`NULL != NULL`），于是：

| 情形 | `(post_id, approved_flag)` | 是否冲突 |
| --- | --- | --- |
| 同一帖多条 `pending` | `(5, NULL)`、`(5, NULL)`、… | 不冲突 ✅ |
| 同一帖多条 `rejected` | `(5, NULL)`、`(5, NULL)`、… | 不冲突 ✅ |
| 同一帖第二条 `approved` | `(5, 1)` 已存在 → 再插 `(5, 1)` | **冲突** ❌ |

两个设计细节：

1. **`redeemed` 也计入 `1`**。如果只把 `approved` 映射成 `1`，
   那么核销后认领离开 `approved` 态，就会腾出一个 `(post_id, 1)` 的空位，
   让第二条申请能通过 —— 交接已完成还允许再通过一条，这是明确的 bug。
2. **`STORED` 而非 `VIRTUAL`**：唯一索引可以建在两者之上，
   但 `STORED` 的取舍是为可读性 —— 直接用 `SELECT approved_flag` 就能肉眼验证规则。

实测确认（seed 数据）：

```
ERROR 1062 (23000): Duplicate entry '5-1' for key 'claims.uk_post_approved'
```

这条约束连「有人绕过应用层直接写库」都挡住了 ——
**把业务不变量变成数据库约束，比任何应用层检查都可靠**。

### 3.4 三处时间处理的一致性

| 位置 | 设置 | 解决什么 |
| --- | --- | --- |
| `schema.sql` 开头 | `SET time_zone = '+00:00'` | 直接用 SQL 导入时，`DEFAULT CURRENT_TIMESTAMP` 按 UTC 求值 |
| 应用 DSN | `parseTime=true&loc=UTC&time_zone='+00:00'` | 连接会话时区固定 UTC，Go 按 UTC 解析 |
| Go 输出层 | `time.Format(time.RFC3339)` | 不依赖 json 包对 `time.Time` 的默认序列化 |
| Go 写入层 | `time.Now().UTC().Truncate(time.Second)` | 不用 SQL 的 `NOW()`（它返回会话时区的墙上时间） |

**原则：时间只从一处产生、只以一种时区存储。** 四处任一失效都会造成「差 8 小时」。
详见 [附录 P3 第 5 点](#5-updated_at-为什么不交给-sql-的-now)。

---

## 四、关键实现思路

本章按 SPEC 第 7 章的编号逐节展开。每节统一用「**问题 → 解决 → 为什么**」三段。

### 4.1 状态机（SPEC 7.1）

**问题**：帖子有 `open → matched → closed` 的流转，且存在两条路径可以改变它：
作者手动点按钮、认领流程自动联动。如果两处各写一套规则，迟早分叉。

**解决**：白名单只定义一次，并**导出**。

```go
// internal/pkg/valid/valid.go
var allowedTransitions = map[string][]string{
    StatusOpen:    {StatusMatched, StatusClosed},
    StatusMatched: {StatusClosed},
    StatusClosed:  {},   // 终态：空切片 = 没有出边
}
```

```go
// internal/service/post_service.go —— 刻意首字母大写
func ValidateTransition(from, to string) error

// 两条路径共用一个核心
ChangeStatus         // 作者手动：加一层作者校验，再调 applyStatusChange
changeStatusAsSystem // 系统自动：不加作者校验，直接调 applyStatusChange
```

**为什么**：认领流程（P6）在 `approve` / `redeem` 时要触发帖子状态变化，
必须复用这同一个函数。若在 `claim_service` 里再写一份规则表，
两份定义迟早分叉 —— 那正是状态机最典型的失效方式：
**手动流转拦得住的非法跳转，自动流转却放过去了**。

配套的两个细节：

- **乐观锁**：`UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND status = ?`。
  末尾的 `AND status = ?` 保证并发改状态时，后到的请求更新 0 行 → 返回 1007，
  而不是静默覆盖。
- **校验顺序固定**：`1001（枚举）→ 1004（存在）→ 1003（作者）→ 1007（白名单）`。
  权限检查排在状态检查之前，越权者稳定拿到 403，不会因为「恰好状态也不允许」
  而拿到 1007 —— 那等于把帖子当前状态泄露给了无权操作它的人。

### 4.2 联系方式三级可见性（SPEC 7.2）

**问题**：`author.contact` 是否可见，取决于请求者身份与业务关系（四条规则）；
且 SPEC 硬要求**在 SQL 层决定是否 SELECT**，不能查出来再在内存里删。

**解决**：把整条判定写进 SELECT 列表的一个 `CASE` 表达式。

```sql
CASE
  WHEN ? = p.user_id                        THEN u.contact   -- ① 本人
  WHEN u.contact_public = 1                 THEN u.contact   -- ② 作者主动公开
  WHEN EXISTS (SELECT 1 FROM claims c                       -- ③ 已通过的认领关系
               WHERE c.post_id = p.id
                 AND c.claimant_id = ?
                 AND c.status IN ('approved','redeemed'))
                                            THEN u.contact
  ELSE ''
END AS author_contact
```

**为什么**：两个不可替代的收益。

1. **不进入应用内存**：不可见时数据库直接返回空串，真实联系方式从未离开数据库。
   这不是「查出来再删掉」——后者的数据已经进过 Go 的内存、可能进日志、可能进 panic 栈。
2. **不可能自相矛盾**：`contact` 与 `contact_visible` 出自**同一条 SQL 语句**，
   因此不可能出现 `contact_visible=true` 但 `contact=""` 这类响应。
   如果可见性在 SQL 里算、联系方式在 Go 里清空，一旦有人只改了一边就会出现这种响应。

**列表接口更进一步**：`GET /api/posts` 与 `GET /api/users/me/posts` 干脆
**不 SELECT 这一列**（`author.contact` 恒为 `""`）。
一次批量查询里少带走一批联系方式 —— 列表页从不展示它，多查一列只是白白扩大泄露面。

实现上用一个「列清单函数」保证详情与列表不跑偏：

```go
func postSelectColumns(withContact bool, viewerID int64) string   // 同一份列清单
func postSelectArgs(withContact bool, viewerID int64) []any       // 孪生函数，参数顺序对齐
```

若两处各写一份列清单，迟早出现「一边多查了一列、另一边忘了加」。

`model.ToPostDTO` 里还有一层「列表强制空串」的收窄，作为**纵深防御** ——
将来谁改了 store 的 SELECT 清单，「列表不泄露联系方式」这条规则也不会失守。

### 4.3 认领流程与凭证（SPEC 7.3）

**问题**：认领是一个「多人竞争、有状态流转、有权限不对称」的流程，
且要在并发下保证业务不变量。

**解决**：四层防护叠加。

| 层 | 手段 | 拦什么 |
| --- | --- | --- |
| 入口预检 | `service.Apply` 固定 7 步校验顺序 | 给出友好错误文案（1001/1004/1007/1008/1010） |
| 数据库约束 | `uk_post_claimant`、`uk_post_approved` | **并发下的重复提交**（应用层预检的 TOCTOU 窗口） |
| 行锁 | 审核/核销时 `SELECT ... FOR UPDATE` | 并发审核同一认领 |
| 状态条件 | `UPDATE ... WHERE id = ? AND status = 'pending'` | 万一 `FOR UPDATE` 被误删，`RowsAffected==0` 会报错而非静默成功 |

**校验顺序**（SPEC 7.3，故意固定）：

| # | 校验 | 失败 code |
| --- | --- | --- |
| 1 | `proof` 长度 10–500 | 1001 |
| 2 | 帖子存在 | 1004 |
| 3 | 帖子类型必须是 `found` | 1001 |
| 4 | 帖子未 `closed` | 1007 |
| 5 | 不能认领自己发的帖 | 1001 |
| 6 | 我没在这张帖上申请过 | 1008 |
| 7 | 这张帖还没有已通过的认领 | 1010 |

**为什么第 3 条排在第 4 条前面**：对一条 `lost` 帖提交认领，要拿到的是
「只能认领招领帖」这个语义（1001），而不是「帖子已结束」（1007）。
两者对 `lost + closed` 的帖会给出不同答案，验收清单同时覆盖了这两种输入，
只有这个顺序能同时满足。

**凭证码的三个设计点**：

```go
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  // 剔除 0 O 1 I L
const Length     = 6
const codeSpace  = len(alphabet)                     // 32 = 2^5
```

1. **剔除形近字符**：这串码要被人念给对方听、或手抄在纸上，
   `0/O`、`1/I/L` 混淆会直接导致核销失败，且失败原因很难排查。
2. **字母表长度取 32（2 的幂）**：可以用位掩码 `b[0] & 31` 代替取模。
   取模在这里其实也均匀（256 是 32 的整数倍），但把「长度必须是 2 的幂」
   写进代码，以后有人往字母表里加字符会在 review 时立刻被这个掩码提醒到。
3. **碰撞靠唯一索引兜底 + 有界重试**：`uk_voucher_code` 是硬约束，
   service 捕获到专用哨兵 `ErrVoucherCodeConflict` 后**重试至多 5 次**。
   用哨兵错误而非 `apperr`：这不是要返回给用户的业务错误，而是 service 内部的重试信号；
   做成 `apperr.CodeXxx` 就会穿过 service 边界变成一个 HTTP 状态码，语义被污染。

**核销时的恒定时间比较**：

```go
func matchVoucher(stored *string, input string) bool {
    if stored == nil { return false }
    want := *stored
    if len(want) != len(input) { return false }   // 先比长度
    return subtle.ConstantTimeCompare([]byte(want), []byte(input)) == 1
}
```

`subtle.ConstantTimeCompare` 在长度不同时返回 0，但**不保证**这种情况下的时间恒定。
所以先比长度（长度不是秘密，凭证码固定 6 位），再对等长切片做恒定时间比较。

### 4.4 智能匹配（SPEC 7.4）

**问题**：为一张帖推荐「可能互补」的帖（`lost` 找 `found`，反之亦然），
需要可解释的相似度。

**解决**：规则打分，四个维度加权求和，阈值过滤。

| 维度 | 分值 | 判定 |
| --- | --- | --- |
| 分类相同 | +40 | `category` 非空且相等 |
| 地点相近 | +30 | 地点字符串的中文 2-gram 有交集 |
| 时间接近 | +20 | `happened_at` 相差 ≤ 24 小时 |
| 标题相似 | +10 | 标题的中文 2-gram 有交集 |

- 总分 **≥ 60** 才进结果集，**最多 5 条**
- 排序：分数降序；同分按 `happened_at` 降序（**稳定排序**，结果可复现）
- 候选集：`type` 取补集、`status='open'`、`id <> 本帖`，走 `idx_type_status`，
  并 `LIMIT 200` 兜底

**为什么用 2-gram 而不是分词**：中文没有空格，通用分词需要词典且易引入误差。
2-gram（相邻两字切片）无需词典、对错别字有一定容忍度，且**完全可解释** ——
用户能看到 `reasons` 里「地点吻合 +30」这样的具体理由，
比一个黑盒相似度分数更适合「校园失物」这种需要人工判断的场景。

**为什么必须有 `LIMIT 200`**：候选集查询在数据量增长后可能返回上万行，
逐行打分的 CPU 开销会失控。取最近的 200 条作为候选是「够用且可控」的折中 ——
匹配本就是锦上添花，不需要全局最优。

### 4.5 图片上传（SPEC 7.5）

**问题**：用户上传的文件不可信，既要防「改了扩展名的可执行文件」，
也要防路径穿越。

**解决**：三重校验 + 重命名 + 路径前缀确认。

| 步骤 | 规则 | 失败 |
| --- | --- | --- |
| 1. 体积 | `file.Size` ≤ 2MB | 1009 |
| 2. 扩展名 | ∈ {`.jpg`,`.jpeg`,`.png`}（不区分大小写） | 1009 |
| 3. 魔数 | 读前 512 字节，`http.DetectContentType` ∈ {`image/jpeg`,`image/png`} | 1009 |

**为什么三重都要**：只信扩展名会被「把 .exe 改名成 .png」绕过；
只信魔数则无法快速拒绝明显不合法的请求（且要读满 512 字节）。
三者同时成立才放行。

**路径安全**：

- 落盘名固定 `uuid.NewString() + 小写扩展名`，**绝不使用原始文件名**
- 目标路径经 `filepath.Abs` 归一化后与上传根目录做**前缀比较**，
  比较时补 `os.PathSeparator` —— 避免 `/data/uploads-evil` 被 `/data/uploads`
  误判为「在目录内」

### 4.6 列表、搜索与分页（SPEC 8.4 / 8.6）

**问题**：这是任务原文点名要练习 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET` 的地方，
也是最容易出现「看不到的 bug」的地方。

**解决**：三个关键决策。

**① `COUNT(*)` 与 `SELECT` 复用同一个 WHERE 构造器**

```go
func buildPostWhere(f ListFilter) (string, []any)   // 纯函数，无状态

func (s *PostStore) List(ctx, f, limit, offset, ...) {
    where, args := buildPostWhere(f)   // ← 同一份
}
func (s *PostStore) Count(ctx, f) {
    where, args := buildPostWhere(f)   // ← 同一份
}
```

**为什么必须复用**：如果两处各拼一套条件，`total` 取自 A、`list` 取自 B，
前端就会看到「翻到第 3 页突然空了，但 `total` 还显示有 200 条」。
这是列表接口最经典、也最难通过单个接口测试发现的 bug —— 因为第 1 页看起来完全正常。

**② 稳定排序 `ORDER BY created_at DESC, id DESC`**

`created_at` 精度到秒。同一秒创建的两条帖子若只按时间排序，
MySQL 不保证两次查询的相对顺序一致，分页就会出现「第 1 页和第 2 页
同时出现某条，另一条永远看不到」。追加主键做次级排序键，顺序才是全局确定的。

**③ 分页夹取、筛选容错**

| 输入 | 结果 |
| --- | --- |
| `page` 非数字 / < 1 | `1` |
| `pageSize` 非数字 | `10` |
| `pageSize` > 50 | `50` |
| `type=lostt`（枚举非法） | 忽略该条件，返回全部 |

**为什么是容错而不是报错**：筛选条件与分页参数同源（都由前端按点击拼 URL）。
既然 `pageSize` 越界走的是「夹取不报错」，枚举非法也应当走同一条路，
否则同一类输入会出现两套处理方式。
已知代价是 `?type=lostt` 这类笔误会静默返回全部结果 ——
前端因此把用户的选择限制在下拉/标签控件里，从源头避免传错值。

**SQL 注入防护**：拼进 SQL 的只有**硬编码的固定片段**（`" AND p.type = ?"` 这类常量），
用户输入一律走 `?` 占位符：

```go
where += " AND (p.title LIKE ? OR p.description LIKE ?)"
kw := "%" + f.Keyword + "%"
args = append(args, kw, kw)
```

注意这里是**把 `%kw%` 作为参数传进去**，而不是拼接字符串，
也不是用 `CONCAT('%', ?, '%')` —— 后者把拼接动作推给数据库、掩盖了
「参数就是纯数据」这件事。

### 4.7 认证与鉴权（SPEC 9）

**问题**：JWT 与 bcrypt 的用法有多个经典坑。

**解决**：五个具体措施。

**① bcrypt cost 固定 10**，`Verify` 任何失败都返回 `false`（不区分原因）。

**② 登录的时序侧信道防护**：用户名不存在时，代码**仍然跑一次 bcrypt 比对**。

```go
u, err := s.users.GetByUsername(ctx, username)
if err != nil {
    if appErr, ok := apperr.As(err); ok && appErr.Code == apperr.CodeNotFound {
        password.Verify(dummyHash, req.Password)   // 关键：消耗等量 CPU
        return nil, apperr.New(apperr.CodeBadCredentials)
    }
    ...
}
```

否则「用户不存在」因为跳过 bcrypt（cost=10 约需几十毫秒）会明显更快返回，
攻击者仅凭响应时间就能枚举出哪些用户名真实存在。

**③ JWT 算法白名单**（防 `alg: none` 与算法混用）：

```go
jwt.ParseWithClaims(token, &Claims{}, keyFunc,
    jwt.WithValidMethods([]string{signingMethod.Alg()}),   // 只接受 HS256
    jwt.WithExpirationRequired(),                           // 必须有 exp
)
```

`keyFunc` 里还额外断言了 `t.Method` 必须是 `*jwt.SigningMethodHMAC` —— 双保险。

**④ 验签通过后必须回查数据库**：token 里的 `uid` 只证明「**签发时**该用户存在」，
无法反映「此刻是否已被删除」。因此 `middleware.Auth` 在验签成功后回查 users 表；
查不到就返回 **1002**（而不是 1004）—— 从请求者视角这不是「资源找不到」，
而是「你的登录状态已无效」，前端据此清 token 并跳登录页。

**⑤ token 载荷只放 `uid`**，不放昵称、角色等可变量。
代价是每个受保护请求多一次主键查询（走聚簇索引，开销很低），
换来的是权限判定始终以数据库为准。

---

## 五、安全措施

以下是本项目实际落地的防护措施清单，逐条对应实现位置。

### 5.1 密码与凭证

| 措施 | 实现位置 |
| --- | --- |
| bcrypt cost=10，自带盐 | `pkg/password` |
| 明文密码永不落库、永不入日志 | `model.User.PasswordHash` json tag 为 `-`；对外只输出 `UserDTO` |
| 登录失败不区分「用户不存在」与「密码错误」 | `service/auth_service.go` → 1006 |
| 用户名不存在也执行一次 bcrypt（**防时序侧信道**） | `service/auth_service.go` 的 `dummyHash` 分支 |
| 凭证码用 `subtle.ConstantTimeCompare`（**防时序侧信道**） | `service/claim_service.go` 的 `matchVoucher` |
| 注册重名靠唯一索引 + 1062（**防 TOCTOU**） | `store/user_store.go` → 1005 |

### 5.2 鉴权与会话

| 措施 | 实现位置 |
| --- | --- |
| JWT 仅接受 HS256（**防 `alg: none`**） | `pkg/jwtutil` 的 `WithValidMethods` |
| 必须有 `exp` 声明 | `pkg/jwtutil` 的 `WithExpirationRequired` |
| 验签后再回查用户存在性 | `middleware/auth.go` → `Authenticate` |
| token 只含 `uid`，不含可变的昵称/角色 | `pkg/jwtutil` 的 `Claims` 结构 |
| 越权访问统一 1003（**不泄露资源状态**） | `service/post_service.go` 校验顺序：权限先于状态 |

### 5.3 数据访问

| 措施 | 实现位置 |
| --- | --- |
| **全部 SQL 参数化**，无字符串拼接用户输入 | `store/*.go` 所有方法 |
| LIKE 用 `?` 传 `%kw%`，不用 `CONCAT` | `store/post_store.go` 的 `buildPostWhere` |
| 联系方式可见性**下推到 SQL**（未授权值不进内存） | `store/post_store.go` 的 `contactCaseSQL` |
| 列表接口**不 SELECT** 联系方式列 | `postSelectColumns(withContact=false)` |
| DTO 白名单裁剪（不靠「记得删」） | `model/*.go` 的 `ToXxxDTO` |
| 列清单用函数统一，避免多处不一致 | `postSelectColumns` / `claimCoreColumns` |

### 5.4 权限控制

| 接口 | 规则 | 非授权结果 |
| --- | --- | --- |
| PUT / DELETE 帖子 | 仅作者 | 1003 |
| PATCH /posts/:id/status | 仅作者 | 1003 |
| GET /posts/:id/claims | **仅帖主（admin 也不行）** | 1003 |
| PATCH /claims/:id | 帖主 **或** admin | 1003 |
| POST /claims/:id/redeem | **仅帖主（admin 也不行）** | 1003 |

注意认领两处**刻意的不对称**：

- **审核允许 admin，读取不允许**：审核是处置事故，读取是窥探纠纷细节，
  两者不该共用一个权限口径。
- **核销不给 admin 开口子**：核销是「东西真的交出去了」这个线下事实的登记，
  管理员代登记会污染交接记录的可信度。

### 5.5 输入校验

| 项 | 规则 | 实现位置 |
| --- | --- | --- |
| 用户名 | `^[A-Za-z0-9_]{3,32}$` | `service/validator.go` |
| 密码 | 6–64 位 | 同上 |
| 昵称 | ≤32 字符 | 同上 |
| 联系方式 | ≤64 字符 | 同上 |
| 帖子标题 | 1–64 **rune**（中文按字算，不按字节） | 同上 |
| 帖子描述 | ≤2000 rune | 同上 |
| `happened_at` | 不晚于「当前 + 1 小时」（容差） | 同上 |
| 图片 URL | 必须 `/uploads/` 前缀且不含 `..` | 同上 |
| 认领证明 | 10–500 rune | 同上 |
| 拒绝理由 | ≤255 rune，**超长截断**而非报错 | `service/claim_service.go` |
| 枚举参数 | 白名单校验（请求体）/ 静默忽略（查询参数） | `pkg/valid` + `service/*` |

长度一律按 **rune** 计（`utf8.RuneCountInString`）：中文标题用字节计会 3 倍超长，
一个 22 字的中文标题会被误判为「超过 64」。

### 5.6 文件上传

| 措施 | 说明 |
| --- | --- |
| 体积上限 | ≤2MB（`UPLOAD_MAX_MB` 可配） |
| 扩展名白名单 | `.jpg` / `.jpeg` / `.png`（不区分大小写） |
| **魔数校验** | `http.DetectContentType` 前 512 字节，防「改扩展名」绕过 |
| 重命名 | `uuid + 扩展名`，**绝不使用原始文件名** |
| 路径穿越防护 | `filepath.Abs` + 前缀比较（补 `os.PathSeparator`） |
| 静态目录无鉴权 | 图片是公开资源，`/uploads` 不走 `/api`、不加中间件 |

### 5.7 错误处理

| 措施 | 说明 |
| --- | --- |
| 统一错误类型 `apperr.Error{Code, HTTPStatus, Message, cause}` | 一处定义 HTTP 状态与文案的映射 |
| 5000 不暴露内部细节 | cause 只进日志，不进响应体 |
| panic 兜底 | `middleware.Recover` → 5000，不让进程退出 |
| 请求 ID 贯穿 | `middleware.RequestID` → 日志可关联单次请求 |

---

## 六、已知限制与后续优化

这些是**有意留下的缺口**，不是遗漏。每一条都写明了不做的理由与生产化的做法。

### 6.1 图片只增不删（孤儿文件）

| 场景 | 结果 |
| --- | --- |
| 上传了图片但没点「发布」 | 文件留在 `uploads/`，无帖子引用 |
| 帖子被删除 / 图片从表单移除 | 文件不回收 |

**不做的理由**：图片与帖子是「先会后合」的关系（先上传拿 URL，再随帖子提交），
要正确回收需要引用计数或延迟清扫任务，属于独立议题。

**生产化做法**：定期任务扫描 `uploads/`，把超过 N 小时仍未被任何
`posts.images` 引用的文件清掉。

### 6.2 无服务端 token 黑名单

登出仅前端清 token，已被签发的 token 在过期前依然有效。

**不做的理由**：SPEC 第 12 章明确列入「明确不做」。引入黑名单需要额外存储
与逐请求查询，对校园场景收益不明显。

**生产化做法**：用 Redis 存「已登出 token 的 jti」并设 TTL（与 token 有效期一致），
或改用短期 access token + refresh token。

### 6.3 匹配是「规则」而非「语义」

2-gram 是字面相似度，无法理解「黑色卡套」与「黑色手机壳」是两类物品。

**不做的理由**：任务要求可解释、可离线验证的规则化匹配。
引入向量检索需要额外基础设施与语料，超出本期范围。

**生产化做法**：用句向量模型（如 bge-small）做语义召回，
再叠加现有规则打分做精排 —— 现有 `reasons` 机制可以直接保留。

### 6.4 无分页游标（深分页性能）

`LIMIT offset, size` 在 `offset` 很大时会扫描并丢弃大量行。

**不做的理由**：校园场景数据量级在万级以内，`offset` 不会很大。

**生产化做法**：改游标分页（`WHERE (created_at, id) < (?, ?)`），
正好利用已有的 `(created_at DESC, id DESC)` 排序键。

### 6.5 无自动化测试用例

`go test ./...` 全部返回 `[no test files]`。

**不做的理由**：本项目的时间主要投在了「用手写 SQL 把业务做对」与
「用真实 curl + 浏览器走查留存证据」上。SPEC 未要求自动化测试。

**生产化做法**：优先补三层 ——
① `pkg/*` 的纯函数单测（`similar`、`voucher`、`pagination`、`apperr`）；
② `service` 层用 `sqlmock` 或真实测试库跑状态机与认领校验顺序；
③ 端到端用 `httptest` 覆盖 13 个错误码。

### 6.6 无 rate limiting

登录接口没有防暴力破解的速率限制。

**不做的理由**：SPEC 未要求；单机部署时在校验层做会引入额外状态。

**生产化做法**：网关层按 IP + 用户名做滑动窗口限流，
登录失败达阈值后叠加指数退避。

### 6.7 其他明确不做的项

与 README 的「明确不做」一致：校园统一身份认证对接、线上支付 / 酬谢金、
站内私信 IM、拾主主动认领 `lost` 帖、对象存储（图片存本地）。

---

# 第二部分 · 附录：按阶段的开发记录

> 以下内容按开发阶段（P1 → P6）累积，是第一部分各章节的**展开与证据**。
> 包含大量踩坑记录、取舍理由与本阶段的验收证据，适合作为深入阅读。
>
> 建议阅读顺序：先看完第一部分，再按兴趣跳读本附录中对应的条目。

---

## 附录 A · 阶段通用的分层约定

**分层约定**

- `handler`：HTTP 编解码 + 参数校验，**不允许出现 SQL**
- `service`：业务规则（状态机、可见性、匹配打分等）
- `store`：SQL 与数据库交互，**不允许出现 HTTP 概念**

---

### 附录 B · P1 认证模块

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `internal/pkg/password/password.go` | bcrypt 封装，cost 固定 10，`Verify` 任何失败都返回 false |
| `internal/pkg/jwtutil/jwtutil.go` | HS256 签发/解析，`Manager` 持有密钥与有效期 |
| `internal/model/user.go` | `User` 实体 + `RegisterReq` / `LoginReq` / `UpdateMeReq` / `UserDTO` |
| `internal/model/errors_helper.go` | MySQL 唯一键冲突判定（errno 1062 + 索引名） |
| `internal/store/user_store.go` | users 表全部参数化 SQL |
| `internal/service/validator.go` | 用户名 / 口令的格式校验（正则 + 长度） |
| `internal/service/auth_service.go` | 注册、登录、鉴权回查 |
| `internal/service/user_service.go` | 查自己、改自己 |
| `internal/middleware/auth.go` | 强制鉴权 + `CurrentUser(c)` |
| `internal/handler/auth_handler.go` | register / login / logout |
| `internal/handler/user_handler.go` | GET me / PATCH me |

### 依赖方向

```
main → router → {handler, middleware} → service → store → sqlx
                      ↓                    ↓
                    model ←───────────────┘
                      ↓
                 pkg/{apperr, response, jwtutil, password, pagination}
```

关键点：**依赖单向向下，`middleware` 不 import `service`。**
鉴权中间件需要「按 id 回查用户」，但若直接依赖 `*service.AuthService` 就会产生
`router → middleware → service` 的额外连线。为此在 middleware 里定义了两个窄接口：

```go
type TokenParser interface { Parse(token string) (int64, error) }
type UserLoader interface { Authenticate(c *gin.Context, userID int64) (*model.User, error) }
```

再由 `router` 里的 `authLoader` 适配器把 `AuthService` 接上去。
好处是中间件可独立单测（塞个假 parser 即可），且依赖方向保持树状不成环。

### 关键设计决策（面试可讲点）

#### 1. PATCH 的可选字段为什么必须用指针

`UpdateMeReq` 的三个字段都是 `*string` / `*bool`：

```go
type UpdateMeReq struct {
    Nickname      *string `json:"nickname"`
    Contact       *string `json:"contact"`
    ContactPublic *bool   `json:"contact_public"`
}
```

若用值类型，前端发 `{"contact_public":true}` 时，`nickname` 会被 Go 解码成 `""`，
service 就会把用户昵称**静默清空** —— 一个「只想改可见性」的请求毁了用户资料。
指针让「字段未出现」（nil）与「字段显式传了空值」（非 nil 指向 ""）成为可区分的语义，
service 只覆盖非 nil 的字段。

**踩过的坑：** 最初在 `UpdateProfile` 里加了「`RowsAffected()==0` 就返回 1004」的防御性检查。
结果 `{"role":"admin"}` 这种请求（三个可变字段都没传 → 新值等于旧值）被 MySQL 报 0 行变更，
于是**合法的空更新被误判成「用户不存在」返回 404**。
修复方式是干脆不检查行数 —— 用户的存在性由调用方基于已查出的实体保证，
而「新值等于旧值」在 MySQL 语义下本就是 0 rows affected，不能当作失败信号。

#### 2. 重名判定：靠唯一索引，不靠「先查再插」

注册流程**没有**先 `ExistsUsername` 再 `Create`。原因是那存在 TOCTOU 竞态：
两个并发注册请求可能同时通过预检，然后一起插入。
正确做法是直接 `INSERT`，由 `uk_username` 兜底，捕获 errno 1062 后翻译成业务错误 1005。

`errors_helper.go` 里额外做了**索引名匹配**（`IsDuplicateEntryOn`）：

```
Duplicate entry 'alice' for key 'users.uk_username'
```

只判 `errno==1062` 是不够的 —— 一张表可能有多个唯一索引，
不区分索引名会让「别的字段冲突」被误报成「用户名已被占用」。

#### 3. 登录的时序侧信道防护

用户名不存在时，代码**仍然跑一次 bcrypt 比对**：

```go
u, err := s.users.GetByUsername(ctx, username)
if err != nil {
    if appErr, ok := apperr.As(err); ok && appErr.Code == apperr.CodeNotFound {
        password.Verify(dummyHash, req.Password)   // 关键：消耗等量 CPU
        return nil, apperr.New(apperr.CodeBadCredentials)
    }
    ...
}
```

否则「用户不存在」因为跳过 bcrypt（cost=10 约需几十毫秒）会明显更快返回，
攻击者仅凭响应时间就能枚举出哪些用户名真实存在。用一个固定的 dummy hash
把两条路径的耗时拉平，配合「不区分错误文案」形成双重防护。

#### 4. JWT 算法白名单

解析时必须显式传 `jwt.WithValidMethods([]string{"HS256"})`：

```go
jwt.ParseWithClaims(token, &Claims{}, keyFunc,
    jwt.WithValidMethods([]string{signingMethod.Alg()}),
    jwt.WithExpirationRequired(),
)
```

不传的话，攻击者可以把头部 `alg` 改成 `none` 并去掉签名，或用 HS/RS 算法混用绕过验签。
`keyFunc` 里还额外断言了 `t.Method` 必须是 `*jwt.SigningMethodHMAC` —— 双保险。

#### 5. 验签通过后必须回查数据库

token 里的 `uid` 只证明「**签发时**该用户存在」，无法反映「此刻是否已被删除」。
因此 `middleware.Auth` 在验签成功后调 `Authenticate` 回查一次 users 表；
查不到就返回 1002 而不是 1004 —— 从请求者视角这不是「资源找不到」，
而是「你的登录状态已无效」，前端据此清 token 并跳登录页。

代价是每个受保护请求多一次主键查询（走聚簇索引，开销很低），
换来的是权限判定始终以数据库为准。token 里也因此**不放**昵称、角色等可变量。

#### 6. 时间统一 UTC

所有对外时间字段用 `u.CreatedAt.UTC().Format(time.RFC3339)` 手动格式化，
不依赖 `encoding/json` 对 `time.Time` 的默认序列化。
后者会带上 DSN 里 `loc` 指定的时区，一旦与前端假设不符就会出现差 8 小时的经典 bug。
在 DSN 里固定 `loc=UTC`、在输出层固定 RFC3339，两端就都不会漂。

### 已补充到第一部分的两个可讲点

以下两点在 P1 / P3 阶段标注为「待后续阶段补充」，现已完整写进第一部分：

- `claims.approved_flag` 生成列 + `UNIQUE(post_id, approved_flag)` 如何在数据库层
  保证「一个帖子最多一条通过记录」（MySQL 唯一索引允许多个 NULL）
  → 见 **[3.3 核心亮点](#33-核心亮点用生成列--唯一索引表达最多一条已通过认领)**
- 智能匹配的 2-gram 相似度打分与稳定排序
  → 见 **[4.4 智能匹配（SPEC 7.4）](#44-智能匹配spec-74)**

---

### 附录 C · P3 列表搜索、分页与状态机

> 对应 SPEC 第 7.1 章（状态机）、第 8.4/8.6 章（列表接口与手写 SQL）。
> 这是任务原文点名要求练习 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET` 的地方。

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `internal/pkg/pagination/pagination.go` | 分页参数解析与归一化（`Parse`）+ 列表信封组装（`Result`） |
| `internal/store/post_store.go` | 新增 `ListFilter` / `buildPostWhere` / `List` / `Count` / `ListByUser` / `UpdateStatus`；联系方式可见性下推到 SQL |
| `internal/service/post_service.go` | 新增 `List` / `ListMine` / `ChangeStatus`，导出 `ValidateTransition`，内部 `changeStatusAsSystem` |
| `internal/handler/post_handler.go` | 新增 `List` / `ListMine` / `ChangeStatus` 三个 handler |
| `internal/router/router.go` | 注册 `GET /api/posts`、`GET /api/users/me/posts`、`PATCH /api/posts/:id/status` |

依赖方向没有变化：`handler → service → store`。其中 service 用**类型别名**
`type ListFilter = store.ListFilter` 再导出一次筛选条件，就是为了让 handler 只依赖
service 一层 —— handler 里出现 `store` 包，这套分层就不再是一条直线了。

### 关键设计决策（面试可讲点）

#### 1. `COUNT(*)` 与 `SELECT` 复用同一个 WHERE 构造器

`buildPostWhere(f ListFilter) (string, []any)` 同时服务于 `List` 与 `Count`：

```go
func (s *PostStore) List(ctx, f, limit, offset) {
    where, args := buildPostWhere(f)   // ← 同一份
    ...
}
func (s *PostStore) Count(ctx, f) {
    where, args := buildPostWhere(f)   // ← 同一份
    ...
}
```

**为什么必须复用**：如果两处各拼一套条件，`total` 取自 A、`list` 取自 B，
前端就会看到「翻到第 3 页突然空了，但 `total` 还显示有 200 条」。
这是列表类接口最经典、也最难通过单个接口测试发现的 bug —— 因为第 1 页看起来完全正常。
把条件构造收成一个纯函数，这类不一致在结构上就不可能发生。

安全边界（SPEC 10）：拼进 SQL 的只有**硬编码的固定片段**（`" AND p.type = ?"` 这类常量），
用户输入一律走 `?` 占位符。

```go
where += " AND (p.title LIKE ? OR p.description LIKE ?)"
kw := "%" + f.Keyword + "%"
args = append(args, kw, kw)
```

> 注意这里是**把 `%kw%` 作为参数传进去**，而不是写
> `" AND p.title LIKE '%" + kw + "%'"`，也不是用 `CONCAT('%', ?, '%')`。
> 前者是注入漏洞，后者把拼接动作推给数据库、掩盖了「参数就是纯数据」这件事。

几个边界处理：

- `status` 传空串应视为「不筛选」，不能拼成 `AND p.status = ''`（永远查不到东西）
- 中文用 `utf8mb4_unicode_ci` 排序规则，`LIKE` 天然不区分大小写，**不要**加 `LOWER()` —— 那会让索引失效
- `JOIN users` 不影响 `COUNT(*)`：`posts.user_id` 有外键指向 `users.id`，INNER JOIN 不丢行也不放大行数

#### 2. 稳定排序：`ORDER BY created_at DESC, id DESC`

只按 `created_at` 排序是不够的。`created_at` 列精度到**秒**，
种子数据里 16 条帖子若集中在同一秒写入，MySQL 不保证两次查询返回的相对顺序一致，
于是分页会出现「第 1 页和第 2 页同时出现某条帖子，而另一条永远看不到」。

追加主键做次级排序键，顺序才是全局确定的。这个问题在数据量小时几乎看不出来，
线上数据一多就必然暴露 —— 属于「不写不知道，写了也没法自测」的典型。

#### 3. 状态机：白名单只定义一次，且导出给认领流程复用

```go
var allowedTransitions = map[string][]string{
    valid.StatusOpen:    {valid.StatusMatched, valid.StatusClosed},
    valid.StatusMatched: {valid.StatusClosed},
    valid.StatusClosed:  {},   // 终态：空切片 = 没有出边
}

func ValidateTransition(from, to string) error   // ← 导出
```

`ValidateTransition` 刻意**首字母大写**：P6 的认领流程在「审核通过」「核销」时要触发
帖子的自动流转，必须复用这同一个函数。若在 `claim_service` 里再写一份规则表，
两份定义迟早分叉 —— 那正是状态机最典型的失效方式：**手动流转拦得住的非法跳转，
自动流转却放过去了**。

内部因此有两条路径共用一个核心：

```go
ChangeStatus         // 作者手动：加一层作者校验，再调 applyStatusChange
changeStatusAsSystem // 系统自动：不加作者校验，直接调 applyStatusChange
                     // ↑ P6 接入；P3 阶段尚无调用方，按阶段文件约定先落地签名
```

#### 4. 乐观锁：`AND status = ?`

```sql
UPDATE posts
SET status = ?, updated_at = ?
WHERE id = ? AND status = ?
```

末尾的 `AND status = ?` 是乐观锁。两个并发请求同时把 `open` 改成 `matched` 与 `closed` 时：

- 只写 `WHERE id = ?`：两个请求都成功，后一次**静默覆盖**前一次
- 加上 `AND status = ?`：后到的那个更新 0 行 → 应用层返回 1007

`RowsAffected == 0` 在 store 层**不直接翻译成错误**，而是把行数返回给 service 判断：
行数为 0 有「帖子不存在」与「状态已被改」两种可能，该映射成哪个错误码属于业务语义。
store 不越权替 service 下结论，也不把 `sql.ErrNoRows` 这类实现细节漏出去。

#### 5. `updated_at` 为什么不交给 SQL 的 `NOW()`

`updated_at` 的值由 **Go 侧**算好传进去（`time.Now().UTC().Truncate(time.Second)`），
而不是在 SQL 里写 `NOW()`。

原因：MySQL 的 `NOW()` 返回的是**会话时区**下的本地时间（本机默认 `SYSTEM`，即 `+08:00`），
而 DSN 里固定了 `loc=UTC`，Go 读回来时会按 UTC 解析 —— 一进一出凭空差 8 小时。
本项目的原则是「时间只从一处产生」：库里存 UTC、DSN 固定 `loc=UTC`、
响应统一 `RFC3339`，前端只做一次「UTC → 本地」的展示转换。

顺带 `Truncate(time.Second)` 与列精度（`DATETIME` 无小数位）对齐，
避免数据库四舍五入出一个比当前时间还晚的 `updated_at`。

#### 6. 联系方式可见性下推到 SQL 层

SPEC 7.2 的硬要求是「在 SQL 层决定是否 SELECT `contact`，不要查出来再在内存里删」。
P2 阶段为了先保证正确性是内存裁剪，P3 按 SPEC 把它下推了：

```sql
CASE
    WHEN u.id = ? THEN u.contact               -- 请求者就是作者本人
    WHEN u.contact_public = 1 AND ? > 0 THEN u.contact  -- 作者已公开且请求者已登录
    ELSE ''                                     -- 其余一律空串
END AS author_contact
```

两点值得说：

- **列清单是一个函数**（`postSelectColumns(withContact bool)`），详情/列表共用。
  列表干脆传 `false` 不 SELECT 这一列 —— 一次批量查询里少带走一批联系方式。
  若两处各写一份列清单，迟早出现「一边多查了一列、另一边忘了加」。
- **`contact_visible` 仍由 Go 计算**：它是布尔标志，不是敏感值，需要 `contact_public` 才能算出来，
  而 `contact_public` 本身不是秘密。真正敏感的是 `contact` 的值，它没离开过数据库。

`model.ToPostDTO` 里对 contact 的再次收窄（列表恒空串）保留下来，作为**纵深防御** ——
将来谁改了 store 的 SELECT 清单，「列表不泄露联系方式」这条规则也不会失守。

> ⚠️ SPEC 7.2 规则 4「双方存在已通过的认领关系 → 可见」依赖 `claims` 表查询，
> 属 P6 认领模块。P3 尚未接入，`contactCaseSQL` 的注释里标了扩展点。

#### 7. 分页参数「夹取」而不是报错

```go
func Parse(pageStr, sizeStr string) Page
```

入参刻意是**字符串**而非 int：查询参数天然以字符串到达。
若让每个 handler 自己 `strconv.Atoi` 再判错，等于把同一套边界规则在 N 个 handler 里各抄一遍，
迟早有接口漏掉。解析失败按「未传」处理，由缺省值兜底。

| 输入 | 结果 |
| --- | --- |
| `page` 非数字 / < 1 | `1` |
| `pageSize` 非数字 | `10` |
| `pageSize` < 1 | `1` |
| `pageSize` > 50 | `50` |

选「夹取」的理由：分页参数由前端按用户操作拼装，一个 `pageSize=999`
不该让整个列表页变成 400；而 50 的上限是防「一次拉全表」的必要保护。
这与 SPEC 8.2 错误码表里「分页越界 → 1001」的字面表述不同 ——
以 SPEC 8.5 与阶段文件 04 的明确规则为准，并已在 `docs/api.md` 写明。

列表筛选的枚举参数同理：非法值**静默忽略**（等同不筛选），策略与取舍已写进 `docs/api.md`。

#### 8. 列表里 `author.contact` 由 service 强制清空

`List` / `ListMine` 内部写死了 `view.InList = true`，而不是指望 handler 记得传。

「列表不返回联系方式」的后果是**一次请求批量带走全站用户的联系方式**，
把这条规则放在 service 里堵死，即使将来新增一个列表接口忘了设置，也不会泄露。

### 本阶段的验收证据

- `go build ./...` / `go vet ./...` 零错误零警告
- 16 条 curl 验收全过（含第 6 条「三态筛选都能出结果」这一已知缺陷的确认）
- P2 的 13 条验收回归全过，确认下推 SQL 未改变已交付接口的对外行为

---

### 附录 D · P5 发布编辑、图片上传、状态流转与个人中心

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `web/src/api/upload.js` | 上传接口封装。刻意不设 `Content-Type`（见下） |
| `web/src/components/ImageUploader.vue` | 基于 `van-uploader` 的图片上传。内部持有对象数组，对外只吐 `string[]` URL |
| `web/src/components/PostForm.vue` | 发布/编辑共用表单。props `initialValue` + 事件 `submit`，两处只维护一条校验路径 |
| `web/src/components/StatusActionSheet.vue` | 状态流转弹层。选项由当前 status 推导，自己发请求、成功后 emit 服务端 DTO |
| `web/src/pages/PostCreatePage.vue` | 发布页。成功后先 `reset()` 再跳详情 |
| `web/src/pages/PostEditPage.vue` | 编辑页。挂载时读详情，`can_edit !== true` 直接退回首页 |
| `web/src/pages/MePage.vue` | 个人中心。资料编辑 + 我的帖子（状态 tab + 卡片级快捷操作） |
| `web/src/pages/PostDetailPage.vue` | 详情页。作者操作栏改为「编辑 / 改状态 / 删除」 |
| `web/vite.config.js` | 新增 `preview.proxy`（Vite 的 preview **不继承** server.proxy） |

### 关键设计决策（面试可讲点）

#### 1. `van-uploader` 的 `beforeRead` 返回数组会被**静默忽略**

需求是「用户一次选了 4 张，只留前 3 张并提示」。直觉写法是：

```js
// ❌ 无效
const beforeRead = (files) => {
  if (files.length > 3) { showToast('最多 3 张'); return files.slice(0, 3) }
  return true
}
```

但 Vant 只认 **boolean** 与 **Promise**：同步返回数组时，Vant 既不报错也不采用，
仍然把全部 4 个文件交给 `after-read`。而组件上的 `:max-count="3"` 又是在
**更早**的位置静默 `slice` —— 两个机制叠加，就会出现「提示弹了、但到底留了几张
说不清」的状态。

正确写法是把裁剪结果包成 Promise，让 Vant 用它**替换**文件列表：

```js
const beforeRead = (files) => {
  const list = Array.isArray(files) ? files : [files]
  const accepted = list.slice(0, remaining)
  if (list.length > remaining) showToast(`最多上传 ${MAX_IMAGES} 张，已保留前 ${remaining} 张`)
  return remaining === list.length ? true : Promise.resolve(accepted)
}
```

另外必须加 `multiple` —— 否则 `<input>` 根本不允许多选，
「一次选 4 张」这条用例连入口都触发不到。

#### 2. 上传的 `fileList` 内部是对象、对外是 URL 数组

- 父组件只关心 `v-model` 拿到 `string[]`（提交给后端的就是这个）
- 子组件内部需要每个文件的 `status`（`uploading` / `done` / `failed`）来渲染遮罩与重试
- 因此组件内以对象数组为**唯一真相**，用 `computed` 投影出 URL 数组向上 emit
- 但投影出去的值会再作为 `props.modelValue` 回来（回显），若不设防会**清掉正在上传中的项**。
  这里用 `lastEmitted` 做 JSON 比对：只有外部传入的值与自己上次吐出去的不同，
  才认为是「外部真的改了」，才重建内部列表

#### 3. `POST /api/upload` 绝不能手写 `Content-Type`

`multipart/form-data` 必须带 boundary。手写 `'multipart/form-data'` 会把
boundary 抹掉，服务端直接解析不出 `file` 字段。Axios 见到 `FormData` 会自动
补正确的头，所以那行 `headers` 是**有害无益**的。

#### 4. 单文件失败隔离：一张传失败不拖垮另外两张

`after-read` 是**按文件**触发的（`multiple` 时每个文件各调一次），所以上传也
按文件独立 `try/catch`：失败的那张标记 `failed` 并提示，其余照常写入 URL 数组。
提交按钮的可用性只看「是否还有 `uploading`」，不看「是否有 `failed`」——
失败项在最终 payload 里自然缺席。

#### 5. `post-form__type` 为什么要搬出 `van-field`

类型选择（失物 / 招领）最初放在 `van-field` 的 `#input` 插槽里。在 390px 宽下
「我捡到东西」会被挤到换行，两行高度把整行撑歪。

Vant 的 `van-field` 是给**单行文本**设计的，`#input` 插槽期望的也是一段行内内容。
这里换成「整行 `van-cell` + 自定义 `post-form__type-wrap`」，
并给标签加 `white-space: nowrap`，与「分类 / 地点」那些行的视觉语言反而更统一。

#### 6. 编辑态禁用类型：不要指望 `RadioGroup` 的根节点带 `--disabled`

`van-radio-group` 上给 `disabled` 后，**只有子 `van-radio` 会带 `.van-radio--disabled`**，
group 根节点没有这个类；选中态也没有 `.van-radio--checked`（勾选样式只在 icon 上）。

所以验证「编辑模式下类型不可改」不能只看类名，要两条一起：
① `.van-radio-group .van-radio--disabled` 的数量等于 2；
② **真的去点一下「招领」**，断言选中值仍是「失物」。
只断言类名是「测框架」，加一次真实点击才是「测行为」。

#### 7. 状态机的 UI 侧收敛：弹层选项由 status 推导

`StatusActionSheet` 不接收父组件传选项，而是根据 `status` 自己算：

| status | 可选项 |
| --- | --- |
| `open` | 标记已找到（→ `matched`）、直接结束（→ `closed`） |
| `matched` | 标记已结束（→ `closed`） |
| `closed` | 无（弹层显示「该帖子已结束」并禁用） |

好处是「能不能流转」这条规则的**唯一权威仍在后端**（`1007` 拦截非法流转），
前端只是把不可能的操作**不给出口**；即便有人绕过 UI，后端那道门依然在。

#### 8. 编辑页的守卫：`can_edit` 而不是「本地比 user_id」

编辑页挂载后读一次详情，若 `can_edit !== true` 就 toast「无权编辑」并 `replace` 回首页。

这里坚持用服务端下发的 `can_edit`，而不是在前端用
`currentUser.id === post.user_id` 自己算：一来 `can_edit` 的语义未来可能扩展
（比如加管理员），二来前端自己算等于把权限判定复制了一份，
一旦两边不一致就会出现「按钮显示但请求 403」的割裂体验。

#### 9. CORS：为什么固定白名单会拦掉「同源的写请求」

这是 P5 走查里唯一一个**真实的功能性缺陷**（不是测试脚本问题）。

原本 `devOrigins` 只有 `localhost:5173` / `127.0.0.1:5173`。表现却很反直觉：

- 手机连同一 Wi-Fi 打开 `http://10.150.56.221:5173` —— **列表能加载，一登录就失败**
- `npm run preview`（4173）—— 同上

原因在 Fetch 规范：**浏览器对同源的非 GET 请求同样会带 `Origin` 头**
（POST / PUT / PATCH / DELETE 都带，GET 不带）。
前端是经 Vite proxy 把 `/api` 转发到 8080 的，所以：

| 视角 | 看到的 |
| --- | --- |
| 浏览器 | 同源请求（`http://10.150.56.221:5173` → 同源 `/api/...`） |
| 服务端 | 一个带着 `Origin: http://10.150.56.221:5173` 的跨域 POST |

于是 GET 列表畅通、写请求全被中间件 403，前端统一提示「网络异常，请检查连接」——
一个**看起来像断网、实际是 CORS** 的误导性症状。

修法是换成 `AllowOriginFunc`，按来源判定：回环地址 + 私有网段，
**端口不限**（dev 5173 / preview 4173 / 以后换端口都不用改代码），
公网域名与公网 IP 一律拒绝。

> 复盘：这个缺陷能藏到 P5 才暴露，是因为 P1–P3 的验收全在
> `localhost:5173` 这一个 Origin 上做的。**验收环境的多样性本身也是用例** ——
> 只在一个「恰好落在白名单里」的地址上跑，等于把这条规则测没了。

### 本阶段的验收证据

- `go build ./...` / `go vet ./...` 零错误零警告
- `npm run build` 成功（vite v8.3.1，381 modules，5.61s）
- 浏览器走查（Edge，viewport 390×844）：发布编辑链路 27/27、个人中心与权限对照 13/13、
  局域网 + preview 补跑 6/6、昵称同步补验 2/2
- 后端防线 curl 逐条验证：越权 PUT → `1003`、未来时间 → `1001`、
  非法流转 → `1007`、`.txt` 与伪造 `.png` 与 3MB → `1009`
- 截图 56 张存于 `docs/screenshots/p5/`（命名 `p5-NN-描述.png`）

---

### 附录 E · P6 认领审核流、电子凭证核销与智能匹配

### 文件职责

**后端**

| 文件 | 职责 |
| --- | --- |
| `internal/pkg/voucher/voucher.go` | 6 位凭证码的生成 / 规范化 / 形态校验 |
| `internal/model/claim.go` | `Claim` 实体、`ClaimDTO` / `MyClaimDTO`、三个请求体 |
| `internal/store/querier.go` | `Querier` 接口：抽掉「事务 or 连接池」的差异 |
| `internal/store/claim_store.go` | 认领的全部 SQL；1062 → 业务码的翻译 |
| `internal/service/claim_service.go` | 认领校验顺序、审核、核销、凭证码重试 |
| `internal/pkg/similar/similar.go` | 中文 2-gram 集合与交集判定 |
| `internal/service/match_service.go` | SPEC 7.4 打分与排序 |
| `internal/handler/claim_handler.go` / `match_handler.go` | 两组路由的 HTTP 编解码 |

**前端**

| 文件 | 职责 |
| --- | --- |
| `src/api/claim.js` | 5 个认领接口 + 1 个匹配接口 |
| `src/components/ClaimCard.vue` | 一张认领卡，同时服务帖主视角与申请人视角 |
| `src/components/HonorCertificate.vue` | 拾金不昧证书（canvas 绘制 + 导出 PNG，07 §11 彩蛋） |
| `src/components/MatchList.vue` | 详情页「可能有这些匹配」区块 |
| `src/pages/ClaimManagePage.vue` | 帖主审核台（选择帖子 → 通过/拒绝/核销） |
| `src/pages/MyClaimsPage.vue` | 申请人视角的认领记录 |

### 依赖方向

```
handler ──→ service ──→ store ──→ database/sql
   │           │
   │           └──→ pkg/{voucher, similar, valid}   （纯函数，无状态）
   │
   └──→ pkg/{apperr, response, pagination}          （HTTP 编解码）
```

`service/claim_service.go` 是本阶段唯一一处 service 之间横向依赖：
`ClaimService` 持有 `*PostService`，用来调 `changeStatusAsSystem`。
这是刻意的 —— 认领流程要改帖子状态，必须复用**同一个**状态机入口，
而不是自己再写一条 `UPDATE posts SET status = ?`。

---

### 关键设计决策（面试可讲点）

#### 1. 「一张帖子最多一条已通过认领」为什么交给数据库

应用层的「先查有没有 approved，没有就插入」在并发下必然失效：
两个请求同时查到「没有」，然后双双插入。这不是理论问题 —— 认领正是
「多个同学同时抢一个失物」的场景，天然高并发。

MySQL 的解法是用**部分唯一索引的替代品**。「部分索引」MySQL 8 没有，
但可以用生成列绕出来：

```sql
approved_flag TINYINT GENERATED ALWAYS AS (
  IF(status IN ('approved','redeemed'), 1, NULL)
) STORED,
UNIQUE KEY uk_post_approved (post_id, approved_flag)
```

`status` 是 `approved`/`redeemed` 时 `approved_flag = 1`，否则是 `NULL`。
而 **MySQL 的唯一索引允许任意多个 `NULL`**，于是：

- 同一帖子可以同时存在任意多条 `pending` / `rejected`（全部 `NULL`，互不冲突）
- 但 `approved`/`redeemed` 的 `(post_id, 1)` 只能有一条

把「业务上最多一条」这件事变成数据库约束，比任何 `SELECT ... FOR UPDATE`
的写法都更可靠 —— 它连「有人绕过应用层直接写库」这种情况都挡住了。
**并且 `redeemed` 也计入 `1`**，所以核销后不会因为认领离开 `approved` 态
而腾出一个空位让别人再通过一条。

实测（seed 数据，post 29）：

```
ERROR 1062 (23000): Duplicate entry '29-1' for key 'claims.uk_post_approved'
```

#### 2. 1062 按**索引名**翻译，不按错误码猜

`Create()` 里重名/冲突场景有**两个**不同的唯一索引，要映射成两个不同的业务码：

| 索引 | 语义 | 业务码 |
| --- | --- | --- |
| `uk_post_claimant` | 我已经申请过这张帖 | 1008 |
| `uk_post_approved` | 这张帖已有通过的认领 | 1010 |
| `uk_voucher_code` | 凭证码撞车 | 内部哨兵，触发重试 |

三者都是 errno **1062**，光看错误码分不出来，必须读消息里的索引名：

```go
var mysqlErr *mysql.MySQLError
if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
    switch {
    case model.IsDuplicateEntryOn(err, model.IndexClaimsPostClaimant):
        return 0, apperr.Wrap(apperr.CodeClaimExists, err)
    case model.IsDuplicateEntryOn(err, model.IndexClaimsPostApproved):
        return 0, apperr.Wrap(apperr.CodeClaimApproved, err)
    }
}
```

用 `errors.As` 而不是字符串匹配 —— 07 的「常见坑 2」明确点了这一条。
索引名抽成 `model` 里的常量，并在注释里写明「必须与 `schema.sql` 保持同步」，
因为这是一个**跨文件的隐式契约**，改了一处不改另一处会静默退化成 5000。

#### 3. 事务：`defer tx.Rollback()` 不需要「提交成功就跳过」

```go
tx, err := s.claims.BeginTx(ctx)
if err != nil { return nil, apperr.Wrap(apperr.CodeInternal, err) }
defer func() {
    if rbErr := tx.Rollback(); rbErr != nil && rbErr.Error() != "sql: transaction has already been committed or rolled back" {
        slog.Error("回滚认领审核事务失败", "claimId", claimID, "error", rbErr)
    }
}()
```

07 的「常见坑 1」给了两种写法（`if err != nil { Rollback }` 或直接 `defer Rollback`）。
这里选了后者并且**不写任何成功分支**：`database/sql` 对已提交的事务再 `Rollback`
会返回 `ErrTxDone`，是安全的 no-op，不会撤销已经提交的写入。
写 `if committed { skip }` 反而是画蛇添足 —— 任何一条新的 `return` 分支
都可能忘记维护那个标志位。

#### 4. `SELECT ... FOR UPDATE` 必须在事务里，而且要在**读之前**

```go
tx, _ := s.claims.BeginTx(ctx)
claim, err := s.claims.GetByIDForUpdate(ctx, tx, claimID)  // 锁到事务结束
```

锁必须在**第一次读之前**拿到。若先不带锁读一遍判断 `status == pending`，
再带锁读第二遍，两次读之间的窗口就够另一个请求抢先处理掉这条认领。

拿到行锁之后的 `UPDATE ... WHERE id = ? AND status = 'pending'` 里那个
`status = 'pending'` 是**第二道防线**：万一有人把 `FOR UPDATE` 去掉了，
`RowsAffected == 0` 会让流程报错而不是静默成功。

#### 5. 自动流转复用 `ValidateTransition`，并且传入事务

认领通过要 `open → matched`，核销要 `matched → closed`。
这两次流转**没有**自己写 SQL，而是复用了 P3 的 `changeStatusAsSystem`：

```go
func (s *PostService) changeStatusAsSystem(ctx context.Context, tx *sqlx.Tx, postID int64, to string) error
```

`tx` 参数是本阶段对 07 §3 的一处**有意加码**。07 给的签名没有事务参数，
但那样会出一个真实的一致性洞：认领更新在一个事务里，帖子状态在另一个连接上提交。
如果帖子状态更新失败，认领已经 `approved`、帖子还停在 `open`，
用户会看到「已通过但还在寻找中」。

加上 `tx` 之后两步在同一个事务里，`open → matched` 失败会连带回滚认领写入。

为了不把「事务版」和「连接池版」写两份 SQL，引入了一个 3 方法的接口：

```go
type Querier interface {
    GetContext(ctx context.Context, dest any, query string, args ...any) error
    SelectContext(ctx context.Context, dest any, query string, args ...any) error
    ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
```

`*sqlx.DB` 和 `*sqlx.Tx` 都天然满足它，于是 `PostStore` 的每个方法只需要
写一遍 SQL，用 `s.posts.Handle(tx)` 一句就能在两种模式下切换
（`tx == nil` 时返回连接池）。**两次实现 = 迟早分叉**，这是这个接口存在的唯一理由。

白名单只定义一次的收益也在这一步兑现：将来如果要允许 `open → closed` 之外的新边，
改 `valid.go` 一个地方，P3 的作者改状态与 P6 的系统流转会同时生效。

#### 6. 凭证码：字符集、随机源、重试

```go
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  // 剔除 0 O 1 I L
const Length = 6
const codeSpace = len(alphabet)                     // 32 = 2^5
```

三点讲究：

1. **剔除形近字符**是关键（07 常见坑 5）。这串码要被人念给对方听、或手抄在纸上，
   `0/O`、`1/I/L` 混淆会直接导致核销失败，而失败原因还很难排查。
2. **字母表长度取 32**（2 的幂）是为了能用**取位掩码**代替取模：

   ```go
   b := make([]byte, 1)
   for {
       if _, err := rand.Read(b); err != nil { return "", err }
       if b[0]&(codeSpace-1) < codeSpace { break }   // 天然等概率，无需丢样本
   }
   code[i] = alphabet[b[0]&(codeSpace-1)]
   ```

   取模 `b[0] % 32` 在这里其实也均匀（256 是 32 的整数倍），但把
   「字母表长度必须是 2 的幂」这件事**写进代码**，以后有人往字母表里加字符
   会在 review 时立刻被这个掩码提醒到，而不是悄悄引入偏置。
3. **碰撞靠唯一索引兜底 + 有界重试**。32^6 ≈ 10.7 亿的码空间，
   实际碰撞概率极低，但「极低」不等于「不会」。`uk_voucher_code` 是硬约束，
   service 侧捕获到专用哨兵错误后重试，**至多 5 次**：

   ```go
   var ErrVoucherCodeConflict = errors.New("凭证码已被占用")   // 类型化哨兵，不是业务错误码
   ```

   用哨兵错误而不是 `apperr`：这不是要返回给用户的业务错误，而是
   service 内部的重试信号。如果把它做成 `apperr.CodeXxx`，它就会
   穿过 service 边界变成一个 HTTP 状态码 —— 语义被污染了。

#### 7. `subtle.ConstantTimeCompare` 的长度前提

```go
func matchVoucher(stored *string, input string) bool {
    if stored == nil { return false }
    want := *stored
    if len(want) != len(input) { return false }   // 长度不同直接失败
    return subtle.ConstantTimeCompare([]byte(want), []byte(input)) == 1
}
```

`subtle.ConstantTimeCompare` 在两个切片长度不同时返回 `0`，但它**不保证**
这种情况下的时间恒定。所以先比长度（长度不是秘密，凭证码固定 6 位），
再对等长切片做恒定时间比较。07 常见坑 6 说的就是这个。

#### 8. 联系方式可见性第 4 条：仍然是 SQL 层

P3 已经把前 3 条规则写进了 SELECT 的 `CASE`。P6 新增的第 4 条
（双方存在已通过/已核销的认领关系）延续同一个原则 —— 加一个 `EXISTS` 子查询：

```sql
CASE
  WHEN ? = p.user_id            THEN u.contact
  WHEN u.contact_public = 1     THEN u.contact
  WHEN EXISTS (SELECT 1 FROM claims c
               WHERE c.post_id = p.id AND c.claimant_id = ?
                 AND c.status IN ('approved','redeemed'))
                                THEN u.contact
  ELSE ''
END
```

为什么不放在 service 里做？因为 `contact_visible` 和 `contact` 必须来自
**同一个表达式**。如果可见性在 SQL 里算、联系方式在 Go 里清空，
一旦有人只改了一边，就会出现 `contact_visible=true` 但 `contact=""`
的自相矛盾响应 —— 前端会渲染出一个空白的联系方式区块。

同一条 SQL 产出两个字段，矛盾在结构上就不可能发生。这是「
让类型/结构替你保证不变量」而不是「靠人的自觉」。

#### 9. `Querier` 之外的第二个复用：`claimFromClause`

`claim_store.go` 里把 SELECT 列、FROM/JOIN 子句抽成三个常量：

```go
claimCoreColumns  // 实体字段
claimDetailColumns // 实体 + 申请人昵称 + 帖子摘要
claimFromClause   // LEFT JOIN users / posts
```

`GetByID` / `GetByIDForUpdate` / `getDetail` / `ListByPost` / `ListByClaimant`
五处共用同一份子句。如果各自拼一遍，改一个 JOIN 条件（比如把
`LEFT JOIN` 改成 `INNER JOIN`）就会漏掉某几条查询 —— 那种 bug 表现为
「这个接口查得到、那个接口查不到」，非常难定位。

#### 10. 认领状态机：**不**复用帖子的 `ValidateTransition`

帖子是 `open → matched → closed` 的**有向链**，认领是
`pending → {approved → redeemed | rejected}` 的分叉 —— 两者形状不同，
硬塞进同一个白名单只会把表写成一团解释不清的数据。

真正的复用点在别处：**认领状态机定义在 `valid` 包里，和帖子状态机并排**，
前端从 `/constants` 的 `CLAIM_STATUS` 取同一份枚举。三处（后端 `valid`、
数据库 `ENUM`、前端常量）保持一致的方式是「放在一起、注释互指」，
而不是抽一层谁都不认识的抽象。

#### 11. `can_claim` 与 `my_claim` 为什么必须拆成两个字段

`can_claim` 的职责被限制成一个**静态准入判断**：`type=found`、非本人、
`status≠closed`、已登录。它在列表接口和详情接口上语义完全一致。

「我已经申请过了吗、到哪一步了」这件事**只有详情页拿得到**（要查 `claims` 表），
放进 `my_claim`。

于是前端的判断顺序必须是：

```
自己是帖主  >  my_claim 存在  >  can_claim  >  登录 / 兜底
```

**`my_claim` 排在 `can_claim` 前面**是这一处设计的全部要点。
后端刻意没有把「已申请」塞进 `can_claim`，因为那样会让
「可以直接认领」和「已经申请过了」在同一个布尔里互相污染；
代价是前端必须记住这个顺序 —— 写反了，一个已提交申请的人会看到
「这是我的」而以为自己没提交成功。

### 前端的关键取舍

#### 12. 一张 `ClaimCard` 服务两个页面

`ClaimManagePage`（帖主）和 `MyClaimsPage`（申请人）展示的是**同一条 claim 的两面**，
字段几乎完全重合，差别只在「头部显示谁」和「底部有没有操作按钮」。

拆成两个组件的代价是 `voucher_code` 的可见性判断、拒绝理由的排版、
凭证码的等宽样式要各写一遍。一张卡 + `mode="manage" | "mine"` 更好维护。

操作请求也由卡片自己发起（与 P5 的 `StatusActionSheet` 同一约定），
成功后只 `emit('success')` 让父页面重拉 —— **不本地改 status**，
以后端落库结果为准。

#### 13. `voucher_code` 的 `null` vs `""`

后端明确约定未通过时是 `null`。前端因此**只用真值判断**：

```js
const voucher = computed(() => props.claim.voucher_code || '')
```

不写 `!== ''` —— 那会把 `null` 判成「有值」，渲染出一个空的凭证码卡片
（07 常见坑 8）。

#### 14. `van-dialog` 的 `before-close` 用来「接口失败就不关弹层」

```js
async function onRedeemBeforeClose(action) {
  if (action !== 'confirm') return true     // 取消：放行关闭
  ... 
  try { await claimApi.redeem(...); return true }  // 成功：关闭
  catch { return false }                           // 失败：留在弹层里
}
```

拒绝理由与核销码两个弹层都用这个模式。收益是：1011（凭证码错误）时
用户改一个字符就能重试，而不是「点确认 → 弹层被清空 → 重新点按钮 → 重新输入」。
`showToast` 不会关弹层，两者配合刚好。

#### 15. `van-list` 的「自动触发」与「手动重载」必须二选一

`van-list` 挂载后会自动触发一次 `@load`。这带来一个易错点：
**换帖子时如果手动调一次 `fetchClaims()`，会和自动触发撞成两个并发请求**，
而第二个请求的 `page` 已经被推到 2，列表里会莫名少掉第一页。

解法是 `:key="postId"` + 只重置状态、不发请求：

```js
// pick() 里
resetClaimsState()          // page=1, list=[], finished=false
postId.value = post.id      // key 变化 → van-list 重新挂载 → 自己触发 @load
```

而「同一条帖子重载」（审核/核销后）走另一条路径 `reloadClaims()`：
van-list 不会重新挂载，所以必须手动 `fetchClaims()`。

两条路径分开，各自只负责一种情况 —— 这是本阶段唯一一处前端状态机。

#### 16. `MatchList` 无匹配时整块不渲染

07 §4 要求「无匹配时整个区块不渲染（不要显示空区块）」。
实现上不是渲染一个空盒子再 `v-if` 内容，而是：

```html
<section v-if="list.length" class="match-list">
```

**加载中也不渲染**，否则会出现「先闪一个空块、再被填满」的抖动。
匹配是锦上添花的信息，接口失败也**静默**（不弹 Toast），
不该干扰「查看 / 认领」这条主流程。

#### 17. 走查脚本上的两个坑（写进文档免得下次再踩）

自动化走查用 Puppeteer + 系统 Edge（不额外下载 Chromium）。
两个坑都很有代表性：

1. **`click({ clickCount: 3 })` 在 `isMobile: true` 下选不中文本** ——
   本意是「三击全选、退格清空」，实际只删掉一个字符，再撞上 `maxlength=6`
   就被静默截断：想输 `A79GTC` 实际输进去的是 `AAAAAA`，
   表现成「核销一直失败」。改成 `el.value = ''` + 派发 `input` 事件。
2. **Toast 会盖住弹层中下部的按钮** —— 1011 的 Toast 持续 2 秒，
   紧接着点「确认核销」会点在 Toast 上，形成「点了没反应」的假失败。
   截图与下一次点击前都要等 Toast 自己消失。

第二个坑在**人工点一遍时也会遇到**，只是人会自动多等一会儿、or 挪一下位置。
把它记录下来，比在 CI 里加一个 `sleep` 更有价值。

#### 18. 拾金不昧证书：先纠正主语，再画图（07 §11 彩蛋）

07 §11 建议把这个证书放在「我的认领」页，括注是「申请人视角转成『归还者视角』」。
但在这个系统里主语是反的：

| 角色 | 在本系统里做了什么 |
| --- | --- |
| `found` 帖的作者 | **捡到东西、交还给失主** —— 拾金不昧的主体 |
| 提交认领的人 | **丢了东西、把东西领回去** —— 失主 |

认领只发生在 `found` 帖上，所以「申请人」永远是失主。
把「拾金不昧」证书发给失主，等于给丢东西的人发拾金不昧奖 —— 语义是拧的。

因此证书改为**颁发给帖主（拾主）**，入口挂在「认领管理」页的已交接卡片上。
这个位置还有个附带好处：`redeemed_at`（归还日期）与帖子标题本来就都在这一页的数据里，
不需要为证书新增任何接口。

实现上的两个选择：

- **用 `<canvas>` 而不是 DOM**。证书的终点是「一张可以保存、可以转发的图片」，
  `canvas.toDataURL('image/png')` 一行就能产出。用 DOM 画得好看，最后还是得引一个
  截图库才能导出，多一个依赖换更少的可控性。
- **画布写死 720×520 逻辑尺寸 + 2 倍超采样**（导出 1440×1040），
  与屏幕 DPR 解耦，任何设备导出的都是同一张图。
- 正文那一行由「固定文案 + 变长昵称 + 固定文案」三段拼成，
  三段各自 `measureText` 后累加算起点。**不要给昵称写死偏移量** ——
  那在昵称长短变化时立刻露馅（要么重叠、要么中间裂一道缝）。

### 本阶段的验收证据

- `go build ./...` / `go vet ./...` 零错误零警告
- `npm run build` 成功（vite v8.3.1）
- 16 条认领流 curl 验收全部通过（含 8 并发重复提交的兜底实测）
- 三个唯一索引逐个实测触发：`uk_post_claimant` → 1008、
  `uk_post_approved` → 1010、`uk_voucher_code` → 重试/哨兵
- 匹配打分实测：相关帖 100 分 4 条理由、无关帖 0 分不入列表
- 浏览器走查 33 张截图存于 `docs/screenshots/p6/`；脚本内置 **11 条硬断言**全部 PASS
  （匹配分数与理由条数、提交后按钮文案、拒绝理由回显、凭证码长度与字符集、
  通过后帖子 `matched`、核销后帖子 `closed` 与认领 `redeemed`、证书 canvas 可导出 PNG）
- 证书彩蛋：canvas 由 2 倍超采样绘制，`toDataURL('image/png')` 实测导出成功
  （这条断言正是发现「弹层懒渲染导致画布空白」的原因，见上文第 18 点）

---

### 附录 F · 环境注意事项

### Windows 下导入 seed 需显式指定 charset

本机 MySQL 客户端默认字符集可能不是 UTF-8（可用
`SHOW VARIABLES LIKE 'character_set_client'` 查看，本机实测为 `gbk`）。
此时直接 `mysql -uroot -p < sql/seed.sql` 会因中文昵称被按 GBK 解码而报：

```
ERROR 1406 (22001) at line 19: Data too long for column 'nickname' at row 3
```

**这不是 schema 的问题**，是客户端连接字符集与文件编码不一致。
解决办法是显式指定 UTF-8：

```bash
mysql --default-character-set=utf8mb4 -uroot -p < sql/seed.sql
```

`Makefile` 的 `make schema` / `make seed` 已加上该参数。

