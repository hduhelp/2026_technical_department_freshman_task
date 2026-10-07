package admin

import (
	"github.com/gin-gonic/gin"
	"lost-found/backend/internal/middleware"
)

// InitAdminRouter 创建管理端组，先认证再检查管理员权限。
func InitAdminRouter(api *gin.RouterGroup, auth *middleware.Authenticator) {
	group := api.Group("/admin")
	group.Use(auth.RequireAuth(), middleware.RequireAdmin())
	postRouter(group)
	reviewRouter(group)
	reportRouter(group)
	userRouter(group)
	operationLogRouter(group)
}
