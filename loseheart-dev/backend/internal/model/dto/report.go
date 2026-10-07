package dto

// CreateReportDTO 用户举报帖子的请求体，包含举报类型和说明。
type CreateReportDTO struct {
	PostRevision uint32  `json:"post_revision" binding:"required,gte=1"`
	ReasonType   string  `json:"reason_type" binding:"required,oneof=false_information inappropriate privacy harassment other"`
	Details      *string `json:"details" binding:"omitempty,max=500"`
}

// ReportQueryDTO 后台举报列表的分页与筛选参数。
type ReportQueryDTO struct {
	PageQueryDTO
	Status string `form:"status" binding:"omitempty,oneof=pending handled dismissed"`
	PostID string `form:"post_id" binding:"omitempty,numeric,max=20"`
}

// ReportDecisionDTO 管理员处理举报的请求体；状态、动作和版本组合由业务层校验。
type ReportDecisionDTO struct {
	Status                   string  `json:"status" binding:"required,oneof=handled dismissed"`
	ResultAction             string  `json:"result_action" binding:"required,oneof=none remove_post disable_user"`
	HandlingReason           string  `json:"handling_reason" binding:"required,max=500"`
	ExpectedPostStateVersion *uint32 `json:"expected_post_state_version" binding:"omitempty,gte=1"`
}
