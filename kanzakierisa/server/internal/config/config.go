// Package config 负责加载与校验运行期配置。
//
// 配置来源为进程环境变量；启动时若存在 .env 文件则先加载它
// （godotenv 不会覆盖已存在的真实环境变量，便于容器部署时用环境变量兜底）。
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// defaultJWTSecret 是 .env.example 里的占位密钥。
// 启动时若检测到密钥仍为该值，视为未配置并直接退出，避免用弱密钥签发 token。
const defaultJWTSecret = "change_me_to_a_long_random_string"

// Config 汇总服务运行所需的全部配置项。
type Config struct {
	AppPort int    // HTTP 监听端口
	AppEnv  string // 运行环境：development / production

	DBHost     string // MySQL 主机
	DBPort     string // MySQL 端口
	DBUser     string // MySQL 用户名
	DBPassword string // MySQL 密码
	DBName     string // 数据库名

	JWTSecret      string // JWT 签名密钥（HS256）
	JWTExpireHours int    // token 有效期（小时）

	UploadDir     string // 上传文件落盘目录（相对 server/ 或绝对路径）
	UploadMaxMB   int64  // 上传单文件体积上限（MB）
	PublicBaseURL string // 对外可访问的基础 URL，用于拼图片绝对地址
}

// IsProduction 判断当前是否为生产环境（用于决定 CORS 策略等）。
func (c *Config) IsProduction() bool {
	return c.AppEnv == "production"
}

// UploadMaxBytes 返回上传体积上限的字节数。
func (c *Config) UploadMaxBytes() int64 {
	return c.UploadMaxMB * 1024 * 1024
}

// Load 读取 .env（若存在）并组装 Config。
//
// 关键项（DB_HOST / DB_PORT / DB_USER / DB_NAME / JWT_SECRET）缺失时返回错误，
// 由 main 打印后退出。其余项缺失时回落 SPEC 第 5 章的默认值。
func Load() (*Config, error) {
	// .env 不存在属于正常情况（例如 CI 或容器内直接用环境变量），不视为错误；
	// 但「文件存在却解析失败」必须留下痕迹 —— 那种情况下配置会静默地退回
	// 环境变量或默认值，表现为一次莫名其妙的「我明明改了 .env 却没生效」。
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		slog.Warn("加载 .env 失败，将只使用进程环境变量", "error", err)
	}

	cfg := &Config{
		AppPort:    getInt("APP_PORT", 8080),
		AppEnv:     getString("APP_ENV", "development"),
		DBHost:     getString("DB_HOST", ""),
		DBPort:     getString("DB_PORT", ""),
		DBUser:     getString("DB_USER", ""),
		DBPassword: getString("DB_PASSWORD", ""),
		DBName:     getString("DB_NAME", ""),

		JWTSecret:      getString("JWT_SECRET", ""),
		JWTExpireHours: getInt("JWT_EXPIRE_HOURS", 168),

		UploadDir:     getString("UPLOAD_DIR", "uploads"),
		UploadMaxMB:   int64(getInt("UPLOAD_MAX_MB", 2)),
		PublicBaseURL: getString("PUBLIC_BASE_URL", "http://localhost:8080"),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// validate 校验必填项与取值范围。
func (c *Config) validate() error {
	var missing []string
	for name, value := range map[string]string{
		"DB_HOST": c.DBHost,
		"DB_PORT": c.DBPort,
		"DB_USER": c.DBUser,
		"DB_NAME": c.DBName,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		// map 遍历无序，排序保证报错信息稳定可读。
		sortStrings(missing)
		return fmt.Errorf("缺少必填配置项：%s（请参考 .env.example 补全 .env）", strings.Join(missing, ", "))
	}

	if strings.TrimSpace(c.JWTSecret) == "" {
		return errors.New("缺少必填配置项：JWT_SECRET")
	}
	if c.JWTSecret == defaultJWTSecret {
		return errors.New("JWT_SECRET 仍为默认占位值，请改成一个足够长的随机字符串后再启动")
	}
	if c.JWTExpireHours <= 0 {
		return errors.New("JWT_EXPIRE_HOURS 必须为正整数")
	}
	if c.AppPort <= 0 || c.AppPort > 65535 {
		return fmt.Errorf("APP_PORT 非法：%d", c.AppPort)
	}
	if c.UploadMaxMB <= 0 {
		return fmt.Errorf("UPLOAD_MAX_MB 非法：%d", c.UploadMaxMB)
	}
	return nil
}

// DSN 按 SPEC 第 5 章规则拼装 MySQL 连接串。
//
// parseTime=true 让 DATETIME 直接扫描进 time.Time；
// loc=UTC 保证时区语义统一（否则 DATETIME 会按本地时区解析，导致前端差 8 小时）。
//
// ⚠️ 额外补一个 time_zone='+00:00'，这一项是必需的、不能省：
// loc=UTC 只影响**驱动解析** DATETIME 的方式，并不会改变 MySQL 会话时区。
// 而 created_at / updated_at 用的是 DEFAULT CURRENT_TIMESTAMP / ON UPDATE
// CURRENT_TIMESTAMP，MySQL 按**会话时区**求值。若会话时区是 SYSTEM（本机为 +08），
// 写进库里的就是本地墙上时间，再被 loc=UTC 当成 UTC 解析 —— 结果整整快 8 小时，
// 前端会把刚发布的帖子显示成"未来时间"。
// 把会话时区也钉在 UTC，读写两端才真正对上 SPEC 第 6 章「所有时间字段存 UTC」。
//
// 注意取值的写法：MySQL 的 time_zone 需要带引号的字符串字面量，
// 即 SET time_zone='+00:00'，所以这里要把引号一起做 URL 编码（%27...%27）。
func (c *Config) DSN() string {
	return fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=UTC&charset=utf8mb4&collation=utf8mb4_unicode_ci",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName,
	) + "&time_zone=" + url.QueryEscape("'+00:00'")
}

// getString 读取字符串环境变量，缺失或为空时返回默认值。
func getString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// getInt 读取整型环境变量，缺失或无法解析时返回默认值。
func getInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

// sortStrings 是简单的插入排序，避免为一个微小需求引入 sort 包以外的依赖复杂度。
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
