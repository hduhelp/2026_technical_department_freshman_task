// Package pagination 统一分页参数的规范化。
//
// 规则来自 SPEC 8.5：
//   - page 默认 1，且最小为 1
//   - pageSize 默认 10，合法范围 1–50
//   - 越界**夹取**（clamp）而不是报错 —— 前端传 pageSize=999 时按 50 处理，
//     避免分页参数的小失误直接变成 400 把用户挡在门外
//
// Offset 由本包集中计算，防止各 store 各写一套 (page-1)*pageSize 造成口径不一致。
package pagination

const (
	// DefaultPage 是缺省页码。
	DefaultPage = 1
	// DefaultPageSize 是缺省每页条数。
	DefaultPageSize = 10
	// MinPageSize 是每页条数的下界。
	MinPageSize = 1
	// MaxPageSize 是每页条数的上界（防止一次拉全表）。
	MaxPageSize = 50
)

// Params 是规范化后的分页参数。
type Params struct {
	Page     int // 页码，≥ 1
	PageSize int // 每页条数，[MinPageSize, MaxPageSize]
}

// Normalize 把原始请求参数整理成合法分页参数。
//
// page < 1 时取 1；pageSize 不在 [1, 50] 内时夹取到边界。
func Normalize(page, pageSize int) Params {
	if page < DefaultPage {
		page = DefaultPage
	}
	switch {
	case pageSize < MinPageSize:
		pageSize = DefaultPageSize
	case pageSize > MaxPageSize:
		pageSize = MaxPageSize
	}
	return Params{Page: page, PageSize: pageSize}
}

// Offset 返回 SQL LIMIT ? OFFSET ? 所需的偏移量。
func (p Params) Offset() int {
	return (p.Page - 1) * p.PageSize
}

// Limit 返回 SQL LIMIT 所需的条数。
func (p Params) Limit() int {
	return p.PageSize
}
