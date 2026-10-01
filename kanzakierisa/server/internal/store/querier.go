package store

import (
	"context"
	"database/sql"
)

// Querier 抽象「能执行 SQL 并扫描结果」的最小数据库句柄。
//
// 存在的唯一理由：P6 的认领审核必须在一个事务里完成「锁行 → 校验 →
// 写 claims → 联动改 posts」，而 *sqlx.DB 与 *sqlx.Tx 是两个不同的具体类型。
// 若不抽象，同一段 SQL 就得为「带事务」和「不带事务」各写一遍 ——
// 两份 SQL 一旦漂移，事务内的写入路径就会和常规路径产生不同的行为，
// 而这种差异在测试里几乎不可能被察觉。
//
// 接口只列本包真正用到的三个方法，不嵌入 sqlx.ExtContext：
// 后者还需要 binder 这类与本项目无关的能力，接口越窄越难被误实现。
//
// 导出的原因：service 层需要把「这一次调用到底在不在事务里」透传给 store
// （见 PostStore.Handle），若接口不导出，service 就无法持有这个类型。
type Querier interface {
	// GetContext 执行查询并把单行扫描到 dest。
	GetContext(ctx context.Context, dest any, query string, args ...any) error
	// SelectContext 执行查询并把多行扫描到 dest（必须是切片）。
	SelectContext(ctx context.Context, dest any, query string, args ...any) error
	// ExecContext 执行写语句并返回结果。
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
