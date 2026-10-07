package user

import (
	"github.com/gin-gonic/gin"
	authController "lost-found/backend/internal/controller/auth"
	"lost-found/backend/internal/middleware"
)

// InitUserRouter 创建用户认证组，再注册各业务模块。
func InitUserRouter(api *gin.RouterGroup, auth *middleware.Authenticator) {
	group := api.Group("")
	group.Use(auth.RequireAuth())
	group.DELETE("/auth/tokens/current", authController.Logout)
	profileRouter(group)
	postRouter(group)
	imageRouter(group)
	reportRouter(group)
	notificationRouter(group)
}
