package global

import (
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

var (
	// Db 数据库连接
	Db *gorm.DB
	// RedisClient redis连接客户端
	RedisClient *redis.Client
)
