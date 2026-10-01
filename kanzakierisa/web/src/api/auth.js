/**
 * 认证相关接口。
 *
 * 对应后端 `internal/handler/auth_handler.go`。
 */
import request from './request'

/**
 * 注册。
 * @param {{username: string, password: string, nickname?: string}} data
 */
export const register = (data) => request.post('/auth/register', data)

/**
 * 登录，返回 `{ token, user }`。
 * @param {{username: string, password: string}} data
 */
export const login = (data) => request.post('/auth/login', data)

/**
 * 登出。后端无状态，仅用于让前端有个统一的调用点位。
 */
export const logout = () => request.post('/auth/logout')
