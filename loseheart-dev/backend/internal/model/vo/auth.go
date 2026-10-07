package vo

import "time"

// LoginUserVO 登录成功后返回的用户摘要，不包含密码或微信身份标识。
type LoginUserVO struct {
	ID                 string `json:"id"`
	Nickname           string `json:"nickname"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

// LoginResponseVO 登录成功的响应数据；网页通过 HttpOnly Cookie 交付 JWT，不设置 AccessToken/TokenType。
type LoginResponseVO struct {
	User        LoginUserVO `json:"user"`
	ExpiresAt   time.Time   `json:"expires_at"`
	AccessToken string      `json:"access_token,omitempty"`
	TokenType   string      `json:"token_type,omitempty"`
	CSRFToken   string      `json:"csrf_token,omitempty"`
}

// CSRFResponseVO 获取 CSRF 凭证接口的响应数据。
type CSRFResponseVO struct {
	CSRFToken string `json:"csrf_token"`
}
