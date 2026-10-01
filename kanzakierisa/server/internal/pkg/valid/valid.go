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

// 认领状态枚举（SPEC 6.1 claims.status 的列注释）。
//
//	pending  待审核
//	approved 已通过（此时生成凭证码，帖子被联动置 matched）
//	rejected 已拒绝（可带 reject_reason）
//	redeemed 已交接（帖子被联动置 closed）
const (
	ClaimStatusPending  = "pending"
	ClaimStatusApproved = "approved"
	ClaimStatusRejected = "rejected"
	ClaimStatusRedeemed = "redeemed"
)

// 审核动作枚举（PATCH /api/claims/:id 的 action 字段）。
const (
	ClaimActionApprove = "approve"
	ClaimActionReject  = "reject"
)

// 三个枚举白名单，与 SPEC 第 6.1 节 DDL 的列注释一一对应。
var (
	// ValidTypes 是合法的帖子类型集合。
	ValidTypes = []string{TypeLost, TypeFound}
	// ValidCategories 是合法的帖子分类集合。
	ValidCategories = []string{CategoryCard, CategoryDigital, CategoryBook, CategoryKey, CategoryClothes, CategoryOther}
	// ValidStatuses 是合法的帖子状态集合。
	ValidStatuses = []string{StatusOpen, StatusMatched, StatusClosed}
	// ValidClaimStatuses 是合法的认领状态集合。
	ValidClaimStatuses = []string{ClaimStatusPending, ClaimStatusApproved, ClaimStatusRejected, ClaimStatusRedeemed}
	// ValidClaimActions 是合法的审核动作集合。
	ValidClaimActions = []string{ClaimActionApprove, ClaimActionReject}
)

// ClaimStatusesActive 是「认领关系已成立」的认领状态集合。
//
// 单独抽出一份的用途是让两条业务规则共用同一个定义，避免两处各写
// `IN ('approved','redeemed')`：一旦将来新增一个「已成立」的状态，
// 漏改任何一处的后果都很难自查 ——
//
//  1. SPEC 7.2 联系方式可见性的 hasApprovedClaim 判定；
//  2. SPEC 7.3 规则 5「一个帖子最多一条通过记录」的应用层预检。
//
// 数据库侧对应的等价物是 claims.approved_flag 生成列，
// 两侧的取值集合必须始终一致（见 sql/schema.sql）。
var ClaimStatusesActive = []string{ClaimStatusApproved, ClaimStatusRedeemed}

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
