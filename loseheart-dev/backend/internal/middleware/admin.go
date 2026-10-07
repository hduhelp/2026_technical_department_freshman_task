package middleware

import (
	"lost-found/backend/common/constant"
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireAdmin 挂在 RequireAuth 之后，角色来自本次数据库查询，不信任 JWT 的角色字段。
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := CurrentUser(c)
		if !ok {
			abortError(c, authenticationError())
			return
		}
		if user.MustChangePassword {
			abortError(c, &authError{http.StatusForbidden, constant.PasswordChangeRequiredCode, constant.PasswordChangeRequired})
			return
		}
		if user.Role != "admin" {
			abortError(c, &authError{http.StatusForbidden, constant.ForbiddenCode, constant.Forbidden})
			return
		}
		c.Next()
	}
}
