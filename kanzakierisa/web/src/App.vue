<script setup>
/**
 * 应用根组件：路由出口 + 底部 TabBar。
 *
 * TabBar 的显示与否完全由路由 meta 驱动（tabbar / hideTabbar），
 * 这样页面自己不需要关心「我在不在二级页」这件事。
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 只有首页与「我的」显示 TabBar；详情 / 发布 / 编辑等二级页隐藏
const showTabbar = computed(() => route.meta.tabbar === true)

// 当前高亮的 Tab：0 首页 / 1 发布 / 2 我的
// 「发布」是动作型入口，不常驻高亮，所以不在这里返回 1
const activeTab = computed(() => (route.path === '/me' ? 2 : 0))

/**
 * Tab 切换。这里没有用 van-tabbar 的 `route` 模式，
 * 因为「发布」需要先做登录判断，必须自己接管导航。
 */
function onTabChange(index) {
  if (index === 0) {
    router.push('/')
  } else if (index === 1) {
    // 未登录点「发布」→ 先登录，登录成功后靠 redirect 回到发布页
    if (!userStore.isLogin) {
      router.push({ path: '/login', query: { redirect: '/publish' } })
    } else {
      router.push('/publish')
    }
  } else {
    router.push('/me')
  }
}

onMounted(() => {
  // 带着 token 重新进入应用时刷新一次用户信息。
  // 失败静默：token 过期的情况由 axios 响应拦截器统一踢回登录页。
  if (userStore.isLogin) {
    userStore.fetchMe().catch(() => {})
  }
})
</script>

<template>
  <div class="app-shell">
    <router-view />

    <van-tabbar
      v-if="showTabbar"
      :model-value="activeTab"
      fixed
      placeholder
      @change="onTabChange"
    >
      <van-tabbar-item icon="wap-home-o">首页</van-tabbar-item>
      <van-tabbar-item icon="add-o">发布</van-tabbar-item>
      <van-tabbar-item icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
</style>
