<script setup>
/**
 * P4 占位页 —— 认领管理（帖主审核入口）。
 *
 * 真实实现在 P6（审核通过 / 驳回 / 凭证码核销）。
 */
import { useRouter } from 'vue-router'

const router = useRouter()

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace('/')
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="认领管理" left-arrow fixed placeholder @click-left="goBack" />
    <van-empty description="认领管理将在 P6 阶段实现">
      <van-button round type="primary" size="small" @click="router.replace('/')">
        回到首页
      </van-button>
    </van-empty>
  </div>
</template>
