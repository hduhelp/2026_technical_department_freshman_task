import { reactive } from 'vue'

export const session = reactive({ user: null, checking: true, forced: false, notice: '' })
let csrf = ''
export class ApiError extends Error {
  constructor(body, status, retryAfter) {
    super(body.msg || '请求失败，请重试')
    this.code = body.code
    this.status = status
    this.fields = body.errors || []
    this.requestId = body.request_id
    this.retryAfter = Number(retryAfter) || 0
  }
}
export function query(values = {}) {
  return new URLSearchParams(Object.entries(values).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString()
}
export async function request(path, { method = 'GET', data, etag, key, signal } = {}) {
  const headers = {}
  if (method !== 'GET') {
    if (!csrf) csrf = (await request('/auth/csrf')).csrf_token
    headers['X-CSRF-Token'] = csrf
  }
  if (etag) headers['If-Match'] = etag
  if (key) headers['Idempotency-Key'] = key
  const multipart = data instanceof FormData
  if (data && !multipart) headers['Content-Type'] = 'application/json'
  let response
  try {
    response = await fetch('/api/v1' + path, { method, headers, credentials: 'same-origin', signal, body: data ? (multipart ? data : JSON.stringify(data)) : undefined })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('网络连接失败，已保留填写内容，请稍后重试。')
  }
  let body
  try { body = await response.json(); if (!body || typeof body !== 'object') throw new Error('invalid response') } catch { throw new Error('服务暂不可用，已保留填写内容，请稍后重试。') }
  if (!response.ok || body.code !== 1) {
    if (body.code === 'CSRF_INVALID') csrf = ''
    if (['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'TOKEN_REVOKED', 'ACCOUNT_DISABLED', 'IDENTITY_UNVERIFIED'].includes(body.code)) {
      session.user = null
      session.notice = body.msg
      csrf = ''
    }
    if (body.code === 'PASSWORD_CHANGE_REQUIRED') session.forced = true
    throw new ApiError(body, response.status, response.headers.get('Retry-After'))
  }
  if (body.data?.csrf_token) csrf = body.data.csrf_token
  return body.data
}
export async function restoreSession() {
  try { session.user = await request('/users/me') } catch { /* 登录页展示认证结果。 */ }
  finally { session.checking = false }
}
export async function login(account_no, password, admin = false) {
  const result = await request('/auth/tokens', { method: 'POST', data: { grant_type: 'password', client_type: admin ? 'admin_web' : 'web', account_no, password } })
  session.forced = result.user.must_change_password
  session.user = result.user
  session.notice = ''
  if (!session.forced) session.user = await request('/users/me')
}
export async function logout() {
  await request('/auth/tokens/current', { method: 'DELETE' })
  clearSession()
}
export function clearSession() { session.user = null; session.forced = false; csrf = '' }
export async function upload(file) {
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('请选择 JPEG 或 PNG 图片')
  if (file.size > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5 MB')
  const data = new FormData(); data.append('file', file)
  return request('/users/me/image-uploads', { method: 'POST', data })
}

export function imageURL(url,size){return url ? url+(url.includes('?')?'&':'?')+'size='+size : url}
