// Package jwtutil 封装 JWT 的签发与解析。
//
// 设计要点：
//  1. 算法固定 HS256。解析时**必须**传 jwt.WithValidMethods([]string{"HS256"})，
//     否则攻击者可以把头部改成 alg:none 或 HS/RS 混用来绕过验签。
//  2. Claims 只携带 uid，不放昵称、角色等可变量 —— token 有效期长达 168 小时，
//     期间用户资料可能改变，权限判定必须回源数据库（见 middleware.Auth）。
//  3. 时间语义统一 UTC，签发与校验都走 jwt.RegisteredClaims，不自己算时间戳。
package jwtutil

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// signingMethod 是本项目唯一允许的签名算法。
var signingMethod = jwt.SigningMethodHS256

// ErrInvalidToken 表示 token 非法：格式错误、算法不符、签名不对或已过期。
// 上层统一把它翻译成业务错误 1002，不向调用方暴露具体原因。
var ErrInvalidToken = errors.New("token 非法或已过期")

// Claims 是本项目的 JWT 载荷。
//
// UID 为自定义声明（用户主键）；签发/过期时间由内嵌的
// jwt.RegisteredClaims 承载（iat / exp），避免手写时间戳导致时区错乱。
type Claims struct {
	UID int64 `json:"uid"`

	jwt.RegisteredClaims
}

// Manager 持有签名密钥与有效期，是签发与解析的唯一入口。
type Manager struct {
	secret      []byte
	expireHours int
}

// NewManager 创建一个 JWT 管理器。
//
// secret 为 HS256 密钥（来自配置，启动时已校验非空且非默认值）；
// expireHours 为有效期小时数，非正数时回落 168（与 SPEC 默认值一致）。
func NewManager(secret string, expireHours int) *Manager {
	if expireHours <= 0 {
		expireHours = 168
	}
	return &Manager{
		secret:      []byte(secret),
		expireHours: expireHours,
	}
}

// Generate 为指定用户签发 token。
//
// 返回值为紧凑序列化后的 JWT 字符串（header.payload.signature）。
func (m *Manager) Generate(userID int64) (string, error) {
	now := time.Now().UTC()

	claims := Claims{
		UID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(m.expireHours) * time.Hour)),
		},
	}

	token, err := jwt.NewWithClaims(signingMethod, claims).SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("签发 token 失败: %w", err)
	}
	return token, nil
}

// Parse 校验 token 并返回其中的用户 id。
//
// 校验项：签名算法必须为 HS256（拒绝 alg:none / 算法混用）、签名有效、未过期。
// 任一项不通过都返回 ErrInvalidToken，调用方不需要区分原因。
func (m *Manager) Parse(token string) (int64, error) {
	if token == "" {
		return 0, ErrInvalidToken
	}

	parsed, err := jwt.ParseWithClaims(
		token,
		&Claims{},
		func(t *jwt.Token) (any, error) {
			// 双保险：WithValidMethods 已在库层面拦截，这里再确认一次算法类型。
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, ErrInvalidToken
			}
			return m.secret, nil
		},
		// 关键：限定算法白名单，堵住 alg:none 攻击面（SPEC 02 常见坑 2）。
		jwt.WithValidMethods([]string{signingMethod.Alg()}),
		// 显式要求 exp 存在且在有效期内。
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return 0, ErrInvalidToken
	}

	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return 0, ErrInvalidToken
	}
	if claims.UID <= 0 {
		return 0, ErrInvalidToken
	}
	return claims.UID, nil
}
