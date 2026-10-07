// Package handlers 是“处理层”：每个接口对应一个 handler 函数，
// 负责接收请求参数、调用存储层、返回结果。
package handlers

import (
	"campus-lost-found/models"
	"campus-lost-found/store"

	"github.com/gin-gonic/gin"
)

// Handler 持有存储对象，所有接口方法都定义在它上面
type Handler struct {
	store *store.Store
}

// NewHandler 创建 Handler
func NewHandler(s *store.Store) *Handler {
	return &Handler{store: s}
}

// userVO 返回可以安全展示给前端的用户信息（不含密码）
func userVO(u *models.User) gin.H {
	return gin.H{
		"id":         u.ID,
		"username":   u.Username,
		"phone":      u.Phone,
		"created_at": u.CreatedAt,
	}
}

// itemVO 把信息转换成返回格式，并附带发布者的简要信息
func itemVO(it *models.Item, publisher *models.User, isOwner bool) gin.H {
	publisherInfo := gin.H{"id": 0, "username": "已注销用户"}
	if publisher != nil {
		publisherInfo = gin.H{"id": publisher.ID, "username": publisher.Username}
	}
	return gin.H{
		"id":          it.ID,
		"user_id":     it.UserID,
		"type":        it.Type,
		"title":       it.Title,
		"description": it.Description,
		"location":    it.Location,
		"contact":     it.Contact,
		"status":      it.Status,
		"created_at":  it.CreatedAt,
		"updated_at":  it.UpdatedAt,
		"publisher":   publisherInfo,
		"is_owner":    isOwner, // 当前登录用户是否是发布者（前端可据此显示编辑/删除按钮）
	}
}
