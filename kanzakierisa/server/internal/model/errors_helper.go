package model

import (
	"errors"

	"github.com/go-sql-driver/mysql"
)

// MySQL 唯一键冲突的错误号。
//
// 驱动在 server error 时返回 *mysql.MySQLError，ErrorNumber 即服务端 errno；
// 1062 = ER_DUP_ENTRY。
const mysqlErrDuplicateEntry = 1062

// users 表上的唯一索引名（见 sql/schema.sql）。
const (
	// IndexUsersUsername 对应 uk_username。
	IndexUsersUsername = "uk_username"
)

// IsDuplicateEntry 判断 error 是否为 MySQL 唯一键冲突（errno 1062）。
//
// 用途：store 层不用先 SELECT 再 INSERT 的方式预检重名 ——
// 那种做法在并发下有 TOCTOU 竞态，两个请求可能同时通过预检。
// 正确姿势是直接 INSERT 并捕获 1062，让数据库的唯一索引做最终裁决。
func IsDuplicateEntry(err error) bool {
	var myErr *mysql.MySQLError
	if !errors.As(err, &myErr) {
		return false
	}
	return myErr.Number == mysqlErrDuplicateEntry
}

// IsDuplicateEntryOn 判断 error 是否为**指定索引**上的唯一键冲突。
//
// 为什么需要这个：一个 UPDATE / INSERT 可能命中多个唯一索引，
// 仅凭 errno=1062 无法区分冲突的是 uk_username 还是别处的索引，
// 会导致「昵称重复」被误报成「用户名已被占用」。
// MySQL 1062 的 Message 形如：
//
//	Duplicate entry 'alice' for key 'users.uk_username'
//
// 这里用索引名做后缀匹配，命中才是真正的目标冲突。
func IsDuplicateEntryOn(err error, indexName string) bool {
	if !IsDuplicateEntry(err) {
		return false
	}
	var myErr *mysql.MySQLError
	if !errors.As(err, &myErr) {
		return false
	}
	return hasIndexSuffix(myErr.Message, indexName)
}

// hasIndexSuffix 判断 MySQL 报错信息里是否提到了指定索引名。
//
// 兼容两种写法：'users.uk_username'（MySQL 8.0.19+）与 'uk_username'（更早版本），
// 因此不要求索引名前必须是点号，只要出现即算命中。
func hasIndexSuffix(message, indexName string) bool {
	if indexName == "" {
		return false
	}
	needle := indexName
	// 逐字符扫描，避免为一次判断引入 strings 之外的开销；同时天然支持前缀含点号的情况。
	return contains(message, needle)
}

// contains 是 strings.Contains 的本地实现，用来让本文件只依赖 errors 与驱动包。
func contains(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	if len(needle) > len(haystack) {
		return false
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
