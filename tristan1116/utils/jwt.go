package utils

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CustomClaims 自定义载荷：除了标准字段，额外带上"这是哪个用户"
// 内嵌 jwt.RegisteredClaims 后，就自动有了 exp（过期时间）、iat（签发时间）等标准字段
type CustomClaims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// ErrTokenInvalid token 无效
var ErrTokenInvalid = errors.New("token 无效")

// 包级变量：启动时由 InitJWT 注入一次，之后只读
// （小项目常见的简化写法；大项目会用依赖注入把配置传进每个需要的地方）
var (
	jwtSecret     []byte
	jwtExpireHour int
)

// InitJWT 在 main 启动时调用一次，把配置里的密钥和有效期装进来
func InitJWT(secret string, expireHours int) {
	jwtSecret = []byte(secret)
	jwtExpireHour = expireHours
}

// GenToken 生成 token：把用户信息 + 过期时间打包，用密钥签名
func GenToken(userID uint, username string) (string, error) {
	claims := CustomClaims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(jwtExpireHour) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	// HS256 = 对称加密：同一个密钥既用来签名也用来验证
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken 解析并校验 token：签名对不对？过期没有？
func ParseToken(tokenString string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(t *jwt.Token) (any, error) {
		// 安全校验：确认对方用的就是 HS256，防止有人伪造算法（经典攻击手法）
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", t.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}

	// 类型断言：把接口类型的 Claims 转回我们自己的 CustomClaims
	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		return nil, ErrTokenInvalid
	}
	return claims, nil
}
