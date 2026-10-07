package dto

// PageQueryDTO 列表查询的分页参数；缺失时由业务层填默认 1/20。
type PageQueryDTO struct {
	Page     *int `form:"page" binding:"omitempty,gte=1"`
	PageSize *int `form:"page_size" binding:"omitempty,gte=1,lte=50"`
}

// IDPathDTO 通用资源 ID 路径参数；业务层严格解析正整数及 uint64 上限。
type IDPathDTO struct {
	ID string `uri:"id" binding:"required,numeric,max=20"`
}

// PostIDPathDTO 帖子 ID 路径参数，用于定位目标帖子。
type PostIDPathDTO struct {
	ID string `uri:"id" binding:"required,numeric,max=20"`
}

// IfMatchDTO 修改请求的 If-Match 头，用于校验资源版本和并发冲突。
type IfMatchDTO struct {
	IfMatch string `header:"If-Match" binding:"required"`
}

// CreatePostHeaderDTO 创建帖子的幂等请求头，避免重复提交生成多条帖子。
type CreatePostHeaderDTO struct {
	IdempotencyKey string `header:"Idempotency-Key" binding:"required,uuid"`
}
