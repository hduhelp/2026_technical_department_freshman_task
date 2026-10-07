package vo

import (
	"lost-found/backend/internal/model"
	"time"
)

// CreateReportResponseVO 举报创建成功后的记录 ID、内容版本和状态。
type CreateReportResponseVO struct {
	ID           string    `json:"id"`
	PostID       *string   `json:"post_id"`
	PostRevision uint32    `json:"post_revision"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

// ReportRecordVO 后台举报列表项，包含举报人与处理结果。
type ReportRecordVO struct {
	CreateReportResponseVO
	Reporter       UserSummaryVO  `json:"reporter"`
	ReasonType     string         `json:"reason_type"`
	Details        string         `json:"details"`
	ResultAction   *string        `json:"result_action"`
	Handler        *UserSummaryVO `json:"handler"`
	HandlingReason *string        `json:"handling_reason"`
	HandledAt      *time.Time     `json:"handled_at"`
}

// ReportDetailVO 后台举报详情，包含被举报内容快照及当前帖子状态。
type ReportDetailVO struct {
	ReportRecordVO
	ContentSnapshot model.PostContent  `json:"content_snapshot"`
	CurrentPost     CurrentPostStateVO `json:"current_post"`
	CanDecide       bool               `json:"can_decide"`
	ETag            string             `json:"etag"`
}

// ReportDecisionResponseVO 举报处理成功后的状态、处理原因和版本响应。
type ReportDecisionResponseVO struct {
	ID             string     `json:"id"`
	Status         string     `json:"status"`
	ResultAction   *string    `json:"result_action"`
	HandlingReason *string    `json:"handling_reason"`
	HandledAt      *time.Time `json:"handled_at"`
	ETag           string     `json:"etag"`
}
