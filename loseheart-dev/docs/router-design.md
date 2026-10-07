# 路由分组与接入

当前全部 37 个接口的 HTTP 方法和路径依据 `api-design.md` 注册。实现位于 `backend/internal/router`，认证规则由 `internal/middleware` 执行。

## 入口与依赖

`router.InitRouter(auth, csrf)` 返回 `*gin.Engine, error`。启动层先加载配置、连接数据库，初始化认证器与 CSRF 防护。路由直接引用 controller 的具名函数。

controller 按 `auth/`、`user/`、`admin/` 分目录，函数统一接收 `*gin.Context`。全部接口已接通对应 Service，Controller 负责请求绑定、参数校验、状态码和响应头；Service 负责权限、状态流转、事务以及响应对象转换。

`cmd/server/main.go` 已接入配置初始化、数据库与 Redis、JWT 认证器、CSRF 防护和 HTTP 路由。启动需在 backend 目录执行 `go run ./cmd/server`。网页来源从 YAML 的 `csrf.allowedOrigins` 读取，Cookie Secure 选项读取 `csrf.secureCookie`。

## 三层路由分组

```go
api := r.Group("/api/v1")
api.Use(csrf.RequireCSRF())

// user.InitUserRouter 内部创建用户组。
userGroup := api.Group("")
userGroup.Use(auth.RequireAuth())

// admin.InitAdminRouter 内部独立创建管理组。
adminGroup := api.Group("/admin")
adminGroup.Use(auth.RequireAuth(), middleware.RequireAdmin())
```

`Group` 为路径增加前缀并继承父组中间件。`Use` 将中间件加入该组后续注册的路由链，不是注册一个单独的 HTTP 接口。

1. `/api/v1/auth/csrf` 和 POST `/api/v1/auth/tokens` 注册到 api：无需先登录，但网页来源与 CSRF 仍受检查。小程序首次 JSON 登录按原有无 Cookie、无浏览器来源头规则处理。
2. 帖子、个人资料、图片、通知、退出、改密注册到 userGroup：校验 JWT 及数据库实时账号状态和 token_version。
3. `/api/v1/admin/...` 注册到 adminGroup：继承 api 的 CSRF 防护，再检查登录身份和数据库实时管理员角色。

例如 GET `/api/v1/admin/posts` 的处理链为：请求 ID → 请求日志 → panic 恢复 → CSRF（GET 放行）→ Auth → Admin → 管理员帖子列表 handler。任何校验失败都调用 Abort，业务 handler 不执行。

网页修改请求校验 CSRF；已验证纯 Bearer 请求免 CSRF。退出、改密必须认证，但强制改密用户仍能执行这两项操作及获取 CSRF。帖子所有权、审核状态转换、图片归属和敏感事务内的用户状态复查由业务层继续执行。

## 文件职责

- 顶层 `router.go`：创建引擎、请求 ID、恢复处理、404、公共 CSRF 分组，再调用用户端和管理端入口。
- 顶层 `authRouter.go`：登录和 CSRF 凭证接口。
- `user/userRouter.go`：挂用户认证、注册退出接口、组装用户端各模块。
- `user/profileRouter.go`：当前用户资料、密码、微信绑定、发帖额度和我的帖子。
- `user/postRouter.go`、`imageRouter.go`、`reportRouter.go`、`notificationRouter.go`：分别注册对应业务接口。
- `admin/adminRouter.go`：挂认证与管理员权限中间件，组装管理端各模块。
- `admin/` 下其余模块路由文件保留各自职责。

用户端路由直接引用 `controller/user`，管理端路由直接引用 `controller/admin`；登录和退出引用 `controller/auth`。三个 `handlers.go` 和注册辅助文件已移除，具体接口直接使用 Gin 的 GET、POST、PUT、PATCH、DELETE 方法注册。

`/:id` 是 Gin 的路径参数写法，对应接口文档 `{id}`；例如请求 `/posts/100` 时，handler 通过 `ctx.Param("id")` 取得 `"100"`，随后严格解析、绑定 DTO 并执行权限检查。

## 业务事务与图片读取

`controller/request.go` 统一严格 JSON 解析、分页边界、路径 ID、If-Match 和错误响应；业务规则仍留在对应 Controller/Service。`service/businessService.go` 提供带实时账号复查的事务入口。涉及多个用户的管理员操作，先按用户 ID 升序取行锁，再锁帖子、审核或举报记录，避免通知外键与作者编辑形成循环等待。

创建帖子把幂等记录、帖子、审核快照和 MySQL 当日额度放在同一事务内；编辑创建新快照并隐藏当前内容。审核、下架及举报处理把状态、通知和管理日志放在同一事务内；失败整体回滚，过期 ETag 不自动重试。

图片保留在私有 OSS；数据库只保存有序 Object Key 数组。客户端使用平台图片接口，后端先检查账号、归属、帖子版本和可见权限，再读取 OSS，不交付长期公开 URL。

## 验证

在 backend 下执行：

```bash
go test -race ./...
LOST_FOUND_INTEGRATION=1 go test -race ./... -count=1
go vet ./...
go build ./...
```

`tests/router/router_test.go` 通过接口文档核对全部路由，验证认证/角色/CSRF 校验、改密受限账号的允许操作、缺少依赖，以及 panic 和 404 响应。它使用替代用户查询；业务到达尚未初始化的数据库时应返回 503。其他独立测试目录验证真实业务，范围和运行方式见 `backend/tests/README.md`。
