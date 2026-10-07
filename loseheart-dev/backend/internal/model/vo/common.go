package vo

// ErrorResponseVO 失败响应的统一外层结构，包含业务错误码、消息和请求追踪 ID。
type ErrorResponseVO struct {
	Code      string         `json:"code"`
	Msg       string         `json:"msg"`
	Data      any            `json:"data"`
	RequestID string         `json:"request_id"`
	Errors    []FieldErrorVO `json:"errors,omitempty"`
}

// FieldErrorVO 失败响应中单个请求字段的校验错误。
type FieldErrorVO struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// PageResultVO 列表接口的通用分页响应；空页 Records 必须初始化为空数组。
type PageResultVO[T any] struct {
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
	Records  []T   `json:"records"`
}

// UserSummaryVO 审核、举报等响应中使用的用户 ID 和昵称摘要。
type UserSummaryVO struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
}

// PostAuthorVO 帖子响应中的作者公开信息。
type PostAuthorVO struct {
	ID        string  `json:"id"`
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
}
