package main

import (
	"log"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/router"
)

func main() {
	// 读取 YAML，并初始化 MySQL 与 Redis。
	config.Init()
	cfg := config.ServerConfig

	// JWT 校验时查询数据库中的实时账号状态和 token_version。
	auth, err := middleware.NewAuthenticator(cfg.Jwt, middleware.GORMUserLookup(global.Db))
	if err != nil {
		log.Fatal(err)
	}

	// 网页来源和 Cookie 安全选项从 YAML 读取。
	csrf, err := middleware.NewCSRFProtector(auth, middleware.CSRFConfig{
		SecretKey:      cfg.Jwt.CSRFSecretKey,
		CookieName:     cfg.Jwt.CSRFCookieName,
		AllowedOrigins: cfg.CSRF.AllowedOrigins,
		SecureCookie:   cfg.CSRF.SecureCookie,
		MiniAppID:      cfg.WeChat.Appid,
	})
	if err != nil {
		log.Fatal(err)
	}

	// 注册路由并监听配置中的端口（例如 :8080）。
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		log.Fatal(err)
	}
	if err := r.Run(cfg.Server.Port); err != nil {
		log.Fatal(err)
	}
}
