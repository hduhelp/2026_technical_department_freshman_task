package user

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"lost-found/backend/internal/config"
	ctrl "lost-found/backend/internal/controller"
	authController "lost-found/backend/internal/controller/auth"
	"lost-found/backend/internal/model/dto"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/middleware"
	result "lost-found/backend/internal/model/result"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// GetMe 获取当前登录用户的个人信息。
func GetMe(c *gin.Context) {
	// 个人信息响应不允许被缓存。
	c.Header("Cache-Control", "no-store")
	requestID := c.GetString("request_id")

	// 获取 JWT 中间件已经校验过的用户身份。
	user, ok := middleware.CurrentUser(c)
	if !ok || user.ID == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, vo.ErrorResponseVO{
			Code: constant.AuthRequiredCode, Msg: constant.AuthRequired,
			Data: nil, RequestID: requestID,
		})
		return
	}

	// 查询最长等待 5 秒，请求取消时也会取消数据库操作。
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	profile, err := service.GetUserProfile(ctx, user.ID)
	if err != nil {
		status := http.StatusInternalServerError
		code := constant.InternalErrorCode
		message := constant.InternalError

		switch {
		case errors.Is(err, errs.AuthRequiredError):
			status = http.StatusUnauthorized
			code = constant.AuthRequiredCode
			message = constant.AuthRequired
		case errors.Is(err, errs.AuthDatabaseError):
			status = http.StatusServiceUnavailable
			code = constant.ServiceUnavailableCode
			message = constant.ServiceUnavailable
		}

		c.AbortWithStatusJSON(status, vo.ErrorResponseVO{
			Code: code, Msg: message, Data: nil, RequestID: requestID,
		})
		return
	}

	c.JSON(http.StatusOK, result.Result[vo.UserProfileVO]{
		Code: 1, Msg: constant.Success, Data: *profile, RequestID: requestID,
	})
}

// ChangePassword 校验改密请求，成功后清除网页登录 Cookie 并要求全部端重新登录。
func ChangePassword(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	user, ok := middleware.CurrentUser(c)
	if !ok || user.ID == 0 {
		passwordError(c, errs.AuthRequiredError)
		return
	}
	contentType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || contentType != "application/json" {
		passwordError(c, errs.InvalidRequestError)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	var input dto.ChangePasswordRequestDTO
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		passwordError(c, errs.InvalidRequestError)
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		passwordError(c, errs.InvalidRequestError)
		return
	}
	if err := authController.ValidateChangePasswordRequest(input); err != nil {
		passwordError(c, errs.InvalidRequestError)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if err := service.ChangePassword(ctx, user, input); err != nil {
		passwordError(c, err)
		return
	}

	// 仅 Cookie 登录需要响应删除 Cookie；Bearer 令牌由客户端清除。
	if c.GetHeader("Authorization") == "" {
		name := config.ServerConfig.Jwt.CookieName
		if name == "" {
			name = "lf_access_token"
		}
		http.SetCookie(c.Writer, &http.Cookie{
			Name: name, Value: "", Path: "/api", HttpOnly: true,
			Secure: config.ServerConfig.CSRF.SecureCookie, SameSite: http.SameSiteLaxMode,
			MaxAge: -1, Expires: time.Unix(1, 0),
		})
	}
	c.JSON(http.StatusOK, result.Result[any]{Code: 1, Msg: constant.Success, Data: nil, RequestID: c.GetString("request_id")})
}

// passwordError 将业务错误转换为约定响应，不暴露数据库或哈希错误细节。
func passwordError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, constant.InternalErrorCode, constant.InternalError
	switch {
	case errors.Is(err, errs.AuthRequiredError):
		status, code, message = http.StatusUnauthorized, constant.AuthRequiredCode, constant.AuthRequired
	case errors.Is(err, errs.TokenRevokedError):
		status, code, message = http.StatusUnauthorized, constant.TokenRevokedCode, constant.TokenRevoked
	case errors.Is(err, errs.InvalidCredentialsError):
		status, code, message = http.StatusUnauthorized, constant.InvalidCredentialsCode, constant.InvalidCredentials
	case errors.Is(err, errs.InvalidRequestError), errors.Is(err, errs.InvalidPasswordError):
		status, code, message = http.StatusBadRequest, constant.InvalidRequestCode, constant.InvalidRequest
	case errors.Is(err, errs.PasswordUnchangedError):
		status, code, message = http.StatusBadRequest, constant.InvalidRequestCode, constant.PasswordUnchanged
	case errors.Is(err, errs.AccountDisabledError):
		status, code, message = http.StatusForbidden, constant.AccountDisabledCode, constant.AccountDisabled
	case errors.Is(err, errs.IdentityUnverifiedError):
		status, code, message = http.StatusForbidden, constant.IdentityUnverifiedCode, constant.IdentityUnverified
	case errors.Is(err, errs.AuthDatabaseError):
		status, code, message = http.StatusServiceUnavailable, constant.ServiceUnavailableCode, constant.ServiceUnavailable
	}
	c.AbortWithStatusJSON(status, vo.ErrorResponseVO{Code: code, Msg: message, Data: nil, RequestID: c.GetString("request_id")})
}

// BindWechat 仅允许小程序 Bearer 流程绑定；code 始终在后端交换，不接受客户端 OpenID。
func BindWechat(c *gin.Context) {
	user, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	if c.GetHeader("Authorization") == "" {
		ctrl.Fail(c, errs.ForbiddenError)
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	// 微信绑定请求与登录共用每 IP 每分钟 30 次的固定窗口。
	retry, err := service.LoginSourceLimit(ctx, c.ClientIP())
	if err != nil {
		if retry > 0 {
			c.Header("Retry-After", strconv.Itoa(retry))
		}
		ctrl.Fail(c, err)
		return
	}
	var input dto.WechatBindingDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	if strings.TrimSpace(input.Code) == "" || len(input.Code) > 512 {
		ctrl.Fail(c, errs.ValidationError)
		return
	}
	if input.CurrentPassword != nil {
		length := utf8.RuneCountInString(*input.CurrentPassword)
		if !utf8.ValidString(*input.CurrentPassword) || length < constant.PasswordMinLength || length > constant.PasswordMaxLength {
			ctrl.Fail(c, errs.ValidationError)
			return
		}
	}
	output, retry, err := service.BindWechat(ctx, user, input)
	if err != nil {
		if retry > 0 {
			c.Header("Retry-After", strconv.Itoa(retry))
		}
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// GetPostQuota 返回北京时间当日已用额度；额度以 MySQL 事务记录为准。
func GetPostQuota(c *gin.Context) {
	user, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.GetPostQuota(ctx, user.ID)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// ListMyPosts 分页读取本人所有状态的帖子；不允许请求参数指定其他作者。
func ListMyPosts(c *gin.Context) {
	user, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	var input dto.MyPostQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.ListMyPosts(ctx, user.ID, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}
