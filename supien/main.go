// 校园失物招领系统 —— 后端服务
// 启动后监听 http://localhost:8080
package main

import (
	"log"

	"campus-lost-found/handlers"
	"campus-lost-found/middleware"
	"campus-lost-found/store"

	"github.com/gin-gonic/gin"
)

func main() {
	// 1. 初始化存储（数据保存在程序同目录的 data.json 中）
	s, err := store.NewStore("data.json")
	if err != nil {
		log.Fatalf("初始化存储失败: %v", err)
	}

	// 2. 创建 Gin 路由引擎
	r := gin.Default()
	h := handlers.NewHandler(s)

	// 3. 注册路由
	api := r.Group("/api")
	{
		// 不需要登录的接口
		api.POST("/register", h.Register) // 用户注册
		api.POST("/login", h.Login)       // 用户登录

		// 以下接口都需要登录（经过 JWT 中间件校验）
		auth := api.Group("/")
		auth.Use(middleware.JWTAuth(s))
		{
			// 用户相关
			auth.POST("/logout", h.Logout) // 退出登录
			auth.GET("/user/me", h.Me)     // 获取当前用户信息

			// 失物 / 招领信息相关
			auth.GET("/items", h.ListItems)               // 查看 / 搜索信息列表
			auth.GET("/items/:id", h.GetItem)             // 查看信息详情
			auth.POST("/items", h.CreateItem)             // 发布信息
			auth.PUT("/items/:id", h.UpdateItem)          // 修改自己的信息
			auth.DELETE("/items/:id", h.DeleteItem)       // 删除自己的信息
			auth.PATCH("/items/:id/status", h.UpdateItemStatus) // 修改信息状态
		}
	}

	// 4. 启动服务
	log.Println("校园失物招领系统已启动，监听地址：http://localhost:8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
