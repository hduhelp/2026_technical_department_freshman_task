# API 文档

> 占位文件 —— P4 阶段补全完整接口文档。

本文档将覆盖：接口清单、请求/响应示例、错误码表、鉴权说明、分页约定。

**约定速览**

- 基础路径 `/api`，请求与响应体均为 `application/json`（上传接口除外，为 `multipart/form-data`）
- 鉴权：请求头 `Authorization: Bearer <token>`
- 统一响应体：`{ "code": 0, "message": "ok", "data": { } }`
- 列表类接口的 `data` 形如 `{ "list": [], "page": 1, "pageSize": 10, "total": 137 }`
