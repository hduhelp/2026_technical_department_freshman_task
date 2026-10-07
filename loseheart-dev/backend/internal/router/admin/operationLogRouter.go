package admin

import (
	"github.com/gin-gonic/gin"
	adminController "lost-found/backend/internal/controller/admin"
)

// operationLogRouter 注册本模块接口，继承父组中间件。
func operationLogRouter(parent *gin.RouterGroup) {
	group := parent.Group("/operation-logs")
	group.GET("", adminController.ListOperationLogs)
	group.GET("/:id", adminController.GetOperationLog)
}
