package entity

import (
	"lost-found/backend/internal/model"
	"time"
)

// AdminOperationLog 对应 admin_operation_logs；状态 JSON 仅记录白名单字段。
type AdminOperationLog struct {
	ID             uint64               `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	OperatorID     uint64               `gorm:"column:operator_id" json:"-"`
	Action         string               `gorm:"column:action" json:"-"`
	TargetUserID   *uint64              `gorm:"column:target_user_id" json:"-"`
	TargetPostID   *uint64              `gorm:"column:target_post_id" json:"-"`
	TargetReportID *uint64              `gorm:"column:target_report_id" json:"-"`
	Reason         string               `gorm:"column:reason" json:"-"`
	StateBefore    model.OperationState `gorm:"column:state_before;serializer:json;type:json" json:"-"`
	StateAfter     model.OperationState `gorm:"column:state_after;serializer:json;type:json" json:"-"`
	CreatedAt      time.Time            `gorm:"column:created_at;autoCreateTime" json:"-"`
}
