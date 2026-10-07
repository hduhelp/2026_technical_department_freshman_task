package admin

import (
	"net/http"
	"strings"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ListReports 查询各举报人的独立记录，默认展示待处理举报。
func ListReports(c *gin.Context) {
	var input dto.ReportQueryDTO
	if !ctrl.BindQuery(c, &input) || !validAdminFilterIDs(c, input.PostID) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.ListReports(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctrl.Success(c, http.StatusOK, data)
}

// GetReport 对照举报原版本快照和当前帖子状态，返回举报处理状态的 ETag。
func GetReport(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.GetReport(ctx, actor, id)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	c.Header("ETag", data.ETag)
	ctrl.Success(c, http.StatusOK, data)
}

// DecideReport 校验结案状态与动作组合，下架需要另提供当前帖子 state_version。
func DecideReport(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	etag, ok := ctrl.IfMatch(c)
	if !ok {
		return
	}

	var input dto.ReportDecisionDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}

	if strings.TrimSpace(input.HandlingReason) == "" ||
		input.Status == "dismissed" && input.ResultAction != "none" ||
		input.Status == "handled" && input.ResultAction == "none" ||
		input.ResultAction == "remove_post" && input.ExpectedPostStateVersion == nil ||
		input.ResultAction != "remove_post" && input.ExpectedPostStateVersion != nil {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.DecideReport(ctx, actor, id, etag, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	c.Header("ETag", data.ETag)
	ctrl.Success(c, http.StatusOK, data)
}
