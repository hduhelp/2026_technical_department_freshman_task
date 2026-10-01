<script setup>
/**
 * 我的认领（申请人视角，P6）。
 *
 * 数据来自 `GET /api/users/me/claims`，每条已经由后端联表带出 `post` 摘要，
 * 所以列表本身不需要 N+1 查询。
 *
 * 两个刻意的取舍：
 *
 * 1. **不做状态筛选 Tab**。SPEC 8.4 给这个接口定义的查询参数只有
 *    `page` / `pageSize`，没有 `status`；而在**分页**列表上做前端筛选会
 *    出现「当前页筛出 0 条、其实后面还有几页」的假空态。既然 07 §9 只要求
 *    「列出我发出的全部认领」，这里就老老实实全量分页，不加会撒谎的筛选器。
 *
 * 2. **帖主联系方式要额外拉一次帖子详情**。认领列表接口不返回它（它属于
 *    帖子详情里的作者信息），而 SPEC 7.2 第三条可见性规则要求「申请人 ×
 *    已通过认领」才可见。因此只对 approved / redeemed 的记录补拉
 *    `GET /api/posts/:id`，并**按 post_id 去重** —— 同一个帖子可能有多条
 *    历史认领记录（被拒后重提），不去重会重复请求同一个帖子。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import * as claimApi from '@/api/claim'
import * as postApi from '@/api/post'
import ClaimCard from '@/components/ClaimCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { PAGE_SIZE } from '@/constants'

const router = useRouter()

const list = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = ref(false)
const error = ref(false)

/** postId → 帖主联系方式。可见性由后端判定，前端只缓存返回值 */
const contactMap = ref({})

let seq = 0

/** 为「已通过 / 已交接」的认领补拉帖主联系方式，接口失败静默降级为「去详情页查看」 */
async function hydrateContacts(rows) {
  const postIds = [
    ...new Set(
      rows
        .filter((c) => c.status === 'approved' || c.status === 'redeemed')
        .map((c) => c.post?.id)
        .filter((id) => id && contactMap.value[id] === undefined),
    ),
  ]
  if (!postIds.length) return

  const results = await Promise.allSettled(postIds.map((id) => postApi.detail(id)))
  const next = { ...contactMap.value }
  results.forEach((res, index) => {
    const id = postIds[index]
    // 拉不到、或对方关掉了公开且此刻不可见 → 存空串。
    // 存空串而不是不写，是为了标记「已尝试过」，避免分页往返里反复重试同一帖。
    next[id] =
      res.status === 'fulfilled' && res.value?.author?.contact_visible
        ? res.value.author.contact || ''
        : ''
  })
  contactMap.value = next
}

async function fetchPage() {
  loading.value = true
  const mySeq = ++seq
  try {
    const data = await claimApi.listMine({ page: page.value, pageSize: PAGE_SIZE })
    if (mySeq !== seq) return

    const rows = data.list || []
    list.value = list.value.concat(rows)
    total.value = data.total || 0

    if (list.value.length >= total.value || rows.length === 0) {
      finished.value = true
    } else {
      page.value += 1
    }

    // 不 await：联系方式是装饰性信息，不该挡住列表渲染
    hydrateContacts(rows)
  } catch {
    if (mySeq === seq) error.value = true
  } finally {
    if (mySeq === seq) loading.value = false
  }
}

async function reload() {
  seq += 1 // 让在途的旧响应失效
  page.value = 1
  list.value = []
  total.value = 0
  finished.value = false
  error.value = false
  await fetchPage()
}

onMounted(() => {
  // 首屏由 van-list 挂载后自动触发一次 @load（与 MePage 同一约定）
})

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace('/')
  }
}

function goHome() {
  router.replace('/')
}

// 核销后不本地改数组，直接重拉（后端是唯一真源）
function onChanged() {
  reload()
}
</script>

<template>
  <div class="page my-claims-page">
    <van-nav-bar title="我的认领" left-arrow fixed placeholder @click-left="goBack" />

    <div class="my-claims-page__list">
      <van-list
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :finished-text="list.length ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        @load="fetchPage"
      >
        <ClaimCard
          v-for="item in list"
          :key="item.id"
          :claim="item"
          mode="mine"
          :contact="contactMap[item.post?.id] || ''"
          @success="onChanged"
        />
      </van-list>

      <EmptyState
        v-if="!loading && !list.length && !error"
        image="search"
        description="你还没有提交过认领申请"
      >
        <van-button round type="primary" size="small" @click="goHome">
          去看看大家的帖子
        </van-button>
      </EmptyState>
    </div>
  </div>
</template>

<style scoped>
.my-claims-page {
  padding-bottom: 20px;
}

.my-claims-page__list {
  min-height: 50vh;
  padding: 12px 12px 4px;
}
</style>
