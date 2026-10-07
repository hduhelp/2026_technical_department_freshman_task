package entity

import "time"

// User 对应 users 表；不嵌入 gorm.Model，不引入软删除，也不直接作为 JSON 响应。
type User struct {
	ID                 uint64     `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	AccountNo          string     `gorm:"column:account_no" json:"-"`
	IdentityType       string     `gorm:"column:identity_type" json:"-"`
	Nickname           string     `gorm:"column:nickname" json:"-"`
	AvatarURL          *string    `gorm:"column:avatar_url" json:"-"`
	PasswordHash       string     `gorm:"column:password_hash" json:"-"`
	TokenVersion       uint64     `gorm:"column:token_version;default:1" json:"-"`
	MustChangePassword bool       `gorm:"column:must_change_password" json:"-"`
	Role               string     `gorm:"column:role;default:user" json:"-"`
	Status             string     `gorm:"column:status;default:active" json:"-"`
	IsVerified         bool       `gorm:"column:is_verified" json:"-"`
	WechatAppID        *string    `gorm:"column:wechat_appid" json:"-"`
	WechatOpenID       *string    `gorm:"column:wechat_openid" json:"-"`
	WechatBoundAt      *time.Time `gorm:"column:wechat_bound_at" json:"-"`
	PasswordChangedAt  time.Time  `gorm:"column:password_changed_at;autoCreateTime" json:"-"`
	CreatedAt          time.Time  `gorm:"column:created_at" json:"-"`
	UpdatedAt          time.Time  `gorm:"column:updated_at" json:"-"`
}

// AuthUser 是认证查询的投影，不包含密码或微信标识。
type AuthUser struct {
	ID                 uint64
	TokenVersion       uint64
	Role               string
	Status             string
	IsVerified         bool
	MustChangePassword bool
}
