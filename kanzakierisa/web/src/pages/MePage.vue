<script setup>
/**
 * 「我的」页面（P5）。
 *
 * 三段结构，自上而下：
 *   1. 用户卡片      —— 昵称 / @username / 编辑资料入口
 *   2. 数据统计      —— 发帖数、认领数
 *   3. 我的帖子      —— 状态 Tab + 卡片列表 + 卡片下的快捷操作（编辑/改状态/删除）
 *   4. 功能入口      —— 我的认领、编辑资料、退出登录
 *
 * 两个刻意的取舍：
 *
 * - **快捷操作不放进 PostCard**。PostCard 是列表页与「我的」共用的纯展示组件，
 *   让它认识「编辑/删除」这类写操作会把展示组件变成业务组件，列表页也得跟着
 *   多传一堆 props。这里把操作条放在卡片**外层**，两处互不干扰。
 *
 * - **状态流转与删除后一律重拉列表**，不本地改数组。原因见 P5 常见坑 4：
 *   状态改完不重拉，P6 的「认领通过 → 帖子自动变 matched」这类后端联动
 *   就会在页面上对不上。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'

import * as claimApi from '@/api/claim'
import * as postApi from '@/api/post'
import * as userApi from '@/api/user'
import PostCard from '@/components/PostCard.vue'
import StatusActionSheet from '@/components/StatusActionSheet.vue'
import { PAGE_SIZE, POST_STATUS } from '@/constants'
import { useUserStore } from '@/store/user'

const router = useRouter()
const userStore = useUserStore()

const nickname = computed(
  () => userStore.user?.nickname || userStore.user?.username || '未登录',
)

// ==================== 数据统计 ====================
const stats = reactive({
  posts: 0,
  /** 认领数：P6 接口就位后接上（P5 时这里恒为「—」）。
   *  与发帖数一样只要 total，pageSize 取 1，不搬运行数据。 */
  claims: null,
})

async function fetchStats() {
  try {
    // 只要 total，pageSize 取 1 即可，不搬运任何行数据
    const data = await postApi.listMine({ page: 1, pageSize: 1 })
    stats.posts = data.total || 0
  } catch {
    // 统计是装饰性信息，拉失败不该影响主列表；不弹提示
  }

  try {
    const data = await claimApi.listMine({ page: 1, pageSize: 1 })
    stats.claims = data.total || 0
  } catch {
    // 同上：拿不到就保持 null，模板会渲染成「—」
  }
}

// ==================== 我的帖子 ====================
const statusTabs = [{ name: 'all', title: '全部' }, ...POST_STATUS.map((item) => ({
  name: item.value,
  title: item.label,
}))]

const statusTab = ref('all')

const list = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = ref(false)
const error = ref(false)

let seq = 0 // 请求序号，用于丢弃过期响应（切 Tab 时尤其需要）

function buildParams() {
  const params = { page: page.value, pageSize: PAGE_SIZE }
  // 'all' 只是 UI 上的桶名，不能当成 status 传给后端，
  // 否则后端把 'all' 当非法枚举静默忽略（行为上碰巧对，但语义是错的）
  if (statusTab.value !== 'all') params.status = statusTab.value
  return params
}

async function fetchPage() {
  loading.value = true
  const mySeq = ++seq
  try {
    const data = await postApi.listMine(buildParams())
    if (mySeq !== seq) return

    list.value = list.value.concat(data.list || [])
    total.value = data.total || 0

    if (list.value.length >= total.value || (data.list || []).length === 0) {
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

async function reload() {
  page.value = 1
  list.value = []
  total.value = 0
  finished.value = false
  error.value = false
  await fetchPage()
}

watch(statusTab, () => {
  reload()
})

// 卡片下的快捷操作与状态弹层改动后，列表和统计都要跟着更新
function refreshAll() {
  reload()
  fetchStats()
}

onMounted(() => {
  // 主动拉一次：本页可能从路由守卫生效后才进来，store 里还没有 user，
  // 不拉的话昵称会一直显示占位文案。
  if (userStore.isLogin) {
    userStore.fetchMe().catch(() => {})
  }
  fetchStats()
  // 列表首屏不在这里加载：van-list 挂载后会自动触发一次 @load
})

// ==================== 快捷操作 ====================
function goEdit(post) {
  router.push(`/posts/${post.id}/edit`)
}

function goDetail(post) {
  router.push(`/posts/${post.id}`)
}

const showStatusSheet = ref(false)
const statusTarget = ref(null)

function openStatus(post) {
  statusTarget.value = post
  showStatusSheet.value = true
}

function onStatusSuccess() {
  // 后端是唯一真源：不把本地对象的 status 改掉，直接重拉
  refreshAll()
}

function onDelete(post) {
  showConfirmDialog({
    title: '删除帖子',
    message: `「${post.title}」删除后不可恢复，该帖下的认领申请也会一并删除。`,
    confirmButtonText: '删除',
    confirmButtonColor: '#ee0a24',
  })
    .then(async () => {
      await postApi.remove(post.id)
      showSuccessToast('已删除')
      refreshAll()
    })
    // 取消会 reject，吞掉即可
    .catch(() => {})
}

// ==================== 编辑资料 ====================
const showProfile = ref(false)
const profileSubmitting = ref(false)
const profile = reactive({ nickname: '', contact: '', contact_public: false })

function openProfile() {
  const me = userStore.user
  profile.nickname = me?.nickname || ''
  profile.contact = me?.contact || ''
  profile.contact_public = me?.contact_public === true
  showProfile.value = true
}

async function saveProfile() {
  if (profileSubmitting.value) return
  profileSubmitting.value = true
  try {
    await userApi.updateMe({
      nickname: profile.nickname.trim(),
      contact: profile.contact.trim(),
      contact_public: profile.contact_public,
    })
    // 先刷新本人信息，再重拉列表 —— 卡片的作者名来自后端 JOIN，
    // 不重拉的话改完昵称要等下次进页面才生效。
    await userStore.fetchMe()
    refreshAll()
    showSuccessToast('资料已更新')
    showProfile.value = false
  } catch {
    // 1001 校验失败等，文案由拦截器给出
  } finally {
    profileSubmitting.value = false
  }
}

// ==================== 其它 ====================
function goMyClaims() {
  router.push('/me/claims')
}

/** 认领管理：不带 postId 进入，由页面顶部自行选择帖子（P6） */
function goClaimManage() {
  router.push('/claims/manage')
}

function onLogout() {
  showConfirmDialog({
    title: '退出登录',
    message: '确定要退出当前账号吗？',
    confirmButtonText: '退出',
  })
    .then(async () => {
      await userStore.logout()
      showToast('已退出登录')
      router.replace('/')
    })
    .catch(() => {})
}
</script>

<template>
  <div class="page me-page">
    <van-nav-bar title="我的" />

    <!-- 用户卡片 -->
    <section class="me-page__profile">
      <div class="me-page__avatar">
        <van-icon name="user-o" size="26" color="#969799" />
      </div>
      <div class="me-page__ident">
        <!-- 用户输入一律插值渲染，严禁 v-html（SPEC 9.4） -->
        <div class="me-page__nickname">{{ nickname }}</div>
        <div class="me-page__username">@{{ userStore.user?.username || '—' }}</div>
      </div>
      <van-button size="small" round plain type="primary" @click="openProfile">
        编辑资料
      </van-button>
    </section>

    <!-- 数据统计 -->
    <section class="me-page__stats">
      <div class="me-page__stat">
        <span class="me-page__stat-num">{{ stats.posts }}</span>
        <span class="me-page__stat-label">发帖数</span>
      </div>
      <div class="me-page__divider" />
      <div class="me-page__stat">
        <span class="me-page__stat-num">{{ stats.claims ?? '—' }}</span>
        <span class="me-page__stat-label">认领数</span>
      </div>
    </section>

    <!-- 我的帖子 -->
    <van-tabs v-model:active="statusTab" line-width="20" class="me-page__tabs">
      <van-tab v-for="tab in statusTabs" :key="tab.name" :title="tab.title" :name="tab.name" />
    </van-tabs>

    <div class="me-page__list">
      <van-list
        v-model:loading="loading"
        v-model:error="error"
        :finished="finished"
        :finished-text="list.length ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        @load="fetchPage"
      >
        <div v-for="item in list" :key="item.id" class="me-page__item">
          <PostCard :post="item" />

          <!-- 卡片下的快捷操作条 -->
          <div class="me-page__ops">
            <van-button size="mini" plain type="primary" @click="goEdit(item)">编辑</van-button>
            <van-button size="mini" plain type="warning" @click="openStatus(item)">
              改状态
            </van-button>
            <van-button size="mini" plain type="danger" @click="onDelete(item)">删除</van-button>
            <van-button size="mini" plain @click="goDetail(item)">详情</van-button>
          </div>
        </div>
      </van-list>

      <van-empty
        v-if="!loading && !list.length"
        image="search"
        :description="statusTab === 'all' ? '你还没有发布过帖子' : '该状态下没有帖子'"
      />
    </div>

    <!-- 功能入口 -->
    <van-cell-group inset class="me-page__entries">
      <van-cell title="我的认领" is-link @click="goMyClaims" />
      <van-cell title="认领管理" is-link @click="goClaimManage" />
      <van-cell title="编辑资料" is-link @click="openProfile" />
    </van-cell-group>

    <div class="me-page__logout">
      <van-button block round type="danger" plain @click="onLogout">退出登录</van-button>
    </div>

    <!-- 编辑资料弹层 -->
    <van-popup v-model:show="showProfile" position="bottom" round>
      <van-form class="me-page__form" @submit="saveProfile">
        <h3 class="me-page__form-title">编辑资料</h3>

        <van-cell-group inset>
          <van-field
            v-model="profile.nickname"
            label="昵称"
            placeholder="展示给其他同学的名字"
            maxlength="32"
          />
          <van-field
            v-model="profile.contact"
            label="联系方式"
            placeholder="QQ / 微信 / 手机号"
            maxlength="64"
          />
          <van-cell title="公开联系方式" center>
            <template #right-icon>
              <van-switch v-model="profile.contact_public" size="20" />
            </template>
          </van-cell>
        </van-cell-group>

        <p class="me-page__form-tip">
          关闭时，联系方式仅在认领通过后对申请人可见
        </p>

        <div class="me-page__form-actions">
          <van-button
            block
            round
            type="primary"
            native-type="submit"
            :loading="profileSubmitting"
          >
            保存
          </van-button>
          <van-button block round plain @click="showProfile = false">取消</van-button>
        </div>
      </van-form>
    </van-popup>

    <!-- 状态流转弹层 -->
    <StatusActionSheet
      v-if="statusTarget"
      v-model:show="showStatusSheet"
      :post-id="statusTarget.id"
      :status="statusTarget.status"
      @success="onStatusSuccess"
    />
  </div>
</template>

<style scoped>
.me-page {
  padding-bottom: 32px;
}

/* ===== 用户卡片 ===== */
.me-page__profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px;
  background: #fff;
}

.me-page__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #f2f3f5;
  flex: 0 0 52px;
}

.me-page__ident {
  flex: 1;
  min-width: 0;
}

.me-page__nickname {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-page__username {
  margin-top: 2px;
  font-size: 12px;
  color: #969799;
}

/* ===== 统计 ===== */
.me-page__stats {
  display: flex;
  align-items: center;
  margin-top: 10px;
  padding: 14px 0;
  background: #fff;
}

.me-page__stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.me-page__stat-num {
  font-size: 20px;
  font-weight: 600;
  color: #1989fa;
}

.me-page__stat-label {
  font-size: 12px;
  color: #969799;
}

.me-page__divider {
  width: 1px;
  height: 26px;
  background: #ebedf0;
}

/* ===== 列表 ===== */
.me-page__tabs {
  margin-top: 10px;
}

.me-page__list {
  min-height: 40vh;
  padding: 12px 12px 4px;
}

.me-page__item {
  margin-bottom: 10px;
}

.me-page__ops {
  display: flex;
  gap: 8px;
  /* 视觉上贴着卡片下沿，让「操作属于上面这张卡」一目了然 */
  margin-top: -4px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 0 0 8px 8px;
}

/* PostCard 自己有下圆角与下边距，操作条要盖住它的下边距 */
.me-page__item :deep(.post-card) {
  margin-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

/* ===== 入口 ===== */
.me-page__entries {
  margin-top: 14px;
}

.me-page__logout {
  margin: 20px 16px 0;
}

/* ===== 编辑资料弹层 ===== */
.me-page__form {
  padding: 20px 0 24px;
}

.me-page__form-title {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  color: #323233;
}

.me-page__form-tip {
  margin: 10px 16px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #969799;
}

.me-page__form-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 18px 16px 0;
}
</style>
