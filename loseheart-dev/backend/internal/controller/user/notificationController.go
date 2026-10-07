package user

import (
	"net/http"

	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ListNotifications 分页查询当前收件人的通知；查询操作不修改已读状态。
func ListNotifications(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	var input dto.NotificationQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.ListNotifications(ctx, actor.ID, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// GetUnreadNotificationCount 只统计当前收件人的未读通知。
func GetUnreadNotificationCount(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.GetUnreadNotificationCount(ctx, actor.ID)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}

// MarkNotificationRead 首版只允许设置为 true；首次已读时间由服务端生成。
func MarkNotificationRead(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	var input dto.NotificationReadStateDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	output, err := service.MarkNotificationRead(ctx, actor, id)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, output)
}
