package handler

import (
	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
)

// AuthHandler 处理注册、登录、登出。
type AuthHandler struct {
	auth *service.AuthService
}

// NewAuthHandler 创建认证 handler。
func NewAuthHandler(auth *service.AuthService) *AuthHandler {
	return &AuthHandler{auth: auth}
}

// Register 处理 POST /api/auth/register。
//
// 请求体：{username, password, nickname?}
// 成功返回：{user}（不自动登录，前端引导用户去登录页）
func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		// binding 失败（缺字段、JSON 格式错）统一归为 1001，不回显 validator 原始信息。
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	user, err := h.auth.Register(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, err)
		return
	}

	response.OK(c, model.RegisterResult{User: user})
}

// Login 处理 POST /api/auth/login。
//
// 请求体：{username, password}
// 成功返回：{token, user}
func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	result, err := h.auth.Login(c.Request.Context(), req)
	if err != nil {
		response.Fail(c, err)
		return
	}

	response.OK(c, result)
}

// Logout 处理 POST /api/auth/logout。
//
// JWT 是无状态的，服务端不维护黑名单（SPEC 第 12 章明确不做），
// 因此这里只返回成功，由前端清除本地 token。
func (h *AuthHandler) Logout(c *gin.Context) {
	response.OKEmpty(c)
}
