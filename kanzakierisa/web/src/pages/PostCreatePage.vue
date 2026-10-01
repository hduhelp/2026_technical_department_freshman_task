<script setup>
/**
 * P4 占位页 —— 发布帖子。
 *
 * 真实实现在 P5（`PostForm.vue` + 本页接 `postApi.create`）。
 * P4 先建这个文件是为了让 `/publish` 路由可解析：
 * 「底部 TabBar 的发布入口是否可用」是 P4 验收清单里的一条，
 * 而路由不存在的话根本走不到这一步。
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
    <van-nav-bar title="发布" left-arrow fixed placeholder @click-left="goBack" />
    <van-empty description="发布功能将在 P5 阶段实现">
      <van-button round type="primary" size="small" @click="router.replace('/')">
        回到首页
      </van-button>
    </van-empty>
  </div>
</template>
