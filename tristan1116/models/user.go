package models

import "time"

// User 对应数据库里的 users 表
// 结构体（struct）是"把一组相关的数据打包成一个整体"；GORM 靠它自动建表/读写
// 注意：字段名首字母大写 = 公开（其他包能访问）；小写 = 私有
type User struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Username string `gorm:"type:varchar(32);uniqueIndex;not null" json:"username"` // uniqueIndex = 唯一索引，数据库层面保证用户名不重复
	Password string `gorm:"type:varchar(100);not null" json:"-"`                   // json:"-" = 序列化成 JSON 时永不输出（防止密码哈希泄露给前端）
	Nickname string `gorm:"type:varchar(32)" json:"nickname"`                      // 昵称（选填）
	// ↑ 学号（选填）；GORM 默认把 StudentID 转成列名 student_id，正合我们意
	StudentID string    `gorm:"type:varchar(32)" json:"student_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ---------- 请求结构体：前端发过来的 JSON 长什么样 ----------
// `binding:"..."` 是参数校验规则，Gin 会自动检查：
//   required = 必填；min/max = 长度范围

// RegisterRequest 注册请求体
type RegisterRequest struct {
	Username  string `json:"username" binding:"required,min=3,max=20"`
	Password  string `json:"password" binding:"required,min=6,max=32"`
	Nickname  string `json:"nickname" binding:"max=32"`
	StudentID string `json:"student_id" binding:"max=32"`
}

// LoginRequest 登录请求体
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}
