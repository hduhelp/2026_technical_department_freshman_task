package admin

import (
	"github.com/gin-gonic/gin"
	adminController "lost-found/backend/internal/controller/admin"
)

// userRouter 注册本模块接口，继承父组中间件。
func userRouter(parent *gin.RouterGroup) {
	group := parent.Group("/users")
	group.GET("", adminController.ListUsers)
	group.GET("/:id", adminController.GetUser)
	group.PATCH("/:id/status", adminController.UpdateUserStatus)
	group.POST("/:id/password-resets", adminController.ResetUserPassword)
}
