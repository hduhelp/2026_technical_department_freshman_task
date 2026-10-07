package dto

// WechatBindingDTO 绑定微信身份的请求参数，条件校验由业务层执行。
type WechatBindingDTO struct {
	Code            string  `json:"code" binding:"required"`
	CurrentPassword *string `json:"current_password"`
}

// AdminUserQueryDTO 后台用户列表的分页与身份、状态等筛选参数。
type AdminUserQueryDTO struct {
	PageQueryDTO
	AccountNo    string `form:"account_no" binding:"omitempty,max=32"`
	Nickname     string `form:"nickname" binding:"omitempty,max=50"`
	Status       string `form:"status" binding:"omitempty,oneof=active disabled"`
	IdentityType string `form:"identity_type" binding:"omitempty,oneof=student staff"`
}

// UserStatusDTO 管理员修改账号状态的请求体。
type UserStatusDTO struct {
	Status string `json:"status" binding:"required,eq=disabled"`
	Reason string `json:"reason" binding:"required,max=500"`
}

// PasswordResetDTO 管理员重置用户密码的请求体，记录重置原因。
type PasswordResetDTO struct {
	Reason string `json:"reason" binding:"required,max=500"`
}
