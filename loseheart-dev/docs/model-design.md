# 模型定义与接口对应

依据 `db/schema.sql` 和 `docs/api-design.md`。模型只描述数据，本次不建表、不实现业务接口，不在 entity/dto/vo 中添加方法。

## 数据库实体

| SQL 表 | entity 结构体 |
| --- | --- |
| users | User |
| posts | Post |
| post_daily_quotas | PostDailyQuota |
| post_reviews | PostReview |
| post_reports | PostReport |
| notifications | Notification |
| admin_operation_logs | AdminOperationLog |

所有表的字段都已对应。`AuthUser` 是认证投影，不是新增表。所有查询显式使用 `.Table("SQL 表名")`，不提供 TableName/AutoMigrate/软删除。

数据库 BIGINT UNSIGNED 对应 uint64，版本对应 uint32，可空列使用指针。DATE 使用 time.Time 并明确 type:date；事件日期与额度日期具有北京时间语义，不能把当天北京时间直接按 UTC 日历截断。TIME 使用 *string 存储 HH:mm:ss，接口转换为 HH:mm。

帖子 images、contact_methods 使用 GORM serializer:json；审核快照为 model.PostContent，操作状态为 model.OperationState。联系方式不是独立表，图片也不是独立实体。持久化时无图片要初始化 []string{}，不可用 nil 生成 JSON null；快照数组同样必须按约定初始化。状态快照不保存令牌、密码哈希或联系方式。

## 接口覆盖

下面 VO 是成功响应 data，外层沿用 result.Result[T]（已补 request_id）；失败使用 vo.ErrorResponseVO 的字符串 code。旧 Result.Error() 保留兼容，不能用于新接口错误契约。null 或图片二进制响应不额外创建空结构体。

DTO 类型名统一以 DTO 结尾，VO 类型名统一以 VO 结尾；entity 和共享模型保留业务语义名称。各类型注释说明用途、可见范围和必要限制。

DTO 的路径、查询、请求体、请求头分别用 uri、form、json、header 标签；多个 DTO 在 handler 中分别绑定。JWT、Cookie 和 CSRF 仍由中间件处理。

| 编号 | 接口 | DTO | VO / data |
| --- | --- | --- | --- |
| 2.1 | `GET /api/v1/auth/csrf` | — | CSRFResponseVO |
| 2.2 | `POST /api/v1/auth/tokens` | LoginRequestDTO | LoginResponseVO |
| 2.3 | `DELETE /api/v1/auth/tokens/current` | — | null |
| 3.1 | `GET /api/v1/users/me` | — | UserProfileVO |
| 3.2 | `PUT /api/v1/users/me/password` | ChangePasswordRequestDTO | null |
| 3.3 | `PUT /api/v1/users/me/wechat-binding` | WechatBindingDTO | WechatBindingResponseVO |
| 3.4 | `GET /api/v1/users/me/post-quota` | — | PostQuotaResponseVO |
| 4.1 | `GET /api/v1/posts` | PostQueryDTO | PageResultVO[PostListItemVO] |
| 4.2 | `GET /api/v1/posts/{id}` | IDPathDTO | PostDetailVO / OwnerPostDetailVO（作者） |
| 4.3 | `POST /api/v1/posts` | CreatePostDTO + CreatePostHeaderDTO | OwnerPostDetailVO |
| 4.4 | `PUT /api/v1/posts/{id}` | IDPathDTO + UpdatePostDTO + IfMatchDTO | OwnerPostDetailVO |
| 4.5 | `PATCH /api/v1/posts/{id}/resolution` | IDPathDTO + PostResolutionDTO + IfMatchDTO | PostResolutionResponseVO |
| 4.6 | `GET /api/v1/posts/{id}/reviews` | IDPathDTO + PageQueryDTO | PageResultVO[ReviewRecordVO] |
| 4.7 | `GET /api/v1/users/me/posts` | MyPostQueryDTO | PageResultVO[MyPostListItemVO] |
| 5.1 | `POST /api/v1/users/me/image-uploads` | ImageUploadDTO | ImageUploadResponseVO |
| 5.2 | `GET /api/v1/users/me/image-uploads/{filename}/content` | ImagePreviewPathDTO | 图片二进制 |
| 5.3 | `GET /api/v1/posts/{id}/images/{index}` | PostImagePathDTO + PostImageQueryDTO | 图片二进制 |
| 5.4 | `GET /api/v1/posts/{id}/reviews/{review_id}/images/{index}` | ReviewImagePathDTO | 图片二进制 |
| 6.1 | `POST /api/v1/posts/{id}/reports` | IDPathDTO + CreateReportDTO | CreateReportResponseVO |
| 6.2 | `GET /api/v1/notifications` | NotificationQueryDTO | PageResultVO[NotificationVO] |
| 6.3 | `GET /api/v1/notifications/unread-count` | — | UnreadCountResponseVO |
| 6.4 | `PUT /api/v1/notifications/{id}/read-state` | IDPathDTO + NotificationReadStateDTO | NotificationReadStateResponseVO |
| 7.1 | `GET /api/v1/admin/posts` | AdminPostQueryDTO | PageResultVO[AdminPostListItemVO] |
| 7.2 | `GET /api/v1/admin/posts/{id}` | IDPathDTO | OwnerPostDetailVO（管理员） |
| 7.3 | `PATCH /api/v1/admin/posts/{id}/moderation` | IDPathDTO + PostModerationDTO + IfMatchDTO | PostStateResponseVO |
| 7.4 | `GET /api/v1/admin/reviews` | ReviewQueryDTO | PageResultVO[ReviewRecordVO] |
| 7.5 | `GET /api/v1/admin/reviews/{id}` | IDPathDTO | ReviewDetailVO |
| 7.6 | `PUT /api/v1/admin/reviews/{id}/decision` | IDPathDTO + ReviewDecisionDTO + IfMatchDTO | ReviewDecisionResponseVO |
| 8.1 | `GET /api/v1/admin/reports` | ReportQueryDTO | PageResultVO[ReportRecordVO] |
| 8.2 | `GET /api/v1/admin/reports/{id}` | IDPathDTO | ReportDetailVO |
| 8.3 | `PUT /api/v1/admin/reports/{id}/decision` | IDPathDTO + ReportDecisionDTO + IfMatchDTO | ReportDecisionResponseVO |
| 9.1 | `GET /api/v1/admin/users` | AdminUserQueryDTO | PageResultVO[AdminUserVO] |
| 9.2 | `GET /api/v1/admin/users/{id}` | IDPathDTO | AdminUserVO |
| 9.3 | `PATCH /api/v1/admin/users/{id}/status` | IDPathDTO + UserStatusDTO | UserStatusResponseVO |
| 9.4 | `POST /api/v1/admin/users/{id}/password-resets` | IDPathDTO + PasswordResetDTO | PasswordResetResponseVO |
| 10.1 | `GET /api/v1/admin/operation-logs` | OperationLogQueryDTO | PageResultVO[OperationLogVO] |
| 10.2 | `GET /api/v1/admin/operation-logs/{id}` | IDPathDTO | OperationLogVO |

## 业务层仍需落实的规则

- PageQueryDTO 使用 *int 区分缺失与显式 0。缺失在业务层填默认 page=1、page_size=20，显式 0 必须拒绝。
- 严格 JSON 解码，拒绝未知字段；required 和字段标签不能代替跨字段及权限检查。
- 日期不可未来、范围日期和时间顺序、time_precision 与时间字段组合、非空白文本、图片归属与存在性由业务层校验。
- ID 需严格解析正整数及 uint64 上限；If-Match、幂等键与并发版本绑定真实资源，不只按非空判断。
- 举报 other 原因、审核 returned/rejected 原因、举报处理状态/动作/版本、微信换绑密码等条件规则在服务层处理。
- entity 禁止直接作为 JSON 响应；VO ID 是十进制字符串，时间为 RFC3339，可空字段输出 null，列表 records 和图片数组不能输出 null。
- 普通 PostDetailVO 不包含内部 Object Key 或审核说明；OwnerPostDetailVO 仅用于作者/管理员，并先完成访问权限检查。
- 返回临时密码仅允许管理员重置成功的本次响应；禁止记录 DTO 密码、临时密码、登录 JWT 或 OSS 凭证。

## 验证记录

已核对 7 张表的全部 90 个字段；34 份文档 JSON 响应示例均能由对应 VO 严格解码；7 个实体通过 GORM schema 解析。确认空图片数组可接受、缺失图片数组拒绝、read=false 拒绝、page=0 拒绝。检查通过不代表建表、数据库读写或业务规则已实现。
