package model

// ContactMethod 帖子 JSON 中的联系方式，不对应独立表。
type ContactMethod struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// PostContent 审核快照中的完整内容；日期 YYYY-MM-DD，时间 HH:mm。
type PostContent struct {
	PostType       string          `json:"post_type"`
	ItemName       string          `json:"item_name"`
	Campus         string          `json:"campus"`
	Location       string          `json:"location"`
	EventDate      string          `json:"event_date"`
	TimePrecision  string          `json:"time_precision"`
	EventTimeStart *string         `json:"event_time_start"`
	EventTimeEnd   *string         `json:"event_time_end"`
	Description    string          `json:"description"`
	Images         []string        `json:"images"`
	ContactMethods []ContactMethod `json:"contact_methods"`
}

// OperationState 管理操作的状态白名单；不接收密码、令牌或联系方式。
type OperationState struct {
	ReviewStatus       *string `json:"review_status,omitempty"`
	ResolutionStatus   *string `json:"resolution_status,omitempty"`
	Revision           *uint32 `json:"revision,omitempty"`
	StateVersion       *uint32 `json:"state_version,omitempty"`
	Status             *string `json:"status,omitempty"`
	Decision           *string `json:"decision,omitempty"`
	ResultAction       *string `json:"result_action,omitempty"`
	MustChangePassword *bool   `json:"must_change_password,omitempty"`
	TokenVersion       *uint64 `json:"token_version,omitempty"`
}
