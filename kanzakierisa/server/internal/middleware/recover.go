// Package middleware 提供 Gin 全局中间件。
package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
)

// Recover 是统一 panic 兜底中间件。
//
// 与 gin.Recovery() 的区别：内部错误只对外返回 5000，绝不把堆栈暴露给前端；
// 堆栈与请求上下文写入 slog，便于排查。
func Recover() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("请求处理发生 panic",
					"request_id", c.GetString(ContextRequestIDKey),
					"method", c.Request.Method,
					"path", c.Request.URL.Path,
					"panic", r,
					"stack", string(debug.Stack()),
				)

				// 已在写响应头的情况下无法再改状态码，直接中断。
				if c.Writer.Written() {
					c.Abort()
					return
				}

				response.Fail(c, apperr.New(apperr.CodeInternal))
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()

		c.Next()
	}
}
