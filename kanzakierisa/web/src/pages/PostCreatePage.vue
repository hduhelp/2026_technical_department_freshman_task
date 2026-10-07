<script setup>
/**
 * 发布页（P5）。
 *
 * 页面职责极薄：只做「调接口 + 导航 + 成功后的清理」，
 * 所有字段与校验都在 `PostForm` 里，因此这一页不会和编辑页产生第二份表单逻辑。
 *
 * 未登录的情况不用在这里判断 —— `/publish` 的 `meta.requiresAuth` 已由
 * 全局守卫拦下，能渲染到这里就说明一定拿到了 token。
 */
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast } from 'vant'

import * as postApi from '@/api/post'
import PostForm from '@/components/PostForm.vue'

const router = useRouter()

const formRef = ref(null)
const submitting = ref(false)

/**
 * 成功后延迟跳转的定时器。
 *
 * 必须存下来并在卸载时清掉：这个 500ms 窗口里用户完全可能自己按返回离开本页，
 * 而定时器不会随组件消失 —— 会把人从列表页强行拽到详情页。
 * 与 PostListPage 里 searchTimer 的处理同理。
 */
let redirectTimer = null

onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer)
})

async function onSubmit(payload) {
  if (submitting.value) return
  submitting.value = true

  try {
    const post = await postApi.create(payload)

    // 成功后立刻清空表单：本页稍后会被卸载，但用户从详情页返回时
    // 若组件被复用，残留的旧内容会被误当成「还有没发出去的东西」。
    formRef.value?.reset()

    showSuccessToast('发布成功')
    // 延迟 500ms 再跳转，让「发布成功」的 Toast 有时间被看见；
    // 用 replace 而非 push，避免用户从详情页返回又回到已提交的表单。
    redirectTimer = setTimeout(() => {
      router.replace(`/posts/${post.id}`)
    }, 500)

    // ⚠️ 成功分支刻意**不**把 submitting 复位：
    // 否则这 500ms 窗口里用户还能再点一次提交，会发出第二个创建请求。
    return
  } catch {
    // 失败文案（1001 校验失败等）已由 axios 拦截器统一 Toast
    submitting.value = false
  }
}

/** 直接打开本页时没有历史记录，回首页而不是白屏 */
function leave() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace('/')
  }
}

/** 有未保存内容时二次确认，避免误触返回白填一屏 */
function goBack() {
  if (!formRef.value?.isDirty) {
    leave()
    return
  }

  showConfirmDialog({
    title: '放弃发布？',
    message: '已填写的内容不会被保存。',
    confirmButtonText: '放弃',
    cancelButtonText: '继续编辑',
  })
    .then(leave)
    // 用户点了「继续编辑」，留在本页 —— 取消会 reject，必须吞掉
    .catch(() => {})
}
</script>

<template>
  <div class="page create-page">
    <van-nav-bar title="发布" left-arrow fixed placeholder @click-left="goBack" />

    <PostForm ref="formRef" :submitting="submitting" @submit="onSubmit" />
  </div>
</template>

<style scoped>
.create-page {
  padding-bottom: 24px;
}
</style>
