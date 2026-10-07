package dto

// ReviewQueryDTO 后台审核队列的分页与筛选参数。
type ReviewQueryDTO struct {
	PageQueryDTO
	Decision string `form:"decision" binding:"omitempty,oneof=pending approved returned rejected superseded"`
	PostID   string `form:"post_id" binding:"omitempty,numeric,max=20"`
}

// ReviewDecisionDTO 管理员审核决定的请求体；退回或拒绝时由业务层检查原因必填。
type ReviewDecisionDTO struct {
	Decision string  `json:"decision" binding:"required,oneof=approved returned rejected"`
	Reason   *string `json:"reason" binding:"omitempty,max=500"`
}
