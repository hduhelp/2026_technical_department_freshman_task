/**
 * 当前登录用户状态。
 *
 * 设计取舍：
 * - `token` 落 localStorage，刷新页面仍保持登录；`user` 不落盘，每次进应用用
 *   `fetchMe()` 从后端拉一次，保证昵称 / 联系方式改了之后立刻生效，也不会出现
 *   「本地缓存的用户数据比后端新」的脏读。
 * - `isLogin` 以 token 为准，而不是以 user 为准 —— 因为 user 是异步补上的。
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

import * as authApi from '@/api/auth'
import * as userApi from '@/api/user'

const TOKEN_KEY = 'token'

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref(null)

  const isLogin = computed(() => !!token.value)

  /** 写入 token 并持久化（登录成功、刷新 token 时用） */
  function setToken(t) {
    token.value = t
    localStorage.setItem(TOKEN_KEY, t)
  }

  /** 清空登录态：内存与 localStorage 同步清理，避免只清一半导致守卫误判 */
  function clear() {
    token.value = ''
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  /** 登录：拿到 token 后顺便把 user 填上，省掉一次 /users/me 往返 */
  async function login(payload) {
    const data = await authApi.login(payload)
    setToken(data.token)
    user.value = data.user
    return data.user
  }

  /** 注册：仅注册，不自动登录（SPEC 要求注册后回登录 Tab 手动登录） */
  async function register(payload) {
    return authApi.register(payload)
  }

  /** 拉取当前用户。未登录直接跳过，避免无意义的 401。 */
  async function fetchMe() {
    if (!token.value) return null
    user.value = await userApi.me()
    return user.value
  }

  /** 退出登录：后端无状态，即使请求失败也必须清干净本地状态 */
  async function logout() {
    try {
      await authApi.logout()
    } catch {
      // 忽略：后端登出是幂等的，失败不该阻塞用户退出
    }
    clear()
  }

  // 刻意不导出 `token` / `setToken`：全项目无人引用，登录态一律走 login / logout。
  // 暴露 setToken 只会多出一条「绕开 login 直接塞 token、user 却没填」的歪路。
  return { user, isLogin, clear, login, register, fetchMe, logout }
})
