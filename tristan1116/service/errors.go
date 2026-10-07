package service

import "errors"

// 业务错误（"哨兵错误"）：service 层把各种异常情况归纳成这几个固定错误值
// controller 用 errors.Is(err, service.ErrXxx) 判断类型，再翻译成对应的错误码
// 这是 Go 的风格：错误是"值"，用比较来判断，而不是像其他语言的 try/catch
var (
	ErrUsernameTaken    = errors.New("用户名已被注册")
	ErrWrongCredentials = errors.New("用户名或密码错误")
	ErrItemNotFound     = errors.New("信息不存在")
	ErrNotOwner         = errors.New("只能操作自己发布的信息")
	ErrStatusBackward   = errors.New("状态只能前进，不能回退")
	ErrBadTime          = errors.New("时间格式不正确")
)
