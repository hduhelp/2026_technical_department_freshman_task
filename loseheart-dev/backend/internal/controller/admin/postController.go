package admin

import (
	"net/http"
	"strings"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ListPosts 后台查询全部审核状态的帖子，筛选参数只使用约定字段。
func ListPosts(c *gin.Context) {
	var input dto.AdminPostQueryDTO
	if !ctrl.BindQuery(c, &input) || !validAdminFilterIDs(c, input.AuthorID) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.ListAdminPosts(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctrl.Success(c, http.StatusOK, data)
}

// GetPost 后台查看帖子当前内容及审核说明，返回下一次修改必须携带的 ETag。
func GetPost(c *gin.Context) {
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

	data, err := service.GetPostDetail(ctx, actor, id, true)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	if detail, ok := data.(*vo.OwnerPostDetailVO); ok {
		c.Header("ETag", detail.ETag)
	}
	ctrl.Success(c, http.StatusOK, data)
}

// ModeratePost 校验下架原因和版本条件，具体状态更新及通知日志由 Service 原子完成。
func ModeratePost(c *gin.Context) {
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

	var input dto.PostModerationDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}

	if strings.TrimSpace(input.Reason) == "" {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()

	data, err := service.ModeratePost(ctx, actor, id, etag, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	c.Header("ETag", data.ETag)
	ctrl.Success(c, http.StatusOK, data)
}
