package user

import (
	"github.com/gin-gonic/gin"
	userController "lost-found/backend/internal/controller/user"
)

// profileRouter 注册本模块接口，继承父组中间件。
func profileRouter(user *gin.RouterGroup) {
	group := user.Group("/users/me")
	group.GET("", userController.GetMe)
	group.PUT("/password", userController.ChangePassword)
	group.PUT("/wechat-binding", userController.BindWechat)
	group.GET("/post-quota", userController.GetPostQuota)
	group.GET("/posts", userController.ListMyPosts)
}
