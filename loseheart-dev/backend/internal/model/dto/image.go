package dto

import (
	"mime/multipart"
)

// ImageUploadDTO 图片上传的表单参数；文件真实格式和大小由上传服务检查。
type ImageUploadDTO struct {
	File *multipart.FileHeader `form:"file" binding:"required"`
}

// ImagePreviewPathDTO 当前用户预览已上传图片的文件名路径参数。
type ImagePreviewPathDTO struct {
	Filename string `uri:"filename" binding:"required"`
}

// PostImagePathDTO 读取帖子图片的帖子 ID 与图片索引路径参数。
type PostImagePathDTO struct {
	ID    string `uri:"id" binding:"required,numeric,max=20"`
	Index *uint  `uri:"index" binding:"required,lte=5"`
}

// PostImageQueryDTO 读取帖子图片时用于校验内容版本的查询参数。
type PostImageQueryDTO struct {
	Revision uint32 `form:"revision" binding:"required,gte=1"`
}

// ReviewImagePathDTO 读取审核快照图片的帖子、审核记录及图片索引路径参数。
type ReviewImagePathDTO struct {
	ID       string `uri:"id" binding:"required,numeric,max=20"`
	ReviewID string `uri:"review_id" binding:"required,numeric,max=20"`
	Index    *uint  `uri:"index" binding:"required,lte=5"`
}
