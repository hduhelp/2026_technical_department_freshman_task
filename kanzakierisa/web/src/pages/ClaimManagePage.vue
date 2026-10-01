<script setup>
/**
 * 认领管理（帖主视角，P6）。
 *
 * 两条进入路径：
 *   - 详情页「认领管理」按钮 → `/claims/manage?postId=123`
 *   - 直接进本页      → 顶部下拉选择一条自己的帖子
 *
 * 为什么用**底部弹层 + 无限滚动**选帖子，而不是 `van-dropdown-menu`：
 * 下拉菜单适合「固定 3–5 个选项」，而帖子数会一直长。用分页弹层就能
 * 不受 `pageSize` 上限（后端夹取到 50）影响，帖子再多也不会漏。
 *
 * 权限口径：`GET /posts/:id/claims` 在 SPEC 8.4 里是**仅帖主**（07 §5 括号
 * 里的「或 admin」与 SPEC 冲突，以 SPEC 为准）。所以本页只列自己的帖子，
 * 不提供「查看别人的帖子认领」入口 —— 那本来就会 1003。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import * as claimApi from '@/api/claim'
import * as postApi from '@/api/post'
import ClaimCard from '@/components/ClaimCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { PAGE_SIZE } from '@/constants'
import { statusLabel, statusTagType } from '@/utils/format'

const route = useRoute()
const router = useRouter()

/** 当前选中的帖子 id。来自 URL 的 postId，或用户在弹层里选的 */
const postId = ref(route.query.postId ? Number(route.query.postId) : null)
const currentPost = ref(null)

const hasPost = computed(() => Boolean(postId.value))

async function loadCurrentPost() {
  if (!postId.value) {
    currentPost.value = null
    return
  }
  try {
    // 用详情接口取标题/状态：我的帖子列表是分页的，直接查详情才能保证
    // 「深链带 postId 进来」时标题一定拿得到（不必先加载完整个列表）
    const post = await postApi.detail(postId.value)
    currentPost.value = post
  } catch {
    // 1004 已由拦截器提示；退回未选择状态，用户可重新选
    currentPost.value = null
    postId.value = null
  }
}

// ==================== 认领列表 ====================
const claims = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = ref(false)
const error = ref(false)

let seq = 0

async function fetchClaims() {
  if (!postId.value) return
  loading.value = true
  const mySeq = ++seq
  try {
    const data = await claimApi.listByPost(postId.value, {
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    if (mySeq !== seq) return

    const rows = data.list || []
    claims.value = claims.value.concat(rows)
    total.value = data.total || 0

    if (claims.value.length >= total.value || rows.length === 0) {
      finished.value = true
    } else {
      page.value += 1
    }
  } catch {
    if (mySeq === seq) error.value = true
  } finally {
    if (mySeq === seq) loading.value = false
  }
}

async function reloadClaims() {
  if (!postId.value) return
  seq += 1
  page.value = 1
  claims.value = []
  total.value = 0
  finished.value = false
  error.value = false
  await fetchClaims()
}

/**
 * 只重置状态、不发请求。
 *
 * 配合模板里 van-list 的 `:key="postId"` 使用：换帖子时 key 变化会让
 * van-list **重新挂载**，它挂载后会自动触发一次 `@load`，正好拉第一页。
 * 如果这里再手动调一次 `fetchClaims()`，就会和 van-list 的自动触发
 * 撞成两个并发请求 —— 而且第二个请求的 page 已经被推到 2，列表里
 * 会莫名少掉第一页。
 */
function resetClaimsState() {
  seq += 1
  page.value = 1
  claims.value = []
  total.value = 0
  finished.value = false
  error.value = false
  loading.value = false
}

// ==================== 选择帖子 ====================
const pickerShow = ref(false)
const myPosts = ref([])
const pPage = ref(1)
const pTotal = ref(0)
const pLoading = ref(false)
const pFinished = ref(false)
const pError = ref(false)
/** 弹层是否已经拉过第一页：避免每次打开都重拉 */
const pickerLoaded = ref(false)

let pSeq = 0

async function fetchMyPosts() {
  pLoading.value = true
  const mySeq = ++pSeq
  try {
    const data = await postApi.listMine({ page: pPage.value, pageSize: PAGE_SIZE })
    if (mySeq !== pSeq) return

    const rows = data.list || []
    myPosts.value = myPosts.value.concat(rows)
    pTotal.value = data.total || 0

    if (myPosts.value.length >= pTotal.value || rows.length === 0) {
      pFinished.value = true
    } else {
      pPage.value += 1
    }
    pickerLoaded.value = true
  } catch {
    if (mySeq === pSeq) pError.value = true
  } finally {
    if (mySeq === pSeq) pLoading.value = false
  }
}

function openPicker() {
  pickerShow.value = true
  // 首屏由 van-list 自动 @load；已加载过就不重复拉
}

function pick(post) {
  pickerShow.value = false
  if (post.id === postId.value) return

  // 先重置再改 id：下一帧 van-list 会带着干净的 page/finished 重新挂载
  resetClaimsState()
  postId.value = post.id
  currentPost.value = post
  // 把选择同步进 URL：刷新页面/分享链接后仍是同一条帖子
  router.replace({ path: '/claims/manage', query: { postId: post.id } })
}

function goDetail() {
  if (postId.value) router.push(`/posts/${postId.value}`)
}

// ==================== 其它 ====================
function onChanged() {
  reloadClaims()
  // 审核通过会让帖子自动变 matched、核销会让它变 closed，
  // 顶部那条帖子状态得跟着更新，否则会和下方卡片自相矛盾
  loadCurrentPost()
}

onMounted(async () => {
  await loadCurrentPost()
  // 认领列表不在这里拉：van-list 挂载后会自己触发一次 @load。
  // 若 URL 没带 postId，van-list 此刻还没渲染，等用户在弹层里选完帖子、
  // hasPost 变 true 时它才挂载，同样会自己触发。
})

function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace('/me')
  }
}
</script>

<template>
  <div class="page claim-manage-page">
    <van-nav-bar title="认领管理" left-arrow fixed placeholder @click-left="goBack" />

    <!-- 顶部帖子选择器 -->
    <van-cell-group inset class="claim-manage-page__picker">
      <van-cell
        title="当前帖子"
        is-link
        :value="currentPost ? '' : '点击选择'"
        @click="openPicker"
      >
        <template #label>
          <span v-if="currentPost" class="claim-manage-page__post">
            {{ currentPost.title }}
          </span>
          <span v-else class="claim-manage-page__post claim-manage-page__post--muted">
            选择一条你发布的帖子来审核认领
          </span>
        </template>
      </van-cell>

      <van-cell v-if="currentPost" title="帖子状态" center>
        <template #value>
          <van-tag :type="statusTagType(currentPost.status)" plain>
            {{ statusLabel(currentPost.status) }}
          </van-tag>
        </template>
      </van-cell>

      <van-cell v-if="currentPost" title="查看帖子" is-link @click="goDetail" />
    </van-cell-group>

    <!-- 认领列表 -->
    <div class="claim-manage-page__list">
      <van-list
        v-if="hasPost"
        :key="postId"
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :finished-text="claims.length ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        @load="fetchClaims"
      >
        <ClaimCard
          v-for="item in claims"
          :key="item.id"
          :claim="item"
          mode="manage"
          :owner-nickname="currentPost?.author?.nickname || ''"
          :post-title="currentPost?.title || ''"
          @success="onChanged"
        />
      </van-list>

      <EmptyState
        v-if="hasPost && !loading && !claims.length && !error"
        image="search"
        description="还没有人认领，可以把帖子分享给同学"
      >
        <van-button round type="primary" size="small" @click="goDetail">
          查看帖子
        </van-button>
      </EmptyState>

      <EmptyState
        v-if="!hasPost"
        image="default"
        description="先选择一条你发布的帖子"
      >
        <van-button round type="primary" size="small" @click="openPicker">
          选择帖子
        </van-button>
      </EmptyState>
    </div>

    <!-- 帖子选择弹层 -->
    <van-popup v-model:show="pickerShow" position="bottom" round :style="{ height: '60%' }">
      <div class="claim-manage-page__picker-sheet">
        <h3 class="claim-manage-page__picker-title">选择帖子</h3>

        <van-list
          v-model:loading="pLoading"
          v-model:error="pError"
          :finished="pFinished"
          :finished-text="myPosts.length ? '没有更多了' : ''"
          error-text="加载失败，点击重试"
          class="claim-manage-page__picker-list"
          @load="fetchMyPosts"
        >
          <van-cell
            v-for="item in myPosts"
            :key="item.id"
            :title="item.title"
            :label="`${statusLabel(item.status)} · 发布于 ${item.location || '未填写地点'}`"
            is-link
            :class="{ 'is-active': item.id === postId }"
            @click="pick(item)"
          />
        </van-list>

        <EmptyState
          v-if="pickerLoaded && !pLoading && !myPosts.length && !pError"
          image="search"
          description="你还没有发布过帖子"
        />
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.claim-manage-page {
  padding-bottom: 20px;
}

.claim-manage-page__picker {
  margin-top: 12px;
}

.claim-manage-page__post {
  font-size: 13px;
  color: #323233;
  word-break: break-word;
}

.claim-manage-page__post--muted {
  color: #969799;
}

.claim-manage-page__list {
  min-height: 40vh;
  padding: 12px 12px 4px;
}

/* ===== 选择弹层 ===== */
.claim-manage-page__picker-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.claim-manage-page__picker-title {
  flex: 0 0 auto;
  margin: 0;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  color: #323233;
}

.claim-manage-page__picker-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

/* 当前选中的那条给一个左侧色条，避免长列表里找不到自己在看哪条 */
.claim-manage-page__picker-list .is-active {
  background: #ecf5ff;
}
</style>
