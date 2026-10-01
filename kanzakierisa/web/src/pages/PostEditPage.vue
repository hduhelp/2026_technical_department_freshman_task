<script setup>
/**
 * P4 占位页 —— 编辑帖子。
 *
 * 真实实现在 P5（复用 `PostForm.vue` 并接 `postApi.update`）。
 * P4 建此页是为了让详情页作者视角的「编辑」按钮有落点。
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
    <van-nav-bar title="编辑帖子" left-arrow fixed placeholder @click-left="goBack" />
    <van-empty description="编辑功能将在 P5 阶段实现">
      <van-button round type="primary" size="small" @click="router.replace('/')">
        回到首页
      </van-button>
    </van-empty>
  </div>
</template>
