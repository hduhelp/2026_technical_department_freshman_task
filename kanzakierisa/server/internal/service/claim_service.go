package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jmoiron/sqlx"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/valid"
	"hdu-lostfound/internal/pkg/voucher"
	"hdu-lostfound/internal/store"
)

// 认领字段的长度约束（07 §2 第 1 条）。以 **rune** 计，与帖子字段一致。
const (
	// minProofLen 是特征证明的下界。
	//
	// 为什么要卡下界：认领的本质是「用只有失主知道的特征证明东西是你的」。
	// 「是我的」「我丢的」这种 3 个字的证明既无法用于判断，也会让帖主
	// 无法做出有意义的审核决定 —— 与其事后驳回，不如在入口就要求说清楚。
	minProofLen = 10
	// maxProofLen 是上界，防止把 description 级别的长文塞进审核队列。
	maxProofLen = 500
	// maxRejectReasonLen 与 claims.reject_reason 的列宽（VARCHAR(255)）一致。
	maxRejectReasonLen = 255
	// voucherMaxAttempts 是凭证码唯一性重试次数（07 §1：最多 5 次）。
	voucherMaxAttempts = 5
)

// ClaimService 负责认领申请、帖主审核与凭证核销。
//
// 依赖三个协作者：
//   - claims：认领表读写；
//   - posts：读帖子（判断类型 / 状态 / 归属，以及核销时的作者校验）；
//   - postSvc：审核通过 / 核销时**复用**帖子的状态机与乐观锁实现。
//     认领流只是「触发者」，帖子状态怎么变、能不能变，唯一真相仍然在
//     PostService 那份白名单里（见 PostService.changeStatusAsSystem 的 tx 参数说明）。
//
// 最后一项是刻意的：认领流只是「触发者」，帖子状态怎么变、能不能变，
// 唯一真相仍然在 PostService 的那份白名单里。
type ClaimService struct {
	claims  *store.ClaimStore
	posts   *store.PostStore
	postSvc *PostService
}

// NewClaimService 创建认领服务。
func NewClaimService(claims *store.ClaimStore, posts *store.PostStore, postSvc *PostService) *ClaimService {
	return &ClaimService{claims: claims, posts: posts, postSvc: postSvc}
}

// Apply 提交一条认领申请（POST /api/posts/:id/claims）。
//
// 校验顺序严格照 07 §2 的第 1–8 条，每一步对应一个明确的错误码：
//
//	1. proof 长度                  → 1001
//	2. 帖子不存在                  → 1004
//	3. 帖子不是 found              → 1001（只有招领帖可被认领）
//	4. 帖子已 closed               → 1007（终态不再接受申请）
//	5. 认领自己发的帖子            → 1001
//	6. 已提交过                    → 1008
//	7. 该帖已有通过的认领          → 1010
//	8. INSERT，捕获唯一键冲突      → 1008 / 1010（并发兜底）
//
// ⚠️ 第 6、7 步是「先查再插」，在并发下有 TOCTOU 竞态：两个请求可能
// 同时通过预检。它们只负责给出更早、更友好的错误，**不是防线**。
// 真正的裁决者是 claims 表上的 uk_post_claimant 与 uk_post_approved
// 两个唯一索引，第 8 步把 1062 翻译成对应的业务码。
//
// 返回值用 DTO 而非实体（07 的签名写的是 *model.Claim）：
// voucher_code 该不该带出取决于「谁在看」，把这条判断留在 service
// 才不会让它漏到 handler 里重新实现一遍。
func (s *ClaimService) Apply(ctx context.Context, postID, claimantID int64, proof string) (*model.ClaimDTO, error) {
	trimmedProof := strings.TrimSpace(proof)
	if err := validateProof(trimmedProof); err != nil {
		return nil, err
	}

	// viewerID 传 0：本流程只关心帖子的类型、状态与归属，不需要联系方式。
	post, err := s.posts.GetByID(ctx, postID, 0)
	if err != nil {
		return nil, err
	}

	if post.Type != valid.TypeFound {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "只有「招领」帖子可以被认领")
	}
	if post.Status == valid.StatusClosed {
		return nil, apperr.Newf(apperr.CodeInvalidStatus, "该帖子已结束，不能再提交认领")
	}
	if post.UserID == claimantID {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "不能认领自己发布的帖子")
	}

	// 第 6 步：应用层预检（有 TOCTOU 窗口，见函数注释）。
	exists, err := s.claims.ExistsByPostAndClaimant(ctx, postID, claimantID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	if exists {
		return nil, apperr.New(apperr.CodeClaimExists)
	}

	// 第 7 步：同样只是预检，数据库索引才是裁决者。
	hasApproved, err := s.claims.ExistsActiveByPost(ctx, postID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	if hasApproved {
		return nil, apperr.New(apperr.CodeClaimApproved)
	}

	claim := &model.Claim{
		PostID:     postID,
		ClaimantID: claimantID,
		Proof:      trimmedProof,
		Status:     valid.ClaimStatusPending,
	}

	id, err := s.claims.Create(ctx, claim)
	if err != nil {
		// store 已把 1062 按索引名翻译成 1008 / 1010，原样透出。
		if appErr, ok := apperr.As(err); ok {
			return nil, appErr
		}
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 回读一次再组装 DTO：响应里的 created_at 必须是数据库的真实值，
	// 而不是本地 time.Now() 猜出来的时间（与 AuthService.Register 同一取舍）。
	created, err := s.claims.GetByID(ctx, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	// 申请人看自己的申请，凭证码（此刻还是 NULL）可以带出。
	return model.ToClaimDTO(created, true, false), nil
}

// Review 审核一条认领申请（PATCH /api/claims/:id）。
//
// 整体在一个事务里完成（07 §3）：锁住认领行 → 校验 → 改 claims →
// 必要时联动改 posts → 提交。任何一步失败都整笔回滚，不会出现
// 「认领通过了但帖子还在招领」这种半成品状态。
//
// 校验顺序照 07 §3 的第 1–5 条：
//
//	1. action 非法                  → 1001
//	2. 认领不存在                   → 1004
//	3. 认领已被处理过（非 pending） → 1001
//	4. 非帖主且非 admin             → 1003
//
// ⚠️ 第 3 步排在第 4 步之前是 07 明确规定的顺序，但它意味着一个
// 越权者如果恰好猜中了一个已处理的认领 id，会拿到 1001 而不是 1003 ——
// 即「这条记录已被处理」这个信息对无权者可见。PostService.ChangeStatus
// 采用了相反的次序（先判权限），两处不一致是**照规格实现**的结果，
// 不是疏漏；认领 id 是自增且不可枚举出有用信息的，风险可接受。
func (s *ClaimService) Review(ctx context.Context, claimID int64, reviewer *model.User, req model.ReviewClaimReq) (*model.ClaimDTO, error) {
	action := strings.TrimSpace(req.Action)
	if !valid.Contains(valid.ValidClaimActions, action) {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "action 必须是 approve 或 reject")
	}

	tx, err := s.claims.BeginTx(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	// 提交之后再 Rollback 是安全的 no-op（database/sql 会返回
	// ErrTxDone 且不产生任何副作用），因此不必写「提交成功就跳过回滚」的分支。
	// 这个 defer 保证了任何一个 return 分支都不会把事务悬着。
	defer func() {
		if rbErr := tx.Rollback(); rbErr != nil && rbErr.Error() != "sql: transaction has already been committed or rolled back" {
			slog.Error("回滚认领审核事务失败", "claimId", claimID, "error", rbErr)
		}
	}()

	// SELECT ... FOR UPDATE：把这条认领锁到事务结束，防止两个并发的
	// 审核请求都读到 pending、都执行 UPDATE，最终结果取决于谁后提交
	// 而两个请求都返回成功。
	claim, err := s.claims.GetByIDForUpdate(ctx, tx, claimID)
	if err != nil {
		return nil, err
	}

	if claim.Status != valid.ClaimStatusPending {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "该认领申请已处理过")
	}

	post, err := s.posts.GetByIDWith(ctx, tx, claim.PostID, 0)
	if err != nil {
		return nil, err
	}

	if post.UserID != reviewer.ID && reviewer.Role != model.RoleAdmin {
		return nil, apperr.New(apperr.CodeForbidden)
	}

	now := time.Now().UTC().Truncate(time.Second)

	switch action {
	case valid.ClaimActionApprove:
		if err := s.approve(ctx, tx, claim.ID, post); err != nil {
			return nil, err
		}
	case valid.ClaimActionReject:
		reason, err := validateRejectReason(req.RejectReason)
		if err != nil {
			return nil, err
		}
		res, err := s.claims.Reject(ctx, tx, claim.ID, reason, now)
		if err != nil {
			return nil, apperr.Wrap(apperr.CodeInternal, err)
		}
		if res.RowsAffected == 0 {
			// 行锁在手时不该发生；真发生了说明有人绕过了锁（例如把
			// FOR UPDATE 去掉了），宁可报错也不要静默成功。
			return nil, apperr.Newf(apperr.CodeInvalidParam, "该认领申请已被处理，请刷新后重试")
		}
		// 拒绝**不动帖子状态**（07 §3 第 7 条）：帖子还在等别人来认领。
	}

	if err := tx.Commit(); err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 事务提交后再回读，让响应与库内真实值完全一致
	// （reviewed_at 是我们写的，但 status 的最终形态可能受并发影响）。
	updated, err := s.claims.GetByID(ctx, claimID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	// 审核者是帖主，按 SPEC 8.3 属于「可以看见凭证码」的两类人之一。
	return model.ToClaimDTO(updated, true, false), nil
}

// approve 执行「审核通过」：生成凭证码 + 写 claims + 联动帖子状态。
//
// 必须由调用方在事务内调用（tx 来自 Review），本方法不自己开事务 ——
// 联动改 posts 与写 claims 必须原子。
func (s *ClaimService) approve(ctx context.Context, tx *sqlx.Tx, claimID int64, post *model.Post) error {
	now := time.Now().UTC().Truncate(time.Second)

	if err := s.approveWithVoucher(ctx, tx, claimID, now); err != nil {
		return err
	}

	// 自动流转帖子：只有 open 需要动。
	//
	//   - open    → matched（有人认领成功，物品有主了，但还没交接完）
	//   - matched → 跳过（已经处于目标状态；再调一次会被白名单拦下并
	//               报 1007，那是误伤 —— 用户什么都没做错）
	//   - closed  → 跳过（终态。理论上一张已结束的帖子可能还挂着一条
	//               pending 申请：申请是帖子 open 时提交的，之后作者手动
	//               结束了帖子。此时批准这条申请不再改变帖子状态，
	//               交给作者自行决定是否重新开放，系统不擅自逆流）
	if post.Status == valid.StatusOpen {
		// ⚠️ 复用 PostService 的同一套白名单 + 乐观锁，而不是在这里
		// 写一句 UPDATE posts SET status='matched'。状态机只能有一份定义。
		if err := s.postSvc.changeStatusAsSystem(ctx, tx, post.ID, valid.StatusMatched); err != nil {
			return err
		}
	}
	return nil
}

// approveWithVoucher 生成唯一凭证码并落库，命中 uk_voucher_code 冲突则重试。
//
// 为什么需要重试：凭证码只有 6 位（32^6 ≈ 10.7 亿），配合
// uk_voucher_code 唯一索引，碰撞概率极低但**不为零**。如果不重试，
// 一次罕见的碰撞会让用户看到 5000，而重试一次本可以成功。
//
// 次数上限 5（07 §1）：连续 5 次都撞上同一个索引，更可能是
// 随机源异常或索引上已经堆积了大量记录，继续重试只是徒劳，
// 应当把问题暴露出来而不是无限转圈。
func (s *ClaimService) approveWithVoucher(
	ctx context.Context, tx *sqlx.Tx, claimID int64, now time.Time,
) error {
	for attempt := 1; attempt <= voucherMaxAttempts; attempt++ {
		code, err := voucher.Generate()
		if err != nil {
			return apperr.Wrap(apperr.CodeInternal, err)
		}

		res, err := s.claims.Approve(ctx, tx, claimID, code, now)
		if err != nil {
			if isVoucherConflict(err) {
				slog.Warn("凭证码碰撞，重新生成",
					"claimId", claimID, "attempt", attempt)
				continue
			}
			// 1010（该帖已有通过认领）等业务错误在这里原样上抛。
			return err
		}
		if res.RowsAffected == 0 {
			return apperr.Newf(apperr.CodeInvalidParam, "该认领申请已被处理，请刷新后重试")
		}
		return nil
	}
	return apperr.Newf(apperr.CodeInternal,
		"连续 %d 次生成的凭证码都已存在，请稍后重试", voucherMaxAttempts)
}

// Redeem 核销凭证，完成线下交接（POST /api/claims/:id/redeem）。
//
// 校验顺序照 07 §4：认领不存在 → 1004，非帖主 → 1003，
// 状态不是 approved → 1001，凭证码不匹配 → 1011。
//
// 同样在事务里完成「改 claims + 帖子置 closed」。
func (s *ClaimService) Redeem(ctx context.Context, claimID int64, reviewer *model.User, rawCode string) (*model.ClaimDTO, error) {
	tx, err := s.claims.BeginTx(ctx)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	defer func() {
		if rbErr := tx.Rollback(); rbErr != nil && rbErr.Error() != "sql: transaction has already been committed or rolled back" {
			slog.Error("回滚认领核销事务失败", "claimId", claimID, "error", rbErr)
		}
	}()

	claim, err := s.claims.GetByIDForUpdate(ctx, tx, claimID)
	if err != nil {
		return nil, err
	}

	post, err := s.posts.GetByIDWith(ctx, tx, claim.PostID, 0)
	if err != nil {
		return nil, err
	}

	// 核销只有帖主能做 —— 这里**不**给 admin 开口子（07 §4 第 3 条
	// 写的是 post.UserID != currentUser.ID，没有 admin 例外）。
	// 核销意味着「东西真的交出去了」，是线下已经发生的事实的登记，
	// 管理员代替作者登记会污染交接记录的可信度。
	if post.UserID != reviewer.ID {
		return nil, apperr.New(apperr.CodeForbidden)
	}

	if claim.Status != valid.ClaimStatusApproved {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "该认领当前不处于「已通过」状态，无法核销")
	}

	if !matchVoucher(claim.VoucherCode, rawCode) {
		return nil, apperr.New(apperr.CodeVoucherMismatch)
	}

	now := time.Now().UTC().Truncate(time.Second)

	res, err := s.claims.Redeem(ctx, tx, claim.ID, now)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	if res.RowsAffected == 0 {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "该认领已被核销，请刷新后重试")
	}

	// 核销成功 → 帖子自动置 closed（SPEC 7.1「唯一可信路径」）。
	// matched → closed 命中白名单；万一帖子还停在 open（例如作者
	// 手动把 matched 改回去过），open → closed 同样在白名单内。
	// 两条路径都不需要在这里做 if 判断，白名单会放行其中合法的那一条。
	if err := s.postSvc.changeStatusAsSystem(ctx, tx, post.ID, valid.StatusClosed); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	updated, err := s.claims.GetByID(ctx, claimID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	return model.ToClaimDTO(updated, true, true), nil
}

// ListByPost 返回某帖子下的全部认领申请（GET /api/posts/:id/claims）。
//
// 权限：**仅帖主**可见，其他人（包括 admin）一律 1003。
//
// ⚠️ 这里按 SPEC 8.4 实现（「仅帖主，返回该帖全部申请」），而不是
// 07 §5 写的「仅帖主（或 admin）」—— 两份文档在这一点上是冲突的，
// 依据是 00-SPEC 开篇的「本文件是唯一真源」，且 07 自己的验收清单
// 第 6 条也要求「carol（seed 里 role=admin）查 bob 帖子的认领列表 → 1003」。
// 两者的结论一致指向「只认帖主」，因此 07 §5 的括号是笔误。
//
// 注意这与审核接口（PATCH /api/claims/:id）的权限**不同**：SPEC 8.4 对
// 审核明确写了「仅帖主或 admin」，对列表却只写「仅帖主」。
// 这个不对称是 SPEC 刻意的：admin 需要能处置违规认领（治理权），
// 但没有理由让管理员能成批扫读所有申请人写下的私密特征证明（阅卷权）。
//
// 为什么 proof 不能公开：它是申请人写下的「只有失主知道的特征」，
// 本质上是一份自证材料。公开它等于把所有认领人的答案摊在阳光下，
// 后来者可以直接抄 —— 那会让「用特征证明归属」这个机制彻底失效。
func (s *ClaimService) ListByPost(
	ctx context.Context, postID int64, viewer *model.User, limit, offset int,
) ([]*model.ClaimDTO, int64, error) {
	post, err := s.posts.GetByID(ctx, postID, 0)
	if err != nil {
		return nil, 0, err
	}

	if post.UserID != viewer.ID {
		return nil, 0, apperr.New(apperr.CodeForbidden)
	}

	total, err := s.claims.CountByPost(ctx, postID)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	rows, err := s.claims.ListByPost(ctx, postID, limit, offset)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 能走到这里说明 viewer 就是帖主，属于 SPEC 8.3 允许看见凭证码的两类人之一。
	return model.ToClaimDTOs(rows, true, false), total, nil
}

// ListMine 返回「我发出的认领」（GET /api/users/me/claims）。
//
// claimantID 由 handler 取自当前登录用户，**不接受任何查询参数** ——
// 否则改一个 ?user_id= 就能翻别人的认领记录（含他们写下的 proof）。
//
// 这里带出 post 摘要并以 showVoucher=true 组装：调用者必然是申请人本人，
// 属于 SPEC 8.3 允许看见自己凭证码的情形。
func (s *ClaimService) ListMine(
	ctx context.Context, claimantID int64, limit, offset int,
) ([]*model.ClaimDTO, int64, error) {
	total, err := s.claims.CountByClaimant(ctx, claimantID)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	rows, err := s.claims.ListByClaimant(ctx, claimantID, limit, offset)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	return model.ToClaimDTOs(rows, true, true), total, nil
}

// validateProof 校验特征证明的长度（按 rune）。
func validateProof(proof string) error {
	n := utf8.RuneCountInString(proof)
	if n < minProofLen {
		return apperr.Newf(apperr.CodeInvalidParam,
			"请补充更多物品特征，至少 %d 个字（当前 %d 个）", minProofLen, n)
	}
	if n > maxProofLen {
		return apperr.Newf(apperr.CodeInvalidParam,
			"物品特征说明不能超过 %d 个字（当前 %d 个）", maxProofLen, n)
	}
	return nil
}

// validateRejectReason 裁剪并校验拒绝理由。
//
// 理由允许为空（用户可能只想说「不是我的东西」，不想解释），
// 但不能超过列宽 —— 超过会在 MySQL 严格模式下直接报错，
// 表现为一次莫名其妙的 5000，所以必须在这里按 rune 截断/拒绝。
//
// 这里选择**按 rune 截断**而不是报错：拒绝理由是一段补充说明，
// 用户表达欲强于表单容量是很正常的事，为一个说明性字段弹校验失败
// 只会打断审核流程。截断到 255 个字符。
func validateRejectReason(reason string) (string, error) {
	trimmed := strings.TrimSpace(reason)

	// 按 rune 逐字累加到上限，避免把一个汉字截成半个（utf8mb4 下
	// 截断字节会产生非法序列，MySQL 会直接拒绝写入）。
	runes := []rune(trimmed)
	if len(runes) > maxRejectReasonLen {
		return string(runes[:maxRejectReasonLen]), nil
	}
	return trimmed, nil
}

// matchVoucher 用**恒定时间**比较用户提交的凭证码与库中记录的凭证码。
//
// 为什么要用 subtle.ConstantTimeCompare 而不是 ==：字符串比较会在
// 第一个不同的字符处提前返回，耗时随「前缀匹配长度」变化。
// 攻击者虽然拿不到精确的耗时，但在足够多的采样下可以逐位猜出凭证码 ——
// 6 位凭证码（约 30 bit）正是这种攻击最有利可图的规模。
//
// ⚠️ ConstantTimeCompare 要求两个切片**长度相同**，长度不同会直接返回 0，
// 因此这里先显式比长度。这么做不泄露秘密：凭证码的长度是公开常量（6），
// 不是需要保护的信息。
//
// 空值处理：库里 voucher_code 为 NULL（未通过审核）时，任何输入都不匹配。
func matchVoucher(stored *string, input string) bool {
	if stored == nil {
		return false
	}

	want := []byte(*stored)
	got := []byte(voucher.Normalize(input))

	if len(want) != len(got) {
		return false
	}
	return subtle.ConstantTimeCompare(want, got) == 1
}

// isVoucherConflict 判断错误链上是否带着「凭证码已被占用」的信号。
//
// 用 errors.Is 而不是字符串匹配（07 常见坑 2）：store 层已经把
// MySQL 的 1062 与索引名翻译成了一个类型化的哨兵错误，
// 这里的判断因此与驱动版本、报错文案都无关。
func isVoucherConflict(err error) bool {
	return errors.Is(err, store.ErrVoucherCodeConflict)
}
