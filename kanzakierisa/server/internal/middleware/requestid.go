package middleware

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"
)

// ContextRequestIDKey 是 request id 在 Gin context 中的键名，
// 供日志与后续链路追踪读取。
const ContextRequestIDKey = "request_id"

// HeaderRequestID 是透传 request id 的 HTTP 头名。
const HeaderRequestID = "X-Request-ID"

// RequestID 为每个请求生成唯一 id（若客户端已带 X-Request-ID 则沿用），
// 写入 context 与响应头，便于把一次请求的多条日志串起来。
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader(HeaderRequestID)
		if requestID == "" {
			requestID = newRequestID()
		}

		c.Set(ContextRequestIDKey, requestID)
		c.Header(HeaderRequestID, requestID)

		c.Next()
	}
}

// newRequestID 生成 16 字节随机数的十六进制表示（32 字符）。
// 随机源不可用时降级返回空串，不影响主流程。
func newRequestID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return hex.EncodeToString(buf)
}
