// Package middleware 是“中间件”：在真正处理请求之前先做一些公共操作，
// 这里负责校验登录状态（检查请求头里的 JWT 令牌）。
package middleware

import (
	"strings"

	"campus-lost-found/store"
	"campus-lost-found/utils"

	"github.com/gin-gonic/gin"
)

// JWTAuth 登录校验中间件
func JWTAuth(s *store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 前端需要在请求头中携带：Authorization: Bearer <令牌>
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			utils.Error(c, 401, "未登录，请先登录")
			c.Abort() // 终止后续处理
			return
		}

		token := strings.TrimPrefix(header, "Bearer ")

		// 已退出登录的令牌不能再使用
		if s.IsBlacklisted(token) {
			utils.Error(c, 401, "登录已失效，请重新登录")
			c.Abort()
			return
		}

		userID, err := utils.ParseToken(token)
		if err != nil {
			utils.Error(c, 401, "令牌无效或已过期，请重新登录")
			c.Abort()
			return
		}

		// 把用户编号和原始令牌存到上下文，供后面的 handler 使用
		c.Set("userID", userID)
		c.Set("token", token)
		c.Next()
	}
}
