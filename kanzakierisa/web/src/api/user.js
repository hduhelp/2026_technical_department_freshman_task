/**
 * 用户相关接口。
 *
 * 对应后端 `internal/handler/user_handler.go`。
 */
import request from './request'

/** 当前登录用户信息 */
export const me = () => request.get('/users/me')

/**
 * 修改个人资料。
 * 只允许 nickname / contact / contact_public 三个字段，后端会拒绝其余字段。
 */
export const updateMe = (data) => request.patch('/users/me', data)
