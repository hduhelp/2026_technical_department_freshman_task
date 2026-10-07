// Command api 是校园失物招领系统的后端入口。
//
// 启动流程：加载配置 → 建立数据库连接池 → 组装路由 → 监听端口。
// 任一环节失败都直接退出，不带病启动。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"hdu-lostfound/internal/config"
	"hdu-lostfound/internal/db"
	"hdu-lostfound/internal/router"
)

func main() {
	if err := run(); err != nil {
		slog.Error("服务启动失败", "error", err)
		os.Exit(1)
	}
}

// run 承载完整启动逻辑，便于统一处理错误与退出码。
func run() error {
	// 日志统一使用 JSON handler，方便后续接入日志采集。
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.Info("配置加载完成", "appEnv", cfg.AppEnv, "appPort", cfg.AppPort)

	// 用带超时的根 context 建连，避免数据库不可达时长时间挂起。
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelStartup()

	pool, err := db.New(startupCtx, cfg.DSN())
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := db.Close(pool); closeErr != nil {
			slog.Error("关闭数据库连接池失败", "error", closeErr)
		}
	}()

	engine := router.New(cfg, pool)

	server := &http.Server{
		Addr:              ":" + itoa(cfg.AppPort),
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 在独立 goroutine 中启动，主 goroutine 负责等待退出信号。
	serverErr := make(chan error, 1)
	go func() {
		slog.Info("HTTP 服务启动", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	// 等待退出信号或监听失败。
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		if err != nil {
			return err
		}
		return nil
	case sig := <-quit:
		slog.Info("收到退出信号，开始优雅关闭", "signal", sig.String())
	}

	// 给在途请求最多 10 秒收尾时间。
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()

	if err := server.Shutdown(shutdownCtx); err != nil {
		return err
	}
	slog.Info("服务已关闭")
	return nil
}

// itoa 把端口号转为字符串，避免引入 strconv 只为一次转换。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
