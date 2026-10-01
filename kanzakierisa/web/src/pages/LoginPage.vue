<script setup>
/**
 * 登录 / 注册页（Tab 切换）。
 *
 * 设计取舍：
 * - 注册成功**不自动登录**，而是切回登录 Tab 并预填用户名。
 *   这样用户对"我刚设的密码"印象最深，立刻输一次的成功率最高，
 *   也避免注册接口额外承担签发 token 的职责。
 * - 错误提示全部交给 axios 拦截器统一处理，页面层不重复弹 Toast，
 *   只负责收起 loading。
 */
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { closeToast, showLoadingToast, showSuccessToast } from 'vant'

import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 0 = 登录，1 = 注册
const active = ref(0)
const submitting = ref(false)

const loginForm = reactive({ username: '', password: '' })
const registerForm = reactive({
  username: '',
  nickname: '',
  password: '',
  confirmPassword: '',
})

const usernameRule = {
  pattern: /^[A-Za-z0-9_]{3,32}$/,
  message: '用户名为 3–32 位字母、数字或下划线',
}

const loginRules = {
  username: [{ required: true, message: '请输入用户名' }, usernameRule],
  password: [
    { required: true, message: '请输入密码' },
    { pattern: /^.{6,64}$/, message: '密码长度为 6–64 位' },
  ],
}

const registerRules = {
  username: [{ required: true, message: '请输入用户名' }, usernameRule],
  nickname: [{ pattern: /^.{0,32}$/, message: '昵称最多 32 个字' }],
  password: [
    { required: true, message: '请输入密码' },
    { pattern: /^.{6,64}$/, message: '密码长度为 6–64 位' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码' },
    {
      // 自定义校验：两次输入必须一致
      validator: (val) => val === registerForm.password,
      message: '两次输入的密码不一致',
    },
  ],
}

/** 登录成功后的回跳地址，只接受站内绝对路径，避免开放重定向 */
function resolveRedirect() {
  const raw = route.query.redirect
  const path = typeof raw === 'string' ? raw : ''
  return path.startsWith('/') ? path : '/'
}

async function onLogin() {
  if (submitting.value) return
  submitting.value = true
  showLoadingToast({ message: '登录中…', forbidClick: true, duration: 0 })
  try {
    await userStore.login({
      username: loginForm.username.trim(),
      password: loginForm.password,
    })
    closeToast()
    showSuccessToast('登录成功')
    router.replace(resolveRedirect())
  } catch {
    // 拦截器已弹过对应错误，这里只收起 loading
    closeToast()
  } finally {
    submitting.value = false
  }
}

async function onRegister() {
  if (submitting.value) return
  submitting.value = true
  showLoadingToast({ message: '注册中…', forbidClick: true, duration: 0 })
  try {
    const username = registerForm.username.trim()
    await userStore.register({
      username,
      password: registerForm.password,
      nickname: registerForm.nickname.trim(),
    })
    closeToast()
    showSuccessToast('注册成功，请登录')

    // 切回登录 Tab 并预填用户名，把用户下一步要做的动作铺平
    loginForm.username = username
    loginForm.password = ''
    registerForm.password = ''
    registerForm.confirmPassword = ''
    active.value = 0
  } catch {
    closeToast()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <header class="login-page__hero">
      <div class="login-page__logo">
        <van-icon name="search" size="26" color="#fff" />
      </div>
      <h1 class="login-page__title">校园失物招领</h1>
      <p class="login-page__slogan">丢了东西发一条，捡到东西发一条</p>
    </header>

    <van-tabs v-model:active="active" class="login-page__tabs" animated>
      <van-tab title="登录">
        <van-form @submit="onLogin">
          <van-cell-group inset>
            <van-field
              v-model="loginForm.username"
              name="username"
              label="用户名"
              placeholder="请输入用户名"
              autocomplete="username"
              :rules="loginRules.username"
            />
            <van-field
              v-model="loginForm.password"
              type="password"
              name="password"
              label="密码"
              placeholder="请输入密码"
              autocomplete="current-password"
              :rules="loginRules.password"
            />
          </van-cell-group>
          <div class="login-page__submit">
            <van-button
              round
              block
              type="primary"
              native-type="submit"
              :loading="submitting"
              loading-text="请稍候…"
            >
              登录
            </van-button>
          </div>
        </van-form>
      </van-tab>

      <van-tab title="注册">
        <van-form @submit="onRegister">
          <van-cell-group inset>
            <van-field
              v-model="registerForm.username"
              name="username"
              label="用户名"
              placeholder="3–32 位字母、数字或下划线"
              autocomplete="username"
              :rules="registerRules.username"
            />
            <van-field
              v-model="registerForm.nickname"
              name="nickname"
              label="昵称"
              placeholder="选填，展示在帖子上"
              :rules="registerRules.nickname"
            />
            <van-field
              v-model="registerForm.password"
              type="password"
              name="password"
              label="密码"
              placeholder="6–64 位"
              autocomplete="new-password"
              :rules="registerRules.password"
            />
            <van-field
              v-model="registerForm.confirmPassword"
              type="password"
              name="confirmPassword"
              label="确认密码"
              placeholder="请再次输入密码"
              autocomplete="new-password"
              :rules="registerRules.confirmPassword"
            />
          </van-cell-group>
          <div class="login-page__submit">
            <van-button
              round
              block
              type="primary"
              native-type="submit"
              :loading="submitting"
              loading-text="请稍候…"
            >
              注册
            </van-button>
          </div>
        </van-form>
      </van-tab>
    </van-tabs>

    <p class="login-page__tip">登录后即可发布帖子、认领失物</p>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  padding-bottom: 32px;
}

.login-page__hero {
  padding: 48px 24px 28px;
  text-align: center;
}

.login-page__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #1989fa, #0570db);
  box-shadow: 0 6px 16px rgba(25, 137, 250, 0.28);
}

.login-page__title {
  margin: 14px 0 6px;
  font-size: 22px;
  font-weight: 600;
  color: #323233;
}

.login-page__slogan {
  margin: 0;
  font-size: 13px;
  color: #969799;
}

.login-page__tabs {
  margin-top: 4px;
}

.login-page__submit {
  padding: 20px 16px 0;
}

.login-page__tip {
  margin: 20px 0 0;
  text-align: center;
  font-size: 12px;
  color: #c8c9cc;
}
</style>
