# 代码说明文档

> 随阶段推进增量维护。当前已覆盖 **P1 认证模块 / P3 列表搜索、分页与状态机**，
> P2 的 CRUD 细节与 P6 的认领模块在 P7 阶段并档补全。

本文档将覆盖：目录结构说明、分层职责（handler → service → store）、关键设计决策、可讲点。

**分层约定**

- `handler`：HTTP 编解码 + 参数校验，**不允许出现 SQL**
- `service`：业务规则（状态机、可见性、匹配打分等）
- `store`：SQL 与数据库交互，**不允许出现 HTTP 概念**

---

## P1 · 认证模块

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

### 待补充的可讲点（后续阶段）

- `claims.approved_flag` 生成列 + `UNIQUE(post_id, approved_flag)` 如何在数据库层保证「一个帖子最多一条通过记录」（MySQL 唯一索引允许多个 NULL）
- AI 智能匹配的 2-gram 相似度打分与稳定排序

---

## P3 · 列表搜索、分页与状态机

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

## 环境注意事项

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

