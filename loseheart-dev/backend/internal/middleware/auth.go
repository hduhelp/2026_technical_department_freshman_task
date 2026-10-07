package middleware

import (
	"context"
	"errors"
	"fmt"
	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/entity"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserIdentity 仅保存认证所需字段，不读取密码或联系方式。
type UserIdentity = entity.AuthUser

type LookupUser func(context.Context, uint64) (UserIdentity, error)

// GORMUserLookup 每次认证直接查 users；不缓存账号状态或登录版本。
func GORMUserLookup(db *gorm.DB) LookupUser {
	return func(ctx context.Context, id uint64) (UserIdentity, error) {
		if db == nil {
			return UserIdentity{}, errs.AuthDatabaseError
		}
		var user UserIdentity
		err := db.WithContext(ctx).Table("users").
			Select("id", "token_version", "role", "status", "is_verified", "must_change_password").
			Where("id = ?", id).Take(&user).Error
		return user, err
	}
}

type Authenticator struct {
	config config.JWTConfig
	lookup LookupUser
}

func NewAuthenticator(cfg config.JWTConfig, lookup LookupUser) (*Authenticator, error) {
	if len(cfg.SecretKey) < 32 || strings.TrimSpace(cfg.Issuer) == "" || strings.TrimSpace(cfg.Audience) == "" || lookup == nil {
		return nil, errs.AuthenticatorConfigError
	}
	if cfg.CookieName == "" {
		cfg.CookieName = "lf_access_token"
	}
	return &Authenticator{config: cfg, lookup: lookup}, nil
}

type principal struct {
	User   UserIdentity
	Claims *model.JWTClaims
	Bearer bool
}

const principalKey = "lost_found.auth.principal"

// CurrentUser 供 handler 获取经过数据库验证的当前用户。
func CurrentUser(c *gin.Context) (UserIdentity, bool) {
	p, ok := currentPrincipal(c)
	if !ok {
		return UserIdentity{}, false
	}
	return p.User, true
}

func currentPrincipal(c *gin.Context) (*principal, bool) {
	v, ok := c.Get(principalKey)
	if !ok {
		return nil, false
	}
	p, ok := v.(*principal)
	return p, ok && p != nil
}

type authError struct {
	status        int
	code, message string
}

func (e *authError) Error() string { return e.code }

func authenticationError() *authError {
	return &authError{http.StatusUnauthorized, constant.AuthRequiredCode, constant.AuthRequired}
}

// credentials 拒绝同时携带 Cookie/Bearer，以及重复、空值或非法认证头。
func (a *Authenticator) credentials(c *gin.Context) (token string, bearer, present bool, err *authError) {
	headers := c.Request.Header.Values("Authorization")
	var cookies []*http.Cookie
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == a.config.CookieName {
			cookies = append(cookies, cookie)
		}
	}
	present = len(headers) > 0 || len(cookies) > 0
	if len(headers) > 1 || len(cookies) > 1 || (len(headers) > 0 && len(cookies) > 0) {
		return "", false, present, authenticationError()
	}
	if len(headers) == 1 {
		parts := strings.Fields(headers[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return "", false, true, authenticationError()
		}
		return parts[1], true, true, nil
	}
	if len(cookies) == 1 {
		if cookies[0].Value == "" {
			return "", false, true, authenticationError()
		}
		return cookies[0].Value, false, true, nil
	}
	return "", false, false, nil
}

func (a *Authenticator) authenticate(c *gin.Context) (identity *principal, failure *authError) {
	// 撤销或过期的 HttpOnly Cookie 必须由服务端删除，否则它会继续阻挡重新登录。
	defer func() {
		if failure == nil || (failure.status != http.StatusUnauthorized && failure.code != constant.AccountDisabledCode && failure.code != constant.IdentityUnverifiedCode) || len(c.Request.Header.Values("Authorization")) > 0 {
			return
		}
		for _, cookie := range c.Request.Cookies() {
			if cookie.Name != a.config.CookieName {
				continue
			}
			secure := false
			if value, ok := c.Get(csrfProtectorKey); ok {
				if protector, ok := value.(*CSRFProtector); ok {
					secure = protector.config.SecureCookie
				}
			}
			http.SetCookie(c.Writer, &http.Cookie{Name: a.config.CookieName, Value: "", Path: "/api", MaxAge: -1, Expires: time.Unix(1, 0), HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
			return
		}
	}()
	if p, ok := currentPrincipal(c); ok {
		return p, nil
	}
	token, bearer, present, failure := a.credentials(c)
	if failure != nil {
		return nil, failure
	}
	if !present {
		return nil, authenticationError()
	}
	claims, err := utils.ParseJWT(a.config, token)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, &authError{http.StatusUnauthorized, constant.TokenExpiredCode, constant.TokenExpired}
		}
		return nil, authenticationError()
	}
	id, err := strconv.ParseUint(claims.Subject, 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != claims.Subject {
		return nil, authenticationError()
	}
	user, err := a.lookup(c.Request.Context(), id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, authenticationError()
	}
	if err != nil {
		_ = c.Error(fmt.Errorf(constant.ErrorWrapFormat, errs.AuthUserLookupError, err))
		return nil, &authError{http.StatusServiceUnavailable, constant.ServiceUnavailableCode, constant.ServiceUnavailable}
	}
	if user.ID != id || user.TokenVersion == 0 {
		return nil, authenticationError()
	}
	if user.Status != "active" {
		return nil, &authError{http.StatusForbidden, constant.AccountDisabledCode, constant.AccountDisabled}
	}
	if !user.IsVerified {
		return nil, &authError{http.StatusForbidden, constant.IdentityUnverifiedCode, constant.IdentityUnverified}
	}
	if user.TokenVersion != claims.TokenVersion {
		return nil, &authError{http.StatusUnauthorized, constant.TokenRevokedCode, constant.TokenRevoked}
	}
	p := &principal{User: user, Claims: claims, Bearer: bearer}
	c.Set(principalKey, p)
	return p, nil
}

// RequireAuth 应挂到需要登录的路由组；登录接口不挂此中间件。
func (a *Authenticator) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := a.authenticate(c)
		if err != nil {
			abortError(c, err)
			return
		}
		if p.User.MustChangePassword && !passwordRecoveryRoute(c) {
			abortError(c, &authError{http.StatusForbidden, constant.PasswordChangeRequiredCode, constant.PasswordChangeRequired})
			return
		}
		c.Next()
	}
}

func passwordRecoveryRoute(c *gin.Context) bool {
	return (c.Request.Method == http.MethodPut && c.FullPath() == "/api/v1/users/me/password") ||
		(c.Request.Method == http.MethodDelete && c.FullPath() == "/api/v1/auth/tokens/current") ||
		(c.Request.Method == http.MethodGet && c.FullPath() == "/api/v1/auth/csrf")
}

func abortError(c *gin.Context, failure *authError) {
	requestID := c.GetString("request_id")
	if requestID == "" {
		requestID = uuid.NewString()
		c.Set("request_id", requestID)
	}
	c.Header("X-Request-ID", requestID)
	c.AbortWithStatusJSON(failure.status, gin.H{"code": failure.code, "msg": failure.message, "data": nil, "request_id": requestID})
}
