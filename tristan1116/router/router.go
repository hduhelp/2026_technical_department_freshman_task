package router

import (
	"net/http"

	"lostfound/controller"
	"lostfound/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// Setup 注册所有中间件和路由，返回配置好的 Gin 引擎
func Setup() *gin.Engine {
	r := gin.Default()

	// CORS（跨域）中间件：允许前端页面从别的地址调用本服务
	// 不加的话，浏览器会拦下请求（前端页面和 API 不同源是常态，联调必炸的点）
	r.Use(cors.New(cors.Config{
		AllowAllOrigins: true,
		AllowMethods:    []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:    []string{"Origin", "Content-Type", "Authorization"},
	}))

	// 健康检查：用来确认服务活着
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "pong"})
	})

	// 托管前端页面：把 web/ 目录当作静态资源
	// 访问 http://localhost:8080/app/ 就能打开首页
	// （挂在 /app 下是为了不和 /api 路由冲突）
	r.Static("/app", "./web")

	// 访问根路径时直接跳到前端
	r.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusFound, "/app/")
	})

	// 所有业务接口统一挂在 /api 下
	api := r.Group("/api")

	// ---------- 认证模块 ----------
	auth := api.Group("/auth")
	{
		auth.POST("/register", controller.Register) // 注册
		auth.POST("/login", controller.Login)       // 登录
		auth.GET("/me", middleware.JWTAuth(), controller.GetMe)
		auth.POST("/logout", middleware.JWTAuth(), controller.Logout)
	}

	// ---------- 物品模块 ----------
	items := api.Group("/items")
	{
		items.GET("", controller.ListItems)                     // 列表（公开，支持搜索/筛选/分页）
		items.POST("", middleware.JWTAuth(), controller.CreateItem) // 发布（需登录）

		// ⚠️ /my 写在 /:id 前面：Gin 会优先匹配静态路由，但保持这个顺序更保险
		items.GET("/my", middleware.JWTAuth(), controller.MyItems) // 我的发布（需登录）

		items.GET("/:id", controller.GetItem)                                    // 详情（公开）
		items.GET("/:id/contact", middleware.JWTAuth(), controller.GetContact)   // 联系方式（需登录）
		items.PUT("/:id", middleware.JWTAuth(), controller.UpdateItem)           // 编辑（仅本人）
		items.PATCH("/:id/status", middleware.JWTAuth(), controller.UpdateStatus) // 改状态（仅本人）
		items.DELETE("/:id", middleware.JWTAuth(), controller.DeleteItem)        // 删除（仅本人）
	}

	return r
}
