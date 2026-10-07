package errors

import (
	"errors"
	"lost-found/backend/common/constant"
)

var (
	RedisConnectionError = errors.New(constant.RedisConnectionError)
	JwtParseError        = errors.New(constant.JwtParseError)
	UploadFileError      = errors.New(constant.UploadFailed)
)

// 统一复用的错误值，可通过 errors.Is 判断。
var (
	JWTConfigError           = errors.New(constant.JWTConfigError)
	JWTIdentityError         = errors.New(constant.JWTIdentityError)
	JWTClaimsError           = errors.New(constant.JWTClaimsError)
	JWTSubjectError          = errors.New(constant.JWTSubjectError)
	RouterDependencyError    = errors.New(constant.RouterDependencyError)
	InvalidClientTypeError   = errors.New(constant.InvalidClientTypeError)
	InvalidAccountNoError    = errors.New(constant.InvalidAccountNoError)
	AccountNoASCIIError      = errors.New(constant.AccountNoASCIIError)
	InvalidPasswordError     = errors.New(constant.InvalidPasswordError)
	WechatCodeRequestError   = errors.New(constant.WechatCodeRequestError)
	InvalidGrantTypeError    = errors.New(constant.InvalidGrantTypeError)
	AuthDatabaseError        = errors.New(constant.AuthDatabaseError)
	AuthenticatorConfigError = errors.New(constant.AuthenticatorConfigError)
	CSRFConfigError          = errors.New(constant.CSRFConfigError)
	CSRFCookieNameError      = errors.New(constant.CSRFCookieNameError)
	AllowedOriginError       = errors.New(constant.AllowedOriginError)
	LoginCSRFContextError    = errors.New(constant.LoginCSRFContextError)
	AuthUserLookupError      = errors.New(constant.AuthUserLookupError)
	InternalError            = errors.New(constant.InternalError)
	AuthRequiredError        = errors.New(constant.AuthRequired) //  表示当前登录身份无效，需要重新登录。
)

// 登录业务可识别错误值。
var (
	InvalidCredentialsError     = errors.New(constant.InvalidCredentials)
	LoginRateLimitedError       = errors.New(constant.LoginRateLimited)
	AuthLimiterUnavailableError = errors.New(constant.AuthLimiterUnavailable)
	WechatNotBoundError         = errors.New(constant.WechatNotBound)
	WechatUpstreamError         = errors.New(constant.WechatUpstreamError)
	PasswordHashError           = errors.New(constant.PasswordHashError)
	InvalidRequestError         = errors.New(constant.InvalidRequest)
	ValidationError             = errors.New(constant.ValidationError)
)

var (
	AccountDisabledError    = errors.New(constant.AccountDisabled)
	IdentityUnverifiedError = errors.New(constant.IdentityUnverified)
	ForbiddenError          = errors.New(constant.Forbidden)
)

// 修改密码业务错误值。
var (
	PasswordUnchangedError      = errors.New(constant.PasswordUnchanged)
	PasswordChangeRequiredError = errors.New(constant.PasswordChangeRequired)
	TokenRevokedError           = errors.New(constant.TokenRevoked)
)

// 业务错误作为稳定错误值，controller 使用 errors.Is 识别。
var (
	ResourceNotFoundError     = errors.New(constant.ResourceNotFound)
	PreconditionRequiredError = errors.New(constant.PreconditionRequired)
	ResourceChangedError      = errors.New(constant.ResourceChanged)
	StateConflictError        = errors.New(constant.StateConflict)
	IdempotencyConflictError  = errors.New(constant.IdempotencyConflict)
	PostQuotaExceededError    = errors.New(constant.PostQuotaExceeded)
	UnsupportedMediaTypeError = errors.New(constant.UnsupportedMediaType)
	FileTooLargeError         = errors.New(constant.FileTooLarge)
	OSSUnavailableError       = errors.New(constant.OSSUnavailable)
	WechatAlreadyBoundError   = errors.New(constant.WechatAlreadyBound)
)
