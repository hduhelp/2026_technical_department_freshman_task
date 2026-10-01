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

// PostStore 封装 posts 表的读写。
//
// 与 UserStore 一样只持有 *sqlx.DB；需要事务的场景（P6 的认领审核）
// 由 service 层传 *sqlx.Tx 进来，届时再扩展带 Execer 的重载方法。
type PostStore struct {
	db *sqlx.DB
}

// NewPostStore 创建帖子仓储。
func NewPostStore(db *sqlx.DB) *PostStore {
	return &PostStore{db: db}
}

// postFromClause 是帖子查询固定的 FROM + JOIN 片段，列表 / 计数 / 详情共用。
const postFromClause = `
	FROM posts p
	JOIN users u ON u.id = p.user_id`

// viewerActiveClaimExistsSQL 是 SPEC 7.2 规则 4 的判定表达式：
// 「该帖子下存在一条 approved/redeemed 且申请人就是当前请求者的认领记录」。
//
// 它是一个相关子查询，唯一的 ? 是 viewerID。抽成常量是为了让下面
// 两处用法（一列、一分支）**共用同一段文本**：
// 若两处各写一遍，将来改了状态集合（例如新增一种「已成立」的状态）
// 只改一处，就会出现「contact_visible 说可见、contact 却是空串」
// 这种自相矛盾的响应。
//
// 走 idx_post_status(post_id, status) 与 idx_claimant(claimant_id)，
// 不会退化成全表扫。
const viewerActiveClaimExistsSQL = `EXISTS(
			SELECT 1 FROM claims c
			WHERE c.post_id = p.id
			  AND c.claimant_id = ?
			  AND c.status IN ('approved', 'redeemed')
		)`

// contactCaseSQL 在 **SQL 层**决定是否把 u.contact 带进结果集（SPEC 7.2 硬要求）。
//
// SPEC 7.2 明确要求「在 SQL 层决定是否 SELECT contact，不要查出来再在内存里删」。
// 这里把可见性判断写进 SELECT 列表：不可见的行直接返回空串，
// 真实联系方式根本不会离开数据库、更不会进入应用内存。
//
// 分支顺序即 SPEC 7.2 的判定顺序（任一条命中即返回，后面的不再求值）：
//
//	1. u.id = ?                            → 请求者就是作者本人
//	2. u.contact_public = 1 AND ? > 0      → 作者主动公开（且请求者是登录用户）
//	3. EXISTS(claims ... approved/redeemed) → 双方存在已通过的认领关系（P6 接入）
//	4. 其余                                 → 空串
//
// ⚠️ 这里的 `? > 0` 不能省：contact_public 表达的是「对所有**登录用户**公开」，
// 游客（viewerID = 0）不在此列。没有这个条件，一条 u.id = 0 的
// 不存在的用户会和「作者本人」分支混淆。
//
// viewerID <= 0 时（游客 / 只关心权限的内部调用）第 3 个分支**根本不出现在
// SQL 里**：条件恒假，带上它只会让数据库白做一次子查询。
// 这与 SPEC 10「只允许拼接固定 SQL 片段」并不冲突 —— 拼进去的仍然是
// 硬编码常量，用户的输入值始终走 ? 占位符。
func contactCaseSQL(viewerID int64) string {
	sql := `,
	CASE
		WHEN u.id = ? THEN u.contact
		WHEN u.contact_public = 1 AND ? > 0 THEN u.contact`
	if viewerID > 0 {
		sql += `
		WHEN ` + viewerActiveClaimExistsSQL + ` THEN u.contact`
	}
	sql += `
		ELSE ''
	END AS author_contact`
	return sql
}

// postSelectColumns 返回帖子查询的 SELECT 列清单（含 JOIN users 带出的作者字段）。
//
// 抽成函数让「详情」「列表」共用同一份列清单 —— 两处各写一份，
// 迟早出现一边多查了 author_contact、另一边忘了加，导致同一张帖子
// 在两个接口下的联系方式表现不一致。
//
// withContact 为 false 时**根本不 SELECT** u.contact：
//   - 列表接口一律不外带联系方式（见 SPEC 8.3 / 阶段文件 04 §4），
//     减少一次批量查询里的泄露面；
//   - 更新 / 删除 / 状态流转只需要 user_id 与 status，更不需要它。
//
// viewer_has_approved_claim 则**始终**带出：它是 contact_visible 这个
// 对外字段的判定输入（SPEC 7.2），列表接口虽然不带 contact，
// 但仍要如实告诉前端「按规则本该可见」——前端据此渲染不同的提示文案。
// 与 author_contact_public 一样，它本身不是敏感值，只是一个布尔。
//
// 游客（viewerID <= 0）下写成字面量 0 而不是子查询：不存在「游客的认领」，
// 求值一次纯属浪费，且会在每条列表记录上各跑一次。
func postSelectColumns(withContact bool, viewerID int64) string {
	cols := `
	p.id, p.user_id, p.type, p.title, p.category, p.location, p.happened_at,
	p.description, p.images, p.status, p.created_at, p.updated_at,
	u.id AS author_id, u.nickname AS author_nickname,
	u.contact_public AS author_contact_public`
	if viewerID > 0 {
		cols += `,
	` + viewerActiveClaimExistsSQL + ` AS viewer_has_approved_claim`
	} else {
		cols += `,
	0 AS viewer_has_approved_claim`
	}
	if withContact {
		cols += contactCaseSQL(viewerID)
	}
	return cols
}

// postSelectArgs 返回 postSelectColumns 所产生的 ? 参数，顺序与 SQL 文本一致。
//
// ⚠️ 本函数与 postSelectColumns 是一对必须同步修改的孪生函数：
// 每当列清单里增删一个 `?`，这里就必须跟着增删一个参数。
// 之所以不合并成一个「返回 (sql, args)」的函数，是因为调用方还需要
// 在列清单与 WHERE 之间插入 postFromClause，合并后反而更难读。
//
// 参数全部是同一个值（viewerID），所以就算顺序写反了也不会产生错误结果；
// 但**个数**必须严格对上，否则 MySQL 会报
// "sql: expected N arguments, got M"，属于上线即暴露的低级错误。
// 这也是把这段逻辑集中在一处、而不是散落到各个查询里的原因。
func postSelectArgs(viewerID int64, withContact bool) []any {
	args := make([]any, 0, 4)
	if viewerID > 0 {
		// viewer_has_approved_claim 的相关子查询
		args = append(args, viewerID)
	}
	if withContact {
		// contactCaseSQL 的前两个分支：u.id = ? 与 ? > 0
		args = append(args, viewerID, viewerID)
		if viewerID > 0 {
			// contactCaseSQL 的第三个分支
			args = append(args, viewerID)
		}
	}
	return args
}

// Create 插入一条帖子，并把自增主键回填到 p.ID。
//
// 入参 p 的 Status 由 service 层固定填 "open"，store 不参与业务决策。
// images 走 Images.Value() 序列化为 JSON 文本写入。
func (s *PostStore) Create(ctx context.Context, p *model.Post) (int64, error) {
	const query = `
		INSERT INTO posts (user_id, type, title, category, location, happened_at, description, images, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	res, err := s.db.ExecContext(ctx, query,
		p.UserID, p.Type, p.Title, p.Category, p.Location,
		p.HappenedAt, p.Description, p.Images, p.Status,
	)
	if err != nil {
		return 0, fmt.Errorf("插入帖子失败: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("读取新增帖子 id 失败: %w", err)
	}
	return id, nil
}

// Handle 返回本次操作应当使用的数据库句柄。
//
// tx 非 nil 时用事务，否则用连接池。这是「service 决定业务边界、
// store 决定数据访问细节」这条分工的接缝：service 知道「这几次写必须
// 原子」，但不必知道 sqlx 有 DB / Tx 两种类型。
//
// 用法：
//
//	h := posts.Handle(tx)              // tx 可能为 nil
//	posts.GetByIDWith(ctx, h, id, 0)
//	posts.UpdateStatusWith(ctx, h, id, from, to, now)
func (s *PostStore) Handle(tx *sqlx.Tx) Querier {
	if tx != nil {
		return tx
	}
	return s.db
}

// GetByID 按主键查询帖子，并联表带出作者昵称与联系方式。
//
// viewerID 决定 author_contact 是否真实带出（SPEC 7.2 的 SQL 层判定）：
// 传 0 表示游客或「本次流程不关心联系方式」，此时该列恒为空串。
// 只做权限 / 状态判断的调用方（更新、删除、状态流转）传 0 即可。
//
// 帖子不存在时返回 apperr 1004，不把 sql.ErrNoRows 漏给上层。
func (s *PostStore) GetByID(ctx context.Context, id int64, viewerID int64) (*model.Post, error) {
	return s.getByID(ctx, s.db, id, viewerID)
}

// GetByIDWith 是 GetByID 的「句柄由调用方指定」版本，供事务内使用。
//
// 用途：P6 的认领审核在同一个事务里先锁住 claim、再读帖子的当前状态，
// 据此决定要不要触发状态联动。若这里改走连接池，读到的会是事务外的
// 快照（且可能因等待行锁而阻塞到超时），事务的隔离性形同虚设。
func (s *PostStore) GetByIDWith(ctx context.Context, q Querier, id int64, viewerID int64) (*model.Post, error) {
	return s.getByID(ctx, q, id, viewerID)
}

// getByID 是 GetByID / GetByIDTx 共用的实现，句柄由调用方注入。
func (s *PostStore) getByID(ctx context.Context, q Querier, id int64, viewerID int64) (*model.Post, error) {
	query := `SELECT` + postSelectColumns(true, viewerID) + postFromClause + `
		WHERE p.id = ?`

	// SELECT 列表里的 ? 先于 WHERE 的 ?，参数顺序必须对应。
	args := append(postSelectArgs(viewerID, true), id)

	var p model.Post
	if err := q.GetContext(ctx, &p, query, args...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apperr.Wrap(apperr.CodeNotFound, err)
		}
		return nil, fmt.Errorf("查询帖子失败: %w", err)
	}
	return &p, nil
}

// Update 更新帖子的可编辑字段。
//
// ⚠️ 可更新的列是**固定的 SQL 片段**，绝不接受调用方传入列名 ——
// type / status / user_id 因此不可能被本方法改写，这是
// SPEC 10「只允许拼接固定 SQL 片段」与 SPEC 03 要点 5 的双重落地。
// 值一律走 ? 占位符。
func (s *PostStore) Update(ctx context.Context, p *model.Post) error {
	const query = `
		UPDATE posts
		SET title = ?, category = ?, location = ?, happened_at = ?, description = ?, images = ?
		WHERE id = ?`

	_, err := s.db.ExecContext(ctx, query,
		p.Title, p.Category, p.Location, p.HappenedAt, p.Description, p.Images, p.ID,
	)
	if err != nil {
		return fmt.Errorf("更新帖子失败: %w", err)
	}
	return nil
}

// Delete 删除帖子。
//
// posts 上挂着的 claims 由外键 fk_claims_post 的 ON DELETE CASCADE 自动清理，
// 这里**不需要**（也不应该）手写删 claims 的语句 —— 应用层多写一句
// 就多一处可能与数据库约束不一致的地方。
func (s *PostStore) Delete(ctx context.Context, id int64) error {
	const query = `DELETE FROM posts WHERE id = ?`

	if _, err := s.db.ExecContext(ctx, query, id); err != nil {
		return fmt.Errorf("删除帖子失败: %w", err)
	}
	return nil
}

// ListFilter 是帖子列表的筛选条件。
//
// 零值即「不筛选」，因此空串与 0 都有明确含义，不需要额外的
// 「这个条件有没有传」标记 —— 条件归一化在 service 层完成
// （非法枚举会被清成零值，见 PostService.normalizeListFilter）。
type ListFilter struct {
	Type     string // 帖子类型：lost | found，空表示不筛选
	Status   string // 帖子状态：open | matched | closed，空表示不筛选
	Category string // 分类，空表示不筛选
	Keyword  string // 关键字，同时匹配 title 与 description，空表示不筛选
	UserID   int64  // >0 时按作者过滤（「我的帖子」用）
}

// buildPostWhere 依据筛选条件构造 WHERE 子句与参数切片。
//
// 这是本文件里最要紧的一个函数：List 与 Count **必须**复用它。
// 若两处各拼一套条件，total 取自 A、list 取自 B，前端就会看到
// 「翻到第 3 页突然空了，但 total 还显示有 200 条」——
// 这是列表类接口最经典也最难自查的 bug。
//
// 安全边界（SPEC 10）：拼进 SQL 的只有**硬编码的固定片段**
// （" AND p.type = ?" 这类常量），用户输入一律走 ? 占位符。
// 绝不允许出现 " AND p.title LIKE '%" + kw + "%'" 这种写法。
func buildPostWhere(f ListFilter) (string, []any) {
	where := "WHERE 1 = 1"
	args := make([]any, 0, 6)

	if f.Type != "" {
		where += " AND p.type = ?"
		args = append(args, f.Type)
	}
	if f.Status != "" {
		where += " AND p.status = ?"
		args = append(args, f.Status)
	}
	if f.Category != "" {
		where += " AND p.category = ?"
		args = append(args, f.Category)
	}
	if f.Keyword != "" {
		// 用 "title OR description" 而不是只搜 title：用户搜「校园卡」时
		// 标题写「黑色卡套」、特征写在描述里的帖子同样应当命中。
		//
		// 参数传 "%" + kw + "%" 而不是写成 CONCAT('%', ?, '%')：
		// 后者把拼接动作推给数据库，前者让「参数就是纯数据」一目了然。
		// MySQL 在 utf8mb4_unicode_ci 下 LIKE 不区分大小写，符合预期，
		// 因此**不要**再加 LOWER() —— 那会让 title/description 上的索引失效。
		where += " AND (p.title LIKE ? OR p.description LIKE ?)"
		kw := "%" + f.Keyword + "%"
		args = append(args, kw, kw)
	}
	if f.UserID > 0 {
		where += " AND p.user_id = ?"
		args = append(args, f.UserID)
	}

	return where, args
}

// List 按筛选条件分页查询帖子。
//
// 不含 author_contact：列表接口一律不外带联系方式（见 postSelectColumns），
// 但 contact_visible 仍按规则计算，前端据此决定卡片上显示「登录后可见」
// 还是真实联系方式。viewerID 因此必须传进来 —— 它是那条规则的输入之一，
// 传 0（游客）会让所有联系方式的可见性判定退化成 false。
//
// ORDER BY 追加 p.id DESC 是为了**稳定排序**：created_at 列精度到秒，
// 同一秒内创建的两条帖子若只按时间排序，MySQL 不保证两次查询的相对
// 顺序一致，分页时就会表现为「第 1 页与第 2 页同时出现某条，另一条
// 永远看不到」。加主键做次级排序键，顺序才是全局确定的。
func (s *PostStore) List(ctx context.Context, f ListFilter, viewerID int64, limit, offset int) ([]model.Post, error) {
	where, whereArgs := buildPostWhere(f)

	query := `SELECT` + postSelectColumns(false, viewerID) + postFromClause + `
	` + where + `
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT ? OFFSET ?`

	// 三段参数的拼接顺序必须与 SQL 文本中 ? 出现的先后完全一致：
	// SELECT 列清单 → WHERE → LIMIT/OFFSET。
	args := postSelectArgs(viewerID, false)
	args = append(args, whereArgs...)
	args = append(args, limit, offset)

	rows := make([]model.Post, 0, limit)
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("查询帖子列表失败: %w", err)
	}
	return rows, nil
}

// Count 返回满足筛选条件的帖子总数，与 List 共用 buildPostWhere。
//
// JOIN users 不会影响计数：posts.user_id 有外键指向 users.id，
// INNER JOIN 既不会丢行也不会放大行数。
//
// ⚠️ 本方法不接收 viewerID，也**不能**改成用 postSelectColumns：
// 计数只关心 WHERE 命中的行数，SELECT 列表里的联系方式相关列
// （以及它们带来的 ? 参数）在这里既不参与语义，还会平白多扫一遍 claims。
// List 与 Count 的口径一致性只依赖于两者共用 buildPostWhere，
// 与 SELECT 列表无关。
func (s *PostStore) Count(ctx context.Context, f ListFilter) (int64, error) {
	where, args := buildPostWhere(f)

	query := `SELECT COUNT(*)` + postFromClause + `
	` + where

	var total int64
	if err := s.db.GetContext(ctx, &total, query, args...); err != nil {
		return 0, fmt.Errorf("统计帖子总数失败: %w", err)
	}
	return total, nil
}

// ListByUser 分页查询某个用户的帖子，供「我的帖子」接口使用。
//
// 单独成方法而不是让调用方自己填 ListFilter.UserID：user_id 在这里被
// 固定住，调用方就没有「忘记带上 user_id、把全站帖子当成我的」的机会。
// 计数仍走 Count(ListFilter{UserID, Status})，两者条件由同一个
// buildPostWhere 产出，口径一致。
func (s *PostStore) ListByUser(ctx context.Context, userID int64, status string, viewerID int64, limit, offset int) ([]model.Post, error) {
	return s.List(ctx, ListFilter{UserID: userID, Status: status}, viewerID, limit, offset)
}

// ListMatchCandidates 查询参与 AI 匹配打分的候选帖子（SPEC 7.4 / 07 第二部分）。
//
// 筛选条件全部由本方法固定，不接受调用方拼装：
//
//	type = ?        → 只取类型相反的帖子（lost 找 found，found 找 lost）
//	status = 'open' → 已结束的帖子不可能再被认领，没有匹配价值
//	id <> ?         → 排除自己（否则一张帖子会「匹配」到自己，score 100）
//
// 走 idx_type_status(type, status) 复合索引，不会全表扫。
//
// LIMIT 200 是**兜底而非分页**：打分的成本是 O(候选数 × 字段数 × gram 数)，
// 在内存里做。没有上限的话，一个热门分类下的几千条 open 帖子会让
// 单次请求变成一个可被放大的 CPU 消耗点。
// 200 条 × 4 个维度的量级在毫秒内，同时对「最近发布的帖子优先」
// 这一直觉也友好 —— ORDER BY created_at DESC 保证被截掉的是最老的帖子。
//
// 不含 author_contact（postSelectColumns(false, ...)）：匹配区块只是
// 「看看有没有可能是我的东西」，不需要、也不应该顺带把别人的联系方式带出来。
func (s *PostStore) ListMatchCandidates(
	ctx context.Context, excludeID int64, oppositeType string, viewerID int64, limit int,
) ([]model.Post, error) {
	query := `SELECT` + postSelectColumns(false, viewerID) + postFromClause + `
		WHERE p.type = ? AND p.status = 'open' AND p.id <> ?
		ORDER BY p.created_at DESC
		LIMIT ?`

	args := postSelectArgs(viewerID, false)
	args = append(args, oppositeType, excludeID, limit)

	rows := make([]model.Post, 0, limit)
	if err := s.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("查询匹配候选失败: %w", err)
	}
	return rows, nil
}

// UpdateStatus 以乐观锁方式更新帖子状态，返回受影响行数。
//
// `AND status = ?` 是乐观锁的关键：两个并发请求同时把 open 改成
// matched 与 closed 时，后到的那个会因为 status 已不是 open 而更新 0 行，
// 从而被上层识别为「状态已被他人改变」并返回 1007。
// 只写 WHERE id = ? 的话两个请求都会成功，后一次静默覆盖前一次的结果。
//
// now 由调用方传入而不是用 SQL 的 NOW()：MySQL 的 NOW() 返回会话时区
// （本机默认 SYSTEM，即 +08:00）下的本地时间，写进 DATETIME 列后会被 Go
// 按 DSN 里的 loc=UTC 解析，凭空差出 8 小时。时间只从一处产生（Go 侧 UTC），
// 整条链路才不漂。
//
// 返回 (RowsAffected, error) 而不是只返回 error：行数为 0 有「帖子不存在」
// 与「状态已被改」两种可能，两者该映射成哪个错误码属于业务语义，
// 交由 service 结合已查出的帖子判断，store 不越权下结论。
func (s *PostStore) UpdateStatus(ctx context.Context, postID int64, from, to string, now time.Time) (int64, error) {
	return s.updateStatus(ctx, s.db, postID, from, to, now)
}

// UpdateStatusWith 是 UpdateStatus 的「句柄由调用方指定」版本。
//
// 用途：P6 的「审核通过 → 帖子自动置 matched」「核销 → 帖子自动置 closed」
// 必须与 claims 的更新在**同一个事务**里提交。若这里改走连接池，
// 会出现两种脏状态：claims 写成功了但帖子没改（认领通过了帖子还在招领），
// 或者反过来。这些状态对用户是可见的，且无法自动修复。
func (s *PostStore) UpdateStatusWith(ctx context.Context, q Querier, postID int64, from, to string, now time.Time) (int64, error) {
	return s.updateStatus(ctx, q, postID, from, to, now)
}

// updateStatus 是 UpdateStatus / UpdateStatusTx 共用的实现。
func (s *PostStore) updateStatus(ctx context.Context, q Querier, postID int64, from, to string, now time.Time) (int64, error) {
	const query = `
		UPDATE posts
		SET status = ?, updated_at = ?
		WHERE id = ? AND status = ?`

	res, err := q.ExecContext(ctx, query, to, now, postID, from)
	if err != nil {
		return 0, fmt.Errorf("更新帖子状态失败: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("读取状态更新影响行数失败: %w", err)
	}
	return n, nil
}

// Exists 判断帖子是否存在。
//
// 返回 bool 而非 error 是刻意的：调用方（如详情接口）需要区分
// 「帖子不存在」与「查询本身失败」两种截然不同的响应，
// 用 error 表达存在性会让这两者混在一起。
func (s *PostStore) Exists(ctx context.Context, id int64) (bool, error) {
	const query = `SELECT EXISTS(SELECT 1 FROM posts WHERE id = ?)`

	var exists bool
	if err := s.db.GetContext(ctx, &exists, query, id); err != nil {
		return false, fmt.Errorf("检查帖子是否存在失败: %w", err)
	}
	return exists, nil
}
