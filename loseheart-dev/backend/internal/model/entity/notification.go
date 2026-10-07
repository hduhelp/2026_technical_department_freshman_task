package entity

import (
	"time"
)

// Notification 对应 notifications；内容不包含凭证。
type Notification struct {
	ID        uint64     `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	UserID    uint64     `gorm:"column:user_id" json:"-"`
	Type      string     `gorm:"column:type" json:"-"`
	Title     string     `gorm:"column:title" json:"-"`
	Content   string     `gorm:"column:content" json:"-"`
	PostID    *uint64    `gorm:"column:post_id" json:"-"`
	ReviewID  *uint64    `gorm:"column:review_id" json:"-"`
	ReportID  *uint64    `gorm:"column:report_id" json:"-"`
	ReadAt    *time.Time `gorm:"column:read_at" json:"-"`
	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"-"`
}
