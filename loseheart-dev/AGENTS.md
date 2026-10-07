# 本项目编码规范

编码风格参照 https://github.com/iWyh2/go-SkyTakeaway ：分层职责、Gin 路由组与中间件、GORM 使用方式、DTO/VO、中文说明注释及现有命名风格。开发相关模块前，按需查看参考项目对应源码，不只依据 README 推断实现。

用户明确约定及本项目已确认的 PRD、接口文档、SQL 优先于参考项目的具体实现。沿用当前 backend 目录结构，不因参考项目布局不同而重构无关代码。密码继续使用 Argon2id，密码长度统一为 8–32 个 Unicode 字符且不 trim 或截断，JWT 使用 HS256、24 小时、token_version；不照搬参考项目的 MD5 密码处理或不符合接口文档的认证方式。

## 模型与业务职责

- `internal/model/entity`、`dto`、`vo` 只写结构体定义、字段标签和必要注释，不写函数或方法。
- 请求参数校验放到对应 `internal/controller` 包；业务校验、实体与响应对象转换放到对应 `internal/service` 包。认证请求校验现位于 `internal/controller/auth`，登录响应转换辅助函数位于 `internal/service/authService.go`。
- 数据库操作明确指定表名，例如 `.Table("users")`，不在实体中添加 `TableName()`。
- DTO 表达请求参数，类型名以 `DTO` 结尾；VO 表达对外响应，类型名以 `VO` 结尾。每个类型添加用途及必要限制的中文注释。entity 表达数据库记录，保留业务语义名称；不直接返回包含敏感字段的实体。
- 公共工具放 `common/utils`，认证与请求防护放 `internal/middleware`；不把业务校验塞进通用工具。
- 项目错误信息和对外错误码统一定义在 `common/constant`；可复用错误值定义在 `common/errors`。调用处直接返回自定义错误，不现场用字符串构造错误；包装底层错误时保留错误链，对外错误码和文案遵守接口文档。

## 测试与改动范围

- 测试文件统一放独立测试目录，例如 `backend/tests`，不在业务、模型或中间件目录新增 `*_test.go`。
- 保留用户已有代码和目录；按当前任务局部修改，不自行改成另一种架构。
- 命名沿用当前模块及参考项目对应风格，使用 gofmt；JSON 字段和错误码继续遵守本项目接口文档。
