package admin

import (
	"github.com/gin-gonic/gin"
	adminController "lost-found/backend/internal/controller/admin"
)

// postRouter 注册本模块接口，继承父组中间件。
func postRouter(parent *gin.RouterGroup) {
	group := parent.Group("/posts")
	group.GET("", adminController.ListPosts)
	group.GET("/:id", adminController.GetPost)
	group.PATCH("/:id/moderation", adminController.ModeratePost)
}
