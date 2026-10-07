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

// ListUsers 校验筛选与分页参数，读取管理员可见的用户资料。
func ListUsers(c *gin.Context) {
	var input dto.AdminUserQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.ListAdminUsers(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// GetUser 读取指定账号的管理资料；不返回密码哈希、OpenID 或 token_version。
func GetUser(c *gin.Context) {
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.GetAdminUser(ctx, id)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// UpdateUserStatus 仅接受 disabled，禁止纯空白原因；业务层执行事务与权限复查。
func UpdateUserStatus(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	var input dto.UserStatusDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	if strings.TrimSpace(input.Reason) == "" {
		ctrl.Fail(c, errs.ValidationError)
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.DisableUser(ctx, actor, id, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// ResetUserPassword 仅本次授权响应交付临时密码；不写日志，也不自动重试业务操作。
func ResetUserPassword(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	var input dto.PasswordResetDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	if strings.TrimSpace(input.Reason) == "" {
		ctrl.Fail(c, errs.ValidationError)
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.ResetUserPassword(ctx, actor, id, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	c.Header("Location", "/api/v1/admin/operation-logs/"+output.OperationLogID)
	ctrl.Success(c, http.StatusCreated, output)
}
