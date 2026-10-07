package vo

import (
	"lost-found/backend/internal/model"
	"time"
)

// OperationLogVO 管理员操作日志的展示数据，包含状态变更快照。
type OperationLogVO struct {
	ID             string               `json:"id"`
	Operator       UserSummaryVO        `json:"operator"`
	Action         string               `json:"action"`
	TargetUserID   *string              `json:"target_user_id"`
	TargetPostID   *string              `json:"target_post_id"`
	TargetReportID *string              `json:"target_report_id"`
	Reason         *string              `json:"reason"`
	StateBefore    model.OperationState `json:"state_before"`
	StateAfter     model.OperationState `json:"state_after"`
	CreatedAt      time.Time            `json:"created_at"`
}
