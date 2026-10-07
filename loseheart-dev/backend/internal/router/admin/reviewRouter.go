package admin

import (
	"github.com/gin-gonic/gin"
	adminController "lost-found/backend/internal/controller/admin"
)

// reviewRouter 注册本模块接口，继承父组中间件。
func reviewRouter(parent *gin.RouterGroup) {
	group := parent.Group("/reviews")
	group.GET("", adminController.ListReviews)
	group.GET("/:id", adminController.GetReview)
	group.PUT("/:id/decision", adminController.DecideReview)
}
