package admin

import (
	"github.com/gin-gonic/gin"
	adminController "lost-found/backend/internal/controller/admin"
)

// reportRouter 注册本模块接口，继承父组中间件。
func reportRouter(parent *gin.RouterGroup) {
	group := parent.Group("/reports")
	group.GET("", adminController.ListReports)
	group.GET("/:id", adminController.GetReport)
	group.PUT("/:id/decision", adminController.DecideReport)
}
