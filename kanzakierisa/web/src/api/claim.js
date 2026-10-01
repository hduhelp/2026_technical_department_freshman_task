/**
 * 认领相关接口。
 *
 * 对应后端 `internal/handler/claim_handler.go`，契约见 SPEC 8.4 与 07 §5/§6。
 *
 * 两条容易踩的契约细节：
 * - `GET /posts/:id/claims` 在 SPEC 8.4 里是**仅帖主**（07 §5 括号里的「或 admin」
 *   与 SPEC 冲突，以 SPEC 为准），非帖主会拿到 1003，前端据此渲染空状态而不是报错。
 * - `voucher_code` 在本接口里对所有申请者可见（因为调用者就是帖主）；
 *   而 `GET /posts/:id` 的 `my_claim.voucher_code` 只对申请人本人可见。
 *
 * `request` 的响应拦截器已解包，返回的 Promise 直接是业务数据。
 */
import request from './request'

/**
 * 提交认领申请。
 * @param {number|string} postId
 * @param {{proof: string}} data proof 10–500 字
 */
export const apply = (postId, data) => request.post(`/posts/${postId}/claims`, data)

/**
 * 某帖的认领申请列表（仅帖主）。
 * @param {number|string} postId
 * @param {{page?: number, pageSize?: number}} params
 */
export const listByPost = (postId, params) => request.get(`/posts/${postId}/claims`, { params })

/** 我发出的认领（user_id 由后端从 token 取，不接受前端传参） */
export const listMine = (params) => request.get('/users/me/claims', { params })

/**
 * 审核（仅帖主，或 admin）。
 * @param {number|string} claimId
 * @param {{action: 'approve'|'reject', reject_reason?: string}} data
 */
export const review = (claimId, data) => request.patch(`/claims/${claimId}`, data)

/**
 * 核销（仅帖主）。凭证码由申请人线下出示、帖主输入。
 * @param {number|string} claimId
 * @param {{voucher_code: string}} data
 */
export const redeem = (claimId, data) => request.post(`/claims/${claimId}/redeem`, data)

/** 可能匹配（软鉴权，游客可用）。返回 `{list: MatchResult[]}` */
export const matches = (postId) => request.get(`/posts/${postId}/matches`)
