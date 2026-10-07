package router

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"io"
	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/router/admin"
	"lost-found/backend/internal/router/user"
	"net/http"
)

// InitRouter 注册所有接口；路由直接引用 controller 函数。
func InitRouter(auth *middleware.Authenticator, csrf *middleware.CSRFProtector) (*gin.Engine, error) {
	if auth == nil || csrf == nil {
		return nil, errs.RouterDependencyError
	}
	r := gin.New()
	// 本机直连，不信任客户端伪造的 X-Forwarded-For 来绕过来源限速。
	if err := r.SetTrustedProxies(nil); err != nil {
		return nil, err
	}
	r.Use(requestID(), gin.Logger(), gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		// 不向日志或客户端转储请求 Cookie、密码或 panic 内容。
		c.AbortWithStatusJSON(http.StatusInternalServerError, vo.ErrorResponseVO{Code: constant.InternalErrorCode, Msg: constant.InternalError, RequestID: c.GetString("request_id")})
	}))
	r.NoRoute(func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusNotFound, vo.ErrorResponseVO{Code: constant.ResourceNotFoundCode, Msg: constant.ResourceNotFound, RequestID: c.GetString("request_id")})
	})

	// 网页和小程序共用接口；CSRF 内部处理 Cookie 与 Bearer 的区别。
	api := r.Group("/api/v1")
	api.Use(csrf.RequireCSRF())
	authRouter(api, csrf)
	user.InitUserRouter(api, auth)
	admin.InitAdminRouter(api, auth)
	return r, nil
}

// requestID 为每个请求生成追踪标识，不使用客户端提供的 ID。
func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := uuid.NewString()
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		// 所有接口都可能包含身份相关数据；认证失败、404 和恢复响应也禁止缓存。
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}
