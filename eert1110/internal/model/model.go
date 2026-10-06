package model

import "time"

// 遗失物类别
const (
	CategoryLost  = "lost"  // 寻物启事：寻找遗失物
	CategoryFound = "found" // 招领启事：发现/捡到遗失物
)

// 遗失物状态
const (
	StatusUnclaimed = "unclaimed" // 未领取
	StatusClaimed   = "claimed"   // 已领取
)

// User 用户账户
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"` // 加盐 PBKDF2 哈希，序列化时隐藏
	CreatedAt    time.Time `json:"created_at"`
}

// Contact 联系方式
type Contact struct {
	Name    string `json:"name"`             // 联系人姓名
	Phone   string `json:"phone,omitempty"`  // 电话
	WeChat  string `json:"wechat,omitempty"` // 微信
	Email   string `json:"email,omitempty"`  // 邮箱
	Message string `json:"message,omitempty"` // 备注
}

// Item 遗失物信息
type Item struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`        // 标题
	Description   string    `json:"description"`  // 基本信息/详细描述
	Category      string    `json:"category"`     // lost | found
	Location      string    `json:"location"`     // 遗失/捡到地点
	LostAt        time.Time `json:"lost_at"`      // 遗失/捡到时间
	Contact       Contact   `json:"contact"`      // 联系方式
	Status        string    `json:"status"`       // unclaimed | claimed
	PublisherID   string    `json:"publisher_id"` // 发布者用户 ID
	PublisherName string    `json:"publisher_name"` // 发布者用户名（冗余，便于展示）
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
