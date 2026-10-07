package user

import (
	"github.com/gin-gonic/gin"
	userController "lost-found/backend/internal/controller/user"
)

// notificationRouter 注册本模块接口，继承父组中间件。
func notificationRouter(user *gin.RouterGroup) {
	group := user.Group("/notifications")
	group.GET("", userController.ListNotifications)
	group.GET("/unread-count", userController.GetUnreadNotificationCount)
	group.PUT("/:id/read-state", userController.MarkNotificationRead)
}
