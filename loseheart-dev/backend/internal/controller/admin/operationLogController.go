package admin

import (
	"net/http"
	"strconv"
	"time"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ListOperationLogs 查询只读管理记录，RFC3339 时间范围下界包含、上界不包含。
func ListOperationLogs(c *gin.Context) {
	var input dto.OperationLogQueryDTO
	if !ctrl.BindQuery(c, &input) ||
		!validAdminFilterIDs(c, input.OperatorID, input.TargetPostID, input.TargetUserID) {
		return
	}

	if input.CreatedFrom != "" && input.CreatedTo != "" {
		from, errFrom := time.Parse(time.RFC3339, input.CreatedFrom)
		to, errTo := time.Parse(time.RFC3339, input.CreatedTo)
		if errFrom != nil || errTo != nil || to.Before(from) {
			ctrl.Fail(c, errs.ValidationError)
			return
		}
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.ListOperationLogs(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctrl.Success(c, http.StatusOK, data)
}

// GetOperationLog 返回单条日志，仅包含操作目标和允许公开的状态白名单。
func GetOperationLog(c *gin.Context) {
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.GetOperationLog(ctx, id)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctrl.Success(c, http.StatusOK, data)
}

// validAdminFilterIDs 补充 numeric 标签不能识别的零值和 uint64 溢出检查。
func validAdminFilterIDs(c *gin.Context, values ...string) bool {
	for _, value := range values {
		if value == "" {
			continue
		}
		id, err := strconv.ParseUint(value, 10, 64)
		if err != nil || id == 0 {
			ctrl.Fail(c, errs.ValidationError)
			return false
		}
	}
	return true
}
