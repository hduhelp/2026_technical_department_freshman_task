package vo

import (
	"lost-found/backend/internal/model"
	"time"
)

// PostListItemVO 首页帖子列表的单条展示数据，不包含内部图片对象标识。
type PostListItemVO struct {
	ID               string       `json:"id"`
	PostType         string       `json:"post_type"`
	ItemName         string       `json:"item_name"`
	Campus           string       `json:"campus"`
	Location         string       `json:"location"`
	EventDate        string       `json:"event_date"`
	TimePrecision    string       `json:"time_precision"`
	EventTimeStart   *string      `json:"event_time_start"`
	EventTimeEnd     *string      `json:"event_time_end"`
	CoverURL         *string      `json:"cover_url"`
	ResolutionStatus string       `json:"resolution_status"`
	FirstPublishedAt *time.Time   `json:"first_published_at"`
	Author           PostAuthorVO `json:"author"`
	ETag             string       `json:"etag"`
}

// PostDetailVO 普通用户查看的帖子详情，不包含内部 Object Key 或审核说明。
type PostDetailVO struct {
	PostListItemVO
	Description    string                `json:"description"`
	ImageURLs      []string              `json:"image_urls"`
	ContactMethods []model.ContactMethod `json:"contact_methods"`
	ReviewStatus   string                `json:"review_status"`
	Revision       uint32                `json:"revision"`
	StateVersion   uint32                `json:"state_version"`
	SubmittedAt    time.Time             `json:"submitted_at"`
	CompletedAt    *time.Time            `json:"completed_at"`
	WithdrawnAt    *time.Time            `json:"withdrawn_at"`
	CanEdit        bool                  `json:"can_edit"`
	CanReport      bool                  `json:"can_report"`
	CanComplete    bool                  `json:"can_complete"`
}

// OwnerPostDetailVO 作者及管理员专用帖子详情，包含图片对象标识及审核说明；空审核原因输出 null。
type OwnerPostDetailVO struct {
	PostDetailVO
	Images       []string   `json:"images"`
	ReviewReason *string    `json:"review_reason"`
	ReviewedAt   *time.Time `json:"reviewed_at"`
}

// MyPostListItemVO 我的帖子列表单条数据，包含审核状态和原因。
type MyPostListItemVO struct {
	PostListItemVO
	ReviewStatus string    `json:"review_status"`
	Revision     uint32    `json:"revision"`
	StateVersion uint32    `json:"state_version"`
	ReviewReason *string   `json:"review_reason"`
	SubmittedAt  time.Time `json:"submitted_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// AdminPostListItemVO 后台帖子列表单条数据，包含作者 ID 与内容、状态版本。
type AdminPostListItemVO struct {
	PostListItemVO
	AuthorID     string    `json:"author_id"`
	ReviewStatus string    `json:"review_status"`
	Revision     uint32    `json:"revision"`
	StateVersion uint32    `json:"state_version"`
	SubmittedAt  time.Time `json:"submitted_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// PostStateResponseVO 帖子状态修改后的状态、版本和 ETag 响应。
type PostStateResponseVO struct {
	ID               string `json:"id"`
	ReviewStatus     string `json:"review_status"`
	ResolutionStatus string `json:"resolution_status"`
	Revision         uint32 `json:"revision"`
	StateVersion     uint32 `json:"state_version"`
	ETag             string `json:"etag"`
}

// PostResolutionResponseVO 帖子解决状态修改后的响应，包含完成或撤回时间。
type PostResolutionResponseVO struct {
	PostStateResponseVO
	CompletedAt *time.Time `json:"completed_at"`
	WithdrawnAt *time.Time `json:"withdrawn_at"`
}
