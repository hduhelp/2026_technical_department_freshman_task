package user

import (
	"github.com/gin-gonic/gin"
	userController "lost-found/backend/internal/controller/user"
)

// imageRouter 注册本模块接口，继承父组中间件。
func imageRouter(user *gin.RouterGroup) {
	group := user
	group.POST("/users/me/image-uploads", userController.UploadImage)
	group.GET("/users/me/image-uploads/:filename/content", userController.PreviewImage)
	group.GET("/posts/:id/images/:index", userController.GetPostImage)
	group.GET("/posts/:id/reviews/:review_id/images/:index", userController.GetReviewImage)
}
