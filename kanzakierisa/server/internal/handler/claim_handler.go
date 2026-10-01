package handler

import (
	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/pagination"
	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
)

// ClaimHandler 处理认领相关的 HTTP 编解码。
//
// 与 PostHandler 一样的铁律：本层只做「取参数 → 调 service → 写响应」。
// 「只有 found 帖能被认领」「非帖主不能审核」这类判断全在 service，
// handler 里不复制任何一条业务规则 —— 复制出来的第二份规则迟早与第一份分叉。
type ClaimHandler struct {
	claims *service.ClaimService
}

// NewClaimHandler 创建认领 handler。
func NewClaimHandler(claims *service.ClaimService) *ClaimHandler {
	return &ClaimHandler{claims: claims}
}

// Apply 处理 POST /api/posts/:id/claims（鉴权：强制）。
//
// 帖子 id 来自路径，申请人固定取当前登录用户 —— ApplyClaimReq 里
// 没有 claimant_id 字段，请求体带了也会在解码阶段被丢弃。
func (h *ClaimHandler) Apply(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	// proof 用 binding:"required" 只保证「非空」；真正的长度校验
	// （10–500 rune）在 service 里，因为 tag 的 max 按字节算，
	// 中文会被误判超长。
	var req model.ApplyClaimReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请填写物品特征证明"))
		return
	}

	dto, err := h.claims.Apply(c.Request.Context(), postID, u.ID, req.Proof)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}

// ListByPost 处理 GET /api/posts/:id/claims（鉴权：强制，**仅帖主**）。
//
// 非帖主（含 admin）由 service 返回 1003 —— 这里不做「先取当前用户再比对」
// 的判断，否则权限规则会出现两份。权限口径以 SPEC 8.4 为准（仅帖主），
// 与 07 §5 括号里的「或 admin」不一致，取舍理由见 ClaimService.ListByPost。
func (h *ClaimHandler) ListByPost(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	p := pagination.Parse(c.Query("page"), c.Query("pageSize"))

	list, total, err := h.claims.ListByPost(c.Request.Context(), postID, u, p.PageSize, p.Offset)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, p.Result(list, total))
}

// ListMine 处理 GET /api/users/me/claims（鉴权：强制）。
//
// claimant_id 固定取当前登录用户，**不来自查询参数** ——
// 否则改一下 ?user_id= 就能读到别人写下的认领证明。
func (h *ClaimHandler) ListMine(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	p := pagination.Parse(c.Query("page"), c.Query("pageSize"))

	list, total, err := h.claims.ListMine(c.Request.Context(), u.ID, p.PageSize, p.Offset)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, p.Result(list, total))
}

// Review 处理 PATCH /api/claims/:id（鉴权：强制，仅帖主或 admin）。
//
// Body: {"action": "approve"|"reject", "reject_reason": "..."}
func (h *ClaimHandler) Review(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	claimID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	var req model.ReviewClaimReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	dto, err := h.claims.Review(c.Request.Context(), claimID, u, req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}

// Redeem 处理 POST /api/claims/:id/redeem（鉴权：强制，仅帖主）。
//
// Body: {"voucher_code": "K7M2QX"}
//
// 凭证码的比对在 service 里用恒定时间比较完成，这里只负责取值 ——
// 尤其**不要**在 handler 里做「先 trim/uppercase 再比」的规范化，
// 那会把比较逻辑拆成两半，将来只改一处就会让某个分支退化成普通 ==。
func (h *ClaimHandler) Redeem(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	claimID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	var req model.RedeemClaimReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请填写凭证码"))
		return
	}

	dto, err := h.claims.Redeem(c.Request.Context(), claimID, u, req.VoucherCode)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}
