# 代码说明文档

> 随阶段推进增量维护。当前已覆盖 **P1 认证模块**，其余模块在 P7 阶段补全。

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
- 手写参数化 SQL 如何体现 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET`
- 联系方式三级可见性为什么要在 SQL 层决定是否 SELECT `contact`，而不是查出来再删

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

