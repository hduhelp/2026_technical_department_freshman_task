// Package service 承载业务规则。
//
// 分层职责（SPEC 3.3）：service 层不碰 HTTP（不知道 gin.Context、
// 不写状态码），也不写 SQL（只调用 store）。它只做「业务判断 + 编排」，
// 因此可以脱离 HTTP 与数据库被单元测试。
package service

import (
	"regexp"

	"hdu-lostfound/internal/pkg/apperr"
)

// usernamePattern 是用户名的合法字符集与长度约束（SPEC 02 第 5 节）。
//
// 只允许字母 / 数字 / 下划线，长度 3–32。
// 刻意不允许中文与空格：用户名是登录凭据，需要跨终端（含 URL、命令行）
// 无歧义地输入，中文会引入编码与全半角问题；展示名交给 nickname。
var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{3,32}$`)

// 口令长度约束（SPEC 02 第 5 节）。
const (
	minPasswordLen = 6  // 下界：6 位
	maxPasswordLen = 64 // 上界：64 位（bcrypt 72 字节截断，留出余量）
)

// 昵称 / 联系方式的长度上界，与 users 表的列宽一致。
const (
	maxNicknameLen = 32
	maxContactLen  = 64
)

// validateUsername 校验用户名格式，返回可直接透出的 1001 错误。
func validateUsername(username string) error {
	if !usernamePattern.MatchString(username) {
		return apperr.Newf(apperr.CodeInvalidParam,
			"用户名需为 3–32 位字母、数字或下划线")
	}
	return nil
}

// validatePassword 校验口令长度。
//
// 不限制字符集（允许特殊符号与空格），只卡长度 ——
// 强制复杂度规则反而会促使用户选择可预测的变形，长度是更有效的强度指标。
func validatePassword(password string) error {
	if len(password) < minPasswordLen || len(password) > maxPasswordLen {
		return apperr.Newf(apperr.CodeInvalidParam,
			"密码长度需为 6–64 位")
	}
	return nil
}
