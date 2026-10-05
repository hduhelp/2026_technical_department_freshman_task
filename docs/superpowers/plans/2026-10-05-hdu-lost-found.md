# 杭州电子科技大学失物招领系统实施计划

> **供执行代理使用：** 必须使用 `superpowers:executing-plans` 逐任务执行。每个步骤使用复选框跟踪。

**目标：** 在 `wangcheng071029/` 中交付一个可本机演示、可提交 GitHub 的中文失物招领系统。

**架构：** 一个 Go 程序以 Gin 提供接口并托管静态网页。GORM 使用 SQLite 保存用户和信息；JWT 中间件处理登录态，原生 JavaScript 负责页面交互。

**技术栈：** Go、Gin、GORM、SQLite、JWT、bcrypt、HTML、CSS、JavaScript。

**设计依据：** `docs/superpowers/specs/2026-10-05-hdu-lost-found-design.md`

## 全局约束

- 所有产品代码、静态资源、测试与 README 放在 `wangcheng071029/`。
- 终端、页面、README 与接口文档使用中文；代码标识符遵循 Go 英文惯例。
- 数据库使用项目内 SQLite 文件，不要求安装外部数据库。
- 页面不使用前端框架；服务端使用 Gin、GORM 与 JWT。
- 信息状态只能依次从“寻找中”变为“已找到”再变为“已结束”。
- 每个后端行为先观察到失败测试，再写最小代码使其通过。

## 审查重点

- 空用户名、密码或信息字段必须被拒绝；对应测试放在任务 1 和任务 2。
- 无令牌、伪造令牌和他人令牌不得读取当前用户或修改信息；对应测试放在任务 1 和任务 2。
- “已结束”或跨级状态变更必须被拒绝；对应测试放在任务 2。
- 搜索结果必须仅匹配物品、地点或描述，分页页码不能返回重复记录；对应测试放在任务 2。
- 刷新页面后有效登录令牌应恢复登录状态，且未登录时不能显示本人操作；对应测试放在任务 3 的浏览器手工验证。

### 任务 1：建立服务与账户认证

**文件：**

- 创建：`wangcheng071029/go.mod`
- 创建：`wangcheng071029/main.go`
- 创建：`wangcheng071029/main_test.go`
- 创建：`wangcheng071029/.gitignore`

**接口：**

- 产生：`newRouter(db *gorm.DB, secret []byte) *gin.Engine`，供测试与 `main()` 创建服务。
- 产生：`User` 模型和 `POST /api/auth/register`、`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`。
- 消费：任务 2 在同一 `newRouter` 上注册信息接口。

- [ ] **步骤 1：编写账户认证失败测试**

在 `main_test.go` 中编写临时 SQLite 数据库测试：注册成功后可登录并取得用户；错误密码和无令牌访问 `/api/auth/me` 分别返回未授权。

- [ ] **步骤 2：运行测试，确认其因路由尚不存在而失败**

运行：`go test ./...`

预期：失败，提示 `newRouter` 或认证接口尚未定义。

- [ ] **步骤 3：实现最小账户模型和认证路由**

在 `main.go` 中实现 `newRouter(db *gorm.DB, secret []byte) *gin.Engine`：自动迁移用户模型，bcrypt 保存密码，登录签发带用户 ID 的 JWT，中间件从 `Authorization: Bearer <token>` 读取用户 ID。退出接口返回成功 JSON，浏览器负责删除令牌。

- [ ] **步骤 4：运行测试，确认认证行为通过**

运行：`go test ./...`

预期：通过。

- [ ] **步骤 5：提交任务代码**

运行：`git add wangcheng071029/go.mod wangcheng071029/main.go wangcheng071029/main_test.go wangcheng071029/.gitignore && git commit -m "feat: 添加用户认证接口"`

### 任务 2：实现失物招领信息接口

**文件：**

- 修改：`wangcheng071029/main.go`
- 修改：`wangcheng071029/main_test.go`

**接口：**

- 消费：任务 1 的 JWT 中间件和 `newRouter`。
- 产生：`Post` 模型和 `/api/posts` 的创建、列表、详情、更新、删除、状态变更接口。

- [ ] **步骤 1：编写信息生命周期失败测试**

在 `main_test.go` 中使用两个真实账号和临时 SQLite：创建信息；关键词搜索；按类型和状态筛选；分页；作者更新、删除与推进状态；另一账号修改时返回禁止；从“寻找中”直接到“已结束”时返回错误。

- [ ] **步骤 2：运行测试，确认其因信息路由尚不存在而失败**

运行：`go test ./...`

预期：失败，提示 `/api/posts` 路由返回非预期状态。

- [ ] **步骤 3：实现最小信息模型和路由**

在 `main.go` 中添加 `Post`、请求结构和路由。列表查询使用 GORM 链式条件：`WHERE` 筛选类型/状态，`LIKE` 匹配物品名称、地点和描述，`ORDER BY created_at DESC` 排序，`LIMIT` 与 `OFFSET` 分页。所有写操作先校验 JWT 用户为作者，再执行字段校验或状态流转校验。

- [ ] **步骤 4：运行测试，确认信息生命周期通过**

运行：`go test ./...`

预期：通过。

- [ ] **步骤 5：提交任务代码**

运行：`git add wangcheng071029/main.go wangcheng071029/main_test.go && git commit -m "feat: 添加失物招领信息管理"`

### 任务 3：制作中文浏览器界面

**文件：**

- 创建：`wangcheng071029/static/index.html`
- 创建：`wangcheng071029/static/style.css`
- 创建：`wangcheng071029/static/app.js`
- 修改：`wangcheng071029/main.go`

**接口：**

- 消费：任务 1、2 的认证和信息 JSON 接口。
- 产生：由服务端托管的 `/` 页面，可完成演示流程。

- [ ] **步骤 1：定义可手工验证的页面验收清单**

在任务笔记中记录：未登录可浏览；注册后自动登录；发布校园卡失物信息；另一个账号发布招领信息；发布者可编辑、删除并将状态标记为已找到；搜索与分页可用；小屏视口不溢出。

- [ ] **步骤 2：启动当前服务并确认页面尚不可访问**

运行：`go run .`

预期：根路径没有可用的完整中文界面。

- [ ] **步骤 3：实现静态页面和服务托管**

在 `main.go` 托管 `static/`；在 `index.html` 创建标题、账户区、搜索筛选区、发布表单、信息列表和“我的发布”区域。`app.js` 用 `fetch` 调用既有 API，保存和移除 `localStorage` 中的令牌，只为当前用户的信息显示编辑、删除和状态按钮。`style.css` 采用清晰的卡片布局和移动端媒体查询。

- [ ] **步骤 4：按清单执行浏览器手工验证**

运行：`go test ./...`，随后启动 `go run .`，在浏览器完成步骤 1 中的验收清单；小屏宽度下验证表单与卡片可用。

预期：自动化测试通过，所有页面流程可完成。

- [ ] **步骤 5：提交任务代码**

运行：`git add wangcheng071029/static wangcheng071029/main.go && git commit -m "feat: 添加中文网页界面"`

### 任务 4：补齐交付文档并完成演示验证

**文件：**

- 创建：`wangcheng071029/README.md`
- 创建：`wangcheng071029/apifox-接口示例.json`
- 修改：`wangcheng071029/main.go`

**接口：**

- 消费：已完成的服务和网页。
- 产生：面试者可按 README 独立启动、用 Apifox 导入示例接口并完成演示。

- [ ] **步骤 1：编写状态流转失败测试**

在 `main_test.go` 增加针对“已找到 → 已结束”成功和“已结束后继续变更”失败的断言。

- [ ] **步骤 2：运行测试，确认新增断言在当前实现缺口处失败**

运行：`go test ./...`

预期：若状态边界尚未覆盖，测试失败；若任务 2 已完整实现，该测试改为验证现有正确行为并记录为已有覆盖。

- [ ] **步骤 3：补足最小状态边界实现并编写交付说明**

若步骤 2 发现缺口，在 `main.go` 中修正状态校验。以中文编写 README：功能、技术栈、环境要求、启动命令、演示脚本、JWT 简介和 SQL 查询关键字说明。导出能导入 Apifox 的接口示例 JSON。

- [ ] **步骤 4：执行最终验证**

运行：`go test ./...`、`go vet ./...`、`go run .`，并对根页面执行 HTTP 200 检查；按 README 的演示脚本完整走一遍。

预期：全部测试和静态检查通过，页面返回 HTTP 200，核心流程可演示。

- [ ] **步骤 5：提交交付文件**

运行：`git add wangcheng071029/README.md wangcheng071029/apifox-接口示例.json wangcheng071029/main.go wangcheng071029/main_test.go && git commit -m "docs: 补充运行与接口说明"`

## 自检

- 需求覆盖：任务 1 覆盖账号能力；任务 2 覆盖信息 CRUD、权限、状态和数据库查询；任务 3 覆盖实机页面；任务 4 覆盖 Apifox、中文说明和最终验证。
- 一致性：所有任务共享 `newRouter`、JWT 用户 ID 和 `Post` 状态枚举，页面只调用已在接口表声明的路径。
- 边界：空字段、无效令牌、越权修改、非法状态、搜索与分页均有对应验证。
- 范围：未加入图片、私信、管理员等未要求功能。
