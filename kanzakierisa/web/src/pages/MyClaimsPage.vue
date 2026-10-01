<script setup>
/**
 * P4 占位页 —— 我发出的认领。
 *
 * 真实实现在 P6（认领审核流）。
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
    <van-nav-bar title="我的认领" left-arrow fixed placeholder @click-left="goBack" />
    <van-empty description="认领记录将在 P6 阶段实现">
      <van-button round type="primary" size="small" @click="router.replace('/')">
        回到首页
      </van-button>
    </van-empty>
  </div>
</template>
