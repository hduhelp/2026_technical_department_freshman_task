package dto

// NotificationQueryDTO 当前用户通知列表的分页与筛选参数。
type NotificationQueryDTO struct {
	PageQueryDTO
	Read string `form:"read" binding:"omitempty,oneof=all true false"`
}

// NotificationReadStateDTO 更新通知已读状态的请求体；指针区分缺失与 false，首版仅允许 true。
type NotificationReadStateDTO struct {
	Read *bool `json:"read" binding:"required,eq=true"`
}
