package auth

import (
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/entity"
)

// LoginResult 仅在 service 与 controller 之间传递，不对应数据库表或直接作为响应。
type LoginResult struct {
	User   entity.User
	Token  string
	Claims *model.JWTClaims
}

// WechatSessionResponse 表达微信 code2Session 的必要字段，不持久化 session_key。
type WechatSessionResponse struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	ErrorCode  int    `json:"errcode"`
}
