package models

import "time"

// ---------- 三组枚举常量 ----------
// 用"自定义类型 + 常量"代替裸字符串：写错时编译期就报错，不会等到运行时才发现

// ItemType 帖子类型
type ItemType string

const (
	ItemTypeLost  ItemType = "lost"  // 失物：我丢了东西，求线索
	ItemTypeFound ItemType = "found" // 招领：我捡到东西，等认领
)

// ItemStatus 帖子状态（只能前进：searching → resolved → closed）
type ItemStatus string

const (
	StatusSearching ItemStatus = "searching" // 寻找中（招领帖的界面文案叫"待认领"）
	StatusResolved  ItemStatus = "resolved"  // 已找到（招领帖叫"已认领"）
	StatusClosed    ItemStatus = "closed"    // 已结束（归档）
)

// ItemCategory 物品分类
type ItemCategory string

const (
	CategoryCard        ItemCategory = "card"        // 证件卡类
	CategoryElectronics ItemCategory = "electronics" // 电子设备
	CategoryBooks       ItemCategory = "books"       // 书籍资料
	CategoryClothing    ItemCategory = "clothing"    // 衣物配饰
	CategoryDaily       ItemCategory = "daily"       // 生活用品
	CategoryOther       ItemCategory = "other"       // 其他
)

// Item 对应数据库里的 items 表（失物/招领帖）
type Item struct {
	ID         uint         `gorm:"primaryKey" json:"id"`
	Type       ItemType     `gorm:"type:varchar(16);not null;index" json:"type"`
	Title      string       `gorm:"type:varchar(64);not null" json:"title"`   // 物品名称
	Category   ItemCategory `gorm:"type:varchar(32);not null;index" json:"category"`
	Campus     string       `gorm:"type:varchar(32);index" json:"campus"`     // 校区
	Place      string       `gorm:"type:varchar(64)" json:"place"`            // 具体地点
	HappenedAt time.Time    `json:"happened_at"`                              // 丢失/捡到时间
	Description string      `gorm:"type:varchar(500)" json:"description"`     // 描述（选填）
	// ★ 关键设计：contact 加了 json:"-"，任何返回 Item 的接口都**不可能**泄露联系方式
	//   想拿到联系方式只能走 GET /api/items/:id/contact（需登录）—— 从结构上保证"登录可见"
	Contact  string     `gorm:"type:varchar(100);not null" json:"-"`
	ImageURL string     `gorm:"type:varchar(255)" json:"image_url"` // 图片（P1 预留，现在不用）
	Status   ItemStatus `gorm:"type:varchar(16);not null;index;default:searching" json:"status"`
	UserID   uint       `gorm:"index;not null" json:"user_id"` // 发布者 ID
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ItemDetailResponse 详情接口的返回：帖子本身 + 发布者信息
// 内嵌 Item 后，序列化成 JSON 时 Item 的字段会"平铺"进来（不是嵌套一层）
// PRD 5.2 要求详情页显示"发布者昵称 + 学号（若填了）"，所以这里补两个字段
type ItemDetailResponse struct {
	Item
	PublisherNickname  string `json:"publisher_nickname"`
	PublisherStudentID string `json:"publisher_student_id"`
}

// ItemListQuery 列表查询的条件集合（controller 从 URL 参数收集好，往下传给 service/dao）
type ItemListQuery struct {
	Keyword  string // 关键词：模糊匹配物品名称和描述
	Type     string
	Category string
	Campus   string
	Place    string
	Status   string // 空字符串 = 不限状态
	UserID   uint   // 非 0 = 只看这个用户发的（"我的发布"用）
	Page     int
	PageSize int
}

// CreateItemRequest 发布请求体
type CreateItemRequest struct {
	Type        ItemType `json:"type" binding:"required,oneof=lost found"`
	Title       string   `json:"title" binding:"required,max=64"`
	Category    string   `json:"category" binding:"required,oneof=card electronics books clothing daily other"`
	Campus      string   `json:"campus" binding:"max=32"`
	Place       string   `json:"place" binding:"max=64"`
	HappenedAt  string   `json:"happened_at" binding:"required"` // 用字符串收，service 里再解析成时间（前端格式五花八门）
	Description string   `json:"description" binding:"max=500"`
	Contact     string   `json:"contact" binding:"required,max=100"`
}

// UpdateItemRequest 编辑请求体
// 全部选填：传了就改，没传（空字符串）就不动
// 注意：type（失物/招领）故意不给改 —— 一条失物帖不该变成招领帖
type UpdateItemRequest struct {
	Title       string `json:"title" binding:"omitempty,max=64"`
	Category    string `json:"category" binding:"omitempty,oneof=card electronics books clothing daily other"`
	Campus      string `json:"campus" binding:"omitempty,max=32"`
	Place       string `json:"place" binding:"omitempty,max=64"`
	HappenedAt  string `json:"happened_at"`
	Description string `json:"description" binding:"omitempty,max=500"`
	Contact     string `json:"contact" binding:"omitempty,max=100"`
}

// UpdateStatusRequest 改状态请求体
type UpdateStatusRequest struct {
	Status ItemStatus `json:"status" binding:"required,oneof=searching resolved closed"`
}
