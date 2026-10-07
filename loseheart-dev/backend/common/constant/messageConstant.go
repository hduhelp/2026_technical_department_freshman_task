package constant

const (
	JwtParseError = "jwt解析token出现异常"
	UploadFailed  = "文件上传失败"
)

// 配置、认证及请求参数校验错误信息。
const (
	RedisConnectionError     = "redis connection error"
	JWTConfigError           = "JWT requires a 32-byte secret, issuer and audience"
	JWTIdentityError         = "invalid JWT identity"
	JWTClaimsError           = "invalid JWT claims"
	JWTSubjectError          = "invalid JWT subject"
	RouterDependencyError    = "router requires authentication and CSRF protection"
	InvalidClientTypeError   = "invalid client_type"
	InvalidAccountNoError    = "account_no must contain 1-32 ASCII characters"
	AccountNoASCIIError      = "account_no must be ASCII"
	InvalidPasswordError     = "password must contain 8-32 characters"
	WechatCodeRequestError   = "wechat_code requires miniapp and code"
	InvalidGrantTypeError    = "invalid grant_type"
	AuthDatabaseError        = "authentication database unavailable"
	AuthenticatorConfigError = "JWT requires a 32-byte secret, issuer, audience and user lookup"
	CSRFConfigError          = "CSRF requires authentication, an independent 32-byte secret and allowed origins"
	CSRFCookieNameError      = "CSRF and JWT cookies must have different names"
	AllowedOriginError       = "invalid allowed origin"
	LoginCSRFContextError    = "invalid login CSRF context"
	AuthUserLookupError      = "authentication user lookup"
)

// 接口响应信息，保持现有对外契约。
const (
	AuthRequired           = "请重新登录"
	TokenExpired           = "登录已过期"
	ServiceUnavailable     = "服务暂不可用"
	AccountDisabled        = "账号已禁用"
	IdentityUnverified     = "校园身份尚未验证"
	TokenRevoked           = "登录已失效"
	PasswordChangeRequired = "请先修改密码"
	Forbidden              = "无权限执行此操作"
	CSRFInvalid            = "请求校验失败，请刷新后重试"
	CSRFSourceDenied       = "请求来源不允许"
	BearerCSRFNotRequired  = "Bearer 登录不需要网页 CSRF 凭证"
	InternalError          = "服务内部错误"
	ResourceNotFound       = "接口不存在"
	Success                = "成功"
)

// ErrorWrapFormat 同时保留项目错误类别与底层错误链。
const ErrorWrapFormat = "%w: %w"

// 登录业务错误信息。
const (
	InvalidCredentials     = "账号或密码错误"
	LoginRateLimited       = "登录尝试过于频繁，请稍后重试"
	AuthLimiterUnavailable = "登录限制服务暂不可用"
	WechatNotBound         = "微信身份尚未绑定平台账号"
	WechatUpstreamError    = "微信登录服务暂不可用"
	PasswordHashError      = "密码哈希记录无效"
	InvalidRequest         = "请求格式或参数错误"
	ValidationError        = "登录参数不符合要求"
)

// 平台密码字符数范围，按 Unicode 字符计数。
const (
	PasswordMinLength = 8
	PasswordMaxLength = 32
)

// 修改密码参数校验信息。
const PasswordUnchanged = "新密码不能与当前密码相同"

// 业务资源和通知文案；对外响应统一使用这些常量，不拼接底层数据库信息。
const (
	PreconditionRequired             = "请携带资源的 If-Match 版本"
	ResourceChanged                  = "资源已更新，请刷新后重试"
	StateConflict                    = "当前状态不允许此操作"
	IdempotencyConflict              = "同一幂等键对应的请求内容不一致"
	PostQuotaExceeded                = "今日发帖额度已用完"
	UnsupportedMediaType             = "不支持的文件或请求格式"
	FileTooLarge                     = "图片大小不能超过 5 MiB"
	OSSUnavailable                   = "图片存储服务暂不可用"
	WechatAlreadyBound               = "微信身份已绑定其他平台账号"
	NotificationReviewTitle          = "帖子审核结果"
	NotificationRemovedTitle         = "帖子已下架"
	NotificationReportTitle          = "举报处理结果"
	NotificationAccountTitle         = "账号状态变更"
	NotificationPasswordResetTitle   = "密码已重置"
	NotificationPasswordResetContent = "管理员已重置密码，请使用新密码登录并立即修改密码"
	ReviewApprovedReason             = "审核通过"
	FieldValidationMessage           = "%s 不符合 %s 规则"
)
