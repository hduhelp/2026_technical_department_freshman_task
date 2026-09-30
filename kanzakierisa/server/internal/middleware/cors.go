package middleware

import (
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// devOrigins 是开发期允许跨域的前端来源。
// 前端 dev server 固定跑在 5173，另附 127.0.0.1 变体以便用 IP 访问时同样可用。
var devOrigins = []string{
	"http://localhost:5173",
	"http://127.0.0.1:5173",
}

// CORS 返回开发期跨域中间件。
//
// 生产环境（APP_ENV=production）下不放开 localhost —— 同源部署时浏览器不会发跨域请求，
// 若确有跨域需求，应在部署层显式配置网关而非在应用里放宽。
//
// isProduction 为 true 时返回一个仅做直通、不添加任何 CORS 头的中间件。
func CORS(isProduction bool) gin.HandlerFunc {
	if isProduction {
		return func(c *gin.Context) { c.Next() }
	}

	return cors.New(cors.Config{
		AllowOrigins:     devOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", HeaderRequestID},
		ExposeHeaders:    []string{HeaderRequestID},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}
