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

// contactCaseSQL 在 **SQL 层**决定是否把 u.contact 带进结果集（SPEC 7.2 硬要求）。
//
// SPEC 7.2 明确要求「在 SQL 层决定是否 SELECT contact，不要查出来再在内存里删」。
// 这里把可见性判断写进 SELECT 列表：不可见的行直接返回空串，
// 真实联系方式根本不会离开数据库、更不会进入应用内存。
//
// 两个 ? 都是 viewerID：
//   - 第一个用于「请求者就是作者本人」；
//   - 第二个用于「作者已主动公开（且请求者是登录用户）」。
//
// ⚠️ 参数顺序敏感：本片段出现在 WHERE 之前，因此追加参数时必须
// 先 append contactCaseArgs(viewerID)，再 append WHERE 的参数。
//
// 待补：SPEC 7.2 规则 4「双方存在已通过的认领关系」需要 EXISTS(claims ...)，
// 属于 P6 认领模块；届时在此 CASE 中追加一个分支即可，对外语义不变。
const contactCaseSQL = `,
	CASE
		WHEN u.id = ? THEN u.contact
		WHEN u.contact_public = 1 AND ? > 0 THEN u.contact
		ELSE ''
	END AS author_contact`

// contactCaseArgs 返回 contactCaseSQL 所需的参数（viewerID 需重复一次）。
func contactCaseArgs(viewerID int64) []any {
	return []any{viewerID, viewerID}
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
// author_contact_public 则始终带出 —— 它是可见性判定的输入（用来算
// contact_visible），本身不是敏感值。
func postSelectColumns(withContact bool) string {
	cols := `
	p.id, p.user_id, p.type, p.title, p.category, p.location, p.happened_at,
	p.description, p.images, p.status, p.created_at, p.updated_at,
	u.id AS author_id, u.nickname AS author_nickname,
	u.contact_public AS author_contact_public`
	if withContact {
		cols += contactCaseSQL
	}
	return cols
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

// GetByID 按主键查询帖子，并联表带出作者昵称与联系方式。
//
// viewerID 决定 author_contact 是否真实带出（SPEC 7.2 的 SQL 层判定）：
// 传 0 表示游客或「本次流程不关心联系方式」，此时该列恒为空串。
// 只做权限 / 状态判断的调用方（更新、删除、状态流转）传 0 即可。
//
// 帖子不存在时返回 apperr 1004，不把 sql.ErrNoRows 漏给上层。
func (s *PostStore) GetByID(ctx context.Context, id int64, viewerID int64) (*model.Post, error) {
	query := `SELECT` + postSelectColumns(true) + postFromClause + `
		WHERE p.id = ?`

	// SELECT 列表里的 ? 先于 WHERE 的 ?，参数顺序必须对应。
	args := append(contactCaseArgs(viewerID), id)

	var p model.Post
	if err := s.db.GetContext(ctx, &p, query, args...); err != nil {
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
// 还是真实联系方式。
//
// ORDER BY 追加 p.id DESC 是为了**稳定排序**：created_at 列精度到秒，
// 同一秒内创建的两条帖子若只按时间排序，MySQL 不保证两次查询的相对
// 顺序一致，分页时就会表现为「第 1 页与第 2 页同时出现某条，另一条
// 永远看不到」。加主键做次级排序键，顺序才是全局确定的。
func (s *PostStore) List(ctx context.Context, f ListFilter, limit, offset int) ([]model.Post, error) {
	where, args := buildPostWhere(f)

	query := `SELECT` + postSelectColumns(false) + postFromClause + `
	` + where + `
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT ? OFFSET ?`

	// LIMIT 在前、OFFSET 在后，与 SQL 文本里占位符出现的先后严格一致。
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
func (s *PostStore) ListByUser(ctx context.Context, userID int64, status string, limit, offset int) ([]model.Post, error) {
	return s.List(ctx, ListFilter{UserID: userID, Status: status}, limit, offset)
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
	const query = `
		UPDATE posts
		SET status = ?, updated_at = ?
		WHERE id = ? AND status = ?`

	res, err := s.db.ExecContext(ctx, query, to, now, postID, from)
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
