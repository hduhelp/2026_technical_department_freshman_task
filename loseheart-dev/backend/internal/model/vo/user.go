package vo

import (
	"time"
)

// UserProfileVO 当前用户个人资料，不包含密码哈希和完整微信身份标识。
type UserProfileVO struct {
	ID                 string     `json:"id"`
	AccountNo          string     `json:"account_no"`
	IdentityType       string     `json:"identity_type"`
	Nickname           string     `json:"nickname"`
	AvatarURL          *string    `json:"avatar_url"`
	Role               string     `json:"role"`
	IsVerified         bool       `json:"is_verified"`
	MustChangePassword bool       `json:"must_change_password"`
	WechatBound        bool       `json:"wechat_bound"`
	WechatBoundAt      *time.Time `json:"wechat_bound_at"`
}

// AdminUserVO 管理员查看的用户资料及管理信息。
type AdminUserVO struct {
	UserProfileVO
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// WechatBindingResponseVO 微信身份绑定完成后的绑定状态响应。
type WechatBindingResponseVO struct {
	Bound          bool      `json:"bound"`
	BoundAt        time.Time `json:"bound_at"`
	ReauthRequired bool      `json:"reauth_required"`
}

// PostQuotaResponseVO 当前用户在北京时间自然日内的发帖额度响应。
type PostQuotaResponseVO struct {
	Date      string    `json:"date"`
	Limit     int       `json:"limit"`
	Used      int       `json:"used"`
	Remaining int       `json:"remaining"`
	ResetsAt  time.Time `json:"resets_at"`
}

// UserStatusResponseVO 管理员修改账号状态后的状态响应。
type UserStatusResponseVO struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// PasswordResetResponseVO 管理员重置密码后的响应；临时密码仅交付本次授权管理员，不记录日志。
type PasswordResetResponseVO struct {
	UserID             string `json:"user_id"`
	MustChangePassword bool   `json:"must_change_password"`
	TemporaryPassword  string `json:"temporary_password"`
	OperationLogID     string `json:"operation_log_id"`
}
