package user

import (
	"net/http"
	"strings"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// CreateReport 举报他人的当前可见帖子；重复举报同一内容版本返回原记录 200。
func CreateReport(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	var input dto.CreateReportDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}

	if input.ReasonType == "other" && (input.Details == nil || strings.TrimSpace(*input.Details) == "") {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, created, err := service.CreateReport(ctx, actor, id, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	ctrl.Success(c, status, data)
}
