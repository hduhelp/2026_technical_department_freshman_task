# 本机 MySQL 与 Redis

在项目根目录执行：

```bash
docker compose -f deploy/compose.yaml up -d --wait --wait-timeout 180
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml stop
```

| 服务 | 容器 | 本机地址 | 数据卷 |
| --- | --- | --- | --- |
| MySQL 8.4 | lost-found-mysql | 127.0.0.1:13308 | lost-found-mysql-data |
| Redis 7.4 | lost-found-redis | 127.0.0.1:16379 | lost-found-redis-data |

MySQL 数据库和应用用户名均为 `lost_found`，后端不使用 root。连接使用 utf8mb4，数据库及 DSN 时区为 UTC。Redis 要求密码，开启 AOF 与每秒同步。两个端口只绑定本机回环地址。

私有密码在 `deploy/.env`，应用连接参数在 `backend/configs/config.local.yaml`；二者已加入 Git 忽略。JWT 有效期为 24 小时，签名及 CSRF 密钥需随机生成。提交的配置范本不包含私有凭证。OSS 和微信的运行验证与边界见 [验证记录](../frontend/VERIFICATION.md)，新环境需填写自己的云端配置。

新机器部署时，按 `.env.example` 创建 `deploy/.env` 并生成随机密码，再同步填写应用配置。MySQL 初始化环境变量仅在空数据卷首次启动时生效；不能通过修改 `.env` 来更改现有数据库密码。

`db/schema.sql` 创建 7 张业务表，包含主键、唯一索引、外键及 CHECK 约束。账号由平台预置，密码保存为 Argon2id。本机演示凭证保存在未跟踪的 `deploy/demo-accounts.local.json`（权限 0600），不写入 Git；本机业务数据不会随代码复制。新机器需在空数据库上执行建表 SQL：

```bash
docker exec -i lost-found-mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --protocol=TCP -h 127.0.0.1 -u lost_found -D lost_found' < db/schema.sql
```

此脚本用于首次建表，已有表时不要重复执行。健康检查与连接成功不代表业务接口已实现。不要用带 `-v` 的 down 命令清理持久数据卷。

镜像配置依据：[MySQL 官方镜像](https://hub.docker.com/_/mysql)、[Redis 官方镜像](https://hub.docker.com/_/redis)。
