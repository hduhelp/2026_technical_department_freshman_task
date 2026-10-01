<script setup>
/**
 * 首页 / 帖子列表页。
 *
 * 这一页是 P4 里最容易出 bug 的地方，几个关键取舍写在下面：
 *
 * 1. **搜索防抖 300ms**：`van-search` 的 v-model 每敲一个字都会更新，
 *    如果直接 watch 后发请求，输入「校园卡」三个字会打三次接口。
 *    这里用定时器把连续输入合并成一次请求。
 *
 * 2. **用「请求序号」而不是布尔锁来防重复**：筛选条件可以在请求飞行途中被再次
 *    修改，用布尔锁会让旧请求的响应覆盖新结果。给每个请求编号，响应回来时若
 *    编号已过期就直接丢弃，既避免重复卡片也避免旧数据回流。
 *
 * 3. **筛选变化时重置分页**：不清空 page 与 list 就会出现「第 2 页的旧筛选结果
 *    混进新筛选的第 1 页」。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import * as postApi from '@/api/post'
import EmptyState from '@/components/EmptyState.vue'
import PostCard from '@/components/PostCard.vue'
import { CATEGORIES, PAGE_SIZE, POST_STATUS } from '@/constants'

// ===== 筛选条件 =====
const keyword = ref('')
const activeType = ref('all') // all | lost | found
const category = ref('')
const status = ref('')

// ===== 列表状态 =====
const list = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = ref(false)
const error = ref(false)
const refreshing = ref(false)

let seq = 0 // 请求序号，用于丢弃过期响应

const categoryOptions = [
  { text: '全部分类', value: '' },
  ...CATEGORIES.map((item) => ({ text: item.label, value: item.value })),
]

const statusOptions = [
  { text: '全部状态', value: '' },
  ...POST_STATUS.map((item) => ({ text: item.label, value: item.value })),
]

const hasFilter = computed(
  () =>
    activeType.value !== 'all' ||
    !!category.value ||
    !!status.value ||
    !!keyword.value.trim(),
)

// 空状态文案区分场景，否则用户分不清「真没有帖子」和「筛选把结果筛没了」
const emptyText = computed(() =>
  hasFilter.value ? '没有找到相关帖子' : '还没有帖子，快来发一条',
)

/** 组装查询参数。空串一律不传，避免后端把空串当成合法枚举值去匹配。 */
function buildParams() {
  const params = { page: page.value, pageSize: PAGE_SIZE }
  if (activeType.value !== 'all') params.type = activeType.value
  if (category.value) params.category = category.value
  if (status.value) params.status = status.value
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  return params
}

/** 拉取当前 page 指向的一页，追加到列表尾部。 */
async function fetchPage() {
  loading.value = true
  const mySeq = ++seq
  try {
    const data = await postApi.list(buildParams())
    // 过期响应：期间用户又改了筛选条件，这一份结果已经不该展示了
    if (mySeq !== seq) return

    list.value = list.value.concat(data.list || [])
    total.value = data.total || 0

    // finished 的判定：拿到的累计条数追平 total，或后端返回了空页（兜底防死循环）
    if (list.value.length >= total.value || (data.list || []).length === 0) {
      finished.value = true
    } else {
      page.value += 1
    }
  } catch {
    // 拦截器已提示；这里只标记错误态，让 van-list 显示「加载失败，点击重试」
    if (mySeq === seq) error.value = true
  } finally {
    if (mySeq === seq) loading.value = false
  }
}

/** 重置到第 1 页并重新加载（筛选条件变化、下拉刷新时调用）。 */
async function reload() {
  page.value = 1
  list.value = []
  total.value = 0
  finished.value = false
  error.value = false
  await fetchPage()
}

// van-list 触底回调
function onLoad() {
  fetchPage()
}

async function onRefresh() {
  await reload()
  refreshing.value = false
}

// ===== 筛选条件变化 =====
// 类型 / 分类 / 状态是离散选择，立即生效，不需要防抖
watch([activeType, category, status], () => {
  reload()
})

// 关键字是连续输入，300ms 防抖：300ms 内没有新输入才真正发请求
let searchTimer = null
watch(keyword, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    reload()
  }, 300)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="page list-page">
    <van-nav-bar title="校园失物招领" />

    <van-search
      v-model="keyword"
      shape="round"
      background="#f7f8fa"
      placeholder="搜索物品、地点、描述"
    />

    <van-tabs v-model:active="activeType" line-width="20">
      <van-tab title="全部" name="all" />
      <van-tab title="失物" name="lost" />
      <van-tab title="招领" name="found" />
    </van-tabs>

    <!-- 分类与状态并列放在下拉菜单里，不和 Tab 挤在同一行 -->
    <van-dropdown-menu active-color="#1989fa">
      <van-dropdown-item v-model="category" :options="categoryOptions" />
      <van-dropdown-item v-model="status" :options="statusOptions" />
    </van-dropdown-menu>

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <div class="list-page__body">
        <van-list
          v-model:loading="loading"
          v-model:error="error"
          :finished="finished"
          :finished-text="list.length ? '没有更多了' : ''"
          error-text="加载失败，点击重试"
          @load="onLoad"
        >
          <PostCard v-for="item in list" :key="item.id" :post="item" />
        </van-list>

        <EmptyState v-if="!loading && !list.length" :description="emptyText" />
      </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.list-page {
  padding-bottom: 0;
}

.list-page__body {
  /* 内容不足一屏时也给足高度，否则下拉刷新在空列表上很难触发 */
  min-height: 60vh;
  padding: 12px 12px 4px;
}
</style>
