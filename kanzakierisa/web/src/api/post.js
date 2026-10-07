/**
 * 帖子相关接口。
 *
 * 对应后端 `internal/handler/post_handler.go`。
 * 注意：`request` 的响应拦截器已经解包，这里返回的 Promise 直接就是业务数据。
 */
import request from './request'

/**
 * 帖子列表（公开接口，游客可用）。
 * @param {{type?: string, status?: string, category?: string, keyword?: string,
 *          page?: number, pageSize?: number}} params
 */
export const list = (params) => request.get('/posts', { params })

/** 帖子详情（软鉴权：带 token 时返回 can_edit / can_claim / 可见的联系方式） */
export const detail = (id) => request.get(`/posts/${id}`)

/** 发布帖子 */
export const create = (data) => request.post('/posts', data)

/** 编辑帖子（仅作者；不允许改 type 与 status） */
export const update = (id, data) => request.put(`/posts/${id}`, data)

/** 删除帖子（仅作者，级联删除其认领记录） */
export const remove = (id) => request.delete(`/posts/${id}`)

/**
 * 状态流转（仅作者，走后端 7.1 白名单）。
 * @param {number|string} id
 * @param {'matched'|'closed'} status
 */
export const changeStatus = (id, status) => request.patch(`/posts/${id}/status`, { status })

/** 我的帖子列表（user_id 由后端从 token 取，不接受前端传参） */
export const listMine = (params) => request.get('/users/me/posts', { params })
