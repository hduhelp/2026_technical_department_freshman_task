package config

import (
	"context"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/global"

	"github.com/redis/go-redis/v9"
)

// redis配置
func redisConfig() {
	// 创建redis客户端
	RedisClient := redis.NewClient(&redis.Options{
		Addr:     ServerConfig.Redis.Host + ":" + ServerConfig.Redis.Port,
		Password: ServerConfig.Redis.Password,
		DB:       ServerConfig.Redis.Database,
	})
	// 检查是否连接成功
	_, err := RedisClient.Ping(context.Background()).Result()
	if err != nil {
		panic(errs.RedisConnectionError)
	}
	// 赋值给全局变量
	global.RedisClient = RedisClient
}
