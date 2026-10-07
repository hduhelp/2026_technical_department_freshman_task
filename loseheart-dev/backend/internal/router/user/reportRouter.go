package user

import (
	"github.com/gin-gonic/gin"
	userController "lost-found/backend/internal/controller/user"
)

// reportRouter 注册本模块接口，继承父组中间件。
func reportRouter(user *gin.RouterGroup) {
	group := user.Group("/posts")
	group.POST("/:id/reports", userController.CreateReport)
}
