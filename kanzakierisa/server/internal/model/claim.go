package model

import (
	"time"
)

// Claim 对应 claims 表的一行，并额外承载联表带出的申请人昵称与帖子摘要。
//
// 与 Post 一样把 JOIN 结果拍平成字段（sqlx 的 StructScan 只认列名到字段的
// 一一映射），组装成 SPEC 8.3 的嵌套 JSON 由 ToClaimDTO 负责。
//
// ⚠️ 刻意**没有** approved_flag 字段：那一列是纯粹给唯一索引用的生成列
// （见 sql/schema.sql 的说明），应用层既不读也不写，扫进来只会是噪音。
type Claim struct {
	ID           int64      `db:"id"`
	PostID       int64      `db:"post_id"`
	ClaimantID   int64      `db:"claimant_id"`
	Proof        string     `db:"proof"`
	Status       string     `db:"status"`
	VoucherCode  *string    `db:"voucher_code"`
	RejectReason string     `db:"reject_reason"`
	ReviewedAt   *time.Time `db:"reviewed_at"`
	RedeemedAt   *time.Time `db:"redeemed_at"`
	CreatedAt    time.Time  `db:"created_at"`

	// 以下为 JOIN users 带出的申请人信息。
	ClaimantNickname string `db:"claimant_nickname"`

	// 以下为 JOIN posts 带出的帖子摘要（「我的认领」列表要用）。
	PostTitle  string `db:"post_title"`
	PostType   string `db:"post_type"`
	PostStatus string `db:"post_status"`
}

// ClaimantBrief 是 ClaimDTO 内的申请人摘要。
//
// 只有 id 与 nickname：认领列表可能被帖主之外的人看到吗？不会（1003），
// 但仍刻意不给 username / contact —— 联系方式是否可见由 SPEC 7.2 的规则
// 在**帖子维度**决定，认领列表不是绕过它的第二条路径。
type ClaimantBrief struct {
	ID       int64  `json:"id"`
	Nickname string `json:"nickname"`
}

// ClaimPostBrief 是 ClaimDTO 内的帖子摘要。
//
// status 是 SPEC 8.3 示例之外的字段，但 07 阶段文件明确要求
// 「GET /api/users/me/claims 联表带出 post 摘要（id/title/type/status）」，
// 用于在「我的认领」里直接标出该帖是否已结束，省掉 N 次详情请求。
type ClaimPostBrief struct {
	ID     int64  `json:"id"`
	Title  string `json:"title"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// ClaimDTO 是认领记录的对外 JSON 形状，对应 SPEC 8.3 的 Claim。
type ClaimDTO struct {
	ID           int64           `json:"id"`
	PostID       int64           `json:"post_id"`
	ClaimantID   int64           `json:"claimant_id"`
	Proof        string          `json:"proof"`
	Status       string          `json:"status"`
	VoucherCode  *string         `json:"voucher_code"`
	RejectReason string          `json:"reject_reason"`
	CreatedAt    string          `json:"created_at"`
	ReviewedAt   *string         `json:"reviewed_at"`
	RedeemedAt   *string         `json:"redeemed_at"`
	Claimant     ClaimantBrief   `json:"claimant"`
	Post         *ClaimPostBrief `json:"post"`
}

// MyClaimDTO 是**帖子详情**里挂在当前请求者名下的那条认领摘要（07 §5）。
//
// 独立于 ClaimDTO 而不是复用它的原因：这个字段是给「我自己在这张帖子上的
// 状态」用的，详情页只需要 status / proof / voucher_code / reject_reason
// 四件事来决定渲染哪个 CTA，带上 claimant 与 post 只会让响应里出现
// 一份冗余的自我引用。
type MyClaimDTO struct {
	ID           int64   `json:"id"`
	Status       string  `json:"status"`
	Proof        string  `json:"proof"`
	VoucherCode  *string `json:"voucher_code"`
	RejectReason string  `json:"reject_reason"`
	CreatedAt    string  `json:"created_at"`
	ReviewedAt   *string `json:"reviewed_at"`
}

// ToClaimDTO 把认领实体按给定视角组装成对外 DTO。
//
// showVoucher 决定 voucher_code 是否真实带出（SPEC 8.3）：
//
//	申请人本人查看 → true
//	帖主查看       → true
//	其他人         → false，且返回 **null 而不是空串**
//
// 为什么「不可见」必须序列化成 null 而非 ""：前端用
// `v-if="claim.voucher_code"` 判断是否存在，空串恰好是 falsy 也能工作，
// 但接口语义上「没有这个值」和「值是空字符串」是两件事 ——
// 后者会让调用方以为存在一个空凭证码。空串与 null 的区分在
// valid.StringPtr 的注释里也有说明。
//
// withPost 决定是否带出 post 摘要：列表接口（「我的认领」）需要它来
// 显示关联帖子标题并可点击跳转，而「某帖的全部认领」接口里
// 每条记录都指向同一个帖子，带上纯属重复。
func ToClaimDTO(c *Claim, showVoucher bool, withPost bool) *ClaimDTO {
	if c == nil {
		return nil
	}

	dto := &ClaimDTO{
		ID:           c.ID,
		PostID:       c.PostID,
		ClaimantID:   c.ClaimantID,
		Proof:        c.Proof,
		Status:       c.Status,
		VoucherCode:  nil,
		RejectReason: c.RejectReason,
		CreatedAt:    c.CreatedAt.UTC().Format(time.RFC3339),
		ReviewedAt:   formatTimePtr(c.ReviewedAt),
		RedeemedAt:   formatTimePtr(c.RedeemedAt),
		Claimant: ClaimantBrief{
			ID:       c.ClaimantID,
			Nickname: c.ClaimantNickname,
		},
	}

	if showVoucher {
		dto.VoucherCode = c.VoucherCode
	}

	if withPost {
		dto.Post = &ClaimPostBrief{
			ID:     c.PostID,
			Title:  c.PostTitle,
			Type:   c.PostType,
			Status: c.PostStatus,
		}
	}
	return dto
}

// ToClaimDTOs 批量组装，语义同 ToClaimDTO。
func ToClaimDTOs(rows []Claim, showVoucher bool, withPost bool) []*ClaimDTO {
	out := make([]*ClaimDTO, 0, len(rows))
	for i := range rows {
		out = append(out, ToClaimDTO(&rows[i], showVoucher, withPost))
	}
	return out
}

// ToMyClaimDTO 组装帖子详情里的 my_claim。
//
// 这里 voucher_code 恒定带出：调用方只会在「viewer 就是这条认领的申请人」
// 时才调用它，而申请人本人查看自己的凭证码是 SPEC 8.3 明确允许的两种情形之一。
func ToMyClaimDTO(c *Claim) *MyClaimDTO {
	if c == nil {
		return nil
	}
	return &MyClaimDTO{
		ID:           c.ID,
		Status:       c.Status,
		Proof:        c.Proof,
		VoucherCode:  c.VoucherCode,
		RejectReason: c.RejectReason,
		CreatedAt:    c.CreatedAt.UTC().Format(time.RFC3339),
		ReviewedAt:   formatTimePtr(c.ReviewedAt),
	}
}

// formatTimePtr 把可空时间格式化为可空的 RFC3339 字符串。
//
// nil → nil（JSON 里是 null），非 nil → UTC 的 RFC3339。
// 与实体里的 *time.Time 一一对应，不做「零值也算 null」的猜测 ——
// 零值时间是 0001-01-01，那是明显的数据异常，应当如实暴露而不是被吞掉。
func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// ApplyClaimReq 是 POST /api/posts/:id/claims 的请求体。
//
// proof 的长度约束（10–500 字）放在 service 层并用 rune 计：
// binding tag 的 max 是按字节算的，一个 167 字的中文证明就会被误判超长。
type ApplyClaimReq struct {
	Proof string `json:"proof" binding:"required"`
}

// ReviewClaimReq 是 PATCH /api/claims/:id 的请求体（07 §3）。
type ReviewClaimReq struct {
	Action       string `json:"action" binding:"required"`
	RejectReason string `json:"reject_reason"`
}

// RedeemClaimReq 是 POST /api/claims/:id/redeem 的请求体。
type RedeemClaimReq struct {
	VoucherCode string `json:"voucher_code" binding:"required"`
}
