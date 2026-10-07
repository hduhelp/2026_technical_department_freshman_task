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
 * 只允许 nickname / contact / contact_public 三个字段。
 * 其余字段（role / username / password_hash）**不会报错**：UpdateMeReq 里没有对应
 * 键，JSON 解码阶段就被丢弃，响应仍是 `code=0`，只是原值不变（docs/api.md 5.3）。
 * 所以前端别指望靠「多传一个字段会失败」来兜底，该传什么就传什么。
 */
export const updateMe = (data) => request.patch('/users/me', data)
