package model

import "github.com/golang-jwt/jwt/v5"

// JWTClaims 表达平台令牌载荷，不包含密码、联系方式或可信管理员角色。
type JWTClaims struct {
	jwt.RegisteredClaims
	TokenVersion uint64 `json:"token_version"`
}
