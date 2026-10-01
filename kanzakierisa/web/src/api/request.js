/**
 * axios 实例与双拦截器。
 *
 * 这里是全项目前后端的唯一咽喉：
 * - 请求侧统一注入 Bearer token；
 * - 响应侧统一解包 `{code, message, data}`，页面层拿到的**直接就是业务数据**，
 *   不再需要写 `res.data.data` 这种重复解包。
 */
import axios from 'axios'
import { showToast } from 'vant'
import router from '@/router'
import { useUserStore } from '@/store/user'

const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// ===== 请求拦截器：注入 token =====
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * 未登录 / 凭证失效的统一处理：清 token + 提示 + 踢回登录页。
 *
 * 抽成函数是因为它有**两个**触发入口（见下方两个分支）。
 */
function handleUnauthorized(message) {
  // ⚠️ useUserStore() 必须在函数体内调用。Pinia 尚未安装时在模块顶层调用会抛错。
  useUserStore().clear()

  // 已经在登录页就不再重复跳转，避免出现 /login?redirect=/login 这种自指参数
  if (router.currentRoute.value.path !== '/login') {
    showToast('登录已过期，请重新登录')
    router.replace({
      path: '/login',
      query: { redirect: router.currentRoute.value.fullPath },
    })
  }
  return Promise.reject(new Error(message || '登录已过期'))
}

// ===== 响应拦截器：解包 / 统一报错 =====
request.interceptors.response.use(
  (res) => {
    const { code, message, data } = res.data

    // 业务成功 —— 直接返回 data，页面层拿到的就是 {list, page, ...} 这种业务结构
    if (code === 0) return data

    if (code === 1002) return handleUnauthorized(message)

    // 其余业务错误码（1001/1003/1004/...）：统一吐 Toast 后 reject
    showToast(message || '操作失败')
    return Promise.reject(new Error(message))
  },
  (err) => {
    // ⚠️ 关键点：后端把业务错误码**同时**映射到了非 2xx 的 HTTP 状态
    // （1002 → 401、1003 → 403、1004 → 404、1005 → 409 …）。
    // 这类响应会被 axios 判定为失败，走的是这个分支，而不是上面的成功分支。
    // 因此必须先按统一响应体解出 code，否则 1002 会被笼统报成「网络异常」，
    // token 清不掉、也跳不回登录页（SPEC 05 验收第 19 条正是这一条）。
    const body = err.response?.data
    if (body && typeof body === 'object' && typeof body.code === 'number') {
      if (body.code === 1002) return handleUnauthorized(body.message)
      // 4xx 的业务错误：直接展示后端给的文案（如「用户名或密码错误」）
      showToast(body.message || '操作失败')
      return Promise.reject(new Error(body.message))
    }

    // 真正的基础设施层错误：5xx 与网络失败分开提示，不暴露后端细节
    const status = err.response?.status
    const msg = status >= 500 ? '服务器开小差了，请稍后重试' : '网络异常，请检查连接'
    showToast(msg)
    return Promise.reject(err)
  },
)

export default request
