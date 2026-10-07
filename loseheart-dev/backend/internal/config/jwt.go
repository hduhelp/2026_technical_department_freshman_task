package config

// JWTConfig 平台 JWT 与网页认证配置，读取后通过参数传给工具和中间件。
type JWTConfig struct {
	SecretKey      string
	AdminTokenName string
	UserTokenName  string
	Issuer         string
	Audience       string
	ExpiresIn      string
	CookieName     string
	CSRFCookieName string
	CSRFSecretKey  string
}
