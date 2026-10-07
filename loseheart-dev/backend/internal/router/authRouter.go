package router

import (
	"github.com/gin-gonic/gin"
	authController "lost-found/backend/internal/controller/auth"
	"lost-found/backend/internal/middleware"
)

// authRouter 注册登录前接口；网页登录仍需 CSRF 校验。
func authRouter(api *gin.RouterGroup, csrf *middleware.CSRFProtector) {
	group := api.Group("/auth")
	group.GET("/csrf", csrf.TokenHandler())
	group.POST("/tokens", authController.Login)
}
