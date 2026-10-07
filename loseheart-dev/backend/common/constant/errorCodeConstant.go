package constant

// 对外错误码，与接口文档保持一致。
const (
	AuthRequiredCode           = "AUTH_REQUIRED"
	TokenExpiredCode           = "TOKEN_EXPIRED"
	ServiceUnavailableCode     = "SERVICE_UNAVAILABLE"
	AccountDisabledCode        = "ACCOUNT_DISABLED"
	IdentityUnverifiedCode     = "IDENTITY_UNVERIFIED"
	TokenRevokedCode           = "TOKEN_REVOKED"
	PasswordChangeRequiredCode = "PASSWORD_CHANGE_REQUIRED"
	ForbiddenCode              = "FORBIDDEN"
	CSRFInvalidCode            = "CSRF_INVALID"
	InvalidRequestCode         = "INVALID_REQUEST"
	InternalErrorCode          = "INTERNAL_ERROR"
	ResourceNotFoundCode       = "RESOURCE_NOT_FOUND"
)

// 登录接口错误码。
const (
	InvalidCredentialsCode     = "INVALID_CREDENTIALS"
	LoginRateLimitedCode       = "LOGIN_RATE_LIMITED"
	AuthLimiterUnavailableCode = "AUTH_LIMITER_UNAVAILABLE"
	WechatNotBoundCode         = "WECHAT_NOT_BOUND"
	WechatUpstreamErrorCode    = "WECHAT_UPSTREAM_ERROR"
	ValidationErrorCode        = "VALIDATION_ERROR"
)

// 帖子、审核、举报和图片接口错误码。
const (
	PreconditionRequiredCode = "PRECONDITION_REQUIRED"
	ResourceChangedCode      = "RESOURCE_CHANGED"
	StateConflictCode        = "STATE_CONFLICT"
	IdempotencyConflictCode  = "IDEMPOTENCY_CONFLICT"
	PostQuotaExceededCode    = "POST_QUOTA_EXCEEDED"
	UnsupportedMediaTypeCode = "UNSUPPORTED_MEDIA_TYPE"
	FileTooLargeCode         = "FILE_TOO_LARGE"
	OSSUnavailableCode       = "OSS_UNAVAILABLE"
	WechatAlreadyBoundCode   = "WECHAT_ALREADY_BOUND"
)
