# 后端验证

所有测试放在本目录，业务、实体、DTO、VO 目录不放测试文件。在 `backend` 目录执行：

```bash
go test -race ./...
LOST_FOUND_INTEGRATION=1 go test -race ./... -count=1
go vet ./...
go build ./...
```

第二条命令需要项目 MySQL、Redis 容器运行，以及已填写且被 Git 忽略的 `configs/config.local.yaml`。测试创建独立账号、帖子、通知和日志，并只清理自己的记录和 Redis 键，不清空数据库、不修改演示账号。

| 目录 | 验证范围 |
| --- | --- |
| router | 37 个路由与接口文档一致，认证、角色、CSRF、受限账号和安全错误响应 |
| auth | Argon2id、密码长度、登录限流、Cookie/Bearer、资料与修改密码 |
| accounts | 微信绑定/换绑、令牌撤销、用户管理、重置密码、通知归属和已读幂等 |
| posts | 发帖额度并发、创建幂等、版本与快照、完成/撤回、图片上传与访问权限 |
| moderation | 人工审核、重审、下架、举报去重和处置、日志快照、事务回滚与并发决定 |
| integration | 真实 HTTP 路由串起投稿→审核→编辑重审→举报下架→重新提交→完成/撤回→通知/日志 |

微信回归测试模拟上游响应，真实微信 code 联调工具在 `wechat`。图片权限回归使用真实 OSS SDK 配合模拟 HTTP 响应。真实私有 Bucket 的上传、Head 和读取可单独运行：

```bash
LOST_FOUND_OSS_INTEGRATION=1 go test ./tests/integration -run PrivateOSS -count=1 -v
```

这条命令使用普通演示账号上传一张无个人信息的 88 字节测试 PNG，并按演示阶段保留图片的约定长期保留对象；默认测试不执行云端写入。真实 OSS 检查已于 2026-10-06 通过。
