package dto

// LoginRequestDTO 账号密码或微信授权码登录的请求参数。
type LoginRequestDTO struct {
	GrantType  string `json:"grant_type" binding:"required,oneof=password wechat_code"`
	ClientType string `json:"client_type" binding:"required,oneof=web miniapp admin_web"`
	AccountNo  string `json:"account_no"`
	Password   string `json:"password"`
	Code       string `json:"code"`
}

// ChangePasswordRequestDTO 当前用户修改密码的请求参数，不包含服务端身份信息。
type ChangePasswordRequestDTO struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required"`
}
