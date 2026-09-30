// Package db 负责建立与持有 MySQL 连接池。
//
// 使用 sqlx 包装 database/sql，仅用于简化 struct 扫描；
// 所有 SQL 仍为手写参数化语句，不使用任何 ORM。
package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/jmoiron/sqlx"

	// 注册 MySQL 驱动，副作用导入。
	_ "github.com/go-sql-driver/mysql"
)

// 连接池参数，与 SPEC 第 5 章一致。
const (
	maxOpenConns    = 25
	maxIdleConns    = 10
	connMaxLifetime = 30 * time.Minute
)

// New 依据 DSN 建立连接池并设置连接数参数。
//
// 注意：sql.Open 本身不建立真实连接，因此这里额外做一次带超时的 Ping，
// 让配置错误（库名、密码、网络）在启动阶段就暴露，而不是等第一个请求。
func New(ctx context.Context, dsn string) (*sqlx.DB, error) {
	pool, err := sqlx.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库连接失败: %w", err)
	}

	pool.SetMaxOpenConns(maxOpenConns)
	pool.SetMaxIdleConns(maxIdleConns)
	pool.SetConnMaxLifetime(connMaxLifetime)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.PingContext(pingCtx); err != nil {
		// 关闭已创建的池，避免资源泄漏。
		if closeErr := pool.Close(); closeErr != nil {
			slog.Error("关闭数据库连接池失败", "error", closeErr)
		}
		return nil, fmt.Errorf("数据库 Ping 失败: %w", err)
	}

	slog.Info("数据库连接就绪",
		"maxOpenConns", maxOpenConns,
		"maxIdleConns", maxIdleConns,
		"connMaxLifetime", connMaxLifetime.String(),
	)
	return pool, nil
}

// Health 检查数据库可用性，供健康检查接口使用。
// 返回 nil 表示连接正常；任何错误都会被原样返回，由调用方决定如何响应。
func Health(ctx context.Context, pool *sqlx.DB) error {
	if pool == nil {
		return fmt.Errorf("数据库连接池未初始化")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return pool.PingContext(ctx)
}

// Close 优雅关闭连接池。
func Close(pool *sqlx.DB) error {
	if pool == nil {
		return nil
	}
	return pool.Close()
}

// 编译期断言：确保导入的 database/sql 在本包内被使用（供 scan 辅助函数签名使用）。
var _ = sql.ErrNoRows
