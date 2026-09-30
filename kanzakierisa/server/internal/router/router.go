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
	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
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

	api := engine.Group("/api")
	{
		api.GET("/health", healthHandler(pool))
	}

	return engine
}

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
