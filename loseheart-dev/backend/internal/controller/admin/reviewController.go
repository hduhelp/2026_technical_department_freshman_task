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

// ListReviews 查询待审核队列或指定历史结论，默认按提交时间从早到晚处理。
func ListReviews(c *gin.Context) {
	var input dto.ReviewQueryDTO
	if !ctrl.BindQuery(c, &input) || !validAdminFilterIDs(c, input.PostID) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.ListReviews(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctrl.Success(c, http.StatusOK, data)
}

// GetReview 展示不可变提交快照与当前帖子状态，ETag 同时包含当前帖子状态版本。
func GetReview(c *gin.Context) {
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

	data, err := service.GetReview(ctx, actor, id)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	c.Header("ETag", data.ETag)
	ctrl.Success(c, http.StatusOK, data)
}

// DecideReview 校验决定与原因组合；过期版本和不可处理状态不会自动重试。
func DecideReview(c *gin.Context) {
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

	var input dto.ReviewDecisionDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}

	if input.Decision != "approved" && (input.Reason == nil || strings.TrimSpace(*input.Reason) == "") {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	if input.Reason != nil && strings.TrimSpace(*input.Reason) == "" {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, nextETag, err := service.DecideReview(ctx, actor, id, etag, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	c.Header("ETag", nextETag)
	ctrl.Success(c, http.StatusOK, data)
}
