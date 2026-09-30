package handler

import (
	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
)

// UserHandler 处理当前用户资料的读取与修改。
type UserHandler struct {
	users *service.UserService
}

// NewUserHandler 创建用户 handler。
func NewUserHandler(users *service.UserService) *UserHandler {
	return &UserHandler{users: users}
}

// Me 处理 GET /api/users/me。
//
// 返回当前登录用户信息（永远不含 password_hash）。
func (h *UserHandler) Me(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		// 理论上不会发生：本路由挂在 Auth 中间件之后。
		// 保留兜底是为了让「中间件漏挂」这种配置错误表现为 401 而非 panic。
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	response.OK(c, h.users.Me(u))
}

// UpdateMe 处理 PATCH /api/users/me。
//
// 请求体：{nickname?, contact?, contact_public?}，三个字段均为可选指针，
// 只更新请求中真正出现的字段。role / username / password_hash 不可修改。
func (h *UserHandler) UpdateMe(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	var req model.UpdateMeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	updated, err := h.users.UpdateMe(c.Request.Context(), u, req)
	if err != nil {
		response.Fail(c, err)
		return
	}

	response.OK(c, updated)
}
