// Package apperr 定义全局业务错误类型与错误码表。
//
// 设计要点：handler / service / store 三层统一返回 *Error，
// 由 handler 层的 response.Fail 集中翻译成 HTTP 响应
// （它内部走 FromError：业务错误原样透出，其余收敛为 5000），
// 业务代码里不再散落 c.JSON(...) 拼错误结构。
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// 业务错误码。与 SPEC 第 8.2 节错误码表一一对应，不得随意增删改。
const (
	CodeOK              = 0    // 成功
	CodeInvalidParam    = 1001 // 参数错误：校验失败、分页越界、枚举非法
	CodeUnauthorized    = 1002 // 未登录或凭证失效：缺 token / 验签失败 / 过期
	CodeForbidden       = 1003 // 无权限：改别人的帖子、非帖主审核
	CodeNotFound        = 1004 // 资源不存在：帖子 / 认领不存在
	CodeUsernameTaken   = 1005 // 用户名已被占用
	CodeBadCredentials  = 1006 // 用户名或密码错误（不区分二者，防枚举）
	CodeInvalidStatus   = 1007 // 状态流转非法：违反状态机白名单
	CodeClaimExists     = 1008 // 已提交过认领申请
	CodeInvalidUpload   = 1009 // 上传文件不合法：类型非 jpg/png 或超过体积上限
	CodeClaimApproved   = 1010 // 该帖子已有通过的认领
	CodeVoucherMismatch = 1011 // 凭证码错误
	CodeInternal        = 5000 // 服务器内部错误
)

// 各错误码对应的 HTTP 状态码。
var httpStatus = map[int]int{
	CodeOK:              http.StatusOK,
	CodeInvalidParam:    http.StatusBadRequest,
	CodeUnauthorized:    http.StatusUnauthorized,
	CodeForbidden:       http.StatusForbidden,
	CodeNotFound:        http.StatusNotFound,
	CodeUsernameTaken:   http.StatusConflict,
	CodeBadCredentials:  http.StatusUnauthorized,
	CodeInvalidStatus:   http.StatusBadRequest,
	CodeClaimExists:     http.StatusConflict,
	CodeInvalidUpload:   http.StatusBadRequest,
	CodeClaimApproved:   http.StatusConflict,
	CodeVoucherMismatch: http.StatusBadRequest,
	CodeInternal:        http.StatusInternalServerError,
}

// 各错误码的默认文案。对外的 message 一律取这里，避免把内部细节泄露给前端。
var defaultMessage = map[int]string{
	CodeOK:              "ok",
	CodeInvalidParam:    "参数错误",
	CodeUnauthorized:    "未登录或登录已过期",
	CodeForbidden:       "无权限执行该操作",
	CodeNotFound:        "资源不存在",
	CodeUsernameTaken:   "用户名已被占用",
	CodeBadCredentials:  "用户名或密码错误",
	CodeInvalidStatus:   "状态流转非法",
	CodeClaimExists:     "你已提交过该帖子的认领申请",
	CodeInvalidUpload:   "上传文件不合法",
	CodeClaimApproved:   "该帖子已有通过的认领记录",
	CodeVoucherMismatch: "凭证码错误",
	CodeInternal:        "服务器内部错误",
}

// Error 是全局统一的业务错误类型。
//
// Code 为业务错误码；HTTPStatus 由 Code 推导（构造时已填好），
// Message 为可直接返回给前端的文案。
type Error struct {
	Code       int    // 业务错误码，见上方常量
	HTTPStatus int    // 对应的 HTTP 状态码
	Message    string // 面向用户的错误文案
	cause      error  // 内部原因，仅用于日志，绝不返回给前端
}

// Error 实现 error 接口。输出同时包含业务码与内部原因，便于日志排查。
func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("apperr[%d]: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("apperr[%d]: %s", e.Code, e.Message)
}

// Unwrap 支持 errors.Is / errors.As 穿透到底层原因。
func (e *Error) Unwrap() error { return e.cause }

// New 按错误码创建一个业务错误，文案取默认值。
func New(code int) *Error {
	status, ok := httpStatus[code]
	if !ok {
		status = http.StatusInternalServerError
	}
	msg, ok := defaultMessage[code]
	if !ok {
		msg = "未知错误"
	}
	return &Error{Code: code, HTTPStatus: status, Message: msg}
}

// Newf 按错误码创建业务错误，并用自定义文案覆盖默认值。
// 适用于需要补充具体字段名等上下文的场景，如 Newf(CodeInvalidParam, "title 长度不能超过 64")。
func Newf(code int, format string, args ...any) *Error {
	err := New(code)
	err.Message = fmt.Sprintf(format, args...)
	return err
}

// Wrap 在业务错误上附加内部原因（如底层 SQL 报错），原因只进日志不出响应。
func Wrap(code int, cause error) *Error {
	err := New(code)
	err.cause = cause
	return err
}

// Wrapf 在业务错误上同时附加内部原因与自定义对外文案。
func Wrapf(code int, cause error, format string, args ...any) *Error {
	err := Newf(code, format, args...)
	err.cause = cause
	return err
}

// As 从任意 error 中提取 *Error。若链路上没有业务错误，返回 nil 与 false。
func As(err error) (*Error, bool) {
	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr, true
	}
	return nil, false
}

// FromError 把任意 error 归一化为 *Error：业务错误原样返回，
// 其余（SQL 报错、序列化失败等）统一收敛为 5000，避免内部细节外泄。
func FromError(err error) *Error {
	if err == nil {
		return nil
	}
	if appErr, ok := As(err); ok {
		return appErr
	}
	return Wrap(CodeInternal, err)
}
