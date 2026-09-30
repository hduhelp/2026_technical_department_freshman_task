// Package valid 集中收口「枚举白名单」与「指针工具」。
//
// 为什么单独成包：枚举值散落在 handler / service 里各写一份切片，
// 迟早会出现「创建时允许某值、筛选时不允许」这类不一致。
// 这里定义一次，全项目引用同一份真相。
package valid

// 帖子类型枚举。lost=丢失寻找 | found=捡到招领。
const (
	TypeLost  = "lost"
	TypeFound = "found"
)

// 帖子状态枚举。open=寻找中 | matched=已找到 | closed=已结束（终态）。
const (
	StatusOpen    = "open"
	StatusMatched = "matched"
	StatusClosed  = "closed"
)

// 帖子分类枚举。
const (
	CategoryCard    = "card"
	CategoryDigital = "digital"
	CategoryBook    = "book"
	CategoryKey     = "key"
	CategoryClothes = "clothes"
	CategoryOther   = "other"
)

// 三个枚举白名单，与 SPEC 第 6.1 节 DDL 的列注释一一对应。
var (
	// ValidTypes 是合法的帖子类型集合。
	ValidTypes = []string{TypeLost, TypeFound}
	// ValidCategories 是合法的帖子分类集合。
	ValidCategories = []string{CategoryCard, CategoryDigital, CategoryBook, CategoryKey, CategoryClothes, CategoryOther}
	// ValidStatuses 是合法的帖子状态集合。
	ValidStatuses = []string{StatusOpen, StatusMatched, StatusClosed}
)

// Contains 判断 v 是否在 list 中（大小写敏感，枚举值均为小写固定字面量）。
func Contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

// StringPtr 返回字符串的指针。
//
// 用途：DTO 中「不可见时应为 null 而不可见 vs 可见但内容为空串」需要区分，
// 例如 Claim 的 voucher_code；也用于可选字段的显式置空。
func StringPtr(s string) *string {
	return &s
}

// BoolPtr 返回布尔值的指针。
func BoolPtr(b bool) *bool {
	return &b
}

// Int64Ptr 返回 int64 的指针。
func Int64Ptr(i int64) *int64 {
	return &i
}

// OrDefault 在 v 为空串时返回 fallback，否则返回 v 本身。
//
// 用于「可选字段缺省值」场景，如 category 缺省为 other。
func OrDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
