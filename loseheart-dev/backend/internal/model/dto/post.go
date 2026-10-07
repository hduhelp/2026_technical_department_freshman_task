package dto

// ContactMethodDTO 提交帖子时的一项联系方式，包含类型和值。
type ContactMethodDTO struct {
	Type  string `json:"type" binding:"required,oneof=wechat phone qq other"`
	Value string `json:"value" binding:"required,max=200"`
}

// PostContentDTO 创建和编辑帖子共用的内容参数；时间组合、非空白文本和图片归属由业务层校验。
type PostContentDTO struct {
	PostType       string             `json:"post_type" binding:"required,oneof=lost found"`
	ItemName       string             `json:"item_name" binding:"required,max=50"`
	Campus         string             `json:"campus" binding:"required,oneof=xiasha shaoxing wenyi"`
	Location       string             `json:"location" binding:"required,max=100"`
	EventDate      string             `json:"event_date" binding:"required,datetime=2006-01-02"`
	TimePrecision  string             `json:"time_precision" binding:"required,oneof=date exact range"`
	EventTimeStart *string            `json:"event_time_start" binding:"omitempty,datetime=15:04"`
	EventTimeEnd   *string            `json:"event_time_end" binding:"omitempty,datetime=15:04"`
	Description    string             `json:"description" binding:"required,max=300"`
	Images         []string           `json:"images" binding:"required,max=6,unique,dive,required,max=512"`
	ContactMethods []ContactMethodDTO `json:"contact_methods" binding:"required,min=1,dive"`
}

// CreatePostDTO 创建寻物或招领帖的请求体。
type CreatePostDTO struct {
	PostContentDTO
}

// UpdatePostDTO 编辑并重新提交帖子内容的请求体。
type UpdatePostDTO struct {
	PostContentDTO
}

// PostQueryDTO 首页帖子列表的分页、校区、类型及时间等筛选参数。
type PostQueryDTO struct {
	PageQueryDTO
	PostType         string `form:"post_type" binding:"omitempty,oneof=lost found"`
	Campus           string `form:"campus" binding:"omitempty,oneof=xiasha shaoxing wenyi"`
	Keyword          string `form:"keyword" binding:"omitempty,max=100"`
	EventDateFrom    string `form:"event_date_from" binding:"omitempty,datetime=2006-01-02"`
	EventDateTo      string `form:"event_date_to" binding:"omitempty,datetime=2006-01-02"`
	ResolutionStatus string `form:"resolution_status" binding:"omitempty,oneof=active completed all"`
}

// MyPostQueryDTO 当前用户帖子列表的分页和状态筛选参数。
type MyPostQueryDTO struct {
	PageQueryDTO
	ReviewStatus     string `form:"review_status" binding:"omitempty,oneof=pending approved returned rejected removed"`
	ResolutionStatus string `form:"resolution_status" binding:"omitempty,oneof=active completed withdrawn"`
}

// PostResolutionDTO 更新帖子完成、撤回等解决状态的请求体。
type PostResolutionDTO struct {
	ResolutionStatus string `json:"resolution_status" binding:"required,oneof=active completed withdrawn"`
}

// AdminPostQueryDTO 后台帖子列表的分页、作者及审核状态等筛选参数。
type AdminPostQueryDTO struct {
	PageQueryDTO
	PostType         string `form:"post_type" binding:"omitempty,oneof=lost found"`
	Campus           string `form:"campus" binding:"omitempty,oneof=xiasha shaoxing wenyi"`
	Keyword          string `form:"keyword" binding:"omitempty,max=100"`
	ReviewStatus     string `form:"review_status" binding:"omitempty,oneof=pending approved returned rejected removed"`
	ResolutionStatus string `form:"resolution_status" binding:"omitempty,oneof=active completed withdrawn"`
	AuthorID         string `form:"author_id" binding:"omitempty,numeric,max=20"`
}

// PostModerationDTO 管理员下架帖子的请求体，包含目标状态和处置原因。
type PostModerationDTO struct {
	ReviewStatus string `json:"review_status" binding:"required,eq=removed"`
	Reason       string `json:"reason" binding:"required,max=500"`
}
