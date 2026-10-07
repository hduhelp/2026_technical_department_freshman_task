package utils

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// jwtSecret 是给令牌签名的“密钥”，实际项目中应放在配置文件或环境变量里
var jwtSecret = []byte("campus-lost-found-secret-key")

// TokenExpireDuration 令牌有效期：72 小时
const TokenExpireDuration = 72 * time.Hour

// newJTI 生成一个随机的令牌唯一编号，保证即使同一秒内多次签发，
// 生成的令牌也互不相同（避免“退出后立刻重新登录拿到相同令牌”的问题）。
func newJTI() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// 极端情况下随机数失败，退化为纳秒时间戳
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

// GenerateToken 为指定用户生成一个 JWT 令牌
func GenerateToken(userID int64) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"user_id": userID,
		"jti":     newJTI(),                     // 令牌唯一编号
		"iat":     now.Unix(),                  // 签发时间
		"exp":     now.Add(TokenExpireDuration).Unix(), // 过期时间
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken 解析并校验令牌，成功时返回其中的用户编号
func ParseToken(tokenString string) (int64, error) {
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		// 确认签名算法是我们预期的 HMAC
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("令牌签名算法不正确")
		}
		return jwtSecret, nil
	})
	if err != nil {
		return 0, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return 0, errors.New("无效的令牌")
	}

	// JWT 里的数字解析出来是 float64，需要转回 int64
	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return 0, errors.New("令牌内容不正确")
	}
	return int64(userIDFloat), nil
}
