package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/config"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/dto"
	result "lost-found/backend/internal/model/result"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// Login 校验请求、调用登录业务，并按网页 Cookie / 小程序 Bearer 交付凭证。
func Login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	// 在参数解析前计来源次数；不打印 DTO、密码或令牌。
	retry, err := service.LoginSourceLimit(ctx, c.ClientIP())
	if err != nil {
		loginError(c, err, retry)
		return
	}

	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		loginError(c, errs.InvalidRequestError, 0)
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	var input dto.LoginRequestDTO
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		loginError(c, errs.InvalidRequestError, 0)
		return
	}

	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		loginError(c, errs.InvalidRequestError, 0)
		return
	}
	if err := ValidateLoginRequest(input); err != nil {
		loginError(c, errs.ValidationError, 0)
		return
	}

	output, retry, err := service.Login(ctx, input)
	if err != nil {
		loginError(c, err, retry)
		return
	}

	data := vo.LoginResponseVO{
		User:      service.NewLoginUser(output.User),
		ExpiresAt: output.Claims.ExpiresAt.Time,
	}
	if input.ClientType == "miniapp" {
		data.AccessToken = output.Token
		data.TokenType = "Bearer"
	} else {
		csrfToken, err := middleware.IssueLoginCSRF(c, output.Claims.ID)
		if err != nil {
			loginError(c, err, 0)
			return
		}

		data.CSRFToken = csrfToken
		name := config.ServerConfig.Jwt.CookieName
		if name == "" {
			name = "lf_access_token"
		}
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     name,
			Value:    output.Token,
			Path:     "/api",
			HttpOnly: true,
			Secure:   config.ServerConfig.CSRF.SecureCookie,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   86400,
			Expires:  output.Claims.ExpiresAt.Time,
		})
	}

	c.JSON(http.StatusOK, result.Result[vo.LoginResponseVO]{
		Code:      1,
		Msg:       constant.Success,
		Data:      data,
		RequestID: c.GetString("request_id"),
	})
}

// loginError 只输出约定的错误码和文案，不暴露底层 SQL、哈希或微信凭证。
func loginError(c *gin.Context, err error, retry int) {
	status := http.StatusInternalServerError
	code := constant.InternalErrorCode
	message := constant.InternalError

	switch {
	case errors.Is(err, errs.InvalidRequestError):
		status = http.StatusBadRequest
		code = constant.InvalidRequestCode
		message = constant.InvalidRequest
	case errors.Is(err, errs.ValidationError):
		status = http.StatusBadRequest
		code = constant.ValidationErrorCode
		message = constant.ValidationError
	case errors.Is(err, errs.InvalidCredentialsError):
		status = http.StatusUnauthorized
		code = constant.InvalidCredentialsCode
		message = constant.InvalidCredentials
	case errors.Is(err, errs.LoginRateLimitedError):
		status = http.StatusTooManyRequests
		code = constant.LoginRateLimitedCode
		message = constant.LoginRateLimited
		if retry < 1 {
			retry = 1
		}
		c.Header("Retry-After", strconv.Itoa(retry))
	case errors.Is(err, errs.AuthLimiterUnavailableError):
		status = http.StatusServiceUnavailable
		code = constant.AuthLimiterUnavailableCode
		message = constant.AuthLimiterUnavailable
	case errors.Is(err, errs.AuthDatabaseError):
		status = http.StatusServiceUnavailable
		code = constant.ServiceUnavailableCode
		message = constant.ServiceUnavailable
	case errors.Is(err, errs.AccountDisabledError):
		status = http.StatusForbidden
		code = constant.AccountDisabledCode
		message = constant.AccountDisabled
	case errors.Is(err, errs.IdentityUnverifiedError):
		status = http.StatusForbidden
		code = constant.IdentityUnverifiedCode
		message = constant.IdentityUnverified
	case errors.Is(err, errs.ForbiddenError):
		status = http.StatusForbidden
		code = constant.ForbiddenCode
		message = constant.Forbidden
	case errors.Is(err, errs.WechatNotBoundError):
		status = http.StatusConflict
		code = constant.WechatNotBoundCode
		message = constant.WechatNotBound
	case errors.Is(err, errs.WechatUpstreamError):
		status = http.StatusBadGateway
		code = constant.WechatUpstreamErrorCode
		message = constant.WechatUpstreamError
	case errors.Is(err, errs.LoginCSRFContextError):
		status = http.StatusForbidden
		code = constant.CSRFInvalidCode
		message = constant.CSRFSourceDenied
	}

	c.AbortWithStatusJSON(status, vo.ErrorResponseVO{
		Code:      code,
		Msg:       message,
		Data:      nil,
		RequestID: c.GetString("request_id"),
	})
}

// Logout 撤销当前账号所有端的旧 JWT，成功后清除网页登录 Cookie。
func Logout(c *gin.Context) {
	user, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	if err := service.Logout(ctx, user); err != nil {
		ctrl.Fail(c, err)
		return
	}

	ClearLoginCookie(c)
	ctrl.Success(c, http.StatusOK, nil)
}

// ClearLoginCookie 仅删除 Cookie 模式登录的凭证；Bearer 令牌由调用端清除。
func ClearLoginCookie(c *gin.Context) {
	if c.GetHeader("Authorization") != "" {
		return
	}

	name := config.ServerConfig.Jwt.CookieName
	if name == "" {
		name = "lf_access_token"
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/api",
		HttpOnly: true,
		Secure:   config.ServerConfig.CSRF.SecureCookie,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
}

// ValidateLoginRequest 校验登录请求参数；不 trim 或截断密码。身份权限仍由业务层查询。
func ValidateLoginRequest(r dto.LoginRequestDTO) error {
	if r.ClientType != "web" &&
		r.ClientType != "miniapp" &&
		r.ClientType != "admin_web" {
		return errs.InvalidClientTypeError
	}

	switch r.GrantType {
	case "password":
		if len(r.AccountNo) == 0 ||
			len(r.AccountNo) > 32 ||
			strings.TrimSpace(r.AccountNo) == "" {
			return errs.InvalidAccountNoError
		}

		for _, ch := range r.AccountNo {
			if ch > 127 {
				return errs.AccountNoASCIIError
			}
		}

		if !validPassword(r.Password) {
			return errs.InvalidPasswordError
		}
	case "wechat_code":
		if r.ClientType != "miniapp" || strings.TrimSpace(r.Code) == "" {
			return errs.WechatCodeRequestError
		}
	default:
		return errs.InvalidGrantTypeError
	}
	return nil
}

// ValidateChangePasswordRequest 校验修改密码请求的长度与编码。
func ValidateChangePasswordRequest(r dto.ChangePasswordRequestDTO) error {
	if !validPassword(r.CurrentPassword) || !validPassword(r.NewPassword) {
		return errs.InvalidPasswordError
	}
	return nil
}

func validPassword(password string) bool {
	n := utf8.RuneCountInString(password)
	return utf8.ValidString(password) &&
		n >= constant.PasswordMinLength &&
		n <= constant.PasswordMaxLength
}
