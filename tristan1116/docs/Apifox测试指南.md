# Apifox 测试指南（校园失物招领系统后端）

> 目标：从零开始，把 12 个接口全部调通，并顺手产出**任务书要求的 API 文档**。
> 配套：[`代码导读.md`](./代码导读.md)、`openapi.json`（一键导入的接口定义文件）

---

## 一、安装

1. 打开 <https://apifox.com/> 下载 Windows 版，安装
2. 注册/登录（免费版够用）

> 为什么用 Apifox 而不是 Postman？任务书明确要求交 **Apifox 的 API 文档**，而且它"调接口 + 写文档"是一体的，省一份工。

---

## 二、建项目 + 导入接口（3 分钟搞定 12 个接口）

### 2.1 新建项目

打开 Apifox → 「新建项目」→ 名称填 `校园失物招领系统` → 确定。

### 2.2 一键导入 12 个接口 ★

**不用手动一个个建**，用项目里已经准备好的 `openapi.json`：

1. 左侧栏找到「项目设置」→「导入数据」
2. 选择「OpenAPI / Swagger」
3. 点「文件导入」，选 **`D:\hdu\杭电助手社团\lostfound\docs\openapi.json`**
4. 预览确认后点「导入」

导入后，左侧「接口」里会出现 **认证**（4 个）和 **物品**（8 个）两个分组，共 12 个接口，
每个都带好了参数说明、请求示例、响应示例。

---

## 三、配环境（让 URL 不用每次手打）

1. 右上角/左侧的「环境管理」→「新建环境」，命名 `本地`
2. 添加变量：

| 变量名 | 值 | 说明 |
|---|---|---|
| `base_url` | `http://localhost:8080` | 后端地址 |
| `token` | （留空） | 登录后自动填，见 4.2 |

3. 保存后，在右上角把当前环境切到「本地」
4. 回到任意接口，把 URL 里的 `http://localhost:8080` 换成 `{{base_url}}`

---

## 四、测试流程（按顺序走一遍就是完整的验收链路）

> ⚠️ 开始前先确认后端在跑：`D:\hdu\杭电助手社团\lostfound\lostfound.exe` 双击运行，
> 看到 `🚀 服务已启动：http://localhost:8080` 即可。

### 4.1 注册（`POST /api/auth/register`）

- Body 选 `json`，填：

```json
{
  "username": "tongshixuan",
  "password": "123456",
  "nickname": "童诗轩",
  "student_id": "23051101"
}
```

- 点「发送」，期望返回：

```json
{"code":0,"message":"注册成功","data":{"id":1,"username":"tongshixuan","nickname":"童诗轩","student_id":"23051101","created_at":"2026-10-06T11:33:50.788+08:00"}}
```

> 注意 `data` 里**没有 password 字段** —— 不是漏了，是故意不给（`json:"-"`）。

**建议再注册第二个账号**（比如 `username: "luren"`），后面测"越权"要用。

### 4.2 登录并自动保存 token ★（关键技巧）

1. 打开 `POST /api/auth/login`，Body 填：

```json
{"username": "tongshixuan", "password": "123456"}
```

2. **先别急着发送**。切到「后置操作」标签 → 「添加后置操作」→「提取变量」：

| 项 | 填什么 |
|---|---|
| 提取来源 | 响应 JSON |
| 表达式 | `$.data.token` |
| 变量名 | `token` |
| 作用域 | 环境变量（选「本地」环境） |

3. 保存，然后发送请求

**效果**：以后每次点登录，Apifox 会自动把返回的 token 存进环境变量 `token`，
其他接口用 `{{token}}` 就能拿到 —— 再也不用复制粘贴了。

### 4.3 用 token 访问需要登录的接口

以 `GET /api/auth/me` 为例：

- 切到「Header」标签，添加一行：

| 参数名 | 值 |
|---|---|
| `Authorization` | `Bearer {{token}}` |

- 发送，期望返回当前用户信息

> 💡 **更省事的做法**：在「目录」（认证/物品）上右键 →「编辑目录」→「认证」里配置
> Bearer Token 用 `{{token}}`，则该目录下所有接口自动带上，不用一个个加。

**验证登录保护是否生效**：把 `Authorization` 这行**临时取消勾选**再发送，
应该返回 `401` + `{"code":1002,"message":"请先登录"}`。

### 4.4 发布一条信息（`POST /api/items`）

Header 带上 `Authorization: Bearer {{token}}`，Body：

```json
{
  "type": "lost",
  "title": "校园卡",
  "category": "card",
  "campus": "下沙校区",
  "place": "图书馆二楼",
  "happened_at": "2026-10-05 14:30",
  "description": "黑色卡套，里面有校园卡和饭卡，捡到请联系我",
  "contact": "微信 xiaoming123"
}
```

期望：`{"code":0,"message":"发布成功","data":{"id":4,...,"status":"searching",...}}`

**注意两点**：
- 返回里**没有 `contact`** —— 故意的
- `status` 是 `searching`，**不管你有没有传** —— 后端强制

### 4.5 列表 / 搜索 / 筛选 / 分页（`GET /api/items`）

在「Params」里挨个试（都是查询参数）：

| 参数 | 试什么值 | 看什么 |
|---|---|---|
| （不填） | — | 默认只看"寻找中"，最新在前 |
| `keyword` | `校园卡` | 模糊匹配物品名称和描述 |
| `type` | `lost` / `found` | 按类型筛选 |
| `category` | `card` / `electronics` / `books` / `clothing` / `daily` / `other` | 按分类筛选 |
| `campus` | `下沙校区` | 按校区筛选 |
| `place` | `图书馆` | 按地点模糊匹配 |
| `status` | `all` / `searching` / `resolved` / `closed` | 状态筛选（`all`=全部） |
| `page` / `page_size` | `1` / `2` | 分页，看 `total` 和 `list` 长度 |

### 4.6 详情（`GET /api/items/4`）

返回里多了 `publisher_nickname` 和 `publisher_student_id`（详情页要显示发布者），
但**依然没有 contact**。

### 4.7 查看联系方式（`GET /api/items/4/contact`）★ 演示重点

- **不带** Authorization → `401 {"code":1002,"message":"请先登录"}`
- **带上**（用第二个账号 `luren` 的 token 更有说服力）→

```json
{"code":0,"message":"ok","data":{"contact":"微信 xiaoming123"}}
```

> 这一组对比就是 PRD 4.5「登录后可见联系方式」的完整证明，**录演示视频时必拍**。

### 4.8 编辑 / 改状态 / 删除

| 操作 | 接口 | 注意 |
|---|---|---|
| 编辑 | `PUT /api/items/4` | Body 里**没有 status 字段** —— 改状态走专门接口 |
| 改状态 | `PATCH /api/items/4/status` | Body `{"status":"resolved"}` |
| 删除 | `DELETE /api/items/4` | 删前先想清楚 |

**一定要试的反例**（面试官最爱看边界处理）：

| 试什么 | 期望 |
|---|---|
| 用 `luren` 的 token 去 `PUT` 童诗轩的帖子 | `403 {"code":1003,"message":"只能操作自己发布的信息"}` |
| 把 `resolved` 改回 `searching` | `400 {"code":1007,"message":"状态只能前进，不能回退"}` |
| `GET /api/items/999999` | `404 {"code":1004,"message":"信息不存在"}` |
| `GET /api/items/abc` | `400 {"code":1001,"message":"id 不合法"}` |
| 注册时 `username` 填 `ab`（少于3位） | `400 {"code":1001,...}` |

---

## 五、错误码速查

| code | HTTP | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 1001 | 400 | 参数错误（含字段校验失败） |
| 1002 | 401 | 未登录 / token 无效或过期 |
| 1003 | 403 | 没有权限（想改别人的帖子） |
| 1004 | 404 | 资源不存在 |
| 1005 | 400 | 用户名已被注册 |
| 1006 | 400 | 用户名或密码错误 |
| 1007 | 400 | 状态只能前进，不能回退 |
| 1008 | 500 | 服务器内部错误 |

---

## 六、产出 API 文档（交付物之一）

接口调通后，Apifox 里的文档基本就齐了，补两件事：

1. **补接口描述**：每个接口点「编辑」→ 把「名称」「描述」写清楚
   （导入的版本已经有 `summary`，你可以按自己习惯润色）
2. **分享/导出**：
   - 「项目设置」→「分享项目」→ 生成在线文档链接
   - 或「导出数据」→ OpenAPI → 得到一份可提交的 `openapi.json`

> 提交要求里说"API 文档"是交付物。最稳的做法：**在线文档链接写进仓库 README.md**，
> 同时把导出的 `openapi.json` 一起放进仓库。

---

## 七、常见问题

| 现象 | 原因 / 解决 |
|---|---|
| 请求发不出去 / 连接被拒绝 | 后端没启动。先运行 `lostfound.exe`，看到"服务已启动"再试 |
| 所有接口都返回 401 | token 没提取成功。回 4.2 检查后置操作的表达式是不是 `$.data.token` |
| token 提取了但还是 401 | token 过期（7 天）或后端重启后 secret 变了 —— 重新登录一次 |
| 返回中文乱码 | Apifox 不会乱码（乱码只会出现在 Git Bash 里，见进度表"已知坑"） |
| 想重新开始 | 清空数据库：`mysql -u root -p -e "USE lostfound; TRUNCATE items; TRUNCATE users;"` |

---

## 八、录演示视频时的推荐动线

按 PRD 第 9 条的验收视角，1 分钟内走完：

```
① 注册新账号（或登录）
② 发布一条失物帖（展示必填项校验）
③ 首页搜索"校园卡" → 命中刚发的帖子
④ 换个账号登录 → 详情页点「查看联系方式」→ 显示联系方式
   （对比：未登录时按钮提示要登录）
⑤ 回到发布者账号 → 把状态改成「已找到」→ 列表状态筛选能看到变化
```

**建议**：先在 Apifox 里把这条动线跑顺、确认每步的返回都对，再去录视频。
