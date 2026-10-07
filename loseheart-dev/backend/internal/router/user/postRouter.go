package user

import (
	"github.com/gin-gonic/gin"
	userController "lost-found/backend/internal/controller/user"
)

// postRouter 注册本模块接口，继承父组中间件。
func postRouter(user *gin.RouterGroup) {
	group := user.Group("/posts")
	group.GET("", userController.ListPosts)
	group.POST("", userController.CreatePost)
	group.GET("/:id", userController.GetPost)
	group.PUT("/:id", userController.UpdatePost)
	group.PATCH("/:id/resolution", userController.UpdatePostResolution)
	group.GET("/:id/reviews", userController.ListPostReviews)
}
