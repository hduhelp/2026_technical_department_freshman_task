// Package store 承载全部 SQL 与数据库交互。
//
// 分层铁律（SPEC 3.3）：store 层**不允许出现 HTTP 概念** ——
// 这里没有 gin、没有 status code、没有 request/response，
// 只有 context、实体与 error。HTTP 语义由 handler 层负责翻译。
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

// UserStore 封装 users 表的读写。
//
// 只持有 *sqlx.DB，不持有事务 —— 单条用户操作无需事务，
// 需要事务的场景由 service 层显式传入 *sqlx.Tx（见 Execer 说明）。
type UserStore struct {
	db *sqlx.DB
}

// NewUserStore 创建用户仓储。
func NewUserStore(db *sqlx.DB) *UserStore {
	return &UserStore{db: db}
}

// userColumns 是 users 表的显式列清单。
//
// 刻意不用 SELECT *：列清单固定后，表结构增删列不会悄悄改变扫描行为，
// 也便于审计「哪些列被读出来了」（password_hash 只在此处按需读取）。
const userColumns = `
	id, username, password_hash, nickname, contact, contact_public, role, created_at, updated_at`

// Create 插入一条用户记录，并把自增主键回填到 u.ID。
//
// 入参 u 必须已填好 PasswordHash（哈希由 service 层生成，store 不碰明文口令）。
// 若命中 uk_username 唯一键冲突，返回 apperr 1005（用户名已被占用），
// 由 service / handler 直接透出给前端。
func (s *UserStore) Create(ctx context.Context, u *model.User) (int64, error) {
	const query = `
		INSERT INTO users (username, password_hash, nickname, contact, contact_public, role)
		VALUES (?, ?, ?, ?, ?, ?)`

	res, err := s.db.ExecContext(ctx, query,
		u.Username, u.PasswordHash, u.Nickname, u.Contact, u.ContactPublic, u.Role,
	)
	if err != nil {
		// 唯一索引是重名判定的最终裁决者：并发下两个请求可能同时通过预检，
		// 只有 INSERT 捕获 1062 才是可靠的（避免 TOCTOU 竞态）。
		if model.IsDuplicateEntryOn(err, model.IndexUsersUsername) {
			return 0, apperr.Wrap(apperr.CodeUsernameTaken, err)
		}
		return 0, fmt.Errorf("插入用户失败: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("读取新增用户 id 失败: %w", err)
	}
	return id, nil
}

// GetByID 按主键查询用户。
//
// 用户不存在时返回 apperr 1004（资源不存在），**不把 sql.ErrNoRows 漏给上层**
// —— SPEC 02 常见坑 4 明确要求 SQL 层错误在本层收口。
func (s *UserStore) GetByID(ctx context.Context, id int64) (*model.User, error) {
	query := `SELECT` + userColumns + ` FROM users WHERE id = ?`

	var u model.User
	if err := s.db.GetContext(ctx, &u, query, id); err != nil {
		return nil, translateUserError(err, "查询用户失败")
	}
	return &u, nil
}

// GetByUsername 按登录名查询用户。
//
// 用于登录链路。同样把「查无此人」翻译成 1004，
// 但登录场景下 service 层会把它与密码错误**统一折叠为 1006**，防止用户名枚举。
func (s *UserStore) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	query := `SELECT` + userColumns + ` FROM users WHERE username = ?`

	var u model.User
	if err := s.db.GetContext(ctx, &u, query, username); err != nil {
		return nil, translateUserError(err, "按用户名查询失败")
	}
	return &u, nil
}

// ExistsUsername 判断登录名是否已被占用。
//
// 仅用于「注册前给出更友好的提示」等非关键路径；
// 判重的**权威**手段仍是 Create 捕获 1062 —— 本方法存在 TOCTOU 窗口，
// 不能作为唯一防线。
func (s *UserStore) ExistsUsername(ctx context.Context, username string) (bool, error) {
	const query = `SELECT EXISTS(SELECT 1 FROM users WHERE username = ?)`

	var exists bool
	if err := s.db.GetContext(ctx, &exists, query, username); err != nil {
		return false, fmt.Errorf("检查用户名是否存在失败: %w", err)
	}
	return exists, nil
}

// UpdateProfile 更新用户的可变资料字段。
//
// ⚠️ 字段名是**固定的 SQL 片段**，绝不接受调用方传入的列名 ——
// 这是 SPEC 10「只允许拼接固定 SQL 片段，绝不允许拼接用户输入」的落地。
// 值一律走 ? 占位符。
//
// 注意：本方法**不校验受影响行数**。MySQL 的 RowsAffected 统计的是
// 「实际发生变化的行」，当新值与库中现有值完全相同时（例如 PATCH 请求体
// 只带了 role 这类非可变字段，等价于空更新），结果为 0 —— 但这属于
// 合法的成功场景，不能据此判定「用户不存在」。用户是否存在的判断
// 由调用方基于已查出的实体负责（handler 拿到的 User 本就来自数据库）。
func (s *UserStore) UpdateProfile(ctx context.Context, id int64, nickname, contact string, contactPublic bool) error {
	const query = `
		UPDATE users
		SET nickname = ?, contact = ?, contact_public = ?
		WHERE id = ?`

	if _, err := s.db.ExecContext(ctx, query, nickname, contact, contactPublic, id); err != nil {
		return fmt.Errorf("更新用户资料失败: %w", err)
	}
	return nil
}

// translateUserError 把 store 层的原始错误归一化。
//
// 职责单一：只做两件事 —— 把 sql.ErrNoRows 转成业务错误 1004，
// 其余错误包上操作上下文。业务错误（如 1005）由调用方自行构造，不经此处。
func translateUserError(err error, context string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return apperr.Wrap(apperr.CodeNotFound, err)
	}
	return fmt.Errorf("%s: %w", context, err)
}
