// Package model 定义数据库实体与对外传输对象（DTO）。
//
// 分层约定：实体（带 db tag）只用于 store 层读写数据库；
// DTO（带 json tag）只用于 handler 层编解码。两者分开，
// 避免「数据库列名」与「接口字段」互相污染，也天然防止 password_hash 外泄。
package model

import (
	"time"
)

// 用户角色枚举。
const (
	RoleUser  = "user"  // 普通用户
	RoleAdmin = "admin" // 管理员
)

// User 对应 users 表的一行。
//
// ⚠️ PasswordHash 的 json tag 必须是 "-"：实体可能被误放进响应体，
// 这一行 tag 是最后一道防线，任何情况下都不能把哈希返回给前端。
type User struct {
	ID            int64     `db:"id"`
	Username      string    `db:"username"`
	PasswordHash  string    `db:"password_hash" json:"-"`
	Nickname      string    `db:"nickname"`
	Contact       string    `db:"contact"`
	ContactPublic bool      `db:"contact_public"`
	Role          string    `db:"role"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

// UserDTO 是用户对外的 JSON 形状，对应 SPEC 8.3 的 User。
//
// 字段顺序与命名严格照 SPEC，时间统一 RFC3339（UTC）。
type UserDTO struct {
	ID            int64  `json:"id"`
	Username      string `json:"username"`
	Nickname      string `json:"nickname"`
	Contact       string `json:"contact"`
	ContactPublic bool   `json:"contact_public"`
	Role          string `json:"role"`
	CreatedAt     string `json:"created_at"`
}

// ToUserDTO 把实体转换为对外 DTO。
//
// 时间固定按 UTC 输出 RFC3339，不依赖 encoding/json 对 time.Time 的默认序列化
// —— 后者会带上数据库连接的时区，容易造成前端显示差 8 小时（SPEC 02 常见坑 5）。
func ToUserDTO(u *User) *UserDTO {
	if u == nil {
		return nil
	}
	return &UserDTO{
		ID:            u.ID,
		Username:      u.Username,
		Nickname:      u.Nickname,
		Contact:       u.Contact,
		ContactPublic: u.ContactPublic,
		Role:          u.Role,
		CreatedAt:     u.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// RegisterReq 是 POST /api/auth/register 的请求体。
//
// 只做「形状级」binding（必填、长度），语义级校验（用户名字符集、密码长度）
// 放在 service 层，便于单元测试且能给出更精确的错误文案。
type RegisterReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Nickname string `json:"nickname"`
}

// LoginReq 是 POST /api/auth/login 的请求体。
type LoginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// UpdateMeReq 是 PATCH /api/users/me 的请求体。
//
// ⚠️ 三个字段全部用**指针**：只有请求里真正出现的字段才会被更新。
// 若用 string，前端不传时会被 Go 解码成空串，把用户昵称/联系方式清空
// —— 这是 SPEC 02「常见坑 1」点名的问题。
//
// 结构体刻意**不包含** role / username / password_hash：
// 即使请求体里带了这些键，encoding/json 也会因找不到目标字段而直接忽略，
// 提权在解码阶段就被挡掉，不依赖后续逻辑谨慎处理（SPEC 10 安全基线）。
type UpdateMeReq struct {
	Nickname      *string `json:"nickname"`
	Contact       *string `json:"contact"`
	ContactPublic *bool   `json:"contact_public"`
}

// AuthResult 是登录成功返回的数据体：token + 用户信息。
type AuthResult struct {
	Token string   `json:"token"`
	User  *UserDTO `json:"user"`
}

// RegisterResult 是注册成功返回的数据体。
//
// 按 SPEC 02 的约定，注册**不自动登录**，只返回用户信息，
// 前端拿到后跳转登录页由用户主动登录（已在 docs/api.md 中声明）。
type RegisterResult struct {
	User *UserDTO `json:"user"`
}
