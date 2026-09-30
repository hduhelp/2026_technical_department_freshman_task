# 校园失物招领系统

> 2026 杭电助手技术部招新任务 · 提交目录 `kanzakierisa`

一个校园失物招领平台：支持发布失物 / 招领信息、搜索浏览、状态流转，并通过「认领申请 → 帖主审核 → 电子凭证核销」完成点对点交接。

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
