// Package router 集中注册全部 HTTP 路由，是项目中唯一的路由清单。
//
// 新增接口只在此处登记，避免路由散落各处导致难以审计。
package router

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"

	"hdu-lostfound/internal/config"
	"hdu-lostfound/internal/db"
	"hdu-lostfound/internal/handler"
	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/jwtutil"
	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
	"hdu-lostfound/internal/store"
)

// New 组装中间件链与路由表并返回可用的 *gin.Engine。
//
// pool 用于健康检查真实探测数据库；若为 nil，健康检查返回 503。
func New(cfg *config.Config, pool *sqlx.DB) *gin.Engine {
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.New()

	// 中间件顺序：request id → 访问日志 → panic 兜底 → CORS。
	// request id 最先注入，保证后续所有中间件与 handler 都能取到；
	// recover 放在日志之后，确保 panic 前的访问日志仍能落盘。
	engine.Use(middleware.RequestID())
	engine.Use(gin.Logger())
	engine.Use(middleware.Recover())
	engine.Use(middleware.CORS(cfg.IsProduction()))

	// 统一 404 / 405 的响应体形状，与业务接口保持一致。
	engine.NoRoute(func(c *gin.Context) {
		response.Fail(c, apperr.New(apperr.CodeNotFound))
	})
	engine.NoMethod(func(c *gin.Context) {
		response.Fail(c, apperr.New(apperr.CodeNotFound))
	})

	// ===== 依赖装配 =====
	// 依赖在 router 一处集中构造并向下传递，避免各层自行 new 出隐藏的耦合。
	// 目前规模不值得引入 DI 框架，显式手工装配反而更易读。
	userStore := store.NewUserStore(pool)
	postStore := store.NewPostStore(pool)
	tokenManager := jwtutil.NewManager(cfg.JWTSecret, cfg.JWTExpireHours)

	authService := service.NewAuthService(userStore, tokenManager)
	userService := service.NewUserService(userStore)
	postService := service.NewPostService(postStore, userStore)

	authHandler := handler.NewAuthHandler(authService)
	userHandler := handler.NewUserHandler(userService)
	postHandler := handler.NewPostHandler(postService)
	uploadHandler := handler.NewUploadHandler(cfg)

	// 鉴权中间件需要「按 id 回查用户」，这里把 AuthService 适配成中间件的窄接口，
	// 让 middleware 包不必依赖 service 包（依赖方向保持单向：router → 全部）。
	loader := &authLoader{auth: authService}

	// 上传文件的静态托管。注意挂在 /uploads（**不是** /api/uploads），
	// 且必须在 api.Group 之外 —— 图片是公开资源，不应经过 /api 前缀，
	// 也不应被 API 的鉴权中间件拦截（SPEC 03 要点 8）。
	engine.Static("/uploads", cfg.UploadDir)

	api := engine.Group("/api")
	{
		api.GET("/health", healthHandler(pool))

		// 公开接口：无需登录
		api.POST("/auth/register", authHandler.Register)
		api.POST("/auth/login", authHandler.Login)
		// 列表对游客开放：浏览 / 搜索是路人也能用的能力（SPEC 用户故事 3）。
		// 联系方式不在列表里返回，因此公开它不会带来泄露面。
		api.GET("/posts", postHandler.List)

		// 软鉴权接口：登录与否都能访问，登录用户能拿到额外视角字段
		// （本人可见的联系方式、can_edit / can_claim）。
		soft := api.Group("", middleware.OptionalAuth(tokenManager, loader))
		{
			soft.GET("/posts/:id", postHandler.Detail)
		}

		// 受保护接口：必须携带合法 Bearer token
		authed := api.Group("", middleware.Auth(tokenManager, loader))
		{
			authed.POST("/auth/logout", authHandler.Logout)
			authed.GET("/users/me", userHandler.Me)
			authed.PATCH("/users/me", userHandler.UpdateMe)
			// 「我的帖子」：user_id 固定取当前登录用户，不接受查询参数。
			authed.GET("/users/me/posts", postHandler.ListMine)

			authed.POST("/posts", postHandler.Create)
			authed.PUT("/posts/:id", postHandler.Update)
			authed.DELETE("/posts/:id", postHandler.Delete)
			// 状态流转走 SPEC 7.1 白名单，仅作者可操作。
			authed.PATCH("/posts/:id/status", postHandler.ChangeStatus)

			authed.POST("/upload", uploadHandler.Upload)
		}
	}

	return engine
}

// authLoader 把 *service.AuthService 适配为 middleware.UserLoader。
//
// 存在的意义是隔离依赖方向：middleware 包只认窄接口，
// 不需要 import service，从而避免包依赖成环。
type authLoader struct {
	auth *service.AuthService
}

// Authenticate 实现 middleware.UserLoader。
//
// 把 gin.Context 上的 *http.Request 转成 context.Context 传给 service，
// 让数据库调用能随请求取消 —— 这也是 SPEC 3.3「DB 调用必须带 context」的落地。
func (l *authLoader) Authenticate(c *gin.Context, userID int64) (*model.User, error) {
	return l.auth.Authenticate(c.Request.Context(), userID)
}

// 编译期断言：确保 authLoader 满足中间件契约。
var _ middleware.UserLoader = (*authLoader)(nil)

// healthHandler 真实探测数据库连通性。
//
// 数据库正常：HTTP 200，data.db = "up"；
// 数据库异常：HTTP 503，data.db = "down"，便于探针据此摘流量。
// 两种情况 code 均为 0 —— 业务码表示「服务本身能应答」，可用性由 HTTP 状态码表达。
func healthHandler(pool *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := db.Health(c.Request.Context(), pool); err != nil {
			c.JSON(http.StatusServiceUnavailable, response.Body{
				Code:    apperr.CodeOK,
				Message: "ok",
				Data:    gin.H{"db": "down"},
			})
			return
		}
		response.OK(c, gin.H{"db": "up"})
	}
}
