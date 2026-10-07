package vo

import (
	"lost-found/backend/internal/model"
	"time"
)

// CurrentPostStateVO 审核和举报详情中的帖子当前状态及作者状态摘要。
type CurrentPostStateVO struct {
	ID               string `json:"id"`
	Revision         uint32 `json:"revision"`
	StateVersion     uint32 `json:"state_version"`
	ReviewStatus     string `json:"review_status"`
	ResolutionStatus string `json:"resolution_status"`
	AuthorID         string `json:"author_id"`
	AuthorStatus     string `json:"author_status"`
	AuthorIsVerified bool   `json:"author_is_verified"`
}

// ReviewRecordVO 审核记录列表项，包含提交快照、审核决定和处理时间。
type ReviewRecordVO struct {
	ID              string            `json:"id"`
	PostID          *string           `json:"post_id"`
	Revision        uint32            `json:"revision"`
	Decision        string            `json:"decision"`
	ContentSnapshot model.PostContent `json:"content_snapshot"`
	Reviewer        *UserSummaryVO    `json:"reviewer"`
	Reason          *string           `json:"reason"`
	SubmittedAt     time.Time         `json:"submitted_at"`
	ProcessedAt     *time.Time        `json:"processed_at"`
}

// ReviewDetailVO 后台审核详情，包含快照、当前帖子状态及可操作信息。
type ReviewDetailVO struct {
	ReviewRecordVO
	CurrentPost CurrentPostStateVO `json:"current_post"`
	IsCurrent   bool               `json:"is_current"`
	CanDecide   bool               `json:"can_decide"`
	ETag        string             `json:"etag"`
}

// ReviewDecisionResponseVO 审核决定提交成功后的审核及帖子状态响应。
type ReviewDecisionResponseVO struct {
	ID               string     `json:"id"`
	PostID           *string    `json:"post_id"`
	Revision         uint32     `json:"revision"`
	Decision         string     `json:"decision"`
	Reason           *string    `json:"reason"`
	ProcessedAt      *time.Time `json:"processed_at"`
	PostReviewStatus string     `json:"post_review_status"`
	PostStateVersion uint32     `json:"post_state_version"`
	PostETag         string     `json:"post_etag"`
}
