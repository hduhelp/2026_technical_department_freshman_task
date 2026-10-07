package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
)

// ErrVoucherCodeConflict 表示这次写入撞上了 claims.uk_voucher_code。
//
// 它不是业务错误，而是「随机碰撞，重来一次就好」的信号：
// 凭证码只有 6 位，虽然 32^6 的空间让碰撞极其罕见，但「极其罕见」
// 不等于「不会发生」—— 一旦发生而没有被识别，用户会看到一次莫名其妙的
// 5000，而重试一次本可以成功。因此把它做成一个**类型化的哨兵错误**，
// 让调用方用 errors.Is 判断后重新生成，而不是去解析错误文案。
//
// ⚠️ 为什么不像 apperr 那样做成业务错误码：SPEC 8.2 的错误码表是对外的
// 契约，凭证码碰撞不构成任何一种「用户做错了什么」的情形，
// 不应该、也没有合适的位置出现在对外错误表里。
var ErrVoucherCodeConflict = errors.New("凭证码已被占用")

// ClaimStore 封装 claims 表的读写。
//
// 与 PostStore / UserStore 的差别在于：本表的绝大多数写操作都发生在
// 事务里（认领审核、核销都要连带改 posts），因此写方法统一接受一个
// Querier 参数 —— 传 *sqlx.Tx 即进入事务，传 s.db 则走连接池。
// 事务的开启与提交由 service 层负责，store 不做业务决策。
type ClaimStore struct {
	db *sqlx.DB
}

// NewClaimStore 创建认领仓储。
func NewClaimStore(db *sqlx.DB) *ClaimStore {
	return &ClaimStore{db: db}
}

// claimCoreColumns 是 claims 表自身的列清单（不含任何 JOIN）。
//
// 用于审核 / 核销这类「只要拿到这一行的当前状态」的场景：
// 它们会在事务里对行加锁，而带 JOIN 的 FOR UPDATE 会把 users、posts
// 的行一并锁住 —— 锁的粒度无谓地扩大到「同一个人发起的所有认领」，
// 没有任何好处。需要昵称时由调用方在事务外单独回读一次。
const claimCoreColumns = `
	c.id, c.post_id, c.claimant_id, c.proof, c.status, c.voucher_code,
	c.reject_reason, c.reviewed_at, c.redeemed_at, c.created_at`

// claimDetailColumns 是带 JOIN 的完整列清单（含申请人昵称与帖子摘要）。
//
// 刻意不用 SELECT *：列清单固定后表结构增删列不会悄悄改变扫描行为，
// 也便于审计「哪些列被读出来了」。
const claimDetailColumns = claimCoreColumns + `,
	u.nickname AS claimant_nickname,
	p.title AS post_title, p.type AS post_type, p.status AS post_status`

// claimFromClause 是认领详情查询固定的 FROM + JOIN 片段。
//
// INNER JOIN 而非 LEFT JOIN：claims 对 users / posts 都有外键且为
// ON DELETE CASCADE，不存在孤儿行；真出现了也属于数据损坏，
// 应当表现为「查不到」而不是「查出一条 claimant 为空白的记录」。
const claimFromClause = `
	FROM claims c
	JOIN users u ON u.id = c.claimant_id
	JOIN posts p ON p.id = c.post_id`

// BeginTx 开启一个事务。
//
// 放在 store 层是因为「怎么开事务」属于数据访问细节（隔离级别、
// sql.TxOptions），业务层不该关心；而「要不要开、边界在哪」才是业务决策，
// 留在 service。
func (s *ClaimStore) BeginTx(ctx context.Context) (*sqlx.Tx, error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开启认领事务失败: %w", err)
	}
	return tx, nil
}

// Create 插入一条认领申请，并把自增主键回填到 c.ID。
//
// ⚠️ 关键点（SPEC 7.3 规则 4/5 + 07 §2 第 8 条）：本方法必须把两个
// 唯一键冲突分别翻译成不同的业务错误码，因为它们对用户是完全不同的两件事：
//
//	uk_post_claimant → 1008「你已经申请过了」
//	uk_post_approved → 1010「这张帖子已经有人认领通过了」
//
// 为什么不能只靠 service 的「先查再插」：先查再插在并发下有 TOCTOU 竞态
// —— 两个请求可能同时通过预检。唯一索引才是最终裁决者，捕获 1062
// 把裁决结果翻译成人话，是这条规则唯一的可靠实现。
//
// voucher_code 在申请阶段恒为 NULL（通过审核时才生成），
// 因此这里不处理 uk_voucher_code：MySQL 的唯一索引允许多个 NULL。
func (s *ClaimStore) Create(ctx context.Context, c *model.Claim) (int64, error) {
	const query = `
		INSERT INTO claims (post_id, claimant_id, proof, status)
		VALUES (?, ?, ?, ?)`

	res, err := s.db.ExecContext(ctx, query, c.PostID, c.ClaimantID, c.Proof, c.Status)
	if err != nil {
		switch {
		case model.IsDuplicateEntryOn(err, model.IndexClaimsPostClaimant):
			return 0, apperr.Wrap(apperr.CodeClaimExists, err)
		case model.IsDuplicateEntryOn(err, model.IndexClaimsPostApproved):
			return 0, apperr.Wrap(apperr.CodeClaimApproved, err)
		}
		return 0, fmt.Errorf("插入认领申请失败: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("读取新增认领 id 失败: %w", err)
	}
	return id, nil
}

// GetByID 按主键查询认领，并联表带出申请人昵称与帖子摘要。
//
// 不存在时返回 apperr 1004，不把 sql.ErrNoRows 漏给上层。
func (s *ClaimStore) GetByID(ctx context.Context, id int64) (*model.Claim, error) {
	return s.getDetail(ctx, s.db, id)
}

// GetByIDForUpdate 在事务内按主键查询并**锁定**该行（SELECT ... FOR UPDATE）。
//
// 用途：审核与核销都必须在「读到状态」与「写入新状态」之间排除并发，
// 否则两个并发的审核请求会都读到 pending、都执行 UPDATE，
// 后一次静默覆盖前一次的结果（例如 approve 与 reject 同时到达，
// 最终状态取决于谁后提交，而两个请求都返回了成功）。
//
// ⚠️ FOR UPDATE 只在事务内有意义：不在事务里 MySQL 会在语句结束时
// 立刻释放锁，等于没锁。因此本方法只接受事务句柄，不接受 s.db。
func (s *ClaimStore) GetByIDForUpdate(ctx context.Context, tx *sqlx.Tx, id int64) (*model.Claim, error) {
	query := `SELECT` + claimCoreColumns + ` FROM claims c WHERE c.id = ? FOR UPDATE`

	var c model.Claim
	if err := tx.GetContext(ctx, &c, query, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.Wrap(apperr.CodeNotFound, err)
		}
		return nil, fmt.Errorf("锁定认领记录失败: %w", err)
	}
	return &c, nil
}

// getDetail 是带 JOIN 的按主键查询内部实现。
func (s *ClaimStore) getDetail(ctx context.Context, q Querier, id int64) (*model.Claim, error) {
	query := `SELECT` + claimDetailColumns + claimFromClause + `
		WHERE c.id = ?`

	var c model.Claim
	if err := q.GetContext(ctx, &c, query, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.Wrap(apperr.CodeNotFound, err)
		}
		return nil, fmt.Errorf("查询认领记录失败: %w", err)
	}
	return &c, nil
}

// GetByPostAndClaimant 查询某个用户在某张帖子上的那条认领记录。
//
// 「帖子详情里附上我自己的认领」（my_claim）与「提交前的重复校验」
// 都走它。不存在时返回 (nil, nil) 而不是 1004 ——
// 「我没申请过」是绝大多数访客的正常情况，不是错误。
func (s *ClaimStore) GetByPostAndClaimant(ctx context.Context, postID, claimantID int64) (*model.Claim, error) {
	query := `SELECT` + claimDetailColumns + claimFromClause + `
		WHERE c.post_id = ? AND c.claimant_id = ?`

	var c model.Claim
	if err := s.db.GetContext(ctx, &c, query, postID, claimantID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("查询我的认领记录失败: %w", err)
	}
	return &c, nil
}

// ExistsActiveByPost 判断某张帖子下是否已存在「已成立」的认领
// （status IN ('approved','redeemed')）。
//
// 用途有二：
//  1. SPEC 7.3 规则 5 的应用层预检 —— 让用户在提交前就拿到 1010，
//     而不是等帖主审核时才被告知；数据库的 uk_post_approved 仍是最终兜底。
//  2. 让 service 能区分「帖子变 matched 是认领通过导致的」这类上下文
//     （P6 的帖子自动流转）。
//
// 状态集合取自 valid.ClaimStatusesActive 展开成 SQL 字面量：
// 这里**必须**是固定的 SQL 片段，绝不能把状态值拼进来。
func (s *ClaimStore) ExistsActiveByPost(ctx context.Context, postID int64) (bool, error) {
	const query = `
		SELECT EXISTS(
			SELECT 1 FROM claims
			WHERE post_id = ? AND status IN ('approved', 'redeemed')
		)`

	var exists bool
	if err := s.db.GetContext(ctx, &exists, query, postID); err != nil {
		return false, fmt.Errorf("检查帖子是否已有通过认领失败: %w", err)
	}
	return exists, nil
}

// ExistsByPostAndClaimant 判断某用户是否已对某帖子提交过认领。
//
// ⚠️ 与所有「先查再插」一样，本方法有 TOCTOU 窗口，**不能**作为
// 唯一防线：它只用来给出更早、更友好的 1008，最终裁决仍是
// Create 捕获 uk_post_claimant 的 1062。
func (s *ClaimStore) ExistsByPostAndClaimant(ctx context.Context, postID, claimantID int64) (bool, error) {
	const query = `
		SELECT EXISTS(
			SELECT 1 FROM claims WHERE post_id = ? AND claimant_id = ?
		)`

	var exists bool
	if err := s.db.GetContext(ctx, &exists, query, postID, claimantID); err != nil {
		return false, fmt.Errorf("检查重复认领失败: %w", err)
	}
	return exists, nil
}

// ListByPost 按帖子分页查询全部认领申请，按提交时间倒序。
//
// 走 uk_post_claimant 的 (post_id, claimant_id) 前缀 + idx_post_status，
// 不会全表扫。
//
// ORDER BY 追加 c.id DESC 的目的是**稳定排序**（与 PostStore.List 同理）：
// created_at 精度到秒，同一秒内的两条申请若只按时间排，
// 两次查询的相对顺序不保证一致，分页时会出现「某条记录在第 1、2 页
// 同时出现，另一条永远看不到」。
func (s *ClaimStore) ListByPost(ctx context.Context, postID int64, limit, offset int) ([]model.Claim, error) {
	query := `SELECT` + claimDetailColumns + claimFromClause + `
		WHERE c.post_id = ?
		ORDER BY c.created_at DESC, c.id DESC
		LIMIT ? OFFSET ?`

	rows := make([]model.Claim, 0, limit)
	if err := s.db.SelectContext(ctx, &rows, query, postID, limit, offset); err != nil {
		return nil, fmt.Errorf("查询帖子认领列表失败: %w", err)
	}
	return rows, nil
}

// CountByPost 统计某帖子的认领总数，与 ListByPost 的口径一致。
func (s *ClaimStore) CountByPost(ctx context.Context, postID int64) (int64, error) {
	const query = `SELECT COUNT(*) FROM claims WHERE post_id = ?`

	var total int64
	if err := s.db.GetContext(ctx, &total, query, postID); err != nil {
		return 0, fmt.Errorf("统计帖子认领总数失败: %w", err)
	}
	return total, nil
}

// ListByClaimant 分页查询「我发出的认领」，按提交时间倒序。
//
// 走 idx_claimant（claimant_id），并 JOIN posts 带出帖子摘要
// （07 §5 要求「我的认领」列表能显示关联帖子标题并可跳转）。
func (s *ClaimStore) ListByClaimant(ctx context.Context, claimantID int64, limit, offset int) ([]model.Claim, error) {
	query := `SELECT` + claimDetailColumns + claimFromClause + `
		WHERE c.claimant_id = ?
		ORDER BY c.created_at DESC, c.id DESC
		LIMIT ? OFFSET ?`

	rows := make([]model.Claim, 0, limit)
	if err := s.db.SelectContext(ctx, &rows, query, claimantID, limit, offset); err != nil {
		return nil, fmt.Errorf("查询我的认领列表失败: %w", err)
	}
	return rows, nil
}

// CountByClaimant 统计「我发出的认领」总数，与 ListByClaimant 口径一致。
func (s *ClaimStore) CountByClaimant(ctx context.Context, claimantID int64) (int64, error) {
	const query = `SELECT COUNT(*) FROM claims WHERE claimant_id = ?`

	var total int64
	if err := s.db.GetContext(ctx, &total, query, claimantID); err != nil {
		return 0, fmt.Errorf("统计我的认领总数失败: %w", err)
	}
	return total, nil
}

// ClaimWriteResult 描述一次认领状态写入的结果。
//
// 之所以要把「行数」和「错误」并列返回（而不是只返回 error）：
// 行数为 0 有「记录不存在」与「状态已被别人改过」两种截然不同的解释，
// 该映射成 1004 还是 1001 属于业务语义，由 service 结合已锁定的记录判断，
// store 不越权下结论。这与 PostStore.UpdateStatus 的取舍一致。
type ClaimWriteResult struct {
	// RowsAffected 是实际更新的行数，正常情况下应为 1。
	RowsAffected int64
	// VoucherConflict 为 true 表示凭证码撞上了 uk_voucher_code，
	// 调用方应重新生成凭证码后重试。
	VoucherConflict bool
}

// Approve 把认领置为 approved 并写入凭证码。
//
// 条件里带 `AND status = 'pending'` 是一层额外的幂等保护：
// 调用方已在事务内用 FOR UPDATE 锁过这一行，本条件在当前事务下不可能失败；
// 但万一将来有人把 FOR UPDATE 去掉，这一行就是最后一道防线 ——
// 它让「重复审核」表现为 0 行更新（被识别为并发冲突），
// 而不是把一条已 redeemed 的记录倒退回 approved。
//
// 唯一键 uk_post_approved 的冲突（同一帖子已有一条通过记录）在这里被
// 翻译成 1010；uk_voucher_code 的冲突则通过 VoucherConflict 上报，
// 由调用方重新生成凭证码 —— 这两件事对用户的意义完全不同，
// 前者是「你来晚了」，后者是「系统重试一下就好」。
func (s *ClaimStore) Approve(
	ctx context.Context, q Querier, id int64, voucherCode string, reviewedAt time.Time,
) (ClaimWriteResult, error) {
	const query = `
		UPDATE claims
		SET status = 'approved', voucher_code = ?, reject_reason = '', reviewed_at = ?
		WHERE id = ? AND status = 'pending'`

	res, err := q.ExecContext(ctx, query, voucherCode, reviewedAt, id)
	if err != nil {
		switch {
		case model.IsDuplicateEntryOn(err, model.IndexClaimsPostApproved):
			return ClaimWriteResult{}, apperr.Wrap(apperr.CodeClaimApproved, err)
		case model.IsDuplicateEntryOn(err, model.IndexClaimsVoucherCode):
			// 顺着错误链往上传递哨兵，让 service 用 errors.Is 判定后重试。
			return ClaimWriteResult{}, fmt.Errorf("写入凭证码失败: %w", ErrVoucherCodeConflict)
		}
		return ClaimWriteResult{}, fmt.Errorf("通过认领失败: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return ClaimWriteResult{}, fmt.Errorf("读取认领更新影响行数失败: %w", err)
	}
	return ClaimWriteResult{RowsAffected: n}, nil
}

// Reject 把认领置为 rejected 并记录拒绝理由。
//
// 不动 voucher_code 与帖子的状态：拒绝一条申请不应改变帖子对外可见的
// 任何信息（帖子还在等人认领）。理由裁剪到 255 字节以内由 service 负责，
// 与 reject_reason 列宽一致。
func (s *ClaimStore) Reject(
	ctx context.Context, q Querier, id int64, reason string, reviewedAt time.Time,
) (ClaimWriteResult, error) {
	const query = `
		UPDATE claims
		SET status = 'rejected', reject_reason = ?, reviewed_at = ?
		WHERE id = ? AND status = 'pending'`

	res, err := q.ExecContext(ctx, query, reason, reviewedAt, id)
	if err != nil {
		return ClaimWriteResult{}, fmt.Errorf("拒绝认领失败: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return ClaimWriteResult{}, fmt.Errorf("读取认领更新影响行数失败: %w", err)
	}
	return ClaimWriteResult{RowsAffected: n}, nil
}

// Redeem 把认领置为 redeemed，表示物品已完成线下交接。
//
// 条件里带 `AND status = 'approved'` 的理由与 Approve 相同：
// 只有「已通过且尚未交接」的记录才能被核销，防止把一条 rejected
// 的记录核销掉，也防止同一条记录被核销两次（第二次 0 行）。
func (s *ClaimStore) Redeem(
	ctx context.Context, q Querier, id int64, redeemedAt time.Time,
) (ClaimWriteResult, error) {
	const query = `
		UPDATE claims
		SET status = 'redeemed', redeemed_at = ?
		WHERE id = ? AND status = 'approved'`

	res, err := q.ExecContext(ctx, query, redeemedAt, id)
	if err != nil {
		return ClaimWriteResult{}, fmt.Errorf("核销认领失败: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return ClaimWriteResult{}, fmt.Errorf("读取认领更新影响行数失败: %w", err)
	}
	return ClaimWriteResult{RowsAffected: n}, nil
}
