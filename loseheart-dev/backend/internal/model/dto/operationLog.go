package dto

// OperationLogQueryDTO 后台操作日志的分页与筛选参数；时间范围由业务层按 RFC3339 解析比较。
type OperationLogQueryDTO struct {
	PageQueryDTO
	OperatorID   string `form:"operator_id" binding:"omitempty,numeric,max=20"`
	Action       string `form:"action" binding:"omitempty,oneof=approve_post return_post reject_post remove_post handle_report dismiss_report disable_user reset_password"`
	TargetPostID string `form:"target_post_id" binding:"omitempty,numeric,max=20"`
	TargetUserID string `form:"target_user_id" binding:"omitempty,numeric,max=20"`
	CreatedFrom  string `form:"created_from" binding:"omitempty,datetime=2006-01-02T15:04:05Z07:00"`
	CreatedTo    string `form:"created_to" binding:"omitempty,datetime=2006-01-02T15:04:05Z07:00"`
}
