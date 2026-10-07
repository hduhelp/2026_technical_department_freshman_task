# 登录接口实现与验证

入口：POST `/api/v1/auth/tokens`，请求和响应沿用 `api-design.md` 2.2。

## 调用流程

1. 路由层先执行来源及 CSRF 检查；不依赖 client_type 绕过检查。
2. controller 在解析前调用 Redis 来源限速：同一来源首次请求起 60 秒最多 30 次。当前直连本机，不信任 X-Forwarded-For。
3. 严格解码 JSON（拒绝未知字段、尾随数据），校验条件必填及密码长度，不记录输入密码或完整 DTO。
4. service 密码分支读取暂停状态，在用户行锁事务中验证 Argon2id（19 MiB、2 次、并行度 1、随机 16 字节盐、32 字节哈希）。未知账号执行等成本哈希并返回同样的 INVALID_CREDENTIALS。
5. Redis Lua 原子维护连续失败：首次失败起 10 分钟，5 次失败暂停 10 分钟。暂停期不延长；成功密码验证清除失败计数，不清除来源计数。Redis 故障返回 503 AUTH_LIMITER_UNAVAILABLE。
6. 微信分支向固定 HTTPS code2Session 接口交换身份，再查询已绑定的平台账号；不自动创建账号。不记录 AppSecret、一次性 code、session_key 或上游 URL。
7. 持有用户行锁时检查实时账号状态、校园认证和管理员权限，并读取 token_version 签发 24 小时 JWT，正常登录不递增版本。后续改密、禁用、退出、换绑实现也必须与同一用户行锁协调。
8. 网页只通过 HttpOnly、SameSite=Lax、Path=/api Cookie 交付 JWT，并签发绑定新 jti 的 CSRF。小程序只返回 access_token/token_type，不设置 Cookie。响应 Cache-Control: no-store。

登录结果模型位于 `internal/model/auth/login.go`；不直接序列化它，返回前转换为 VO。业务错误集中定义在 common/constant 和 common/errors，不暴露 SQL 或上游凭证。

## 验证

在 backend 目录执行：

```bash
go test -race ./...
LOST_FOUND_INTEGRATION=1 go test -race ./tests/auth -count=1
```

集成测试使用本项目本机 MySQL 和 Redis；创建唯一测试账号，结束后只清理本次账号与对应键。验证网页/小程序交付、普通账号管理端拒绝、管理员登录、禁用/未验证账号、强制改密、旧版本令牌、并发失败、暂停最后不足一秒、窗口到期、成功重置、来源限速、Redis 故障与微信绑定分支。

微信上游使用测试替代 HTTP Transport。真实微信授权码和本项目绑定流程仍待开发者工具联调；未配置 AppSecret 时返回 502 WECHAT_UPSTREAM_ERROR。其他 controller 仍为空函数体，测试通过不代表完整业务完成。
