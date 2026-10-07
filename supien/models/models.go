// Package models 定义系统中用到的数据结构（相当于“数据表”）
package models

import "time"

// User 用户
type User struct {
	ID        int64     `json:"id"`         // 用户编号（唯一）
	Username  string    `json:"username"`   // 用户名（登录用，唯一）
	Password  string    `json:"-"`          // 密码的 bcrypt 加密结果，json:"-" 表示永远不会返回给前端
	Phone     string    `json:"phone"`      // 联系方式（选填）
	CreatedAt time.Time `json:"created_at"` // 注册时间
}

// ItemType 信息类型
type ItemType string

const (
	TypeLost  ItemType = "lost"  // 寻物启事：我丢了东西
	TypeFound ItemType = "found" // 招领启事：我捡到了东西
)

// ItemStatus 信息状态
type ItemStatus string

const (
	StatusSearching ItemStatus = "searching" // 寻找中
	StatusFound     ItemStatus = "found"     // 已找到
	StatusClosed    ItemStatus = "closed"    // 已结束
)

// Item 一条失物 / 招领信息
type Item struct {
	ID          int64      `json:"id"`          // 信息编号
	UserID      int64      `json:"user_id"`     // 发布者的用户编号
	Type        ItemType   `json:"type"`        // 类型：lost / found
	Title       string     `json:"title"`       // 标题
	Description string     `json:"description"` // 详细描述
	Location    string     `json:"location"`    // 丢失 / 捡到的地点
	Contact     string     `json:"contact"`     // 联系方式
	Status      ItemStatus `json:"status"`      // 状态：searching / found / closed
	CreatedAt   time.Time  `json:"created_at"`  // 发布时间
	UpdatedAt   time.Time  `json:"updated_at"`  // 最后修改时间
}
