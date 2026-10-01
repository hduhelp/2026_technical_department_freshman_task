# 校园失物招领系统

> 2026 杭电助手技术部招新任务 · 提交目录 `kanzakierisa`

一个校园失物招领平台：支持发布失物 / 招领信息、搜索浏览、状态流转，并通过「认领申请 → 帖主审核 → 电子凭证核销」完成点对点交接，另附规则化的智能匹配推荐。

---

## 功能总览

| 模块 | 能力 |
| --- | --- |
| 账号 | 注册 / 登录（JWT HS256）/ 查改个人资料（昵称、联系方式、是否公开） |
| 帖子 | 发布、编辑、删除；列表按类型 / 状态 / 分类 / 关键字组合筛选 + 分页；详情页图片轮播 |
| 图片 | 最多 3 张，png/jpeg，≤2MB，服务端二次校验（扩展名 + MIME + 体积） |
| 状态机 | `open → matched → closed`（另有 `open → closed` 直通），非法流转返回 1007 |
| 联系方式 | 三级可见性：本人 / 作者主动公开 / **双方存在已通过或已核销的认领**；判定在 SQL 层完成 |
| 认领 | 提交认领证明（10–500 字）→ 帖主通过 / 拒绝（可填理由）→ 6 位电子凭证码 → 帖主核销 → 帖子自动结束 |
| 认领约束 | 一张帖最多一条已通过认领、一人一张帖只能申请一次，由 MySQL 唯一索引保证（并发下也不破） |
| 智能匹配 | 中文 2-gram + 规则打分（分类 40 / 地点 30 / 时间 20 / 标题 10，阈值 60，最多 5 条） |
| 彩蛋 | 交接完成后，帖主可领取一张 `<canvas>` 绘制的「拾金不昧荣誉证书」并下载为 PNG |

一键走完认领链路的实测截图见 `docs/screenshots/p6/`（33 张，帖主 / 申请人 / 游客三种视角）。

---

## 演示视频

> 待补充（P7 阶段填入网盘链接）

---

## 快速开始

### 1. 数据库

```bash
cd server
# 方式 A：Docker（推荐）
docker compose up -d
docker compose exec -T mysql mysql -uroot -plostfound123 < sql/schema.sql

# 方式 B：本机 MySQL 8
mysql -uroot -p < sql/schema.sql
```

### 1.5 演示数据

```bash
cd server
# 3 个账号（alice / bob / carol，密码统一 123456）+ 16 条帖子 + 2 条认领记录
# Windows 下必须显式指定字符集，否则中文昵称会按 GBK 解码报错
mysql --default-character-set=utf8mb4 -uroot -p < sql/seed.sql

# 或直接：
make seed
```

### 2. 后端

```bash
cd server
cp .env.example .env      # 按实际情况修改 DB_PASSWORD / JWT_SECRET
go mod tidy
go run ./cmd/api
# → http://localhost:8080/api/health
```

### 3. 前端

```bash
cd web
npm install
npm run dev
# → http://localhost:5173
```

---

## 技术栈

| 层  | 选型 |
| --- | --- |
| 后端 | Go 1.22+ · Gin · database/sql + sqlx（**手写参数化 SQL，不用 ORM**） |
| 数据库 | MySQL 8.0 |
| 认证 | JWT（HS256）· bcrypt（cost=10） |
| 前端 | Vue 3（`<script setup>`）· Vite · Vant 4 · Pinia · Vue Router 4 · Axios |

---

## 文档

| 文件 | 内容 |
| --- | --- |
| [`docs/api.md`](docs/api.md) | 全部接口的请求 / 响应 / 错误码、实体 JSON 形状、软鉴权与分页约定 |
| [`docs/code-guide.md`](docs/code-guide.md) | 分层职责、逐模块文件表，以及每个关键设计决策的取舍理由（面试可讲点） |
| [`docs/wireframe/`](docs/wireframe) | 页面线框 |
| `docs/screenshots/p5/`、`docs/screenshots/p6/` | 浏览器走查截图（发布编辑 36 张、认领链路 32 张） |

---

## 设计思考

> 待补充（P7 阶段）

---

## 明确不做

- 校园统一身份认证对接
- 线上支付 / 酬谢金
- 站内私信 IM
- 拾主主动认领 `lost` 帖（本期只做「失主认领 `found` 帖」单向）
- 服务端 token 黑名单（登出仅前端清 token）
- 对象存储（图片存本地 `uploads/`）
