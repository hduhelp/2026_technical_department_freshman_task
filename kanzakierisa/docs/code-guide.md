# 代码说明文档

> 占位文件 —— P7 阶段补全。

本文档将覆盖：目录结构说明、分层职责（handler → service → store）、关键设计决策、可讲点。

**分层约定**

- `handler`：HTTP 编解码 + 参数校验，**不允许出现 SQL**
- `service`：业务规则（状态机、可见性、匹配打分等）
- `store`：SQL 与数据库交互，**不允许出现 HTTP 概念**

**待补充的可讲点**

- `claims.approved_flag` 生成列 + `UNIQUE(post_id, approved_flag)` 如何在数据库层保证「一个帖子最多一条通过记录」（MySQL 唯一索引允许多个 NULL）
- 手写参数化 SQL 如何体现 `WHERE / LIKE / ORDER BY / LIMIT / OFFSET`
- 联系方式三级可见性为什么要在 SQL 层决定是否 SELECT `contact`，而不是查出来再删
