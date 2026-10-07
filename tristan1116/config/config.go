package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config 是配置文件的顶层结构
// 每个字段后面的 `yaml:"xxx"` 叫 struct tag，告诉 yaml 库"这个字段对应 yaml 里的哪个 key"
type Config struct {
	Server ServerConfig `yaml:"server"`
	MySQL  MySQLConfig  `yaml:"mysql"`
	JWT    JWTConfig    `yaml:"jwt"`
}

// ServerConfig 服务器配置
type ServerConfig struct {
	Port int `yaml:"port"`
}

// MySQLConfig 数据库连接配置
type MySQLConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
}

// JWTConfig 登录令牌配置
type JWTConfig struct {
	Secret      string `yaml:"secret"`       // 签名密钥（相当于"印章"，泄露了别人就能伪造 token）
	ExpireHours int    `yaml:"expire_hours"` // token 有效期（小时）
}

// DSN 把配置拼成 MySQL 驱动认识的连接字符串
// 三个关键参数：charset=utf8mb4（支持中文/emoji）、parseTime=True（时间字段自动转 time.Time）、loc=Local（用本地时区）
func (m MySQLConfig) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		m.User, m.Password, m.Host, m.Port, m.DBName)
}

// Load 从指定路径读取并解析 yaml 配置文件
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}
	return &cfg, nil
}
