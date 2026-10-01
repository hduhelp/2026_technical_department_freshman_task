<script setup>
/**
 * P4 占位页 —— 我的。
 *
 * 真实实现在 P5（用户卡片、我的帖子、编辑资料、退出登录）。
 * P4 建此页有两个必需理由：
 * 1. `/me` 带 `requiresAuth`，是验证「未登录访问受保护页会被守卫拦到
 *    `/login?redirect=/me`」这条验收项的必要条件；
 * 2. 它是底部 TabBar 的第三个 Tab，不注册路由的话 TabBar 点不通。
 */
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
</script>

<template>
  <div class="page">
    <van-nav-bar title="我的" />
    <van-empty description="个人中心将在 P5 阶段实现">
      <p class="me-page__who">
        当前已登录：{{ userStore.user?.nickname || userStore.user?.username || '—' }}
      </p>
    </van-empty>
  </div>
</template>

<style scoped>
.me-page__who {
  margin: 0;
  font-size: 13px;
  color: #969799;
}
</style>
