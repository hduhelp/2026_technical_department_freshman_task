package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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

// postSelectColumns 是帖子查询的显式列清单（含 JOIN users 带出的作者字段）。
//
// 抽成常量让「详情」与「列表」用同一份 SELECT 清单 —— 两处若各写一份，
// 迟早出现一边多查了 author_contact、另一边忘了加，导致同一张帖子
// 在两个接口下的联系方式可见性表现不一致。
const postSelectColumns = `
	p.id, p.user_id, p.type, p.title, p.category, p.location, p.happened_at,
	p.description, p.images, p.status, p.created_at, p.updated_at,
	u.id AS author_id, u.nickname AS author_nickname,
	u.contact AS author_contact, u.contact_public AS author_contact_public`

// postFromClause 是帖子查询固定的 FROM + JOIN 片段。
const postFromClause = `
	FROM posts p
	JOIN users u ON u.id = p.user_id`

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
// 帖子不存在时返回 apperr 1004，不把 sql.ErrNoRows 漏给上层。
//
// 注意：这里**总是**把 author_contact 查出来，是否对外暴露由 model.ToPostDTO
// 按 SPEC 7.2 的规则决定（SPEC 03 要点 3 明确 P2 先保证正确性，
// 下推到 SQL 层的优化留给 P3）。
func (s *PostStore) GetByID(ctx context.Context, id int64) (*model.Post, error) {
	query := `SELECT` + postSelectColumns + postFromClause + `
		WHERE p.id = ?`

	var p model.Post
	if err := s.db.GetContext(ctx, &p, query, id); err != nil {
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
