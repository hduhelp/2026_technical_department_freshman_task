package vo

import (
	"time"
)

// NotificationVO 当前用户的单条通知展示数据。
type NotificationVO struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Content   string     `json:"content"`
	PostID    *string    `json:"post_id"`
	ReviewID  *string    `json:"review_id"`
	ReportID  *string    `json:"report_id"`
	ReadAt    *time.Time `json:"read_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// UnreadCountResponseVO 当前用户未读通知数量的响应数据。
type UnreadCountResponseVO struct {
	Count uint64 `json:"count"`
}

// NotificationReadStateResponseVO 通知已读状态修改后的响应数据。
type NotificationReadStateResponseVO struct {
	ID     string    `json:"id"`
	ReadAt time.Time `json:"read_at"`
}
