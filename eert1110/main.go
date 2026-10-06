package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lost-and-found/internal/handler"
	"lost-and-found/internal/store"
)

//go:embed all:web
var webFS embed.FS

func main() {
	addr := flag.String("addr", ":8080", "监听地址")
	dataPath := flag.String("data", "data.json", "数据文件路径")
	flag.Parse()

	st, err := store.New(*dataPath)
	if err != nil {
		log.Fatalf("初始化数据存储失败: %v", err)
	}

	static, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载前端资源失败: %v", err)
	}

	server := &http.Server{
		Addr:    *addr,
		Handler: handler.New(st, static).Routes(),
	}

	go func() {
		log.Printf("失物招领服务已启动: http://localhost%s", *addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	// 等待中断信号，优雅退出
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("关闭服务出错: %v", err)
	}
	log.Println("服务已关闭")
}
