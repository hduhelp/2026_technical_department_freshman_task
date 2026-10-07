package entity

import (
	"time"
)

// PostReport 对应 post_reports；关联举报时的内容版本。
type PostReport struct {
	ID             uint64     `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	ReporterID     uint64     `gorm:"column:reporter_id" json:"-"`
	PostID         uint64     `gorm:"column:post_id" json:"-"`
	PostRevision   uint32     `gorm:"column:post_revision" json:"-"`
	ReasonType     string     `gorm:"column:reason_type" json:"-"`
	Details        *string    `gorm:"column:details" json:"-"`
	Status         string     `gorm:"column:status;default:pending" json:"-"`
	ResultAction   *string    `gorm:"column:result_action" json:"-"`
	HandlerID      *uint64    `gorm:"column:handler_id" json:"-"`
	HandlingReason *string    `gorm:"column:handling_reason" json:"-"`
	HandledAt      *time.Time `gorm:"column:handled_at" json:"-"`
	CreatedAt      time.Time  `gorm:"column:created_at;autoCreateTime" json:"-"`
}
