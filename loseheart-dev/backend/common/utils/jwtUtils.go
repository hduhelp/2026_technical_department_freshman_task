package utils

import (
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/model"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const TokenLifetime = 24 * time.Hour

func ValidateJWTConfig(cfg config.JWTConfig) error {
	if len(cfg.SecretKey) < 32 || strings.TrimSpace(cfg.Issuer) == "" || strings.TrimSpace(cfg.Audience) == "" {
		return errs.JWTConfigError
	}
	return nil
}

// GenerateJWT 应在成功认证并读取实时 token_version 后调用。
// 返回 claims 供登录响应获得到期时间和 CSRF 绑定用的 jti。
func GenerateJWT(cfg config.JWTConfig, userID, tokenVersion uint64) (string, *model.JWTClaims, error) {
	if err := ValidateJWTConfig(cfg); err != nil {
		return "", nil, err
	}
	if userID == 0 || tokenVersion == 0 {
		return "", nil, errs.JWTIdentityError
	}
	now := time.Now().UTC().Truncate(time.Second)
	claims := &model.JWTClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: strconv.FormatUint(userID, 10), Issuer: cfg.Issuer,
			Audience: jwt.ClaimStrings{cfg.Audience}, ID: uuid.NewString(),
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(TokenLifetime)),
		}, TokenVersion: tokenVersion,
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(cfg.SecretKey))
	if err != nil {
		return "", nil, err
	}
	return token, claims, nil
}

// ParseJWT 只校验令牌；实时账号状态和版本由认证中间件检查。
func ParseJWT(cfg config.JWTConfig, token string) (*model.JWTClaims, error) {
	if err := ValidateJWTConfig(cfg); err != nil {
		return nil, err
	}
	claims := new(model.JWTClaims)
	parsed, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return []byte(cfg.SecretKey), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(), jwt.WithIssuer(cfg.Issuer), jwt.WithAudience(cfg.Audience))
	if err != nil {
		return nil, err
	}
	if !parsed.Valid || claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.ID == "" || claims.TokenVersion == 0 ||
		!claims.ExpiresAt.After(claims.IssuedAt.Time) || claims.ExpiresAt.Sub(claims.IssuedAt.Time) != TokenLifetime {
		return nil, errs.JWTClaimsError
	}
	id, err := strconv.ParseUint(claims.Subject, 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != claims.Subject {
		return nil, errs.JWTSubjectError
	}
	return claims, nil
}
