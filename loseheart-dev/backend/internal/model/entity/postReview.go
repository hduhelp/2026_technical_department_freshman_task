package entity

import (
	"lost-found/backend/internal/model"
	"time"
)

// PostReview 对应 post_reviews；提交快照不可变。
type PostReview struct {
	ID              uint64            `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	PostID          uint64            `gorm:"column:post_id" json:"-"`
	Revision        uint32            `gorm:"column:revision" json:"-"`
	Decision        string            `gorm:"column:decision;default:pending" json:"-"`
	ContentSnapshot model.PostContent `gorm:"column:content_snapshot;serializer:json;type:json" json:"-"`
	ReviewerID      *uint64           `gorm:"column:reviewer_id" json:"-"`
	Reason          *string           `gorm:"column:reason" json:"-"`
	SubmittedAt     time.Time         `gorm:"column:submitted_at;autoCreateTime" json:"-"`
	ProcessedAt     *time.Time        `gorm:"column:processed_at" json:"-"`
}
