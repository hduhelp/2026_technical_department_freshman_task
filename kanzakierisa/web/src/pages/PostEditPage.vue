<script setup>
/**
 * 编辑页（P5）。
 *
 * 与发布页共用 `PostForm`，差别只有三处：
 * 1. 进页面先拉详情预填（onMounted）；
 * 2. **权限前置判断** —— `can_edit !== true` 直接踢回首页，
 *    不让用户填完一屏才发现「这不是我的帖子」；
 * 3. 提交走 `PUT /posts/:id`，且 `type` 在表单里被禁用（后端也不接受该字段）。
 *
 * ⚠️ 第 2 步只是**体验层**的防线。真正的鉴权在后端：
 * 用别人的 token 直接 curl `PUT /posts/:id` 会拿到 1003 / 403。
 * 前端能做的是「别让用户白费力气」，绝不能是「安全边界」。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showSuccessToast, showToast } from 'vant'

import * as postApi from '@/api/post'
import PostForm from '@/components/PostForm.vue'

const route = useRoute()
const router = useRouter()

const post = ref(null)
const loading = ref(true)
const submitting = ref(false)

/**
 * 成功后延迟跳转的定时器。
 *
 * 必须存下来并在卸载时清掉：这 300ms 里用户可能已经自己返回列表了，
 * 定时器却照旧执行，会把用户从列表页强行带到详情页。
 * 与 PostListPage 里 searchTimer 的处理同理。
 */
let redirectTimer = null

onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer)
})

onMounted(async () => {
  try {
    const data = await postApi.detail(route.params.id)

    if (data.can_edit !== true) {
      showToast('无权编辑')
      // 用 replace 而不是 back：这一页不该留在历史里，
      // 否则用户按返回又会撞进同一个「无权」页面。
      router.replace('/')
      return
    }

    post.value = data
  } catch {
    // 帖子不存在（1004）或网络异常，拦截器已提示过，这里只负责离开
    router.replace('/')
  } finally {
    loading.value = false
  }
})

async function onSubmit(payload) {
  if (submitting.value) return
  submitting.value = true

  try {
    await postApi.update(route.params.id, payload)
    showSuccessToast('修改已保存')
    // 用 replace 回到详情页：详情页会用 watch(route.params.id) 重新拉一次接口，
    // 展示的必然是后端落库后的值（也顺带覆盖了「状态被他人改动」的情况）。
    redirectTimer = setTimeout(() => {
      router.replace(`/posts/${route.params.id}`)
    }, 300)
    return
  } catch {
    // 1003 无权 / 1007 已结束不可编辑 / 1001 校验失败，文案由拦截器给出
    submitting.value = false
  }
}

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace(`/posts/${route.params.id}`)
  }
}
</script>

<template>
  <div class="page edit-page">
    <van-nav-bar title="编辑帖子" left-arrow fixed placeholder @click-left="goBack" />

    <div v-if="loading" class="edit-page__loading">
      <van-loading type="spinner" vertical>加载中…</van-loading>
    </div>

    <!-- 等详情到位再挂载表单。PostForm 内部对 initialValue 有 immediate 的 watch，
         异步回填本身不会丢内容；但先挂一张空表单再被灌入数据，
         用户会看到一次「空白 → 内容」的闪动，所以这里等 loading 结束再挂。 -->
    <PostForm
      v-else-if="post"
      :initial-value="post"
      :submitting="submitting"
      @submit="onSubmit"
    />
  </div>
</template>

<style scoped>
.edit-page {
  padding-bottom: 24px;
}

.edit-page__loading {
  padding: 80px 0;
  text-align: center;
}
</style>
